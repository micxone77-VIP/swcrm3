// src/lib/cashVoucherImport.js — import the "SureWin VIP Cash Voucher Claim Submission Form" (Google Form CSV)
// • One row per claim → cash_voucher_claims (dedupe on username + timestamp, so re-uploading the same file is safe)
// • IC number: only the last 4 characters are kept. Long digit runs in remarks (bank acc no.) are masked to ****1234
// • Accepted claims are also counted as Department Spending (category "Cash Voucher") unless the same
//   VIP + month + amount was already entered by hand
// • Fills EMPTY VIP fields only (phone, address, full name) — never overwrites
import { supabase } from './supabase'
import { fetchAll } from './depositProfile'

// Minimal CSV parser (handles quotes, commas and line breaks inside quotes)
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(v => String(v).trim() !== ''))
}

const COLS = {
  ts: /timestamp/i, user: /username/i, name: /full\s*name/i, addr: /address/i, ic: /identity|ic\s*number/i,
  wa: /what\s*s?\s*a?pps?|whatapps/i, amount: /claim\s*amount|申请金额/i, receipt: /receipt|收据/i, remark: /remark/i,
  sat: /satisfied/i, rec: /recommend/i, fb: /feedback/i, tp: /trust\s*pilot/i, photo: /item\s*photo|战利品/i, done: /prove|proof|complete/i,
}

function parseTs(v) {
  // Google Form export: M/D/YYYY H:mm:ss (Malaysia time)
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const [, mo, d, y, h, mi, se] = m
  const p = n => String(n).padStart(2, '0')
  return { iso: `${y}-${p(mo)}-${p(d)}T${p(h)}:${mi}:${p(se || 0)}+08:00`, month: `${y}-${p(mo)}` }
}
const url = v => { const t = String(v || '').trim(); return t || null }
const maskDigits = t => (String(t || '').replace(/\d{8,}/g, m => '****' + m.slice(-4)).trim() || null)
const intOrNull = v => (/^\d+$/.test(String(v || '').trim()) ? parseInt(v, 10) : null)
function normPhone(raw, currency) {
  let d = String(raw || '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('60') || d.startsWith('65')) return d
  if (d.startsWith('0')) return '6' + d                       // 01x… → 601x…
  if (d.length === 8 && currency === 'SGD') return '65' + d   // SG local 8 digits
  if (d.startsWith('1') && d.length >= 9) return '60' + d     // MY number without leading 0
  return d
}

export async function importCashVoucherCsv(text, { userId, onProgress } = {}) {
  const say = m => onProgress && onProgress(m)
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('File is empty')
  const head = rows[0].map(h => String(h).trim())
  const idx = {}
  Object.entries(COLS).forEach(([k, re]) => { idx[k] = head.findIndex(h => re.test(h)) })
  // "photo" must not grab the Trustpilot column
  if (idx.photo === idx.tp) idx.photo = head.findIndex((h, i) => i !== idx.tp && /photo/i.test(h))
  if (idx.ts < 0 || idx.user < 0 || idx.amount < 0) throw new Error('Not a Cash Voucher form file (need Timestamp, Username and Claim Amount columns)')
  const get = (r, k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '')

  say('Loading VIPs…')
  const members = await fetchAll(() => supabase.from('vip_members').select('id, username, full_name, currency, phone, address').order('username'))
  const mem = {}; members.forEach(m => { mem[String(m.username).toLowerCase()] = m })

  const parsed = [], unknown = [], bad = []
  const seen = new Set()
  rows.slice(1).forEach((r, i) => {
    const u = get(r, 'user'); const t = parseTs(get(r, 'ts'))
    if (!u && !t) return
    if (!u || !t) { bad.push(i + 2); return }
    const m = mem[u.toLowerCase()]
    if (!m) { unknown.push(u); return }
    const key = m.username + '|' + t.iso
    if (seen.has(key)) return
    seen.add(key)
    const amt = parseFloat(get(r, 'amount').replace(/[^\d.]/g, '')) || 0
    const done = get(r, 'done').toLowerCase()
    const ic = get(r, 'ic').replace(/[^0-9A-Za-z]/g, '')
    parsed.push({
      claimed_at: t.iso, claim_month: t.month, username: m.username, vip_id: m.id, currency: m.currency || 'MYR',
      full_name: get(r, 'name') || null, amount: amt,
      status: done === 'accept' || done === 'accepted' ? 'accepted' : done === 'decline' || done === 'declined' ? 'declined' : 'pending',
      ic_last4: ic ? ic.slice(-4) : null, whatsapp: get(r, 'wa').replace(/\D/g, '') || null,
      receipt_url: url(get(r, 'receipt')), trustpilot_url: url(get(r, 'tp')), item_photo_url: url(get(r, 'photo')),
      remark: maskDigits(get(r, 'remark')), satisfaction: intOrNull(get(r, 'sat')), recommend_score: intOrNull(get(r, 'rec')),
      feedback: get(r, 'fb') || null, source: 'google_form',
      _addr: get(r, 'addr'),
    })
  })

  say(`Saving ${parsed.length} claims…`)
  const existing = await fetchAll(() => supabase.from('cash_voucher_claims').select('id, username, claimed_at, status, expense_id').order('claimed_at'))
  const exKey = new Set(existing.map(e => e.username + '|' + new Date(e.claimed_at).toISOString()))
  const toInsert = parsed.filter(p => !exKey.has(p.username + '|' + new Date(p.claimed_at).toISOString()))
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100).map(({ _addr, ...rest }) => rest)
    const { data, error } = await supabase.from('cash_voucher_claims').upsert(chunk, { onConflict: 'username,claimed_at', ignoreDuplicates: true }).select('id')
    if (error) throw error
    inserted += (data || []).length
  }
  // Status changes on rows already imported (e.g. pending → accept)
  const exMap = {}; existing.forEach(e => { exMap[e.username + '|' + new Date(e.claimed_at).toISOString()] = e })
  let statusUpdated = 0
  for (const p of parsed) {
    const e = exMap[p.username + '|' + new Date(p.claimed_at).toISOString()]
    if (e && e.status !== p.status) {
      await supabase.from('cash_voucher_claims').update({ status: p.status }).eq('id', e.id)
      statusUpdated++
    }
  }

  // ── Accepted claims → Department Spending ──
  say('Linking accepted claims to Dept Spending…')
  const claims = await fetchAll(() => supabase.from('cash_voucher_claims').select('id, username, claim_month, amount, currency, status, expense_id, claimed_at').eq('status', 'accepted').is('expense_id', null).order('claimed_at'))
  let expensesAdded = 0, expensesLinked = 0
  if (claims.length) {
    const months = [...new Set(claims.map(c => c.claim_month))]
    const { data: exps } = await supabase.from('department_expenses').select('id, month, vip_username, amount').in('month', months).not('vip_username', 'is', null)
    const { data: usedRows } = await supabase.from('cash_voucher_claims').select('expense_id').not('expense_id', 'is', null)
    const used = new Set((usedRows || []).map(r => r.expense_id))
    for (const c of claims) {
      const match = (exps || []).find(e => !used.has(e.id) && e.month === c.claim_month && String(e.vip_username).toLowerCase() === c.username.toLowerCase() && Math.abs(Number(e.amount) - Number(c.amount)) < 0.01)
      let expId = match?.id
      if (expId) { expensesLinked++ } else {
        const { data: ins, error } = await supabase.from('department_expenses').insert({
          month: c.claim_month, category: 'Cash Voucher', item_name: 'Cash Voucher (form claim)',
          platform: c.currency === 'SGD' ? 'SG' : c.currency === 'KHUSD' ? 'KH' : 'MY', currency: c.currency || 'MYR',
          amount: Number(c.amount) || 0, expense_type: 'online', notes: `Cash Voucher claim ${String(c.claimed_at).slice(0, 10)}`,
          vip_username: c.username, created_by: userId || null,
        }).select('id').single()
        if (error) throw error
        expId = ins.id; expensesAdded++
      }
      used.add(expId)
      await supabase.from('cash_voucher_claims').update({ expense_id: expId }).eq('id', c.id)
    }
  }

  // ── Fill empty VIP profile fields (latest claim wins) ──
  say('Filling empty VIP details…')
  const latest = {}
  parsed.forEach(p => { if (!latest[p.username] || p.claimed_at > latest[p.username].claimed_at) latest[p.username] = p })
  let profilesFilled = 0
  for (const p of Object.values(latest)) {
    const m = mem[p.username.toLowerCase()]; const upd = {}
    if (!String(m.phone || '').trim() && p.whatsapp) upd.phone = normPhone(p.whatsapp, m.currency)
    if (!String(m.address || '').trim() && p._addr && p._addr.length > 8) upd.address = p._addr
    if ((!String(m.full_name || '').trim() || m.full_name === '(Name)') && p.full_name) upd.full_name = p.full_name
    if (Object.keys(upd).length) {
      const { error } = await supabase.from('vip_members').update(upd).eq('id', m.id)
      if (!error) profilesFilled++
    }
  }

  return { total: parsed.length, inserted, skipped: parsed.length - toInsert.length, statusUpdated, expensesAdded, expensesLinked, profilesFilled, unknown: [...new Set(unknown)], badRows: bad }
}
