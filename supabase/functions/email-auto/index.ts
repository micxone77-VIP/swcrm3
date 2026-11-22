// Supabase Edge Function: email-auto (2026-11-22) ⏰ Auto-send for the Email a List page.
// pg_cron calls it every 10 minutes (header x-cron-token = email_auto_cron.token). An admin / host can also
// call it from the page ("Run now", logged in). For each active job in email_auto_jobs it sends the next
// pending rows of email_auto_rows through send-email (as the person who started the job), at most
// job.per_hour per hour and never over the CRM hourly limit (crm_rules email_hourly_limit), 25 per run.
// Sent / failed rows are marked in the Google Sheet when sheet marking is set up (sheet_hook_settings).
// A job is "done" when no rows are left. Paused / stopped jobs are not touched.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const PER_RUN = 25
const mytNow = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // Who is calling: the cron (token) or a logged-in admin / host
  const cronToken = req.headers.get('x-cron-token') || ''
  let allowed = false
  if (cronToken) {
    const { data } = await db.from('email_auto_cron').select('token').eq('id', true).maybeSingle()
    allowed = !!data?.token && data.token === cronToken
  } else {
    const auth = req.headers.get('Authorization') || ''
    const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await userDb.auth.getUser()
    if (user) {
      const { data: p } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
      allowed = ['admin', 'host'].includes(String(p?.role || ''))
    }
  }
  if (!allowed) return json({ error: 'Unauthorized' }, 401)

  try {
    // Rows stuck in "sending" (a run that crashed): sent if email_logs has them, else back to pending
    const stale = new Date(Date.now() - 20 * 60_000).toISOString()
    const { data: stuck } = await db.from('email_auto_rows').select('id,email,claimed_at').eq('status', 'sending').lt('claimed_at', stale).limit(200)
    for (const r of stuck || []) {
      const { count } = await db.from('email_logs').select('id', { count: 'exact', head: true }).eq('status', 'sent').in('to_email', [...new Set([r.email, r.email.toLowerCase()])]).gte('created_at', new Date(new Date(r.claimed_at).getTime() - 60_000).toISOString())
      await db.from('email_auto_rows').update(count ? { status: 'sent', reason: 'sent (found in Sent history)', done_at: new Date().toISOString() } : { status: 'pending', claimed_at: null }).eq('id', r.id)
    }

    const { data: rule } = await db.from('crm_rules').select('value').eq('rule_key', 'email_hourly_limit').maybeSingle()
    const limit = Number(rule?.value) || 100
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { count: sentHour } = await db.from('email_logs').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', hourAgo)
    let room = Math.max(limit - (sentHour || 0), 0)

    const { data: hook } = await db.from('sheet_hook_settings').select('script_url, token').eq('id', true).maybeSingle()
    const { data: jobs } = await db.from('email_auto_jobs').select('*').eq('status', 'active').order('created_at')
    const report: Record<string, unknown>[] = []

    for (const job of jobs || []) {
      const setJob = (v: Record<string, unknown>) => db.from('email_auto_jobs').update({ ...v, last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id)
      const { count: left } = await db.from('email_auto_rows').select('id', { count: 'exact', head: true }).eq('job_id', job.id).in('status', ['pending', 'sending'])
      if (!left) { await setJob({ status: 'done', last_msg: 'All rows done' }); report.push({ job: job.id, done: true }); continue }
      const { count: jobHour } = await db.from('email_auto_rows').select('id', { count: 'exact', head: true }).eq('job_id', job.id).eq('status', 'sent').gte('done_at', hourAgo)
      const n = Math.min(PER_RUN, job.per_hour - (jobHour || 0), room)
      if (n <= 0) {
        await setJob({ last_msg: room <= 0 ? `Waiting: CRM hourly limit (${limit}) reached` : `Waiting: ${job.per_hour} sent in the last hour` })
        report.push({ job: job.id, waiting: true }); continue
      }

      // Claim the next n pending rows (top to bottom)
      const { data: next } = await db.from('email_auto_rows').select('id').eq('job_id', job.id).eq('status', 'pending').order('line').limit(n)
      const ids = (next || []).map(r => r.id)
      if (!ids.length) continue
      const { data: claimed } = await db.from('email_auto_rows').update({ status: 'sending', claimed_at: new Date().toISOString() }).in('id', ids).eq('status', 'pending').select('id,line,email,name,username')
      if (!claimed?.length) continue

      // Emailed by anyone since this job started (e.g. sent by hand meanwhile): skip, no double email
      const lower = [...new Set(claimed.map(r => r.email.toLowerCase()))]
      const { data: already } = await db.from('email_logs').select('to_email').eq('status', 'sent').or('reason.is.null,reason.neq.test').gte('created_at', job.created_at).in('to_email', [...lower, ...claimed.map(r => r.email)])
      const alreadySet = new Set((already || []).map(a => String(a.to_email).toLowerCase()))
      const toSend = claimed.filter(r => !alreadySet.has(r.email.toLowerCase()))
      const skipIds = claimed.filter(r => alreadySet.has(r.email.toLowerCase())).map(r => r.id)
      if (skipIds.length) await db.from('email_auto_rows').update({ status: 'skipped', reason: 'already emailed after this auto-send started', done_at: new Date().toISOString() }).in('id', skipIds)

      let results: { email?: string; status: string; reason?: string }[] = []
      let callErr = ''
      if (toSend.length) {
        const r = await fetch(`${url}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, 'x-as-profile': job.created_by },
          body: JSON.stringify({ leads: toSend.map(x => ({ email: x.email, name: x.name || '', username: x.username || '' })), subject: job.subject, body: job.body, wa_number: job.wa_number || undefined }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) callErr = String(d?.error || `send-email HTTP ${r.status}`)
        results = d?.results || []
      }
      if (callErr) {
        // Nothing went out: put the rows back and pause the job so it does not keep failing every 10 minutes
        await db.from('email_auto_rows').update({ status: 'pending', claimed_at: null }).in('id', toSend.map(x => x.id))
        await setJob({ status: 'paused', last_msg: `Paused: ${callErr}`.slice(0, 300) })
        report.push({ job: job.id, error: callErr }); continue
      }

      const byEmail: Record<string, { status: string; reason?: string }> = {}
      for (const x of results) if (x.email) byEmail[String(x.email).toLowerCase()] = x
      const marks: { row: number; email: string; status: string; at: string; by: string }[] = []
      let sent = 0
      for (const row of toSend) {
        const x = byEmail[row.email.toLowerCase()]
        const now = new Date().toISOString()
        if (!x) { await db.from('email_auto_rows').update({ status: 'pending', claimed_at: null }).eq('id', row.id); continue }
        if (x.status === 'skipped' && /hourly limit/i.test(x.reason || '')) { await db.from('email_auto_rows').update({ status: 'pending', claimed_at: null }).eq('id', row.id); continue }
        const st = x.status === 'sent' ? 'sent' : x.status === 'failed' ? 'failed' : 'skipped'
        if (st === 'sent') sent++
        await db.from('email_auto_rows').update({ status: st, reason: x.reason || null, done_at: now }).eq('id', row.id)
        if ((st === 'sent' || st === 'failed') && row.line) marks.push({ row: row.line, email: row.email.toLowerCase(), status: st === 'sent' ? 'Sent' : `Failed: ${x.reason || ''}`.slice(0, 120), at: mytNow(), by: `${job.created_by_name || ''} (auto)`.trim() })
      }
      room -= sent

      // ✍ Mark the Google Sheet (when set up); a failure here never stops the sending
      let markNote = ''
      if (marks.length && job.sheet_id && hook?.script_url) {
        try {
          const r = await fetch(hook.script_url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, redirect: 'follow',
            body: JSON.stringify({ token: hook.token, action: 'mark', sheetId: job.sheet_id, gid: String(job.gid ?? ''), headRow: job.head_row || 1, emailCol: job.email_col || 0, marks }) })
          const t = await r.json().catch(() => ({}))
          markNote = t?.ok ? ` · ${t.marked || 0} marked in the sheet` : ' · sheet not marked'
        } catch { markNote = ' · sheet not marked' }
      }
      await setJob({ last_msg: `${mytNow()} MYT: sent ${sent}${skipIds.length ? `, skipped ${skipIds.length}` : ''}${markNote}` })
      report.push({ job: job.id, sent, skipped: skipIds.length })
    }
    return json({ ok: true, room_left: room, jobs: report })
  } catch (e) {
    console.error(e)
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500)
  }
})
