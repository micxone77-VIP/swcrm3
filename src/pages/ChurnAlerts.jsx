// ChurnAlerts v2 — with reactivation tracking + monthly stats
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, MONTHS } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { ListCount } from '../components/ui'
import { fetchAll } from '../lib/depositProfile'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamNumber, useUrlParamBool, useUrlParamsRaw } from '../hooks/useUrlParam'
import { getRetentionTierRank, isFollowUpDue, calculateChurnUrgency } from '../lib/retention'

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

// Display-only translation of in-memory reason strings (data stays English)
function trReason(r, lang) {
  if (lang !== 'zh' || !r) return r
  let m
  if ((m = r.match(/^7-day deposit dropped (\S+)% \((.*)\)$/))) return `7天存款下降 ${m[1]}% (${m[2]})`
  if ((m = r.match(/^No deposit for (\d+) days — may become a churn case soon$/))) return `${m[1]}天未存款 — 可能即将流失`
  if ((m = r.match(/^Balance running low: bet but didn't deposit on (\d+) days? in the last 7$/))) return `余额偏低：过去7天中有${m[1]}天投注但未存款`
  if ((m = r.match(/^Net loss (.+) in 3 days — recommend appeasement$/))) return `3天净输 ${m[1]} — 建议安抚`
  if ((m = r.match(/^Churned: deposited in (\S+) but zero deposit in (\S+) — needs reactivation$/))) return `已流失：${m[1]} 有存款但 ${m[2]} 零存款 — 需要召回`
  if ((m = r.match(/^(HIGH|MEDIUM) churn risk$/))) return `${m[1] === 'HIGH' ? '高' : '中'}流失风险`
  if ((m = r.match(/^Dormant (\d+) days$/))) return `休眠 ${m[1]} 天`
  if ((m = r.match(/^(\S+) monthly follow-up$/))) return `${m[1]} 月度跟进`
  return r.replace('personalised offer recommended', '建议个性化优惠')
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

function ChurnWaModal({ player, agentName, onClose, onLogged }) {
  const [lang, setLang] = useState('en')
  const { lang: uiLang } = useLanguage()
  const L2 = (en, zh) => (uiLang === 'zh' ? zh : en)
  const [copied, setCopied] = useState(false)
  const [logId, setLogId] = useState(null)
  const [logBusy, setLogBusy] = useState(false)
  const [logErr, setLogErr] = useState('')
  const rawNumber = (player.whatsapp && player.whatsapp.replace(/\D/g,'').length >= 10)
    ? player.whatsapp : (player.phone && player.phone.replace(/\D/g,'').length >= 10)
    ? player.phone : ''
  const waNumber = rawNumber.replace(/\D/g,'')
  const displayNum = player.whatsapp || player.phone || '—'
  const hasDecline = (player.reasons || []).some(r => /decline|drop|churned/i.test(r))
  const daysSince = player.days_since_deposit ?? player.days_inactive ?? 0
  const templates = {
    en: {
      reactivate: `Hi bro *${player.username}*! 👋 I'm ${agentName} from sureWin VIP department.\n\nLong time no see you around${daysSince ? ` (${daysSince} days liao)` : ''} 😅 everything ok ah?\n\nIf got anything I can help, or you want me check any promo for you, just tell me ya. Waiting for you to come back play bro 💎`,
      decline: `Hi bro *${player.username}*! 👋 I'm ${agentName} from sureWin VIP department.\n\nSee you less active lately, just want to check on you 😊 all good?\n\nGot some VIP offers I can arrange for you — want me share with you? Anything just WhatsApp me ya 💎`,
    },
    cn: {
      reactivate: `嗨 *${player.username}*！👋 我是sureWin VIP部门的${agentName}。\n\n${daysSince ? `已经${daysSince}天` : '好久'}没看到你啦 😅 最近还好吗？\n\n有什么需要帮忙的，或者想我帮你看看有什么优惠，随时跟我说哦。等你回来玩 💎`,
      decline: `嗨 *${player.username}*！👋 我是sureWin VIP部门的${agentName}。\n\n看你最近比较少玩，来关心一下你 😊 一切都好吗？\n\n我这边有一些VIP优惠可以帮你安排，要不要我跟你分享？有什么随时WhatsApp我哦 💎`,
    }
  }
  const msgType = hasDecline ? 'decline' : 'reactivate'
  const message = templates[lang][msgType]
  const waLink = waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}` : null

  // One Contact Log per popup open — written on the first Copy or WhatsApp click
  async function logSend(via) {
    if (logId || logBusy) return
    setLogBusy(true); setLogErr('')
    const { data: { user } } = await supabase.auth.getUser()
    const myt = new Date(Date.now() + 8 * 3600 * 1000)
    const summary = `💬 ${hasDecline ? 'Decline check-in' : 'Churn follow-up'} sent (${via === 'wa' ? 'WhatsApp button' : 'copied, manual WhatsApp'}, ${lang === 'cn' ? '中文' : 'EN'})`
      + (daysSince ? `: ${daysSince}d inactive` : '')
    const { data, error } = await supabase.from('contact_logs').insert({
      vip_id:          player.id || null,
      username:        player.username,
      tier:            player.tier || null,
      channel:         'WhatsApp',
      outcome:         'Contacted',
      direction:       'outbound',
      notes:           summary,
      message_summary: summary,
      host_name:       agentName,
      host_id:         user?.id || null,
      logged_at:       new Date().toISOString(),
      log_month:       myt.toISOString().slice(0, 7),
      log_week:        String(Math.ceil(myt.getUTCDate() / 7)),
    }).select('id').single()
    setLogBusy(false)
    if (error) { setLogErr(error.message); return }
    setLogId(data.id)
    onLogged && onLogged()
  }
  async function undoLog() {
    if (!logId) return
    const { data, error } = await supabase.from('contact_logs').delete().eq('id', logId).select('id')
    if (error || !data?.length) { setLogErr(error?.message || 'not allowed to delete'); return }
    setLogId(null)
    onLogged && onLogged()
  }
  function handleCopy() { navigator.clipboard.writeText(message).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); logSend('copy') }) }
  return <div style={s.modal} onClick={onClose}><div style={{...s.mBox, width:520}} onClick={e=>e.stopPropagation()}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
      <div><div style={{fontSize:16,fontWeight:700}}>💬 WhatsApp — {player.username}</div>
      <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{player.tier} · 📱 {displayNum}{daysSince?L2(` · ${daysSince}d inactive`,` · 不活跃${daysSince}天`):''}</div></div>
      <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:18,lineHeight:1}}>✕</button>
    </div>
    <div style={{display:'flex',gap:6,marginBottom:12,alignItems:'center'}}>
      {[['en','🇬🇧 EN'],['cn','🇨🇳 CN']].map(([l,label])=><button key={l} style={{...s.btnSm,background:lang===l?'var(--accent)':'var(--surface2)',color:lang===l?'#fff':'var(--text)'}} onClick={()=>setLang(l)}>{label}</button>)}
      <div style={{marginLeft:'auto',fontSize:11,color:'var(--muted)'}}>{hasDecline?L2('📉 Decline message','📉 下滑关怀信息'):L2('♻️ Reactivation message','♻️ 召回信息')}</div>
    </div>
    <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:10,padding:14,fontSize:13,lineHeight:1.65,whiteSpace:'pre-wrap',maxHeight:220,overflowY:'auto',color:'var(--text)',marginBottom:14}}>{message}</div>
    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
      <button style={s.btnSm} onClick={onClose}>{L2('Close','关闭')}</button>
      <button style={{...s.btn('#6366f1'),padding:'8px 16px'}} onClick={handleCopy}>{copied?L2('✅ Copied!','✅ 已复制！'):L2('📋 Copy','📋 复制')}</button>
      {waLink?<a href={waLink} target="_blank" rel="noopener noreferrer" onClick={()=>logSend('wa')} style={{...s.btn('#25D366'),padding:'8px 16px',textDecoration:'none',display:'inline-block'}}>{L2('💬 Open WhatsApp','💬 打开WhatsApp')}</a>:<button style={{...s.btn('#555'),padding:'8px 16px'}} disabled>{L2('No WA Number','无WA号码')}</button>}
    </div>
    <div style={{marginTop:10,fontSize:12,textAlign:'center'}}>
      {logBusy
        ? <span style={{color:'var(--muted)'}}>{L2('Logging…','记录中…')}</span>
        : logId
          ? <span style={{color:'#3fb950'}}>{L2('✅ Logged to Contact Log','✅ 已记录到联系记录')}
              <button onClick={undoLog} style={{marginLeft:8,background:'none',border:'none',color:'var(--muted)',textDecoration:'underline',cursor:'pointer',fontSize:12}}>{L2('Undo','撤销')}</button></span>
          : logErr
            ? <span style={{color:'#f85149'}}>{L2('Log failed: ','记录失败：')}{logErr}</span>
            : <span style={{color:'var(--muted)'}}>{L2('Copy or WhatsApp will auto-log this to Contact Log','复制或打开WhatsApp会自动记录到联系记录')}</span>}
    </div>
  </div></div>
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChurnAlerts() {
  const navigate=useNavigate(); const {profile}=useAuth(); const {t,lang}=useLanguage(); const L2=(en,zh)=>(lang==='zh'?zh:en); const now=new Date()
  const [month,setMonth]=useUrlParamNumber('month',now.getMonth()); const [year,setYear]=useUrlParamNumber('year',now.getFullYear()); const [tab,setTab]=useUrlParam('tab','priority')
  const [priorityListAll,setPriorityList]=useState([]),[priorityLoading,setPriorityLoading]=useState(true),[vipsAll,setVips]=useState([]),[reactivated,setReactivated]=useState([]),[reactivatedSet,setReactivatedSet]=useState(new Set()),[diamondUncontacted,setDiamondUncontacted]=useState([]),[platinumUncontacted,setPlatinumUncontacted]=useState([]),[dormantList,setDormantList]=useState([]),[dormantDays,setDormantDays]=useUrlParamNumber('dormantDays',30),[dormantTierF,setDormantTierF]=useUrlParam('dormantTier','ALL'),[loading,setLoading]=useState(true),[reactivateModal,setReactivateModal]=useState(null)
  const myName=profile?.full_name||''
  function getWaLink(v){const rawNumber=(v.phone&&v.phone.replace(/\D/g,'').length>=10)?v.phone:(v.whatsapp&&v.whatsapp.replace(/\D/g,'').length>=10)?v.whatsapp:'';if(!rawNumber)return null;const waNumber=rawNumber.replace(/\D/g,'');const greeting=encodeURIComponent(`Hi ${v.username}, this is ${myName||'the VIP department'}.`);return `https://wa.me/${waNumber}?text=${greeting}`}
  function WaButton({v}){const link=getWaLink(v);if(!link)return <span style={{color:'var(--muted)'}}>—</span>;return <a href={link} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',width:26,height:26,borderRadius:13,background:'#25D366',color:'#fff',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,textDecoration:'none'}}>W</a>}
  const [mineOnly,setMineOnly]=useUrlParamBool('mine',false),[riskF,setRiskF]=useUrlParam('risk','ALL'),[tierF,setTierF]=useUrlParam('tier','ALL'),[reactTierF,setReactTierF]=useUrlParam('reactTier','ALL'),[sortCol,setSortCol]=useUrlParam('sort','days_inactive'),[sortAsc,setSortAsc]=useUrlParamBool('asc',false),[stats,setStats]=useState({high:0,medium:0,dormant:0,atRisk:0})
  const [dHostF,setDHostF]=useState('ALL'),[pHostF,setPHostF]=useState('ALL'),[gHostF,setGHostF]=useState('ALL'),[contactedSet,setContactedSet]=useState(new Set()),[dUncontactedOnly,setDUncontactedOnly]=useState(false),[pUncontactedOnly,setPUncontactedOnly]=useState(false),[gUncontactedOnly,setGUncontactedOnly]=useState(false)
  const [churnWaModal,setChurnWaModal]=useState(null),[priorityHostF,setPriorityHostF]=useState('ALL')
  // Market filter (MY / SG / KH) — based on the player's account currency; applies to every tab + stat cards
  const [mktF,setMktF]=useUrlParam('mkt','ALL')
  const mktOf=c=>{const u=String(c||'MYR').toUpperCase();return u==='SGD'?'SG':u.startsWith('KH')?'KH':'MY'}
  const inMkt=v=>mktF==='ALL'||mktOf(v.currency)===mktF
  const vips=vipsAll.filter(inMkt), priorityList=priorityListAll.filter(inMkt)
  const curByUser={}; vipsAll.forEach(v=>{curByUser[v.username]=v.currency})
  const mktList=['MY','SG','KH'].filter(m=>vipsAll.some(v=>mktOf(v.currency)===m))
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
    // Contacted this month — ALL tiers (Diamond / Platinum / Gold tabs). Previously only Diamond+Platinum were checked,
    // so every Gold VIP showed "Not yet". Paged + no .in() list (breaks with 100+ names); compared case-insensitively.
    {const cl=await fetchAll(()=>supabase.from('contact_logs').select('username').eq('log_month',monthStr).order('username'));setContactedSet(new Set(cl.map(l=>String(l.username||'').toLowerCase())))}
  }catch(e){console.error(e)}finally{setLoading(false)}}

  const visibleVips=vips.filter(v=>(tierF==='ALL'||v.tier===tierF)&&(!mineOnly||v.host_assigned===myName)); const reactRows=reactivated.filter(v=>(reactTierF==='ALL'||v.tier===reactTierF)&&inMkt({currency:curByUser[v.username]||v.currency}))
  const st={high:vips.filter(x=>x.churn_risk==='HIGH').length,medium:vips.filter(x=>x.churn_risk==='MEDIUM').length,dormant:vips.filter(x=>(x.days_inactive||0)>=dormantDays).length,atRisk:vips.filter(x=>(x.churn_risk==='HIGH'||x.churn_risk==='MEDIUM')&&!reactivatedSet.has(x.username)).length}
  return <div style={s.page}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:18}}><div><div style={s.title}>{t('sidebar.nav.churnAlerts')}</div><div style={s.sub}>{t('churnAlerts.subtitle')}</div></div></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:18}}><StatCard icon="🔥" label={t('churnAlerts.statHighRisk')} value={st.high} color="#f85149"/><StatCard icon="⚠️" label={t('churnAlerts.statMediumRisk')} value={st.medium} color="#d29922"/><StatCard icon="💤" label={t('common.dormant')} value={st.dormant}/><StatCard icon="🎯" label={t('common.atRisk')} value={st.atRisk}/></div>
    <div style={s.card}><div style={{display:'flex',gap:8,padding:12,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>{[['priority',L2('🔥 Priority','🔥 优先')],['churn',L2('📉 Churn','📉 流失')],['reactivated',L2('♻️ Reactivated','♻️ 已召回')],['dormant',L2('💤 Dormant','💤 休眠')],['diamond',L2('💎 Diamond','💎 钻石')],['platinum',L2('🔷 Platinum','🔷 白金')],['gold',L2('🥇 Gold','🥇 黄金')]].map(([key,label])=><button key={key} style={{...s.btnSm,background:tab===key?'var(--accent)':'var(--surface2)',color:tab===key?'#fff':'var(--text)'}} onClick={()=>setTab(key)}>{label}</button>)}<div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}><span style={{fontSize:12,color:'var(--muted)',fontWeight:600}}>{L2('Market:','市场：')}</span>{['ALL',...mktList].map(m=>{const on=mktF===m;const n=m==='ALL'?vipsAll.length:vipsAll.filter(v=>mktOf(v.currency)===m).length;return <button key={m} title={L2(`${n} VIPs`,`${n} 位VIP`)} style={{...s.btnSm,background:on?'#1f6feb':'var(--surface2)',color:on?'#fff':'var(--text)',border:on?'1px solid #1f6feb':'1px solid var(--border)',fontWeight:on?700:500}} onClick={()=>setMktF(m)}>{m==='ALL'?L2('All','全部'):m==='MY'?'🇲🇾 MY':m==='SG'?'🇸🇬 SG':'🇰🇭 KH'}</button>})}</div></div>
      {tab==='priority'&&<div>{priorityLoading?<div style={{padding:30}}>{L2('Loading…','载入中…')}</div>:<>
        <div style={{display:'flex',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {['ALL',...[...new Set(priorityList.filter(v=>v.host).map(v=>v.host))].sort()].map(h=><button key={h} style={{...s.btnSm,background:priorityHostF===h?'var(--accent)':'var(--surface2)',color:priorityHostF===h?'#fff':'var(--text)'}} onClick={()=>setPriorityHostF(h)}>{h==='ALL'?L2(`All (${priorityList.length})`,`全部 (${priorityList.length})`):h}</button>)}
          </div>
          <label style={{display:'flex',gap:6,fontSize:12,alignItems:'center',color:'var(--text)',marginLeft:'auto',cursor:'pointer'}}>
            <input type="checkbox" checked={mineOnly} onChange={e=>setMineOnly(e.target.checked)}/>{L2('Mine only','仅我的')}
          </label>
        </div>
        <ListCount total={priorityList.filter(v=>priorityHostF==='ALL'||v.host===priorityHostF).length} label="VIPs" labelZh="位VIP" />
        <div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Phone / WA','电话 / WA'),L2('Days','天数'),L2('Last Contact','最后联系'),L2('Reason','原因'),L2('Actions','操作')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{priorityList.filter(v=>priorityHostF==='ALL'||v.host===priorityHostF).map((v,rowIdx)=><tr key={v.id}>
          <td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td>
          <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td>
          <td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier):v.tier}</td>
          <td style={s.td}>{v.host||'—'}</td>
          <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}</td>
          <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_since_deposit!=null?v.days_since_deposit+L2('d','天'):'—'}</td>
          <td style={s.td}>{v.last_contact?new Date(v.last_contact).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td>
          <td style={{...s.td,maxWidth:240,fontSize:12}}>
            {v.player_type && (
              <div style={{display:'inline-flex',alignItems:'center',gap:4,background:'rgba(139,92,246,.12)',border:'1px solid rgba(139,92,246,.3)',borderRadius:8,padding:'2px 8px',marginBottom:4,fontSize:11,fontWeight:700,color:'#a78bfa'}}>
                {v.player_type_icon||'🎮'} {v.player_type}
              </div>
            )}
            <div style={{color:'var(--muted)',lineHeight:1.4}}>
              {(v.player_type ? v.reasons.slice(1) : v.reasons).map(r=>trReason(r,lang)).join(' • ')}
            </div>
            {v.offer_recommendation && (
              <div style={{marginTop:3,fontSize:10,color:'#34D399',fontWeight:600}}>💡 {v.offer_recommendation}</div>
            )}
          </td>
          <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            <button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal(v)}>💬 WA</button>
            <button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>
            {!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}
          </div></td>
        </tr>)}
        {!priorityList.filter(v=>priorityHostF==='ALL'||v.host===priorityHostF).length&&<tr><td colSpan="9" style={{...s.td,textAlign:'center'}}>{L2('No priority VIPs.','没有优先VIP。')}</td></tr>}
        </tbody></table></div>
      </>}</div>}
      {tab==='reactivated'&&<ListCount total={reactRows.length} label="VIPs" labelZh="位VIP" />}
      {tab==='reactivated'&&<div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Recovery','召回存款'),L2('Currency','货币'),L2('Notes','备注')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{reactRows.map((v,rowIdx)=><tr key={v.username}><td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td><td style={s.td}>{v.username}</td><td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier||'—'):(v.tier||'—')}</td><td style={s.td}>{v.host_name||'—'}</td><td style={s.td}>{formatMoney(v.reactivation_deposit||0,v.currency||'')}</td><td style={s.td}>{v.currency||'—'}</td><td style={s.td}>{v.notes||'—'}</td></tr>)}{!reactRows.length&&<tr><td colSpan="7" style={{...s.td,textAlign:'center'}}>{L2('No reactivated VIPs for this month.','本月没有召回的VIP。')}</td></tr>}</tbody></table></div>}
      {tab==='churn'&&(()=>{const churnVips=vips.filter(v=>v.churn_risk==='HIGH'||v.churn_risk==='MEDIUM').sort((a,b)=>(a.churn_risk==='HIGH'?0:1)-(b.churn_risk==='HIGH'?0:1)||(b.days_inactive||0)-(a.days_inactive||0));return<div><ListCount total={churnVips.length} label="VIPs" labelZh="位VIP" /><div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Phone / WA','电话 / WA'),L2('Risk','风险'),L2('Days Inactive','不活跃天数'),L2('Last Deposit','最后存款'),L2('Last Contact','最后联系'),L2('Actions','操作')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{churnVips.map((v,rowIdx)=><tr key={v.id}><td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td><td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td><td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier):v.tier}</td><td style={s.td}>{v.host_assigned||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}</td><td style={s.td}><span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.churn_risk]||'transparent',color:RISK_COLOR[v.churn_risk]||'var(--muted)'}}>{L2(v.churn_risk,RISK_ZH[v.churn_risk]||v.churn_risk)}</span></td><td style={{...s.td,fontVariantNumeric:'tabular-nums',color:'#f85149',fontWeight:700}}>{v.days_inactive||0}{L2('d','天')}</td><td style={s.td}>{v.last_deposit_date||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td><td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[v.churn_risk==='HIGH'?'HIGH churn risk':'MEDIUM churn risk'],days_since_deposit:v.days_inactive})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}</div></td></tr>)}{!churnVips.length&&<tr><td colSpan="10" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No high/medium risk VIPs at this time.','目前没有高/中风险VIP。')}</td></tr>}</tbody></table></div></div>})()}
      {tab==='dormant'&&(()=>{const dormVips=vips.filter(v=>(v.days_inactive||0)>=dormantDays&&(dormantTierF==='ALL'||v.tier===dormantTierF)).sort((a,b)=>(b.days_inactive||0)-(a.days_inactive||0));return<div><div style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}><select value={dormantTierF} onChange={e=>setDormantTierF(e.target.value)} style={s.sel}><option value="ALL">{L2('All Tiers','全部等级')}</option>{['DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(t=><option key={t} value={t}>{L2(t,TIER_ZH[t])}</option>)}</select><label style={{display:'flex',gap:6,fontSize:12,alignItems:'center',color:'var(--text)'}}>{L2('Inactive ≥','不活跃 ≥')}<input type="number" min={1} value={dormantDays} onChange={e=>setDormantDays(Number(e.target.value))} style={{...s.sel,width:70,padding:'5px 8px',fontSize:12}} /> {L2('days','天')}</label><span style={{fontSize:12,color:'var(--muted)'}}>{L2(`${dormVips.length} players`,`${dormVips.length} 位玩家`)}</span></div><div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['#',L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Phone / WA','电话 / WA'),L2('Days Inactive','不活跃天数'),L2('Last Deposit','最后存款'),L2('Last Contact','最后联系'),L2('Actions','操作')].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{dormVips.map((v,rowIdx)=><tr key={v.id}><td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{rowIdx+1}</td><td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td><td style={s.td}>{lang==='zh'?(TIER_ZH[v.tier]||v.tier):v.tier}</td><td style={s.td}>{v.host_assigned||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.whatsapp||v.phone||'—'}</td><td style={{...s.td,fontVariantNumeric:'tabular-nums',color:'#f85149',fontWeight:700}}>{v.days_inactive||0}{L2('d','天')}</td><td style={s.td}>{v.last_deposit_date||'—'}</td><td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td><td style={s.td}><div style={{display:'flex',gap:5}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`Dormant ${v.days_inactive||0} days`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button></div></td></tr>)}{!dormVips.length&&<tr><td colSpan="9" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No dormant VIPs match the threshold.','没有符合门槛的休眠VIP。')}</td></tr>}</tbody></table></div></div>})()}
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
                <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td>
                <td style={s.td}>{v.host_assigned||'—'}</td>
                <td style={{...s.td,fontSize:12}}>{v.whatsapp||v.phone?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{color:'var(--muted)'}}>{v.whatsapp||v.phone}</span><button title={L2('Copy number','复制号码')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText((v.whatsapp||v.phone).replace(/\D/g,''))}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:11,padding:'0 2px',opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span>:'—'}</td>
                <td style={s.td}>{v.risk_level?<span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.risk_level]||'transparent',color:RISK_COLOR[v.risk_level]||'var(--muted)'}}>{L2(v.risk_level,RISK_ZH[v.risk_level]||v.risk_level)}</span>:'—'}</td>
                <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_inactive||0}{L2('d','天')}</td>
                <td style={s.td}>{v.last_deposit_date||'—'}</td>
                <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td>
                <td style={s.td}><span style={{fontSize:12,fontWeight:700,color:isC?'#3fb950':'#f85149'}}>{isC?L2('✅ Done','✅ 已完成'):L2('❌ Not yet','❌ 未联系')}</span></td>
                <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`${v.tier} monthly follow-up`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}</div></td>
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
                <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td>
                <td style={s.td}>{v.host_assigned||'—'}</td>
                <td style={{...s.td,fontSize:12}}>{v.whatsapp||v.phone?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{color:'var(--muted)'}}>{v.whatsapp||v.phone}</span><button title={L2('Copy number','复制号码')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText((v.whatsapp||v.phone).replace(/\D/g,''))}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:11,padding:'0 2px',opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span>:'—'}</td>
                <td style={s.td}>{v.risk_level?<span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.risk_level]||'transparent',color:RISK_COLOR[v.risk_level]||'var(--muted)'}}>{L2(v.risk_level,RISK_ZH[v.risk_level]||v.risk_level)}</span>:'—'}</td>
                <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_inactive||0}{L2('d','天')}</td>
                <td style={s.td}>{v.last_deposit_date||'—'}</td>
                <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td>
                <td style={s.td}><span style={{fontSize:12,fontWeight:700,color:isC?'#3fb950':'#f85149'}}>{isC?L2('✅ Done','✅ 已完成'):L2('❌ Not yet','❌ 未联系')}</span></td>
                <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`${v.tier} monthly follow-up`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}</div></td>
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
                <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button><button title={L2('Copy username','复制用户名')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(v.username)}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:12,padding:'0 2px',lineHeight:1,opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span></td>
                <td style={s.td}>{v.host_assigned||'—'}</td>
                <td style={{...s.td,fontSize:12}}>{v.whatsapp||v.phone?<span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{color:'var(--muted)'}}>{v.whatsapp||v.phone}</span><button title={L2('Copy number','复制号码')} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText((v.whatsapp||v.phone).replace(/\D/g,''))}} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:11,padding:'0 2px',opacity:.6}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.6}>⎘</button></span>:'—'}</td>
                <td style={s.td}>{v.risk_level?<span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:RISK_BG[v.risk_level]||'transparent',color:RISK_COLOR[v.risk_level]||'var(--muted)'}}>{L2(v.risk_level,RISK_ZH[v.risk_level]||v.risk_level)}</span>:'—'}</td>
                <td style={{...s.td,fontVariantNumeric:'tabular-nums'}}>{v.days_inactive||0}{L2('d','天')}</td>
                <td style={s.td}>{v.last_deposit_date||'—'}</td>
                <td style={{...s.td,fontSize:12,color:'var(--muted)'}}>{v.last_contacted?new Date(v.last_contacted).toLocaleDateString(lang==='zh'?'zh-CN':'en-MY',{day:'2-digit',month:'short'}):L2('Never','从未')}</td>
                <td style={s.td}><span style={{fontSize:12,fontWeight:700,color:isC?'#3fb950':'#f85149'}}>{isC?L2('✅ Done','✅ 已完成'):L2('❌ Not yet','❌ 未联系')}</span></td>
                <td style={s.td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{background:'#25D366',color:'#fff',border:'none',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>setChurnWaModal({...v,reasons:[`${v.tier} monthly follow-up`],days_since_deposit:v.days_inactive,host:v.host_assigned})}>💬 WA</button><button style={s.btnSm} onClick={()=>navigate(`/vips/${v.id}`)}>{L2('Open','打开')}</button>{!reactivatedSet.has(v.username)&&<button style={{...s.btnSm,background:'#3fb950',color:'#fff',border:0,fontWeight:700}} onClick={()=>setReactivateModal(v)}>{L2('✅ Reactivate','✅ 召回')}</button>}</div></td>
              </tr>
            )})}
            {!gVips.length&&<tr><td colSpan="10" style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No Gold VIPs match the filter.','没有符合筛选的黄金VIP。')}</td></tr>}
            </tbody></table></div>
        </div>)
      })()}
    </div>
    {reactivateModal&&<ReactivateModal vip={reactivateModal} month={monthStr} onClose={()=>setReactivateModal(null)} onSaved={loadAll}/>}
    {churnWaModal&&<ChurnWaModal player={churnWaModal} agentName={myName||'Agent'} onClose={()=>setChurnWaModal(null)} onLogged={async()=>{const cl=await fetchAll(()=>supabase.from('contact_logs').select('username').eq('log_month',monthStr).order('username'));setContactedSet(new Set(cl.map(l=>String(l.username||'').toLowerCase())))}}/>}
  </div>
}