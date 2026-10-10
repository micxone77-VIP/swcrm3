// src/pages/AllVIPs.jsx — VIP Operations / All VIPs (V2)
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SEGMENTS, fetchAll } from '../lib/depositProfile'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'
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

function escCSV(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g,'""')}"`
  return s
}

function downloadCSV(rows, filename) {
  if (!rows || rows.length === 0) return
  const headers = [
    'Username','Full Name','Tier','Status','Region','Currency','Host',
    'Phone','WhatsApp',
    'Total Deposit','Win/Loss','Days Inactive',
    'Last Deposit Date','Last Contacted','Last Contact Date',
    'Churn Risk','VIP Score','Birthday',
    'TNG Verify Status','TNG Verified Name',
    'Affiliate','Deposit Segment',
  ]
  const csv = [
    headers.join(','),
    ...rows.map(r => [
      escCSV(r.username),
      escCSV(r.full_name),
      escCSV(r.tier),
      escCSV(r.activity_status),
      escCSV(r.region),
      escCSV(r.currency),
      escCSV(r.host_assigned),
      escCSV(r.phone),
      escCSV(r.whatsapp),
      escCSV(r.total_deposit ?? 0),
      escCSV(r.win_loss ?? 0),
      escCSV(r.days_inactive ?? 0),
      escCSV(r.last_deposit_date),
      escCSV(r.last_contacted),
      escCSV(r.last_contact_date),
      escCSV(r.churn_risk),
      escCSV(r.vip_score),
      escCSV(r.birthday),
      escCSV(r.tng_verify_status),
      escCSV(r.tng_verified_name),
      escCSV(r.affiliate_login || (r.affiliate_updated_at ? 'Direct' : '')),
      escCSV(r._segment || ''),
    ].join(','))
  ].join('\n')
  const bom = '﻿'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function AllVIPs() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { t } = useLanguage()
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
  const [assigningVip, setAssigningVip] = useState(null)
  const [assignBusy, setAssignBusy] = useState(null)
  const searchRef = useRef(null)
  // Gaming labels (username -> { player_type, player_type_icon })
  const [gamingLabels, setGamingLabels] = useState({})
  const [playerTypeFilter, setPlayerTypeFilter] = useState('ALL')
  // Affiliate + deposit segment (from vip_deposit_logs)
  const [searchParams] = useSearchParams()
  const [affiliate, setAffiliate] = useState(searchParams.get('affiliate') || 'ALL')
  const [segFilter, setSegFilter] = useState(searchParams.get('segment') || 'ALL')
  const [segMap, setSegMap] = useState({})

  const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [vipRes, hostRes] = await Promise.all([
        supabase.from('vip_members')
          .select('id,username,full_name,tier,region,currency,days_inactive,churn_risk,host_assigned,last_deposit_date,total_deposit,win_loss,activity_status,last_contacted,last_contact_date,vip_score,is_excluded,birthday,phone,whatsapp,tng_verify_status,tng_verified_name,affiliate_login,affiliate_updated_at')
          .neq('is_excluded', true),
        supabase.from('profiles').select('full_name').in('role',['admin','host']).order('full_name'),
      ])
      if (vipRes.error) throw vipRes.error
      setVips(vipRes.data || [])
      const hostNames = ['ALL', '__unassigned__', ...(hostRes.data||[]).map(h => h.full_name).filter(Boolean)]
      setHosts(hostNames)
      // Deposit segments (v_vip_deposit_profile)
      fetchAll(() => supabase.from('v_vip_deposit_profile').select('login,segment,trend_pct,days_since_last').order('login'))
        .then(rows => { const m = {}; rows.forEach(r => { m[r.login] = r }); setSegMap(m) })
        .catch(e => console.error('segment load error', e))
      // Load gaming labels (latest month per player)
      supabase.from('player_gaming_labels')
        .select('username,player_type,player_type_icon')
        .order('snapshot_month', { ascending: false })
        .then(({ data }) => {
          if (!data) return
          // Keep latest entry per username
          const map = {}
          data.forEach(r => { if (!map[r.username]) map[r.username] = r })
          setGamingLabels(map)
        })
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

  const assignHost = async (vipId, hostName) => {
    setAssignBusy(vipId)
    try {
      const { error: updErr } = await supabase.from('vip_members')
        .update({ host_assigned: hostName || null })
        .eq('id', vipId)
      if (updErr) throw updErr
      setVips(prev => prev.map(v => v.id === vipId ? { ...v, host_assigned: hostName || null } : v))
      setAssigningVip(null)
    } catch (e) {
      console.error('assignHost error:', e)
    } finally {
      setAssignBusy(null)
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

  // Affiliate dropdown options (with VIP counts)
  const affiliateOptions = (() => {
    const c = {}
    vips.forEach(v => { if (v.affiliate_login) c[v.affiliate_login] = (c[v.affiliate_login] || 0) + 1 })
    return Object.entries(c).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  })()

  // Filter + sort
  const now = new Date()
  const filtered = vips.filter(v => {
    if (tier !== 'ALL' && v.tier?.toUpperCase() !== tier) return false
    if (status !== 'ALL' && v.activity_status !== status) return false
    if (region !== 'ALL' && v.region !== region) return false
    if (host === '__unassigned__') { if (v.host_assigned) return false }
    else if (host !== 'ALL' && v.host_assigned !== host) return false
    if (affiliate === '__direct__') { if (v.affiliate_login || !v.affiliate_updated_at) return false }
    else if (affiliate === '__unknown__') { if (v.affiliate_updated_at) return false }
    else if (affiliate !== 'ALL' && v.affiliate_login !== affiliate) return false
    if (segFilter !== 'ALL') {
      const sg = segMap[v.username]?.segment || 'No deposits'
      if (segFilter === 'RISK' ? !(sg === 'Silent' || sg === 'Declining') : sg !== segFilter) return false
    }
    if (playerTypeFilter !== 'ALL') {
      const gl = gamingLabels[v.username]
      if (!gl || gl.player_type !== playerTypeFilter) return false
    }
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
    else if (sortCol === 'affiliate_login') { va = a.affiliate_login||'~'; vb = b.affiliate_login||'~' }
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
    { value: 'all',      label: t('allVips.viewAll') },
    { value: 'active',   label: t('common.active') },
    { value: 'risk',     label: t('common.atRisk') },
    { value: 'diamond',  label: 'Diamond' },
    { value: 'platinum', label: 'Platinum' },
    { value: 'noctact',  label: 'No Contact 7d+' },
  ]

  return (
    <div style={{ padding: '24px 28px' }}>
      <PageHeader
        title={t('allVips.title')}
        subtitle={`${total.toLocaleString()} VIPs`}
        actions={
          <>
            {profile?.role === 'admin' && (
              <Btn size="sm" variant="ghost" onClick={() => downloadCSV(filtered.map(v => ({ ...v, _segment: segMap[v.username]?.segment || '' })), 'vips-export.csv')}>
                {t('allVips.exportCsv')}
              </Btn>
            )}
            <Btn size="sm" variant="primary" onClick={() => navigate('/vips')}>
              {t('allVips.refresh')}
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
          placeholder={t('allVips.searchPlaceholder')}
          style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 14px', borderRadius:8, fontSize:13, width:240, outline:'none' }} />
        <Select value={tier} onChange={e => { setTier(e.target.value); setPage(1) }} style={{ minWidth: 120 }}>
          {TIERS.map(tv => <option key={tv} value={tv}>{tv === 'ALL' ? t('allVips.allTiers') : tv}</option>)}
        </Select>
        <Select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} style={{ minWidth: 120 }}>
          {STATUSES.map(s => <option key={s} value={s}>{s === 'ALL' ? t('allVips.allStatus') : s}</option>)}
        </Select>
        <Select value={region} onChange={e => { setRegion(e.target.value); setPage(1) }} style={{ minWidth: 130 }}>
          {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Select value={host} onChange={e => { setHost(e.target.value); setPage(1) }} style={{ minWidth: 130 }}>
          {hosts.map(h => <option key={h} value={h}>{h === 'ALL' ? t('allVips.allHosts') : h === '__unassigned__' ? '⚠️ Unassigned' : h}</option>)}
        </Select>
        <Select value={playerTypeFilter} onChange={e => { setPlayerTypeFilter(e.target.value); setPage(1) }} style={{ minWidth: 150 }}>
          <option value="ALL">🎮 All Player Types</option>
          <option value="Slots King">🎰 Slots King</option>
          <option value="Live Casino VIP">🎲 Live Casino VIP</option>
          <option value="Sports Punter">⚽ Sports Punter</option>
          <option value="Slots + Live">🎰🎲 Slots + Live</option>
          <option value="Live + Sports">🎲⚽ Live + Sports</option>
          <option value="Multi-Platform">🎯 Multi-Platform</option>
          <option value="Casual">🃏 Casual</option>
        </Select>
        <Select value={affiliate} onChange={e => { setAffiliate(e.target.value); setPage(1) }} style={{ minWidth: 150 }}>
          <option value="ALL">🤝 All Affiliates</option>
          <option value="__direct__">Direct (no affiliate)</option>
          <option value="__unknown__">Unknown (no deposit data)</option>
          {affiliateOptions.map(a => <option key={a.name} value={a.name}>{a.name} ({a.n})</option>)}
        </Select>
        <Select value={segFilter} onChange={e => { setSegFilter(e.target.value); setPage(1) }} style={{ minWidth: 150 }}>
          <option value="ALL">🧭 All Segments</option>
          <option value="RISK">🚨 Need action (Silent + Declining)</option>
          {Object.keys(SEGMENTS).map(k => <option key={k} value={k}>{SEGMENTS[k].icon} {k} {SEGMENTS[k].zh}</option>)}
          <option value="No deposits">No deposits (Jul–Sep)</option>
        </Select>
        {(search || tier !== 'ALL' || status !== 'ALL' || region !== 'ALL' || host !== 'ALL' || playerTypeFilter !== 'ALL' || affiliate !== 'ALL' || segFilter !== 'ALL') && (
          <Btn size="sm" variant="ghost" onClick={() => { setSearch(''); setTier('ALL'); setStatus('ALL'); setRegion('ALL'); setHost('ALL'); setPlayerTypeFilter('ALL'); setAffiliate('ALL'); setSegFilter('ALL'); setPage(1) }}>
            {t('allVips.clearFilters')}
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
                    { key:'name', label:t('allVips.colVip'), sortable:true },
                    { key:'tng', label:'T&G', sortable:false },
                    { key:'tier', label:t('common.tier'), sortable:true },
                    { key:'activity_status', label:t('common.status'), sortable:false },
                    { key:'segment', label:'Segment 分群', sortable:false },
                    { key:'dep', label:t('allVips.colDeposit'), sortable:true },
                    { key:'win_loss', label:t('common.winLoss'), sortable:false },
                    { key:'last_contact_date', label:t('allVips.colLastContact'), sortable:false },
                    { key:'last_deposit_date', label:t('allVips.colLastDeposit'), sortable:false },
                    { key:'host_assigned', label:t('common.host'), sortable:false },
                    { key:'affiliate_login', label:'Affiliate 代理', sortable:true },
                    { key:'churn_risk', label:t('common.atRisk'), sortable:false },
                    { key:'action', label:t('allVips.colNextAction'), sortable:false },
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
                  <tr><td colSpan={13} style={{ textAlign:'center', padding:'32px', color:'var(--muted)' }}>
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
                        <div style={{ fontWeight:600, color:'var(--text)' }}>{v.username}</div>
                        <div style={{ fontSize:11, color:'var(--muted)' }}>{v.full_name || ''}</div>
                        {gamingLabels[v.username] && (
                          <div style={{ marginTop:3 }}>
                            <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:'rgba(139,92,246,.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.25)' }}>
                              {gamingLabels[v.username].player_type_icon} {gamingLabels[v.username].player_type}
                            </span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        {v.tng_verify_status === 'verified' ? (
                          <span title={v.tng_verified_name || ''} style={{ display:'inline-flex', alignItems:'center', gap:3, background:'rgba(63,185,80,.12)', color:'#3fb950', border:'1px solid rgba(63,185,80,.3)', borderRadius:6, padding:'2px 7px', fontSize:11, fontWeight:700, cursor:'default' }}>✓ Verified</span>
                        ) : v.tng_verify_status === 'mismatch' ? (
                          <span title={v.tng_verified_name || ''} style={{ display:'inline-flex', alignItems:'center', gap:3, background:'rgba(210,153,34,.12)', color:'#d29922', border:'1px solid rgba(210,153,34,.3)', borderRadius:6, padding:'2px 7px', fontSize:11, fontWeight:700, cursor:'default' }}>⚠ Mismatch</span>
                        ) : (
                          <span style={{ color:'var(--muted)', fontSize:11 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <TierBadge tier={v.tier} />
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <StatusBadge status={v.activity_status} />
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>
                        {(() => {
                          const sg = segMap[v.username]
                          if (!sg) return <span style={{ color:'var(--muted)', fontSize:11 }}>No deposits</span>
                          const cfg = SEGMENTS[sg.segment] || SEGMENTS.Stable
                          return <span title={sg.trend_pct != null ? `Trend ${sg.trend_pct}% · ${sg.days_since_last}d since last deposit` : ''} style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10, background:cfg.bg, color:cfg.color }}>{cfg.icon} {sg.segment}</span>
                        })()}
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
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', fontSize:12 }} onClick={e => e.stopPropagation()}>
                        {v.host_assigned ? (
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <span style={{ color:'var(--text)', fontWeight:500 }}>{v.host_assigned}</span>
                            {profile?.role === 'admin' && (
                              <button
                                onClick={e => { e.stopPropagation(); setAssigningVip(v.id) }}
                                title="Reassign host"
                                style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:11, padding:'1px 4px', borderRadius:4, lineHeight:1 }}
                              >✎</button>
                            )}
                          </div>
                        ) : profile?.role === 'admin' ? (
                          assigningVip === v.id ? (
                            <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                              <select
                                autoFocus
                                disabled={assignBusy === v.id}
                                onChange={e => { if (e.target.value) assignHost(v.id, e.target.value) }}
                                style={{ background:'var(--surface)', border:'1px solid var(--brand)', color:'var(--text)', padding:'4px 6px', borderRadius:5, fontSize:12, cursor:'pointer', maxWidth:130 }}
                              >
                                <option value="">Pick host…</option>
                                {hosts.filter(h => h !== 'ALL' && h !== '__unassigned__').map(h => <option key={h} value={h}>{h}</option>)}
                              </select>
                              <button onClick={() => setAssigningVip(null)} style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:13, padding:'2px 4px' }}>✕</button>
                            </div>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); setAssigningVip(v.id) }}
                              style={{ background:'rgba(255,106,0,.1)', border:'1px solid var(--brand)', color:'var(--brand)', padding:'3px 9px', borderRadius:5, fontSize:11, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}
                            >
                              {assignBusy === v.id ? '…' : '+ Assign'}
                            </button>
                          )
                        ) : (
                          <span style={{ color:'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', fontSize:12, whiteSpace:'nowrap' }}>
                        {v.affiliate_login ? <span style={{ fontWeight:600, color:'var(--brand)' }}>{v.affiliate_login}</span>
                          : v.affiliate_updated_at ? <span style={{ color:'var(--text)' }}>Direct</span>
                          : <span style={{ color:'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <RiskBadge risk={v.churn_risk} />
                      </td>
                      <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                          <Btn size="sm" variant="ghost" onClick={e => { e.stopPropagation(); navigate(`/vips/${v.id}`) }}>
                            {t('allVips.openVip')}
                          </Btn>
                          {profile?.role === 'admin' && (
                            <Btn
                              size="sm"
                              variant="ghost"
                              disabled={activationBusy === v.id}
                              onClick={e => { e.stopPropagation(); generateActivation(v) }}
                              title="Generate a one-time Player Portal activation link"
                            >
                              {activationBusy === v.id ? t('allVips.generating') : t('allVips.activatePortal')}
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
