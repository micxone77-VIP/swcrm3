// src/lib/vipBonus.js — BO "Bonus" transactions pasted per VIP → vip_bonus_txns
// Counted as Department Spending (online). Dedupe key = BO transaction ID, so pasting the same rows again is safe.
// Expected BO row (tab or space separated):
//   ID  Created  Processed  Type  Description  Username  Amount  (x)  BalanceBefore  BalanceAfter
//   5963445898  2026-10-13 01:31:06  2026-10-13 01:31:06  Bonus  AngPow (100 Game Credit)  mralien23  100.00  0  18.73  118.73

export const BONUS_CATS = {
  'Campaign':      { icon: '🎯', color: '#f97316', zh: '活动奖励' },
  'Birthday':      { icon: '🎂', color: '#ec4899', zh: '生日红包' },
  'Manual AngPow': { icon: '🧧', color: '#ef4444', zh: '手动红包' },
  'Check-in':      { icon: '📅', color: '#22c55e', zh: '签到红包' },
  'AngPow Rain':   { icon: '🌧️', color: '#38bdf8', zh: '红包雨' },
  'Other':         { icon: '🎁', color: '#a78bfa', zh: '其他' },
}

const n = v => { const x = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : null }

export function classifyBonus(desc) {
  const d = String(desc || '').toLowerCase()
  if (/birthday|生日/.test(d)) return 'Birthday'
  if (/angpow\s*rain|红包雨/.test(d)) return 'AngPow Rain'
  if (/check\s*-?\s*in|stamp|签到/.test(d)) return 'Check-in'
  if (/festival|daily deposit|campaign|power\s*play|rush|challenge|milestone|promo|event|tournament|lucky|活动/.test(d)) return 'Campaign'
  if (/\d[\d,]*\s*game\s*credit/.test(d)) return 'Manual AngPow'
  return 'Other'
}

export function cleanBonusName(desc) {
  let s = String(desc || '').replace(/\(\s*locked:[^)]*\)/ig, '').trim()
  const m = s.match(/^ang\s*pow\s*\((.*)\)\s*$/i)
  if (m) s = m[1].trim()
  return s || String(desc || '').trim()
}

const TS = '(\\d{4}-\\d{2}-\\d{2}[ T]\\d{1,2}:\\d{2}(?::\\d{2})?)'
const NUM = '(-?[\\d,]+(?:\\.\\d+)?)'
const LINE_RE = new RegExp(`^\\s*(\\d{5,})\\s+${TS}\\s+(?:${TS}\\s+)?(\\S+)\\s+(.+?)\\s+(\\S+)\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s*$`)

// Returns { rows, bad } — rows: parsed objects (not yet checked against DB)
export function parseBonusPaste(text) {
  const rows = [], bad = []
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/ /g, ' ').trim()
    if (!line) return
    let f = line.split('\t').map(x => x.trim())
    let rec = null
    if (f.length >= 10 && /^\d{5,}$/.test(f[0])) {
      rec = { id: f[0], ts: f[1], type: f[3], desc: f[4], user: f[5], amount: f[6], x: f[7], before: f[8], after: f[9] }
    } else {
      const m = line.match(LINE_RE)
      if (m) rec = { id: m[1], ts: m[2], type: m[4], desc: m[5], user: m[6], amount: m[7], x: m[8], before: m[9], after: m[10] }
    }
    if (!rec) { if (/\d{5,}/.test(line)) bad.push(i + 1); return }
    const ts = rec.ts.replace('T', ' ')
    const [d, t = '00:00:00'] = ts.split(' ')
    const tt = t.split(':').map(x => x.padStart(2, '0'))
    while (tt.length < 3) tt.push('00')
    const locked = (rec.desc.match(/locked:\s*([\d,.]+)/i) || [])[1]
    rows.push({
      txn_id: rec.id, username: rec.user, type: rec.type,
      txn_at: `${d}T${tt.join(':')}+08:00`, month: d.slice(0, 7),
      description: rec.desc, bonus_name: cleanBonusName(rec.desc), category: classifyBonus(rec.desc),
      amount: n(rec.amount) || 0, balance_before: n(rec.before), balance_after: n(rec.after), locked_amount: locked ? n(locked) : null,
    })
  })
  return { rows, bad }
}

export const curSym = c => (c === 'SGD' ? 'SGD ' : c === 'KHUSD' || c === 'USD' ? 'USD ' : 'RM ')
export const money2 = (v, c) => curSym(c) + Number(v || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
