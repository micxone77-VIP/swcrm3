// src/pages/AllVIPs.jsx — VIP Operations / All VIPs (V2)
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  PageHeader, Card, Btn, Input, Select, FilterPills,
  LoadingState, ErrorState, EmptyState, Pagination, Badge,
} from '../components/ui'
import { TierBadge, StatusBadge, RiskBadge } from '../components/ui'
import { formatMoney } from '../lib/format'

const PAGE_SIZE = 50
const TIERS    = ['ALL','BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
const STATUSES = ['ALL','Active','Watch','At Risk','Dormant']
const REGIONS  = [{ value:'ALL',label:'🌏 All' },{ value:'Malaysia',label:'🇲🇾 Malaysia' },{ value:'Singapore',label:'🇸🇬 Singapore' },{ value:'Cambodia',label:'🇰🇭 Cambodia' }]

function daysAgoLabel(date) {
  if (!date) return '—'
  const d = Math.floor((Date.now() - new Date(date)) / 86400000)
  if (d < 0) return '—'
  if (d === 0) return 'Today'
  return d + 'd ago'
}

function downloadCSV(rows, filename) {
  if (!rows || rows.length === 0) return
  const headers = ['Username','Full Name','Tier','Status','Region','Host','Total Deposit','Days Inactive','Last Deposit','Churn Risk']
  const csv = [headers.join(','), ...rows.map(r => [
    r.username, `"${r.full_name||''}"`, r.tier, r.activity_status||'',
    r.region||'', r.host_assigned||'',
    r.total_deposit||0, r.days_inactive||0,
    r.last_deposit_date||'', r.churn_risk||'',
  ].join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function AllVIPs() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [vips, setVips]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [search, setSearch]     = useState('')
  const [tier, setTier]         = useState('ALL')
  const [status, setStatus]     = useState('ALL')
  const [region, setRegion]     = useState('ALL')
  const [host, setHost]         = useState('ALL')
  const [hosts, setHosts]       = useState(['ALL'])
  const [page, setPage]         = useState(1)
  const [sortCol, setSortCol]   = useState('tier')
  const [sortAsc, setSortAsc]   = useState(true)
  const [view, setView]         = useState('all')
  const [activationBusy, setActivationBusy] = useState(null)
  const [activationNotice, setActivationNotice] = useState(null)
  const searchRef = useRef(null)

  const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [vipRes, hostRes] = await Promise.all([
        supabase.from('vip_members')
          .select('id,username,full_name,tier,region,currency,days_inactive,churn_risk,host_assigned,last_deposit_date,total_deposit,win_loss,activity_status,last_contacted,last_contact_date,vip_score,is_excluded,birthday,phone')
          .neq('is_excluded', true),
        supabase.from('profiles').select('full_name').in('role',['admin','host']).order('full_name'),
      ])
      if (vipRes.error) throw vipRes.error
      setVips(vipRes.data || [])
      const hostNames = ['ALL', ...(hostRes.data||[]).map(h => h.full_name).filter(Boolean)]
      setHosts(hostNames)
    } catch(e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const generateActivation = async (vip) => {
    if (!vip?.username || activationBusy) return
    setActivationBusy(vip.id)
    setActivationNotice(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-player-activation', {
        body: { username: vip.username },
      })
      if (fnError) throw fnError
      if (!data?.success || !data?.setup_link) throw new Error(data?.error || 'Failed to generate activation link.')

      let copied = false
      try {
        await navigator.clipboard.writeText(data.setup_link)
        copied = true
      } catch (_) {}

      setActivationNotice({
        ok: true,
        username: vip.username,
        link: data.setup_link,
        text: copied ? `Activation link copied for ${vip.username}.` : `Activation link generated for ${vip.username}.`,
      })
    } catch (e) {
      setActivationNotice({
        ok: false,
        username: vip.username,
        text: e?.message || 'Unable to generate activation link.',
      })
    } finally {
      setActivationBusy(null)
    }
  }

  // Saved views shortcuts
  const applyView = v => {
    setView(v); setPage(1)
    if (v === 'all')      { setTier('ALL'); setStatus('ALL') }
    if (v === 'risk')     { setTier('ALL'); setStatus('At Risk') }
    if (v === 'active')   { setTier('ALL'); setStatus('Active') }
    if (v === 'diamond')  { setTier('DIAMOND'); setStatus('ALL') }
    if (v === 'platinum') { setTier('PLATINUM'); setStatus('ALL') }
    if (v === 'noctact')  { setTier('ALL'); setStatus('ALL') }
  }

  // Filter + sort
  const now = new Date()
  const filtered = vips.filter(v => {
    if (tier !== 'ALL' && v.tier?.toUpperCase() !== tier) return false
    if (status !== 'ALL' && v.activity_status !== status) return false
    if (region !== 'ALL' && v.region !== region) return false
    if (host !== 'ALL' && v.host_assigned !== host) return false
    if (view === 'noctact') {
      const lastC = v.last_contacted || v.last_contact_date
      if (lastC && Math.floor((now - new Date(lastC)) / 86400000) < 7) return false
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      return (v.username||'').toLowerCase().includes(s) ||
             (v.full_name||'').toLowerCase().includes(s) ||
             (v.phone||'').toLowerCase().includes(s)
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let va, vb
    if (sortCol === 'tier')       { va = TIER_ORDER[(a.tier||'').toUpperCase()]??9; vb = TIER_ORDER[(b.tier||'').toUpperCase()]??9 }
    else if (sortCol === 'dep')   { va = a.total_deposit||0; vb = b.total_deposit||0 }
    else if (sortCol === 'days')  { va = a.days_inactive||0; vb = b.days_inactive||0 }
    else if (sortCol === 'name')  { va = a.full_name||a.username||''; vb = b.full_name||b.username||'' }
    else                         { va = a[sortCol]||0; vb = b[sortCol]||0 }
    return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
  })

  const total = sorted.length
  const paged = sorted.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  const toggleSort = col => {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
    setPage(1)
  }

  const sortIcon = col => sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : ''

  const SAVED_VIEWS = [
    { value: 'all',      label: 'All VIPs' },
    { value: 'active',   label: 'Active' },
    { value: 'risk',     label: 'At Risk' },
    { value: 'diamond',  label: 'Diamond' },
    { value: 'platinum', label: 'Platinum' },
    { value: 'noctact',  label: 'No Contact 7d+' },
  ]

  return (
    <div style={{ padding: '24px 28px' }}>
      <PageHeader
        title="VIP Operations"
        subtitle={`${total.toLocaleString()} VIPs`}
        actions={
          <>
            {profile?.role === 'admin' && (
              <Btn size="sm" variant="ghost" onClick={() => downloadCSV(filtered, 'vips-export.csv')}>
                ↓ Export CSV
              </Btn>
            )}
            <Btn size="sm" variant="primary" onClick={() => navigate('/vips')}>
              Refresh
            </Btn>
          </>
        }
      />

      {activationNotice && (
        <div style={{
          marginBottom: 14,
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${activationNotice.ok ? 'rgba(63,185,80,.35)' : 'rgba(248,81,73,.35)'}`,
          background: activationNotice.ok ? 'rgba(63,185,80,.10)' : 'rgba(248,81,73,.10)',
          color: activationNotice.ok ? 'var(--success)' : 'var(--danger)',
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 700 }}>{activationNotice.text}</div>
          {activationNotice.link && (
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                readOnly
                value={activationNotice.link}
                onFocus={e => e.currentTarget.select()}
                style={{ flex: '1 1 520px', minWidth: 260, background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 9px', borderRadius:6, fontSize:11 }}
              />
              <Btn size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(activationNotice.link); setActivationNotice(n => ({ ...n, text:`Activation link copied for ${n.username}.` })) } catch (_) {} }}>
                Copy Link
              </Btn>
            </div>
          )}
        </div>
      )}

      {/* Saved Views */}
      <div style={{ marginBottom: 16 }}>
        <FilterPills options={SAVED_VIEWS} active={view} onChange={applyView} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <input ref={searchRef} value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name / login / phone…"
          style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 14px', borderRadius:8, fontSize:13, width:240, outline:'none' }} />
        <Select value={tier} onChange={e => { setTier(e.target.value); setPage(1) }} style={{ minWidth: 120 }}>
          {TIERS.map(t => <option key={t} value={t}>{t === 'ALL' ? 'All Tiers' : t}</option>)}
        </Select>
        <Select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} style={{ minWidth: 120 }}>
          {STATUSES.map(s => <option key={s} value={s}>{s === 'ALL' ? 'All Status' : s}</option>)}
        </Select>
        <Select value={region} onChange={e => { setRegion(e.target.value); setPage(1) }} style={{ minWidth: 130 }}>
          {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Select value={host} onChange={e => { setHost(e.target.value); setPage(1) }} style={{ minWidth: 130 }}>
          {hosts.map(h => <option key={h} value={h}>{h === 'ALL' ? 'All Hosts' : h}</option>)}
        </Select>
        {(search || tier !== 'ALL' || status !== 'ALL' || region !== 'ALL' || host !== 'ALL') && (
          <Btn size="sm" variant="ghost" onClick={() => { setSearch(''); setTier('ALL'); setStatus('ALL'); setRegion('ALL'); setHost('ALL'); setPage(1) }}>
            Clear filters
          </Btn>
        )}
      </div>

      {/* Table */}
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {[
                    { key:'name', label:'VIP', sortable:true },
                    { key:'tier', label:'Tier', sortable:true },
                    { key:'activity_status', label:'Status', sortable:false },
                    { key:'dep', label:'Deposit', sortable:true },
                    { key:'win_loss', label:'Win/Loss', sortable:false },
                    { key:'last_contact_date', label:'Last Contact', sortable:false },
                    { key:'last_deposit_date', label:'Last Deposit', sortable:false },
                    { key:'host_assigned', label:'Host', sortable:false },
                    { key:'churn_risk', label:'Risk', sortable:false },
                    { key:'action', label:'Next Action', sortable:false },
                  ].map(col => (
                    <th key={col.key}
                      onClick={() => col.sortable && toggleSort(col.key)}
                      style={{
                        padding: '9px 12px', textAlign: 'left',
                        background: 'var(--surface)', color: 'var(--muted)',
                        fontWeight: 600, fontSize: 11, letterSpacing: '.3px',
                        borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                        cursor: col.sortable ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}>
                      {col.label}{col.sortable ? sortIcon(col.key) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={10} style={{ textAlign:'center', padding:'32px', color:'var(--muted)' }}>
                    No VIPs match the current filters.
                  </td></tr>
                ) : paged.map(v => {
                  const lastContact = v.last_contacted || v.last_contact_date
                  const wl = v.win_loss
                  return (
                    <tr key={v.id}
                      onClick={() => navigate(`/vips/${v.id}`)}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      style={{ cursor:'pointer', transition:'background .1s' }}
                    >
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ fontWeight:600, color:'var(--text)' }}>{v.full_name || v.username}</div>
                        <div style={{ fontSize:11, color:'var(--muted)' }}>{v.username}</div>
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <TierBadge tier={v.tier} />
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <StatusBadge status={v.activity_status} />
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>
                        {formatMoney(v.total_deposit, v.currency)}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        {wl == null ? '—' : (
                          <span style={{ fontWeight:600, color: wl <= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {wl <= 0 ? '+' : '-'}{formatMoney(Math.abs(wl), v.currency)}
                          </span>
                        )}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12 }}>
                        {daysAgoLabel(lastContact)}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12 }}>
                        {daysAgoLabel(v.last_deposit_date)}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12 }}>
                        {v.host_assigned || '—'}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <RiskBadge risk={v.churn_risk} />
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                          <Btn size="sm" variant="ghost" onClick={e => { e.stopPropagation(); navigate(`/vips/${v.id}`) }}>
                            Open VIP →
                          </Btn>
                          {profile?.role === 'admin' && (
                            <Btn
                              size="sm"
                              variant="ghost"
                              disabled={activationBusy === v.id}
                              onClick={e => { e.stopPropagation(); generateActivation(v) }}
                              title="Generate a one-time Player Portal activation link"
                            >
                              {activationBusy === v.id ? 'Generating…' : '🔐 Activate Portal'}
                            </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </Card>
      )}
    </div>
  )
}
