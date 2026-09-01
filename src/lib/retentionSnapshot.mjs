export function normalizeMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/)
  if (!match) return ''
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : ''
}

export function resolveSnapshotWindow(snapshotMonths = [], selectedMonth) {
  const selected = normalizeMonth(selectedMonth)
  const available = [...new Set(snapshotMonths.map(normalizeMonth).filter(Boolean))]
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
