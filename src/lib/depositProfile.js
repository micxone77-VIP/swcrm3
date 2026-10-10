// src/lib/depositProfile.js — shared helpers for deposit behaviour (充值画像)
// Data source: Supabase views v_vip_deposit_profile / v_vip_deposit_monthly / v_vip_deposit_heatmap
// (built from vip_deposit_logs). Times are BO local time; day_of_week 0 = Monday.

export const SEGMENTS = {
  Silent:    { color: '#f87171', bg: 'rgba(248,113,113,.14)', icon: '🔕', zh: '沉默',  desc: 'No deposit for 14+ days', descZh: '超过14天未存款' },
  Declining: { color: '#fbbf24', bg: 'rgba(251,191,36,.14)',  icon: '📉', zh: '下滑',  desc: 'Last 30 days < 60% of normal', descZh: '近30天低于平常的60%' },
  Growing:   { color: '#34d399', bg: 'rgba(52,211,153,.14)',  icon: '📈', zh: '增长',  desc: 'Last 30 days > 140% of normal', descZh: '近30天高于平常的140%' },
  Stable:    { color: '#22d3ee', bg: 'rgba(34,211,238,.14)',  icon: '➖', zh: '稳定',  desc: 'Within normal range', descZh: '在正常范围内' },
  New:       { color: '#a78bfa', bg: 'rgba(167,139,250,.14)', icon: '🆕', zh: '新进',  desc: 'First deposit in last 60 days', descZh: '近60天内首次存款' },
}

export const STYLES = {
  'Big ticket':       { icon: '💰', zh: '大额型' },
  'Small & frequent': { icon: '🔁', zh: '小额高频' },
  'Regular':          { icon: '💳', zh: '常规型' },
}

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const DAY_NAMES_ZH = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const DAY_ZH = { Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六', Sun: '周日', Monday: '周一', Tuesday: '周二', Wednesday: '周三', Thursday: '周四', Friday: '周五', Saturday: '周六', Sunday: '周日' }
export function dayNameZh(d) { return DAY_ZH[d] || d }

export function fmtHour(h, lang = 'en') {
  if (h === null || h === undefined) return '—'
  const n = Number(h)
  if (lang === 'zh') return `${n}点`
  const suffix = n < 12 ? 'am' : 'pm'
  const h12 = n % 12 === 0 ? 12 : n % 12
  return `${h12}${suffix}`
}

export function fmtRM(n) {
  const v = Number(n || 0)
  return 'RM ' + v.toLocaleString('en-MY', { maximumFractionDigits: 0 })
}

// One-line host hint, e.g. "Usually deposits Wed ~8pm · every 1.3 days · 5 days overdue"
export function contactHint(p, lang = 'en') {
  if (!p) return ''
  const parts = []
  if (lang === 'zh') {
    if (p.peak_day_name) parts.push(`通常在${dayNameZh(p.peak_day_name)} ~${fmtHour(p.peak_hour, 'zh')}存款`)
    if (p.avg_gap_days) parts.push(`每${Number(p.avg_gap_days)}天一次`)
    const od = Number(p.overdue_ratio || 0)
    const sn = Number(p.days_since_last || 0)
    if (od >= 2 && sn > 0) parts.push(`⚠️ 距上次存款已${sn}天（平常间隔的${od}倍）`)
    else if (sn > 0) parts.push(`上次存款于${sn}天前`)
    else parts.push('最新数据日有存款')
    return parts.join(' · ')
  }
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
