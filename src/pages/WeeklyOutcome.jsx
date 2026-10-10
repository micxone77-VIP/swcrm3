// src/pages/WeeklyOutcome.jsx — weekly contact outcome summary
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'

const OUTCOMES = ['Contacted','Replied','Deposited','Reactivated','No Reply']
const OUTCOME_ZH = { Contacted:'已联系', Replied:'已回复', Deposited:'已存款', Reactivated:'已召回', 'No Reply':'未回复', WhatsApp:'WhatsApp', Call:'电话', 'In-person':'面谈', Other:'其他' }
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
function fmtLabel(d, lang) { return d.toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{ day:'numeric', month:'short' }) }

export default function WeeklyOutcome() {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const OL = (o) => (lang === 'zh' ? (OUTCOME_ZH[o] || o) : o)
  const [weekOffset, setWeekOffset] = useState(0)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  const { start, end } = weekRange(weekOffset)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('contact_logs')
        .select('id,vip_id,channel,outcome,notes,logged_at,host_name,vip_members(username,tier,host_assigned)')
        .gte('logged_at', start.toISOString())
        .lte('logged_at', end.toISOString())
        .order('logged_at', { ascending: false })
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
    const host = l.host_name || l.vip_members?.host_assigned || 'Unassigned'
    if (!byHost[host]) byHost[host] = { total:0 }
    OUTCOMES.forEach(o => { if (!byHost[host][o]) byHost[host][o] = 0 })
    byHost[host].total++
    if (totals[l.outcome] !== undefined) byHost[host][l.outcome]++
  })
  const hostRows = Object.entries(byHost).sort((a,b) => b[1].total - a[1].total)

  const weekLabel = weekOffset === 0
    ? L2('This Week','本周')
    : weekOffset === 1 ? L2('Last Week','上周') : L2(`${weekOffset} Weeks Ago`,`${weekOffset} 周前`)

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={s.title}>📋 {L2('Weekly Outcome','每周成果')}</div>
          <div style={s.sub}>{L2('Contact results for','联系结果')} {fmtLabel(start, lang)} – {fmtLabel(end, lang)} · {L2(`${totalContacts} logs`,`${totalContacts} 条记录`)}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button style={{ ...s.weekBtn, background: weekOffset===1?'var(--brand)':'var(--surface)', color: weekOffset===1?'#fff':'var(--text)' }}
            onClick={() => setWeekOffset(1)}>{L2('Last Week','上周')}</button>
          <button style={{ ...s.weekBtn, background: weekOffset===0?'var(--brand)':'var(--surface)', color: weekOffset===0?'#fff':'var(--text)' }}
            onClick={() => setWeekOffset(0)}>{L2('This Week','本周')}</button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div style={s.grid}>
        <div style={s.card}>
          <div style={{ ...s.stat, color:'var(--text)' }}>{totalContacts}</div>
          <div style={s.lbl}>{L2('Total Contacts','总联系数')}</div>
        </div>
        {OUTCOMES.map(o => (
          <div key={o} style={s.card}>
            <div style={{ ...s.stat, color: OUTCOME_COLOR[o] }}>{totals[o]}</div>
            <div style={s.lbl}>{OL(o)}</div>
          </div>
        ))}
      </div>

      {/* Per-host breakdown */}
      <div style={s.sectionTitle}>{L2('By Host','按负责人')}</div>
      <div style={s.tableWrap}>
        <div style={s.tableHdr}>{L2('Host Breakdown','负责人明细')} — {weekLabel}</div>
        {loading ? (
          <div style={{ padding:24, color:'var(--muted)', fontSize:13 }}>{L2('Loading…','载入中…')}</div>
        ) : hostRows.length === 0 ? (
          <div style={{ padding:24, color:'var(--muted)', fontSize:13 }}>{L2('No contacts logged this week.','本周没有联系记录。')}</div>
        ) : (
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>{L2('Host','负责人')}</th>
                <th style={s.th}>{L2('Total','总计')}</th>
                {OUTCOMES.map(o => <th key={o} style={s.th}>{OL(o)}</th>)}
              </tr>
            </thead>
            <tbody>
              {hostRows.map(([host, counts]) => (
                <tr key={host}>
                  <td style={s.td}><strong>{host === 'Unassigned' ? L2('Unassigned','未分配') : host}</strong></td>
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
      <div style={s.sectionTitle}>{L2('Contact Log','联系记录')} — {weekLabel}</div>
      <div style={s.tableWrap}>
        <div style={s.tableHdr}>{L2('All Entries','全部记录')} ({logs.length})</div>
        {loading ? (
          <div style={{ padding:24, color:'var(--muted)', fontSize:13 }}>{L2('Loading…','载入中…')}</div>
        ) : logs.length === 0 ? (
          <div style={{ padding:24, color:'var(--muted)', fontSize:13 }}>{L2('No contacts logged this week.','本周没有联系记录。')}</div>
        ) : (
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>{L2('Date','日期')}</th>
                <th style={s.th}>{L2('Username','用户名')}</th>
                <th style={s.th}>{L2('Tier','等级')}</th>
                <th style={s.th}>{L2('Host','负责人')}</th>
                <th style={s.th}>{L2('Type','类型')}</th>
                <th style={s.th}>{L2('Outcome','结果')}</th>
                <th style={s.th}>{L2('Notes','备注')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td style={s.td}>{l.logged_at?.slice(0,10) || '-'}</td>
                  <td style={s.td}><strong>{l.vip_members?.username || l.vip_id}</strong></td>
                  <td style={s.td}>{l.vip_members?.tier || '-'}</td>
                  <td style={s.td}>{l.vip_members?.host_assigned || '-'}</td>
                  <td style={s.td}>{l.channel ? OL(l.channel) : '-'}</td>
                  <td style={s.td}>
                    {l.outcome
                      ? <span style={{ ...s.badge, background:(OUTCOME_COLOR[l.outcome]||'#8b949e')+'22', color:OUTCOME_COLOR[l.outcome]||'#8b949e' }}>{OL(l.outcome)}</span>
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
