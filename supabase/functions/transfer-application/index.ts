// Supabase Edge Function: transfer-application
// Public endpoint for the standalone VIP Transfer site (no login, so verify_jwt is off and everything is validated here).
// Saves the application and screenshots in the CRM first, then copies the answers to Google Sheet + email in the background.
// Replies must never name the CRM's address: the CRM link below only goes to the private Sheet + email webhook.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PUBLIC_SITE = 'https://surewin-vip-transfer.pages.dev'
const CRM_URL = 'https://swcrmv3.pages.dev/transfer?tab=applications&app='
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_PER_HOUR = 5
const LIMITS: Record<string, number> = {
  full_name: 120, contact_number: 40, whatsapp_number: 40, email: 160, platform_name: 120, platform_link: 300,
  current_tier: 40, current_tier_other: 80, avg_deposit: 60, avg_withdrawal: 60, why_us: 3000, has_account: 3, member_id: 80, preferred_tier: 40,
}
const REQUIRED = ['full_name', 'contact_number', 'whatsapp_number', 'email', 'platform_name', 'platform_link', 'current_tier', 'avg_deposit', 'why_us', 'has_account', 'preferred_tier']
const CURRENT_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Black / Supreme', 'Other']
const WANTED_TIERS = ['Silver', 'Gold', 'Platinum', 'Diamond', 'Black']
const PROOFS = ['proof_tier', 'proof_activity', 'proof_identity']
const REQUIRED_PROOFS = ['proof_activity', 'proof_identity']

function cors(_req: Request) {
  return {
    'Access-Control-Allow-Origin': PUBLIC_SITE,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

// Trust the file's real first bytes, not the name or type the browser sent.
function sniff(b: Uint8Array): { type: string; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return { type: 'image/png', ext: 'png' }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' }
  if (ascii(0, 5) === '%PDF-') return { type: 'application/pdf', ext: 'pdf' }
  if (ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'hevc'].includes(ascii(8, 12))) return { type: 'image/heic', ext: 'heic' }
  return null
}

async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' }
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method' })

  let form: FormData
  try { form = await req.formData() } catch { return reply(400, { ok: false, error: 'form' }) }

  // Bot trap: pretend it worked and store nothing.
  if (String(form.get('website') || '')) return reply(200, { ok: true })

  const a: Record<string, string> = {}
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = form.get(key)
    a[key] = typeof value === 'string' ? value.trim() : ''
    if (a[key].length > max) return reply(400, { ok: false, error: 'too_long', field: key })
  }
  for (const key of REQUIRED) if (!a[key]) return reply(400, { ok: false, error: 'required', field: key })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) return reply(400, { ok: false, error: 'email' })
  for (const key of ['contact_number', 'whatsapp_number']) {
    if (!/^[+\d\s()-]+$/.test(a[key]) || a[key].replace(/\D/g, '').length < 8) return reply(400, { ok: false, error: 'phone', field: key })
  }
  if (!CURRENT_TIERS.includes(a.current_tier) || !WANTED_TIERS.includes(a.preferred_tier) || !['Yes', 'No'].includes(a.has_account)) return reply(400, { ok: false, error: 'choice' })
  if (a.current_tier === 'Other' && !a.current_tier_other) return reply(400, { ok: false, error: 'required', field: 'current_tier_other' })
  if (form.get('acknowledge') !== 'on') return reply(400, { ok: false, error: 'acknowledge' })

  const uploads: Record<string, { bytes: Uint8Array; type: string; ext: string }> = {}
  for (const key of PROOFS) {
    const file = form.get(key)
    if (!(file instanceof File) || file.size === 0) {
      if (REQUIRED_PROOFS.includes(key)) return reply(400, { ok: false, error: 'file_required', field: key })
      continue
    }
    if (file.size > MAX_FILE_BYTES) return reply(413, { ok: false, error: 'file_size', field: key })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const kind = sniff(bytes)
    if (!kind) return reply(400, { ok: false, error: 'file_type', field: key })
    uploads[key] = { bytes, ...kind }
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: settings, error: settingsErr } = await db.from('transfer_application_settings').select('webhook_url, webhook_secret').single()
  if (settingsErr) { console.error('settings', settingsErr.message); return reply(500, { ok: false, error: 'server' }) }

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  const ipHash = await sha256(`${settings.webhook_secret}:${ip}`)
  const since = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await db.from('transfer_applications').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since)
  if ((count || 0) >= MAX_PER_HOUR) return reply(429, { ok: false, error: 'rate_limit' })

  const id = crypto.randomUUID()
  const paths: Record<string, string> = {}
  const removeUploads = () => db.storage.from('transfer-proofs').remove(Object.values(paths))
  for (const [key, up] of Object.entries(uploads)) {
    const path = `${id}/${key}.${up.ext}`
    const { error } = await db.storage.from('transfer-proofs').upload(path, up.bytes, { contentType: up.type })
    if (error) { console.error('upload', error.message); await removeUploads(); return reply(500, { ok: false, error: 'server' }) }
    paths[key] = path
  }

  const currentTier = a.current_tier === 'Other' ? `Other: ${a.current_tier_other}` : a.current_tier
  const createdAt = new Date().toISOString()
  const { error: insertErr } = await db.from('transfer_applications').insert({
    id, created_at: createdAt, full_name: a.full_name, contact_number: a.contact_number, whatsapp_number: a.whatsapp_number, email: a.email,
    platform_name: a.platform_name, platform_link: a.platform_link, current_tier: currentTier, avg_deposit: a.avg_deposit,
    avg_withdrawal: a.avg_withdrawal || null, why_us: a.why_us, has_account: a.has_account === 'Yes',
    member_id: a.has_account === 'Yes' ? (a.member_id || null) : null, preferred_tier: a.preferred_tier, acknowledged_at: createdAt,
    proof_tier_path: paths.proof_tier || null, proof_activity_path: paths.proof_activity, proof_identity_path: paths.proof_identity,
    lang: form.get('lang') === 'zh' ? 'zh' : 'en', ip_hash: ipHash,
  })
  if (insertErr) { console.error('insert', insertErr.message); await removeUploads(); return reply(500, { ok: false, error: 'server' }) }

  // The application is safe in the CRM now. Sheet + email run after the reply so the applicant does not wait.
  const notify = async () => {
    if (!settings.webhook_url) { await db.from('transfer_applications').update({ sync_error: 'Google Sheet not connected yet' }).eq('id', id); return }
    try {
      const res = await fetch(settings.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          secret: settings.webhook_secret, id, created_at: createdAt, crm_link: CRM_URL + id, full_name: a.full_name, contact_number: a.contact_number,
          whatsapp_number: a.whatsapp_number, email: a.email, platform_name: a.platform_name, platform_link: a.platform_link, current_tier: currentTier,
          avg_deposit: a.avg_deposit, avg_withdrawal: a.avg_withdrawal, why_us: a.why_us, has_account: a.has_account, member_id: a.member_id, preferred_tier: a.preferred_tier,
        }),
        signal: AbortSignal.timeout(30000),
      })
      const out = await res.json()
      if (!out.ok) throw new Error(String(out.error || 'rejected'))
      await db.from('transfer_applications').update({ sheet_synced_at: new Date().toISOString(), sync_error: null }).eq('id', id)
    } catch (e) {
      console.error('notify', String(e))
      await db.from('transfer_applications').update({ sync_error: String(e).slice(0, 300) }).eq('id', id)
    }
  }
  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(notify())

  return reply(200, { ok: true })
})
