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

// sureWin email signature (same design as the webmail one, C:\Project\sureWin Email\signature.html).
// The name is the sending agent; the WhatsApp number is the one picked in the email box (default: VIP main line).
// Email / links are the VIP department's. Emoji as HTML entities.
const MAIN_WA = '601155715603', SIG_MAIL = 'vip@surewinworld.com', SIG_WEB = 'https://www.swvip01.com/'
const fmtWa = (d: string) => {
  if (d.startsWith('60') && d.length >= 10) { const a = d.slice(2, 4), r = d.slice(4); return `+60 ${a}-${r.slice(0, r.length - 4)} ${r.slice(-4)}` }
  if (d.startsWith('65') && d.length === 10) return `+65 ${d.slice(2, 6)} ${d.slice(6)}`
  return `+${d}`
}
// Green WhatsApp button (text + colour only, shows in every mail app without loading images)
const waButton = (d: string) => `<a href="https://wa.me/${d}" style="display:inline-block;padding:6px 14px;background-color:#25D366;border-radius:16px;color:#ffffff;font-weight:bold;font-size:13px;line-height:18px;text-decoration:none;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;">&#128172; WhatsApp ${fmtWa(d)}</a>`
const signatureHtml = (name: string, wa: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#0f1a33" style="width:100%;max-width:480px;border-collapse:separate;background-color:#0f1a33;background-image:linear-gradient(135deg,#1d3157 0%,#0f1a33 60%,#0a1226 100%);border-radius:12px;font-family:Arial,Helvetica,sans-serif;">
  <tr><td colspan="2" height="4" bgcolor="#fc7100" style="height:4px;background-color:#fc7100;background-image:linear-gradient(90deg,#fc7100 0%,#ffb217 50%,#fc7100 100%);border-radius:12px 12px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr>
    <td width="92" valign="top" style="width:92px;padding:18px 0 14px 14px;"><a href="${SIG_WEB}" style="text-decoration:none;"><img src="https://surewin-vip-transfer.pages.dev/logo.png" width="76" height="76" alt="sureWin" style="display:block;width:76px;height:76px;border:2px solid #fc7100;border-radius:50%;color:#ffffff;font-size:14px;font-weight:bold;"></a></td>
    <td valign="top" style="padding:16px 12px 14px 12px;">
      <div style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:30px;font-weight:bold;color:#ffffff;">${esc(name)}</div>
      <div style="margin:0;padding:0 0 10px 0;font-size:11px;line-height:16px;font-weight:bold;letter-spacing:2px;color:#ffb217;white-space:nowrap;">SUREWIN VIP TEAM</div>
      <div style="margin:0;padding:10px 0 0 0;border-top:1px solid #33456b;font-size:13px;line-height:22px;color:#ffffff;white-space:nowrap;"><a href="https://wa.me/${wa}" style="display:inline-block;padding:0 10px;background-color:#25D366;border-radius:11px;color:#ffffff;font-weight:bold;text-decoration:none;">&#128172; WhatsApp&nbsp; ${fmtWa(wa)}</a></div>
      <div style="margin:0;font-size:13px;line-height:22px;color:#ffffff;white-space:nowrap;">&#9993;&#65039;&nbsp; <a href="mailto:${SIG_MAIL}" style="color:#ffffff;text-decoration:none;">${SIG_MAIL}</a></div>
      <div style="margin:0 0 12px 0;font-size:13px;line-height:22px;color:#ffffff;white-space:nowrap;">&#127760;&nbsp; <a href="${SIG_WEB}" style="color:#ffffff;text-decoration:none;">www.swvip01.com</a></div>
      <div style="margin:0;font-size:12px;line-height:30px;"><a href="https://t.me/+UjqC9MIlNEM5NTk1" style="display:inline-block;padding:0 13px;margin:0 6px 6px 0;background-color:#229ED9;border-radius:15px;color:#ffffff;font-weight:bold;text-decoration:none;white-space:nowrap;">&#10148; Sports VIP Telegram</a><a href="https://t.me/surewinmy" style="display:inline-block;padding:0 13px;margin:0 0 6px 0;background-color:#229ED9;border-radius:15px;color:#ffffff;font-weight:bold;text-decoration:none;white-space:nowrap;">&#10148; sureWin Telegram</a></div>
    </td>
  </tr>
  <tr><td colspan="2" align="center" bgcolor="#0a1226" style="padding:8px 12px;background-color:#0a1226;border-radius:0 0 12px 12px;font-family:Georgia,'Times New Roman',serif;font-size:12px;line-height:18px;font-style:italic;color:#ffb217;">Where Winners Live Like Stars &nbsp;&#10022;&nbsp; &#36194;&#23478;&#30340;&#23562;&#36149;&#20043;&#36873;</td></tr>
</table>`

// denomailer can throw "BadResource" from the socket outside our await (seen 2026-11-12 on a 20-player
// batch): without this the whole worker dies (503) and nothing is logged.
addEventListener('unhandledrejection', (e) => { console.error('unhandled', (e as PromiseRejectionEvent).reason); e.preventDefault() })
addEventListener('error', (e) => { console.error('event loop error', (e as ErrorEvent).message); e.preventDefault() })

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

  // messages (optional): own subject / body per player, e.g. each campaign player's own campaign message
  let body: { recipients?: string[]; subject?: string; body?: string; test_to?: string; wa_number?: string; messages?: Record<string, { subject?: string; body?: string }> }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const own = (body.messages && typeof body.messages === 'object') ? body.messages : {}
  const subjectT = String(body.subject || '').trim()
  const bodyT = String(body.body || '').trim()
  if (!subjectT || (!bodyT && !Object.keys(own).length)) return json({ error: 'Subject and message are required' }, 400)
  const names = [...new Set((body.recipients || []).map(u => String(u).trim()).filter(Boolean))]
  const testTo = body.test_to ? String(body.test_to).trim() : ''
  if (testTo && !EMAIL_RE.test(testTo)) return json({ error: 'Test address is not a valid email' }, 400)
  if (!names.length) return json({ error: 'No players given' }, 400)
  if (names.length > 25) return json({ error: 'Max 25 players per call' }, 400)
  const wa = String(body.wa_number || '').replace(/\D/g, '') || MAIN_WA
  if (wa.length < 8 || wa.length > 15) return json({ error: 'WhatsApp number is not valid' }, 400)

  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const agent = String(prof.full_name || prof.username || 'VIP team').split(/\s+/)[0]

  const { data: rule } = await db.from('crm_rules').select('value').eq('rule_key', 'email_hourly_limit').maybeSingle()
  const limit = Number(rule?.value) || 100
  const { count: sentHour } = await db.from('email_logs').select('id', { count: 'exact', head: true })
    .eq('status', 'sent').gte('created_at', new Date(Date.now() - 3600_000).toISOString())
  let room = Math.max(limit - (sentHour || 0), 0)

  const { data: members, error: mErr } = await db.from('vip_members_all').select('id,username,full_name,email,tier').in('username', names)
  if (mErr) return json({ error: mErr.message }, 500)
  const byName = Object.fromEntries((members || []).map(m => [m.username, m]))
  const emails = (members || []).map(m => String(m.email || '').trim().toLowerCase()).filter(Boolean)
  const { data: unsubs } = emails.length ? await db.from('email_unsubscribes').select('email').in('email', emails) : { data: [] }
  const unsubSet = new Set((unsubs || []).map(u => u.email))

  const fill = (t: string, m: { username: string; full_name?: string | null }) =>
    t.replaceAll('{name}', (m.full_name || m.username).split(/\s+/)[0]).replaceAll('{username}', m.username).replaceAll('{agent}', agent)

  // One SMTP connection per email: reusing one connection for several emails crashed denomailer (2026-11-12)
  const newClient = () => new SMTPClient({ connection: { hostname: smtp.host!, port: smtp.port, tls: true, auth: { username: smtp.user!, password: smtp.pass! } } })
  const results: { username: string; status: string; reason?: string }[] = []
  const logs: Record<string, unknown>[] = []
  const contacts: Record<string, unknown>[] = []
  const myt = new Date(Date.now() + 8 * 3600_000)

  // Logs are saved right after each email, so a crash later in the batch never loses what was already sent
  const flush = async () => {
    if (logs.length) { const { error } = await db.from('email_logs').insert(logs.splice(0)); if (error) console.error('email_logs', error) }
    if (contacts.length) { const { error } = await db.from('contact_logs').insert(contacts.splice(0)); if (error) console.error('contact_logs', error) }
  }

  {
    for (const u of names) {
      const m = byName[u]
      const to = testTo || String(m?.email || '').trim()
      const skip = (reason: string) => { results.push({ username: u, status: 'skipped', reason }); logs.push({ username: u, to_email: to || null, subject: subjectT, status: 'skipped', reason, sent_by: prof.id, sender_name: agent }) }
      if (!m) { skip('player not found'); continue }
      if (!EMAIL_RE.test(to)) { skip('no valid email'); continue }
      if (!testTo && unsubSet.has(to.toLowerCase())) { skip('unsubscribed'); continue }
      if (room <= 0) { skip(`hourly limit (${limit}) reached`); continue }
      const ownBody = String(own[u]?.body || '').trim()
      if (!ownBody && !bodyT) { skip('no message for this player'); continue }

      const subject = fill(String(own[u]?.subject || '').trim() || subjectT, m)
      const filled = fill(ownBody || bodyT, m)
      const text = filled.replaceAll('{whatsapp}', `WhatsApp ${fmtWa(wa)}: https://wa.me/${wa}`)
      const unsubUrl = `${url}/functions/v1/email-unsubscribe?e=${b64url(to.toLowerCase())}&t=${await unsubToken(to, serviceKey)}`
      const footerText = `\n\n--\n${agent} · sureWin VIP Team\nWhatsApp ${fmtWa(wa)} (https://wa.me/${wa}) · ${SIG_MAIL} · www.swvip01.com\nDon't want these emails? Unsubscribe: ${unsubUrl}`
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">${esc(filled).replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '<b>$1</b>').replace(/\n/g, '<br>').replaceAll('{whatsapp}', `<span style="display:inline-block;margin-top:6px">${waButton(wa)}</span>`)}`
        + `<div style="margin:24px 0 0">${signatureHtml(agent, wa)}</div>`
        + `<div style="font-size:11px;color:#888;margin-top:10px">sureWin VIP department · <a href="${unsubUrl}" style="color:#888">Unsubscribe</a></div></div>`
      const client = newClient()
      try {
        await client.send({ from: smtp.from!, to, subject: testTo ? `[TEST] ${subject}` : subject, content: text + footerText, html,
          headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
        room--
        results.push({ username: u, status: 'sent' })
        logs.push({ username: u, to_email: to, subject, body: text, status: 'sent', reason: testTo ? 'test' : null, sent_by: prof.id, sender_name: agent })
        if (!testTo) contacts.push({
          // vip_id links the player (Contact Log shows the affiliate from it); notes = the full email, shown in the Notes column
          username: u, vip_id: m.id, tier: m.tier || null, channel: 'Email', notes: `📧 Email: ${subject}

${text}`, outcome: 'Contacted', direction: 'outbound', topic: 'email',
          message_summary: `Email: ${subject}`.slice(0, 500), host_name: agent, host_id: prof.id, logged_at: new Date().toISOString(),
          log_month: myt.toISOString().slice(0, 7), log_week: String(Math.ceil(myt.getUTCDate() / 7)),
        })
      } catch (e) {
        const reason = String((e as Error)?.message || e).slice(0, 300)
        results.push({ username: u, status: 'failed', reason })
        logs.push({ username: u, to_email: to, subject, status: 'failed', reason, sent_by: prof.id, sender_name: agent })
      } finally {
        try { await client.close() } catch { /* already closed */ }
      }
      await flush()
    }
  }
  await flush()
  return json({ results, sent: results.filter(r => r.status === 'sent').length, hourly_limit: limit, room_left: room })
})
