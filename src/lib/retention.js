export function daysSince(dateValue, now = new Date()) {
  if (!dateValue) return null
  const then = new Date(dateValue)
  const current = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(then.getTime()) || Number.isNaN(current.getTime())) return null
  return Math.max(0, Math.floor((current.getTime() - then.getTime()) / 86400000))
}

export function isFollowUpDue({ lastContact, contactedToday }, now = new Date()) {
  if (contactedToday) return false
  if (!lastContact) return true
  const days = daysSince(lastContact, now)
  return days !== null && days >= 3
}

export function getRetentionPriority({ tier, churn_risk, days_inactive }) {
  const risk = String(churn_risk || '').toUpperCase()
  if (risk === 'CRITICAL') return 'CRITICAL'
  if (risk === 'HIGH') return 'HIGH'
  if (risk === 'MEDIUM') return 'MEDIUM'
  const normalizedTier = String(tier || '').toUpperCase()
  const days = Number(days_inactive) || 0
  if (['DIAMOND', 'BLACK', 'PLATINUM'].includes(normalizedTier) && days >= 14) return 'HIGH'
  if (['DIAMOND', 'BLACK', 'PLATINUM'].includes(normalizedTier) && days >= 7) return 'MEDIUM'
  return 'NORMAL'
}

export function calculateRate(numerator, denominator) {
  const n = Number(numerator) || 0
  const d = Number(denominator) || 0
  return d === 0 ? 0 : Math.round((n / d) * 100)
}

export function sumByCurrency(rows = []) {
  return rows.reduce((totals, row) => {
    const currency = String(row?.currency || '').toUpperCase()
    const amount = Number(row?.amount) || 0
    if (currency) totals[currency] = (totals[currency] || 0) + amount
    return totals
  }, {})
}

export function latestSnapshotMonth(snapshotMonths = [], currentMonth) {
  const current = String(currentMonth || '').slice(0, 7)
  const candidates = [...new Set(snapshotMonths.map(value => String(value || '').slice(0, 7)).filter(Boolean))]
    .filter(value => !current || value <= current)
    .sort()
  return candidates.at(-1) || current || null
}

export function resolveSnapshotWindow(snapshotMonths = [], selectedMonth) {
  const selected = String(selectedMonth || '').slice(0, 7)
  const available = [...new Set(snapshotMonths.map(value => String(value || '').slice(0, 7)).filter(Boolean))]
    .filter(month => !selected || month <= selected)
    .sort()
  const currentMonth = available.at(-1) || selected || null
  const previousMonth = currentMonth
    ? [...available].reverse().find(month => month < currentMonth) || null
    : null
  return {
    selectedMonth: selected || null,
    currentMonth,
    previousMonth,
    usedFallback: Boolean(selected && currentMonth && selected !== currentMonth),
  }
}
