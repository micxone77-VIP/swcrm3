// src/pages/ActiveTracker.jsx — Diamond & Platinum active player tracker
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Card, LoadingState } from '../components/ui'

const TIER_COLOR  = { DIAMOND:'#58a6ff', PLATINUM:'#cbd5e1' }
const TIERS       = ['DIAMOND', 'PLATINUM']

function fmt(d) { return d.toISOString().slice(0, 10) }
function pad(n)  { return new Date(Date.now() - n * 86400000) }

export default function ActiveTracker() {
  const navigate  = useNavigate()
  const [tier, setTier]       = useState('DIAMOND')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const today      = new Date()
    const thisStart  = fmt(pad(6))
    const thisEnd    = fmt(today)
    const lastStart  = fmt(pad(13))
    const lastEnd    = fmt(pad(7))
    const monthStart = fmt(new Date(today.getFullYear(), today.getMonth(), 1))

    const ACTIVE_FILTER = 'monthly_valid_bet.gt.0,total_deposit.gt.0'

    const [
      { data: members },
      { data: thisSnap },
      { data: lastSnap },
      { data: monthSnap },
    ] = await Promise.all([
      supabase.from('vip_members')
        .select('id, username, full_name, tier, host_assigned, days_inactive')
        .eq('is_excluded', false)
        .order('username'),
      supabase.from('vip_daily_snapshots')
        .select('username, total_deposit, monthly_valid_bet')
        .gte('snapshot_date', thisStart).lte('snapshot_date', thisEnd)
        .or(ACTIVE_FILTER),
      supabase.from('vip_daily_snapshots')
        .select('username, total_deposit, monthly_valid_bet')
        .gte('snapshot_date', lastStart).lte('snapshot_date', lastEnd)
        .or(ACTIVE_FILTER),
      supabase.from('vip_daily_snapshots')
        .select('username, total_deposit, monthly_valid_bet')
        .gte('snapshot_date', monthStart).lte('snapshot_date', thisEnd)
        .or(ACTIVE_FILTER),
    ])

    const activeThisWeek  = new Set((thisSnap  || []).map(r => r.username))
    const activeLastWeek  = new Set((lastSnap  || []).map(r => r.username))
    const activeThisMonth = new Set((monthSnap || []).map(r => r.username))

    // normalise tier casing
    const norm = t => (t || '').toUpperCase()

    const result = {}
    for (const t of TIERS) {
      const members_t = (members || []).filter(m => norm(m.tier) === t)
      const dropped   = members_t.filter(m => activeLastWeek.has(m.username) && !activeThisWeek.has(m.username))
      const activeNow = members_t.filter(m => activeThisWeek.has(m.username))
      const inactiveMonth = members_t.filter(m => !activeThisMonth.has(m.username))
      result[t] = { members: members_t, dropped, activeNow, inactiveMonth, activeThisWeek, activeLastWeek, activeThisMonth }
    }

    setData({ result, thisStart, thisEnd, lastStart, lastEnd, monthStart })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ padding:32 }}><LoadingState message="Loading activity data…" /></div>

  const { result, thisStart, thisEnd, lastStart, lastEnd, monthStart } = data
  const d = result[tier]
  const color = TIER_COLOR[tier] || '#888'
  const tierLabel = tier.charAt(0) + tier.slice(1).toLowerCase()

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>

      {/* Header */}
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:24, fontWeight:700, margin:0 }}>Active Player Tracker</h1>
        <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>
          Active = valid bet OR deposit moved · Login-only excluded
        </div>
      </div>

      {/* Tier tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:24 }}>
        {TIERS.map(t => (
          <button key={t} onClick={() => setTier(t)} style={{
            padding:'8px 24px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer',
            border:`2px solid ${t === tier ? TIER_COLOR[t] : 'var(--border)'}`,
            background: t === tier ? TIER_COLOR[t] + '22' : 'transparent',
            color: t === tier ? TIER_COLOR[t] : 'var(--muted)',
            transition:'all .15s',
          }}>
            {t.charAt(0) + t.slice(1).toLowerCase()}
            <span style={{ marginLeft:8, fontSize:11, opacity:.8 }}>({result[t].members.length})</span>
          </button>
        ))}
        <button onClick={load} style={{
          marginLeft:'auto', padding:'8px 16px', borderRadius:8, fontSize:12, fontWeight:600,
          border:'1px solid var(--border)', background:'transparent', color:'var(--muted)', cursor:'pointer',
        }}>↻ Refresh</button>
      </div>

      {/* Summary tiles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
        {[
          { label:'Total Members',        val: d.members.length,        color:'var(--text)',  sub: tierLabel },
          { label:'Active This Month',    val: d.members.filter(m=>d.activeThisMonth.has(m.username)).length, color:'#3fb950', sub: monthStart + ' → today' },
          { label:'Active This Week',     val: d.activeNow.length,      color:'#58a6ff',      sub: thisStart + ' → ' + thisEnd },
          { label:'⚠️ Need Attention',   val: d.dropped.length + d.inactiveMonth.length, color:'#f85149', sub: 'dropped off + inactive all month' },
        ].map(tile => (
          <Card key={tile.label} style={{ padding:'14px 18px' }}>
            <div style={{ fontSize:10, color:'var(--muted)', fontWeight:700, letterSpacing:'.4px', textTransform:'uppercase', marginBottom:4 }}>{tile.label}</div>
            <div style={{ fontSize:30, fontWeight:800, color:tile.color, lineHeight:1 }}>{tile.val}</div>
            <div style={{ fontSize:10, color:'var(--disabled)', marginTop:4 }}>{tile.sub}</div>
          </Card>
        ))}
      </div>

      {/* ── Section 1: Dropped off — was active last week, gone this week ── */}
      <Section
        title="⚠️ Dropped Off This Week"
        subtitle={`Active ${lastStart} – ${lastEnd} but NOT active this week — contact these players`}
        color="#f85149"
        players={d.dropped}
        activeThisWeek={d.activeThisWeek}
        activeLastWeek={d.activeLastWeek}
        activeThisMonth={d.activeThisMonth}
        navigate={navigate}
        emptyMsg="No players dropped off — great retention this week!"
        tierColor={color}
      />

      {/* ── Section 2: Inactive all month ── */}
      <Section
        title="❌ Inactive All Month"
        subtitle={`No valid bet or deposit since ${monthStart} — needs follow-up`}
        color="#d29922"
        players={d.inactiveMonth}
        activeThisWeek={d.activeThisWeek}
        activeLastWeek={d.activeLastWeek}
        activeThisMonth={d.activeThisMonth}
        navigate={navigate}
        emptyMsg="All members have had activity this month!"
        tierColor={color}
      />

      {/* ── Section 3: Active this week ── */}
      <Section
        title="✅ Active This Week"
        subtitle={`Had valid bet or deposit from ${thisStart} to ${thisEnd}`}
        color="#3fb950"
        players={d.activeNow}
        activeThisWeek={d.activeThisWeek}
        activeLastWeek={d.activeLastWeek}
        activeThisMonth={d.activeThisMonth}
        navigate={navigate}
        emptyMsg="No active players this week yet."
        tierColor={color}
        defaultCollapsed={true}
      />
    </div>
  )
}

function Section({ title, subtitle, color, players, activeThisWeek, activeLastWeek, activeThisMonth, navigate, emptyMsg, tierColor, defaultCollapsed = false }) {
  const [open, setOpen] = useState(!defaultCollapsed)

  return (
    <Card style={{ marginBottom:16 }}>
      {/* Section header */}
      <button onClick={() => setOpen(o => !o)} style={{
        width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'14px 18px', background:'transparent', border:'none', cursor:'pointer', textAlign:'left',
      }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>{title}</span>
            <span style={{
              fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20,
              background: color + '22', color,
            }}>{players.length}</span>
          </div>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{subtitle}</div>
        </div>
        <span style={{ fontSize:12, color:'var(--disabled)', transform: open ? 'rotate(180deg)' : 'none', transition:'transform .2s' }}>▾</span>
      </button>

      {open && (
        <div style={{ borderTop:'1px solid var(--border)' }}>
          {players.length === 0 ? (
            <div style={{ padding:'20px 18px', color:'var(--muted)', fontSize:13, textAlign:'center' }}>{emptyMsg}</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--surface)' }}>
                  {['Username', 'Host', 'Days Inactive', 'Active Last Week?', 'Active This Month?', ''].map(h => (
                    <th key={h} style={{ padding:'8px 16px', textAlign:'left', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map(p => {
                  const wasLW = activeLastWeek.has(p.username)
                  const activeMo = activeThisMonth.has(p.username)
                  return (
                    <tr key={p.id}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      style={{ transition:'background .1s', cursor:'pointer' }}
                      onClick={() => navigate(`/vips/${p.id}`)}
                    >
                      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ fontWeight:700, color: tierColor }}>{p.username}</div>
                        {p.full_name && <div style={{ fontSize:11, color:'var(--muted)' }}>{p.full_name}</div>}
                      </td>
                      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12 }}>
                        {p.host_assigned || '—'}
                      </td>
                      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
                        <span style={{
                          fontSize:12, fontWeight:600,
                          color: (p.days_inactive||0) >= 14 ? '#f85149' : (p.days_inactive||0) >= 7 ? '#d29922' : '#3fb950',
                        }}>
                          {p.days_inactive === 0 ? 'Today' : p.days_inactive === 1 ? '1 day' : `${p.days_inactive ?? '?'} days`}
                        </span>
                      </td>
                      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
                        <span style={{ fontSize:12, fontWeight:600, color: wasLW ? '#3fb950' : '#f85149' }}>
                          {wasLW ? '✓ Yes' : '✗ No'}
                        </span>
                      </td>
                      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
                        <span style={{ fontSize:12, fontWeight:600, color: activeMo ? '#3fb950' : '#f85149' }}>
                          {activeMo ? '✓ Yes' : '✗ No'}
                        </span>
                      </td>
                      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/vips/${p.id}`) }}
                          style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid var(--border)', background:'transparent', color:'var(--muted)', cursor:'pointer' }}
                        >
                          Open →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  )
}
