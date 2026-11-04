// Supabase Edge Function: kpi-feed
// Read-only link for the other hub: GET ?month=YYYY-MM with the hub's key. Guide: docs/claude/kpi-feed-api.md
// No login, so verify_jwt is off and the key is checked here. Only the key's hash is stored (kpi_feed_settings).
// The first fetch after a new daily import calculates the month and saves it; later fetches return the saved copy.
// The hub gets the final score + the 4 KPI totals, in the format its team asked for. No player names or lists.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildPayload } from './kpi.ts'

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key, authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })
// deno-lint-ignore no-explicit-any
const answer = (month: string, payload: any, calculatedAt: string) => reply(200, { ok: true, month, score: payload.score.value, updated_at: new Date(calculatedAt).toISOString(), is_complete: payload.score.complete, month_status: payload.month_status, data_through: payload.data_date, items: payload.items ?? [] })

async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'GET') return reply(405, { ok: false, error: 'method' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: settings, error: settingsErr } = await db.from('kpi_feed_settings').select('api_key_hash').single()
  if (settingsErr) { console.error('settings', settingsErr.message); return reply(500, { ok: false, error: 'server' }) }
  const sent = req.headers.get('x-api-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!sent || !settings.api_key_hash || await sha256(sent) !== settings.api_key_hash) return reply(401, { ok: false, error: 'unauthorized' })

  const read = (ascending: boolean) => db.from('vip_daily_snapshots').select('snapshot_date').order('snapshot_date', { ascending }).limit(1)
  const [first, last] = await Promise.all([read(true), read(false)])
  const firstDate = first.data?.[0]?.snapshot_date, dataDate = last.data?.[0]?.snapshot_date
  if (first.error || last.error || !firstDate || !dataDate) { console.error('dates', first.error?.message, last.error?.message); return reply(503, { ok: false, error: 'no_data' }) }

  const month = new URL(req.url).searchParams.get('month') || String(dataDate).slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply(400, { ok: false, error: 'month_format', expected: 'YYYY-MM' })
  if (month < String(firstDate).slice(0, 7) || month > String(dataDate).slice(0, 7)) return reply(404, { ok: false, error: 'no_data_for_month' })

  EdgeRuntime.waitUntil(db.from('kpi_feed_settings').update({ last_fetched_at: new Date().toISOString() }).eq('id', 1).then(({ error }) => { if (error) console.error('last_fetched', error.message) }))

  const { data: saved, error: savedErr } = await db.from('kpi_feed_snapshots').select('data_date,payload,calculated_at').eq('month', month).maybeSingle()
  if (savedErr) console.error('saved', savedErr.message)
  if (saved && saved.data_date === dataDate && saved.payload?.items) return answer(month, saved.payload, saved.calculated_at)

  try {
    const payload = await buildPayload(db, month, dataDate)
    const calculatedAt = new Date().toISOString()
    const { error } = await db.from('kpi_feed_snapshots').upsert({ month, data_date: dataDate, payload, calculated_at: calculatedAt })
    if (error) console.error('save', error.message)
    return answer(month, payload, calculatedAt)
  } catch (e) {
    console.error('calculate', String(e))
    // Better the last saved score than nothing: updated_at shows how old it is
    if (saved) return answer(month, saved.payload, saved.calculated_at)
    return reply(503, { ok: false, error: 'calculation_failed' })
  }
})
