// Supabase Edge Function: send-email (2026-11-10)
// Sends CRM emails to players through the surewinworld.com mail server (SMTP, port 465 SSL).
// Caller must be logged in as admin or host. Body:
//   { recipients: ["username", ...] (max 25 per call), subject, body, test_to?: "address" }
// Placeholders in subject/body: {name} {username} {agent}
// Each player: skipped when no email / unsubscribed / hourly limit reached; every attempt goes to
// email_logs, every sent email also to contact_logs (channel Email).
// Secrets (Supabase dashboard → Edge Functions → Secrets): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function unsubToken(email: string, key: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(email.toLowerCase()))
  return [...new Uint8Array(sig)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('')
}
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Unauthorized' }, 401)
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)
  const { data: prof } = await caller.from('profiles').select('id,role,full_name,username').eq('id', user.id).single()
  if (!prof || !['admin', 'host'].includes(prof.role)) return json({ error: 'Only admin or host accounts can send email' }, 403)

  const smtp = {
    host: Deno.env.get('SMTP_HOST'), port: Number(Deno.env.get('SMTP_PORT') || 465),
    user: Deno.env.get('SMTP_USER'), pass: Deno.env.get('SMTP_PASS'), from: Deno.env.get('SMTP_FROM') || Deno.env.get('SMTP_USER'),
  }
  if (!smtp.host || !smtp.user || !smtp.pass) return json({ error: 'Email is not set up yet: the SMTP secrets are missing in Supabase.', not_configured: true }, 503)

  let body: { recipients?: string[]; subject?: string; body?: string; test_to?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const subjectT = String(body.subject || '').trim()
  const bodyT = String(body.body || '').trim()
  if (!subjectT || !bodyT) return json({ error: 'Subject and message are required' }, 400)
  const names = [...new Set((body.recipients || []).map(u => String(u).trim()).filter(Boolean))]
  const testTo = body.test_to ? String(body.test_to).trim() : ''
  if (testTo && !EMAIL_RE.test(testTo)) return json({ error: 'Test address is not a valid email' }, 400)
  if (!names.length) return json({ error: 'No players given' }, 400)
  if (names.length > 25) return json({ error: 'Max 25 players per call' }, 400)

  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const agent = String(prof.full_name || prof.username || 'VIP team').split(/\s+/)[0]

  const { data: rule } = await db.from('crm_rules').select('value').eq('rule_key', 'email_hourly_limit').maybeSingle()
  const limit = Number(rule?.value) || 100
  const { count: sentHour } = await db.from('email_logs').select('id', { count: 'exact', head: true })
    .eq('status', 'sent').gte('created_at', new Date(Date.now() - 3600_000).toISOString())
  let room = Math.max(limit - (sentHour || 0), 0)

  const { data: members, error: mErr } = await db.from('vip_members_all').select('username,full_name,email,tier').in('username', names)
  if (mErr) return json({ error: mErr.message }, 500)
  const byName = Object.fromEntries((members || []).map(m => [m.username, m]))
  const emails = (members || []).map(m => String(m.email || '').trim().toLowerCase()).filter(Boolean)
  const { data: unsubs } = emails.length ? await db.from('email_unsubscribes').select('email').in('email', emails) : { data: [] }
  const unsubSet = new Set((unsubs || []).map(u => u.email))

  const fill = (t: string, m: { username: string; full_name?: string | null }) =>
    t.replaceAll('{name}', (m.full_name || m.username).split(/\s+/)[0]).replaceAll('{username}', m.username).replaceAll('{agent}', agent)

  const client = new SMTPClient({ connection: { hostname: smtp.host, port: smtp.port, tls: true, auth: { username: smtp.user, password: smtp.pass } } })
  const results: { username: string; status: string; reason?: string }[] = []
  const logs: Record<string, unknown>[] = []
  const contacts: Record<string, unknown>[] = []
  const myt = new Date(Date.now() + 8 * 3600_000)

  try {
    for (const u of names) {
      const m = byName[u]
      const to = testTo || String(m?.email || '').trim()
      const skip = (reason: string) => { results.push({ username: u, status: 'skipped', reason }); logs.push({ username: u, to_email: to || null, subject: subjectT, status: 'skipped', reason, sent_by: prof.id, sender_name: agent }) }
      if (!m) { skip('player not found'); continue }
      if (!EMAIL_RE.test(to)) { skip('no valid email'); continue }
      if (!testTo && unsubSet.has(to.toLowerCase())) { skip('unsubscribed'); continue }
      if (room <= 0) { skip(`hourly limit (${limit}) reached`); continue }

      const subject = fill(subjectT, m)
      const text = fill(bodyT, m)
      const unsubUrl = `${url}/functions/v1/email-unsubscribe?e=${b64url(to.toLowerCase())}&t=${await unsubToken(to, serviceKey)}`
      const footerText = `\n\n--\nsureWin VIP department\nDon't want these emails? Unsubscribe: ${unsubUrl}`
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">${esc(text).replace(/\n/g, '<br>')}`
        + `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0 8px"><div style="font-size:11px;color:#888">sureWin VIP department · <a href="${unsubUrl}" style="color:#888">Unsubscribe</a></div></div>`
      try {
        await client.send({ from: smtp.from!, to, subject: testTo ? `[TEST] ${subject}` : subject, content: text + footerText, html,
          headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
        room--
        results.push({ username: u, status: 'sent' })
        logs.push({ username: u, to_email: to, subject, body: text, status: 'sent', reason: testTo ? 'test' : null, sent_by: prof.id, sender_name: agent })
        if (!testTo) contacts.push({
          username: u, tier: m.tier || null, channel: 'Email', outcome: 'Contacted', direction: 'outbound', topic: 'email',
          message_summary: `Email: ${subject}`.slice(0, 500), host_name: agent, host_id: prof.id, logged_at: new Date().toISOString(),
          log_month: myt.toISOString().slice(0, 7), log_week: String(Math.ceil(myt.getUTCDate() / 7)),
        })
      } catch (e) {
        const reason = String((e as Error)?.message || e).slice(0, 300)
        results.push({ username: u, status: 'failed', reason })
        logs.push({ username: u, to_email: to, subject, status: 'failed', reason, sent_by: prof.id, sender_name: agent })
      }
    }
  } finally {
    try { await client.close() } catch { /* already closed */ }
  }

  if (logs.length) { const { error } = await db.from('email_logs').insert(logs); if (error) console.error('email_logs', error) }
  if (contacts.length) { const { error } = await db.from('contact_logs').insert(contacts); if (error) console.error('contact_logs', error) }
  return json({ results, sent: results.filter(r => r.status === 'sent').length, hourly_limit: limit, room_left: room })
})
