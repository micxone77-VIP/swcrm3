// src/components/vip/DepositSegments.jsx — Analytics tab: deposit segments work list (充值分群)
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { TIER_COLOR, TIER_BG } from '../../lib/constants'
import { SEGMENTS, STYLES, fmtHour, fmtRM, fetchAll } from '../../lib/depositProfile'

const sel = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text)' }
const th = { textAlign: 'left', padding: '10px 12px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
const td = { padding: '9px 12px', whiteSpace: 'nowrap' }

export default function DepositSegments({ myName = 'VIP Team' }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [members, setMembers] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [segF, setSegF] = useState('RISK')       // RISK = Silent + Declining
  const [tierF, setTierF] = useState('ALL')
  const [hostF, setHostF] = useState('ALL')
  const [affF, setAffF] = useState('ALL')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('at_risk')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const prof = await fetchAll(() => supabase.from('v_vip_deposit_profile').select('*').order('login'))
        const mem = await fetchAll(() => supabase.from('vip_members').select('id, username, phone, whatsapp, is_excluded').order('username'))
        if (cancelled) return
        const map = {}
        mem.forEach(m => { map[m.username] = m })
        setMembers(map)
        setRows(prof.filter(p => !map[p.login]?.is_excluded))
      } catch (e) {
        console.error('DepositSegments load error', e)
        if (!cancelled) setErr(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const hosts = useMemo(() => [...new Set(rows.map(r => r.host_assigned).filter(Boolean))].sort(), [rows])
  const affs = useMemo(() => [...new Set(rows.map(r => r.affiliate_login).filter(Boolean))].sort(), [rows])
  const tiers = useMemo(() => [...new Set(rows.map(r => r.tier).filter(Boolean))].sort(), [rows])

  // rows after tier/host/search (segment counts reflect these filters)
  const scoped = useMemo(() => rows.filter(r =>
    (tierF === 'ALL' || r.tier === tierF) &&
    (hostF === 'ALL' || (hostF === '__none' ? !r.host_assigned : r.host_assigned === hostF)) &&
    (affF === 'ALL' || (affF === '__direct' ? !r.affiliate_login : r.affiliate_login === affF)) &&
    (!search || r.login.toLowerCase().includes(search.toLowerCase()) || (r.member_name || '').toLowerCase().includes(search.toLowerCase()))
  ), [rows, tierF, hostF, affF, search])

  const counts = useMemo(() => {
    const c = {}
    Object.keys(SEGMENTS).forEach(k => { c[k] = { n: 0, normal: 0 } })
    scoped.forEach(r => { if (c[r.segment]) { c[r.segment].n++; c[r.segment].normal += Number(r.dep_prev_60d || 0) / 2 } })
    return c
  }, [scoped])

  const list = useMemo(() => {
    const f = scoped.filter(r => segF === 'ALL' || (segF === 'RISK' ? (r.segment === 'Silent' || r.segment === 'Declining') : r.segment === segF))
    const val = r => {
      switch (sortKey) {
        case 'at_risk': return Math.max(0, Number(r.dep_prev_60d || 0) / 2 - Number(r.dep_30d || 0))
        case 'normal': return Number(r.dep_prev_60d || 0) / 2
        case 'dep_30d': return Number(r.dep_30d || 0)
        case 'trend': return r.trend_pct === null ? -9999 : Number(r.trend_pct)
        case 'days': return Number(r.days_since_last || 0)
        case 'overdue': return Number(r.overdue_ratio || 0)
        case 'login': return r.login
        default: return 0
      }
    }
    return [...f].sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y
      return sortDir === 'asc' ? c : -c
    })
  }, [scoped, segF, sortKey, sortDir])

  function sortBy(k) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'login' ? 'asc' : 'desc') }
  }
  const arrow = k => (sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading deposit segments…</div>
  if (err) return <div style={{ padding: 24, color: '#f87171' }}>Error loading deposit segments: {err}</div>

  const asOf = String(rows[0]?.data_as_of || '').slice(0, 10)

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0 8px 8px 8px', overflow: 'hidden' }}>
      {/* Segment cards */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>🧭 Deposit Segments 充值分群</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Based on deposit logs · data up to {asOf} · "normal" = monthly average of the 60 days before the last 30</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[['RISK', null], ...Object.keys(SEGMENTS).map(k => [k, SEGMENTS[k]]), ['ALL', null]].map(([k, s]) => {
            const active = segF === k
            const n = k === 'ALL' ? scoped.length : k === 'RISK' ? counts.Silent.n + counts.Declining.n : counts[k].n
            const color = s ? s.color : k === 'RISK' ? '#FF6B00' : 'var(--text)'
            const title = k === 'RISK' ? '🚨 Need action 需跟进' : k === 'ALL' ? '👥 All 全部' : `${s.icon} ${k} ${s.zh}`
            const sub = k === 'RISK' ? 'Silent + Declining' : k === 'ALL' ? 'All depositors' : s.desc
            return (
              <button key={k} onClick={() => setSegF(k)} style={{
                textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px',
                background: active ? (s ? s.bg : 'rgba(255,107,0,.12)') : 'var(--surface2)',
                border: active ? `1.5px solid ${color}` : '1px solid var(--border)', color: 'var(--text)',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color }}>{title}</div>
                <div style={{ fontSize: 22, fontWeight: 800, margin: '2px 0' }}>{n}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={sel}>
          <option value="ALL">All tiers</option>
          {tiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={hostF} onChange={e => setHostF(e.target.value)} style={sel}>
          <option value="ALL">All hosts</option>
          <option value="__none">(No host)</option>
          {hosts.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <select value={affF} onChange={e => setAffF(e.target.value)} style={sel}>
          <option value="ALL">All affiliates</option>
          <option value="__direct">Direct (no affiliate)</option>
          {affs.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search username / name" style={{ ...sel, minWidth: 180 }} />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{list.length} players</span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={th} onClick={() => sortBy('login')}>Player{arrow('login')}</th>
              <th style={th}>Tier</th>
              <th style={th}>Host</th>
              <th style={th}>Affiliate</th>
              <th style={th}>Segment</th>
              <th style={th}>Style</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('normal')}>Normal / mth{arrow('normal')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('dep_30d')}>Last 30d{arrow('dep_30d')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('at_risk')} title="Normal monthly minus last 30 days">Shortfall{arrow('at_risk')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('trend')}>Trend{arrow('trend')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('days')}>Days since{arrow('days')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('overdue')} title="Days since last deposit ÷ usual gap">Overdue{arrow('overdue')}</th>
              <th style={th}>Best time</th>
              <th style={{ ...th, textAlign: 'center', cursor: 'default' }}>WA</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={14} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>No players in this segment.</td></tr>
            ) : list.map(r => {
              const m = members[r.login] || {}
              const seg = SEGMENTS[r.segment] || SEGMENTS.Stable
              const sty = STYLES[r.deposit_style] || STYLES.Regular
              const normal = Number(r.dep_prev_60d || 0) / 2
              const shortfall = Math.max(0, normal - Number(r.dep_30d || 0))
              const trend = r.trend_pct === null || r.trend_pct === undefined ? null : Number(r.trend_pct)
              const overdue = Number(r.overdue_ratio || 0)
              const rawNumber = (m.phone && m.phone.replace(/\D/g, '').length >= 10) ? m.phone
                : (m.whatsapp && m.whatsapp.replace(/\D/g, '').length >= 10) ? m.whatsapp : ''
              const waNumber = rawNumber.replace(/\D/g, '')
              const greeting = encodeURIComponent(`Hi ${r.login}, this is ${myName} from the VIP department.`)
              return (
                <tr key={r.login} style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <td style={td}>
                    {m.id ? (
                      <span onClick={() => navigate(`/vips/${m.id}`)} style={{ fontWeight: 700, color: 'var(--brand, #FF6B00)', cursor: 'pointer' }}>{r.login}</span>
                    ) : <span style={{ fontWeight: 700 }}>{r.login}</span>}
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.member_name}</div>
                  </td>
                  <td style={td}>
                    {r.tier && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: TIER_BG[r.tier] || 'transparent', color: TIER_COLOR[r.tier] || 'var(--text)' }}>{r.tier}</span>}
                  </td>
                  <td style={{ ...td, color: r.host_assigned ? 'var(--text)' : 'var(--muted)' }}>{r.host_assigned || '—'}</td>
                  <td style={{ ...td, color: r.affiliate_login ? 'var(--brand, #FF6B00)' : 'var(--muted)', fontWeight: r.affiliate_login ? 600 : 400 }}>{r.affiliate_login || 'Direct'}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: seg.bg, color: seg.color }}>{seg.icon} {r.segment}</span>
                  </td>
                  <td style={td} title={r.deposit_style}>{sty.icon} {sty.zh}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtRM(normal)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtRM(r.dep_30d)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: shortfall > 0 ? '#f87171' : 'var(--muted)' }}>{shortfall > 0 ? fmtRM(shortfall) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: trend === null ? 'var(--muted)' : trend < 0 ? '#f87171' : '#34d399' }}>
                    {trend === null ? '—' : `${trend > 0 ? '+' : ''}${trend}%`}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.days_since_last}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: overdue >= 2 ? 700 : 400, color: overdue >= 2 ? '#f87171' : 'var(--text)' }}>
                    {r.avg_gap_days ? `${overdue}×` : '—'}
                  </td>
                  <td style={td}>{r.peak_day_name} {fmtHour(r.peak_hour)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {waNumber ? (
                      <a href={`https://wa.me/${waNumber}?text=${greeting}`} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 13, background: '#25D366', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>W</a>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
