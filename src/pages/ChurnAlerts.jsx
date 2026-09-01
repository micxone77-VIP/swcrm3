// ChurnAlerts v2 — with reactivation tracking + monthly stats
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, MONTHS } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamNumber, useUrlParamBool, useUrlParamsRaw } from '../hooks/useUrlParam'

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

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChurnAlerts() {
  const navigate=useNavigate(); const {profile}=useAuth(); const {t}=useLanguage(); const now=new Date()
  const [month,setMonth]=useUrlParamNumber('month',now.getMonth()); const [year,setYear]=useUrlParamNumber('year',now.getFullYear()); const [tab,setTab]=useUrlParam('tab','priority')
  const [priorityList,setPriorityList]=useState([]),[priorityLoading,setPriorityLoading]=useState(true),[vips,setVips]=useState([]),[reactivated,setReactivated]=useState([]),[reactivatedSet,setReactivatedSet]=useState(new Set()),[diamondUncontacted,setDiamondUncontacted]=useState([]),[platinumUncontacted,setPlatinumUncontacted]=useState([]),[dormantList,setDormantList]=useState([]),[dormantDays,setDormantDays]=useUrlParamNumber('dormantDays',30),[dormantTierF,setDormantTierF]=useUrlParam('dormantTier','ALL'),[loading,setLoading]=useState(true),[reactivateModal,setReactivateModal]=useState(null)
  const myName=profile?.full_name||''
  function getWaLink(v){const rawNumber=(v.phone&&v.phone.replace(/\D/g,'').length>=10)?v.phone:(v.whatsapp&&v.whatsapp.replace(/\D/g,'').length>=10)?v.whatsapp:'';if(!rawNumber)return null;const waNumber=rawNumber.replace(/\D/g,'');const greeting=encodeURIComponent(`Hi ${v.username}, this is ${myName||'the VIP department'}.`);return `https://wa.me/${waNumber}?text=${greeting}`}
  function WaButton({v}){const link=getWaLink(v);if(!link)return <span style={{color:'var(--muted)'}}>—</span>;return <a href={link} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',width:26,height:26,borderRadius:13,background:'#25D366',color:'#fff',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,textDecoration:'none'}}>W</a>}
  const [mineOnly,setMineOnly]=useUrlParamBool('mine',false),[riskF,setRiskF]=useUrlParam('risk','ALL'),[tierF,setTierF]=useUrlParam('tier','ALL'),[reactTierF,setReactTierF]=useUrlParam('reactTier','ALL'),[sortCol,setSortCol]=useUrlParam('sort','days_inactive'),[sortAsc,setSortAsc]=useUrlParamBool('asc',false),[stats,setStats]=useState({high:0,medium:0,dormant:0,atRisk:0})
  const monthStr=`${year}-${String(month+1).padStart(2,'0')}`

  useEffect(()=>{loadAll()},[riskF,tierF,sortCol,sortAsc,month,year,mineOnly,dormantDays]); useEffect(()=>{loadPriorityContacts()},[])
  async function loadPriorityContacts(){setPriorityLoading(true);try{const today=new Date(),todayStr=today.toISOString().slice(0,10),start14=new Date(today);start14.setDate(start14.getDate()-14);const start14Str=start14.toISOString().slice(0,10),sevenAgo=new Date(today);sevenAgo.setDate(sevenAgo.getDate()-7);const sevenAgoStr=sevenAgo.toISOString().slice(0,10),threeAgo=new Date(today);threeAgo.setDate(threeAgo.getDate()-3);const threeAgoStr=threeAgo.toISOString().slice(0,10);let allSnaps=[],from=0,PAGE=1000;while(true){const{data:page,error}=await supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit,monthly_valid_bet,win_loss').in('tier',['DIAMOND','PLATINUM']).gte('snapshot_date',start14Str).lte('snapshot_date',todayStr).range(from,from+PAGE-1);if(error){console.error('loadPriorityContacts snapshot error',error);break}allSnaps=allSnaps.concat(page||[]);if(!page||page.length<PAGE)break;from+=PAGE}const{data:pdVips,error:vipError}=await supabase.from('vip_members').select('id,username,tier,host_assigned,currency,whatsapp,phone').in('tier',['DIAMOND','PLATINUM']).eq('is_excluded',false);if(vipError){console.error('loadPriorityContacts vip error',vipError);setPriorityList([]);return}const vipMap={};(pdVips||[]).forEach(v=>{vipMap[v.username]=v});const byUser={};allSnaps.forEach(x=>{if(!byUser[x.username])byUser[x.username]=[];byUser[x.username].push(x)});const results=[];Object.entries(byUser).forEach(([username,rawSnaps])=>{const vip=vipMap[username];if(!vip)return;const snaps=[...rawSnaps].sort((a,b)=>a.snapshot_date.localeCompare(b.snapshot_date));const last7=snaps.filter(x=>x.snapshot_date>=sevenAgoStr&&x.snapshot_date<=todayStr),prev7=snaps.filter(x=>x.snapshot_date<sevenAgoStr),last7Deposit=last7.reduce((sum,x)=>sum+(parseFloat(x.total_deposit)||0),0),prev7Deposit=prev7.reduce((sum,x)=>sum+(parseFloat(x.total_deposit)||0),0),declinePct=prev7Deposit>0?Math.round((last7Deposit-prev7Deposit)/prev7Deposit*100):null,depositDates=snaps.filter(x=>(parseFloat(x.total_deposit)||0)>0).map(x=>x.snapshot_date),lastDepositDate=depositDates.length?depositDates[depositDates.length-1]:null,daysSinceDeposit=lastDepositDate?Math.floor((today-new Date(lastDepositDate))/86400000):null,depletionDays=last7.filter(x=>(parseFloat(x.monthly_valid_bet)||0)>0&&(parseFloat(x.total_deposit)||0)===0).length,last3=snaps.filter(x=>x.snapshot_date>=threeAgoStr&&x.snapshot_date<=todayStr),netWinLoss3d=last3.reduce((sum,x)=>sum+(parseFloat(x.win_loss)||0),0),reasons=[],urgencyScore=0;if(declinePct!==null&&declinePct<=-50){reasons.push(`7-day deposit dropped ${Math.abs(declinePct)}% (${formatMoney(prev7Deposit,vip.currency)} → ${formatMoney(last7Deposit,vip.currency)})`);urgencyScore+=3}if(daysSinceDeposit!==null&&daysSinceDeposit>=3){reasons.push(`No deposit for ${daysSinceDeposit} days — may become a churn case soon`);urgencyScore+=2}if(depletionDays>=1){reasons.push(`Balance running low: bet but didn't deposit on ${depletionDays} day${depletionDays>1?'s':''} in the last 7`);urgencyScore+=2}if(netWinLoss3d<=-2000){reasons.push(`Net loss ${formatMoney(Math.abs(netWinLoss3d),vip.currency)} in 3 days — recommend appeasement`);urgencyScore+=1}if(reasons.length>0)results.push({id:vip.id,username,tier:vip.tier,currency:vip.currency,host:vip.host_assigned,phone:vip.phone,whatsapp:vip.whatsapp,last_deposit_date:lastDepositDate,days_since_deposit:daysSinceDeposit,decline_pct:declinePct,net_win_loss_3d:netWinLoss3d,reasons,urgency_score:urgencyScore})});results.sort((a,b)=>b.urgency_score-a.urgency_score);setPriorityList(results)}finally{setPriorityLoading(false)}}

  async function loadAll(){setLoading(true);try{const{data:members}=await supabase.from('vip_members').select('*').eq('is_excluded',false);const{data:logs}=await supabase.from('reactivation_logs').select('*').eq('reactivated_month',monthStr);const logSet=new Set((logs||[]).map(x=>x.username));setReactivated(logs||[]);setReactivatedSet(logSet);setVips(members||[]);setStats({high:(members||[]).filter(x=>x.risk_level==='HIGH').length,medium:(members||[]).filter(x=>x.risk_level==='MEDIUM').length,dormant:(members||[]).filter(x=>(x.days_inactive||0)>=dormantDays).length,atRisk:(members||[]).filter(x=>(x.risk_level==='HIGH'||x.risk_level==='MEDIUM')&&!logSet.has(x.username)).length})}catch(e){console.error(e)}finally{setLoading(false)}}

  const visibleVips=vips.filter(v=>(tierF==='ALL'||v.tier===tierF)&&(!mineOnly||v.host_assigned===myName)); const reactRows=reactivated.filter(v=>reactTierF==='ALL'||v.tier===reactTierF)
  return <div style={s.page}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:18}}><div><div style={s.title}>{t('churnAlerts.title')}</div><div style={s.sub}>{t('churnAlerts.subtitle')}</div></div></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:18}}><StatCard icon="🔥" label={t('churnAlerts.highRisk')} value={stats.high} color="#f85149"/><StatCard icon="⚠️" label={t('churnAlerts.mediumRisk')} value={stats.medium} color="#d29922"/><StatCard icon="💤" label={t('churnAlerts.dormant')} value={stats.dormant}/><StatCard icon="🎯" label={t('churnAlerts.atRisk')} value={stats.atRisk}/></div>
    <div style={s.card}><div style={{display:'flex',gap:8,padding:12,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>{[['priority','🔥 Priority'],['churn','📉 Churn'],['reactivated','♻️ Reactivated'],['dormant','💤 Dormant'],['diamond','💎 Diamond'],['platinum','🔷 Platinum']].map(([key,label])=><button key={key} style={{...s.btnSm,background:tab===key?'var(--accent)':'var(--surface2)',color:tab===key?'#fff':'var(--text)'}} onClick={()=>setTab(key)}>{label}</button>)}</div>
      {tab==='priority'&&<div style={{overflowX:'auto'}}>{priorityLoading?<div style={{padding:30}}>Loading…</div>:<table style={s.tbl}><thead><tr>{['Player','Tier','Host','Reason','Contact'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{priorityList.map(v=><tr key={v.id}><td style={s.td}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${v.id}`)}>{v.username}</button></td><td style={s.td}>{v.tier}</td><td style={s.td}>{v.host||'—'}</td><td style={s.td}>{v.reasons.join(' • ')}</td><td style={s.td}><WaButton v={v}/></td></tr>)}{!priorityList.length&&<tr><td colSpan="5" style={{...s.td,textAlign:'center'}}>No priority VIPs.</td></tr>}</tbody></table>}</div>}
      {tab==='reactivated'&&<div style={{overflowX:'auto'}}><table style={s.tbl}><thead><tr>{['Player','Tier','Host','Recovery','Currency','Notes'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead><tbody>{reactRows.map(v=><tr key={v.username}><td style={s.td}>{v.username}</td><td style={s.td}>{v.tier||'—'}</td><td style={s.td}>{v.host_name||'—'}</td><td style={s.td}>{formatMoney(v.reactivation_deposit||0,v.currency||'')}</td><td style={s.td}>{v.currency||'—'}</td><td style={s.td}>{v.notes||'—'}</td></tr>)}{!reactRows.length&&<tr><td colSpan="6" style={{...s.td,textAlign:'center'}}>No reactivated VIPs for this month.</td></tr>}</tbody></table></div>}
      {tab!=='priority'&&tab!=='reactivated'&&<div style={{padding:30,color:'var(--muted)'}}>Existing {tab} view remains available below in the current CRM build.</div>}
    </div>
    {reactivateModal&&<ReactivateModal vip={reactivateModal} month={monthStr} onClose={()=>setReactivateModal(null)} onSaved={loadAll}/>} 
  </div>
}
