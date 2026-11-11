// Supabase Edge Function: email-unsubscribe (2026-11-10), public (no login)
// The link in every CRM email: ?e=<base64url email>&t=<HMAC>. Valid link → the address goes into
// email_unsubscribes and send-email never mails it again. GET shows a page, POST is the one-click
// unsubscribe that Gmail / Outlook use (List-Unsubscribe-Post).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

async function token(email: string, key: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(email.toLowerCase()))
  return [...new Uint8Array(sig)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('')
}
const fromB64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))

const page = (title: string, msg: string, status = 200) => new Response(
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>`
  + `<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:40px 16px"><div style="max-width:440px;margin:auto;background:#fff;border-radius:10px;padding:28px;text-align:center">`
  + `<h2 style="margin:0 0 12px">${title}</h2><p style="color:#555;line-height:1.5;margin:0">${msg}</p></div></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

Deno.serve(async (req: Request) => {
  const u = new URL(req.url)
  let email = ''
  try { email = fromB64url(u.searchParams.get('e') || '').trim().toLowerCase() } catch { email = '' }
  const t = u.searchParams.get('t') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (!email || !t || t !== await token(email, serviceKey)) return page('Link not valid', 'This unsubscribe link is not valid. Please reply to the email and we will remove you.', 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: m } = await db.from('vip_members_all').select('username').ilike('email', email).limit(1).maybeSingle()
  const { error } = await db.from('email_unsubscribes').upsert({ email, username: m?.username || null }, { onConflict: 'email' })
  if (error) { console.error(error); return page('Something went wrong', 'Please try again later, or reply to the email and we will remove you.', 500) }
  if (req.method === 'POST') return new Response('ok')
  return page('You are unsubscribed', 'You will not get emails from the sureWin VIP department any more. 您已取消订阅，不会再收到 sureWin VIP 部门的邮件。')
})
