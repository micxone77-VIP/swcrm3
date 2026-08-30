// TierAnalytics.jsx — Monthly deposit/withdrawal/valid bet breakdown by tier
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TIER_COLOR, TIER_BG, CURRENCY_LIST, CURRENCY_SYMBOL, CURRENCY_REGION, REGION_LABEL } from '../lib/constants'
import { formatMoney, formatCompactNumber, pctChange, fmtMonthLabel, currentYearMonth, prevYearMonth } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam } from '../hooks/useUrlParam'

const TIERS = ['DIAMOND', 'PLATINUM', 'GOLD', 'BLACK']

function ChangeTag({ pct }) {
  if (pct === null || pct === undefined) return <span style={{ fontSize:11, color:'var(--muted)' }}>—</span>
  const up = pct >= 0
  return (
    <span style={{ fontSize:11, fontWeight:700, color: up ? '#3fb950' : '#f85149' }}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

const s = {
  page:    { padding:'24px 28px', minHeight:'100vh', color:'var(--text)' },
  title:   { fontSize:22, fontWeight:700 },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:24 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, marginBottom:16 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' },
  cardBdy: { padding:'0' },
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'10px 16px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  thR:     { padding:'10px 16px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'right', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:      { padding:'11px 16px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  tdR:     { padding:'11px 16px', borderBottom:'1px solid var(--border)', verticalAlign:'middle', textAlign:'right', fontFamily:'monospace' },
  badge:   (tier) => ({ display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, background:TIER_BG[tier]||'var(--surface2)', color:TIER_COLOR[tier]||'var(--text)', border:`1px solid ${TIER_COLOR[tier]||'var(--border)'}44` }),
  sel:     { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 12px', borderRadius:8, fontSize:13, outline:'none' },
  statGrid:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12, marginBottom:16 },
  statCard:(c) => ({ background:'var(--surface)', border:'1px solid var(--border)', borderLeft:`3px solid ${c}`, borderRadius:10, padding:'14px 16px' }),
  divider: { border:'none', borderTop:'1px solid var(--border)', margin:'0' },
  totRow:  { background:'var(--surface2)', fontWeight:700 },
  toggle:  (active) => ({ background: active?'var(--accent)':'transparent', color: active?'#fff':'var(--muted)', border:'none', padding:'7px 16px', fontSize:12, fontWeight:600, cursor:'pointer' }),
}

function DepositChart({ data, metric, onMetricChange, currency, t }) {
  if (!data || data.length < 2) return (
    <div style={{ padding:'40px', textAlign:'center', color:'var(--muted)', fontSize:13 }}>
      {t('tierAnalytics.needMoreData')}
    </div>
  )

  const W = 780, H = 240, PAD = { top:20, right:20, bottom:36, left:72 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top  - PAD.bottom

  const allVals = data.flatMap(d => TIERS.map(t2 => d[t2 + '_' + metric] || 0))
  const maxVal  = Math.max(...allVals, 1)

  const x = (i) => PAD.left + (i / (data.length - 1)) * innerW
  const y = (v) => PAD.top  + innerH - (v / maxVal) * innerH

  const COLORS = TIER_COLOR
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => ({ val: maxVal * r, y: y(maxVal * r) }))

  const metricLabels = { deposit: t('common.deposit'), validBet: t('common.validBet'), withdrawal: t('common.withdrawal') }

  return (
    <div>
      {/* Metric toggle */}
      <div style={{ display:'flex', gap:6, padding:'12px 20px 0', flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:11, color:'var(--muted)', marginRight:4 }}>{t('tierAnalytics.metricLabel')}</span>
        {Object.entries(metricLabels).map(([k, l]) => (
          <button key={k} onClick={() => onMetricChange(k)} style={{
            background: metric===k ? 'var(--accent)' : 'var(--surface2)',
            color: metric===k ? '#fff' : 'var(--muted)',
            border: '1px solid var(--border)', padding:'4px 12px', borderRadius:6,
            fontSize:11, fontWeight:700, cursor:'pointer',
          }}>{l}</button>
        ))}
        <span style={{ fontSize:10, color:'var(--muted)', marginLeft:8 }}>({CURRENCY_SYMBOL[currency]})</span>
        {/* Legend */}
        <div style={{ marginLeft:'auto', display:'flex', gap:14 }}>
          {TIERS.map(tier => (
            <div key={tier} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11 }}>
              <div style={{ width:20, height:3, background:COLORS[tier], borderRadius:2 }} />
              <span style={{ color:COLORS[tier], fontWeight:700 }}>{tier}</span>
            </div>
          ))}
        </div>
      </div>
      {/* SVG Chart */}
      <div style={{ overflowX:'auto', padding:'8px 20px 16px' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', maxWidth:W, display:'block' }}>
          {/* Grid lines + Y axis labels */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={tick.y} y2={tick.y}
                stroke="var(--border)" strokeWidth={0.5} strokeDasharray="4 4" />
              <text x={PAD.left - 6} y={tick.y + 4} textAnchor="end"
                fontSize={10} fill="var(--muted)">{formatCompactNumber(tick.val)}</text>
            </g>
          ))}
          {/* X axis labels */}
          {data.map((d, i) => (
            <text key={i} x={x(i)} y={H - PAD.bottom + 16} textAnchor="middle"
              fontSize={10} fill="var(--muted)">{fmtMonthLabel(d.month)}</text>
          ))}
          {/* Lines + dots per tier */}
          {TIERS.map(tier => {
            const pts = data.map((d, i) => `${x(i)},${y(d[tier + '_' + metric] || 0)}`).join(' ')
            return (
              <g key={tier}>
                <polyline points={pts} fill="none" stroke={COLORS[tier]} strokeWidth={2.5}
                  strokeLinejoin="round" strokeLinecap="round" />
                {data.map((d, i) => {
                  const val = d[tier + '_' + metric] || 0
                  return (
                    <g key={i}>
                      <circle cx={x(i)} cy={y(val)} r={4} fill={COLORS[tier]} stroke="var(--surface)" strokeWidth={2} />
                      {/* Value label on last point */}
                      {i === data.length - 1 && val > 0 && (
                        <text x={x(i) + 7} y={y(val) + 4} fontSize={9} fill={COLORS[tier]} fontWeight="700">
                          {formatCompactNumber(val)}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            )
          })}
          {/* Vertical hover lines (visual separators) */}
          {data.map((_, i) => (
            <line key={i} x1={x(i)} x2={x(i)} y1={PAD.top} y2={PAD.top + innerH}
              stroke="var(--border)" strokeWidth={0.5} strokeDasharray="2 4" />
          ))}
        </svg>
      </div>
    </div>
  )
}

export default function TierAnalytics() {
  const { t } = useLanguage()
  const [month,    setMonth]    = useUrlParam('month', currentYearMonth())
  const [cmpMonth, setCmpMonth] = useUrlParam('cmp', prevYearMonth(currentYearMonth()))
  // MYR and SGD must never be summed together — this toggle picks ONE currency
  // at a time for every query and total on this page. See lib/constants.js.
  const [currency, setCurrency] = useUrlParam('currency', 'MYR')
  const [data,     setData]     = useState({})
  const [cmpData,  setCmpData]  = useState({})
  const [members,  setMembers]  = useState({})
  const [cmpMembers,setCmpMembers] = useState({})
  const [loading,  setLoading]  = useState(true)
  const [view,      setView]      = useUrlParam('view', 'summary') // 'summary' | 'detail' | 'pdtrend'
  const [chartData, setChartData] = useState([])        // [{month, DIAMOND, PLATINUM, GOLD}]
  const [chartMetric, setChartMetric] = useUrlParam('metric', 'deposit') // 'deposit' | 'validBet' | 'withdrawal'
  const [pdTrend,     setPdTrend]     = useState([])
  const [pdTrendLoading, setPdTrendLoading] = useState(false)

  useEffect(() => { loadData() }, [month, cmpMonth, currency])
  useEffect(() => { loadChartData() }, [currency])
  useEffect(() => { if (view === 'pdtrend') loadPdTrend() }, [view, month, currency])

  const TIER_RANK = { BRONZE:0, SILVER:1, GOLD:2, PLATINUM:3, DIAMOND:4, BLACK:5 }
  const PD_TIERS  = ['PLATINUM', 'DIAMOND']

  async function loadPdTrend() {
    setPdTrendLoading(true)
    const prevMonth1 = prevYearMonth(month)
    const prevMonth2 = prevYearMonth(prevMonth1)
    const threeMonths = [prevMonth2, prevMonth1, month]

    const { data: excludedRows } = await supabase.from('vip_members').select('username').eq('is_excluded', true)
    const excludedSet = new Set((excludedRows||[]).map(e => e.username))

    const { data: allChangeLogs } = await supabase
      .from('tier_change_logs')
      .select('old_tier, new_tier, import_month')
      .in('import_month', threeMonths)

    async function fetchPDMonthStats(m) {
      const { data } = await supabase
        .from('vip_monthly_totals')
        .select('username, tier, monthly_valid_bet, total_deposit, total_withdrawal')
        .eq('snapshot_month', m).eq('currency', currency).in('tier', PD_TIERS)
      const byTier = {}
      PD_TIERS.forEach(t => { byTier[t] = { count:0, active:0, deposit:0, withdrawal:0, validBet:0, activeUsernames:new Set() } })
      ;(data||[]).forEach(v => {
        if (excludedSet.has(v.username)) return
        if (!byTier[v.tier]) return
        const vb = parseFloat(v.monthly_valid_bet) || 0
        byTier[v.tier].count++
        if (vb > 0) { byTier[v.tier].active++; byTier[v.tier].activeUsernames.add(v.username) }
        byTier[v.tier].deposit    += parseFloat(v.total_deposit) || 0
        byTier[v.tier].withdrawal += parseFloat(v.total_withdrawal) || 0
        byTier[v.tier].validBet   += vb
      })
      return byTier
    }

    const monthStats = {}
    for (const m of threeMonths) monthStats[m] = await fetchPDMonthStats(m)

    const rows = []
    for (const tier of PD_TIERS) {
      for (let i = 0; i < threeMonths.length; i++) {
        const m = threeMonths[i]
        const cur = monthStats[m][tier]
        const prev = i > 0 ? monthStats[threeMonths[i-1]][tier] : null
        const upgradesIn = (allChangeLogs||[]).filter(l =>
          l.import_month === m && l.new_tier === tier && (TIER_RANK[l.new_tier]||0) > (TIER_RANK[l.old_tier]||0)
        ).length
        const downgradesOut = (allChangeLogs||[]).filter(l =>
          l.import_month === m && l.old_tier === tier && (TIER_RANK[l.new_tier]||0) < (TIER_RANK[l.old_tier]||0)
        ).length
        let churned = null
        if (prev) {
          churned = 0
          prev.activeUsernames.forEach(u => { if (!cur.activeUsernames.has(u)) churned++ })
        }
        rows.push({ tier, month: m, ...cur, upgradesIn, downgradesOut, churned })
      }
    }
    setPdTrend(rows)
    setPdTrendLoading(false)
  }

  async function loadData() {
    setLoading(true)
    const [curr, prev] = await Promise.all([
      fetchMonthData(month),
      fetchMonthData(cmpMonth),
    ])
    setData(curr.byTier)
    setMembers(curr.members)
    setCmpData(prev.byTier)
    setCmpMembers(prev.members)
    setLoading(false)
  }

  async function fetchMonthData(m) {
    const { data: totalsRaw } = await supabase
      .from('vip_monthly_totals')
      .select('username, tier, monthly_valid_bet, total_deposit, total_withdrawal, days_with_data')
      .eq('snapshot_month', m)
      .eq('currency', currency)
      .in('tier', TIERS)

    // days_inactive and deposit_count aren't tracked in vip_monthly_totals (no daily history
    // for them yet), so pull current values from vip_members as a best-effort supplement —
    // these will only be accurate for the current month, not historical comparison months.
    // Also pull is_excluded here since vip_monthly_totals has no such column — excluded
    // test/staff accounts must be filtered out of every calculation, per exclusion list rules.
    // NOTE: don't filter with .in('username', usernames) — with 400+ VIPs this can exceed
    // URL length limits. Fetch all relevant-tier members instead and join client-side.
    let extraMap = {}
    const excludedSet = new Set()
    if (totalsRaw && totalsRaw.length > 0) {
      const [{ data: extras, error: extrasErr }, { data: excludedRows }] = await Promise.all([
        supabase.from('vip_members').select('username, days_inactive, deposit_count').in('tier', TIERS),
        // Fetch exclusion flag unrestricted by current tier — an excluded player's historical
        // tier that month may differ from their current tier, so scoping by TIERS here could miss them.
        supabase.from('vip_members').select('username, is_excluded').eq('is_excluded', true),
      ])
      if (extrasErr) console.error('fetchMonthData: vip_members fetch error', extrasErr)
      ;(extras||[]).forEach(e => { extraMap[e.username] = e })
      ;(excludedRows||[]).forEach(e => excludedSet.add(e.username))
    }
    const totals = (totalsRaw || []).filter(v => !excludedSet.has(v.username))

    // Group by tier
    const byTier = {}
    const membersList = {}
    TIERS.forEach(t => {
      byTier[t] = { deposit:0, withdrawal:0, validBet:0, count:0, active:0, depositCount:0 }
      membersList[t] = []
    })

    ;(totals||[]).forEach(v => {
      const t = v.tier
      if (!byTier[t]) return
      const extra = extraMap[v.username] || {}
      const vb  = parseFloat(v.monthly_valid_bet) || 0
      const dep = parseFloat(v.total_deposit) || 0
      const wd  = parseFloat(v.total_withdrawal) || 0
      const active = vb > 0

      byTier[t].validBet      += vb
      byTier[t].deposit       += dep
      byTier[t].withdrawal    += wd
      byTier[t].count         += 1
      byTier[t].active        += active ? 1 : 0
      byTier[t].depositCount  += parseInt(extra.deposit_count) || 0

      membersList[t].push({
        username:     v.username,
        validBet:     vb,
        deposit:      dep,
        withdrawal:   wd,
        depositCount: parseInt(extra.deposit_count) || 0,
        daysInactive: extra.days_inactive,
        active,
        isCurrentMonth: true,
      })
    })

    // Sort members by valid bet
    TIERS.forEach(t => {
      membersList[t].sort((a,b) => b.validBet - a.validBet)
    })

    return { byTier, members: membersList }
  }

  async function loadChartData() {
    // Get last 6 distinct months from vip_monthly_totals (accumulated, not vip_snapshots
    // which now only ever captures a single day's numbers since CSV uploads are daily)
    const { data: snaps } = await supabase
      .from('vip_monthly_totals')
      .select('snapshot_month')
      .order('snapshot_month', { ascending: false })
      .limit(600)

    if (!snaps || snaps.length === 0) return

    const months = [...new Set(snaps.map(r => r.snapshot_month))].sort().slice(-6)

    const results = await Promise.all(months.map(async (m) => {
      const { data: vips } = await supabase
        .from('vip_monthly_totals')
        .select('tier, monthly_valid_bet, total_deposit, total_withdrawal')
        .in('tier', TIERS)
        .eq('snapshot_month', m)
        .eq('currency', currency)

      const row = { month: m }
      TIERS.forEach(t => {
        const tv = (vips||[]).filter(v => v.tier === t)
        row[t + '_deposit']    = tv.reduce((s, v) => s + (parseFloat(v.total_deposit)||0), 0)
        row[t + '_validBet']   = tv.reduce((s, v) => s + (parseFloat(v.monthly_valid_bet)||0), 0)
        row[t + '_withdrawal'] = tv.reduce((s, v) => s + (parseFloat(v.total_withdrawal)||0), 0)
      })
      return row
    }))
    setChartData(results)
  }
  const totalCurr = TIERS.reduce((acc, t) => ({
    deposit:    acc.deposit    + (data[t]?.deposit||0),
    withdrawal: acc.withdrawal + (data[t]?.withdrawal||0),
    validBet:   acc.validBet   + (data[t]?.validBet||0),
    count:      acc.count      + (data[t]?.count||0),
    active:     acc.active     + (data[t]?.active||0),
  }), { deposit:0, withdrawal:0, validBet:0, count:0, active:0 })

  const totalPrev = TIERS.reduce((acc, t) => ({
    deposit:    acc.deposit    + (cmpData[t]?.deposit||0),
    withdrawal: acc.withdrawal + (cmpData[t]?.withdrawal||0),
    validBet:   acc.validBet   + (cmpData[t]?.validBet||0),
  }), { deposit:0, withdrawal:0, validBet:0 })

  const fmt = (n) => formatMoney(n, currency)

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>📊 {t('tierAnalytics.title')}</div>
          <div style={s.sub}>{t('tierAnalytics.subtitle', { region: REGION_LABEL[CURRENCY_REGION[currency]], symbol: CURRENCY_SYMBOL[currency] })}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {CURRENCY_LIST.map(c => (
              <button key={c} onClick={() => setCurrency(c)} style={s.toggle(currency === c)}>
                {REGION_LABEL[CURRENCY_REGION[c]]} ({CURRENCY_SYMBOL[c]})
              </button>
            ))}
          </div>
          <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {[['summary', t('tierAnalytics.summary')],['detail', t('tierAnalytics.detail')],['pdtrend', '📈 P+D 3-Month']].map(([v,l]) => (
              <button key={v} onClick={() => setView(v)} style={s.toggle(view === v)}>{l}</button>
            ))}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'var(--muted)' }}>{t('tierAnalytics.currentMonth')}</span>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={s.sel} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'var(--muted)' }}>{t('tierAnalytics.compareMonth')}</span>
            <input type="month" value={cmpMonth} onChange={e => setCmpMonth(e.target.value)} style={s.sel} />
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>{t('common.loading')}</div>
      ) : (
        <>
          {/* Top summary stat cards */}
          <div style={s.statGrid}>
            {[
              { label:t('tierAnalytics.totalValidBet'), curr: totalCurr.validBet,   prev: totalPrev.validBet,   color:'var(--accent)' },
              { label:t('tierAnalytics.totalDeposit'),   curr: totalCurr.deposit,    prev: totalPrev.deposit,    color:'#3fb950' },
              { label:t('tierAnalytics.totalWithdrawal'),curr: totalCurr.withdrawal, prev: totalPrev.withdrawal, color:'#f85149' },
              { label:t('common.netDepWd'),  curr: totalCurr.deposit - totalCurr.withdrawal, prev: totalPrev.deposit - totalPrev.withdrawal, color:'#f59e0b' },
              { label:t('tierAnalytics.activeVips'),     curr: totalCurr.active, prev: null, color:'#06b6d4', noFmt: true },
              { label:t('common.totalVips'),      curr: totalCurr.count,  prev: null, color:'#8b5cf6', noFmt: true },
            ].map((st, i) => {
              const chg = pctChange(st.curr, st.prev)
              return (
                <div key={i} style={s.statCard(st.color)}>
                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4 }}>{st.label}</div>
                  <div style={{ fontSize:20, fontWeight:800, color:st.color }}>
                    {st.noFmt ? st.curr : fmt(st.curr)}
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
                    {st.prev !== null && <div style={{ fontSize:11, color:'var(--muted)' }}>
                      {fmtMonthLabel(cmpMonth)}: {st.noFmt ? st.prev : fmt(st.prev)}
                    </div>}
                    {chg !== null && <ChangeTag pct={chg} />}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── SUMMARY VIEW ── */}
          {view === 'summary' && (
            <div style={s.card}>
              <div style={s.cardHdr}>
                <span style={{ fontSize:13, fontWeight:700 }}>{t('tierAnalytics.tierBreakdown', { month: fmtMonthLabel(month), cmpMonth: fmtMonthLabel(cmpMonth) })}</span>
              </div>
              <div style={s.cardBdy}>
                <table style={s.tbl}>
                  <thead>
                    <tr>
                      <th style={s.th}>{t('common.tier')}</th>
                      <th style={s.thR}>{t('common.members')}</th>
                      <th style={s.thR}>{t('common.active')}</th>
                      <th style={s.thR}>{t('tierAnalytics.activeRate')}</th>
                      <th style={s.thR}>{t('common.validBet')} ({fmtMonthLabel(month)})</th>
                      <th style={s.thR}>{t('tierAnalytics.vs')} {fmtMonthLabel(cmpMonth)}</th>
                      <th style={s.thR}>{t('common.deposit')} ({fmtMonthLabel(month)})</th>
                      <th style={s.thR}>{t('tierAnalytics.vs')} {fmtMonthLabel(cmpMonth)}</th>
                      <th style={s.thR}>{t('common.withdrawal')} ({fmtMonthLabel(month)})</th>
                      <th style={s.thR}>{t('tierAnalytics.vs')} {fmtMonthLabel(cmpMonth)}</th>
                      <th style={s.thR}>{t('tierAnalytics.netDepWdShort')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TIERS.map(tier => {
                      const c = data[tier] || {}
                      const p = cmpData[tier] || {}
                      const activeRate = c.count ? Math.round(c.active/c.count*100) : 0
                      const net = (c.deposit||0) - (c.withdrawal||0)
                      return (
                        <tr key={tier}
                          onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                          onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                          <td style={s.td}><span style={s.badge(tier)}>{tier}</span></td>
                          <td style={s.tdR}>{c.count||0}</td>
                          <td style={s.tdR}>{c.active||0}</td>
                          <td style={s.tdR}>
                            <span style={{ color: activeRate>=90?'#3fb950':activeRate>=70?'#d29922':'#f85149', fontWeight:700 }}>
                              {activeRate}%
                            </span>
                          </td>
                          <td style={{ ...s.tdR, color:TIER_COLOR[tier], fontWeight:700 }}>{fmt(c.validBet)}</td>
                          <td style={s.tdR}><ChangeTag pct={pctChange(c.validBet, p.validBet)} /></td>
                          <td style={{ ...s.tdR, color:'#3fb950' }}>{fmt(c.deposit)}</td>
                          <td style={s.tdR}><ChangeTag pct={pctChange(c.deposit, p.deposit)} /></td>
                          <td style={{ ...s.tdR, color:'#f85149' }}>{fmt(c.withdrawal)}</td>
                          <td style={s.tdR}><ChangeTag pct={pctChange(c.withdrawal, p.withdrawal)} /></td>
                          <td style={{ ...s.tdR, color: net>=0?'#3fb950':'#f85149', fontWeight:700 }}>{fmt(net)}</td>
                        </tr>
                      )
                    })}
                    {/* Total row */}
                    <tr style={s.totRow}>
                      <td style={{ ...s.td, fontWeight:700 }}>TOTAL</td>
                      <td style={s.tdR}>{totalCurr.count}</td>
                      <td style={s.tdR}>{totalCurr.active}</td>
                      <td style={s.tdR}>
                        <span style={{ color: totalCurr.count ? (totalCurr.active/totalCurr.count>=0.9?'#3fb950':'#d29922') : 'var(--muted)', fontWeight:700 }}>
                          {totalCurr.count ? Math.round(totalCurr.active/totalCurr.count*100) : 0}%
                        </span>
                      </td>
                      <td style={{ ...s.tdR, fontWeight:800 }}>{fmt(totalCurr.validBet)}</td>
                      <td style={s.tdR}><ChangeTag pct={pctChange(totalCurr.validBet, totalPrev.validBet)} /></td>
                      <td style={{ ...s.tdR, color:'#3fb950', fontWeight:800 }}>{fmt(totalCurr.deposit)}</td>
                      <td style={s.tdR}><ChangeTag pct={pctChange(totalCurr.deposit, totalPrev.deposit)} /></td>
                      <td style={{ ...s.tdR, color:'#f85149', fontWeight:800 }}>{fmt(totalCurr.withdrawal)}</td>
                      <td style={s.tdR}><ChangeTag pct={pctChange(totalCurr.withdrawal, totalPrev.withdrawal)} /></td>
                      <td style={{ ...s.tdR, color:(totalCurr.deposit-totalCurr.withdrawal)>=0?'#3fb950':'#f85149', fontWeight:800 }}>
                        {fmt(totalCurr.deposit - totalCurr.withdrawal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── DEPOSIT TREND CHART ── */}
          {view === 'summary' && (
            <div style={s.card}>
              <div style={s.cardHdr}>
                <span style={{ fontSize:13, fontWeight:700 }}>📈 {t('tierAnalytics.depositTrend')}</span>
                <span style={{ fontSize:11, color:'var(--muted)' }}>{t('tierAnalytics.groupedByTier')}</span>
              </div>
              <DepositChart
                data={chartData}
                metric={chartMetric}
                onMetricChange={setChartMetric}
                currency={currency}
                t={t}
              />
            </div>
          )}

          {/* ── DETAIL VIEW — per tier member breakdown ── */}
          {view === 'detail' && TIERS.map(tier => {
            const tierMembers = members[tier] || []
            const active = tierMembers.filter(m => m.active)
            const inactive = tierMembers.filter(m => !m.active)
            const tierTotal = data[tier] || {}

            return (
              <div key={tier} style={s.card}>
                <div style={s.cardHdr}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={s.badge(tier)}>{tier}</span>
                    <span style={{ fontSize:13, fontWeight:700 }}>{fmtMonthLabel(month)}</span>
                  </div>
                  <div style={{ display:'flex', gap:20, fontSize:12 }}>
                    <span style={{ color:'var(--muted)' }}>{tierMembers.length} {t('common.members')}</span>
                    <span style={{ color:'#3fb950' }}>{t('common.active')}: {active.length}</span>
                    <span style={{ color:'#f85149' }}>{t('common.inactive')}: {inactive.length}</span>
                    <span style={{ color:TIER_COLOR[tier], fontWeight:700 }}>VB: {fmt(tierTotal.validBet)}</span>
                    <span style={{ color:'#3fb950', fontWeight:700 }}>Dep: {fmt(tierTotal.deposit)}</span>
                    <span style={{ color:'#f85149', fontWeight:700 }}>Wd: {fmt(tierTotal.withdrawal)}</span>
                  </div>
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table style={s.tbl}>
                    <thead>
                      <tr>
                        <th style={s.th}>#</th>
                        <th style={s.th}>{t('common.username')}</th>
                        <th style={s.thR}>{t('common.validBet')}</th>
                        <th style={s.thR}>{t('common.deposit')}</th>
                        <th style={s.thR}>{t('common.withdrawal')}</th>
                        <th style={s.thR}>{t('common.netDepWd').split(' ')[0]}</th>
                        <th style={s.thR}>{t('tierAnalytics.depCount')}</th>
                        <th style={s.thR}>{t('common.daysInactive')}</th>
                        <th style={s.th}>{t('common.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tierMembers.length === 0 ? (
                        <tr><td colSpan={9} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:24 }}>
                          {t('tierAnalytics.noDataFor', { month: fmtMonthLabel(month) })}
                        </td></tr>
                      ) : tierMembers.map((m, i) => {
                        const net = m.deposit - m.withdrawal
                        return (
                          <tr key={m.username}
                            style={{ opacity: m.active ? 1 : 0.6 }}
                            onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                            onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                            <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                            <td style={{ ...s.td, fontWeight:600 }}>{m.username}</td>
                            <td style={{ ...s.tdR, color:TIER_COLOR[tier], fontWeight:m.validBet>0?700:400 }}>
                              {m.active ? fmt(m.validBet) : <span style={{ color:'var(--muted)' }}>—</span>}
                            </td>
                            <td style={{ ...s.tdR, color:'#3fb950' }}>
                              {m.active ? fmt(m.deposit) : <span style={{ color:'var(--muted)' }}>—</span>}
                            </td>
                            <td style={{ ...s.tdR, color:'#f85149' }}>
                              {m.active ? fmt(m.withdrawal) : <span style={{ color:'var(--muted)' }}>—</span>}
                            </td>
                            <td style={{ ...s.tdR, color: net>=0?'#3fb950':'#f85149' }}>
                              {m.active ? fmt(net) : <span style={{ color:'var(--muted)' }}>—</span>}
                            </td>
                            <td style={s.tdR}>{m.active ? (m.depositCount||'—') : '—'}</td>
                            <td style={{ ...s.tdR, color: (m.daysInactive||0)>=60?'#f85149':(m.daysInactive||0)>=30?'#d29922':'var(--muted)' }}>
                              {m.daysInactive !== null ? `${m.daysInactive}d` : '—'}
                            </td>
                            <td style={s.td}>
                              {m.active
                                ? <span style={{ fontSize:11, fontWeight:700, color:'#3fb950', background:'rgba(63,185,80,.1)', padding:'2px 8px', borderRadius:6 }}>{t('common.active')}</span>
                                : <span style={{ fontSize:11, color:'#f85149', background:'rgba(248,81,73,.1)', padding:'2px 8px', borderRadius:6 }}>{t('common.inactive')}</span>
                              }
                            </td>
                          </tr>
                        )
                      })}
                      {/* Tier subtotal */}
                      <tr style={s.totRow}>
                        <td colSpan={2} style={{ ...s.td, fontWeight:700, fontSize:12 }}>{t('tierAnalytics.subtotal')}</td>
                        <td style={{ ...s.tdR, color:TIER_COLOR[tier], fontWeight:800 }}>{fmt(tierTotal.validBet)}</td>
                        <td style={{ ...s.tdR, color:'#3fb950', fontWeight:800 }}>{fmt(tierTotal.deposit)}</td>
                        <td style={{ ...s.tdR, color:'#f85149', fontWeight:800 }}>{fmt(tierTotal.withdrawal)}</td>
                        <td style={{ ...s.tdR, color:(tierTotal.deposit-tierTotal.withdrawal)>=0?'#3fb950':'#f85149', fontWeight:800 }}>
                          {fmt((tierTotal.deposit||0)-(tierTotal.withdrawal||0))}
                        </td>
                        <td style={s.tdR}>{tierTotal.depositCount||'—'}</td>
                        <td colSpan={2} style={s.td} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* ── P+D 3-MONTH TREND VIEW ── */}
      {view === 'pdtrend' && (
        <div style={s.card}>
          <div style={s.cardHdr}>
            <span style={{ fontSize:13, fontWeight:700 }}>📈 Platinum + Diamond — 3-Month Trend ({REGION_LABEL[CURRENCY_REGION[currency]]})</span>
            <span style={{ fontSize:11, color:'var(--muted)' }}>Upgrades/downgrades from tier_change_logs · Churned is an approximation (active last month, inactive this month)</span>
          </div>
          {pdTrendLoading ? (
            <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>{t('common.loading')}</div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={s.tbl}>
                <thead>
                  <tr>
                    <th style={s.th}>{t('common.tier')}</th>
                    <th style={s.th}>{t('common.month')}</th>
                    <th style={s.thR}>{t('common.members')}</th>
                    <th style={s.thR}>{t('common.active')}</th>
                    <th style={s.thR}>{t('common.validBet')}</th>
                    <th style={s.thR}>{t('common.deposit')}</th>
                    <th style={s.thR}>{t('common.withdrawal')}</th>
                    <th style={s.thR}>Upgraded In</th>
                    <th style={s.thR}>Downgraded Out</th>
                    <th style={s.thR}>Approx. Churned</th>
                  </tr>
                </thead>
                <tbody>
                  {pdTrend.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:32 }}>No data for this range.</td></tr>
                  ) : pdTrend.map((r, i) => (
                    <tr key={`${r.tier}-${r.month}`}
                      onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      <td style={s.td}><span style={s.badge(r.tier)}>{r.tier}</span></td>
                      <td style={s.td}>{fmtMonthLabel(r.month)}</td>
                      <td style={s.tdR}>{r.count}</td>
                      <td style={s.tdR}>{r.active}</td>
                      <td style={{ ...s.tdR, color:TIER_COLOR[r.tier], fontWeight:700 }}>{formatMoney(r.validBet, currency)}</td>
                      <td style={{ ...s.tdR, color:'#3fb950' }}>{formatMoney(r.deposit, currency)}</td>
                      <td style={{ ...s.tdR, color:'#f85149' }}>{formatMoney(r.withdrawal, currency)}</td>
                      <td style={{ ...s.tdR, color:'#3fb950', fontWeight:700 }}>{r.upgradesIn > 0 ? '+'+r.upgradesIn : r.upgradesIn}</td>
                      <td style={{ ...s.tdR, color:'#f85149', fontWeight:700 }}>{r.downgradesOut > 0 ? '-'+r.downgradesOut : r.downgradesOut}</td>
                      <td style={{ ...s.tdR, color: r.churned ? '#d29922' : 'var(--muted)' }}>{r.churned === null ? '—' : r.churned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
