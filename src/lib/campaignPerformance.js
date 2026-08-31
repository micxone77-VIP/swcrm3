export function resolveMetricValue(systemValue, manualOverride) {
  return manualOverride === null || manualOverride === undefined
    ? Number(systemValue || 0)
    : Number(manualOverride || 0)
}

export function rankLeaderboard(rows, topN) {
  return [...rows]
    .sort((a, b) => Number(b.turnover || 0) - Number(a.turnover || 0) || String(a.username).localeCompare(String(b.username)))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      inTop: index < Number(topN || 0),
    }))
}

export function progressPercent(value, target) {
  const n = Number(target || 0)
  return n > 0 ? Math.round((Number(value || 0) / n) * 100) : 0
}
