import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TIER_COLOR, TIER_BG } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { useUrlParam } from '../hooks/useUrlParam'
import { useLanguage } from '../contexts/LanguageContext'

const s = {
  page:    { padding:'24px 28px', minHeight:'100vh' },
  title:   { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' },
  cardBody:{ padding:'18px 20px' },
  grid2:   { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 },
  grid3:   { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 },
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)' },
  td:      { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  badge:   { display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
}

function BigStat({ icon, label, value, color, sub, change }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'18px 20px' }}>
      <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>{icon} {label}</div>
      <div style={{ fontSize:32, fontWeight:800, color: color||'var(--text)' }}>{value}</div>
      {sub    && <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>{sub}</div>}
      {change !== undefined && (
        <div style={{ fontSize:12, marginTop:4, color: change>=0?'#3fb950':'#f85149', fontWeight:600 }}>
          {change>=0?'↑':'↓'} {Math.abs(change)}% vs last month
        </div>
      )}
    </div>
  )
}

export default function BossView() {
  const navigate  = useNavigate()
  const { t } = useLanguage()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useUrlParam('period', 'today') // today | week | month

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const today   = new Date()
    const todayStr = today.toISOString().slice(0,10)
    const weekAgo  = new Date(today); weekAgo.setDate(today.getDate()-7)
    const monthAgo = new Date(today); monthAgo.setDate(today.getDate()-30)

    const [
      { count: totalVIPs },
      { count: activeVIPs },
      { count: dormantVIPs },
      { count: highRisk },
      { count: todayContacts },
      { count: weekContacts },
      { count: monthContacts },
      { data: tierData },
      { data: hostData },
      { data: recentLogs },
    ] = await Promise.all([
      supabase.from('vip_members').select('id',{count:'exact'}).eq('is_excluded',false),
      supabase.from('vip_members').select('id',{count:'exact'}).eq('activity_status','Active').eq('is_excluded',false),
      supabase.from('vip_members').select('id',{count:'exact'}).eq('activity_status','Dormant').eq('is_excluded',false),
      supabase.from('vip_members').select('id',{count:'exact'}).eq('churn_risk','HIGH').eq('is_excluded',false),
      supabase.from('contact_logs').select('id',{count:'exact'}).gte('logged_at', todayStr+'T00:00:00'),
      supabase.from('contact_logs').select('id',{count:'exact'}).gte('logged_at', weekAgo.toISOString()),
      supabase.from('contact_logs').select('id',{count:'exact'}).gte('logged_at', monthAgo.toISOString()),
      supabase.from('vip_members').select('tier').eq('is_excluded',false),
      supabase.from('contact_logs').select('host_name').gte('logged_at', todayStr+'T00:00:00'),
      supabase.from('contact_logs').select('*').order('logged_at',{ascending:false}).limit(8),
    ])

    // tier breakdown
    const tierCounts = {}
    ;(tierData||[]).forEach(r => { tierCounts[r.tier] = (tierCounts[r.tier]||0)+1 })

    // host leaderboard today
    const hostCounts = {}
    ;(hostData||[]).forEach(r => { hostCounts[r.host_name] = (hostCounts[r.host_name]||0)+1 })
    const hostLeaderboard = Object.entries(hostCounts).sort((a,b)=>b[1]-a[1]).slice(0,5)

    // Top VIPs by accumulated month-to-date deposit (was previously sorted by vip_members.total_deposit,
    // which only reflects the last uploaded day's number now that CSV uploads are daily)
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`
    const { data: _mc3 } = await supabase.from('vip_monthly_totals').select('snapshot_month').eq('snapshot_month', thisMonth).limit(1)
    const currentMonth = (_mc3 && _mc3.length > 0) ? thisMonth : await (async () => {
      const { data: _lt3 } = await supabase.from('vip_monthly_totals').select('snapshot_month').order('snapshot_month', { ascending: false }).limit(1)
      return _lt3?.[0]?.snapshot_month || thisMonth
    })()
    // Fetch a wider candidate pool since dormant players will be filtered out below
    const { data: monthTotals } = await supabase
      .from('vip_monthly_totals')
      .select('username, tier, total_deposit, currency')
      .eq('snapshot_month', currentMonth)
      .order('total_deposit', { ascending: false })
      .limit(50)
    let topVIPs = []
    if (monthTotals && monthTotals.length > 0) {
      const usernames = monthTotals.map(t => t.username)
      const { data: extras } = await supabase
        .from('vip_members')
        .select('id, username, vip_score, activity_status, host_assigned, days_inactive, is_excluded')
        .in('username', usernames)
      const extraMap = {}
      ;(extras || []).forEach(e => { extraMap[e.username] = e })
      topVIPs = monthTotals
        .map(t => ({ ...t, ...extraMap[t.username] }))
        // Active-only: exclude dormant players and excluded players.
        // days_inactive == null (no vip_members match) is treated as not-active.
        .filter(v => !v.is_excluded && v.days_inactive != null && v.days_inactive <= 15)
        .slice(0, 10)
    }

    // Host comparison — assigned VIPs, contact activity, response rate this month
    const { data: hostVips } = await supabase
      .from('vip_members').select('username, host_assigned').eq('is_excluded', false)
    const assignedByHost = {}
    ;(hostVips||[]).forEach(v => {
      const h = v.host_assigned || 'Unassigned'
      assignedByHost[h] = (assignedByHost[h]||0) + 1
    })
    const { data: monthLogs } = await supabase
      .from('contact_logs').select('host_name, outcome, username').eq('log_month', currentMonth)
    const hostMonthStats = {}
    ;(monthLogs||[]).forEach(l => {
      const h = l.host_name || 'Unknown'
      if (!hostMonthStats[h]) hostMonthStats[h] = { total:0, uniqueVips:new Set(), responded:0 }
      hostMonthStats[h].total++
      hostMonthStats[h].uniqueVips.add(l.username)
      if (['Replied','Deposited','Reactivated'].includes(l.outcome)) hostMonthStats[h].responded++
    })
    const allHostNames = [...new Set([...Object.keys(assignedByHost), ...Object.keys(hostMonthStats)])]
    const hostComparison = allHostNames.map(h => {
      const stats = hostMonthStats[h] || { total:0, uniqueVips:new Set(), responded:0 }
      return {
        host: h,
        assigned: assignedByHost[h] || 0,
        contacts: stats.total,
        uniqueVips: stats.uniqueVips.size,
        responded: stats.responded,
        responseRate: stats.total ? Math.round(stats.responded/stats.total*100) : 0,
      }
    }).sort((a,b) => b.contacts - a.contacts)

    setData({
      totalVIPs, activeVIPs, dormantVIPs, highRisk,
      todayContacts, weekContacts, monthContacts,
      tierCounts, hostLeaderboard, topVIPs: topVIPs||[],
      recentLogs: recentLogs||[],
      retentionRate: totalVIPs ? Math.round(activeVIPs/totalVIPs*100) : 0,
      hostComparison, currentMonth,
    })
    setLoading(false)
  }

  if (loading) return (
    <div style={{ ...s.page, display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
      <div style={{ color:'var(--muted)' }}>Loading executive summary...</div>
    </div>
  )

  const d = data
  const contactCount = period==='today' ? d.todayContacts : period==='week' ? d.weekContacts : d.monthContacts

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>👔 {t('bossView.title')}</div>
          <div style={s.sub}>{t('bossView.subtitle')} — {new Date().toLocaleDateString('en-MY',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
        </div>
        <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
          {['today','week','month'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              background: period===p?'var(--accent)':'transparent',
              color: period===p?'#fff':'var(--muted)',
              border:'none', padding:'8px 16px', fontSize:12, fontWeight:600, cursor:'pointer', textTransform:'capitalize',
            }}>{t(`bossView.period.${p}`)}</button>
          ))}
        </div>
      </div>

      {/* Top stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:16 }}>
        <BigStat icon="👥" label={t('bossView.totalVIPs')}      value={d.totalVIPs}   color="var(--accent)" />
        <BigStat icon="✅" label={t('bossView.activeVIPs')}     value={d.activeVIPs}  color="#3fb950" sub={`${d.retentionRate}% ${t('bossView.retention')}`} />
        <BigStat icon="🚨" label={t('bossView.highRisk')}       value={d.highRisk}    color="#f85149" sub={t('bossView.highRiskSub')} />
        <BigStat icon="📞" label={`${t('bossView.contacts')} (${period})`} value={contactCount} color="var(--accent)" />
      </div>

      <div style={{ ...s.grid2, marginBottom:16 }}>

        {/* Tier breakdown */}
        <div style={s.card}>
          <div style={s.cardHdr}>💎 {t('bossView.portfolioByTier')}</div>
          <div style={s.cardBody}>
            {['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(tier => {
              const count = d.tierCounts[tier] || 0
              const p = d.totalVIPs ? Math.round(count/d.totalVIPs*100) : 0
              return (
                <div key={tier} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                  <span style={{ ...s.badge, background:TIER_BG[tier], color:TIER_COLOR[tier], minWidth:80, textAlign:'center' }}>{tier}</span>
                  <div style={{ flex:1, height:6, background:'var(--surface2)', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ width:p+'%', height:'100%', background:TIER_COLOR[tier], borderRadius:3 }} />
                  </div>
                  <span style={{ fontSize:13, fontWeight:700, color:'var(--text)', minWidth:30 }}>{count}</span>
                  <span style={{ fontSize:11, color:'var(--muted)', minWidth:36 }}>{p}%</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Host leaderboard */}
        <div style={s.card}>
          <div style={s.cardHdr}>🏆 {t('bossView.hostLeaderboard')}</div>
          <div style={s.cardBody}>
            {d.hostLeaderboard.length === 0 ? (
              <div style={{ color:'var(--muted)', fontSize:13, textAlign:'center', padding:20 }}>{t('bossView.noContactsToday')}</div>
            ) : d.hostLeaderboard.map(([name, count], i) => (
              <div key={name} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                <div style={{ width:28, height:28, borderRadius:'50%', background: i===0?'rgba(255,215,0,.2)':i===1?'rgba(192,192,192,.2)':'var(--surface2)',
                  border:`2px solid ${i===0?'#ffd700':i===1?'#C0C0C0':'var(--border)'}`,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800,
                  color: i===0?'#ffd700':i===1?'#C0C0C0':'var(--muted)', flexShrink:0 }}>
                  {i+1}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700 }}>{name}</div>
                  <div style={{ height:4, background:'var(--surface2)', borderRadius:2, overflow:'hidden', marginTop:4 }}>
                    <div style={{ width: d.hostLeaderboard[0]?Math.round(count/d.hostLeaderboard[0][1]*100)+'%':'0%', height:'100%', background:'var(--accent)', borderRadius:2 }} />
                  </div>
                </div>
                <span style={{ fontSize:16, fontWeight:800, color:'var(--accent)' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* VIP health + top VIPs */}
      <div style={{ ...s.grid2, marginBottom:16 }}>
        {/* Health summary */}
        <div style={s.card}>
          <div style={s.cardHdr}>❤️ {t('bossView.vipHealthSummary')}</div>
          <div style={s.cardBody}>
            {[
              { label: t('bossView.health.active'),   value: d.activeVIPs,  color:'#3fb950', pct: d.retentionRate },
              { label: t('bossView.health.dormant'),  value: d.dormantVIPs, color:'#8b949e', pct: d.totalVIPs?Math.round(d.dormantVIPs/d.totalVIPs*100):0 },
              { label: t('bossView.health.highRisk'), value: d.highRisk,    color:'#f85149', pct: d.totalVIPs?Math.round(d.highRisk/d.totalVIPs*100):0 },
            ].map(({ label, value, color, pct }) => (
              <div key={label} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                <span style={{ fontSize:13, fontWeight:600, color, minWidth:80 }}>● {label}</span>
                <div style={{ flex:1, height:8, background:'var(--surface2)', borderRadius:4, overflow:'hidden' }}>
                  <div style={{ width:pct+'%', height:'100%', background:color, borderRadius:4, transition:'width .5s' }} />
                </div>
                <span style={{ fontSize:13, fontWeight:700, minWidth:40, textAlign:'right' }}>{value}</span>
                <span style={{ fontSize:11, color:'var(--muted)', minWidth:36 }}>{pct}%</span>
              </div>
            ))}
            <div style={{ marginTop:16, padding:'12px 14px', background:'var(--surface2)', borderRadius:8, fontSize:13 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ color:'var(--muted)' }}>{t('bossView.contactsThisWeek')}</span>
                <span style={{ fontWeight:700, color:'var(--accent)' }}>{d.weekContacts}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ color:'var(--muted)' }}>{t('bossView.contactsThisMonth')}</span>
                <span style={{ fontWeight:700 }}>{d.monthContacts}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'var(--muted)' }}>{t('bossView.contactsToday')}</span>
                <span style={{ fontWeight:700, color:'#3fb950' }}>{d.todayContacts}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div style={s.card}>
          <div style={s.cardHdr}>🕐 {t('bossView.recentActivity')}</div>
          <div style={s.cardBody}>
            {d.recentLogs.length === 0 ? (
              <div style={{ color:'var(--muted)', fontSize:13, textAlign:'center', padding:20 }}>{t('bossView.noRecentActivity')}</div>
            ) : d.recentLogs.map(log => {
              const outcomeColor = { Positive:'#3fb950', Neutral:'#8b949e', 'No Response':'#d29922', Negative:'#f85149' }[log.outcome]||'var(--muted)'
              const diff = Math.floor((Date.now()-new Date(log.logged_at))/1000)
              const ago  = diff<60?'just now':diff<3600?Math.floor(diff/60)+'m ago':diff<86400?Math.floor(diff/3600)+'h ago':Math.floor(diff/86400)+'d ago'
              return (
                <div key={log.id} style={{ display:'flex', alignItems:'flex-start', gap:10, paddingBottom:10, borderBottom:'1px solid var(--border)', marginBottom:10, cursor:'pointer' }}
                  onClick={() => navigate(`/vips/${log.vip_id}`)}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:outcomeColor, marginTop:4, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>{log.vip_username} <span style={{ color:'var(--muted)', fontWeight:400, fontSize:12 }}>· {log.channel}</span></div>
                    <div style={{ fontSize:11, color:'var(--muted)' }}>{log.host_name} · {ago}</div>
                  </div>
                  <span style={{ fontSize:11, color:outcomeColor, fontWeight:600 }}>{log.outcome}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Top VIPs by deposit */}
      <div style={s.card}>
        <div style={s.cardHdr}>💰 {t('bossView.topActiveVIPs')}</div>
        <div style={{ padding:'10px 20px 0' }}>
          <div style={{ fontSize: 11, color: 'var(--amber, #f59e0b)', marginBottom: 8 }}>
            ⚠️ Deposits shown in each VIP's own currency — not directly comparable across regions
          </div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>#</th>
                <th style={s.th}>{t('bossView.col.vip')}</th>
                <th style={s.th}>{t('bossView.col.tier')}</th>
                <th style={s.th}>{t('bossView.col.totalDeposit')}</th>
                <th style={s.th}>{t('bossView.col.score')}</th>
                <th style={s.th}>{t('bossView.col.status')}</th>
                <th style={s.th}>{t('bossView.col.host')}</th>
              </tr>
            </thead>
            <tbody>
              {d.topVIPs.map((v,i) => {
                const score = v.vip_score||0
                const scoreColor = score>=80?'#3fb950':score>=60?'#d29922':'#f85149'
                return (
                  <tr key={v.id} style={{ cursor:'pointer' }}
                    onClick={() => navigate(`/vips/${v.id}`)}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{ ...s.td, color:'var(--muted)', fontSize:11, fontWeight:700 }}>{i+1}</td>
                    <td style={{ ...s.td, fontWeight:700 }}>{v.username}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, background:TIER_BG[v.tier]||'transparent', color:TIER_COLOR[v.tier]||'var(--text)' }}>{v.tier}</span>
                    </td>
                    <td style={{ ...s.td, fontWeight:700, color:'#3fb950' }}>{formatMoney(v.total_deposit, v.currency)}</td>
                    <td style={{ ...s.td, fontWeight:700, color:scoreColor }}>{score||'—'}</td>
                    <td style={{ ...s.td, fontSize:12 }}>{v.activity_status||'—'}</td>
                    <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{v.host_assigned||'—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Host Comparison — assigned VIPs, contacts, response rate this month */}
      <div style={{ ...s.card, marginTop:16 }}>
        <div style={s.cardHdr}>👥 {t('bossView.hostComparison')} — {d.currentMonth}</div>
        <div style={{ overflowX:'auto' }}>
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>{t('bossView.col.host')}</th>
                <th style={s.th}>{t('bossView.col.assignedVIPs')}</th>
                <th style={s.th}>{t('bossView.col.contactsThisMonth')}</th>
                <th style={s.th}>{t('bossView.col.uniqueVIPsReached')}</th>
                <th style={s.th}>{t('bossView.col.responded')}</th>
                <th style={s.th}>{t('bossView.col.responseRate')}</th>
              </tr>
            </thead>
            <tbody>
              {d.hostComparison.length === 0 ? (
                <tr><td colSpan={6} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:24 }}>{t('bossView.noData')}</td></tr>
              ) : d.hostComparison.map(h => {
                const rateColor = h.responseRate >= 50 ? '#3fb950' : h.responseRate >= 25 ? '#d29922' : '#f85149'
                return (
                  <tr key={h.host}
                    onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <td style={{ ...s.td, fontWeight:700 }}>{h.host}</td>
                    <td style={s.td}>{h.assigned}</td>
                    <td style={{ ...s.td, fontWeight:700, color:'var(--accent)' }}>{h.contacts}</td>
                    <td style={s.td}>{h.uniqueVips}</td>
                    <td style={s.td}>{h.responded}</td>
                    <td style={{ ...s.td, fontWeight:700, color:rateColor }}>{h.responseRate}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
