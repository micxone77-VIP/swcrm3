// src/lib/depositProfile.js — shared helpers for deposit behaviour (充值画像)
// Data source: Supabase views v_vip_deposit_profile / v_vip_deposit_monthly / v_vip_deposit_heatmap
// (built from vip_deposit_logs). Times are BO local time; day_of_week 0 = Monday.

export const SEGMENTS = {
  Silent:    { color: '#f87171', bg: 'rgba(248,113,113,.14)', icon: '🔕', zh: '沉默',  desc: 'No deposit for 14+ days' },
  Declining: { color: '#fbbf24', bg: 'rgba(251,191,36,.14)',  icon: '📉', zh: '下滑',  desc: 'Last 30 days < 60% of normal' },
  Growing:   { color: '#34d399', bg: 'rgba(52,211,153,.14)',  icon: '📈', zh: '增长',  desc: 'Last 30 days > 140% of normal' },
  Stable:    { color: '#22d3ee', bg: 'rgba(34,211,238,.14)',  icon: '➖', zh: '稳定',  desc: 'Within normal range' },
  New:       { color: '#a78bfa', bg: 'rgba(167,139,250,.14)', icon: '🆕', zh: '新进',  desc: 'First deposit in last 60 days' },
}

export const STYLES = {
  'Big ticket':       { icon: '💰', zh: '大额型' },
  'Small & frequent': { icon: '🔁', zh: '小额高频' },
  'Regular':          { icon: '💳', zh: '常规型' },
}

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function fmtHour(h) {
  if (h === null || h === undefined) return '—'
  const n = Number(h)
  const suffix = n < 12 ? 'am' : 'pm'
  const h12 = n % 12 === 0 ? 12 : n % 12
  return `${h12}${suffix}`
}

export function fmtRM(n) {
  const v = Number(n || 0)
  return 'RM ' + v.toLocaleString('en-MY', { maximumFractionDigits: 0 })
}

// One-line host hint, e.g. "Usually deposits Wed ~8pm · every 1.3 days · 5 days overdue"
export function contactHint(p) {
  if (!p) return ''
  const parts = []
  if (p.peak_day_name) parts.push(`Usually deposits ${p.peak_day_name} ~${fmtHour(p.peak_hour)}`)
  if (p.avg_gap_days) parts.push(`every ${Number(p.avg_gap_days)} day${Number(p.avg_gap_days) === 1 ? '' : 's'}`)
  const overdue = Number(p.overdue_ratio || 0)
  const since = Number(p.days_since_last || 0)
  if (overdue >= 2 && since > 0) parts.push(`⚠️ ${since} days since last deposit (${overdue}× usual gap)`)
  else if (since > 0) parts.push(`last deposit ${since} day${since === 1 ? '' : 's'} ago`)
  else parts.push('deposited on latest data day')
  return parts.join(' · ')
}

// Supabase caps at 1000 rows — always page through.
export async function fetchAll(query, pageSize = 1000) {
  let from = 0
  const out = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await query().range(from, from + pageSize - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return out
}
