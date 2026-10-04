// ChurnAlerts v2 — with reactivation tracking + monthly stats
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, MONTHS } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamNumber, useUrlParamBool, useUrlParamsRaw } from '../hooks/useUrlParam'
import { getRetentionTierRank, isFollowUpDue, calculateChurnUrgency } from '../lib/retention'

const RISK_COLOR = { HIGH:'#f85149', MEDIUM:'#d29922', LOW:'#3fb950' }
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

function StatCard({ icon, label, value, color, sub }) { return (<div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}><div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>{icon} {label}</div><div style={{ fontSize:28, fontWeight:800, color: color||'var(--text)' }}>{value}</div>{sub && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{sub}</div>}</div>) }

function ReactivateModal({ vip, month, onClose, onSaved }) {
  const { profile } = useAuth(); const { t } = useLanguage()
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

function ChurnWaModal({ player, agentName, onClose }) {
  const [lang, setLang] = useState('en')
  const [copied, setCopied] = useState(false)
  const rawNumber = (player.whatsapp && player.whatsapp.replace(/\D/g,'').length >= 10)
    ? player.whatsapp : (player.phone && player.phone.replace(/\D/g,'').length >= 10)
    ? player.phone : ''
  const waNumber = rawNumber.replace(/\D/g,'')
  const displayNum = player.whatsapp || player.phone || '—'
  const hasDecline = (player.reasons || []).some(r => /decline|drop|churned/i.test(r))
  const daysSince = player.days_since_deposit ?? player.days_inactive ?? 0
  const templates = {
    en: {
      reactivate: `Hi *${player.username}*! 👋\n\nThis is ${agentName} from the VIP team. We noticed you haven't been active recently${daysSince ? ` (${daysSince} days)` : ''} and we miss having you with us!\n\nAs a valued *${player.tier}* member, we want to make sure you're getting the best experience. Is there anything we can help with or any special offer we can arrange for your return?\n\nWe're here for you! 🎰✨`,
      decline: `Hi *${player.username}*! 👋\n\nThis is ${agentName} from the VIP team. We noticed your recent activity has been lower than usual and wanted to check in on you.\n\nAs our valued *${player.tier}* member, your satisfaction is our priority. We have some exclusive offers available just for you — would you like to hear about them?\n\nFeel free to reach out anytime! 💎`,
    },
    cn: {
      reactivate: `你好 *${player.username}*！👋\n\n我是 ${agentName}，来自VIP团队。我们注意到您${daysSince ? `已有 ${daysSince} 天` : '最近'}没有活动，非常想念您！\n\n作为我们尊贵的 *${player.tier}* 会员，我们希望确保您获得最佳体验。有什么我们可以帮助您的，或者有什么特别优惠可以为您的回归安排吗？\n\n我们随时为您服务！🎰✨`,
      decline: `你好 *${player.username}*！👋\n\n我是 ${agentName}，来自VIP团队。我们注意到您最近的活动有所减少，特来关心您。\n\n作为我们尊贵的 *${player.tier}* 会员，您的满意是我们的首要任务。我们有一些专属优惠，您是否有兴趣了解？\n\n随时欢迎联系我们！💎`,
    }
  }
  const msgType = hasDecline ? 'decline' : 'reactivate'
  const message = templates[lang][msgType]
  const waLink = waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}` : null
  function handleCopy() { navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return <div style={s.modal} onClick={onClose}><div style={{...s.mBox, width:520}} onClick={e=>e.stopPropagation()}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
      <div><div style={{fontSize:16,fontWeight:700}}>💬 WhatsApp — {player.username}</div>
      <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{player.tier} · 📱 {displayNum}{daysSince?` · ${daysSince}d inactive`:''}</div></div>
      <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:18,lineHeight:1}}>✕</button>
    </div>
    <div style={{display:'flex',gap:6,marginBottom:12,alignItems:'center'}}>
      {[['en','🇬🇧 EN'],['cn','🇨🇳 CN']].map(([l,label])=><button key={l} style={{...s.btnSm,background:lang===l?'var(--accent)':'var(--surface2)',color:lang===l?'#fff':'var(--text)'}} onClick={()=>setLang(l)}>{label}</button>)}
      <div style={{marginLeft:'auto',fontSize:11,color:'var(--muted)'}}>{hasDecline?'📉 Decline message':'♻️ Reactivation message'}</div>
    </div>
    <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:10,padding:14,fontSize:13,lineHeight:1.65,whiteSpace:'pre-wrap',maxHeight:220,overflowY:'auto',color:'var(--text)',marginBottom:14}}>{message}</div>
    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
      <button style={s.btnSm} onClick={onClose}>Close</button>
      <button style={{...s.btn('#6366f1'),padding:'8px 16px'}} onClick={handleCopy}>{copied?'✅ Copied!':'📋 Copy'}</button>
      {waLink?<a href={waLink} target="_blank" rel="noopener noreferrer" style={{...s.btn('#25D366'),padding:'8px 16px',textDecoration:'none',display:'inline-block'}}>💬 Open WhatsApp</a>:<button style={{...s.btn('#555'),padding:'8px 16px'}} disabled>No WA Number</button>}
    </div>
  </div></div>
}

function SortTh({ col, label, sortCol, sortAsc, onSort, style }) {
  const active = sortCol === col
  return (
    <th onClick={() => onSort(col)} style={{ ...style, cursor: 'pointer', userSelect: 'none' }}>
      {label}{active ? <span style={{ color: 'var(--accent)', fontSize: 10, marginLeft: 3 }}>{sortAsc ? '▲' : '▼'}</span> : <span style={{ opacity: 0.25, fontSize: 10, marginLeft: 3 }}>⇅</span>}
    </th>
  )
}

function applyDateSort(list, col, asc) {
  if (!col) return list
  return [...list].sort((a, b) => {
    const av = a[col], bv = b[col]
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return asc ? av.localeCompare(bv) : bv.localeCompare(av)
  })
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChurnAlerts() {
  const navigate=useNavigate(); const {profile}=useAuth(); const {t}=useLanguage(); const now=new Date()
  const [month,setMonth]=useUrlParamNumber('month',now.getMonth()); const [year,setYear]=useUrlParamNumber('year',now.getFullYear()); const [tab,setTab]=useUrlParam('tab','priority')
  const [priorityList,setPriorityList]=useState([]),[priorityLoading,setPriorityLoading]=useState(true),[vips,setVips]=useState([]),[reactivated,setReactivated]=useState([]),[reactivatedSet,setReactivatedSet]=useState(new Set()),[diamondUncontacted,setDiamondUncontacted]=useState([]),[platinumUncontacted,setPlatinumUncontacted]=useState([]),[dormantList,setDormantList]=useState([]),[dormantDays,setDormantDays]=useUrlParamNumber('dormantDays',30),[dormantTierF,setDormantTierF]=useUrlParam('dormantTier','ALL'),[loading,setLoading]=useState(true),[reactivateModal,setReactivateModal]=useState(null)
  const myName=profile?.full_name||''
  function handleChurnSort(col){ if(churnSortCol===col){setChurnSortAsc(v=>!v)}else{setChurnSortCol(col);setChurnSortAsc(false)} }
  function getWaLink(v){const rawNumber=(v.phone&&v.phone.replace(/\D/g,'').length>=10)?v.phone:(v.whatsapp&&v.whatsapp.replace(/\D/g,'').length>=10)?v.whatsapp:'';if(!rawNumber)return null;const waNumber=rawNumber.replace(/\D/g,'');const greeting=encodeURIComponent(`Hi ${v.username}, this is ${myName||'the VIP department'}.`);return `https://wa.me/${waNumber}?text=${greeting}`}
  function WaButton({v}){const link=getWaLink(v);if(!link)return <span style={{color:'var(--muted)'}}>—</span>;return <a href={link} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',width:26,height:26,borderRadius:13,background:'#25D366',color:'#fff',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,textDecoration:'none'}}>W</a>}
  const [mineOnly,setMineOnly]=useUrlParamBool('mine',false),[riskF,setRiskF]=useUrlParam('risk','ALL'),[tierF,setTierF]=useUrlParam('tier','ALL'),[reactTierF,setReactTierF]=useUrlParam('reactTier','ALL'),[sortCol,setSortCol]=useUrlParam('sort','days_inactive'),[sortAsc,setSortAsc]=useUrlParamBool('asc',false),[stats,setStats]=useState({high:0,medium:0,dormant:0,atRisk:0})
  const [dHostF,setDHostF]=useState('ALL'),[pHostF,setPHostF]=useState('ALL'),[contactedSet,setContactedSet]=useState(new Set()),[dUncontactedOnly,setDUncontactedOnly]=useState(false),[pUncontactedOnly,setPUncontactedOnly]=useState(false)
  const [churnWaModal,setChurnWaModal]=useState(null),[priorityHostF,setPriorityHostF]=useState('ALL'),[churnSortCol,setChurnSortCol]=useState(null),[churnSortAsc,setChurnSortAsc]=useState(false)
  const monthStr=`${year}-${String(month+1).padStart(2,'0')}`

  useEffect(()=>{loadAll()},[riskF,tierF,sortCol,sortAsc,month,year,mineOnly,dormantDays]); useEffect(()=>{loadPriorityContacts()},[])
  async function loadPriorityContacts(){setPriorityLoading(true);try{const today=new Date(),todayStr=today.toISOString().slice(0,10),start14=new Date(today);start14.setDate(start14.getDate()-14);const start14Str=start14.toISOString().slice(0,10),sevenAgo=new Date(today);sevenAgo.setDate(sevenAgo.getDate()-7);const sevenAgoStr=sevenAgo.toISOString().slice(0,10),threeAgo=new Date(today);threeAgo.setDate(threeAgo.getDate()-3);const threeAgoStr=threeAgo.toISOString().slice(0,10);let allSnaps=[],from=0,PAGE=1000;while(true){const{data:page,error}=await supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit,monthly_valid_bet,win_loss').in('tier',['DIAMOND','PLATINUM']).gte('snapshot_date',start14Str).lte('snapshot_date',todayStr).range(from,from+PAGE-1);if(error){console.error('loadPriorityContacts snapshot error',error);break}allSnaps=allSnaps.concat(page||[]);if(!page||page.length<PAGE)break;from+=PAGE}const{data:pdVips,error:vipError}=await supabase.from('vip_members').select('id,username,tier,host_assigned,currency,whatsapp,phone,days_inactive,last_deposit_date').in('tier',['DIAMOND','PLATINUM']).eq('is_excluded',false);if(vipError){console.error('loadPriorityContacts vip error',vipError);setPriorityList([]);return}const contactLogs=[];if((pdVips||[]).length){const{data:logs,error:contactError}=await supabase.from('contact_logs').select('username,logged_at,follow_up_needed,follow_up_date').in('username',(pdVips||[]).map(v=>v.username));if(contactError){console.error('loadPriorityContacts contact log error',contactError)}else contactLogs.push(...(logs||[]))}const latestContact={};contactLogs.forEach(log=>{if(!log?.username||!log?.logged_at)return;const previous=latestContact[log.username];if(!previous||new Date(log.logged_at)>new Date(previous.logged_at))latestContact[log.username]=log});const vipMap={};(pdVips||[]).forEach(v=>{vipMap[v.username]=v});const byUser={};allSnaps.forEach(x=>{if(!byUser[x.username])byUser[x.username]=[];byUser[x.username].push(x)});const results=[];Object.entries(byUser).forEach(([username,rawSnaps])=>{const vip=vipMap[username];if(!vip)return;const snaps=[...rawSnaps].sort((a,b)=>a.snapshot_date.localeCompare(b.snapshot_date));const last7=snaps.filter(x=>x.snapshot_date>=sevenAgoStr&&x.snapshot_date<=todayStr),prev7=snaps.filter(x=>x.snapshot_date<sevenAgoStr),last7Deposit=last7.reduce((sum,x)=>sum+(parseFloat(x.total_deposit)||0),0),prev7Deposit=prev7.reduce((sum,x)=>sum+(parseFloat(x.total_deposit)||0),0),declinePct=prev7Deposit>0?Math.round((last7Deposit-prev7Deposit)/prev7Deposit*100):null,depositDates=snaps.filter(x=>(parseFloat(x.total_deposit)||0)>0).map(x=>x.snapshot_date),lastDepositDate=depositDates.length?depositDates[depositDates.length-1]:null,daysSinceDeposit=lastDepositDate?Math.floor((today-new Date(lastDepositDate))/86400000):null,depletionDays=last7.filter(x=>(parseFloat(x.monthly_valid_bet)||0)>0&&(parseFloat(x.total_deposit)||0)===0).length,last3=snaps.filter(x=>x.snapshot_date>=threeAgoStr&&x.snapshot_date<=todayStr),netWinLoss3d=last3.reduce((sum,x)=>sum+(parseFloat(x.win_loss)||0),0),urgency=calculateChurnUrgency({declinePct,daysSinceDeposit,depletionDays,netWinLoss3d,memberInactiveDays:Number(vip.days_inactive)||0});const reasons=urgency.reasons.map(key=>({deposit_decline:`7-day deposit dropped ${Math.abs(declinePct||0)}% (${formatMoney(prev7Deposit,vip.currency)} → ${formatMoney(last7Deposit,vip.currency)})`,no_recent_deposit:`No deposit for ${daysSinceDeposit} days — may become a churn case soon`,balance_depletion:`Balance running low: bet but didn't deposit on ${depletionDays} day${depletionDays>1?'s':''} in the last 7`,recent_net_loss:`Net loss ${formatMoney(Math.abs(netWinLoss3d),vip.currency)} in 3 days — recommend appeasement`,member_inactive:`No deposit for ${Number(vip.days_inactive)||0} days — may become a churn case soon`}[key]||key));if(reasons.length>0)results.push({id:vip.id,username,tier:vip.tier,currency:vip.currency,host:vip.host_assigned,phone:vip.phone,whatsapp:vip.whatsapp,last_deposit_date:lastDepositDate||vip.last_deposit_date||null,days_since_deposit:daysSinceDeposit??(Number(vip.days_inactive)||0),decline_pct:declinePct,net_win_loss_3d:netWinLoss3d,reasons,urgency_score:urgency.urgencyScore,last_contact:latestContact[username]?.logged_at||null,contacted_today:Boolean(latestContact[username]?.logged_at&&new Date(latestContact[username].logged_at).toISOString().slice(0,10)===todayStr),follow_up_due:isFollowUpDue({lastContact:latestContact[username]?.logged_at||null,contactedToday:Boolean(latestContact[username]?.logged_at&&new Date(latestContact[username].logged_at).toISOString().slice(0,10)===todayStr)},today)})});const existingUsers=new Set(results.map(x=>x.username));(pdVips||[]).forEach(vip=>{if(existingUsers.has(vip.username))return;const inactiveDays=Number(vip.days_inactive)||0;if(inactiveDays<3)return;results.push({id:vip.id,username:vip.username,tier:vip.tier,currency:vip.currency,host:vip.host_assigned,phone:vip.phone,whatsapp:vip.whatsapp,last_deposit_date:vip.last_deposit_date||null,days_since_deposit:inactiveDays,decline_pct:null,net_win_loss_3d:0,reasons:[`No deposit for ${inactiveDays} days — may become a churn case soon`],urgency_score:2,follow_up_due:true,last_contact:null,contacted_today:false})});
  // ── Monthly churn overlay: surface Diamond/Platinum who churned last COMPLETE month ──
  try{const{data:latestMonthRows}=await supabase.from('vip_monthly_totals').select('snapshot_month').in('tier',['DIAMOND','PLATINUM']).order('snapshot_month',{ascending:false}).limit(2);const monthRows=(latestMonthRows||[]).map(r=>r.snapshot_month).filter(Boolean);const[latestM,prevM]=[...new Set(monthRows)];if(latestM&&prevM){const[{data:currRows},{data:prevRows}]=await Promise.all([supabase.from('vip_monthly_totals').select('username,tier,total_deposit,host_assigned,currency').eq('snapshot_month',latestM).in('tier',['DIAMOND','PLATINUM']),supabase.from('vip_monthly_totals').select('username,tier,total_deposit,host_assigned,currency').eq('snapshot_month',prevM).in('tier',['DIAMOND','PLATINUM'])]);const currMap={};(currRows||[]).forEach(r=>{currMap[r.username]=r});const alreadyInResults=new Set(results.map(x=>x.username));(prevRows||[]).forEach(r=>{if(alreadyInResults.has(r.username))return;const prevDep=Number(r.total_deposit)||0;const currDep=Number(currMap[r.username]?.total_deposit)||0;if(prevDep<=0||currDep>0)return;// This player churned: had deposits prevM, zero in latestM
  const vip=vipMap[r.username]||{};const contactedToday=Boolean(latestContact[r.username]?.logged_at&&new Date(latestContact[r.username].logged_at).toISOString().slice(0,10)===todayStr);results.push({id:vip.id||r.username,username:r.username,tier:r.tier||vip.tier,currency:r.currency||vip.currency||'MYR',host:r.host_assigned||vip.host_assigned,phone:vip.phone||null,whatsapp:vip.whatsapp||null,last_deposit_date:vip.last_deposit_date||null,days_since_deposit:Number(vip.days_inactive)||null,decline_pct:-100,net_win_loss_3d:0,reasons:[`Churned: deposited in ${prevM} but zero deposit in ${latestM} — needs reactivation`],urgency_score:4,follow_up_due:true,last_contact:latestContact[r.username]?.logged_at||null,contacted_today:contactedToday})})}}catch(monthlyErr){console.error('loadPriorityContacts monthly churn overlay error',monthlyErr)}
  // ── Enrich with gaming labels ──────────────────────────────────────────────
  try {
    const usernames = results.map(r => r.username)
    if (usernames.length) {
      const { data: gamingRows } = await supabase
        .from('player_gaming_labels')
        .select('username, player_type, player_type_icon, offer_recommendation, snapshot_month')
        .in('username', usernames)
        .order('snapshot_month', { ascending: false })
      if (gamingRows && gamingRows.length) {
        // Take most recent label per username
        const gamingMap = {}
        gamingRows.forEach(g => { if (!gamingMap[g.username]) gamingMap[g.username] = g })
        results.forEach(r => {
          const g = gamingMap[r.username]
          if (g && g.player_type) {
            r.player_type = g.player_type
            r.player_type_icon = g.player_type_icon || '🎮'
            r.offer_recommendation = g.offer_recommendation
            // Add gaming context as the FIRST reason so hosts see it immediately
            const gamingReason = `${g.player_type_icon || '🎮'} ${g.player_type} — ${g.offer_recommendation || 'personalised offer recommended'}`
            r.reasons = [gamingReason, ...r.reasons]
          }
        })
      }
    }
  } catch (gamingErr) { console.error('loadPriorityContacts gaming labels error', gamingErr) }
  results.sort((a,b)=>getRetentionTierRank(a.tier)-getRetentionTierRank(b.tier)||Number(b.follow_up_due)-Number(a.follow_up_due)||b.urgency_score-a.urgency_score||String(a.username).localeCompare(String(b.username)));setPriorityList(results)}finally{setPriorityLoading(false)}}

  async function loadAll(){setLoading(true);try{const{data:members}=await supabase.from('vip_members').select('*').eq('is_excluded',false);const{data:logs}=await supabase.from('reactivation_logs').select('*').eq('reactivated_month',monthStr);const logSet=new Set((logs||[]).map(x=>x.username));setReactivated(logs||[]);setReactivatedSet(logSet);setVips(members||[]);setStats({high:(members||[]).filter(x=>x.churn_risk==='HIGH').length,medium:(members||[]).filter(x=>x.churn_risk==='MEDIUM').length,dormant:(members||[]).filter(x=>(x.days_inactive||0)>=dormantDays).length,atRisk:(members||[]).filter(x=>(x.churn_risk==='HIGH'||x.churn_risk==='MEDIUM')&&!logSet.has(x.username)).length});
    // contact_logs this month — for Diamond/Platinum coverage tracking
    const dpNames=(members||[]).filter(v=>v.tier==='DIAMOND'||v.tier==='PLATINUM').map(v=>v.username);
    if(dpNames.length){const{data:cLogs}=await supabase.from('contact_logs').select('username').eq('log_month',monthStr).in('username',dpNames);setContactedSet(new Set((cLogs||[]).map(l=>l.username)))}else{setContactedSet(new Set())}
  }catch(e){console.error(e)}finally{setLoading(false)}}

  const visibleVips=vips.filter(v=>(tierF==='ALL'||v.tier===tierF)&&(!mineOnly||v.host_assigned===myName)); const reactRows=reactivated.filter(v=>reactTierF==='ALL'||v.tier===reactTierF)
  return <div style={s.page}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:18}}><div><div style={s.title}>{t('sidebar.nav.churnAlerts')}</div><div style={s.sub}>{t('churnAlerts.subtitle')}</div></div></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:18}}><StatCard icon="🔥" label={t('churnAlerts.statHighRisk')} value={stats.high} color="#f85149"/><StatCard icon="⚠️" label={t('churnAlerts.statMediumRisk')} value={stats.medium} color="#d29922"/><StatCard icon="💤" label={t('common.dormant')} value={stats.dormant}/><StatCard icon="🎯" label={t('common.atRisk')} value={stats.atRisk}/></div>
    <div style={s.card}><div style={{display:'flex',gap:8,padding:12,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>{[['priority','🔥 Priority'],['churn','📉 Churn'],['reactivated','♻️ Reactivated'],['dormant','💤 Dormant'],['diamond','💎 Diamond'],['platinum','🔷 Platinum']].map(([key,label])=><button key={key} style={{...s.btnSm,background:tab===key?'var(--accent)':'var(--surface2)',color:tab===key?'#fff':'var(--text)'}} onClick={()=>setTab(key)}>{label}</button>)}</div>
      {tab==='priority'&&<div>{priorityLoading?<div style={{padding:30}}>Loading…</div>:<>
        <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {['ALL',...[...new Set(priorityList.filter(v=>v.host).map(v=>v.host))].sort()].map(h=><button key={h} style={{...s.btnSm,background:priorityHostF===h?'var(--accent)':'var(--surface2)',color:priorityHostF===h?'#fff':'var(--text)'}} onClick={()=>setPriorityHostF(h)}>{h==='ALL'?`All (${priorityList.length})`:h}</button>)}
          </div>
          <label style={{display:'flex',gap:6,fontSize:12,alignItems:'center',color:'var(--text)',marginLeft:'auto',cursor:'pointer'}}>
            <input type="checkbox" checked={mineOnly} onChange={e=>setMineOnly(e.target.checked)}/>Mine only
          </label>
        </div>
        <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['Player','Tier','Host','Phone / WA','Days','Last Contact','Reason','Actions'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{priorityList.filter(v=>priorityHostF==='ALL'||v.host===priorityHostF).map(v=><tr key={v.id}>
          <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title="Copy username" onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td>
          <td style={s.td}>{v.tier}</td>
          <td style={s.td}>{v.host||'—'}</td>
          <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}</td>
          <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_since_deposit!=null?v.days_since_deposit+'d':'—'}</td>
          <td style={s.td}>{v.last_contact?new Date(v.last_contact).toLocaleDateString('en-MY',{day:'2-digit',month:'short'}):'Never'}</td>
          <td style={{...s.td,maxWidth:240,fontSize:12}}>
            {v.player_type && (
              <div style={{display:'inline-flex',alignItems:'center',gap:4,background:'rgba(139,92,246,.12)',border:'1px solid rgba(139,92,246,.3)',borderRadius:8,padding:'2px 8px',marginBottom:4,fontSize:11,fontWeight:700,color:'#a78bfa'}}>
                {v.player_type_icon||'🎮'} {v.player_type}
              </div>
            )}
            <div style={{color:'var(--muted)',lineHeight:1.4}}>
              {(v.player_type ? v.reasons.slice(1) : v.reasons).join(' • ')}
            </div>
            {v.offer_recommendation && (
              <div style={{marginTop:3,fontSize:10,color:'#34D399',fontWeight:600}}>💡 {v.offer_recommendation}</div>
            )}
          </td>
          <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            <button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal(v)}>💬 WA</button>
            <button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>Open</button>
            {!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>✅ Reactivate</button>}
          </div></td>
        </tr>)}
        {!priorityList.filter(v=>priorityHostF==='ALL'||v.host===priorityHostF).length&&<tr><td colSpan="8" style={{...s.td,textAlign:'center'}}>No priority VIPs.</td></tr>}
        </tbody></table></div>
      </>}</div>}
      {tab==='reactivated'&&<div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['Player','Tier','Host','Recovery','Currency','Notes'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{reactRows.map(v=><tr key={v.username}><td style={s.td}>{v.username}</td><td style={s.td}>{v.tier||'—'}</td><td style={s.td}>{v.host_name||'—'}</td><td style={s.td}>{formatMoney(v.reactivation_deposit||0,v.currency||'')}</td><td style={s.td}>{v.currency||'—'}</td><td style={s.td}>{v.notes||'—'}</td></tr>)}{!reactRows.length&&<tr><td colSpan="6" style={{...s.td,textAlign:'center'}}>No reactivated VIPs for this month.</td></tr>}</tbody></table></div>}
      {tab==='churn'&&(()=>{const churnVipsBase=vips.filter(v=>v.churn_risk==='HIGH'||v.churn_risk==='MEDIUM').sort((a,b)=>(a.churn_risk==='HIGH'?0:1)-(b.churn_risk==='HIGH'?0:1)||(b.days_inactive||0)-(a.days_inactive||0));const churnVips=applyDateSort(churnVipsBase,churnSortCol,churnSortAsc);return<div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr><th style={s.th}>Player</th><th style={s.th}>Tier</th><th style={s.th}>Host</th><th style={s.th}>Phone / WA</th><th style={s.th}>Risk</th><th style={s.th}>Days Inactive</th><SortTh col='last_deposit_date' label='Last Deposit' sortCol={churnSortCol} sortAsc={churnSortAsc} onSort={handleChurnSort} style={s.th}/><SortTh col='last_contacted' label='Last Contact' sortCol={churnSortCol} sortAsc={churnSortAsc} onSort={handleChurnSort} style={s.th}/><th style={s.th}>Actions</th></tr></thead><tbody>{churnVips.map(v=><tr key={v.id}><td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title="Copy username" onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td><td style={s.td}>{v.tier}</td><td style={s.td}>{v.host_assigned||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}</td><td style={s.td}><span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.churn_risk]||'transparent',color:RISK_COLOR[v.churn_risk]||'var(--muted)'}}>{v.churn_risk}</span></td><td style={{...s.td,fontVariantNumeric:'tabular-nums',color:'#f85149',fontWeight:700}}>{v.days_inactive||0}d</td><td style={s.td}>{v.last_deposit_date||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString('en-MY',{day:'2-digit',month:'short'}):'Never'}</td><td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[v.churn_risk==='HIGH'?'HIGH churn risk':'MEDIUM churn risk'],days_since_deposit:v.days_inactive})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>Open</button>{!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>✅ Reactivate</button>}</div></td></tr>)}{!churnVips.length&&<tr><td colSpan="9" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>No high/medium risk VIPs at this time.</td></tr>}</tbody></table></div>})()}
      {tab==='dormant'&&(()=>{const dormVipsBase=vips.filter(v=>(v.days_inactive||0)>=dormantDays&&(dormantTierF==='ALL'||v.tier===dormantTierF)).sort((a,b)=>(b.days_inactive||0)-(a.days_inactive||0));const dormVips=applyDateSort(dormVipsBase,churnSortCol,churnSortAsc);return<div><div style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}><select value={dormantTierF} onChange={e=>setDormantTierF(e.target.value)} style={s.sel}><option value="ALL">All Tiers</option>{['DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(t=><option key={t} value={t}>{t}</option>)}</select><label style={{display:'flex',gap:6,fontSize:12,alignItems:'center',color:'var(--text)'}}>Inactive ≥<input type="number" min={1} value={dormantDays} onChange={e=>setDormantDays(Number(e.target.value))} style={{...s.sel,width:70,padding:'5px 8px',fontSize:12}} /> days</label><span style={{fontSize:12,color:'var(--muted)'}}>{dormVips.length} players</span></div><div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr><th style={s.th}>Player</th><th style={s.th}>Tier</th><th style={s.th}>Host</th><th style={s.th}>Phone / WA</th><th style={s.th}>Days Inactive</th><SortTh col='last_deposit_date' label='Last Deposit' sortCol={churnSortCol} sortAsc={churnSortAsc} onSort={handleChurnSort} style={s.th}/><SortTh col='last_contacted' label='Last Contact' sortCol={churnSortCol} sortAsc={churnSortAsc} onSort={handleChurnSort} style={s.th}/><th style={s.th}>Actions</th></tr></thead><tbody>{dormVips.map(v=><tr key={v.id}><td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title="Copy username" onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td><td style={s.td}>{v.tier}</td><td style={s.td}>{v.host_assigned||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}</td><td style={{...s.td,fontVariantNumeric:'tabular-nums',color:'#f85149',fontWeight:700}}>{v.days_inactive||0}d</td><td style={s.td}>{v.last_deposit_date||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString('en-MY',{day:'2-digit',month:'short'}):'Never'}</td><td style={s.td}><div style={{display:'flex',gap:5}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`Dormant ${v.days_inactive||0} days`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>Open</button></div></td></tr>)}{!dormVips.length&&<tr><td colSpan="8" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>No dormant VIPs match the threshold.</td></tr>}</tbody></table></div></div>})()}
      {tab==='diamond'&&(()=>{
        const allDHosts=[...new Set(vips.filter(v=>v.tier==='DIAMOND'&&v.host_assigned).map(v=>v.host_assigned))].sort()
        const allD=vips.filter(v=>v.tier==='DIAMOND'&&(dHostF==='ALL'||v.host_assigned===dHostF))
        const dVipsBase=allD.filter(v=>!dUncontactedOnly||!contactedSet.has(v.username)).sort((a,b)=>Number(contactedSet.has(a.username))-Number(contactedSet.has(b.username))||(b.days_inactive||0)-(a.days_inactive||0));const dVips=applyDateSort(dVipsBase,churnSortCol,churnSortAsc)
        const dContacted=allD.filter(v=>contactedSet.has(v.username)).length
        const dNotYet=allD.length-dContacted
        return(<div>
          <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {['ALL',...allDHosts].map(h=><button key={h} style={{...s.btnSm,background:dHostF===h?'var(--accent)':'var(--surface2)',color:dHostF===h?'#fff':'var(--text)'}} onClick={()=>setDHostF(h)}>{h==='ALL'?`All (${allD.length})`:h}</button>)}
            </div>
            <button style={{...s.btnSm,background:dUncontactedOnly?'#f85149':'var(--surface2)',color:dUncontactedOnly?'#fff':'var(--text)',border:dUncontactedOnly?'1px solid #f85149':'1px solid var(--border)'}} onClick={()=>setDUncontactedOnly(v=>!v)}>❌ Not contacted only</button>
            <div style={{marginLeft:'auto',display:'flex',gap:12,fontSize:12,alignItems:'center'}}>
              <span style={{color:'#3fb950',fontWeight:700}}>✅ {dContacted} contacted</span>
              <span style={{color:'#f85149',fontWeight:700}}>❌ {dNotYet} not yet</span>
              <span style={{color:'var(--muted)'}}>{MONTHS[month]}: {allD.length?Math.round(dContacted/allD.length*100):0}%</span>
            </div>
          </div>
          <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr><th style={s.th}>Player</th><th style={s.th}>Host</th><th style={s.th}>Phone / WA</th><th style={s.th}>Risk</th><th style={s.th}>Days Inactive</th><SortTh col='last_deposit_date' label='Last Deposit' sortCol={churnSortCol} sortAsc={churnSortAsc} onSort={handleChurnSort} style={s.th}/><SortTh col='last_contacted' label='Last Contact' sortCol={churnSortCol} sortAsc={churnSortAsc} onSort={handleChurnSort} style={s.th}/><th style={s.th}>This Month</th><th style={s.th}>Actions</th></tr></thead>
            <tbody>{dVips.map(v=>{const isC=contactedSet.has(v.username);return(
              <tr key={v.id}>
                <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title="Copy username" onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td>
                <td style={s.td}>{v.host_assigned||'—'}</td>
                <td style={{...s.td,fontSize:12}}>{v.whatsapp||v.phone?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{color:'var(--muted)'}}>{v.whatsapp||v.phone}</span><button title="Copy number" onClick={e=>{e.stopPropagation();navigator.clipboard.writeText((v.whatsapp||v.phone).replace(/\D/g,''))}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:11,padding:'0 2px',opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span>:'—'}</td>
                <td style={s.td}>{v.risk_level?<span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.risk_level]||'transparent',color:RISK_COLOR[v.risk_level]||'var(--muted)'}}>{v.risk_level}</span>:'—'}</td>
                <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_inactive||0}d</td>
                <td style={s.td}>{v.last_deposit_date||'—'}</td>
                <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString('en-MY',{day:'2-digit',month:'short'}):'Never'}</td>
                <td style={s.td}><span style={{fontSize:12,fontWeight:700,color:isC?'#3fb950':'#f85149'}}>{isC?'✅ Done':'❌ Not yet'}</span></td>
                <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`${v.tier} monthly follow-up`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>Open</button>{!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>✅ Reactivate</button>}</div></td>
              </tr>
            )})}
            {!dVips.length&&<tr><td colSpan="9" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>No Diamond VIPs match the filter.</td></tr>}
            </tbody></table></div>
        </div>)
      })()}
      {tab==='platinum'&&(()=>{
        const allPHosts=[...new Set(vips.filter(v=>v.tier==='PLATINUM'&&v.host_assigned).map(v=>v.host_assigned))].sort()
        const allP=vips.filter(v=>v.tier==='PLATINUM'&&(pHostF==='ALL'||v.host_assigned===pHostF))
        const pVipsBase=allP.filter(v=>!pUncontactedOnly||!contactedSet.has(v.username)).sort((a,b)=>Number(contactedSet.has(a.username))-Number(contactedSet.has(b.username))||(b.days_inactive||0)-(a.days_inactive||0));const pVips=applyDateSort(pVipsBase,churnSortCol,churnSortAsc)
        const pContacted=allP.filter(v=>contactedSet.has(v.username)).length
        const pNotYet=allP.length-pContacted
        return(<div>
          <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {['ALL',...allPHosts].map(h=><button key={h} style={{...s.btnSm,background:pHostF===h?'var(--accent)':'var(--surface2)',color:pHostF===h?'#fff':'var(--text)'}} onClick={()=>setPHostF(h)}>{h==='ALL'?`All (${allP.length})`:h}</button>)}
            </div>
            <button style={{...s.btnSm,background:pUncontactedOnly?'#f85149':'var(--surface2)',color:pUncontactedOnly?'#fff':'var(--text)',border:pUncontactedOnly?'1px solid #f85149':'1px solid var(--border)'}} onClick={()=>setPUncontactedOnly(v=>!v)}>❌ Not contacted only</button>
            <div style={{marginLeft:'auto',display:'flex',gap:12,fontSize:12,alignItems:'center'}}>
              <span style={{color:'#3fb950',fontWeight:700}}>✅ {pContacted} contacted</span>
              <span style={{color:'#f85149',fontWeight:700}}>❌ {pNotYet} not yet</span>
              <span style={{color:'var(--muted)'}}>{MONTHS[month]}: {allP.length?Math.round(pContacted/allP.length*100):0}%</span>
            </div>
          </div>
          <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr><th style={s.th}>Player</th><th style={s.th}>Host</th><th style={s.th}>Phone / WA</th><th style={s.th}>Risk</th><th style={s.th}>Days Inactive</th><SortTh col='last_deposit_date' label='Last Deposit' sortCol={churnSortCol} sortAsc={churnSortAsc} onSort={handleChurnSort} style={s.th}/><SortTh col='last_contacted' label='Last Contact' sortCol={churnSortCol} sortAsc={churnSortAsc} onSort={handleChurnSort} style={s.th}/><th style={s.th}>This Month</th><th style={s.th}>Actions</th></tr></thead>
            <tbody>{pVips.map(v=>{const isC=contactedSet.has(v.username);return(
              <tr key={v.id}>
                <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title="Copy username" onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td>
                <td style={s.td}>{v.host_assigned||'—'}</td>
                <td style={{...s.td,fontSize:12}}>{v.whatsapp||v.phone?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{color:'var(--muted)'}}>{v.whatsapp||v.phone}</span><button title="Copy number" onClick={e=>{e.stopPropagation();navigator.clipboard.writeText((v.whatsapp||v.phone).replace(/\D/g,''))}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:11,padding:'0 2px',opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span>:'—'}</td>
                <td style={s.td}>{v.risk_level?<span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.risk_level]||'transparent',color:RISK_COLOR[v.risk_level]||'var(--muted)'}}>{v.risk_level}</span>:'—'}</td>
                <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_inactive||0}d</td>
                <td style={s.td}>{v.last_deposit_date||'—'}</td>
                <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString('en-MY',{day:'2-digit',month:'short'}):'Never'}</td>
                <td style={s.td}><span style={{fontSize:12,fontWeight:700,color:isC?'#3fb950':'#f85149'}}>{isC?'✅ Done':'❌ Not yet'}</span></td>
                <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`${v.tier} monthly follow-up`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>Open</button>{!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>✅ Reactivate</button>}</div></td>
              </tr>
            )})}
            {!pVips.length&&<tr><td colSpan="9" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>No Platinum VIPs match the filter.</td></tr>}
            </tbody></table></div>
        </div>)
      })()}
    </div>
    {reactivateModal&&<ReactivateModal vip={reactivateModal} month={monthStr} onClose={()=>setReactivateModal(null)} onSaved={loadAll}/>}
    {churnWaModal&&<ChurnWaModal player={churnWaModal} agentName={myName||'Agent'} onClose={()=>setChurnWaModal(null)}/>}
  </div>
}