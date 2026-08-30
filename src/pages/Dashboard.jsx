// Dashboard v4 — 今日工作台 · Improved UX
import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG } from '../lib/constants'
import { useLanguage } from '../contexts/LanguageContext'
import VipQuickSearch from '../components/VipQuickSearch'

const todayStart = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString() }
const todayEnd   = () => { const d = new Date(); d.setHours(23,59,59,999); return d.toISOString() }

// Tier sort order: BLACK=0 (highest), then DIAMOND, PLATINUM, GOLD, SILVER
const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4 }
const tierRank = t => TIER_ORDER[(t||'').toUpperCase()] ?? 9

const HOSTS = ['All', 'Marcus', 'Angel']

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { lang } = useLanguage()
  const isCN = lang === 'zh'
  const timelineRef = useRef(null)

  const [allVips, setAllVips]           = useState([])
  const [todayLogs, setTodayLogs]       = useState([])
  const [monthlyRecall, setMonthlyRecall] = useState(0)
  const [loading, setLoading]           = useState(true)
  const [dbError, setDbError]           = useState(null)

  // Filters
  const [hostFilter, setHostFilter]       = useState('All')       // All / Marcus / Angel
  const [tierFilter, setTierFilter]       = useState('all')       // all / vip (Plat+Diamond+Black)
  const [activeBucket, setActiveBucket]   = useState('all')
  const [activeGroup, setActiveGroup]     = useState(null)

  // Quick-log modal
  const [logTarget, setLogTarget]         = useState(null)        // { id, username }
  const [logOutcome, setLogOutcome]       = useState('Replied')
  const [logSubmitting, setLogSubmitting] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true); setDbError(null)
    try {
      const now = new Date()
      const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      const [vipRes, logRes, recallRes] = await Promise.all([
        supabase.from('vip_members')
          .select('id,username,tier,region,days_inactive,churn_risk,host_assigned,phone,whatsapp,last_deposit_date,total_deposit,birthday,last_contacted,activity_status,created_at,registration_date,is_excluded')
          .neq('is_excluded', true),
        supabase.from('contact_logs').select('username,outcome').gte('created_at', todayStart()).lte('created_at', todayEnd()),
        supabase.from('reactivation_logs').select('username').eq('reactivated_month', monthStr),
      ])
      if (vipRes.error) { console.error('VIP error:', vipRes.error); setDbError(vipRes.error.message) }
      setAllVips(vipRes.data || [])
      setTodayLogs(logRes.data || [])
      setMonthlyRecall((recallRes.data || []).length)
    } catch(e) { setDbError(String(e)) }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const now = new Date()

  // Live days inactive from last_deposit_date
  const getDays = v => {
    if (v.last_deposit_date) return Math.floor((now - new Date(v.last_deposit_date)) / 86400000)
    return v.days_inactive ?? null
  }
  const isHighRisk = v => { const r=(v.churn_risk||'').toUpperCase(); return r==='HIGH'||r==='CRITICAL' }
  const riskColor  = v => { const r=(v.churn_risk||'').toUpperCase(); return r==='HIGH'||r==='CRITICAL'?'#f85149':r==='MEDIUM'?'#f59e0b':'#3fb950' }
  const isVipTier  = v => ['PLATINUM','DIAMOND','BLACK'].includes((v.tier||'').toUpperCase())

  const contactedToday = new Set(todayLogs.map(l => l.username))

  // Apply host filter to a VIP list
  const applyHost = list => hostFilter === 'All' ? list : list.filter(v => v.host_assigned === hostFilter)
  const applyTier = list => tierFilter === 'vip'  ? list.filter(isVipTier) : list

  const hostVips   = applyHost(allVips)
  const highRisk   = hostVips.filter(isHighRisk)
  const needContact = hostVips.filter(v => !contactedToday.has(v.username) && (getDays(v)??0) >= 1)
  const pendingReview = hostVips.filter(v => {
    const r = (v.churn_risk||'').toUpperCase()
    if (!['HIGH','MEDIUM','CRITICAL'].includes(r)) return false
    if (!v.last_contacted) return true
    return (now - new Date(v.last_contacted)) / 86400000 >= 3
  })
  const birthdaysToday = hostVips.filter(v => {
    if (!v.birthday) return false
    const bd = new Date(v.birthday)
    return (bd.getUTCMonth()+1)===(now.getMonth()+1) && bd.getUTCDate()===now.getDate()
  })

  // Priority Queue — deduplicated, sorted by tier → urgency, capped at 20
  const seen = new Set(); const allPriority = []
  const addQ = (v, reason, color) => {
    if (seen.has(v.id)) return; seen.add(v.id)
    allPriority.push({ ...v, _reason: reason, _color: color, _days: getDays(v) })
  }
  birthdaysToday.forEach(v => addQ(v, isCN?'🎂 今日生日':'🎂 Birthday', '#f472b6'))
  highRisk.filter(v => !contactedToday.has(v.username))
    .forEach(v => addQ(v, isCN?'⚠️ 高风险':'⚠️ High Risk', '#f85149'))
  hostVips.filter(v => getDays(v)===1 && !contactedToday.has(v.username))
    .forEach(v => addQ(v, isCN?'🔴 昨日流失':'🔴 Lost Yesterday', '#f85149'))
  hostVips.filter(v => { const d=getDays(v); return d>=2&&d<=3&&!contactedToday.has(v.username) })
    .forEach(v => addQ(v, isCN?'⚡ 3天未充':'⚡ 3-Day Gap', '#f59e0b'))
  pendingReview.filter(v => !contactedToday.has(v.username))
    .forEach(v => addQ(v, isCN?'📅 待跟进':'📅 Follow-Up', '#f59e0b'))

  // Sort: tier first, then days descending
  allPriority.sort((a,b) => tierRank(a.tier)-tierRank(b.tier) || (b._days??0)-(a._days??0))
  const priorityItems = applyTier(allPriority).slice(0, 20)

  // Urgent groups
  const GROUPS = [
    { key:'d1',   icon:'🔴', label:isCN?'昨日流失':'Lost Yesterday', sub:isCN?'1天未充':'1d',    items: hostVips.filter(v=>getDays(v)===1) },
    { key:'d3',   icon:'⚡', label:isCN?'2-3天':'2-3 Days',          sub:isCN?'未充':'inactive',  items: hostVips.filter(v=>{const d=getDays(v);return d>=2&&d<=3}) },
    { key:'d5',   icon:'⚠️', label:isCN?'3-5天':'3-5 Days',          sub:isCN?'未入款':'no dep',  items: hostVips.filter(v=>{const d=getDays(v);return d>=3&&d<=5}) },
    { key:'new1', icon:'🆕', label:isCN?'新注册已充':'New+Dep',        sub:isCN?'60天内':'60d',     items: hostVips.filter(v=>{const ref=v.registration_date||v.created_at;if(!ref)return false;return (now-new Date(ref))/86400000<=60&&(v.total_deposit||0)>0}) },
    { key:'new0', icon:'🆕', label:isCN?'新注册未充':'New NoDep',      sub:isCN?'待首存':'1st dep', items: hostVips.filter(v=>{const ref=v.registration_date||v.created_at;if(!ref)return false;return (now-new Date(ref))/86400000<=60&&!(v.total_deposit||0)}) },
  ]

  // Timeline buckets
  const BUCKETS = [
    { key:'all',    label:isCN?'全部':'All',        filter:()=>true },
    { key:'d1',     label:'🔥 1天',                 filter:v=>getDays(v)===1 },
    { key:'d2',     label:'⚡ 2天',                 filter:v=>getDays(v)===2 },
    { key:'d3_7',   label:isCN?'3-7天':'3-7d',      filter:v=>{const d=getDays(v);return d>=3&&d<=7} },
    { key:'d8_15',  label:isCN?'8-15天':'8-15d',    filter:v=>{const d=getDays(v);return d>=8&&d<=15} },
    { key:'d16_30', label:isCN?'16-30天':'16-30d',  filter:v=>{const d=getDays(v);return d>=16&&d<=30} },
    { key:'d31_60', label:isCN?'31-60天':'31-60d',  filter:v=>{const d=getDays(v);return d>=31&&d<=60} },
    { key:'d60p',   label:isCN?'60天+':'60d+',      filter:v=>(getDays(v)??0)>60 },
  ]
  const bucketDef   = BUCKETS.find(b=>b.key===activeBucket)||BUCKETS[0]
  const timelineVips = applyHost(allVips).filter(bucketDef.filter)
  const groupDef    = activeGroup ? GROUPS.find(g=>g.key===activeGroup) : null

  // Quick log submit
  const submitLog = async () => {
    if (!logTarget || logSubmitting) return
    setLogSubmitting(true)
    await supabase.from('contact_logs').insert({ username: logTarget.username, outcome: logOutcome, created_at: new Date().toISOString() })
    setLogTarget(null); setLogOutcome('Replied'); setLogSubmitting(false)
    loadAll()
  }

  // Styles
  const c = { bg:'#0d1117', surface:'#161b22', border:'#30363d', border2:'#21262d', text:'#e6edf3', muted:'#8b949e', blue:'#388bfd', green:'#3fb950', red:'#f85149', amber:'#f59e0b', purple:'#a371f7' }
  const s = {
    page:    { padding:'20px 24px', fontFamily:'system-ui,-apple-system,sans-serif', color:c.text, background:c.bg, minHeight:'100vh' },
    header:  { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 },
    title:   { fontSize:20, fontWeight:700, margin:0, display:'flex', alignItems:'center', gap:8 },
    date:    { fontSize:12, color:c.muted, marginTop:3 },
    pill:    (active) => ({ padding:'4px 11px', borderRadius:20, border:`1px solid ${active?c.blue:c.border}`, background:active?'#1f6feb':c.surface, color:active?'#fff':c.muted, cursor:'pointer', fontSize:12, fontWeight:active?600:400 }),
    statsRow:{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:20 },
    card:    (color) => ({ background:c.surface, border:`1px solid ${c.border}`, borderTop:`3px solid ${color}`, borderRadius:10, padding:'14px 16px', cursor:'pointer' }),
    num:     (color) => ({ fontSize:26, fontWeight:700, color, lineHeight:1.1 }),
    lbl:     { fontSize:11, color:c.muted, marginTop:3 },
    panel:   { background:c.surface, border:`1px solid ${c.border}`, borderRadius:10, padding:16 },
    panelHdr:{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 },
    secTitle:{ fontSize:14, fontWeight:600, display:'flex', alignItems:'center', gap:6, margin:0 },
    twoCol:  { display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:12, marginBottom:20 },
    groupsRow:{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginBottom:20 },
    groupCard:(active)=>({ background:c.surface, border:`1px solid ${active?c.blue:c.border}`, borderRadius:10, padding:'12px 14px', cursor:'pointer' }),
    table:   { width:'100%', borderCollapse:'collapse', fontSize:13 },
    th:      { padding:'7px 10px', textAlign:'left', borderBottom:`1px solid ${c.border}`, color:c.muted, fontSize:11, fontWeight:500 },
    td:      { padding:'7px 10px', borderBottom:`1px solid ${c.border2}`, verticalAlign:'middle' },
    tier:    (t) => ({ display:'inline-block', padding:'2px 7px', borderRadius:4, fontSize:11, fontWeight:700, background:TIER_BG[t]||c.border, color:TIER_COLOR[t]||'#ccc' }),
    link:    { color:c.blue, cursor:'pointer', fontWeight:500 },
    tag:     (color) => ({ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:4, fontSize:11, background:color+'22', color, fontWeight:600 }),
    logBtn:  { padding:'3px 10px', borderRadius:5, border:`1px solid ${c.border}`, background:'transparent', color:c.muted, cursor:'pointer', fontSize:11 },
    progress:{ background:c.border2, borderRadius:4, height:5, overflow:'hidden', marginTop:6 },
    progressFill:(pct)=>({ height:'100%', borderRadius:4, background:`linear-gradient(90deg,${c.green},#58a65c)`, width:`${Math.min(100,pct)}%`, transition:'width .3s' }),
    bucketTabs:{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 },
    modal:   { position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 },
    modalBox:{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:12, padding:24, minWidth:320 },
    filterRow:{ display:'flex', gap:5, alignItems:'center' },
    empty:   { color:c.muted, fontSize:13, textAlign:'center', padding:'20px 0' },
  }

  if (loading) return <div style={{...s.page, display:'flex', alignItems:'center', justifyContent:'center'}}><div style={{color:c.muted}}>{isCN?'加载中...':'Loading...'}</div></div>

  const contactPct = needContact.length ? Math.round(contactedToday.size / (needContact.length + contactedToday.size) * 100) : 0

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>📋 {isCN?'今日工作台':'Daily Command Center'}</h1>
          <div style={s.date}>{now.toLocaleDateString(isCN?'zh-CN':'en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
        </div>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          {/* Host filter pills */}
          <div style={s.filterRow}>
            {HOSTS.map(h => <button key={h} style={s.pill(hostFilter===h)} onClick={()=>setHostFilter(h)}>{h==='All'?(isCN?'全部主机':'All Hosts'):h}</button>)}
          </div>
          <VipQuickSearch />
          <button style={{...s.pill(false), whiteSpace:'nowrap'}} onClick={loadAll}>↻ {isCN?'刷新':'Refresh'}</button>
        </div>
      </div>

      {dbError && <div style={{background:'#2d0b0b',border:`1px solid ${c.red}`,borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:c.red}}>⚠️ {dbError}</div>}

      {/* ── 5 Stat Cards ── */}
      <div style={s.statsRow}>
        {[
          { num:needContact.length,    label:isCN?'今日需联系':'Need Contact',    color:c.blue,   onClick:()=>{setActiveBucket('all');timelineRef.current?.scrollIntoView({behavior:'smooth'})} },
          { num:highRisk.length,       label:isCN?'高风险流失':'High-Risk Churn', color:c.red,    onClick:()=>{setActiveBucket('d3_7');timelineRef.current?.scrollIntoView({behavior:'smooth'})} },
          { num:contactedToday.size,   label:isCN?'今日已联系':'Contacted Today', color:c.green,  onClick:null },
          { num:pendingReview.length,  label:isCN?'待跟进':'Follow-Up Due',       color:c.amber,  onClick:null },
          { num:monthlyRecall,         label:isCN?'本月召回':'Monthly Recall',    color:c.purple, onClick:null },
        ].map((c2,i)=>(
          <div key={i} style={s.card(c2.color)} onClick={c2.onClick||undefined}>
            <div style={s.num(c2.color)}>{c2.num}</div>
            <div style={s.lbl}>{c2.label}</div>
          </div>
        ))}
      </div>

      {/* ── Priority Queue + Today Progress ── */}
      <div style={s.twoCol}>

        {/* Priority Queue */}
        <div style={s.panel}>
          <div style={s.panelHdr}>
            <p style={s.secTitle}>🎯 {isCN?'今日优先跟进':'Priority Queue'} <span style={{color:c.muted, fontWeight:400, fontSize:11}}>top {priorityItems.length}</span></p>
            <div style={s.filterRow}>
              <button style={s.pill(tierFilter==='all')}  onClick={()=>setTierFilter('all')}>{isCN?'全部':'All'}</button>
              <button style={s.pill(tierFilter==='vip')}  onClick={()=>setTierFilter('vip')}>Plat+Diamond</button>
            </div>
          </div>

          {priorityItems.length===0
            ? <div style={s.empty}>{isCN?'暂无跟进':'No priority items'}</div>
            : <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>{isCN?'用户':'User'}</th>
                  <th style={s.th}>{isCN?'等级':'Tier'}</th>
                  <th style={s.th}>{isCN?'原因':'Reason'}</th>
                  <th style={s.th}>{isCN?'天数':'Days'}</th>
                  <th style={s.th}>{isCN?'风险':'Risk'}</th>
                  <th style={s.th}></th>
                </tr></thead>
                <tbody>
                  {priorityItems.map(v=>(
                    <tr key={v.id}>
                      <td style={s.td}><span style={s.link} onClick={()=>navigate(`/vip/${v.username}`)}>{v.username}</span></td>
                      <td style={s.td}><span style={s.tier(v.tier)}>{v.tier}</span></td>
                      <td style={s.td}><span style={s.tag(v._color)}>{v._reason}</span></td>
                      <td style={{...s.td, fontVariantNumeric:'tabular-nums', color:v._days>=7?c.red:v._days>=3?c.amber:c.text}}>{v._days??'-'}</td>
                      <td style={s.td}><span style={{fontSize:11, color:riskColor(v)}}>{v.churn_risk||'-'}</span></td>
                      <td style={s.td}>
                        {!contactedToday.has(v.username) &&
                          <button style={s.logBtn} onClick={()=>setLogTarget({id:v.id,username:v.username})}>
                            {isCN?'记录':'Log'}
                          </button>
                        }
                        {contactedToday.has(v.username) && <span style={{color:c.green,fontSize:12}}>✓</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>

        {/* Right column: Progress + Contacted Today */}
        <div style={{display:'flex', flexDirection:'column', gap:12}}>

          {/* Daily Progress */}
          <div style={s.panel}>
            <p style={{...s.secTitle, marginBottom:10}}>📈 {isCN?'今日进度':'Today\'s Progress'}</p>
            <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4}}>
              <span style={{color:c.muted}}>{isCN?'已联系':'Contacted'}</span>
              <span style={{fontWeight:700}}><span style={{color:c.green}}>{contactedToday.size}</span> / {needContact.length + contactedToday.size}</span>
            </div>
            <div style={s.progress}><div style={s.progressFill(contactPct)}/></div>
            <div style={{fontSize:11, color:c.muted, marginTop:6, textAlign:'right'}}>{contactPct}% {isCN?'完成':'done'}</div>
            {birthdaysToday.length>0 && (
              <div style={{marginTop:12, padding:'8px 10px', background:'#2d1b4e', borderRadius:6, fontSize:12}}>
                🎂 <span style={{color:'#f472b6', fontWeight:600}}>{birthdaysToday.length}</span> {isCN?`位今日生日`:`birthday${birthdaysToday.length>1?'s':''} today`}:
                {birthdaysToday.map(v=><span key={v.id}> <span style={s.link} onClick={()=>navigate(`/vip/${v.username}`)}>{v.username}</span></span>)}
              </div>
            )}
          </div>

          {/* Contacted Today */}
          <div style={{...s.panel, flex:1}}>
            <div style={s.panelHdr}>
              <p style={s.secTitle}>✅ {isCN?'今日已联系':'Contacted Today'} <span style={{color:c.muted,fontWeight:400,fontSize:11}}>({contactedToday.size})</span></p>
            </div>
            {todayLogs.length===0
              ? <div style={s.empty}>{isCN?'今日暂无记录':'None yet — start calling!'}</div>
              : <table style={s.table}>
                  <thead><tr>
                    <th style={s.th}>{isCN?'用户':'User'}</th>
                    <th style={s.th}>{isCN?'结果':'Outcome'}</th>
                  </tr></thead>
                  <tbody>
                    {todayLogs.map((l,i)=>(
                      <tr key={i}>
                        <td style={s.td}><span style={s.link} onClick={()=>navigate(`/vip/${l.username}`)}>{l.username}</span></td>
                        <td style={s.td}><span style={{color:c.green,fontSize:12}}>{l.outcome||'-'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>

        </div>
      </div>

      {/* ── Urgent Groups ── */}
      <div style={{marginBottom:20}}>
        <p style={{...s.secTitle, marginBottom:10}}>🚨 {isCN?'紧急分组':'Urgent Groups'}</p>
        <div style={s.groupsRow}>
          {GROUPS.map(g=>(
            <div key={g.key} style={s.groupCard(activeGroup===g.key)} onClick={()=>setActiveGroup(activeGroup===g.key?null:g.key)}>
              <div style={{fontSize:20,marginBottom:4}}>{g.icon}</div>
              <div style={{fontSize:12,fontWeight:600,marginBottom:2}}>{g.label}</div>
              <div style={{fontSize:10,color:c.muted,marginBottom:6}}>{g.sub}</div>
              <div style={{fontSize:22,fontWeight:700,color:g.items.length>0?c.red:c.green}}>{g.items.length}</div>
            </div>
          ))}
        </div>

        {groupDef && groupDef.items.length>0 && (
          <div style={s.panel}>
            <div style={{...s.panelHdr, marginBottom:10}}>
              <p style={s.secTitle}>{groupDef.icon} {groupDef.label} <span style={{color:c.muted,fontWeight:400,fontSize:11}}>({groupDef.items.length})</span></p>
            </div>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>{isCN?'用户':'User'}</th>
                <th style={s.th}>{isCN?'等级':'Tier'}</th>
                <th style={s.th}>{isCN?'地区':'Region'}</th>
                <th style={s.th}>{isCN?'未充天数':'Days'}</th>
                <th style={s.th}>{isCN?'负责人':'Host'}</th>
                <th style={s.th}>{isCN?'风险':'Risk'}</th>
                <th style={s.th}></th>
              </tr></thead>
              <tbody>
                {groupDef.items.map(v=>(
                  <tr key={v.id}>
                    <td style={s.td}><span style={s.link} onClick={()=>navigate(`/vip/${v.username}`)}>{v.username}</span></td>
                    <td style={s.td}><span style={s.tier(v.tier)}>{v.tier}</span></td>
                    <td style={s.td}>{v.region||'-'}</td>
                    <td style={{...s.td,fontVariantNumeric:'tabular-nums',color:(getDays(v)||0)>=3?c.red:c.amber}}>{getDays(v)??'-'}</td>
                    <td style={s.td}>{v.host_assigned||'-'}</td>
                    <td style={s.td}><span style={{color:riskColor(v),fontSize:11}}>{v.churn_risk||'-'}</span></td>
                    <td style={s.td}>
                      {!contactedToday.has(v.username)
                        ? <button style={s.logBtn} onClick={()=>setLogTarget({id:v.id,username:v.username})}>{isCN?'记录':'Log'}</button>
                        : <span style={{color:c.green,fontSize:12}}>✓</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Churn Timeline ── */}
      <div ref={timelineRef}>
        <p style={{...s.secTitle, marginBottom:10}}>📊 {isCN?'流失时间线':'Churn Timeline'}</p>
        <div style={s.bucketTabs}>
          {BUCKETS.map(b=>{
            const count = applyHost(allVips).filter(b.filter).length
            return <button key={b.key} style={s.pill(activeBucket===b.key)} onClick={()=>setActiveBucket(b.key)}>{b.label} ({count})</button>
          })}
        </div>
        <div style={s.panel}>
          {timelineVips.length===0
            ? <div style={s.empty}>{isCN?'此时间段暂无记录':'No VIPs in this bucket'}</div>
            : <div style={{overflowX:'auto'}}>
                <table style={s.table}>
                  <thead><tr>
                    <th style={s.th}>{isCN?'用户':'User'}</th>
                    <th style={s.th}>{isCN?'等级':'Tier'}</th>
                    <th style={s.th}>{isCN?'地区':'Region'}</th>
                    <th style={s.th}>{isCN?'未充天数':'Days'}</th>
                    <th style={s.th}>{isCN?'上次充值':'Last Dep.'}</th>
                    <th style={s.th}>{isCN?'总充值':'Total Dep.'}</th>
                    <th style={s.th}>{isCN?'负责人':'Host'}</th>
                    <th style={s.th}>{isCN?'风险':'Risk'}</th>
                    <th style={s.th}>{isCN?'今日':'Today'}</th>
                  </tr></thead>
                  <tbody>
                    {timelineVips.map(v=>(
                      <tr key={v.id}>
                        <td style={s.td}><span style={s.link} onClick={()=>navigate(`/vip/${v.username}`)}>{v.username}</span></td>
                        <td style={s.td}><span style={s.tier(v.tier)}>{v.tier}</span></td>
                        <td style={s.td}>{v.region||'-'}</td>
                        <td style={{...s.td,fontVariantNumeric:'tabular-nums',color:(getDays(v)||0)>=7?c.red:(getDays(v)||0)>=3?c.amber:c.text}}>{getDays(v)??'-'}</td>
                        <td style={s.td}>{v.last_deposit_date?new Date(v.last_deposit_date).toLocaleDateString():'-'}</td>
                        <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.total_deposit?`$${Number(v.total_deposit).toLocaleString()}`:'-'}</td>
                        <td style={s.td}>{v.host_assigned||'-'}</td>
                        <td style={s.td}><span style={{color:riskColor(v),fontSize:11}}>{v.churn_risk||'-'}</span></td>
                        <td style={s.td}>
                          {contactedToday.has(v.username)
                            ? <span style={{color:c.green}}>✓</span>
                            : <button style={s.logBtn} onClick={()=>setLogTarget({id:v.id,username:v.username})}>{isCN?'记录':'Log'}</button>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </div>
      </div>

      {/* ── Quick Log Modal ── */}
      {logTarget && (
        <div style={s.modal} onClick={e=>{if(e.target===e.currentTarget)setLogTarget(null)}}>
          <div style={s.modalBox}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>📝 {isCN?'快速记录联系':'Quick Log Contact'}</div>
            <div style={{color:c.muted,fontSize:13,marginBottom:16}}>{logTarget.username}</div>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:c.muted,marginBottom:6}}>{isCN?'联系结果':'Outcome'}</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                {['Replied','No Answer','Promised Deposit','Will Return','Not Interested','Wrong Number'].map(o=>(
                  <button key={o}
                    style={{padding:'7px 10px',borderRadius:6,border:`1px solid ${logOutcome===o?'#388bfd':'#30363d'}`,background:logOutcome===o?'#1f3a6e':'transparent',color:logOutcome===o?'#58a6ff':c.muted,cursor:'pointer',fontSize:12,textAlign:'left'}}
                    onClick={()=>setLogOutcome(o)}
                  >{o}</button>
                ))}
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button style={{...s.pill(false),padding:'7px 16px'}} onClick={()=>setLogTarget(null)}>{isCN?'取消':'Cancel'}</button>
              <button
                style={{...s.pill(true),padding:'7px 16px',background:c.green,borderColor:c.green}}
                onClick={submitLog}
                disabled={logSubmitting}
              >{logSubmitting?(isCN?'保存中...':'Saving...'):(isCN?'确认保存':'Save')}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
