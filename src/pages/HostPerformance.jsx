// src/pages/HostPerformance.jsx — Host VIP Performance Comparison
// Compare Marcus vs Angel's players week-over-week across GOLD/PLATINUM/DIAMOND
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/format'

/* ─── Tier config ─── */
const TIERS = ['GOLD', 'PLATINUM', 'DIAMOND']
const TIER_COLOR = { GOLD: '#F59E0B', PLATINUM: '#94A3B8', DIAMOND: '#818CF8' }
const TIER_NEXT_VB = { GOLD: 2_000_000, PLATINUM: 6_000_000, DIAMOND: 8_000_000 }
const TIER_NEXT_LABEL = { GOLD: '→ PLAT', PLATINUM: '→ DIAM', DIAMOND: '✓ MAX' }

/* ─── Date helpers ─── */
function toDateStr(d) { return d.toISOString().slice(0, 10) }
function getMonday(d) {
  const date = new Date(d)
  const day = date.getDay()
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day))
  return date
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }

function weekRanges() {
  const today = new Date()
  const mon0 = getMonday(today)
  const mon1 = addDays(mon0, -7)
  const mon2 = addDays(mon0, -14)
  return [
    { label: 'This Week', start: toDateStr(mon0), end: toDateStr(today) },
    { label: 'Last Week', start: toDateStr(mon1), end: toDateStr(addDays(mon0, -1)) },
    { label: '2 Weeks Ago', start: toDateStr(mon2), end: toDateStr(addDays(mon1, -1)) },
  ]
}

/* ─── Data fetch helpers ─── */
async function fetchSnapshots(tiers, startA, endA, startB, endB, currency = 'MYR') {
  const minDate = startB < startA ? startB : startA
  const maxDate = endA > endB ? endA : endB
  let all = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('vip_daily_snapshots')
      .select('username, tier, snapshot_date, total_deposit, monthly_valid_bet, bet_count, win_loss')
      .in('tier', tiers)
      .eq('currency', currency)
      .gte('snapshot_date', minDate)
      .lte('snapshot_date', maxDate)
      .range(from, from + 999)
    if (error) { console.error('fetchSnapshots', error); break }
    all = all.concat(data || [])
    if (!data || data.length < 1000) break
    from += 1000
  }
  return all
}

async function fetchVipMembers(tiers) {
  let all = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('vip_members')
      .select('username, tier, host_assigned, days_inactive, last_deposit_date, currency, whatsapp, is_excluded')
      .in('tier', tiers)
      .range(from, from + 999)
    if (error) { console.error('fetchVipMembers', error); break }
    all = all.concat(data || [])
    if (!data || data.length < 1000) break
    from += 1000
  }
  return all
}

async function fetchContactStats(startA, endA) {
  // Get recent contact counts per host for the current period
  const { data, error } = await supabase
    .from('campaign_player_contacts')
    .select('host, contact_type, contacted_at, notes')
    .gte('contacted_at', startA + 'T00:00:00')
    .lte('contacted_at', endA + 'T23:59:59')
    .order('contacted_at', { ascending: false })
    .limit(2000)
  if (error) { console.error('fetchContactStats', error) }
  return data || []
}

/* ─── Metric computation ─── */
function metricsInPeriod(snaps, start, end) {
  // Get latest snapshot per player in period (represents running total)
  const byUser = {}
  snaps.filter(s => s.snapshot_date >= start && s.snapshot_date <= end).forEach(s => {
    if (!byUser[s.username] || s.snapshot_date > byUser[s.username].snapshot_date) {
      byUser[s.username] = s
    }
  })
  return byUser // { username → latest snap in period }
}

/* ─── Number formatters ─── */
const fmtNum = n => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M'
  : n >= 1_000 ? (n / 1_000).toFixed(1) + 'K'
  : String(Math.round(n))

const fmtDelta = (curr, prev) => {
  if (!prev || !curr) return null
  const d = curr - prev
  const pct = prev > 0 ? ((d / prev) * 100).toFixed(1) : null
  return { d, pct }
}

const DeltaBadge = ({ curr, prev }) => {
  const info = fmtDelta(curr, prev)
  if (!info) return null
  const up = info.d >= 0
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, marginLeft: 4,
      color: up ? '#22C55E' : '#EF4444',
      background: up ? '#22C55E18' : '#EF444418',
      borderRadius: 4, padding: '1px 5px',
    }}>
      {up ? '▲' : '▼'} {info.pct ? info.pct + '%' : fmtNum(Math.abs(info.d))}
    </span>
  )
}

/* ─── Tier progress bar ─── */
// monthVb = running monthly total (for upgrade threshold progress)
// weekVb  = this-week-only contribution (earned in the selected period)
function TierBar({ monthVb, weekVb, tier }) {
  const target = TIER_NEXT_VB[tier]
  const pct = Math.min((monthVb / target) * 100, 100)
  const color = TIER_COLOR[tier]
  const isDiamond = tier === 'DIAMOND'
  const remaining = Math.max(0, target - monthVb)
  return (
    <div style={{ width: '100%', minWidth: 180 }}>
      {/* Monthly total vs threshold */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>
        <span>Monthly: <strong style={{ color: 'var(--text)' }}>{fmtNum(monthVb)}</strong></span>
        <span style={{ color }}>{isDiamond ? '✓ MAX TIER' : `${TIER_NEXT_LABEL[tier]} @ ${fmtNum(target)}`}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 3, transition: 'width .3s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 10 }}>
        {/* This week's contribution */}
        <span style={{ color: weekVb > 0 ? '#22C55E' : 'var(--muted)' }}>
          +{fmtNum(weekVb)} this wk
        </span>
        {/* Remaining to upgrade */}
        {!isDiamond && (
          <span style={{ color: remaining <= 200_000 ? '#F59E0B' : 'var(--disabled)' }}>
            {remaining <= 0 ? '🎯 Ready!' : `${fmtNum(remaining)} left`}
          </span>
        )}
      </div>
    </div>
  )
}

/* ─── Excel export ─── */
async function exportExcel(rows, periodLabel, prevLabel) {
  const { utils, writeFile } = await import('xlsx')
  const header = [
    'Username', 'Tier', 'Host', 'Days Inactive', 'Last Deposit',
    `${periodLabel} Deposits`, `${prevLabel} Deposits`, 'Deposit Δ%',
    `${periodLabel} Week VB`, 'Monthly VB (Running)', 'Monthly VB Remaining', 'Upgrade Progress %',
  ]
  const data = rows.map(r => {
    const depDelta = r.prevDeposit > 0 ? (((r.deposit - r.prevDeposit) / r.prevDeposit) * 100).toFixed(1) + '%' : '-'
    const target = TIER_NEXT_VB[r.tier]
    const remaining = Math.max(0, target - r.monthVb)
    const progress = ((r.monthVb / target) * 100).toFixed(1) + '%'
    return [
      r.username, r.tier, r.host || '-', r.daysInactive ?? '-', r.lastDeposit || '-',
      r.deposit, r.prevDeposit || 0, depDelta,
      r.weekVb, r.monthVb,
      remaining === 0 ? 'MAX' : remaining, progress,
    ]
  })
  const ws = utils.aoa_to_sheet([header, ...data])
  ws['!cols'] = header.map((h, i) => ({ wch: [12, 10, 14, 12, 12, 16, 16, 9, 16, 16, 9, 16, 12][i] || 14 }))
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'Host Performance')
  const date = new Date().toISOString().slice(0, 10)
  writeFile(wb, `host_performance_${date}.xlsx`)
}

/* ════════════════════════════════════════════════
   Main component
════════════════════════════════════════════════ */
export default function HostPerformance() {
  const weeks = useMemo(() => weekRanges(), [])

  // Period selection
  const [periodA, setPeriodA] = useState(0) // index into weeks[] OR -1 for custom
  const [periodB, setPeriodB] = useState(1)
  const [customA, setCustomA] = useState({ start: '', end: '' })
  const [customB, setCustomB] = useState({ start: '', end: '' })
  const [showCustom, setShowCustom] = useState(false)

  // Filters
  const [selectedTiers, setSelectedTiers] = useState(['GOLD', 'PLATINUM', 'DIAMOND'])
  const [hostFilter, setHostFilter] = useState('all')
  const [sortBy, setSortBy] = useState('vb') // 'vb' | 'deposit' | 'days' | 'delta'
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(true) // show >30 days inactive

  // Data
  const [loading, setLoading] = useState(false)
  const [playerRows, setPlayerRows] = useState([])
  const [contactStats, setContactStats] = useState([])
  const [hosts, setHosts] = useState([]) // discovered host list

  const periodARange = periodA === -1 ? customA : weeks[periodA]
  const periodBRange = periodB === -1 ? customB : weeks[periodB]

  const load = useCallback(async () => {
    if (!periodARange?.start || !periodARange?.end) return
    setLoading(true)
    try {
      const tiers = selectedTiers.length ? selectedTiers : TIERS
      const [snaps, members, contacts] = await Promise.all([
        fetchSnapshots(tiers, periodARange.start, periodARange.end,
          periodBRange?.start || periodARange.start, periodBRange?.end || periodARange.end),
        fetchVipMembers(tiers),
        fetchContactStats(periodARange.start, periodARange.end),
      ])

      setContactStats(contacts)

      // Index members by username
      const memberMap = {}
      members.forEach(m => { memberMap[m.username] = m })

      // Collect unique hosts
      const hostSet = new Set()
      members.forEach(m => { if (m.host_assigned) hostSet.add(m.host_assigned) })
      setHosts([...hostSet].sort())

      // Get metrics per period
      const curMetrics = metricsInPeriod(snaps, periodARange.start, periodARange.end)
      const prevMetrics = periodBRange
        ? metricsInPeriod(snaps, periodBRange.start, periodBRange.end)
        : {}

      // Build rows — one per player
      const rows = []
      const allUsernames = new Set([...Object.keys(curMetrics), ...members.map(m => m.username)])
      allUsernames.forEach(uname => {
        const m = memberMap[uname]
        if (!m) return // no member record
        if (!tiers.includes(m.tier)) return
        const cur = curMetrics[uname]
        const prev = prevMetrics[uname]
        // monthVb = running monthly total at end of current period (for tier progress)
        // weekVb  = VB earned ONLY in the selected period = current minus previous period's total
        const monthVb = cur?.monthly_valid_bet || 0
        const prevMonthVb = prev?.monthly_valid_bet || 0
        const weekVb = Math.max(0, monthVb - prevMonthVb)
        rows.push({
          username: uname,
          tier: m.tier,
          host: m.host_assigned || '-',
          daysInactive: m.days_inactive,
          lastDeposit: m.last_deposit_date,
          deposit: cur?.total_deposit || 0,
          prevDeposit: prev?.total_deposit || 0,
          weekVb,          // this period's VB only
          monthVb,         // running monthly total (for tier upgrade bar)
          prevMonthVb,     // previous period's running total
          betCount: cur?.bet_count || 0,
          winLoss: cur?.win_loss || 0,
          isExcluded: m.is_excluded,
          whatsapp: m.whatsapp,
        })
      })
      setPlayerRows(rows)
    } finally {
      setLoading(false)
    }
  }, [periodARange?.start, periodARange?.end, periodBRange?.start, periodBRange?.end, selectedTiers])

  useEffect(() => { load() }, [load])

  // Filtered + sorted rows
  const visibleRows = useMemo(() => {
    let r = playerRows.filter(row => {
      if (hostFilter !== 'all' && row.host !== hostFilter) return false
      if (search && !row.username.toLowerCase().includes(search.toLowerCase())) return false
      if (!showInactive && row.daysInactive > 30) return false
      return true
    })
    r.sort((a, b) => {
      if (sortBy === 'vb') return b.weekVb - a.weekVb
      if (sortBy === 'deposit') return b.deposit - a.deposit
      if (sortBy === 'days') return (a.daysInactive ?? 999) - (b.daysInactive ?? 999)
      if (sortBy === 'delta') return b.weekVb - a.weekVb // sort by this-week earnings
      if (sortBy === 'monthly') return b.monthVb - a.monthVb
      return 0
    })
    return r
  }, [playerRows, hostFilter, search, showInactive, sortBy])

  // Per-host summary
  const hostSummary = useMemo(() => {
    const map = {}
    visibleRows.forEach(r => {
      if (!map[r.host]) map[r.host] = { host: r.host, count: 0, deposit: 0, prevDeposit: 0, weekVb: 0, prevWeekVb: 0, active: 0 }
      const h = map[r.host]
      h.count++
      h.deposit += r.deposit
      h.prevDeposit += r.prevDeposit
      h.weekVb += r.weekVb
      // prev week VB = prevMonthVb minus the week before that (we don't have that, so skip delta for cards)
      if (r.daysInactive <= 7) h.active++
    })
    return Object.values(map).sort((a, b) => b.weekVb - a.weekVb)
  }, [visibleRows])

  // Contact stats per host
  const hostContactCounts = useMemo(() => {
    const map = {}
    contactStats.forEach(c => {
      const h = c.host || 'Unknown'
      if (!map[h]) map[h] = 0
      map[h]++
    })
    return map
  }, [contactStats])

  const labelA = periodA === -1 ? 'Custom A' : weeks[periodA]?.label
  const labelB = periodB === -1 ? 'Custom B' : weeks[periodB]?.label

  function toggleTier(t) {
    setSelectedTiers(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    )
  }

  const sectionStyle = {
    background: 'var(--surface)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    padding: '18px 20px',
    marginBottom: 18,
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', color: 'var(--text)' }}>

      {/* ─── Header ─── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>🏆 Host Performance</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Compare VIP player performance across hosts, week-over-week
          </p>
        </div>
        <button
          onClick={() => exportExcel(visibleRows, labelA, labelB || '-')}
          style={{
            background: '#22C55E', color: '#fff', border: 'none', borderRadius: 8,
            padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
          }}
        >
          📥 Export Excel
        </button>
      </div>

      {/* ─── Filters ─── */}
      <div style={{ ...sectionStyle, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>

        {/* Period A */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Current Period
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            {weeks.map((w, i) => (
              <button key={i} onClick={() => { setPeriodA(i); setShowCustom(false) }}
                style={{
                  padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                  border: '1px solid ' + (periodA === i ? 'var(--brand)' : 'var(--border)'),
                  background: periodA === i ? 'rgba(255,106,0,.12)' : 'var(--surface2)',
                  color: periodA === i ? 'var(--brand)' : 'var(--muted)',
                }}>
                {w.label}
              </button>
            ))}
            <button onClick={() => { setPeriodA(-1); setShowCustom(true) }}
              style={{
                padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                border: '1px solid ' + (periodA === -1 ? 'var(--brand)' : 'var(--border)'),
                background: periodA === -1 ? 'rgba(255,106,0,.12)' : 'var(--surface2)',
                color: periodA === -1 ? 'var(--brand)' : 'var(--muted)',
              }}>Custom</button>
          </div>
          {showCustom && periodA === -1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input type="date" value={customA.start} onChange={e => setCustomA(p => ({ ...p, start: e.target.value }))}
                style={{ fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', padding: '4px 8px' }} />
              <span style={{ lineHeight: '28px', color: 'var(--muted)' }}>→</span>
              <input type="date" value={customA.end} onChange={e => setCustomA(p => ({ ...p, end: e.target.value }))}
                style={{ fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', padding: '4px 8px' }} />
            </div>
          )}
        </div>

        {/* Period B (compare to) */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Compare To
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setPeriodB(null)}
              style={{
                padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                border: '1px solid ' + (periodB === null ? 'var(--border)' : 'var(--border)'),
                background: periodB === null ? 'var(--surface)' : 'var(--surface2)',
                color: 'var(--muted)',
              }}>None</button>
            {weeks.map((w, i) => (
              <button key={i} onClick={() => setPeriodB(i)}
                style={{
                  padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                  border: '1px solid ' + (periodB === i ? '#818CF8' : 'var(--border)'),
                  background: periodB === i ? '#818CF818' : 'var(--surface2)',
                  color: periodB === i ? '#818CF8' : 'var(--muted)',
                }}>
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tier filter */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>Tier</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {TIERS.map(t => (
              <button key={t} onClick={() => toggleTier(t)}
                style={{
                  padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                  border: '1px solid ' + (selectedTiers.includes(t) ? TIER_COLOR[t] : 'var(--border)'),
                  background: selectedTiers.includes(t) ? TIER_COLOR[t] + '22' : 'var(--surface2)',
                  color: selectedTiers.includes(t) ? TIER_COLOR[t] : 'var(--muted)',
                }}>{t}</button>
            ))}
          </div>
        </div>

        {/* Host filter */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>Host</label>
          <select value={hostFilter} onChange={e => setHostFilter(e.target.value)}
            style={{ fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', padding: '6px 10px', cursor: 'pointer' }}>
            <option value="all">All Hosts</option>
            {hosts.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>

        {/* Search */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Username…"
            style={{ fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', padding: '6px 10px', width: 130 }} />
        </div>

        {/* Inactive toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--muted)', cursor: 'pointer', paddingBottom: 1 }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: 'var(--brand)', cursor: 'pointer' }} />
          Show 30+ day inactive
        </label>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13, paddingBottom: 1 }}>
            <div style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            Loading…
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}
      </div>

      {/* ─── Host Summary Cards ─── */}
      {hostSummary.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(hostSummary.length, 4)}, 1fr)`, gap: 14, marginBottom: 18 }}>
          {hostSummary.map(h => (
            <div key={h.host} style={{ ...sectionStyle, marginBottom: 0, cursor: 'pointer', transition: 'border-color .15s', borderColor: hostFilter === h.host ? 'var(--brand)' : 'var(--border)' }}
              onClick={() => setHostFilter(hostFilter === h.host ? 'all' : h.host)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{h.host === '-' ? 'Unassigned' : h.host.split('@')[0]}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{h.count} players · {h.active} active 7d</div>
                </div>
                <div style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--muted)' }}>
                  {hostContactCounts[h.host] || 0} contacts
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>Total Deposit</div>
                  <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{fmtNum(h.deposit)}</div>
                  <DeltaBadge curr={h.deposit} prev={h.prevDeposit} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>This Week VB</div>
                  <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{fmtNum(h.weekVb)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Sort bar + count ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Showing <strong style={{ color: 'var(--text)' }}>{visibleRows.length}</strong> players
          {periodBRange ? <> · comparing <span style={{ color: '#818CF8' }}>{labelA}</span> vs <span style={{ color: '#818CF8' }}>{labelB}</span></> : null}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Sort:</span>
          {[['vb', '📊 Week VB'], ['monthly', '📅 Monthly VB'], ['deposit', '💰 Deposit'], ['days', '💤 Inactive']].map(([k, lbl]) => (
            <button key={k} onClick={() => setSortBy(k)}
              style={{
                fontSize: 12, padding: '4px 9px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                border: '1px solid ' + (sortBy === k ? 'var(--brand)' : 'var(--border)'),
                background: sortBy === k ? 'rgba(255,106,0,.12)' : 'var(--surface2)',
                color: sortBy === k ? 'var(--brand)' : 'var(--muted)',
              }}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* ─── Player Table ─── */}
      <div style={{ ...sectionStyle, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)', borderBottom: '2px solid var(--border)' }}>
              {[
                ['Username', '140px'],
                ['Tier', '80px'],
                ['Host', '120px'],
                ['Days Inactive', '90px'],
                [labelA + ' Deposit', '130px'],
                [labelB ? labelB + ' Deposit' : null, '130px'],
                ['This Week VB', '130px'],
                [labelB ? labelB + ' Wk VB' : null, '120px'],
                ['Monthly Progress → Next Tier', '220px'],
              ].filter(([h]) => h != null).map(([h, w]) => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', whiteSpace: 'nowrap', width: w }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && !loading && (
              <tr><td colSpan={9} style={{ padding: '40px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No data found. Try loading data first.</td></tr>
            )}
            {visibleRows.map((r, idx) => {
              const isInactive30 = r.daysInactive > 30
              const isInactive7 = r.daysInactive > 7
              return (
                <tr key={r.username} style={{
                  borderBottom: '1px solid var(--border)',
                  background: idx % 2 === 0 ? 'transparent' : 'var(--surface2)',
                  opacity: isInactive30 ? 0.65 : 1,
                }}>
                  {/* Username */}
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.username}</div>
                    {r.lastDeposit && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>Last dep: {r.lastDeposit}</div>}
                  </td>
                  {/* Tier */}
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 5,
                      background: TIER_COLOR[r.tier] + '22', color: TIER_COLOR[r.tier],
                    }}>{r.tier}</span>
                  </td>
                  {/* Host */}
                  <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--muted)' }}>
                    {r.host === '-' ? <span style={{ color: 'var(--disabled)' }}>—</span> : r.host.split('@')[0]}
                  </td>
                  {/* Days inactive */}
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      fontWeight: 700, fontSize: 13,
                      color: isInactive30 ? '#EF4444' : isInactive7 ? '#F59E0B' : '#22C55E',
                    }}>
                      {r.daysInactive != null ? r.daysInactive + 'd' : '—'}
                    </span>
                  </td>
                  {/* Current deposit */}
                  <td style={{ padding: '10px 14px', fontWeight: 700 }}>
                    {fmtNum(r.deposit)}
                    {periodBRange && <DeltaBadge curr={r.deposit} prev={r.prevDeposit} />}
                  </td>
                  {/* Prev deposit */}
                  {periodBRange && (
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{fmtNum(r.prevDeposit)}</td>
                  )}
                  {/* This week VB */}
                  <td style={{ padding: '10px 14px', fontWeight: 700 }}>
                    {fmtNum(r.weekVb)}
                  </td>
                  {/* Prev week VB (prevMonthVb - the week before that isn't stored, so show prevMonthVb label) */}
                  {periodBRange && (
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{fmtNum(r.prevMonthVb)}</td>
                  )}
                  {/* Monthly tier progress */}
                  <td style={{ padding: '10px 14px' }}>
                    <TierBar monthVb={r.monthVb} weekVb={r.weekVb} tier={r.tier} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ─── Legend ─── */}
      <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
        <span><span style={{ color: '#22C55E', fontWeight: 700 }}>●</span> Active ≤ 7 days</span>
        <span><span style={{ color: '#F59E0B', fontWeight: 700 }}>●</span> 8–30 days</span>
        <span><span style={{ color: '#EF4444', fontWeight: 700 }}>●</span> 30+ days inactive</span>
        <span style={{ marginLeft: 'auto' }}>Metrics from latest snapshot in period · Valid Bet based on monthly_valid_bet column</span>
      </div>
    </div>
  )
}
