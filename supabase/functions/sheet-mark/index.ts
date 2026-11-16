// Supabase Edge Function: sheet-mark (2026-11-16)
// Passes "mark these rows as emailed" from the Email a List page to Marcus's Google Apps Script web app,
// which writes CRM Email / Emailed at / Emailed by on the right rows of the Google Sheet.
// The script link and its password (token) live in sheet_hook_settings (admins only); the browser never sees the token.
// Body: { action: 'mark', sheetId, gid, headRow, emailCol, marks: [{ row, email, status, at, by }] }
//    or { action: 'ping', sheetId?, gid? } to test the setup.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await userDb.auth.getUser()
    if (!user) return json({ ok: false, error: 'Not logged in' }, 401)
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: prof } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!['admin', 'host'].includes(String(prof?.role || ''))) return json({ ok: false, error: 'Only admin / host can mark sheets' }, 403)

    const { data: s } = await db.from('sheet_hook_settings').select('script_url, token').eq('id', true).maybeSingle()
    if (!s?.script_url) return json({ ok: false, error: 'not_set_up' })

    const body = await req.json()
    const payload = {
      token: s.token,
      action: body.action === 'ping' ? 'ping' : 'mark',
      sheetId: String(body.sheetId || ''),
      gid: String(body.gid ?? ''),
      headRow: Number(body.headRow) || 1,
      emailCol: Number(body.emailCol) || 0,
      marks: Array.isArray(body.marks) ? body.marks.slice(0, 200) : [],
    }
    const r = await fetch(s.script_url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload), redirect: 'follow' })
    const t = await r.text()
    try { return json(JSON.parse(t)) } catch { return json({ ok: false, error: `The Google script did not answer properly (HTTP ${r.status}). Check it is deployed as a Web app with access "Anyone".` }) }
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500)
  }
})
