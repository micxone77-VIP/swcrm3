import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useUrlParam, useUrlParamNumber, useUrlParamBool, useUrlParamsRaw } from '../hooks/useUrlParam'

// ── helpers ──────────────────────────────────────────────────────────────────
const TIERS    = ['ALL','BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
const STATUSES = ['ALL','Active','Watch','At Risk','Dormant','Unknown']

const REGIONS = [
  { key: 'ALL',       label: '🌏 All' },
  { key: 'Malaysia',  label: '🇲🇾 Malaysia' },
  { key: 'Singapore', label: '🇸🇬 Singapore' },
  { key: 'Cambodia',  label: '🇰🇭 Cambodia' },
]

const CURRENCY_LABEL = { MYR: 'MYR', SGD: 'SGD', KHUSD: 'KHR' }
const CURRENCY_COLOR = { MYR: '#3fb950', SGD: '#f59e0b', KHUSD: '#a78bfa' }

const TIER_COLOR = {
  DIAMOND:'#b9f2ff', PLATINUM:'#C0C0C0', GOLD:'#ffd700',
  SILVER:'#a8a8a8', BRONZE:'#cd7f32', BLACK:'#ffffff',
}
const TIER_BG = {
  DIAMOND:'rgba(185,242,255,.12)', PLATINUM:'rgba(192,192,192,.12)',
  GOLD:'rgba(255,215,0,.12)', SILVER:'rgba(168,168,168,.1)',
  BRONZE:'rgba(205,127,50,.1)', BLACK:'rgba(255,255,255,.08)',
}
const STATUS_COLOR = {
  Active:'#3fb950', Watch:'#d29922', 'At Risk':'#f0883e',
  Dormant:'#f85149', Unknown:'#8b949e',
}
const CHURN_COLOR = { LOW:'#3fb950', MEDIUM:'#d29922', HIGH:'#f85149', UNKNOWN:'#8b949e' }

function formatDaysAgo(date) {
  if (!date) return '—'
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days < 0) return '—'
  if (days === 0) return 'Today'
  return days + 'd ago'
}

function rmFmt(n, currency) {
  if (!n || n === 0) return '—'
  const sym = currency === 'SGD' ? 'SGD ' : currency === 'KHUSD' ? 'KHR ' : 'RM '
  if (n >= 1000000) return sym + (n/1000000).toFixed(2) + 'M'
  if (n >= 1000)    return sym + (n/1000).toFixed(0) + 'K'
  return sym + Math.round(n).toLocaleString('en-MY')
}

function wlFmt(n, currency) {
  if (n === null || n === undefined) return '—'
  const sym = currency === 'SGD' ? 'SGD' : currency === 'KHUSD' ? 'KHR' : 'RM'
  const abs = Math.abs(n)
  const str = abs >= 1000000 ? (abs/1000000).toFixed(2)+'M' : abs >= 1000 ? (abs/1000).toFixed(0)+'K' : Math.round(abs).toLocaleString('en-MY')
  return n <= 0
    ? <span style={{color:'#3fb950',fontWeight:600}}>+{sym}{str}</span>
    : <span style={{color:'#f85149',fontWeight:600}}>-{sym}{str}</span>
}

const s = {
  page:   { padding:'24px 28px', minHeight:'100vh' },
  hdr:    { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 },
  title:  { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:    { fontSize:13, color:'var(--muted)', marginTop:4 },
  bar:    { display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:16 },
  search: { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 14px', borderRadius:8, fontSize:13, width:240, outline:'none' },
  sel:    { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none' },
  chip:   { padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer', border:'1px solid transparent', transition:'all .15s' },
  tbl:    { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:     { padding:'9px 12px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap', cursor:'pointer', userSelect:'none' },
  td:     { padding:'9px 12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  badge:  { display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  sbar:   { display:'flex', alignItems:'center', gap:6 },
  pgBtn:  { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'6px 14px', borderRadius:7, fontSize:13, minWidth:40, cursor:'pointer' },
  regionBtn: (active, color) => ({
    padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight: active ? 700 : 500,
    cursor:'pointer', border:`1px solid ${active ? color : 'var(--border)'}`,
    background: active ? `${color}22` : 'var(--surface)',
    color: active ? color : 'var(--muted)',
    transition:'all .15s',
  }),
  currTag: (currency) => ({
    display:'inline-block', fontSize:10, fontWeight:700,
    padding:'1px 6px', borderRadius:10,
    background: `${CURRENCY_COLOR[currency] || '#8b949e'}22`,
    color: CURRENCY_COLOR[currency] || '#8b949e',
    border: `1px solid ${CURRENCY_COLOR[currency] || '#8b949e'}44`,
    marginLeft:6,
  }),
}

const PAGE_SIZE = 50

function downloadCSV(rows, filename) {
  if (!rows || rows.length === 0) return alert('No data to export.')
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const val = r[h] ?? ''
      const str = String(val).replace(/"/g, '""')
      return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str
    }).join(','))
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function VIPList() {
  const { profile }               = useAuth()
  const isAdmin = profile?.role === 'admin'
  const myName  = profile?.full_name || ''
  const navigate                  = useNavigate()
  const [vips, setVips]           = useState([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useUrlParam('search', '')
  const [tierF, setTierF]         = useUrlParam('tier', 'ALL')
  const [statusF, setStatusF]     = useUrlParam('status', 'ALL')
  const [regionF, setRegionF]     = useUrlParam('region', 'ALL')
  const [sortCol, setSortCol]     = useUrlParam('sort', 'vip_score')
  const [sortAsc, setSortAsc]     = useUrlParamBool('asc', false)
  const [page, setPage]           = useUrlParamNumber('page', 0)
  const [mineOnly, setMineOnly]   = useUrlParamBool('mine', false)
  const [unassignedOnly, setUnassignedOnly] = useUrlParamBool('unassigned', false)
  const urlRaw = useUrlParamsRaw()
  const [exporting, setExporting] = useState(false)
  const [tierCounts, setTierCounts]     = useState({})
  const [regionCounts, setRegionCounts] = useState({})
  const [unassignedCount, setUnassignedCount] = useState(0)
  const [hosts, setHosts] = useState([])
  const [savingHostFor, setSavingHostFor] = useState(null) // vip id currently saving, or null

  // Page reset happens as its own effect, not chained inside each filter's
  // click handler — chaining two different URL-param setters in one handler
  // causes the second one to silently discard the first (see useUrlParam.js).
  useEffect(() => { setPage(0) }, [tierF, statusF, regionF, sortCol, sortAsc, mineOnly, unassignedOnly])
  useEffect(() => { loadVIPs() }, [tierF, statusF, regionF, sortCol, sortAsc, page, mineOnly, unassignedOnly])
  useEffect(() => { setPage(0) }, [search])
  useEffect(() => { loadVIPs() }, [search])
  useEffect(() => { loadCounts() }, [])
  useEffect(() => {
    async function loadHosts() {
      const { data } = await supabase.from('profiles').select('id, full_name, role').neq('role','readonly').order('full_name')
      setHosts((data||[]).filter(h => h.full_name))
    }
    loadHosts()
  }, [])

  async function assignHost(vipId, newHost) {
    setSavingHostFor(vipId)
    const { error } = await supabase
      .from('vip_members')
      .update({ host_assigned: newHost || null, updated_at: new Date().toISOString() })
      .eq('id', vipId)
    if (error) {
      alert('Failed to assign host: ' + error.message)
    } else {
      // Update in place — no refetch, no page reset, no lost filters/scroll position.
      setVips(prev => prev.map(v => v.id === vipId ? { ...v, host_assigned: newHost || '' } : v))
      if (unassignedOnly && newHost) {
        setVips(prev => prev.filter(v => v.id !== vipId))
        setTotal(t => Math.max(0, t - 1))
        setUnassignedCount(c => Math.max(0, c - 1))
      }
    }
    setSavingHostFor(null)
  }

  async function loadCounts() {
    const { data } = await supabase
      .from('vip_members')
      .select('tier, region, currency, host_assigned')
      .eq('is_excluded', false)
    if (data) {
      const tc = {}, rc = {}
      let unassigned = 0
      data.forEach(r => {
        tc[r.tier] = (tc[r.tier] || 0) + 1
        const reg = r.region || 'Unknown'
        rc[reg] = (rc[reg] || 0) + 1
        if (!r.host_assigned || !r.host_assigned.trim()) unassigned++
      })
      setTierCounts(tc)
      setRegionCounts(rc)
      setUnassignedCount(unassigned)
    }
  }

  async function loadVIPs() {
    setLoading(true)

    // The RPC doesn't support an "unassigned host" filter, so this view bypasses it
    // entirely with a direct query. Not paginated on purpose — this list should be
    // small enough to review and assign in one sitting; if it's ever huge, that's
    // itself worth knowing rather than hiding behind pages.
    if (unassignedOnly) {
      let q = supabase
        .from('vip_members')
        .select('id, username, tier, region, currency, total_deposit, win_loss, days_inactive, activity_status, vip_score, churn_risk, phone, host_assigned, last_contact_date')
        .eq('is_excluded', false)
        .or('host_assigned.is.null,host_assigned.eq.')
      if (tierF !== 'ALL')   q = q.eq('tier', tierF)
      if (statusF !== 'ALL') q = q.eq('activity_status', statusF)
      if (regionF !== 'ALL') q = q.eq('region', regionF)
      if (search.trim())     q = q.ilike('username', `%${search.trim()}%`)
      q = q.order(sortCol, { ascending: sortAsc })
      const { data, error } = await q
      if (!error) { setVips(data || []); setTotal((data || []).length) }
      else { console.error('loadVIPs (unassigned) error:', error); setVips([]); setTotal(0) }
      setLoading(false)
      return
    }

    const currentName = profile?.full_name || ''
    const { data, error } = await supabase.rpc('get_vip_list', {
      p_tier:      tierF !== 'ALL' ? tierF : null,
      p_status:    statusF !== 'ALL' ? statusF : null,
      p_region:    regionF !== 'ALL' ? regionF : null,
      p_search:    search.trim() || null,
      p_host:      (mineOnly && currentName) ? currentName : null,
      p_sort_col:  sortCol,
      p_sort_asc:  sortAsc,
      p_limit:     PAGE_SIZE,
      p_offset:    page * PAGE_SIZE,
    })
    if (!error) {
      setVips(data || [])
      setTotal(data?.[0]?.total_count || 0)
    } else {
      console.error('loadVIPs RPC error:', error)
    }
    setLoading(false)
  }

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  function SortIcon({ col }) {
    if (sortCol !== col) return <span style={{opacity:.3}}>↕</span>
    return <span style={{color:'var(--accent)'}}>{sortAsc ? '↑' : '↓'}</span>
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const totalAll   = Object.values(tierCounts).reduce((a,b)=>a+b,0)

  async function handleExport() {
    setExporting(true)
    // Use same select as main table to avoid RLS issues
    let q = supabase
      .from('vip_members')
      .select('id, username, full_name, tier, last_deposit_date, phone, host_assigned, region, currency, days_inactive, vip_score, activity_status')
      .eq('is_excluded', false)
    if (tierF !== 'ALL')    q = q.eq('tier', tierF)
    if (statusF !== 'ALL')  q = q.eq('activity_status', statusF)
    if (regionF !== 'ALL')  q = q.eq('region', regionF)
    if (search.trim())      q = q.or(`username.ilike.%${search}%,full_name.ilike.%${search}%`)
    if (mineOnly && myName) q = q.eq('host_assigned', myName)
    q = q.order('tier').order('username')
    const { data, error } = await q
    if (error) { alert('Export error: ' + error.message); setExporting(false); return }
    if (!data || data.length === 0) { alert('No data found for current filters.'); setExporting(false); return }

    // Pull accumulated month-to-date totals (sum of all daily snapshots) for the current month.
    // NOTE: don't filter with .in('username', usernames) here — exporting all VIPs means hundreds
    // of usernames, which can exceed URL length limits and silently fail. Fetch the whole month
    // instead (still a small dataset) and join client-side.
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    const { data: _mc } = await supabase.from('vip_monthly_totals').select('snapshot_month').eq('snapshot_month', thisMonth).limit(1)
    const currentMonth = (_mc && _mc.length > 0) ? thisMonth : await (async () => {
      const { data: _lt } = await supabase.from('vip_monthly_totals').select('snapshot_month').order('snapshot_month', { ascending: false }).limit(1)
      return _lt?.[0]?.snapshot_month || thisMonth
    })()
    const { data: totalsData, error: totalsErr } = await supabase
      .from('vip_monthly_totals')
      .select('username, total_deposit, monthly_valid_bet')
      .eq('snapshot_month', currentMonth)
    if (totalsErr) console.error('VIPList export: vip_monthly_totals fetch error', totalsErr)
    const totalsMap = {}
    ;(totalsData || []).forEach(t => { totalsMap[t.username] = t })

    const label = mineOnly ? `${myName}_VIPs` : tierF !== 'ALL' ? `${tierF}_VIPs` : 'All_VIPs'
    downloadCSV(data.map(v => ({
      username:          v.username,
      full_name:         v.full_name || '',
      tier:              v.tier,
      last_deposit_date: v.last_deposit_date || '',
      phone:             v.phone || '',
      host_assigned:     v.host_assigned || '',
      region:            v.region || '',
      currency:          v.currency || '',
      days_inactive:     v.days_inactive ?? '',
      total_deposit:     totalsMap[v.username]?.total_deposit || 0,
      monthly_valid_bet: totalsMap[v.username]?.monthly_valid_bet || 0,
      vip_score:         v.vip_score || '',
      status:            v.activity_status || '',
    })), `${label}_${new Date().toISOString().slice(0,10)}.csv`)
    setExporting(false)
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.hdr}>
        <div>
          <div style={s.title}>👑 VIP Members</div>
          <div style={s.sub}>{total} members · {totalAll} total in database</div>
        </div>
      </div>

      {/* Tier chips */}
      <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap', alignItems:'center' }}>
        {TIERS.map(t => {
          const active = tierF === t
          const count  = t === 'ALL' ? totalAll : (tierCounts[t]||0)
          return (
            <div
              key={t}
              style={{
                ...s.chip,
                background: active ? (TIER_BG[t]||'rgba(88,166,255,.15)') : 'var(--surface)',
                borderColor: active ? (TIER_COLOR[t]||'var(--accent)') : 'var(--border)',
                color: active ? (TIER_COLOR[t]||'var(--accent)') : 'var(--muted)',
              }}
              onClick={() => setTierF(t)}
            >
              {t} {count > 0 && <span style={{opacity:.7,fontSize:11}}>({count})</span>}
            </div>
          )
        })}
      </div>

      {/* Region filter */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:11, color:'var(--muted)', fontWeight:600, letterSpacing:'0.05em', marginRight:4 }}>REGION</span>
        {REGIONS.map(r => {
          const count = r.key === 'ALL'
            ? totalAll
            : (regionCounts[r.key] || 0)
          const color = r.key === 'Malaysia' ? '#3fb950' : r.key === 'Singapore' ? '#f59e0b' : r.key === 'Cambodia' ? '#a78bfa' : 'var(--accent)'
          return (
            <button
              key={r.key}
              style={s.regionBtn(regionF === r.key, color)}
              onClick={() => setRegionF(r.key)}
            >
              {r.label}
              {count > 0 && (
                <span style={{ opacity:.7, fontSize:11, marginLeft:4 }}>({count})</span>
              )}
            </button>
          )
        })}

        {/* Currency summary pills */}
        <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
          {Object.entries(CURRENCY_COLOR).map(([cur, col]) => {
            const cnt = Object.entries(tierCounts).length > 0
              ? vips.filter(v => v.currency === cur).length
              : 0
            return (
              <span key={cur} style={{
                fontSize:11, fontWeight:700,
                padding:'3px 10px', borderRadius:10,
                background:`${col}22`, color:col,
                border:`1px solid ${col}44`,
              }}>
                {cur}
              </span>
            )
          })}
        </div>
      </div>

      {/* Search + filters */}
      <div style={s.bar}>
        <input
          style={s.search}
          placeholder="🔍  Search username, name, phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={s.sel} value={statusF} onChange={e => setStatusF(e.target.value)}>
          {STATUSES.map(st => <option key={st}>{st}</option>)}
        </select>
        <button
          onClick={() => urlRaw.set({ mine: (!mineOnly).toString(), unassigned: 'false' }, { mine: 'false', unassigned: 'false' })}
          style={{ background: mineOnly?'var(--accent)':'var(--surface2)', color: mineOnly?'#fff':'var(--text)', border: mineOnly?'none':'1px solid var(--border)', padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
          {mineOnly ? '★ My VIPs' : '☆ My VIPs'}
        </button>
        <button
          onClick={() => urlRaw.set({ unassigned: (!unassignedOnly).toString(), mine: 'false' }, { mine: 'false', unassigned: 'false' })}
          style={{ background: unassignedOnly?'#f85149':'var(--surface2)', color: unassignedOnly?'#fff':'var(--text)', border: unassignedOnly?'none':'1px solid var(--border)', padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
          {unassignedOnly ? '🚫 Unassigned' : `⬜ Unassigned${unassignedCount > 0 ? ` (${unassignedCount})` : ''}`}
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{ background: exporting?'var(--border)':'#10b981', color: exporting?'var(--muted)':'#fff', border:'none', padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor: exporting?'not-allowed':'pointer' }}>
          {exporting ? 'Exporting...' : '⬇ Export'}
        </button>
        <div style={{marginLeft:'auto',fontSize:12,color:'var(--muted)'}}>
          {loading ? 'Loading...' : unassignedOnly ? `${total} unassigned VIPs` : `${total} results · page ${page+1}/${Math.max(1,totalPages)}`}
        </div>
      </div>

      {/* Table */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>#</th>
                <th style={s.th} onClick={()=>toggleSort('username')}>Username <SortIcon col="username"/></th>
                <th style={s.th} onClick={()=>toggleSort('tier')}>Tier <SortIcon col="tier"/></th>
                <th style={s.th}>Region</th>
                <th style={s.th} onClick={()=>toggleSort('total_deposit')}>Total Dep <SortIcon col="total_deposit"/></th>
                <th style={s.th} onClick={()=>toggleSort('win_loss')}>Win/Loss <SortIcon col="win_loss"/></th>
                <th style={s.th} onClick={()=>toggleSort('days_inactive')}>Days Inactive <SortIcon col="days_inactive"/></th>
                <th style={s.th} onClick={()=>toggleSort('activity_status')}>Status <SortIcon col="activity_status"/></th>
                <th style={s.th} onClick={()=>toggleSort('last_contact_date')}>Last Contact <SortIcon col="last_contact_date"/></th>
                <th style={s.th} onClick={()=>toggleSort('vip_score')}>Score <SortIcon col="vip_score"/></th>
                <th style={s.th} onClick={()=>toggleSort('churn_risk')}>Risk <SortIcon col="churn_risk"/></th>
                <th style={s.th}>Phone</th>
                <th style={s.th}>Host</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} style={{...s.td, textAlign:'center', padding:'40px', color:'var(--muted)'}}>Loading...</td></tr>
              ) : vips.length === 0 ? (
                <tr><td colSpan={13} style={{...s.td, textAlign:'center', padding:'40px', color:'var(--muted)'}}>No VIPs found</td></tr>
              ) : vips.map((v, i) => {
                const isMyVIP = !!(myName && v.host_assigned === myName)
                const rowBg = isMyVIP ? 'rgba(99,102,241,0.06)' : v.win_loss > 20000 ? 'rgba(248,81,73,.05)' : v.days_inactive > 60 ? 'rgba(248,81,73,.03)' : 'transparent'
                const score = v.vip_score || 0
                const scoreColor = score >= 80 ? '#3fb950' : score >= 60 ? '#d29922' : '#f85149'
                const currency = v.currency || 'MYR'
                return (
                  <tr
                    key={v.id}
                    style={{ background:rowBg, cursor:'pointer', borderLeft: isMyVIP ? '3px solid var(--accent)' : '3px solid transparent' }}
                    onClick={() => navigate(`/vips/${v.id}`)}
                    onMouseEnter={e => e.currentTarget.style.background = isMyVIP ? 'rgba(99,102,241,0.12)' : 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = rowBg}
                  >
                    <td style={{...s.td, color:'var(--muted)', fontSize:11}}>{page*PAGE_SIZE+i+1}</td>
                    <td style={{...s.td, fontWeight:700}}>
                      {v.username}
                      {currency !== 'MYR' && (
                        <span style={s.currTag(currency)}>{CURRENCY_LABEL[currency] || currency}</span>
                      )}
                    </td>
                    <td style={s.td}>
                      <span style={{...s.badge, background:TIER_BG[v.tier]||'transparent', color:TIER_COLOR[v.tier]||'var(--text)'}}>
                        {v.tier}
                      </span>
                    </td>
                    <td style={{...s.td, fontSize:12}}>
                      {v.region === 'Malaysia'  && <span>🇲🇾 MY</span>}
                      {v.region === 'Singapore' && <span>🇸🇬 SG</span>}
                      {v.region === 'Cambodia'  && <span>🇰🇭 KH</span>}
                      {!v.region                && <span style={{color:'var(--muted)'}}>—</span>}
                    </td>
                    <td style={{...s.td, fontFamily:'monospace', fontSize:12}}>{rmFmt(v.total_deposit, currency)}</td>
                    <td style={s.td}>{wlFmt(v.win_loss, currency)}</td>
                    <td style={s.td}>
                      {v.days_inactive !== null && v.days_inactive !== undefined ? (
                        <span style={{
                          color: v.days_inactive<=7?'#3fb950':v.days_inactive<=14?'#d29922':v.days_inactive<=30?'#f0883e':'#f85149',
                          fontWeight:600
                        }}>
                          {v.days_inactive === 0 ? 'Today' : `${v.days_inactive}d`}
                        </span>
                      ) : <span style={{color:'var(--muted)'}}>—</span>}
                    </td>
                    <td style={s.td}>
                      <span style={{color:STATUS_COLOR[v.activity_status]||'var(--muted)', fontWeight:600, fontSize:12}}>
                        {v.activity_status || '—'}
                      </span>
                    </td>
                    <td style={{...s.td, fontSize:12, color:'var(--muted)'}}>
                      {v.last_contact_date ? formatDaysAgo(v.last_contact_date) : '—'}
                    </td>
                    <td style={s.td}>
                      <div style={s.sbar}>
                        <div style={{flex:1, height:5, background:'var(--surface2)', borderRadius:3, minWidth:50, overflow:'hidden'}}>
                          <div style={{width:Math.min(100,score)+'%', height:'100%', background:scoreColor, borderRadius:3}} />
                        </div>
                        <span style={{fontSize:11, color:scoreColor, fontWeight:700, minWidth:28}}>{score||'—'}</span>
                      </div>
                    </td>
                    <td style={s.td}>
                      <span style={{color:CHURN_COLOR[v.churn_risk]||'var(--muted)', fontSize:11, fontWeight:600}}>{v.churn_risk||'—'}</span>
                    </td>
                    <td style={{...s.td, fontSize:12, color:'var(--muted)'}}>{v.phone||'—'}</td>
                    <td style={{...s.td, fontSize:12}} onClick={e => e.stopPropagation()}>
                      {isAdmin ? (
                        <select
                          value={v.host_assigned || ''}
                          disabled={savingHostFor === v.id}
                          onChange={e => assignHost(v.id, e.target.value)}
                          style={{
                            background: v.host_assigned ? 'var(--surface2)' : 'rgba(248,81,73,.12)',
                            color: v.host_assigned ? 'var(--text)' : '#f85149',
                            border: '1px solid var(--border)', borderRadius: 6,
                            padding: '4px 6px', fontSize: 12, cursor: 'pointer',
                            opacity: savingHostFor === v.id ? 0.5 : 1,
                          }}>
                          <option value="">— Unassigned —</option>
                          {hosts.map(h => <option key={h.id} value={h.full_name}>{h.full_name}</option>)}
                        </select>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>{v.host_assigned || '—'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!unassignedOnly && totalPages > 1 && (
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 16px',borderTop:'1px solid var(--border)'}}>
            <button style={s.pgBtn} disabled={page===0} onClick={()=>setPage(0)}>«</button>
            <button style={s.pgBtn} disabled={page===0} onClick={()=>setPage(p=>p-1)}>‹</button>
            {Array.from({length:Math.min(5,totalPages)},(_,i)=>{
              const pg = Math.min(Math.max(page-2,0)+i, totalPages-1)
              return <button key={pg} style={{...s.pgBtn, background:pg===page?'var(--accent)':'var(--surface)', color:pg===page?'#fff':'var(--text)'}} onClick={()=>setPage(pg)}>{pg+1}</button>
            })}
            <button style={s.pgBtn} disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}>›</button>
            <button style={s.pgBtn} disabled={page>=totalPages-1} onClick={()=>setPage(totalPages-1)}>»</button>
            <span style={{fontSize:12,color:'var(--muted)',marginLeft:8}}>{page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,total)} of {total}</span>
          </div>
        )}
      </div>
    </div>
  )
}
