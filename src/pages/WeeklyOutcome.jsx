// src/pages/WeeklyOutcome.jsx — weekly contact outcome summary
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'

const OUTCOMES = ['Contacted','Replied','Deposited','Reactivated','No Reply']
const OUTCOME_COLOR = {
  Deposited:'#ffd700', Reactivated:'#3fb950', Replied:'#58a6ff',
  Contacted:'#8b949e', 'No Reply':'#d29922',
}

const s = {
  page:  { padding:'24px 28px', minHeight:'100vh', color:'var(--text)' },
  title: { fontSize:22, fontWeight:700 },
  sub:   { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:20 },
  grid:  { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12, marginBottom:24 },
  card:  { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 20px' },
  stat:  { fontSize:28, fontWeight:800, color:'var(--brand)', marginBottom:2 },
  lbl:   { fontSize:12, color:'var(--muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.5px' },
  tbl:   { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:    { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)' },
  td:    { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  badge: { display:'inline-block', padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:700 },
  weekBtn: { padding:'6px 14px', borderRadius:7, border:'1px solid var(--border)', fontSize:13, cursor:'pointer', fontWeight:600 },
  sectionTitle: { fontSize:15, fontWeight:700, marginBottom:12, marginTop:4 },
  tableWrap: { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', marginBottom:24 },
  tableHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' },
}

function weekRange(offsetWeeks = 0) {
  const now = new Date()
  const day = now.getDay() // 0=Sun
  const monDiff = (day === 0 ? -6 : 1 - day) - offsetWeeks * 7
  const mon = new Date(now); mon.setHours(0,0,0,0); mon.setDate(now.getDate() + monDiff)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999)
  return { start: mon, end: sun }
}

function fmt(d) { return d.toISOString().slice(0,10) }
function fmtLabel(d) { return d.toLocaleDateString('en-MY',{ day:'numeric', month:'short' }) }

export default function WeeklyOutcome() {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const [weekOffset, setWeekOffset] = useState(0)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  const { start, end } = weekRange(weekOffset)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('contact_logs')
        .select('id,vip_id,contact_type,outcome,notes,contacted_at,vip_members(username,tier,host_assigned)')
        .gte('contacted_at', start.toISOString())
        .lte('contacted_at', end.toISOString())
        .order('contacted_at', { ascending: false })
        .limit(500)
      setLogs(data || [])
      setLoading(false)
    }
    load()
  }, [weekOffset])

  // Aggregate stats
  const totals = {}
  OUTCOMES.forEach(o => { totals[o] = 0 })
  logs.forEach(l => { if (totals[l.outcome] !== undefined) totals[l.outcome]++ })
  const totalContacts = logs.length

  // Per-host breakdown
  const byHost = {}
  logs.forEach(l => {
    const host = l.vip_members?.host_assigned || 'Unassigned'
    if (!byHost[host]) byHost[host] = { total:0 }
    OUTCOMES.forEach(o => { if (!byHost[host][o]) byHost[host][o] = 0 })
    byHost[host].total++
    if (totals[l.outcome] !== undefined) byHost[host][l.outcome]++
  })
  const hostRows = Object.entries(byHost).sort((a,b) => b[1].total - a[1].total)

  const weekLabel = weekOffset === 0
    ? 'This Week'
    : weekOffset === 1 ? 'Last Week' : `${weekOffset} Weeks Ago`

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={s.title}>📋 Weekly Outcome</div>
          <div style={s.sub}>Contact results for {fmtLabel(start)} – {fmtLabel(end)} · {totalContacts} logs</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button style={{ ...s.weekBtn, background: weekOffset===1?'var(--brand)':'var(--surface)', color: weekOffset===1?'#fff':'var(--text)' }}
            onClick={() => setWeekOffset(1)}>Last Week</button>
          <button style={{ ...s.weekBtn, background: weekOffset===0?'var(--brand)':'var(--surface)', color: weekOffset===0?'#fff':'var(--text)' }}
            onClick={() => setWeekOffset(0)}>This Week</button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div style={s.grid}>
        <div style={s.card}>
          <div style={{ ...s.stat, color:'var(--text)' }}>{totalContacts}</div>
          <div style={s.lbl}>Total Contacts</div>
        </div>
        {OUTCOMES.map(o => (
          <div key={o} style={s.card}>
            <div style={{ ...s.stat, color: OUTCOME_COLOR[o] }}>{totals[o]}</div>
            <div style={s.lbl}>{o}</div>
          </div>
        ))}
      </div>

      {/* Per-host breakdown */}
      <div style={s.sectionTitle}>By Host</div>
      <div style={s.tableWrap}>
        <div style={s.tableHdr}>Host Breakdown — {weekLabel}</div>
        {loading ? (
          <div style={{ padding:24, color:'var(--muted)', fontSize:13 }}>Loading…</div>
        ) : hostRows.length === 0 ? (
          <div style={{ padding:24, color:'var(--muted)', fontSize:13 }}>No contacts logged this week.</div>
        ) : (
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>Host</th>
                <th style={s.th}>Total</th>
                {OUTCOMES.map(o => <th key={o} style={s.th}>{o}</th>)}
              </tr>
            </thead>
            <tbody>
              {hostRows.map(([host, counts]) => (
                <tr key={host}>
                  <td style={s.td}><strong>{host}</strong></td>
                  <td style={s.td}><strong>{counts.total}</strong></td>
                  {OUTCOMES.map(o => (
                    <td key={o} style={s.td}>
                      {counts[o] > 0
                        ? <span style={{ ...s.badge, background: OUTCOME_COLOR[o]+'22', color: OUTCOME_COLOR[o] }}>{counts[o]}</span>
                        : <span style={{ color:'var(--muted)' }}>—</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent log entries */}
      <div style={s.sectionTitle}>Contact Log — {weekLabel}</div>
      <div style={s.tableWrap}>
        <div style={s.tableHdr}>All Entries ({logs.length})</div>
        {loading ? (
          <div style={{ padding:24, color:'var(--muted)', fontSize:13 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding:24, color:'var(--muted)', fontSize:13 }}>No contacts logged this week.</div>
        ) : (
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>Date</th>
                <th style={s.th}>Username</th>
                <th style={s.th}>Tier</th>
                <th style={s.th}>Host</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Outcome</th>
                <th style={s.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td style={s.td}>{l.contacted_at?.slice(0,10) || '-'}</td>
                  <td style={s.td}><strong>{l.vip_members?.username || l.vip_id}</strong></td>
                  <td style={s.td}>{l.vip_members?.tier || '-'}</td>
                  <td style={s.td}>{l.vip_members?.host_assigned || '-'}</td>
                  <td style={s.td}>{l.contact_type || '-'}</td>
                  <td style={s.td}>
                    {l.outcome
                      ? <span style={{ ...s.badge, background:(OUTCOME_COLOR[l.outcome]||'#8b949e')+'22', color:OUTCOME_COLOR[l.outcome]||'#8b949e' }}>{l.outcome}</span>
                      : '-'}
                  </td>
                  <td style={{ ...s.td, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--muted)' }}>{l.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
