// ChurnAlerts v2 — with reactivation tracking + monthly stats
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, MONTHS } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { ListCount, LastBet } from '../components/ui'
import WaSenderModal from '../components/WaSenderModal'
import { fetchAll } from '../lib/depositProfile'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamNumber, useUrlParamBool, useUrlParamsRaw } from '../hooks/useUrlParam'
import CopyBtn from '../components/CopyBtn'
import WinbackBonusModal from '../components/churn/WinbackBonusModal'
import WinbackReport from '../components/churn/WinbackReport'
import { loadPlayerCosts } from '../lib/playerCost'
import EmailModal from '../components/EmailModal'

const RISK_COLOR = { HIGH:'#f85149', MEDIUM:'#d29922', LOW:'#3fb950' }
const RISK_ZH    = { HIGH:'高', MEDIUM:'中', LOW:'低', CRITICAL:'严重' }
const TIER_ZH    = { BLACK:'黑金', 'DIAMOND-P': '钻石P', DIAMOND:'钻石', PLATINUM:'白金', GOLD:'黄金', SILVER:'白银', BRONZE:'青铜' }
const RISK_BG    = { HIGH:'rgba(248,81,73,.12)', MEDIUM:'rgba(210,153,34,.12)', LOW:'rgba(63,185,80,.1)' }

const s = {
  page:   { padding:'24px 28px', minHeight:'100vh' },
  title:  { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:    { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:   { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  tbl:    { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:     { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:     { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  badge:  { display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  tag:    { display:'inline-block', padding:'2px 9px', borderRadius:6, fontSize:11, fontWeight:600 },
  btn:    (c='var(--accent)') => ({ background:c, color:'#fff', border:'none', padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' }),
  btnSm:  { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer' },
  input:  { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:7, fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' },
  sel:    { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none' },
  modal:  { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' },
  mBox:   { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'28px 32px', width:440, maxWidth:'90vw' },
}

const PRIORITY_COLOR = { P1:'#f85149', P2:'#d29922', P3:'#58a6ff' }
const STATUS_ZH = { Resting:'休息中', 'At Risk':'有风险', Churn:'流失', Dormant:'休眠' }
const CHASE_STATUSES = ['Resting', 'At Risk', 'Churn', 'Dormant']
const TIER_ORDER = ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD']

// Why this player is on the call list. Signals come from v_vip_early_warning; each reason has both languages.
function buildPriorityReasons(status, days, e, currency) {
  const money = n => formatMoney(Math.abs(Number(n) || 0), currency)
  const out = []
  if (days == null) out.push({ en:'No deposit in the last 180 days', zh:'近180天没有存款' })
  else if (status === 'Resting') out.push({ en:`Still betting, no deposit for ${days} days`, zh:`仍在投注，${days}天未存款` })
  else out.push({ en:`No deposit for ${days} days`, zh:`${days}天未存款` })
  const has = t => String(e?.reasons || '').includes(t)
  if (has('Deposits down')) {
    const pct = Math.round(100 - 100 * Number(e.dep_this_week) / Number(e.dep_prev_week))
    out.push({ en:`Deposits down ${pct}% this week (${money(e.dep_prev_week)} → ${money(e.dep_this_week)})`, zh:`本周存款下降 ${pct}% (${money(e.dep_prev_week)} → ${money(e.dep_this_week)})` })
  }
  if (has('Lost ')) out.push({ en:`Lost ${money(e.win_loss_last3)} in 3 days, still playing: care call, no promo`, zh:`3天输 ${money(e.win_loss_last3)}，仍在玩：关怀为主，不推优惠` })
  if (has('Won ')) out.push({ en:`Won ${money(e.win_loss_last3)} then stopped ${e.days_since_active} days: invite back`, zh:`赢 ${money(e.win_loss_last3)} 后停了 ${e.days_since_active} 天：邀请回来` })
  if (has('Tracked net loss')) {
    // The view has no date column; the start date is only in its reason text
    const since = String(e.reasons).match(/Tracked net loss \S+ since (\d{4}-\d{2}-\d{2})/)?.[1]
    out.push(since
      ? { en:`Net loss ${money(e.tracked_win_loss)} since ${since}: big-loss gift eligible`, zh:`自 ${since} 净输 ${money(e.tracked_win_loss)}：符合大额亏损礼物` }
      : { en:`Net loss ${money(e.tracked_win_loss)}: big-loss gift eligible`, zh:`净输 ${money(e.tracked_win_loss)}：符合大额亏损礼物` })
  }
  return out
}

function StatCard({ icon, label, value, color, sub }) { return (<div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}><div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>{icon} {label}</div><div style={{ fontSize:28, fontWeight:800, color: color||'var(--text)' }}>{value}</div>{sub && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{sub}</div>}</div>) }

function ReactivateModal({ vip, month, onClose, onSaved }) {
  const { profile } = useAuth(); const { t, lang } = useLanguage()
  const [amount,setAmount]=useState(''); const [currency,setCurrency]=useState(vip?.currency || 'MYR'); const [notes,setNotes]=useState(''); const [saving,setSaving]=useState(false)
  async function handleSave(){
    const recoveryAmount=Number(amount)
    if(!Number.isFinite(recoveryAmount)||recoveryAmount<0){alert(t('churnAlerts.recoveryAmountRequired'));return}
    setSaving(true)
    const myName=profile?.full_name||profile?.username||'Host'
    const {error}=await supabase.from('reactivation_logs').upsert({username:vip.username,tier:vip.tier,vip_id:vip.id,reactivated_month:month,days_was_inactive:vip.days_inactive,prev_last_deposit:vip.last_deposit_date||null,host_name:myName,reactivation_deposit:recoveryAmount,currency,notes:notes||null},{onConflict:'username,reactivated_month'})
    if(error){alert(t('churnAlerts.saveFailed',{msg:error.message}));setSaving(false);return}; onSaved();onClose()
  }
  return <div style={s.modal} onClick={onClose}><div style={s.mBox} onClick={e=>e.stopPropagation()}>
    <div style={{fontSize:17,fontWeight:700,marginBottom:4}}>{t('churnAlerts.markActivatedModalTitle')}</div>
    <div style={{fontSize:13,color:'var(--muted)',marginBottom:20}}>{t('churnAlerts.recordActivationDesc',{username:vip.username,month})}</div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 120px',gap:10,marginBottom:16}}><div><div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>{t('churnAlerts.recoveryDepositLabel')}</div><input type="number" min="0" step="0.01" style={s.input} value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" /></div><div><div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>{t('churnAlerts.currencyLabel')}</div><select style={s.sel} value={currency} onChange={e=>setCurrency(e.target.value)}><option>MYR</option><option>SGD</option><option>KHR</option></select></div></div>
    <div style={{marginBottom:16}}><div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>{t('churnAlerts.notesLabel')}</div><textarea rows={3} style={{...s.input,resize:'vertical',fontFamily:'inherit'}} value={notes} onChange={e=>setNotes(e.target.value)} placeholder={t('churnAlerts.notesPlaceholder')} /></div>
    <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}><button style={s.btnSm} onClick={onClose}>{t('common.cancel')}</button><button style={s.btn('#3fb950')} onClick={handleSave} disabled={saving}>{saving?t('common.saving'):t('churnAlerts.confirmReactivated')}</button></div>
  </div></div>
}

// ── Main Component ────────────────────────────────────────────────────────────
// Priority tab: columns you can click to sort. 'first' is the direction of the first click
const P_SORT = {
  username: { get:v=>String(v.username||'').toLowerCase(), first:'asc' },
  tier: { get:v=>TIER_ORDER.indexOf(v.tier), first:'asc' },
  host: { get:v=>String(v.host||'').toLowerCase(), first:'asc' },
  days: { get:v=>v.days_since_deposit??Infinity, first:'desc' },
  dep: { get:v=>v.dep_90d, first:'desc' },
  contact: { get:v=>v.last_contact?new Date(v.last_contact).getTime():0, first:'asc' },
}

// No Deposit tab: quick day ranges, status colours and clickable columns
const ND_RANGES = [['3-6',3,6],['7-14',7,14],['15-30',15,30],['31+',31,Infinity]]
const ND_STATUS_COLOR = { Active:'#3fb950', Resting:'#38BDF8', 'At Risk':'#d29922', Churn:'#f85149', Dormant:'var(--muted)' }
const ND_SORT = {
  username: { get:v=>String(v.username||'').toLowerCase(), first:'asc' },
  tier: { get:v=>TIER_ORDER.indexOf(v.tier), first:'asc' },
  host: { get:v=>String(v.host_assigned||'').toLowerCase(), first:'asc' },
  days: { get:v=>v.days_inactive, first:'desc' },
  bet: { get:v=>v.last_bet_date||'', first:'asc' },
  dep: { get:v=>v.dep_90d??-1, first:'desc' },
  cost: { get:v=>v.cost?.total??-1, first:'desc' },
  contact: { get:v=>v.last_contacted?new Date(v.last_contacted).getTime():0, first:'asc' },
}

const PlayerName=({name})=>name?<div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{name}</div>:null

export default function ChurnAlerts() {
  const navigate=useNavigate(); const {profile}=useAuth(); const {t,lang}=useLanguage(); const L2=(en,zh)=>(lang==='zh'?zh:en); const now=new Date()
  const [month,setMonth]=useUrlParamNumber('month',now.getMonth()); const [year,setYear]=useUrlParamNumber('year',now.getFullYear()); const [tab,setTab]=useUrlParam('tab','priority')
  const [priorityListAll,setPriorityList]=useState([]),[priorityLoading,setPriorityLoading]=useState(true),[vipsAll,setVips]=useState([]),[reactivated,setReactivated]=useState([]),[reactivatedSet,setReactivatedSet]=useState(new Set()),[diamondUncontacted,setDiamondUncontacted]=useState([]),[platinumUncontacted,setPlatinumUncontacted]=useState([]),[dormantList,setDormantList]=useState([]),[dormantDays,setDormantDays]=useUrlParamNumber('dormantDays',15),[dormantTierF,setDormantTierF]=useUrlParam('dormantTier','ALL'),[loading,setLoading]=useState(true),[reactivateModal,setReactivateModal]=useState(null)
  const myName=profile?.full_name||''
  const [mineOnly,setMineOnly]=useUrlParamBool('mine',false),[riskF,setRiskF]=useUrlParam('risk','ALL'),[tierF,setTierF]=useUrlParam('tier','ALL'),[reactTierF,setReactTierF]=useUrlParam('reactTier','ALL'),[sortCol,setSortCol]=useUrlParam('sort','days_inactive'),[sortAsc,setSortAsc]=useUrlParamBool('asc',false),[stats,setStats]=useState({high:0,medium:0,dormant:0,atRisk:0})
  const [dHostF,setDHostF]=useState('ALL'),[pHostF,setPHostF]=useState('ALL'),[gHostF,setGHostF]=useState('ALL'),[contactedSet,setContactedSet]=useState(new Set()),[dUncontactedOnly,setDUncontactedOnly]=useState(false),[pUncontactedOnly,setPUncontactedOnly]=useState(false),[gUncontactedOnly,setGUncontactedOnly]=useState(false)
  const [emailModal,setEmailModal]=useState(null)
  const [wbModal,setWbModal]=useState(null),[wbSel,setWbSel]=useState(new Set()),[wbReload,setWbReload]=useState(0)
  const [churnWaModal,setChurnWaModal]=useState(null),[priorityHostF,setPriorityHostF]=useState('ALL'),[priorityError,setPriorityError]=useState(false)
  const [pLevelF,setPLevelF]=useUrlParam('plevel','P1'),[pSort,setPSort]=useUrlParam('psort','call')
  // One URL value per filter: 'nd' is a day range ('3-6') or dates ('date:from:to')
  const [ndRange,setNdRange]=useUrlParam('nd','3-6'),[ndSort,setNdSort]=useUrlParam('ndsort','days:desc'),[ndTier,setNdTier]=useUrlParam('ndtier','ALL'),[ndHost,setNdHost]=useUrlParam('ndhost','ALL'),[dep90By,setDep90By]=useState({}),[costInfo,setCostInfo]=useState(null)
  // Market filter (MY / SG / KH) — based on the player's account currency; applies to every tab + stat cards
  const [mktF,setMktF]=useUrlParam('mkt','ALL')
  const mktOf=c=>{const u=String(c||'MYR').toUpperCase();return u==='SGD'?'SG':u.startsWith('KH')?'KH':'MY'}
  const inMkt=v=>mktF==='ALL'||mktOf(v.currency)===mktF
  const vips=vipsAll.filter(inMkt), priorityList=priorityListAll.filter(inMkt)
  const curByUser={}; vipsAll.forEach(v=>{curByUser[v.username]=v.currency})
  const mktList=['MY','SG','KH'].filter(m=>vipsAll.some(v=>mktOf(v.currency)===m))
  const monthStr=`${year}-${String(month+1).padStart(2,'0')}`

  // Company cost so far per player (bonus + rebate + campaign + BO bonus + department spending), loaded the first time No Deposit opens
  useEffect(()=>{if(tab!=='nodeposit'||costInfo||!vipsAll.length)return;setCostInfo({loading:true,costs:{},missing:[]});loadPlayerCosts(vipsAll).then(setCostInfo).catch(e=>{console.error(e);setCostInfo({costs:{},missing:['all']})})},[tab,vipsAll]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{loadAll()},[riskF,tierF,sortCol,sortAsc,month,year,mineOnly,dormantDays]); useEffect(()=>{loadPriorityContacts()},[])
  // Call list: CRM priority score (v_vip_priority) for every Gold+ player who is not Active.
  // Score = value x return. Its "reach" discount is left out on purpose, so players who don't reply are not pushed down.
  async function loadPriorityContacts(){setPriorityLoading(true);setPriorityError(false);try{
    const readScores=()=>fetchAll(()=>supabase.from('v_vip_priority').select('vip_id,username,tier,host_assigned,currency,dep_90d,days_since_deposit,value_score,return_score,last_contact_date,days_since_contact,attempts_since_reply,unreachable').order('username'))
    const readWarnings=()=>fetchAll(()=>supabase.from('v_vip_early_warning').select('username,reasons,dep_this_week,dep_prev_week,win_loss_last3,tracked_win_loss,days_since_active').order('username'))
    // These two views can take 5-6s (limit 8s), so try once more before giving up
    const scores=await readScores().catch(readScores)
    setDep90By(Object.fromEntries(scores.map(p=>[p.username,Number(p.dep_90d)||0])))
    const [warnings,members,ruleRows]=await Promise.all([
      readWarnings().catch(readWarnings),
      fetchAll(()=>supabase.from('vip_members').select('id,username,full_name,whatsapp,phone,days_inactive,last_deposit_date,last_bet_date,activity_status').eq('is_excluded',false).order('username')),
      supabase.from('crm_rules').select('rule_key,value').in('rule_key',['p1_score','p2_score','p3_score','contact_cooldown_days']).then(r=>{if(r.error)throw r.error;return r.data||[]}),
    ])
    const rule={};ruleRows.forEach(r=>{rule[r.rule_key]=Number(r.value)})
    if(![rule.p1_score,rule.p2_score,rule.p3_score,rule.contact_cooldown_days].every(Number.isFinite))throw new Error('Priority rules missing in crm_rules')
    const warnBy={};warnings.forEach(w=>{warnBy[w.username]=w})
    const memberBy={};members.forEach(m=>{memberBy[m.username]=m})
    const results=[]
    scores.forEach(p=>{
      const m=memberBy[p.username]
      if(!m||!CHASE_STATUSES.includes(m.activity_status))return
      const score=Number(p.value_score)*Number(p.return_score)
      const level=score>=rule.p1_score?'P1':score>=rule.p2_score?'P2':score>=rule.p3_score?'P3':null
      if(!level)return
      const e=warnBy[p.username]
      results.push({id:p.vip_id,username:p.username,full_name:m.full_name,tier:p.tier,currency:p.currency,host:p.host_assigned,phone:m.phone,whatsapp:m.whatsapp,days_inactive:m.days_inactive,last_deposit_date:m.last_deposit_date,last_bet_date:m.last_bet_date,activity_status:m.activity_status,days_since_deposit:p.days_since_deposit,dep_90d:Number(p.dep_90d)||0,level,score,last_contact:p.last_contact_date,attempts:Number(p.attempts_since_reply)||0,unreachable:Boolean(p.unreachable),recent:p.days_since_contact!=null&&p.days_since_contact<=rule.contact_cooldown_days,deposit_drop:String(e?.reasons||'').includes('Deposits down'),reasons:buildPriorityReasons(m.activity_status,p.days_since_deposit,e,p.currency)})
    })
    // Gaming labels: latest per player, in chunks (100+ names in one .in() is too long)
    try {
      const names=results.map(r=>r.username),gamingMap={}
      for(let i=0;i<names.length;i+=150){
        const{data:gamingRows}=await supabase.from('player_gaming_labels').select('username, player_type, player_type_icon, offer_recommendation, snapshot_month').in('username',names.slice(i,i+150)).order('snapshot_month',{ascending:false})
        ;(gamingRows||[]).forEach(g=>{if(!gamingMap[g.username])gamingMap[g.username]=g})
      }
      results.forEach(r=>{const g=gamingMap[r.username];if(g&&g.player_type){r.player_type=g.player_type;r.player_type_icon=g.player_type_icon||'🎮';r.offer_recommendation=g.offer_recommendation}})
    } catch (gamingErr) { console.error('loadPriorityContacts gaming labels error', gamingErr) }
    // Just contacted goes last, so the top of the list is always who to call next
    results.sort((a,b)=>Number(a.recent)-Number(b.recent)||a.level.localeCompare(b.level)||TIER_ORDER.indexOf(a.tier)-TIER_ORDER.indexOf(b.tier)||b.score-a.score||b.dep_90d-a.dep_90d||String(a.username).localeCompare(String(b.username)))
    setPriorityList(results)
  }catch(e){console.error('loadPriorityContacts error',e);setPriorityError(true);setPriorityList([])}finally{setPriorityLoading(false)}}

  async function loadAll(){setLoading(true);try{const{data:members}=await supabase.from('vip_members').select('*').eq('is_excluded',false);const{data:logs}=await supabase.from('reactivation_logs').select('*').eq('reactivated_month',monthStr);const logSet=new Set((logs||[]).map(x=>x.username));setReactivated(logs||[]);setReactivatedSet(logSet);setVips(members||[]);setStats({high:(members||[]).filter(x=>x.churn_risk==='HIGH').length,medium:(members||[]).filter(x=>x.churn_risk==='MEDIUM').length,dormant:(members||[]).filter(x=>(x.days_inactive||0)>=dormantDays).length,atRisk:(members||[]).filter(x=>(x.churn_risk==='HIGH'||x.churn_risk==='MEDIUM')&&!logSet.has(x.username)).length});
    // contact_logs this month — for Diamond/Platinum coverage tracking
    // Contacted this month — ALL tiers (Diamond / Platinum / Gold tabs). Previously only Diamond+Platinum were checked,
    // so every Gold VIP showed "Not yet". Paged + no .in() list (breaks with 100+ names); compared case-insensitively.
    {const cl=await fetchAll(()=>supabase.from('contact_logs').select('username').eq('log_month',monthStr).order('username'));setContactedSet(new Set(cl.map(l=>String(l.username||'').toLowerCase())))}
  }catch(e){console.error(e)}finally{setLoading(false)}}

  const visibleVips=vips.filter(v=>(tierF==='ALL'||v.tier===tierF)&&(!mineOnly||v.host_assigned===myName)); const reactRows=reactivated.filter(v=>(reactTierF==='ALL'||v.tier===reactTierF)&&inMkt({currency:curByUser[v.username]||v.currency}))
  const countStatus=x=>vips.filter(v=>v.activity_status===x).length
  const st={resting:countStatus('Resting'),atRisk:countStatus('At Risk'),churn:countStatus('Churn'),dormant:countStatus('Dormant')}
  // Win-back bonus: only Churn (7-14 days) and Dormant (15+ days) players, not for view-only accounts
  const canBonus=v=>['Churn','Dormant'].includes(v.activity_status)&&profile?.role!=='readonly'
  const bonusBtn=v=>canBonus(v)&&<button style={{...s.btnSm,background:'#a855f7',color:'#fff',border:0,fontWeight:700}} title={L2('Record a win-back bonus and track if the player comes back','记录召回奖金并追踪玩家是否回归')} onClick={()=>setWbModal([v])}>{L2('🎁 Bonus','🎁 奖金')}</button>
  const canReactivate=v=>['Churn','Dormant'].includes(v.activity_status)&&!reactivatedSet.has(v.username)
  const pAll=priorityList.filter(v=>(priorityHostF==='ALL'||v.host===priorityHostF)&&(!mineOnly||v.host===myName))
  const pRows=pAll.filter(v=>v.level===pLevelF)
  const [pSortKey,pSortDir]=pSort.split(':')
  if(P_SORT[pSortKey]){const get=P_SORT[pSortKey].get,dir=pSortDir==='desc'?-1:1;pRows.sort((a,b)=>{const x=get(a),y=get(b);return(x<y?-1:x>y?1:0)*dir})}
  const clickPSort=key=>{if(key==='call')return setPSort('call');setPSort(`${key}:${pSortKey===key?(pSortDir==='desc'?'asc':'desc'):P_SORT[key].first}`)}
  return <div style={s.page}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:18}}><div><div style={s.title}>{t('sidebar.nav.churnAlerts')}</div><div style={s.sub}>{t('churnAlerts.subtitle')}</div></div></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:18}}><StatCard icon="😴" label={L2('Resting (betting, no deposit)','休息中 (投注未存款)')} value={st.resting} color="#38BDF8"/><StatCard icon="⚠️" label={L2('At Risk','有风险')} value={st.atRisk} color="#d29922"/><StatCard icon="🔥" label={L2('Churn','流失')} value={st.churn} color="#f85149"/><StatCard icon="💤" label={L2('Dormant','休眠')} value={st.dormant}/></div>
    <div style={s.card}><div style={{display:'flex',gap:8,padding:12,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>{[['priority',L2('🔥 Priority','🔥 优先')],['nodeposit',L2('📅 No Deposit','📅 未存款')],['churn',L2('📉 Churn','📉 流失')],['reactivated',L2('♻️ Reactivated','♻️ 已召回')],['dormant',L2('💤 Dormant','💤 休眠')],['diamond',L2('💎 Diamond','💎 钻石')],['platinum',L2('🔷 Platinum','🔷 白金')],['gold',L2('🥇 Gold','🥇 黄金')],['winback',L2('🎁 Win-back Bonus','🎁 召回奖金')]].map(([key,label])=><button key={key} style={{...s.btnSm,background:tab===key?'var(--accent)':'var(--surface2)',color:tab===key?'#fff':'var(--text)'}} onClick={()=>setTab(key)}>{label}</button>)}<div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}><span style={{fontSize:12,color:'var(--muted)',fontWeight:600}}>{L2('Market:','市场：')}</span>{['ALL',...mktList].map(m=>{const on=mktF===m;const n=m==='ALL'?vipsAll.length:vipsAll.filter(v=>mktOf(v.currency)===m).length;return <button key={m} title={L2(`${n} VIPs`,`${n} 位VIP`)} style={{...s.btnSm,background:on?'#1f6feb':'var(--surface2)',color:on?'#fff':'var(--text)',border:on?'1px solid #1f6feb':'1px solid var(--border)',fontWeight:on?700:500}} onClick={()=>setMktF(m)}>{m==='ALL'?L2('All','全部'):m==='MY'?'🇲🇾 MY':m==='SG'?'🇸🇬 SG':'🇰🇭 KH'}</button>})}</div></div>
      {tab==='priority'&&<div>{priorityLoading?<div style={{padding:30}}>{L2('Loading…','载入中…')}</div>:priorityError?<div style={{padding:30}}>{L2('Could not load the call list.','无法载入通话名单。')} <button style={s.btnSm} onClick={loadPriorityContacts}>{L2('Try again','重试')}</button></div>:<>
        <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {['P1','P2','P3'].map(l=>{const on=pLevelF===l;const n=pAll.filter(v=>v.level===l).length;return<button key={l} style={{...s.btnSm,fontWeight:700,background:on?PRIORITY_COLOR[l]:'var(--surface2)',color:on?'#fff':'var(--text)'}} onClick={()=>setPLevelF(l)}>{l} ({n})</button>})}
            <span style={{width:1,background:'var(--border)',margin:'0 4px'}}/>
            {['ALL',...[...new Set(priorityList.filter(v=>v.host).map(v=>v.host))].sort()].map(h=><button key={h} style={{...s.btnSm,background:priorityHostF===h?'var(--accent)':'var(--surface2)',color:priorityHostF===h?'#fff':'var(--text)'}} onClick={()=>setPriorityHostF(h)}>{h==='ALL'?L2('All hosts','全部负责人'):h}</button>)}
          </div>
          <label style={{display:'flex',gap:6,fontSize:12,alignItems:'center',color:'var(--text)',marginLeft:'auto',cursor:'pointer'}}>
            <input type="checkbox" checked={mineOnly} onChange={e=>setMineOnly(e.target.checked)}/>{L2('Mine only','仅我的')}
          </label>
        </div>
        <ListCount total={pRows.length} label="VIPs" labelZh="位VIP" />
        <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{[['#'],[L2('Priority','优先级'),'call'],[L2('Player','玩家'),'username'],[L2('Tier','等级'),'tier'],[L2('Host','负责人'),'host'],[L2('Phone / WA','电话 / WA')],[L2('Days','天数'),'days'],[L2('90d Deposit','90天存款'),'dep'],[L2('Last Contact','最后联系'),'contact'],[L2('Reason','原因')],[L2('Actions','操作')]].map(([h,key])=>{const on=key&&pSortKey===key;return<th key={h} style={{...s.th,...(key?{cursor:'pointer',userSelect:'none'}:{}),...(on?{color:'var(--accent)'}:{})}} title={key?(key==='call'?L2('Click for call order','点击恢复通话顺序'):L2('Click to sort, click again to reverse','点击排序，再点一次反向')):undefined} onClick={key?()=>clickPSort(key):undefined}>{h}{key&&<span style={{marginLeft:4,opacity:on?1:.4}}>{on&&key!=='call'?(pSortDir==='desc'?'▼':'▲'):on?'▲':'↕'}</span>}</th>})}</tr></thead>
        <tbody>{pRows.map((v,rowIdx)=><tr key={v.id} style={{opacity:v.recent?.6:1}}>
          <td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td>
          <td style={s.td}><span style={{...s.badge,background:PRIORITY_COLOR[v.level],color:'#fff'}}>{v.level}</span><div style={{fontSize:11,color:'var(--muted)',marginTop:3,whiteSpace:'nowrap'}}>{L2(v.activity_status,STATUS_ZH[v.activity_status]||v.activity_status)}</div></td>
          <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}<CopyBtn text={v.username} /></button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span><PlayerName name={v.full_name}/></td>
          <td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier):v.tier}</td>
          <td style={s.td}>{v.host||'—'}</td>
          <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}<CopyBtn text={v.whatsapp||v.phone} kind="phone" /></td>
          <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_since_deposit!=null?v.days_since_deposit+L2('d','天'):L2('180d+','180天+')}<LastBet date={v.last_bet_date} status={v.activity_status}/></td>
          <td style={{...s.td,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{formatMoney(v.dep_90d,v.currency)}</td>
          <td style={s.td}>{v.last_contact?new Date(v.last_contact).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}
            {v.recent&&<div style={{fontSize:11,color:'#3fb950',marginTop:2,whiteSpace:'nowrap'}}>{L2('Just contacted','刚联系过')}</div>}
            {v.unreachable&&<div style={{fontSize:11,color:'#d29922',marginTop:2,whiteSpace:'nowrap'}}>{L2(`No reply ×${v.attempts}, try a call`,`${v.attempts}次未回复，试试打电话`)}</div>}
          </td>
          <td style={{...s.td,maxWidth:240,fontSize:12}}>
            {v.player_type && (
              <div style={{display:'inline-flex',alignItems:'center',gap:4,background:'rgba(139,92,246,.12)',border:'1px solid rgba(139,92,246,.3)',borderRadius:8,padding:'2px 8px',marginBottom:4,fontSize:11,fontWeight:700,color:'#a78bfa'}}>
                {v.player_type_icon||'🎮'} {v.player_type}
              </div>
            )}
            <div style={{color:'var(--muted)',lineHeight:1.4}}>
              {v.reasons.map(r=>L2(r.en,r.zh)).join(' • ')}
            </div>
            {v.offer_recommendation && (
              <div style={{marginTop:3,fontSize:10,color:'#34D399',fontWeight:600}}>💡 {v.offer_recommendation}</div>
            )}
          </td>
          <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            <button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal(v)}>💬 WA</button>
            <button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>
            {canReactivate(v)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}{bonusBtn(v)}
          </div></td>
        </tr>)}
        {!pRows.length&&<tr><td colSpan="11" style={{...s.td,textAlign:'center'}}>{L2('No players at this priority.','这个优先级没有玩家。')}</td></tr>}
        </tbody></table></div>
      </>}</div>}
      {tab==='nodeposit'&&(()=>{
        const isDates=ndRange.startsWith('date:')
        const [,ndFrom='',ndTo='']=isDates?ndRange.split(':'):[]
        const setDates=(from,to)=>setNdRange(from||to?`date:${from}:${to}`:'3-6')
        const [sortKey,sortDir]=ndSort.split(':')
        const clickSort=key=>setNdSort(`${key}:${sortKey===key?(sortDir==='desc'?'asc':'desc'):ND_SORT[key].first}`)
        const base=vips.filter(v=>v.last_deposit_date&&v.days_inactive!=null&&(ndTier==='ALL'||v.tier===ndTier)&&(ndHost==='ALL'||v.host_assigned===ndHost)&&(!mineOnly||v.host_assigned===myName))
        const inRange=([,min,max])=>v=>v.days_inactive>=min&&v.days_inactive<=max
        const range=ND_RANGES.find(r=>r[0]===ndRange)||ND_RANGES[0]
        const rows=base.filter(isDates?v=>(!ndFrom||v.last_deposit_date>=ndFrom)&&(!ndTo||v.last_deposit_date<=ndTo):inRange(range)).map(v=>({...v,dep_90d:dep90By[v.username],cost:costInfo?.costs?.[v.username]}))
        if(ND_SORT[sortKey]){const get=ND_SORT[sortKey].get,dir=sortDir==='desc'?-1:1;rows.sort((a,b)=>{const x=get(a),y=get(b);return(x<y?-1:x>y?1:0)*dir})}
        const hosts=[...new Set(vips.filter(v=>v.host_assigned).map(v=>v.host_assigned))].sort()
        const fmtDate=d=>d?new Date(d).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):null
        return <div>
          <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
            {ND_RANGES.map(r=>{const on=!isDates&&range[0]===r[0];return<button key={r[0]} style={{...s.btnSm,fontWeight:700,background:on?'var(--accent)':'var(--surface2)',color:on?'#fff':'var(--text)'}} onClick={()=>setNdRange(r[0])}>{r[0]}{L2(' days','天')} ({base.filter(inRange(r)).length})</button>})}
            <span style={{width:1,alignSelf:'stretch',background:'var(--border)',margin:'0 4px'}}/>
            <span style={{fontSize:12,color:'var(--muted)'}}>{L2('Last deposit from','最后存款从')}</span>
            <input type="date" aria-label={L2('Last deposit from','最后存款从')} style={{...s.input,width:'auto',padding:'4px 8px',fontSize:12,borderColor:isDates?'var(--accent)':'var(--border)'}} value={ndFrom} onChange={e=>setDates(e.target.value,ndTo)}/>
            <span style={{fontSize:12,color:'var(--muted)'}}>{L2('to','到')}</span>
            <input type="date" aria-label={L2('Last deposit to','最后存款到')} style={{...s.input,width:'auto',padding:'4px 8px',fontSize:12,borderColor:isDates?'var(--accent)':'var(--border)'}} value={ndTo} onChange={e=>setDates(ndFrom,e.target.value)}/>
            {isDates&&<button style={s.btnSm} onClick={()=>setNdRange('3-6')}>{L2('Clear dates','清除日期')}</button>}
          </div>
          <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
            <select aria-label={L2('Tier','等级')} value={ndTier} onChange={e=>setNdTier(e.target.value)} style={s.sel}><option value="ALL">{L2('All Tiers','全部等级')}</option>{TIER_ORDER.map(x=><option key={x} value={x}>{lang==='zh'?(TIER_ZH[x]||x):x}</option>)}</select>
            <select aria-label={L2('Host','负责人')} value={ndHost} onChange={e=>setNdHost(e.target.value)} style={s.sel}><option value="ALL">{L2('All hosts','全部负责人')}</option>{hosts.map(h=><option key={h} value={h}>{h}</option>)}</select>
            <label style={{display:'flex',gap:6,fontSize:12,alignItems:'center',color:'var(--text)',marginLeft:'auto',cursor:'pointer'}}><input type="checkbox" checked={mineOnly} onChange={e=>setMineOnly(e.target.checked)}/>{L2('Mine only','仅我的')}</label>
          </div>
          {(()=>{const pick=rows.filter(canBonus);return pick.length>0&&<div style={{display:'flex',gap:8,padding:'8px 14px',alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid var(--border)',background:wbSel.size?'rgba(168,85,247,.08)':'transparent'}}><span style={{fontSize:12,color:'var(--muted)'}}>{L2('Tick Churn / Dormant players to give the same win-back bonus to all of them.','勾选流失 / 休眠玩家，一次发放相同的召回奖金。')}</span>{wbSel.size>0&&<><button style={{...s.btnSm,background:'#a855f7',color:'#fff',border:0,fontWeight:700,fontSize:12}} onClick={()=>setWbModal(vips.filter(v=>wbSel.has(v.username)))}>{L2(`🎁 Give bonus to ${wbSel.size} selected`,`🎁 给已选 ${wbSel.size} 位发奖金`)}</button><button style={{...s.btnSm,background:'#2f81f7',color:'#fff',border:0,fontWeight:700,fontSize:12}} onClick={()=>setEmailModal(vips.filter(v=>wbSel.has(v.username)))}>{L2(`📧 Email ${wbSel.size} selected`,`📧 给已选 ${wbSel.size} 位发邮件`)}</button><button style={s.btnSm} onClick={()=>setWbSel(new Set())}>{L2('Clear','清除')}</button></>}</div>})()}
          <ListCount total={rows.length} label="VIPs" labelZh="位VIP" />
          <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{(()=>{const pick=rows.filter(canBonus);const all=pick.length>0&&pick.every(v=>wbSel.has(v.username));return<th style={{...s.th,width:28}}>{pick.length>0&&<input type="checkbox" title={L2('Select all Churn / Dormant players in this list','全选此列表中的流失 / 休眠玩家')} checked={all} onChange={e=>setWbSel(prev=>{const n=new Set(prev);pick.forEach(v=>e.target.checked?n.add(v.username):n.delete(v.username));return n})}/>}</th>})()}{[['#'],[L2('Player','玩家'),'username'],[L2('Tier','等级'),'tier'],[L2('Host','负责人'),'host'],[L2('Phone / WA','电话 / WA')],[L2('Status','状态')],[L2('Days','天数'),'days'],[L2('Last Deposit','最后存款')],[L2('Last Bet','最后投注'),'bet'],[L2('90d Deposit','90天存款'),'dep'],[L2('Cost so far','累计成本'),'cost'],[L2('Last Contact','最后联系'),'contact'],[L2('Actions','操作')]].map(([h,key])=>{const on=key&&sortKey===key;return<th key={h} style={{...s.th,...(key?{cursor:'pointer',userSelect:'none'}:{}),...(on?{color:'var(--accent)'}:{})}} title={key?L2('Click to sort, click again to reverse','点击排序，再点一次反向'):undefined} onClick={key?()=>clickSort(key):undefined}>{h}{key&&<span style={{marginLeft:4,opacity:on?1:.4}}>{on?(sortDir==='desc'?'▼':'▲'):'↕'}</span>}</th>})}</tr></thead>
          <tbody>{rows.map((v,rowIdx)=><tr key={v.id}>
            <td style={{...s.td,width:28}}>{canBonus(v)&&<input type="checkbox" checked={wbSel.has(v.username)} onChange={e=>setWbSel(prev=>{const n=new Set(prev);e.target.checked?n.add(v.username):n.delete(v.username);return n})}/>}</td>
            <td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td>
            <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><CopyBtn text={v.username} /></span><PlayerName name={v.full_name}/></td>
            <td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier):v.tier}</td>
            <td style={s.td}>{v.host_assigned||'—'}</td>
            <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}<CopyBtn text={v.whatsapp||v.phone} kind="phone" /></td>
            <td style={{...s.td,fontWeight:700,fontSize:12,whiteSpace:'nowrap',color:ND_STATUS_COLOR[v.activity_status]||'var(--muted)'}}>{L2(v.activity_status,v.activity_status==='Active'?'活跃':STATUS_ZH[v.activity_status]||v.activity_status)}</td>
            <td style={{...s.td,fontVariantNumeric:'tabular-nums',fontWeight:700}}>{v.days_inactive}{L2('d','天')}</td>
            <td style={{...s.td,whiteSpace:'nowrap'}}>{fmtDate(v.last_deposit_date)}</td>
            <td style={{...s.td,whiteSpace:'nowrap'}}>{fmtDate(v.last_bet_date)||'—'}</td>
            <td style={{...s.td,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{v.dep_90d!=null?formatMoney(v.dep_90d,v.currency):'—'}</td>
            <td style={{...s.td,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}} title={v.cost?[[L2('Bonus','奖金'),v.cost.bonus],[L2('Rebate','返水'),v.cost.rebate],[L2('Campaign rewards','活动奖励'),v.cost.campaign],[L2('BO bonus (angpow, birthday…)','后台红包（红包、生日…）'),v.cost.boBonus],[L2('Department spending','部门开销'),v.cost.spend]].map(([k,x])=>`${k}: ${formatMoney(x,v.currency)}`).join('\n'):undefined}>{costInfo?.loading?<span style={{color:'var(--muted)'}}>…</span>:v.cost?<><div style={{fontWeight:700,color:'#f0883e'}}>{formatMoney(v.cost.total,v.currency)}</div><div style={{fontSize:10,color:'var(--muted)'}}>{[[L2('B','奖'),v.cost.bonus+v.cost.boBonus],[L2('R','返'),v.cost.rebate],[L2('C','活'),v.cost.campaign],[L2('S','开'),v.cost.spend]].filter(([,x])=>x>0).map(([k,x])=>`${k} ${Math.round(x).toLocaleString('en-MY')}`).join(' · ')}</div></>:'—'}</td>
            <td style={{...s.td,whiteSpace:'nowrap'}}>{fmtDate(v.last_contacted)||L2('Never','从未')}</td>
            <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,days_since_deposit:v.days_inactive})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{canReactivate(v)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}{bonusBtn(v)}{v.email&&profile?.role!=='readonly'&&<button style={{...s.btnSm,background:'#2f81f7',color:'#fff',border:0,fontWeight:700}} title={v.email} onClick={()=>setEmailModal([v])}>📧 {L2('Email','邮件')}</button>}</div></td>
          </tr>)}{!rows.length&&<tr><td colSpan="14" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{loading?L2('Loading…','载入中…'):L2('No players match these filters.','没有符合筛选条件的玩家。')}</td></tr>}</tbody></table></div>
          <div style={{padding:'8px 14px',fontSize:11,color:'var(--muted)',lineHeight:1.5}}>{L2('Cost so far = bonus + rebate (daily report, since Jun 2026) + paid campaign rewards + BO bonuses (angpow, birthday, check-in) + department spending tagged to the player (vouchers, service fees, gifts). Small line: B bonus · R rebate · C campaign · S spending. Hover the amount for the full breakdown. Each player in their own currency.','累计成本 = 奖金 + 返水（每日报表，2026年6月起）+ 已派活动奖励 + 后台红包（红包、生日、签到）+ 记在该玩家名下的部门开销（礼券、服务费、礼物）。小字：奖 奖金 · 返 返水 · 活 活动 · 开 开销。鼠标停在金额上看明细。每位玩家按自己的货币。')}{costInfo?.missing?.length>0&&<span style={{color:'#d29922'}}> {L2(`⚠️ Could not read: ${costInfo.missing.join(', ')} (not included).`,`⚠️ 无法读取：${costInfo.missing.join('、')}（未计入）。`)}</span>}</div>
        </div>
      })()}
      {tab==='reactivated'&&<ListCount total={reactRows.length} label="VIPs" labelZh="位VIP" />}
      {tab==='reactivated'&&<div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Recovery','召回存款'),L2('Currency','货币'),L2('Notes','备注')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{reactRows.map((v,rowIdx)=><tr key={v.username}><td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td><td style={s.td}>{v.username}<CopyBtn text={v.username} /><PlayerName name={vips.find(m=>m.username===v.username)?.full_name}/></td><td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier||'—'):(v.tier||'—')}</td><td style={s.td}>{v.host_name||'—'}</td><td style={s.td}>{formatMoney(v.reactivation_deposit||0,v.currency||'')}</td><td style={s.td}>{v.currency||'—'}</td><td style={s.td}>{v.notes||'—'}</td></tr>)}{!reactRows.length&&<tr><td colSpan="7" style={{...s.td,textAlign:'center'}}>{L2('No reactivated VIPs for this month.','本月没有召回的VIP。')}</td></tr>}</tbody></table></div>}
      {tab==='churn'&&(()=>{const churnVips=vips.filter(v=>v.churn_risk==='HIGH'||v.churn_risk==='MEDIUM').sort((a,b)=>(a.churn_risk==='HIGH'?0:1)-(b.churn_risk==='HIGH'?0:1)||(b.days_inactive||0)-(a.days_inactive||0));return<div><ListCount total={churnVips.length} label="VIPs" labelZh="位VIP" /><div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Phone / WA','电话 / WA'),L2('Risk','风险'),L2('Days Inactive','不活跃天数'),L2('Last Deposit','最后存款'),L2('Last Contact','最后联系'),L2('Actions','操作')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{churnVips.map((v,rowIdx)=><tr key={v.id}><td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td><td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}<CopyBtn text={v.username} /></button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span><PlayerName name={v.full_name}/></td><td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier):v.tier}</td><td style={s.td}>{v.host_assigned||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}<CopyBtn text={v.whatsapp||v.phone} kind="phone" /></td><td style={s.td}><span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.churn_risk]||'transparent',color:RISK_COLOR[v.churn_risk]||'var(--muted)'}}>{L2(v.churn_risk,RISK_ZH[v.churn_risk]||v.churn_risk)}</span></td><td style={{...s.td,fontVariantNumeric:'tabular-nums',color:'#f85149',fontWeight:700}}>{v.days_inactive||0}{L2('d','天')}</td><td style={s.td}>{v.last_deposit_date||'—'}<LastBet date={v.last_bet_date} status={v.activity_status}/></td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td><td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[v.churn_risk==='HIGH'?'HIGH churn risk':'MEDIUM churn risk'],days_since_deposit:v.days_inactive})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{canReactivate(v)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}{bonusBtn(v)}</div></td></tr>)}{!churnVips.length&&<tr><td colSpan="10" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No high/medium risk VIPs at this time.','目前没有高/中风险VIP。')}</td></tr>}</tbody></table></div></div>})()}
      {tab==='dormant'&&(()=>{const dormVips=vips.filter(v=>v.activity_status==='Dormant'&&(v.days_inactive||0)>=dormantDays&&(dormantTierF==='ALL'||v.tier===dormantTierF)).sort((a,b)=>(b.days_inactive||0)-(a.days_inactive||0));return<div><div style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}><select value={dormantTierF} onChange={e=>setDormantTierF(e.target.value)} style={s.sel}><option value="ALL">{L2('All Tiers','全部等级')}</option>{['DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(t=><option key={t} value={t}>{L2(t,TIER_ZH[t])}</option>)}</select><label style={{display:'flex',gap:6,fontSize:12,alignItems:'center',color:'var(--text)'}}>{L2('Inactive ≥','不活跃 ≥')}<input type="number" min={1} value={dormantDays} onChange={e=>setDormantDays(Number(e.target.value))} style={{...s.sel,width:70,padding:'5px 8px',fontSize:12}} /> {L2('days','天')}</label><span style={{fontSize:12,color:'var(--muted)'}}>{L2(`${dormVips.length} players`,`${dormVips.length} 位玩家`)}</span></div><div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Phone / WA','电话 / WA'),L2('Days Inactive','不活跃天数'),L2('Last Deposit','最后存款'),L2('Last Contact','最后联系'),L2('Actions','操作')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{dormVips.map((v,rowIdx)=><tr key={v.id}><td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td><td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}<CopyBtn text={v.username} /></button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span><PlayerName name={v.full_name}/></td><td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier):v.tier}</td><td style={s.td}>{v.host_assigned||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}<CopyBtn text={v.whatsapp||v.phone} kind="phone" /></td><td style={{...s.td,fontVariantNumeric:'tabular-nums',color:'#f85149',fontWeight:700}}>{v.days_inactive||0}{L2('d','天')}</td><td style={s.td}>{v.last_deposit_date||'—'}<LastBet date={v.last_bet_date} status={v.activity_status}/></td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td><td style={s.td}><div style={{display:'flex',gap:5}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`Dormant ${v.days_inactive||0} days`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{bonusBtn(v)}</div></td></tr>)}{!dormVips.length&&<tr><td colSpan="9" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No dormant VIPs match the threshold.','没有符合门槛的休眠VIP。')}</td></tr>}</tbody></table></div></div>})()}
      {tab==='winback'&&<WinbackReport market={mktF} reloadKey={wbReload}/>}
      {tab==='diamond'&&(()=>{
        const allDHosts=[...new Set(vips.filter(v=>v.tier==='DIAMOND'&&v.host_assigned).map(v=>v.host_assigned))].sort()
        const allD=vips.filter(v=>v.tier==='DIAMOND'&&(dHostF==='ALL'||v.host_assigned===dHostF))
        const dVips=allD.filter(v=>!dUncontactedOnly||!contactedSet.has(String(v.username||'').toLowerCase())).sort((a,b)=>Number(contactedSet.has(String(a.username||'').toLowerCase()))-Number(contactedSet.has(String(b.username||'').toLowerCase()))||(b.days_inactive||0)-(a.days_inactive||0))
        const dContacted=allD.filter(v=>contactedSet.has(String(v.username||'').toLowerCase())).length
        const dNotYet=allD.length-dContacted
        return(<div>
          <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {['ALL',...allDHosts].map(h=><button key={h} style={{...s.btnSm,background:dHostF===h?'var(--accent)':'var(--surface2)',color:dHostF===h?'#fff':'var(--text)'}} onClick={()=>setDHostF(h)}>{h==='ALL'?L2(`All (${allD.length})`,`全部 (${allD.length})`):h}</button>)}
            </div>
            <button style={{...s.btnSm,background:dUncontactedOnly?'#f85149':'var(--surface2)',color:dUncontactedOnly?'#fff':'var(--text)',border:dUncontactedOnly?'1px solid #f85149':'1px solid var(--border)'}} onClick={()=>setDUncontactedOnly(v=>!v)}>{L2('❌ Not contacted only','❌ 仅未联系')}</button>
            <div style={{marginLeft:'auto',display:'flex',gap:12,fontSize:12,alignItems:'center'}}>
              <span style={{color:'#3fb950',fontWeight:700}}>✅ {dContacted} {L2('contacted','已联系')}</span>
              <span style={{color:'#f85149',fontWeight:700}}>❌ {dNotYet} {L2('not yet','未联系')}</span>
              <span style={{color:'var(--muted)'}}>{L2(MONTHS[month],`${month+1}月`)}: {allD.length?Math.round(dContacted/allD.length*100):0}%</span>
            </div>
          </div>
          <ListCount total={dVips.length} label="VIPs" labelZh="位VIP" />
          <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Host','负责人'),L2('Phone / WA','电话 / WA'),L2('Risk','风险'),L2('Days Inactive','不活跃天数'),L2('Last Deposit','最后存款'),L2('Last Contact','最后联系'),L2('This Month','本月'),L2('Actions','操作')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{dVips.map((v,rowIdx)=>{const isC=contactedSet.has(String(v.username||'').toLowerCase());return(
              <tr key={v.id}>
                <td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td>
                <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}<CopyBtn text={v.username} /></button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span><PlayerName name={v.full_name}/></td>
                <td style={s.td}>{v.host_assigned||'—'}</td>
                <td style={{...s.td,fontSize:12}}>{v.whatsapp||v.phone?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{color:'var(--muted)'}}>{v.whatsapp||v.phone}<CopyBtn text={v.whatsapp||v.phone} kind="phone" /></span><button title={L2('Copy number','复制号码')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText((v.whatsapp||v.phone).replace(/\D/g,''))}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:11,padding:'0 2px',opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span>:'—'}</td>
                <td style={s.td}>{v.risk_level?<span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.risk_level]||'transparent',color:RISK_COLOR[v.risk_level]||'var(--muted)'}}>{L2(v.risk_level,RISK_ZH[v.risk_level]||v.risk_level)}</span>:'—'}</td>
                <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_inactive||0}{L2('d','天')}</td>
                <td style={s.td}>{v.last_deposit_date||'—'}<LastBet date={v.last_bet_date} status={v.activity_status}/></td>
                <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td>
                <td style={s.td}><span style={{fontSize:12,fontWeight:700,color:isC?'#3fb950':'#f85149'}}>{isC?L2('✅ Done','✅ 已完成'):L2('❌ Not yet','❌ 未联系')}</span></td>
                <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`${v.tier} monthly follow-up`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{canReactivate(v)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}{bonusBtn(v)}</div></td>
              </tr>
            )})}
            {!dVips.length&&<tr><td colSpan="10" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No Diamond VIPs match the filter.','没有符合筛选的钻石VIP。')}</td></tr>}
            </tbody></table></div>
        </div>)
      })()}
      {tab==='platinum'&&(()=>{
        const allPHosts=[...new Set(vips.filter(v=>v.tier==='PLATINUM'&&v.host_assigned).map(v=>v.host_assigned))].sort()
        const allP=vips.filter(v=>v.tier==='PLATINUM'&&(pHostF==='ALL'||v.host_assigned===pHostF))
        const pVips=allP.filter(v=>!pUncontactedOnly||!contactedSet.has(String(v.username||'').toLowerCase())).sort((a,b)=>Number(contactedSet.has(String(a.username||'').toLowerCase()))-Number(contactedSet.has(String(b.username||'').toLowerCase()))||(b.days_inactive||0)-(a.days_inactive||0))
        const pContacted=allP.filter(v=>contactedSet.has(String(v.username||'').toLowerCase())).length
        const pNotYet=allP.length-pContacted
        return(<div>
          <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {['ALL',...allPHosts].map(h=><button key={h} style={{...s.btnSm,background:pHostF===h?'var(--accent)':'var(--surface2)',color:pHostF===h?'#fff':'var(--text)'}} onClick={()=>setPHostF(h)}>{h==='ALL'?L2(`All (${allP.length})`,`全部 (${allP.length})`):h}</button>)}
            </div>
            <button style={{...s.btnSm,background:pUncontactedOnly?'#f85149':'var(--surface2)',color:pUncontactedOnly?'#fff':'var(--text)',border:pUncontactedOnly?'1px solid #f85149':'1px solid var(--border)'}} onClick={()=>setPUncontactedOnly(v=>!v)}>{L2('❌ Not contacted only','❌ 仅未联系')}</button>
            <div style={{marginLeft:'auto',display:'flex',gap:12,fontSize:12,alignItems:'center'}}>
              <span style={{color:'#3fb950',fontWeight:700}}>✅ {pContacted} {L2('contacted','已联系')}</span>
              <span style={{color:'#f85149',fontWeight:700}}>❌ {pNotYet} {L2('not yet','未联系')}</span>
              <span style={{color:'var(--muted)'}}>{L2(MONTHS[month],`${month+1}月`)}: {allP.length?Math.round(pContacted/allP.length*100):0}%</span>
            </div>
          </div>
          <ListCount total={pVips.length} label="VIPs" labelZh="位VIP" />
          <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Host','负责人'),L2('Phone / WA','电话 / WA'),L2('Risk','风险'),L2('Days Inactive','不活跃天数'),L2('Last Deposit','最后存款'),L2('Last Contact','最后联系'),L2('This Month','本月'),L2('Actions','操作')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{pVips.map((v,rowIdx)=>{const isC=contactedSet.has(String(v.username||'').toLowerCase());return(
              <tr key={v.id}>
                <td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td>
                <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}<CopyBtn text={v.username} /></button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span><PlayerName name={v.full_name}/></td>
                <td style={s.td}>{v.host_assigned||'—'}</td>
                <td style={{...s.td,fontSize:12}}>{v.whatsapp||v.phone?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{color:'var(--muted)'}}>{v.whatsapp||v.phone}<CopyBtn text={v.whatsapp||v.phone} kind="phone" /></span><button title={L2('Copy number','复制号码')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText((v.whatsapp||v.phone).replace(/\D/g,''))}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:11,padding:'0 2px',opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span>:'—'}</td>
                <td style={s.td}>{v.risk_level?<span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.risk_level]||'transparent',color:RISK_COLOR[v.risk_level]||'var(--muted)'}}>{L2(v.risk_level,RISK_ZH[v.risk_level]||v.risk_level)}</span>:'—'}</td>
                <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_inactive||0}{L2('d','天')}</td>
                <td style={s.td}>{v.last_deposit_date||'—'}<LastBet date={v.last_bet_date} status={v.activity_status}/></td>
                <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td>
                <td style={s.td}><span style={{fontSize:12,fontWeight:700,color:isC?'#3fb950':'#f85149'}}>{isC?L2('✅ Done','✅ 已完成'):L2('❌ Not yet','❌ 未联系')}</span></td>
                <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`${v.tier} monthly follow-up`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{canReactivate(v)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}{bonusBtn(v)}</div></td>
              </tr>
            )})}
            {!pVips.length&&<tr><td colSpan="10" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No Platinum VIPs match the filter.','没有符合筛选的白金VIP。')}</td></tr>}
            </tbody></table></div>
        </div>)
      })()}
      {tab==='gold'&&(()=>{
        const allGHosts=[...new Set(vips.filter(v=>v.tier==='GOLD'&&v.host_assigned).map(v=>v.host_assigned))].sort()
        const allG=vips.filter(v=>v.tier==='GOLD'&&(gHostF==='ALL'||v.host_assigned===gHostF))
        const gVips=allG.filter(v=>!gUncontactedOnly||!contactedSet.has(String(v.username||'').toLowerCase())).sort((a,b)=>Number(contactedSet.has(String(a.username||'').toLowerCase()))-Number(contactedSet.has(String(b.username||'').toLowerCase()))||(b.days_inactive||0)-(a.days_inactive||0))
        const gContacted=allG.filter(v=>contactedSet.has(String(v.username||'').toLowerCase())).length
        const gNotYet=allG.length-gContacted
        return(<div>
          <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {['ALL',...allGHosts].map(h=><button key={h} style={{...s.btnSm,background:gHostF===h?'var(--accent)':'var(--surface2)',color:gHostF===h?'#fff':'var(--text)'}} onClick={()=>setGHostF(h)}>{h==='ALL'?L2(`All (${allG.length})`,`全部 (${allG.length})`):h}</button>)}
            </div>
            <button style={{...s.btnSm,background:gUncontactedOnly?'#f85149':'var(--surface2)',color:gUncontactedOnly?'#fff':'var(--text)',border:gUncontactedOnly?'1px solid #f85149':'1px solid var(--border)'}} onClick={()=>setGUncontactedOnly(v=>!v)}>{L2('❌ Not contacted only','❌ 仅未联系')}</button>
            <div style={{marginLeft:'auto',display:'flex',gap:12,fontSize:12,alignItems:'center'}}>
              <span style={{color:'#3fb950',fontWeight:700}}>✅ {gContacted} {L2('contacted','已联系')}</span>
              <span style={{color:'#f85149',fontWeight:700}}>❌ {gNotYet} {L2('not yet','未联系')}</span>
              <span style={{color:'var(--muted)'}}>{L2(MONTHS[month],`${month+1}月`)}: {allG.length?Math.round(gContacted/allG.length*100):0}%</span>
            </div>
          </div>
          <ListCount total={gVips.length} label="VIPs" labelZh="位VIP" />
          <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Host','负责人'),L2('Phone / WA','电话 / WA'),L2('Risk','风险'),L2('Days Inactive','不活跃天数'),L2('Last Deposit','最后存款'),L2('Last Contact','最后联系'),L2('This Month','本月'),L2('Actions','操作')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{gVips.map((v,rowIdx)=>{const isC=contactedSet.has(String(v.username||'').toLowerCase());return(
              <tr key={v.id}>
                <td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td>
                <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}<CopyBtn text={v.username} /></button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span><PlayerName name={v.full_name}/></td>
                <td style={s.td}>{v.host_assigned||'—'}</td>
                <td style={{...s.td,fontSize:12}}>{v.whatsapp||v.phone?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{color:'var(--muted)'}}>{v.whatsapp||v.phone}<CopyBtn text={v.whatsapp||v.phone} kind="phone" /></span><button title={L2('Copy number','复制号码')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText((v.whatsapp||v.phone).replace(/\D/g,''))}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:11,padding:'0 2px',opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span>:'—'}</td>
                <td style={s.td}>{v.risk_level?<span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.risk_level]||'transparent',color:RISK_COLOR[v.risk_level]||'var(--muted)'}}>{L2(v.risk_level,RISK_ZH[v.risk_level]||v.risk_level)}</span>:'—'}</td>
                <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_inactive||0}{L2('d','天')}</td>
                <td style={s.td}>{v.last_deposit_date||'—'}<LastBet date={v.last_bet_date} status={v.activity_status}/></td>
                <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td>
                <td style={s.td}><span style={{fontSize:12,fontWeight:700,color:isC?'#3fb950':'#f85149'}}>{isC?L2('✅ Done','✅ 已完成'):L2('❌ Not yet','❌ 未联系')}</span></td>
                <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`${v.tier} monthly follow-up`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{canReactivate(v)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}{bonusBtn(v)}</div></td>
              </tr>
            )})}
            {!gVips.length&&<tr><td colSpan="10" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No Gold VIPs match the filter.','没有符合筛选的黄金VIP。')}</td></tr>}
            </tbody></table></div>
        </div>)
      })()}
    </div>
    {reactivateModal&&<ReactivateModal vip={reactivateModal} month={monthStr} onClose={()=>setReactivateModal(null)} onSaved={loadAll}/>}
    {emailModal&&<EmailModal players={emailModal} onClose={()=>setEmailModal(null)} onSent={()=>loadAll()}/>}
    {wbModal&&<WinbackBonusModal players={wbModal} onClose={()=>setWbModal(null)} onSaved={msg=>{setWbSel(new Set());setWbReload(x=>x+1);loadAll();loadPriorityContacts();if(msg)alert(msg)}}/>}
    {churnWaModal&&<WaSenderModal vip={churnWaModal} myName={myName||'Agent'} purpose={churnWaModal.deposit_drop?'decline':undefined} onClose={()=>setChurnWaModal(null)} onLogged={async()=>{loadPriorityContacts();const cl=await fetchAll(()=>supabase.from('contact_logs').select('username').eq('log_month',monthStr).order('username'));setContactedSet(new Set(cl.map(l=>String(l.username||'').toLowerCase())))}}/>}
  </div>
}