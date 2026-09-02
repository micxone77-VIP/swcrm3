import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateRetentionMetrics, aggregateHostPerformance } from '../lib/retentionAnalytics'
import { resolveSnapshotWindow } from '../lib/retention.js'
import { useLanguage } from '../contexts/LanguageContext'

const monthKey = (date) => { const d = new Date(date); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}` }
const money = (n,c) => `${c || ''} ${Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:2})}`.trim()
const recoveryAmount = row => Number(row?.reactivation_deposit ?? row?.deposit_amount ?? row?.amount ?? 0) || 0
const playerKey = row => String(row?.vip_id || row?.username || row?.id || '').trim().toLowerCase()
const monthLabel = (m) => m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-MY',{month:'short',year:'numeric',timeZone:'UTC'}) : '—'

function aggregateReactivationLogs(logs = [], stats = []) {
  const grouped = new Map()
  logs.forEach(log => {
    const key = playerKey(log)
    if (!key) return
    const stat = stats.find(s => (log.vip_id && String(s.id) === String(log.vip_id)) || (log.username && String(s.username).trim().toLowerCase() === String(log.username).trim().toLowerCase()))
    const current = grouped.get(key)
    const amount = recoveryAmount(log)
    if (!current) {
      grouped.set(key, { ...log, id: log.vip_id || stat?.id || log.id, username: log.username || stat?.username, tier: log.tier || stat?.tier, currency: log.currency || stat?.currency, host: log.host_name || stat?.host, recoveryAmount: amount })
      return
    }
    current.recoveryAmount += amount
    if (!current.currency && log.currency) current.currency = log.currency
    if (!current.host && log.host_name) current.host = log.host_name
    if (!current.tier && log.tier) current.tier = log.tier
  })
  return [...grouped.values()]
}

function computePeriodStats(rows, prevMonth, currMonth) {
  const map = new Map()
  rows.forEach(r => {
    const k = r.vip_id || r.username
    const x = map.get(k) || { id: k, username: r.username, tier: r.tier, currency: r.currency, host: null, prev: 0, current: 0 }
    if (r.snapshot_month === prevMonth) { x.prev = Number(r.total_deposit) || 0; if (r.host_assigned) x.host = r.host_assigned }
    if (r.snapshot_month === currMonth) x.current = Number(r.total_deposit) || 0
    if (!x.tier && r.tier) x.tier = r.tier
    if (!x.currency && r.currency) x.currency = r.currency
    map.set(k, x)
  })
  const players = [...map.values()]
  const previousActive = players.filter(x => x.prev > 0)
  const retained = previousActive.filter(x => x.current > 0)
  const churned = previousActive.filter(x => x.current <= 0)
  const rate = previousActive.length ? Math.round(retained.length / previousActive.length * 100) : 0
  return { previousActive, retained, churned, retentionRate: rate }
}

export default function RetentionAnalytics() {
  const { t } = useLanguage()
  const [month, setMonth] = useState(monthKey(new Date()))
  const [allMonths, setAllMonths] = useState([])
  const [rows, setRows] = useState([])
  const [reactivated, setReactivated] = useState([])
  const [compRows, setCompRows] = useState([])
  const [compReactivated, setCompReactivated] = useState([])
  const [effectiveMonth, setEffectiveMonth] = useState(monthKey(new Date()))
  const [previousSnapshotMonth, setPreviousSnapshotMonth] = useState(null)
  const [compPeriodMonths, setCompPeriodMonths] = useState({ curr: null, prev: null })
  const [usedFallback, setUsedFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const ALL_TIERS = ['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
  const [selectedTiers, setSelectedTiers] = useState(['DIAMOND','PLATINUM','GOLD'])

  // Load available months once
  useEffect(() => {
    supabase.from('vip_monthly_totals').select('snapshot_month').order('snapshot_month', { ascending: false })
      .then(({ data }) => {
        const unique = [...new Set((data || []).map(r => r.snapshot_month).filter(Boolean))]
        setAllMonths(unique)
      })
  }, [])

  // Main data load
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')

      const latestResult = await supabase.from('vip_monthly_totals').select('snapshot_month').lte('snapshot_month', month).order('snapshot_month', { ascending: false }).limit(1)
      if (cancelled) return
      if (latestResult.error) { setError(latestResult.error.message || t('retention.analyticsLoadError')); setLoading(false); return }

      const latestMonth = latestResult.data?.[0]?.snapshot_month || null
      const previousResult = latestMonth
        ? await supabase.from('vip_monthly_totals').select('snapshot_month').lt('snapshot_month', latestMonth).order('snapshot_month', { ascending: false }).limit(1)
        : { data: [], error: null }
      if (cancelled) return
      if (previousResult.error) { setError(previousResult.error.message || t('retention.analyticsLoadError')); setLoading(false); return }

      const window = resolveSnapshotWindow([previousResult.data?.[0]?.snapshot_month, latestMonth].filter(Boolean), month)
      const current = window.currentMonth
      const previous = window.previousMonth

      // Also find the month before `previous` for comparison
      const prev2Result = previous
        ? await supabase.from('vip_monthly_totals').select('snapshot_month').lt('snapshot_month', previous).order('snapshot_month', { ascending: false }).limit(1)
        : { data: [], error: null }
      if (cancelled) return
      const prev2 = prev2Result.data?.[0]?.snapshot_month || null

      const monthsToFetch = [prev2, previous, current].filter(Boolean)

      const [m, r, cm, cr] = await Promise.all([
        current ? supabase.from('vip_monthly_totals').select('vip_id,username,snapshot_month,total_deposit,currency,tier,host_assigned').in('snapshot_month', [previous, current].filter(Boolean)) : { data: [], error: null },
        current ? supabase.from('reactivation_logs').select('*').eq('reactivated_month', current).order('created_at', { ascending: false }) : { data: [], error: null },
        (prev2 && previous) ? supabase.from('vip_monthly_totals').select('vip_id,username,snapshot_month,total_deposit,currency,tier,host_assigned').in('snapshot_month', [prev2, previous]) : { data: [], error: null },
        previous ? supabase.from('reactivation_logs').select('*').eq('reactivated_month', previous).order('created_at', { ascending: false }) : { data: [], error: null },
      ])
      if (cancelled) return
      if (m.error || r.error) { setError(m.error?.message || r.error?.message || t('retention.analyticsLoadError')); setLoading(false); return }

      setRows(m.data || [])
      setReactivated(r.data || [])
      setCompRows(cm.data || [])
      setCompReactivated(cr.data || [])
      setEffectiveMonth(current || month)
      setPreviousSnapshotMonth(previous)
      setCompPeriodMonths({ curr: previous, prev: prev2 })
      setUsedFallback(Boolean(window.usedFallback))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [month, t])

  const stats = useMemo(() => {
    const prev = previousSnapshotMonth, map = new Map()
    rows.forEach(r => {
      const k = r.vip_id || r.username
      const x = map.get(k) || { id: k, username: r.username, tier: r.tier, currency: r.currency, host: null, prev: 0, current: 0 }
      if (r.snapshot_month === prev) { x.prev = Number(r.total_deposit) || 0; if (r.host_assigned) x.host = r.host_assigned }
      if (r.snapshot_month === effectiveMonth) x.current = Number(r.total_deposit) || 0
      if (!x.tier && r.tier) x.tier = r.tier
      if (!x.currency && r.currency) x.currency = r.currency
      map.set(k, x)
    })
    return [...map.values()]
  }, [rows, effectiveMonth, previousSnapshotMonth])

  const previousActive = stats.filter(x => x.prev > 0)
  const retained = previousActive.filter(x => x.current > 0)
  const churned = previousActive.filter(x => x.current <= 0)
  const reactivatedRows = useMemo(() => aggregateReactivationLogs(reactivated, stats), [reactivated, stats])
  const reactivatedCount = reactivatedRows.length
  const metrics = calculateRetentionMetrics({ openingVipCount: previousActive.length, retainedVipCount: retained.length, churnedVipCount: churned.length, reactivatedVipCount: reactivatedCount, recoveredDeposits: reactivatedRows.filter(r => r.recoveryAmount > 0).map(r => ({ amount: r.recoveryAmount, currency: r.currency })) })

  // Comparison period
  const compStats = useMemo(() => {
    if (!compPeriodMonths.curr || !compPeriodMonths.prev || !compRows.length) return null
    const s = computePeriodStats(compRows, compPeriodMonths.prev, compPeriodMonths.curr)
    const compReactRows = aggregateReactivationLogs(compReactivated, s.previousActive)
    const compMetrics = calculateRetentionMetrics({ openingVipCount: s.previousActive.length, retainedVipCount: s.retained.length, churnedVipCount: s.churned.length, reactivatedVipCount: compReactRows.length })
    return { ...s, reactivatedCount: compReactRows.length, retentionRate: compMetrics.retentionRate }
  }, [compRows, compPeriodMonths, compReactivated])

  const tierKpis = useMemo(() => ALL_TIERS.map(tier => {
    const opening = previousActive.filter(v => String(v.tier).toUpperCase() === tier).length
    const kept = retained.filter(v => String(v.tier).toUpperCase() === tier).length
    const lost = churned.filter(v => String(v.tier).toUpperCase() === tier).length
    const tierReact = reactivatedRows.filter(v => String(v.tier).toUpperCase() === tier)
    const back = tierReact.length
    const recoveryByCurrency = tierReact.filter(v => v.recoveryAmount > 0).reduce((acc, v) => { const c = String(v.currency || '').toUpperCase(); if (c) acc[c] = (acc[c] || 0) + v.recoveryAmount; return acc }, {})
    const recoveryText = Object.entries(recoveryByCurrency).map(([c, a]) => money(a, c)).join(' · ')
    // Total players in this tier in the previous snapshot (whether active/inactive)
    const totalInTierPrev = rows.filter(r => r.snapshot_month === previousSnapshotMonth && String(r.tier).toUpperCase() === tier).length
    const inactive = totalInTierPrev - opening // in prev snapshot but deposit=0
    return { tier, totalInTierPrev, inactive, opening, kept, lost, back, recoveryByCurrency, recoveryText, rate: calculateRetentionMetrics({ openingVipCount: opening, retainedVipCount: kept, churnedVipCount: lost }).retentionRate }
  }), [ALL_TIERS, previousActive, retained, churned, reactivatedRows, rows, previousSnapshotMonth])

  const hosts = useMemo(() => {
    const assignedByHost = new Map()
    previousActive.forEach(v => { const host = v.host || 'Unassigned'; assignedByHost.set(host, (assignedByHost.get(host) || 0) + 1) })
    const reactivatedByHost = new Map()
    reactivatedRows.forEach(x => { const host = x.host || 'Unassigned'; const e = reactivatedByHost.get(host) || { host, reactivated: 0, amounts: [], tierRows: [] }; e.reactivated++; if (x.recoveryAmount > 0) e.amounts.push({ amount: x.recoveryAmount, currency: x.currency }); e.tierRows.push({ tier: x.tier, amount: x.recoveryAmount, currency: x.currency, reactivated: 1 }); reactivatedByHost.set(host, e) })
    const summaries = []
    assignedByHost.forEach((assignedVips, host) => { const r = reactivatedByHost.get(host); summaries.push({ host, assignedVips, reactivated: r?.reactivated || 0, amounts: r?.amounts || [], tierRows: r?.tierRows || [] }) })
    reactivatedByHost.forEach((r, host) => { if (!assignedByHost.has(host)) summaries.push(r) })
    return aggregateHostPerformance(summaries)
  }, [previousActive, reactivatedRows])

  if (loading) return <div className="p-8 text-sm opacity-60">{t('retention.loadingAnalytics')}</div>
  if (error) return <div className="rounded-xl border p-6 text-sm">{t('retention.analyticsLoadError')}: {error}</div>

  const tierRecoveryText = (h, tier) => Object.entries(h?.byTier?.[tier]?.recoveredDepositByCurrency || {}).map(([c, a]) => money(a, c)).join(' · ') || '—'

  const currentPeriodLabel = previousSnapshotMonth && effectiveMonth ? `${monthLabel(previousSnapshotMonth)} → ${monthLabel(effectiveMonth)}` : monthLabel(effectiveMonth)
  const compPeriodLabel = compPeriodMonths.prev && compPeriodMonths.curr ? `${monthLabel(compPeriodMonths.prev)} → ${monthLabel(compPeriodMonths.curr)}` : null

  const delta = (curr, prev) => {
    const diff = curr - prev
    if (diff === 0) return <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
    const up = diff > 0
    return <span style={{ color: up ? '#20a36a' : '#d94b4b', fontSize: 11, fontWeight: 700 }}>{up ? '▲' : '▼'} {Math.abs(diff)}</span>
  }
  const deltaRate = (curr, prev) => {
    const diff = curr - prev
    if (diff === 0) return <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
    const up = diff > 0
    return <span style={{ color: up ? '#20a36a' : '#d94b4b', fontSize: 11, fontWeight: 700 }}>{up ? '▲' : '▼'} {Math.abs(diff)}%</span>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">📊 {t('retention.analytics')}</h1>
          <p className="mt-1 text-sm opacity-70">{t('retention.analyticsSubtitle')}</p>
        </div>
        <div>
          <label className="mr-2 text-sm opacity-70">{t('retention.reportingMonth')}</label>
          <input aria-label={t('retention.reportingMonth')} type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-lg border bg-transparent px-3 py-2" />
        </div>
      </div>

      {usedFallback && <div className="rounded-xl border px-5 py-4 text-sm">{t('retention.snapshotFallback', { month: effectiveMonth })}</div>}

      {/* Month-over-Month Comparison */}
      {compStats && compPeriodLabel ? (
        <section className="rounded-xl border overflow-hidden">
          <div className="border-b px-5 py-4 flex items-center justify-between">
            <div>
              <div className="font-medium">📈 {t('retention.comparisonTitle')}</div>
              <div className="text-xs opacity-60 mt-1">{t('retention.comparisonSubtitle')}</div>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 20px', textAlign: 'left', color: 'var(--muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{t('common.metric') || 'Metric'}</th>
                  <th style={{ padding: '10px 20px', textAlign: 'right', color: 'var(--muted)', fontSize: 11, fontWeight: 600 }}>{compPeriodLabel}</th>
                  <th style={{ padding: '10px 20px', textAlign: 'right', color: 'var(--accent)', fontSize: 11, fontWeight: 700 }}>{currentPeriodLabel} ← {t('retention.currentPeriod')}</th>
                  <th style={{ padding: '10px 20px', textAlign: 'right', color: 'var(--muted)', fontSize: 11, fontWeight: 600 }}>{t('retention.change')}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: t('retention.previousActive'), curr: previousActive.length, comp: compStats.previousActive.length },
                  { label: t('retention.retained'), curr: retained.length, comp: compStats.retained.length },
                  { label: t('retention.churned'), curr: churned.length, comp: compStats.churned.length, invertDelta: true },
                  { label: t('retention.reactivatedCount'), curr: reactivatedCount, comp: compStats.reactivatedCount },
                  { label: t('retention.retentionRate'), curr: metrics.retentionRate, comp: compStats.retentionRate, isRate: true },
                ].map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--surface2)' }}>
                    <td style={{ padding: '12px 20px', fontWeight: 500 }}>{row.label}</td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--muted)' }}>
                      {row.isRate ? `${row.comp}%` : row.comp}
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
                      {row.isRate ? `${row.curr}%` : row.curr}
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                      {row.isRate
                        ? deltaRate(row.curr - (row.invertDelta ? 0 : 0) , row.comp)
                        : delta(row.invertDelta ? row.comp - row.curr : row.curr - row.comp, 0)
                      }
                      {!row.isRate && (() => {
                        const rawDiff = row.curr - row.comp
                        const displayDiff = row.invertDelta ? -rawDiff : rawDiff
                        const up = displayDiff > 0
                        if (displayDiff === 0) return <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                        return <span style={{ color: up ? '#20a36a' : '#d94b4b', fontSize: 11, fontWeight: 700 }}>{up ? '▲' : '▼'} {Math.abs(rawDiff)}</span>
                      })()}
                      {row.isRate && (() => {
                        const diff = row.curr - row.comp
                        if (diff === 0) return <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                        const up = diff > 0
                        return <span style={{ color: up ? '#20a36a' : '#d94b4b', fontSize: 11, fontWeight: 700 }}>{up ? '▲' : '▼'} {Math.abs(diff)}%</span>
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : !loading && (
        <div className="rounded-xl border px-5 py-4 text-sm opacity-60">{t('retention.noComparisonData')}</div>
      )}

      {/* Current period KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <Kpi label={t('retention.previousActive')} value={previousActive.length} sub={monthLabel(previousSnapshotMonth)} />
        <Kpi label={t('retention.retained')} value={retained.length} />
        <Kpi label={t('retention.churned')} value={churned.length} />
        <Kpi label={t('retention.retention')} value={`${metrics.retentionRate}%`} />
        <Kpi label={t('retention.churn')} value={`${metrics.churnRate}%`} />
        <Kpi label={t('retention.reactivatedCount')} value={`${reactivatedCount} (${metrics.reactivationRate}%)`} />
      </div>

      {/* Priority tier performance */}
      <section className="rounded-xl border overflow-hidden">
        <div className="border-b px-5 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="font-medium">{t('retention.priorityTierPerformance')}</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <button onClick={() => setSelectedTiers(ALL_TIERS)} style={{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer', border:'1px solid var(--border)', background: selectedTiers.length === ALL_TIERS.length ? 'var(--accent)' : 'transparent', color: selectedTiers.length === ALL_TIERS.length ? '#fff' : 'var(--muted)' }}>All</button>
            {ALL_TIERS.map(tier => {
              const icon = {BLACK:'⬛',DIAMOND:'💎',PLATINUM:'🔷',GOLD:'🟡',SILVER:'⚪',BRONZE:'🟤'}[tier]
              const active = selectedTiers.includes(tier)
              return <button key={tier} onClick={() => setSelectedTiers(prev => prev.includes(tier) ? prev.filter(t=>t!==tier) : [...prev, tier])} style={{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer', border:`1px solid ${active?'var(--accent)':'var(--border)'}`, background: active ? 'rgba(88,166,255,.12)' : 'transparent', color: active ? 'var(--accent)' : 'var(--muted)' }}>{icon} {tier.charAt(0)+tier.slice(1).toLowerCase()}</button>
            })}
          </div>
        </div>
        <div className="grid gap-3 p-5" style={{ gridTemplateColumns: `repeat(${Math.min(selectedTiers.length, 3)}, 1fr)` }}>
          {tierKpis.filter(k => selectedTiers.includes(k.tier)).map(k => {
            const icon = {BLACK:'⬛',DIAMOND:'💎',PLATINUM:'🔷',GOLD:'🟡',SILVER:'⚪',BRONZE:'🟤'}[k.tier]
            return (
              <div key={k.tier} className="rounded-lg border p-4">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div className="text-sm font-semibold">{icon} {k.tier}</div>
                  {k.totalInTierPrev > 0 && <div style={{ fontSize:10, color:'var(--muted)', textAlign:'right' }}>Total in prev snapshot<br/><strong style={{ fontSize:14, color:'var(--text)' }}>{k.totalInTierPrev}</strong></div>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><div className="text-xs opacity-60">{t('retention.previousActive')}</div><strong>{k.opening}</strong>{k.inactive > 0 && <span style={{ fontSize:10, color:'var(--muted)', marginLeft:4 }}>({k.inactive} inactive)</span>}</div>
                  <div><div className="text-xs opacity-60">{t('retention.retained')}</div><strong>{k.kept}</strong></div>
                  <div><div className="text-xs opacity-60">{t('retention.churned')}</div><strong style={{ color: k.lost > 0 ? '#d94b4b' : 'inherit' }}>{k.lost}</strong></div>
                  <div><div className="text-xs opacity-60">{t('retention.reactivatedCount')}</div><strong style={{ color: k.back > 0 ? '#20a36a' : 'inherit' }}>{k.back}</strong></div>
                </div>
                <div className="mt-3 text-lg font-semibold" style={{ color: k.rate >= 85 ? '#20a36a' : k.rate >= 70 ? '#d29922' : '#d94b4b' }}>{k.rate}% {t('retention.retention')}</div>
                {k.recoveryText && <div className="mt-3 rounded-md border px-3 py-2 text-sm"><div className="text-xs opacity-60">{t('retention.reactivatedDeposit')}</div><strong>{k.recoveryText}</strong></div>}
              </div>
            )
          })}
          {tierKpis.filter(k => selectedTiers.includes(k.tier)).length === 0 && <div className="col-span-3 py-8 text-center text-sm opacity-60">Select at least one tier above to view performance.</div>}
        </div>
      </section>

      {/* Recovery deposits */}
      <section className="rounded-xl border">
        <div className="border-b px-5 py-4 font-medium">{t('retention.reactivatedDeposit')}</div>
        <div className="grid gap-3 p-5 md:grid-cols-3">
          {Object.entries(metrics.recoveredDepositsByCurrency).map(([currency, amount]) => (
            <div key={currency} className="rounded-lg border p-4">
              <div className="text-xs opacity-60">{currency}</div>
              <div className="mt-1 text-xl font-semibold">{money(amount, currency)}</div>
            </div>
          ))}
          {!Object.keys(metrics.recoveredDepositsByCurrency).length && <div className="text-sm opacity-60">{t('retention.noRecovery')}</div>}
        </div>
      </section>

      {/* Host performance */}
      <section className="rounded-xl border overflow-hidden">
        <div className="border-b px-5 py-4 font-medium">{t('retention.hostPerformance')}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-5 py-3">{t('retention.host')}</th>
                <th className="px-5 py-3">{t('retention.assignedVips')}</th>
                <th className="px-5 py-3">💎 Diamond</th>
                <th className="px-5 py-3">🔷 Platinum</th>
                <th className="px-5 py-3">🟡 Gold</th>
                <th className="px-5 py-3">{t('retention.reactivatedCount')}</th>
                <th className="px-5 py-3">{t('retention.reactivationRateShort')}</th>
                <th className="px-5 py-3">{t('retention.reactivatedDeposit')}</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map(h => (
                <tr key={h.host} className="border-b last:border-0">
                  <td className="px-5 py-3 font-medium">{h.host}</td>
                  <td className="px-5 py-3">{h.assignedVips || '—'}</td>
                  <td className="px-5 py-3"><div className="font-medium">{h.byTier?.DIAMOND?.reactivated || 0}</div><div className="text-xs opacity-60">{tierRecoveryText(h, 'DIAMOND')}</div></td>
                  <td className="px-5 py-3"><div className="font-medium">{h.byTier?.PLATINUM?.reactivated || 0}</div><div className="text-xs opacity-60">{tierRecoveryText(h, 'PLATINUM')}</div></td>
                  <td className="px-5 py-3"><div className="font-medium">{h.byTier?.GOLD?.reactivated || 0}</div><div className="text-xs opacity-60">{tierRecoveryText(h, 'GOLD')}</div></td>
                  <td className="px-5 py-3">{h.reactivated}</td>
                  <td className="px-5 py-3">{h.reactivationRate}%</td>
                  <td className="px-5 py-3">{Object.entries(h.recoveredDepositByCurrency).map(([c, a]) => <div key={c}>{money(a, c)}</div>)}</td>
                </tr>
              ))}
              {!hosts.length && <tr><td colSpan="8" className="p-8 text-center opacity-60">{t('retention.noHostRecords')}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Definitions */}
      <div className="rounded-xl border p-5 text-sm opacity-75">
        <strong>{t('retention.definitions')}:</strong> {t('retention.definitionsText')}
      </div>
    </div>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div className="rounded-xl border p-5">
      <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs opacity-50 mt-1">{sub}</div>}
    </div>
  )
}
