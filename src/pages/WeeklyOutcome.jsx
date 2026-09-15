// src/pages/WeeklyOutcome.jsx — Weekly Retention Outcome Tracker
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  Card, Btn, LoadingState, ErrorState,
} from '../components/ui'
import { TierBadge, RiskBadge } from '../components/ui'
import { formatMoney } from '../lib/format'

// ── helpers ────────────────────────────────────────────────────────────────
function getMondayOfWeek(date) {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
function fmt(d) { return d.toISOString().slice(0, 10) }
function fmtDisplay(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}
function timeAgo(iso) {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return `${diff}d ago`
}
function weekLabel(mon) {
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6)
  const opts = { day: 'numeric', month: 'short' }
  return `${mon.toLocaleDateString('en-MY', opts)} – ${sun.toLocaleDateString('en-MY', { ...opts, year: 'numeric' })}`
}

// Best outcome ranking (higher = better)
const OUTCOME_RANK = { Reactivated: 5, Deposited: 4, Replied: 3, Contacted: 2, 'No Reply': 1 }
const OUTCOME_COLOR = {
  Reactivated: '#3fb950', Deposited: '#58a6ff',
  Replied: '#d29922', Contacted: 'var(--muted)', 'No Reply': '#f85149',
}

const TIER_COLOR = { DIAMOND:'#58a6ff', PLATINUM:'#cbd5e1', GOLD:'#fbbf24', SILVER:'#94a3b8', BRONZE:'#c2855a' }

// ── VIP Row ────────────────────────────────────────────────────────────────
function VipRow({ v, showOutcome, navigate }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr
        style={{ cursor: 'pointer', transition: 'background .1s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        onClick={() => setOpen(o => !o)}
      >
        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <TierBadge tier={v.tier} />
            <div>
              <div style={{ fontWeight:700, fontSize:13, color:'var(--text)', cursor:'pointer' }}
                onClick={e => { e.stopPropagation(); navigate(`/vips/${v.id}`) }}>
                {v.username}
              </div>
              {v.full_name && <div style={{ fontSize:11, color:'var(--muted)' }}>{v.full_name}</div>}
            </div>
          </div>
        </td>
        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize:12 }}>
          <div style={{ fontWeight:600, color:'var(--text)' }}>{fmtDisplay(v.last_deposit_date)}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{timeAgo(v.last_deposit_date)}</div>
        </td>
        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize:12 }}>
          <span style={{ color: v.days_inactive >= 14 ? '#f85149' : v.days_inactive >= 7 ? '#d29922' : 'var(--muted)', fontWeight:700 }}>
            {v.days_inactive != null ? `${v.days_inactive}d` : '—'}
          </span>
        </td>
        {showOutcome && (
          <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
            {v.bestOutcome ? (
              <span style={{
                fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:20,
                background: (OUTCOME_COLOR[v.bestOutcome] || '#888') + '22',
                color: OUTCOME_COLOR[v.bestOutcome] || '#888',
              }}>{v.bestOutcome}</span>
            ) : '—'}
          </td>
        )}
        {showOutcome && (
          <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize:11, color:'var(--muted)' }}>
            {v.host || '—'}
          </td>
        )}
        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>
          {v.churn_risk ? <RiskBadge risk={v.churn_risk} /> : '—'}
        </td>
        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign:'right' }}>
          {v.logs?.length > 0 && (
            <span style={{ fontSize:10, color:'var(--muted)' }}>
              {open ? '▲' : `+${v.logs.length} log${v.logs.length > 1 ? 's' : ''}`}
            </span>
          )}
        </td>
      </tr>
      {open && v.logs?.length > 0 && v.logs.map((log, i) => (
        <tr key={i} style={{ background:'var(--surface2)' }}>
          <td colSpan={showOutcome ? 7 : 5} style={{ padding:'6px 14px 6px 48px', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--muted)' }}>
            <span style={{ color: OUTCOME_COLOR[log.outcome] || 'var(--muted)', fontWeight:700 }}>{log.outcome}</span>
            {log.host_name && <span style={{ marginLeft:8 }}>by {log.host_name}</span>}
            <span style={{ marginLeft:8 }}>{new Date(log.logged_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
            {log.notes && <span style={{ marginLeft:8, color:'var(--text)' }}>· {log.notes}</span>}
          </td>
        </tr>
      ))}
    </>
  )
}

// ── Section Panel ──────────────────────────────────────────────────────────
function Panel({ title, subtitle, color, emoji, vips, showOutcome, navigate, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const cols = showOutcome
    ? ['VIP', 'Last Deposit', 'Inactive', 'Outcome', 'Contacted By', 'Risk', '']
    : ['VIP', 'Last Deposit', 'Inactive', 'Risk', '', '']

  return (
    <Card style={{ marginBottom:16, overflow:'hidden' }}>
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'13px 18px', borderBottom: open ? '1px solid var(--border)' : 'none',
        cursor:'pointer', background:`${color}08`,
      }} onClick={() => setOpen(o => !o)}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:18 }}>{emoji}</span>
          <div>
            <span style={{ fontWeight:700, fontSize:14, color }}>{title}</span>
            <span style={{ marginLeft:10, fontSize:11, color:'var(--muted)' }}>{subtitle}</span>
          </div>
          <span style={{
            fontSize:12, fontWeight:800, padding:'2px 10px', borderRadius:20,
            background:`${color}22`, color,
          }}>{vips.length}</span>
        </div>
        <span style={{ fontSize:12, color:'var(--muted)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        vips.length === 0 ? (
          <div style={{ padding:'24px', textAlign:'center', color:'var(--muted)', fontSize:13 }}>
            No VIPs in this category this week
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  {cols.map(h => (
                    <th key={h} style={{
                      padding:'8px 14px', textAlign:'left', background:'var(--surface)',
                      color:'var(--muted)', fontWeight:600, fontSize:11,
                      borderBottom:'1px solid var(--border)', whiteSpace:'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vips.map(v => (
                  <VipRow key={v.id} v={v} showOutcome={showOutcome} navigate={navigate} />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </Card>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function WeeklyOutcome() {
  const navigate = useNavigate()

  // Week picker — default to last completed Mon–Sun week
  const [weekMon, setWeekMon] = useState(() => {
    const lastMon = getMondayOfWeek(new Date())
    // if today is Monday, step back one more week
    lastMon.setDate(lastMon.getDate() - 7)
    return lastMon
  })

  const weekSun = useMemo(() => {
    const d = new Date(weekMon); d.setDate(d.getDate() + 6); return d
  }, [weekMon])

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchData()
  }, [weekMon])

  async function fetchData() {
    setLoading(true); setError(null)
    try {
      const start = fmt(weekMon)
      const end   = fmt(weekSun)

      const [
        { data: logs,    error: e1 },
        { data: members, error: e2 },
      ] = await Promise.all([
        // All contact logs this week
        supabase.from('contact_logs')
          .select('username, vip_id, outcome, notes, host_name, logged_at')
          .gte('logged_at', start + 'T00:00:00')
          .lte('logged_at', end   + 'T23:59:59'),
        // All active VIP members
        supabase.from('vip_members')
          .select('id, username, full_name, tier, last_deposit_date, days_inactive, churn_risk, currency, total_deposit')
          .eq('is_excluded', false),
      ])

      if (e1 || e2) throw new Error((e1 || e2).message)

      // Build contacted map: username → { bestOutcome, host, logs[] }
      const contactedMap = {}
      ;(logs || []).forEach(log => {
        if (!contactedMap[log.username]) {
          contactedMap[log.username] = { bestOutcome: null, host: null, logs: [] }
        }
        const entry = contactedMap[log.username]
        entry.logs.push(log)
        if (!entry.bestOutcome || (OUTCOME_RANK[log.outcome] || 0) > (OUTCOME_RANK[entry.bestOutcome] || 0)) {
          entry.bestOutcome = log.outcome
          entry.host = log.host_name
        }
      })

      // Enrich members with contact data
      const enriched = (members || []).map(m => ({
        ...m,
        ...(contactedMap[m.username] || {}),
        wasContacted: !!contactedMap[m.username],
        depositedThisWeek: m.last_deposit_date >= start && m.last_deposit_date <= end,
      }))

      // Group 1: Contacted → Reactivated/Deposited (outcome = Deposited/Reactivated OR deposited this week after contact)
      const contactedReactivated = enriched.filter(m =>
        m.wasContacted && (
          m.bestOutcome === 'Reactivated' ||
          m.bestOutcome === 'Deposited' ||
          m.depositedThisWeek
        )
      ).sort((a,b) => (TIER_COLOR[a.tier] < TIER_COLOR[b.tier] ? -1 : 1))

      // Group 2: Contacted → Still Churned (contacted but no deposit this week, not Deposited/Reactivated)
      const contactedChurned = enriched.filter(m =>
        m.wasContacted &&
        m.bestOutcome !== 'Reactivated' &&
        m.bestOutcome !== 'Deposited' &&
        !m.depositedThisWeek
      ).sort((a,b) => (b.days_inactive || 0) - (a.days_inactive || 0))

      // Group 3: Not Contacted → Self-Activated (deposited this week, no contact log)
      const selfActivated = enriched.filter(m =>
        !m.wasContacted && m.depositedThisWeek
      ).sort((a,b) => (b.total_deposit || 0) - (a.total_deposit || 0))

      // Group 4: Not Contacted → Still At Risk (inactive 7+ days or churn risk high/critical, no contact, no self-activate)
      const notContactedAtRisk = enriched.filter(m =>
        !m.wasContacted &&
        !m.depositedThisWeek &&
        (
          (m.days_inactive != null && m.days_inactive >= 7) ||
          m.churn_risk === 'high' || m.churn_risk === 'critical'
        )
      ).sort((a,b) => (b.days_inactive || 0) - (a.days_inactive || 0))

      setData({ contactedReactivated, contactedChurned, selfActivated, notContactedAtRisk, totalContacted: Object.keys(contactedMap).length })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function prevWeek() { const d = new Date(weekMon); d.setDate(d.getDate() - 7); setWeekMon(d) }
  function nextWeek() { const d = new Date(weekMon); d.setDate(d.getDate() + 7); setWeekMon(d) }
  const isThisWeek = fmt(getMondayOfWeek(new Date())) === fmt(weekMon)

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>

      {/* ── Header ── */}
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:24, fontWeight:700, margin:'0 0 4px' }}>Weekly Outcome</h1>
        <div style={{ fontSize:13, color:'var(--muted)' }}>
          Who was contacted, who came back, who slipped through — one week at a glance
        </div>
      </div>

      {/* ── Week Picker ── */}
      <Card style={{ marginBottom:20, padding:'14px 18px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <Btn variant="ghost" size="sm" onClick={prevWeek}>← Prev</Btn>
          <div style={{ fontWeight:700, fontSize:15, color:'var(--text)', minWidth:200, textAlign:'center' }}>
            {weekLabel(weekMon)}
          </div>
          <Btn variant="ghost" size="sm" onClick={nextWeek} disabled={isThisWeek}>Next →</Btn>
          {!isThisWeek && (
            <Btn variant="ghost" size="sm" onClick={() => {
              const d = getMondayOfWeek(new Date()); d.setDate(d.getDate() - 7); setWeekMon(d)
            }}>Last Week</Btn>
          )}
          <div style={{ marginLeft:'auto', fontSize:12, color:'var(--muted)' }}>
            Mon {fmt(weekMon)} — Sun {fmt(weekSun)}
          </div>
        </div>
      </Card>

      {loading && <LoadingState message="Loading weekly outcomes…" />}
      {error   && <ErrorState message={error} onRetry={fetchData} />}

      {!loading && !error && data && (() => {
        const totalInScope = data.contactedReactivated.length + data.contactedChurned.length + data.selfActivated.length + data.notContactedAtRisk.length
        const contactRate  = totalInScope > 0
          ? Math.round((data.contactedReactivated.length + data.contactedChurned.length) / totalInScope * 100)
          : 0
        const reactRate = (data.contactedReactivated.length + data.contactedChurned.length) > 0
          ? Math.round(data.contactedReactivated.length / (data.contactedReactivated.length + data.contactedChurned.length) * 100)
          : 0

        return (
          <>
            {/* ── Performance Summary ── */}
            <Card style={{ marginBottom:20, padding:'16px 20px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:14 }}>
                Week Performance Summary
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12 }}>
                {[
                  { label:'Total Contacted', value: data.totalContacted, color:'#58a6ff', sub:'unique VIPs reached' },
                  { label:'Reactivated', value: data.contactedReactivated.length, color:'#3fb950', sub:`${reactRate}% of contacted` },
                  { label:'Still Churned', value: data.contactedChurned.length, color:'#f85149', sub:'contacted, no deposit' },
                  { label:'Self-Activated', value: data.selfActivated.length, color:'#d29922', sub:'deposited, no contact needed' },
                  { label:'Missed / At Risk', value: data.notContactedAtRisk.length, color:'#c2855a', sub:'not reached, still inactive' },
                  { label:'Contact Rate', value: `${contactRate}%`, color: contactRate >= 60 ? '#3fb950' : contactRate >= 40 ? '#d29922' : '#f85149', sub:'of at-risk VIPs reached' },
                ].map(s => (
                  <div key={s.label} style={{ background:'var(--surface2)', borderRadius:8, padding:'10px 12px', borderLeft:`3px solid ${s.color}` }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--muted)', marginBottom:4 }}>{s.label}</div>
                    <div style={{ fontSize:24, fontWeight:800, color:s.color, lineHeight:1 }}>{s.value}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* ── 4 Panels ── */}
            <Panel
              title="Contacted → Reactivated"
              subtitle="contacted this week and deposited"
              emoji="✅"
              color="#3fb950"
              vips={data.contactedReactivated}
              showOutcome={true}
              navigate={navigate}
              defaultOpen={true}
            />
            <Panel
              title="Contacted → Still Churned"
              subtitle="reached out but no deposit followed"
              emoji="❌"
              color="#f85149"
              vips={data.contactedChurned}
              showOutcome={true}
              navigate={navigate}
              defaultOpen={true}
            />
            <Panel
              title="Not Contacted → Self-Activated"
              subtitle="deposited this week without being contacted"
              emoji="🟢"
              color="#d29922"
              vips={data.selfActivated}
              showOutcome={false}
              navigate={navigate}
              defaultOpen={true}
            />
            <Panel
              title="Not Contacted → Still At Risk"
              subtitle="7+ days inactive, never reached this week"
              emoji="⚠️"
              color="#c2855a"
              vips={data.notContactedAtRisk}
              showOutcome={false}
              navigate={navigate}
              defaultOpen={false}
            />
          </>
        )
      })()}
    </div>
  )
}
