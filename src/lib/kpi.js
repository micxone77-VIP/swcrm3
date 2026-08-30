// src/lib/kpi.js
// Single source of truth for the KPI framework + how "actual" values and
// scores are calculated. KPIProgress.jsx and Dashboard.jsx both import from
// here so they can never show two different KPI numbers again.
//
// Previously Dashboard.jsx queried a table called `monthly_snapshots` for a
// completely different, older 5-KPI pass/fail concept that nothing else in
// the app wrote to. That table is no longer queried anywhere — the real KPI
// data lives in `kpi_entries` (manual items) + live queries (auto items),
// exactly as used below.

import { supabase } from './supabase'
import { formatMoney } from './format'

// source: 'auto' = calculated from DB, 'manual' = user fills in
export const KPI_FRAMEWORK = [
  {
    category: 'C', label: '整线绩效', weight: 30, color: '#06b6d4',
    items: [
      {
        key: 'reactivation_rate', label: 'VIP 挽回成功率', labelEn: 'Reactivation Success Rate',
        weight: 12, target: 30, unit: '%', source: 'auto',
        fmt: (v) => `${v}%`, icon: '🔁', desc: '目标 ≥ 30%',
      },
      {
        key: 'diamond_coverage', label: 'Diamond+ 1对1覆盖率', labelEn: 'Diamond 1:1 Coverage',
        weight: 10, target: 100, unit: '%', source: 'auto',
        fmt: (v) => `${v}%`, icon: '💎', desc: '目标 100%',
      },
      {
        key: 'campaign_output', label: 'VIP 专属活动产出', labelEn: 'Campaign Output',
        weight: 8, target: 3, unit: '个', source: 'manual',
        fmt: (v) => `${v} 个`, icon: '🎯', desc: '目标 ≥ 3个/月',
      },
    ]
  },
  {
    category: 'B', label: '业务专属', weight: 25, color: '#f59e0b',
    items: [
      {
        key: 'total_turnover', label: 'VIP 总流水', labelEn: 'Total VIP Turnover',
        weight: 22, target: 150000000, unit: 'RM', source: 'auto',
        fmt: (v) => formatMoney(v, 'MYR'),
        icon: '💰', desc: '目标 ≥ RM 1.5亿/月',
      },
      {
        key: 'retention_rate', label: 'VIP 留存率', labelEn: 'VIP Retention Rate',
        weight: 18, target: 85, unit: '%', source: 'auto',
        fmt: (v) => `${v}%`, icon: '🔄', desc: '目标 ≥ 85%',
      },
      {
        key: 'upgrade_count', label: 'VIP 升级数', labelEn: 'VIP Upgrades',
        weight: 5, target: 4, unit: '人', source: 'auto',
        fmt: (v) => `${v} 人`, icon: '⬆️', desc: '目标 ≥ 4人/月',
      },
    ]
  },
  {
    category: 'D', label: '战略协同', weight: 15, color: '#8b5cf6',
    items: [
      {
        key: 'cross_team_score', label: '跨线协同（与客服/客维）', labelEn: 'Cross-team Collaboration',
        weight: 7, target: 85, unit: '分', source: 'manual',
        fmt: (v) => `${v} 分`, icon: '🤝', desc: '目标 ≥ 85分',
      },
      {
        key: 'report_quality', label: '数据复盘与汇报质量', labelEn: 'Report Quality',
        weight: 5, target: 85, unit: '分', source: 'manual',
        fmt: (v) => `${v} 分`, icon: '📊', desc: '目标 ≥ 85分',
      },
      {
        key: 'innovation_output', label: '新策略/创新提案产出', labelEn: 'Innovation Proposals',
        weight: 3, target: 1, unit: '个', source: 'manual',
        fmt: (v) => `${v} 个`, icon: '💡', desc: '目标 ≥ 1/月',
      },
    ]
  },
  {
    category: 'A', label: '团队管理/筹建', weight: 10, color: '#10b981',
    items: [
      {
        key: 'sop_output', label: 'VIP服务SOP沉淀', labelEn: 'SOP Documentation',
        weight: 10, target: 3, unit: '项', source: 'manual',
        fmt: (v) => `${v} 项`, icon: '📋', desc: '目标 ≥ 3项/月',
      },
    ]
  },
]

export const ALL_ITEMS = KPI_FRAMEWORK.flatMap(cat =>
  cat.items.map(item => ({ ...item, category: cat.category, categoryLabel: cat.label, categoryColor: cat.color }))
)
export const TOTAL_WEIGHT = ALL_ITEMS.reduce((s, i) => s + i.weight, 0) // Should be 100

export function getScore(actual, target, weight) {
  if (!target) return 0
  const rate = Math.min(1, actual / target)
  return Math.round(rate * weight * 10) / 10
}

export function getStatusColor(actual, target) {
  if (!target) return '#8b949e'
  const pct = actual / target
  if (pct >= 1)    return '#3fb950'
  if (pct >= 0.7)  return '#d29922'
  return '#f85149'
}

// t is optional — if omitted, falls back to the original Chinese labels so any
// other callers keep working unchanged. KPIProgress.jsx passes t() from useLanguage.
export function getStatusLabel(actual, target, t) {
  if (!target) return '—'
  const pct = actual / target
  if (t) {
    if (pct >= 1)   return `✅ ${t('kpi.statusMet')}`
    if (pct >= 0.7) return `⚠ ${t('kpi.statusClose')}`
    return `❌ ${t('kpi.statusMissed')}`
  }
  if (pct >= 1)   return '✅ 达标'
  if (pct >= 0.7) return '⚠ 接近'
  return '❌ 未达'
}

// Auto-calculated KPI values for a given month (not tied to any one user).
// monthStr must be 'YYYY-MM'.
export async function loadKpiAutoData(monthStr) {
  // Total VIP turnover this month — this KPI's target (RM 150,000,000) is
  // denominated in Ringgit, i.e. MY-only by design. Previously this queried
  // .in('currency', ['MYR','SGD']) and summed both together, which silently
  // inflated the figure with SGD amounts counted as if they were RM. Scope
  // to MYR only so the number actually matches what the target measures.
  // Sourced from vip_monthly_totals (SUM of daily snapshots), since
  // vip_members.monthly_valid_bet is just the last uploaded day's number
  // now that CSV uploads happen daily.
  const { data: vips } = await supabase
    .from('vip_monthly_totals')
    .select('monthly_valid_bet, tier, currency')
    .eq('snapshot_month', monthStr)
    .eq('currency', 'MYR')
  const totalTurnover = (vips || []).reduce((s, v) => s + (parseFloat(v.monthly_valid_bet) || 0), 0)

  // Upgrade count this month
  const { count: upgradeCount } = await supabase
    .from('tier_change_logs')
    .select('id', { count: 'exact' })
    .eq('import_month', monthStr)

  // Diamond coverage — MY/SG only
  const { data: diamonds } = await supabase
    .from('vip_members')
    .select('id, username')
    .eq('tier', 'DIAMOND')
    .in('currency', ['MYR', 'SGD'])
  const diamondUsernames = new Set((diamonds || []).map(d => d.username))
  const totalDiamonds = diamondUsernames.size

  const { data: diamondLogs } = await supabase
    .from('contact_logs')
    .select('username')
    .eq('log_month', monthStr)
    .in('tier', ['DIAMOND'])
  const contactedDiamonds = new Set((diamondLogs || []).map(l => l.username)).size
  const diamondCoverage = totalDiamonds ? Math.round(contactedDiamonds / totalDiamonds * 100) : 0

  // VIP Retention Rate — % of PLATINUM/DIAMOND/BLACK VIPs (any region, excluding
  // test/staff accounts) with monthly_valid_bet > 0 this month. Deliberately based
  // on activity alone, not deposits — this reads higher than a deposit-based rate
  // by design, since it only requires having placed a bet, not a fresh deposit.
  // GOLD is intentionally excluded — this KPI tracks the top 3 tiers only.
  const TIERS = ['DIAMOND', 'PLATINUM', 'BLACK']
  const { data: excludedRows } = await supabase.from('vip_members').select('username').eq('is_excluded', true)
  const excludedSet = new Set((excludedRows || []).map(e => e.username))
  const { data: allVipTotals } = await supabase
    .from('vip_monthly_totals')
    .select('username, monthly_valid_bet')
    .eq('snapshot_month', monthStr)
    .in('tier', TIERS)
  const validVipTotals = (allVipTotals || []).filter(v => !excludedSet.has(v.username))
  const totalVipCount  = validVipTotals.length
  const activeVipCount = validVipTotals.filter(v => (parseFloat(v.monthly_valid_bet) || 0) > 0).length
  const retentionRate  = totalVipCount ? Math.round(activeVipCount / totalVipCount * 100) : 0

  // VIP Reactivation Success Rate — (Platinum+Diamond+Black VIPs reactivated this
  // month) ÷ (total Platinum+Diamond+Black VIP count, dormant or not — not just
  // those who were dormant). Excludes test/staff accounts from the denominator.
  const { count: reactivatedPD } = await supabase
    .from('reactivation_logs')
    .select('id', { count: 'exact' })
    .eq('reactivated_month', monthStr)
    .in('tier', ['PLATINUM', 'DIAMOND', 'BLACK'])
  const { data: pdMembers } = await supabase
    .from('vip_members')
    .select('username')
    .in('tier', ['PLATINUM', 'DIAMOND', 'BLACK'])
    .eq('is_excluded', false)
  const totalPDCount     = (pdMembers || []).length
  const reactivationRate = totalPDCount ? Math.round((reactivatedPD || 0) / totalPDCount * 100) : 0

  return {
    total_turnover:    totalTurnover,
    upgrade_count:     upgradeCount || 0,
    diamond_coverage:  diamondCoverage,
    retention_rate:    retentionRate,
    reactivation_rate: reactivationRate,
  }
}

// Manual KPI entries a single user filled in for a given month.
// Returns { [kpi_key]: { value, notes } }
export async function loadKpiManualData(userId, monthStr) {
  if (!userId) return {}
  const { data } = await supabase
    .from('kpi_entries')
    .select('kpi_key, value, notes')
    .eq('user_id', userId)
    .eq('month', monthStr)
  const map = {}
  ;(data || []).forEach(r => { map[r.kpi_key] = { value: r.value, notes: r.notes } })
  return map
}

// Whether a manual value/override has actually been saved for this key this
// month — distinct from getActualFromMaps' return value, since 0 is a valid
// override and shouldn't be confused with "nothing saved yet".
export function hasManualEntry(key, manualMap) {
  const entry = manualMap?.[key]
  return !!(entry && entry.value !== undefined && entry.value !== null && entry.value !== '')
}

export function getActualFromMaps(key, autoData, manualMap) {
  // A manual entry always wins if one exists for this key this month — lets a host
  // override an auto-calculated figure they believe is wrong, without losing the
  // auto-calculation as the default for every month they don't touch it.
  const manualEntry = manualMap?.[key]
  if (manualEntry && manualEntry.value !== undefined && manualEntry.value !== null && manualEntry.value !== '') {
    return parseFloat(manualEntry.value) || 0
  }
  const autoMap = {
    total_turnover:    autoData.total_turnover,
    upgrade_count:     autoData.upgrade_count,
    diamond_coverage:  autoData.diamond_coverage,
    retention_rate:    autoData.retention_rate,
    reactivation_rate: autoData.reactivation_rate,
  }
  if (autoMap[key] !== undefined) return autoMap[key] || 0
  return 0
}

export function calcTotalScoreFromMaps(autoData, manualMap) {
  return ALL_ITEMS.reduce((sum, item) => {
    const actual = getActualFromMaps(item.key, autoData, manualMap)
    return sum + getScore(actual, item.target, item.weight)
  }, 0)
}

// Convenience one-shot for pages (like Dashboard) that just want "my score
// for this month" without needing the full per-item breakdown.
export async function loadMyKpiSnapshot(userId, monthStr) {
  const [autoData, manualMap] = await Promise.all([
    loadKpiAutoData(monthStr),
    loadKpiManualData(userId, monthStr),
  ])
  const totalScore = calcTotalScoreFromMaps(autoData, manualMap)
  return {
    autoData,
    manualMap,
    totalScore,
    totalWeight: TOTAL_WEIGHT,
    pct: TOTAL_WEIGHT ? Math.round((totalScore / TOTAL_WEIGHT) * 100) : 0,
  }
}
