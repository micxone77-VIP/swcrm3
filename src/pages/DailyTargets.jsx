import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useUrlParam } from '../hooks/useUrlParam'
import { useLanguage } from '../contexts/LanguageContext'

// ── constants ─────────────────────────────────────────────────────────────────
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const DEFAULT_DAILY_TARGET = 10

// ── helpers ───────────────────────────────────────────────────────────────────
function startOfDay(d) {
  const dt = new Date(d)
  dt.setHours(0,0,0,0)
  return dt.toISOString()
}
function endOfDay(d) {
  const dt = new Date(d)
  dt.setHours(23,59,59,999)
  return dt.toISOString()
}
function getWeekDates() {
  const today = new Date()
  const day   = today.getDay() // 0=Sun
  const mon   = new Date(today)
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d
  })
}
function isSameDay(a, b) {
  return a.toDateString() === b.toDateString()
}
function pct(val, total) {
  if (!total) return 0
  return Math.min(100, Math.round(val / total * 100))
}

// ── styles ────────────────────────────────────────────────────────────────────
const s = {
  page:    { padding:'24px 28px', minHeight:'100vh' },
  title:   { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' },
  cardHdrL:{ display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' },
  cardBody:{ padding:'18px 20px' },
  grid4:   { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 },
  grid2:   { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 },
  statCard:{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' },
  bigNum:  { fontSize:32, fontWeight:800 },
  lbl:     { fontSize:11, color:'var(--muted)', marginTop:3 },
  bar:     { height:8, background:'var(--surface2)', borderRadius:4, overflow:'hidden', marginTop:8 },
  btn:     { background:'var(--accent)', color:'#fff', border:'none', padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm:   { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  input:   { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 12px', borderRadius:7, fontSize:13, outline:'none', width:70, textAlign:'center' },
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)' },
  td:      { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
}

// ── ring progress ─────────────────────────────────────────────────────────────
function Ring({ value, max, size=80, color='var(--accent)' }) {
  const r   = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const p   = Math.min(1, value / (max || 1))
  return (
    <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={8} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={circ} strokeDashoffset={circ * (1-p)}
        strokeLinecap="round" style={{ transition:'stroke-dashoffset .5s' }} />
    </svg>
  )
}

// ── stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, max, color, sub }) {
  const p = max ? pct(value, max) : null
  const barColor = p >= 100 ? '#3fb950' : p >= 60 ? '#d29922' : '#f85149'
  return (
    <div style={s.statCard}>
      <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>{icon} {label}</div>
      <div style={{ ...s.bigNum, color: color || 'var(--text)' }}>
        {value}{max ? <span style={{ fontSize:16, color:'var(--muted)', fontWeight:400 }}>/{max}</span> : ''}
      </div>
      {sub && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{sub}</div>}
      {max !== undefined && (
        <div style={s.bar}>
          <div style={{ width: pct(value,max)+'%', height:'100%', background: barColor, borderRadius:4, transition:'width .4s' }} />
        </div>
      )}
    </div>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function DailyTargets() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const isAdmin = profile?.role === 'admin'

  const [loading,      setLoading]      = useState(true)
  const [myStats,      setMyStats]      = useState(null)
  const [weekData,     setWeekData]     = useState([])   // [{date, count}]
  const [allHostStats, setAllHostStats] = useState([])   // admin view
  const [dailyTarget,  setDailyTarget]  = useState(DEFAULT_DAILY_TARGET)
  const [editTarget,   setEditTarget]   = useState(false)
  const [targetInput,  setTargetInput]  = useState(DEFAULT_DAILY_TARGET)
  const [viewMode,     setViewMode]     = useUrlParam('view', 'me') // 'me' | 'team'

  const today     = new Date()
  const weekDates = getWeekDates()

  useEffect(() => {
    loadTarget()
    loadMyStats()
    loadWeekData()
    if (isAdmin) loadAllHostStats()
  }, [profile])

  async function loadTarget() {
    // store target in profiles table if column exists, else use localStorage
    const stored = localStorage.getItem(`target_${profile?.id}`)
    if (stored) { setDailyTarget(parseInt(stored)); setTargetInput(parseInt(stored)) }
  }

  function saveTarget() {
    localStorage.setItem(`target_${profile?.id}`, targetInput)
    setDailyTarget(parseInt(targetInput))
    setEditTarget(false)
  }

  async function loadMyStats() {
    if (!profile) return
    setLoading(true)
    const myName = profile.full_name || profile.username

    // today's logs
    const { data: todayLogs } = await supabase
      .from('contact_logs')
      .select('id, outcome, vip_id')
      .eq('host_name', myName)
      .gte('logged_at', startOfDay(today))
      .lte('logged_at', endOfDay(today))

    // all time logs for response rate
    const { data: allLogs, count: totalCount } = await supabase
      .from('contact_logs')
      .select('outcome', { count:'exact' })
      .eq('host_name', myName)

    // assigned VIPs
    const { count: assignedCount } = await supabase
      .from('vip_members')
      .select('id', { count:'exact' })
      .eq('host_assigned', myName)
      .eq('is_excluded', false)

    // unique VIPs contacted this week
    const { data: weekLogs } = await supabase
      .from('contact_logs')
      .select('vip_id')
      .eq('host_name', myName)
      .gte('logged_at', startOfDay(weekDates[0]))

    const uniqueVipsWeek = new Set(weekLogs?.map(l => l.vip_id) || []).size
    const positiveCount  = allLogs?.filter(l => ['Replied', 'Deposited', 'Reactivated'].includes(l.outcome)).length || 0
    const responseRate   = totalCount ? Math.round(positiveCount / totalCount * 100) : 0

    setMyStats({
      todayCount:    todayLogs?.length || 0,
      todayUnique:   new Set(todayLogs?.map(l => l.vip_id) || []).size,
      todayPositive: todayLogs?.filter(l => ['Replied', 'Deposited', 'Reactivated'].includes(l.outcome)).length || 0,
      totalCount:    totalCount || 0,
      assignedCount: assignedCount || 0,
      uniqueVipsWeek,
      responseRate,
      positiveCount,
    })
    setLoading(false)
  }

  async function loadWeekData() {
    if (!profile) return
    const myName = profile.full_name || profile.username
    const { data } = await supabase
      .from('contact_logs')
      .select('logged_at')
      .eq('host_name', myName)
      .gte('logged_at', startOfDay(weekDates[0]))
      .lte('logged_at', endOfDay(weekDates[6]))

    const counts = weekDates.map(d => ({
      date:  d,
      count: (data || []).filter(l => isSameDay(new Date(l.logged_at), d)).length,
    }))
    setWeekData(counts)
  }

  async function loadAllHostStats() {
    const { data: hosts } = await supabase.from('profiles').select('id, full_name, role').neq('role','readonly')

    const stats = await Promise.all((hosts || []).map(async h => {
      const name = h.full_name || h.username

      const { data: todayL } = await supabase
        .from('contact_logs').select('id, outcome')
        .eq('host_name', name)
        .gte('logged_at', startOfDay(today))
        .lte('logged_at', endOfDay(today))

      const { count: totalC } = await supabase
        .from('contact_logs').select('id', { count:'exact' })
        .eq('host_name', name)

      const { count: assignedC } = await supabase
        .from('vip_members').select('id', { count:'exact' })
        .eq('host_assigned', name).eq('is_excluded', false)

      const { data: allL } = await supabase
        .from('contact_logs').select('outcome')
        .eq('host_name', name)

      const pos  = allL?.filter(l => ['Replied', 'Deposited', 'Reactivated'].includes(l.outcome)).length || 0
      const rate = allL?.length ? Math.round(pos / allL.length * 100) : 0

      return {
        name, role: h.role,
        todayCount:  todayL?.length || 0,
        totalLogs:   totalC || 0,
        assignedVIPs: assignedC || 0,
        responseRate: rate,
      }
    }))
    setAllHostStats(stats)
  }

  const todayDateStr = today.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
  const weekMax      = Math.max(...weekData.map(d => d.count), dailyTarget, 1)

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>🎯 {t('dailyTargets.title')}</div>
          <div style={s.sub}>{todayDateStr}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {isAdmin && (
            <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
              {['me','team'].map(m => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  background: viewMode===m ? 'var(--accent)' : 'transparent',
                  color: viewMode===m ? '#fff' : 'var(--muted)',
                  border:'none', padding:'8px 18px', fontSize:13, fontWeight:600, cursor:'pointer',
                }}>
                  {m === 'me' ? t('dailyTargets.myStats') : t('dailyTargets.teamView')}
                </button>
              ))}
            </div>
          )}
          {/* Daily target setter */}
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 12px' }}>
            <span style={{ fontSize:12, color:'var(--muted)' }}>{t('dailyTargets.dailyTargetLabel')}</span>
            {editTarget ? (
              <>
                <input type="number" style={s.input} value={targetInput} min={1} max={100}
                  onChange={e => setTargetInput(e.target.value)} />
                <button style={{ ...s.btn, padding:'5px 12px', fontSize:12 }} onClick={saveTarget}>{t('dailyTargets.save')}</button>
                <button style={{ ...s.btnSm, padding:'5px 10px', fontSize:12 }} onClick={() => setEditTarget(false)}>✕</button>
              </>
            ) : (
              <>
                <span style={{ fontSize:16, fontWeight:800, color:'var(--accent)' }}>{dailyTarget}</span>
                <button style={{ ...s.btnSm, padding:'4px 10px', fontSize:11 }} onClick={() => setEditTarget(true)}>Edit</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ══ MY STATS VIEW ══ */}
      {(viewMode === 'me' || !isAdmin) && !loading && myStats && (
        <>
          {/* ── Today's stats ── */}
          <div style={{ ...s.grid4, marginBottom:16 }}>
            <StatCard icon="📞" label={t('dailyTargets.contactsToday')} value={myStats.todayCount} max={dailyTarget}
              color={myStats.todayCount >= dailyTarget ? '#3fb950' : 'var(--text)'} />
            <StatCard icon="👤" label={t('dailyTargets.uniqueVipsToday')} value={myStats.todayUnique}
              sub={t('dailyTargets.distinctVipsReached')} color="var(--accent)" />
            <StatCard icon="✅" label={t('dailyTargets.positiveToday')} value={myStats.todayPositive}
              sub={myStats.todayCount ? Math.round(myStats.todayPositive/myStats.todayCount*100)+'% of today' : '—'}
              color="#3fb950" />
            <StatCard icon="📊" label={t('dailyTargets.responseRate')} value={myStats.responseRate+'%'}
              sub={`${myStats.positiveCount} positive of ${myStats.totalCount} total`}
              color={myStats.responseRate>=70?'#3fb950':myStats.responseRate>=50?'#d29922':'#f85149'} />
          </div>

          {/* ── VIP coverage ── */}
          <div style={{ ...s.grid2, marginBottom:16 }}>
            <div style={{ ...s.card }}>
              <div style={s.cardHdr}>
                <div style={s.cardHdrL}>{t('dailyTargets.vipCoverageWeek')}</div>
              </div>
              <div style={{ ...s.cardBody, display:'flex', alignItems:'center', gap:24 }}>
                <div style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                  <Ring value={myStats.uniqueVipsWeek} max={myStats.assignedCount} size={100}
                    color={pct(myStats.uniqueVipsWeek,myStats.assignedCount)>=80?'#3fb950':'var(--accent)'} />
                  <div style={{ position:'absolute', textAlign:'center' }}>
                    <div style={{ fontSize:18, fontWeight:800, color:'var(--text)' }}>{pct(myStats.uniqueVipsWeek,myStats.assignedCount)}%</div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:28, fontWeight:800, color:'var(--text)' }}>
                    {myStats.uniqueVipsWeek}
                    <span style={{ fontSize:15, color:'var(--muted)', fontWeight:400 }}>/{myStats.assignedCount}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{t('dailyTargets.vipsContactedWeek')}</div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>
                    {myStats.assignedCount - myStats.uniqueVipsWeek > 0
                      ? <span style={{ color:'#f0883e' }}>{t('dailyTargets.vipsNotReached', { n: myStats.assignedCount - myStats.uniqueVipsWeek })}</span>
                      : <span style={{ color:'#3fb950' }}>{t('dailyTargets.allVipsContacted')}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Today's progress ring */}
            <div style={{ ...s.card }}>
              <div style={s.cardHdr}>
                <div style={s.cardHdrL}>{t('dailyTargets.todayTargetProgress')}</div>
              </div>
              <div style={{ ...s.cardBody, display:'flex', alignItems:'center', gap:24 }}>
                <div style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                  <Ring value={myStats.todayCount} max={dailyTarget} size={100}
                    color={myStats.todayCount >= dailyTarget ? '#3fb950' : 'var(--accent)'} />
                  <div style={{ position:'absolute', textAlign:'center' }}>
                    <div style={{ fontSize:18, fontWeight:800, color:'var(--text)' }}>
                      {pct(myStats.todayCount, dailyTarget)}%
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:28, fontWeight:800, color:'var(--text)' }}>
                    {myStats.todayCount}
                    <span style={{ fontSize:15, color:'var(--muted)', fontWeight:400 }}>/{dailyTarget}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{t('dailyTargets.contactsMadeToday')}</div>
                  <div style={{ fontSize:12, marginTop:4 }}>
                    {myStats.todayCount >= dailyTarget
                      ? <span style={{ color:'#3fb950' }}>{t('dailyTargets.targetReached')}</span>
                      : <span style={{ color:'#d29922' }}>{t('dailyTargets.moreToHitTarget', { n: dailyTarget - myStats.todayCount })}</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Weekly bar chart ── */}
          <div style={s.card}>
            <div style={s.cardHdr}>
              <div style={s.cardHdrL}>{t('dailyTargets.weekActivity')}</div>
              <div style={{ fontSize:12, color:'var(--muted)' }}>{t('dailyTargets.target', { n: dailyTarget })}</div>
            </div>
            <div style={{ padding:'20px 24px' }}>
              <div style={{ display:'flex', alignItems:'flex-end', gap:10, height:140 }}>
                {weekData.map(({ date, count }, i) => {
                  const isToday   = isSameDay(date, today)
                  const isFuture  = date > today
                  const barH      = isFuture ? 0 : Math.max(4, (count / weekMax) * 120)
                  const targetH   = (dailyTarget / weekMax) * 120
                  const hitTarget = count >= dailyTarget
                  const barColor  = isFuture ? 'var(--surface2)'
                                  : hitTarget ? '#3fb950'
                                  : isToday ? 'var(--accent)'
                                  : '#d29922'
                  return (
                    <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                      <div style={{ fontSize:11, fontWeight:700, color: hitTarget?'#3fb950':'var(--muted)' }}>
                        {isFuture ? '' : count}
                      </div>
                      <div style={{ width:'100%', position:'relative', height:120, display:'flex', alignItems:'flex-end' }}>
                        {/* target line */}
                        <div style={{ position:'absolute', bottom: targetH, left:0, right:0, borderTop:'1px dashed rgba(88,166,255,.4)', zIndex:1 }} />
                        {/* bar */}
                        <div style={{ width:'100%', height: barH, background: barColor, borderRadius:'4px 4px 0 0', transition:'height .4s', opacity: isFuture ? .3 : 1 }} />
                      </div>
                      <div style={{ fontSize:11, color: isToday ? 'var(--accent)' : 'var(--muted)', fontWeight: isToday ? 700 : 400 }}>
                        {DAYS[i]}
                      </div>
                      <div style={{ fontSize:10, color:'var(--muted)' }}>
                        {date.getDate()}/{date.getMonth()+1}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ display:'flex', gap:16, marginTop:12, fontSize:11, color:'var(--muted)' }}>
                <span><span style={{ color:'#3fb950' }}>■</span> {t('dailyTargets.hitTarget')}</span>
                <span><span style={{ color:'var(--accent)' }}>■</span> {t('dailyTargets.today')}</span>
                <span><span style={{ color:'#d29922' }}>■</span> {t('dailyTargets.belowTarget')}</span>
                <span style={{ borderTop:'1px dashed rgba(88,166,255,.4)', display:'inline-block', width:20, marginBottom:2 }}></span>
                <span>{t('dailyTargets.dailyTargetLegend', { n: dailyTarget })}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══ TEAM VIEW (admin only) ══ */}
      {viewMode === 'team' && isAdmin && (
        <div style={s.card}>
          <div style={s.cardHdr}>
            <div style={s.cardHdrL}>{t('dailyTargets.teamPerformanceToday')}</div>
            <div style={{ fontSize:12, color:'var(--muted)' }}>{t('dailyTargets.targetPerHost', { n: dailyTarget })}</div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={s.tbl}>
              <thead>
                <tr>
                  <th style={s.th}>{t('dailyTargets.colHost')}</th>
                  <th style={s.th}>{t('dailyTargets.colRole')}</th>
                  <th style={s.th}>{t('dailyTargets.colToday')}</th>
                  <th style={s.th}>{t('dailyTargets.colProgress')}</th>
                  <th style={s.th}>{t('dailyTargets.colTotalLogs')}</th>
                  <th style={s.th}>{t('dailyTargets.colAssignedVips')}</th>
                  <th style={s.th}>{t('dailyTargets.colResponseRate')}</th>
                </tr>
              </thead>
              <tbody>
                {allHostStats.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:32 }}>{t('dailyTargets.loadingTeam')}</td></tr>
                ) : allHostStats.sort((a,b) => b.todayCount - a.todayCount).map(host => {
                  const p = pct(host.todayCount, dailyTarget)
                  const barColor = p >= 100 ? '#3fb950' : p >= 60 ? '#d29922' : '#f85149'
                  const rateColor = host.responseRate >= 70 ? '#3fb950' : host.responseRate >= 50 ? '#d29922' : '#f85149'
                  return (
                    <tr key={host.name}
                      onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      <td style={{ ...s.td, fontWeight:700 }}>{host.name}</td>
                      <td style={s.td}>
                        <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:6,
                          background: host.role==='admin' ? 'rgba(88,166,255,.15)' : 'rgba(63,185,80,.1)',
                          color: host.role==='admin' ? 'var(--accent)' : '#3fb950' }}>
                          {host.role}
                        </span>
                      </td>
                      <td style={{ ...s.td, fontWeight:700, color: host.todayCount >= dailyTarget ? '#3fb950' : 'var(--text)' }}>
                        {host.todayCount}
                        {host.todayCount >= dailyTarget && <span style={{ marginLeft:6 }}>🎉</span>}
                      </td>
                      <td style={{ ...s.td, minWidth:160 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ flex:1, height:6, background:'var(--surface2)', borderRadius:3, overflow:'hidden' }}>
                            <div style={{ width:p+'%', height:'100%', background:barColor, borderRadius:3, transition:'width .4s' }} />
                          </div>
                          <span style={{ fontSize:11, color:barColor, fontWeight:700, minWidth:32 }}>{p}%</span>
                        </div>
                      </td>
                      <td style={{ ...s.td, color:'var(--muted)' }}>{host.totalLogs}</td>
                      <td style={{ ...s.td, color:'var(--muted)' }}>{host.assignedVIPs}</td>
                      <td style={{ ...s.td, fontWeight:700, color:rateColor }}>{host.responseRate}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>{t('dailyTargets.loadingStats')}</div>
      )}
    </div>
  )
}
