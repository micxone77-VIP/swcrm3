// PlayerProfiling.jsx - Weekly VIP Player Profiling Analysis
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { TIER_COLOR, TIER_BG, CURRENCY_LIST, CURRENCY_SYMBOL, CURRENCY_REGION, REGION_LABEL } from '../lib/constants'
import { formatMoney, currentYearMonth } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamBool, useUrlParamsRaw } from '../hooks/useUrlParam'

// ── Player classification by ROI ─────────────────────────────────────────────
const PLAYER_TYPES = [
  { key: 'normal',       label: '普通娱乐玩家', labelEn: 'Normal Recreational', color: '#3fb950', bg: 'rgba(63,185,80,.12)',   min: -15, max: -3  },
  { key: 'good',         label: '优秀玩家',     labelEn: 'Good Player',          color: '#58a6ff', bg: 'rgba(88,166,255,.12)',  min: 0,   max: 3   },
  { key: 'pro',          label: '职业优势玩家', labelEn: 'Professional Advantage',color: '#f59e0b', bg: 'rgba(245,158,11,.12)', min: 3,   max: 8   },
  { key: 'abnormal',     label: '异常高胜率',   labelEn: 'Abnormal High Win Rate',color: '#f85149', bg: 'rgba(248,81,73,.12)',  min: 10,  max: 999 },
  { key: 'unclassified', label: '未分类',       labelEn: 'Unclassified',          color: '#8b949e', bg: 'rgba(139,148,158,.12)',min: -3,  max: 0   },
]

function classifyPlayer(roi) {
  if (roi === null || roi === undefined) return PLAYER_TYPES[4]
  if (roi > 10)          return PLAYER_TYPES[3] // abnormal
  if (roi >= 3)          return PLAYER_TYPES[2] // pro
  if (roi >= 0)          return PLAYER_TYPES[1] // good
  if (roi >= -15)        return PLAYER_TYPES[0] // normal
  return PLAYER_TYPES[4]                         // unclassified (worse than -15%)
}

const TIERS = ['DIAMOND', 'PLATINUM', 'GOLD', 'BLACK']

function fmtPct(n) {
  if (n === null || n === undefined) return '--'
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

const s = {
  page:    { padding: '28px 32px', maxWidth: 1500, margin: '0 auto' },
  card:    { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 },
  cardHdr: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  th:      { padding: '9px 12px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: 'var(--surface2)' },
  td:      { padding: '9px 12px', fontSize: 12, color: 'var(--text)', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' },
  badge:   (bg, color) => ({ background: bg, color, padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }),
  input:   { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 7, fontSize: 12, outline: 'none' },
  toggle:  (active) => ({ background: active?'var(--accent)':'transparent', color: active?'#fff':'var(--muted)', border:'none', padding:'7px 16px', fontSize:12, fontWeight:600, cursor:'pointer' }),
}

export default function PlayerProfiling() {
  const { t, lang } = useLanguage()
  const [players,    setPlayers]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [month,      setMonth]      = useUrlParam('month', currentYearMonth())
  // MYR and SGD must never be summed together — this toggle picks ONE currency
  // at a time for every query and total on this page. See lib/constants.js.
  const [currency,   setCurrency]   = useUrlParam('currency', 'MYR')
  const [tierFilter, setTierFilter] = useUrlParam('tier', 'ALL')
  const [typeFilter, setTypeFilter] = useUrlParam('type', 'ALL')
  const [hostFilter, setHostFilter] = useUrlParam('host', 'ALL')
  const [search,     setSearch]     = useUrlParam('search', '')
  const [sortCol,    setSortCol]    = useUrlParam('sort', 'roi')
  const [sortAsc,    setSortAsc]    = useUrlParamBool('asc', false)
  const [prevStats,  setPrevStats]  = useState(null) // { month, totalVb, totalWl, avgRoi, byType: {key: count} }
  const [combineMode, setCombineMode] = useUrlParamBool('combine2mo', false)
  const urlRaw = useUrlParamsRaw()

  const fmtM = (n) => formatMoney(n, currency)

  useEffect(() => { loadData() }, [month, currency, combineMode])

  async function loadData() {
    setLoading(true)
    // Now sourced from vip_monthly_totals (a view that SUMs vip_daily_snapshots per month),
    // because CSV uploads are daily and each day's numbers are standalone, not cumulative.
    const { data: totals } = await supabase
      .from('vip_monthly_totals')
      .select('username, snapshot_month, tier, total_deposit, total_withdrawal, monthly_valid_bet, win_loss, bet_count, bonus_count, bonus_amount, total_rebate, has_promo, currency, host_assigned, days_with_data')
      .eq('snapshot_month', month)
      .in('tier', TIERS)
      .eq('currency', currency)
      .order('monthly_valid_bet', { ascending: false })

    // Filter out excluded players by cross-checking vip_members (vip_monthly_totals has no is_excluded column)
    // NOTE: don't filter with .in('username', usernames) — with 400+ players this can exceed
    // URL length limits. The excluded-players set is small, so just fetch it directly.
    const { data: excluded, error: excludedErr } = await supabase
      .from('vip_members')
      .select('username')
      .eq('is_excluded', true)
    if (excludedErr) console.error('loadData: excluded players fetch error', excludedErr)
    const excludedSet = new Set((excluded || []).map(e => e.username))
    const data = (totals || []).filter(t => !excludedSet.has(t.username))

    const enriched = (data || []).map(p => {
      const vb      = parseFloat(p.monthly_valid_bet) || 0
      const wl      = parseFloat(p.win_loss) || 0
      const rebate  = parseFloat(p.total_rebate) || 0
      const bets    = parseInt(p.bet_count) || 0
      const bonus   = parseFloat(p.bonus_amount) || 0

      // ROI = win_loss / valid_bet * 100  (positive = player winning = bad for platform)
      const roi          = vb > 0 ? (wl / vb * 100) : null
      // Avg bet = valid_bet / bet_count
      const avg_bet      = bets > 0 ? vb / bets : null
      // Rebate rate = total_rebate / valid_bet * 100
      const rebate_rate  = vb > 0 ? (rebate / vb * 100) : null
      // LTV ROI using total deposit/withdrawal
      const dep          = parseFloat(p.total_deposit) || 0
      const wd           = parseFloat(p.total_withdrawal) || 0
      const ltv_roi      = dep > 0 ? ((dep - wd) / dep * 100) : null
      const playerType   = classifyPlayer(roi)

      return { ...p, vb, wl, rebate, bets, bonus, roi, avg_bet, rebate_rate, ltv_roi, playerType }
    })
    setPlayers(enriched)
    setLoading(false)
    loadPrevMonthComparison(month)
    if (combineMode) loadCombinedWinLoss(month, enriched)
  }

  // Fetches the previous month's per-player win_loss and adds it to this
  // month's, per username — so "biggest loser across the last 2 months" can
  // be found in one sorted list instead of checking two months by hand.
  // Takes the freshly-loaded `enriched` array directly rather than reading
  // `players` state, since state updates aren't synchronous and this runs
  // right after loadData's own setPlayers call.
  async function loadCombinedWinLoss(currentMonth, currentPlayers) {
    const { data: monthRows } = await supabase
      .from('vip_monthly_totals')
      .select('snapshot_month')
      .lt('snapshot_month', currentMonth)
      .order('snapshot_month', { ascending: false })
      .limit(1)
    const prevMonth = monthRows?.[0]?.snapshot_month
    if (!prevMonth) return // no earlier month exists — combinedWl just equals this month's

    const { data: prevSnap, error } = await supabase
      .from('vip_monthly_totals')
      .select('username, win_loss')
      .eq('snapshot_month', prevMonth)
      .in('tier', TIERS)
      .eq('currency', currency)
    if (error) { console.error('loadCombinedWinLoss error', error); return }

    const prevWlByUser = {}
    ;(prevSnap || []).forEach(p => { prevWlByUser[p.username] = parseFloat(p.win_loss) || 0 })

    setPlayers(current => current.map(p => ({
      ...p,
      combinedWl: p.wl + (prevWlByUser[p.username] || 0),
      hasPrevMonth: p.username in prevWlByUser,
    })))
  }

  // Find the most recent vip_monthly_totals month BEFORE the selected month, and compute comparable stats
  async function loadPrevMonthComparison(currentMonth) {
    setPrevStats(null)
    const { data: monthRows } = await supabase
      .from('vip_monthly_totals')
      .select('snapshot_month')
      .lt('snapshot_month', currentMonth)
      .order('snapshot_month', { ascending: false })
      .limit(1)

    const prevMonth = monthRows?.[0]?.snapshot_month
    if (!prevMonth) return // no earlier month exists, nothing to compare

    const { data: snap } = await supabase
      .from('vip_monthly_totals')
      .select('username, tier, monthly_valid_bet, win_loss, bet_count, currency')
      .eq('snapshot_month', prevMonth)
      .in('tier', TIERS)
      .eq('currency', currency)

    if (!snap || snap.length === 0) return

    let totalVb = 0, totalWl = 0, roiSum = 0, roiCount = 0
    const byType = {}
    PLAYER_TYPES.forEach(t => { byType[t.key] = 0 })

    snap.forEach(p => {
      const vb = parseFloat(p.monthly_valid_bet) || 0
      const wl = parseFloat(p.win_loss) || 0
      totalVb += vb
      totalWl += wl
      const roi = vb > 0 ? (wl / vb * 100) : null
      if (roi !== null) { roiSum += roi; roiCount++ }
      const pt = classifyPlayer(roi)
      byType[pt.key] = (byType[pt.key] || 0) + 1
    })


    setPrevStats({
      month: prevMonth,
      total: snap.length,
      totalVb,
      totalWl,
      avgRoi: roiCount > 0 ? roiSum / roiCount : null,
      byType,
    })
  }

  // Filters
  let filtered = players
  if (tierFilter !== 'ALL') filtered = filtered.filter(p => p.tier === tierFilter)
  if (hostFilter !== 'ALL') filtered = filtered.filter(p => p.host_assigned === hostFilter)
  if (typeFilter !== 'ALL') filtered = filtered.filter(p => p.playerType.key === typeFilter)
  if (search.trim()) filtered = filtered.filter(p => p.username.toLowerCase().includes(search.toLowerCase()))

  // Sort
  filtered = [...filtered].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol]
    if (av === null || av === undefined) av = sortAsc ? Infinity : -Infinity
    if (bv === null || bv === undefined) bv = sortAsc ? Infinity : -Infinity
    return sortAsc ? av - bv : bv - av
  })

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(s => !s)
    else { setSortCol(col); setSortAsc(false) }
  }

  // Summary stats — `players` is already scoped to a single currency (see loadData), so
  // these sums are safe: never mixing MYR and SGD into one number.
  const total        = players.length
  const byType       = PLAYER_TYPES.map(t => ({ ...t, count: players.filter(p => p.playerType.key === t.key).length }))
  const abnormalCount = players.filter(p => p.playerType.key === 'abnormal').length
  const proCount      = players.filter(p => p.playerType.key === 'pro').length
  const avgRoi        = players.filter(p => p.roi !== null).length > 0
    ? players.filter(p => p.roi !== null).reduce((s, p) => s + p.roi, 0) / players.filter(p => p.roi !== null).length
    : null
  const totalVb       = players.reduce((s, p) => s + p.vb, 0)
  const totalWl       = players.reduce((s, p) => s + p.wl, 0)
  const promoPlayers  = players.filter(p => p.has_promo).length

  const SortIcon = ({ col }) => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : ''

  const months = []
  for (let i = 0; i < 6; i++) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
  }

  // Render a small comparison delta badge (↑/↓ vs prev month)
  function DeltaBadge({ current, previous, suffix = '', invert = false }) {
    if (!prevStats || previous === null || previous === undefined || current === null || current === undefined) return null
    const diff = current - previous
    if (Math.abs(diff) < 0.0001) return <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>{t('playerProfiling.flatVsMonth', { month: prevStats.month })}</span>
    const isUp = diff > 0
    const good = invert ? !isUp : isUp
    const color = good ? '#3fb950' : '#f85149'
    const arrow = isUp ? '↑' : '↓'
    const display = suffix === '%' ? Math.abs(diff).toFixed(1) + '%' : fmtM(Math.abs(diff))
    return (
      <span style={{ fontSize: 10, color, marginLeft: 6, fontWeight: 700 }}>
        {arrow} {display} vs {prevStats.month}
      </span>
    )
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>VIP Player Profiling</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Weekly analysis - ROI classification & behavior metrics — {REGION_LABEL[CURRENCY_REGION[currency]]} ({CURRENCY_SYMBOL[currency]}) only</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {CURRENCY_LIST.map(c => (
              <button key={c} onClick={() => setCurrency(c)} style={s.toggle(currency === c)}>
                {REGION_LABEL[CURRENCY_REGION[c]]} ({CURRENCY_SYMBOL[c]})
              </button>
            ))}
          </div>
          <select value={month} onChange={e => setMonth(e.target.value)} style={{ ...s.input, fontWeight: 700 }}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Summary stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total VIPs', value: total, color: '#58a6ff', delta: <DeltaBadge current={total} previous={prevStats?.total} /> },
          { label: t('playerProfiling.statTotalTurnover'), value: fmtM(totalVb), color: '#a78bfa', delta: <DeltaBadge current={totalVb} previous={prevStats?.totalVb} /> },
          { label: t('playerProfiling.statPlatformPnl'), value: fmtM(-totalWl), color: totalWl > 0 ? '#f85149' : '#3fb950', delta: <DeltaBadge current={-totalWl} previous={prevStats ? -prevStats.totalWl : null} /> },
          { label: t('playerProfiling.statAvgRoi'), value: fmtPct(avgRoi ? -avgRoi : null), color: '#f59e0b', delta: <DeltaBadge current={avgRoi ? -avgRoi : null} previous={prevStats?.avgRoi !== null && prevStats?.avgRoi !== undefined ? -prevStats.avgRoi : null} suffix="%" invert /> },
          { label: t('playerProfiling.statAbnormal'), value: abnormalCount, color: '#f85149', delta: <DeltaBadge current={abnormalCount} previous={prevStats?.byType?.abnormal} invert /> },
          { label: t('playerProfiling.statPro'), value: proCount, color: '#f59e0b', delta: <DeltaBadge current={proCount} previous={prevStats?.byType?.pro} invert /> },
          { label: t('playerProfiling.statClaimedPromo'), value: promoPlayers, color: '#3fb950' },
        ].map((st, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{st.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: st.color }}>{st.value}</div>
            {st.delta && <div style={{ marginTop: 4 }}>{st.delta}</div>}
          </div>
        ))}
      </div>

      {/* Player type breakdown */}
      <div style={s.card}>
        <div style={s.cardHdr}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{t('playerProfiling.playerTypeDistribution')}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{month} · {t('playerProfiling.roiFormula')}</span>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {byType.map(pt => (
            <div key={pt.key} onClick={() => setTypeFilter(typeFilter === pt.key ? 'ALL' : pt.key)}
              style={{ background: typeFilter === pt.key ? pt.bg : 'var(--surface2)', border: `2px solid ${typeFilter === pt.key ? pt.color : 'var(--border)'}`, borderRadius: 10, padding: '12px 20px', cursor: 'pointer', minWidth: 140, transition: 'all .15s' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: pt.color }}>{pt.count}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: pt.color }}>{lang === 'en' ? pt.labelEn : pt.label}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                {pt.key === 'abnormal' ? 'ROI > +10%' :
                 pt.key === 'pro'      ? 'ROI +3% ~ +8%' :
                 pt.key === 'good'     ? 'ROI 0 ~ +3%' :
                 pt.key === 'normal'   ? 'ROI -3% ~ -15%' : 'ROI < -15% or N/A'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {total > 0 ? Math.round(pt.count / total * 100) : 0}%
              </div>
              <DeltaBadge current={pt.count} previous={prevStats?.byType?.[pt.key]} invert={pt.key === 'abnormal' || pt.key === 'pro'} />
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search username..." style={{ ...s.input, width: 200 }} />
        <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} style={s.input}>
          <option value="ALL">All Tiers</option>
          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={hostFilter} onChange={e => setHostFilter(e.target.value)} style={s.input}>
          <option value="ALL">All Hosts</option>
          <option value="Marcus">Marcus</option>
          <option value="Angel">Angel</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={s.input}>
          <option value="ALL">All Types</option>
          {PLAYER_TYPES.map(pt => <option key={pt.key} value={pt.key}>{lang === 'en' ? pt.labelEn : pt.label}</option>)}
        </select>
        {(typeFilter !== 'ALL' || tierFilter !== 'ALL' || search) && (
          <button onClick={() => urlRaw.set({ type: 'ALL', tier: 'ALL', search: '' }, { type: 'ALL', tier: 'ALL', search: '' })}
            style={{ ...s.input, cursor: 'pointer', color: 'var(--accent)' }}>Clear</button>
        )}
        <button
          onClick={() => {
            const turningOn = !combineMode
            setCombineMode(turningOn)
            if (turningOn) urlRaw.set({ sort: 'combinedWl', asc: 'true' }, { sort: 'roi', asc: 'false' })
          }}
          style={{ ...s.input, cursor: 'pointer', background: combineMode ? 'var(--accent)' : undefined, color: combineMode ? '#fff' : undefined, borderColor: combineMode ? 'var(--accent)' : undefined }}>
          {combineMode ? '✓ ' : ''}Combine with Previous Month
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{filtered.length} players</span>
      </div>

      {/* Main Table */}
      <div style={s.card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={s.th}>#</th>
                <th style={s.th}>Username</th>
                <th style={s.th}>Tier</th>
                <th style={s.th}>{t('playerProfiling.colType')}</th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('roi')}>{t('playerProfiling.colRoiThisMonth')}<SortIcon col="roi" /></th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('vb')}>{t('common.validBet')}<SortIcon col="vb" /></th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('wl')}>{t('common.winLoss')}<SortIcon col="wl" /></th>
                {combineMode && (
                  <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('combinedWl')}>Combined W/L (2mo)<SortIcon col="combinedWl" /></th>
                )}
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('avg_bet')}>{t('playerProfiling.colAvgBet')}<SortIcon col="avg_bet" /></th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('bets')}>{t('playerProfiling.colBetCount')}<SortIcon col="bets" /></th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('rebate_rate')}>{t('playerProfiling.colRebateRate')}<SortIcon col="rebate_rate" /></th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('rebate')}>{t('playerProfiling.colRebateAmount')}<SortIcon col="rebate" /></th>
                <th style={s.th}>Promo</th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('bonus')}>{t('playerProfiling.colBonusAmount')}<SortIcon col="bonus" /></th>
                <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort('ltv_roi')}>LTV ROI<SortIcon col="ltv_roi" /></th>
                <th style={s.th}>Host</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 40 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={15} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
                  {players.length === 0 ? `No data for ${month} — import CSV for this month first` : 'No players match filters'}
                </td></tr>
              ) : filtered.map((p, i) => {
                const pt = p.playerType
                return (
                  <tr key={p.username}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...s.td, color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td style={{ ...s.td, fontWeight: 700 }}>{p.username}</td>
                    <td style={s.td}>
                      <span style={s.badge(TIER_BG[p.tier]||'', TIER_COLOR[p.tier]||'var(--muted)')}>{p.tier}</span>
                    </td>
                    <td style={s.td}>
                      <span style={s.badge(pt.bg, pt.color)}>{lang === 'en' ? pt.labelEn : pt.label}</span>
                    </td>
                    {/* ROI */}
                    <td style={{ ...s.td, fontWeight: 700 }}>
                      {p.roi !== null ? (
                        <span style={{ color: p.roi > 0 ? '#f85149' : '#3fb950', fontWeight: 700 }}>
                          {fmtPct(p.roi)}
                        </span>
                      ) : <span style={{ color: 'var(--muted)' }}>--</span>}
                    </td>
                    <td style={{ ...s.td, fontWeight: 600 }}>{fmtM(p.vb)}</td>
                    <td style={{ ...s.td, fontWeight: 600, color: p.wl > 0 ? '#f85149' : '#3fb950' }}>
                      {p.wl !== 0 ? fmtM(p.wl) : '--'}
                    </td>
                    {combineMode && (
                      <td style={{ ...s.td, fontWeight: 700, color: (p.combinedWl ?? p.wl) > 0 ? '#f85149' : '#3fb950' }}>
                        {p.combinedWl !== undefined ? fmtM(p.combinedWl) : fmtM(p.wl)}
                        {p.hasPrevMonth === false && <span title="No data for previous month — this month only" style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>*</span>}
                      </td>
                    )}
                    {/* Avg bet */}
                    <td style={s.td}>{p.avg_bet !== null ? fmtM(p.avg_bet) : '--'}</td>
                    {/* Bet count */}
                    <td style={{ ...s.td, color: 'var(--muted)' }}>{p.bets > 0 ? p.bets.toLocaleString() : '--'}</td>
                    {/* Rebate rate */}
                    <td style={{ ...s.td, color: '#f59e0b' }}>
                      {p.rebate_rate !== null ? fmtPct(p.rebate_rate) : '--'}
                    </td>
                    {/* Rebate amount */}
                    <td style={s.td}>{p.rebate > 0 ? fmtM(p.rebate) : '--'}</td>
                    {/* Promo */}
                    <td style={s.td}>
                      {p.has_promo
                        ? <span style={s.badge('rgba(63,185,80,.12)', '#3fb950')}>Yes ({p.bonus_count}x)</span>
                        : <span style={{ color: 'var(--muted)', fontSize: 11 }}>No</span>}
                    </td>
                    {/* Bonus amount */}
                    <td style={s.td}>{p.bonus > 0 ? fmtM(p.bonus) : '--'}</td>
                    {/* LTV ROI */}
                    <td style={{ ...s.td, fontSize: 11 }}>
                      {p.ltv_roi !== null ? (
                        <span style={{ color: p.ltv_roi > 0 ? '#3fb950' : '#f85149' }}>
                          {fmtPct(p.ltv_roi)}
                        </span>
                      ) : '--'}
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: 'var(--muted)' }}>{p.host_assigned || '--'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer legend */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('playerProfiling.footerRoi')}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('playerProfiling.footerAvgBet')}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('playerProfiling.footerRebateRate')}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('playerProfiling.footerLtvRoi')}</span>
        </div>
      </div>
    </div>
  )
}
