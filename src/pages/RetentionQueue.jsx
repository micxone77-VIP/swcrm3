import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { isFollowUpDue, getRetentionTierRank, classifyRetentionQueue, buildContactLogUrl, buildRetentionContactPayload } from '../lib/retention'

const styles={page:{padding:'24px 28px',minHeight:'100vh'},title:{fontSize:22,fontWeight:800,color:'var(--text)'},sub:{fontSize:13,color:'var(--muted)',marginTop:4},grid:{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:10,margin:'18px 0'},card:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 18px'},section:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:14},head:{padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'},table:{width:'100%',borderCollapse:'collapse',fontSize:13},th:{padding:'9px 12px',textAlign:'left',fontSize:11,color:'var(--muted)',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'},td:{padding:'10px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'},btn:{border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',borderRadius:6,padding:'5px 9px',fontSize:11,cursor:'pointer'},primary:{border:'none',background:'var(--brand)',color:'#fff',borderRadius:6,padding:'6px 10px',fontSize:11,fontWeight:700,cursor:'pointer'},input:{width:'100%',boxSizing:'border-box',background:'var(--surface2)',border:'1px solid var(--border)',color:'var(--text)',padding:'9px 11px',borderRadius:7,fontSize:13},overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,.62)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20},modal:{width:460,maxWidth:'100%',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:22,boxShadow:'0 18px 60px rgba(0,0,0,.35)'}}
const PRIORITY_RANK={FOLLOW_UP:0,AT_RISK:1,CONTACTED_TODAY:2,MONITOR:3,REACTIVATED:4}
const STATUS_COLOR={FOLLOW_UP:'#f85149',AT_RISK:'#d29922',CONTACTED_TODAY:'#3fb950',REACTIVATED:'#58a6ff',MONITOR:'var(--muted)'}
const STATUS_TEXT={FOLLOW_UP:'Follow-up due',AT_RISK:'At risk',CONTACTED_TODAY:'Contacted today',REACTIVATED:'Reactivated',MONITOR:'Monitor'}
const CHANNELS=['WhatsApp','Call','In-person','Other']
const OUTCOMES=['Contacted','No Reply','Replied','Deposited','Reactivated']

function QueueSection({title,icon,rows,empty,navigate,onLog}){
  return <div style={styles.section}><div style={styles.head}><div style={{fontWeight:800,color:'var(--text)'}}>{icon} {title}</div><div style={{fontSize:12,color:'var(--muted)'}}>{rows.length}</div></div>{rows.length?<div style={{overflowX:'auto'}}><table style={styles.table}><thead><tr>{['Player','Tier','Host','Status','Last Contact','Actions'].map(x=><th key={x} style={styles.th}>{x}</th>)}</tr></thead><tbody>{rows.map(v=><tr key={v.id}><td style={styles.td}><button onClick={()=>navigate(`/vips/${v.id}`)} style={{background:'none',border:0,padding:0,color:'var(--text)',fontWeight:700,cursor:'pointer'}}>{v.username}</button></td><td style={styles.td}><span style={{fontWeight:800}}>{v.tier}</span></td><td style={styles.td}>{v.host_assigned||'—'}</td><td style={styles.td}><span style={{fontSize:11,fontWeight:700,color:STATUS_COLOR[v.priority]||'var(--muted)'}}>{v.status}</span></td><td style={styles.td}>{v.last_contact?new Date(v.last_contact).toLocaleDateString('en-MY',{day:'2-digit',month:'short'}):'Never'}</td><td style={styles.td}><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button style={styles.btn} onClick={()=>onLog(v)}>📝 Log</button>{v.whatsapp||v.phone?<a style={{...styles.btn,textDecoration:'none'}} href={waLink(v)} target="_blank" rel="noreferrer">WhatsApp</a>:null}<button style={styles.primary} onClick={()=>navigate(`/vips/${v.id}`)}>Open VIP</button></div></td></tr>)}</tbody></table></div>:<div style={{padding:22,color:'var(--muted)',fontSize:13}}>{empty}</div>}</div>
}
function waLink(v){const raw=(v.whatsapp||v.phone||'').replace(/\D/g,'');return raw?`https://wa.me/${raw}`:'#'}

export default function RetentionQueue(){
  const navigate=useNavigate(); const {profile}=useAuth(); const [rows,setRows]=useState([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('')
  const [logVip,setLogVip]=useState(null); const [logChannel,setLogChannel]=useState('WhatsApp'); const [logOutcome,setLogOutcome]=useState('Contacted'); const [logNotes,setLogNotes]=useState(''); const [logSaving,setLogSaving]=useState(false); const [logError,setLogError]=useState(''); const [logRecoveryAmount,setLogRecoveryAmount]=useState(''); const [logRecoveryCurrency,setLogRecoveryCurrency]=useState('MYR')
  const myName=profile?.full_name||profile?.username||''
  useEffect(()=>{loadQueue()},[profile?.id])
  useEffect(()=>{const handleFocus=()=>loadQueue();window.addEventListener('focus',handleFocus);return()=>window.removeEventListener('focus',handleFocus)},[profile?.id])
  function openQuickLog(v){setLogVip(v);setLogChannel('WhatsApp');setLogOutcome('Contacted');setLogNotes('');setLogError('');setLogRecoveryAmount('');setLogRecoveryCurrency(v.currency||'MYR')}
  function closeQuickLog(){if(logSaving)return;setLogVip(null);setLogNotes('');setLogError('')}
  async function saveQuickLog(){
    if(!logVip||!logNotes.trim()||logSaving)return
    if(logOutcome==='Reactivated'&&(!(Number(logRecoveryAmount)>0)||!logRecoveryCurrency)){
      setLogError('Reactivation requires a valid deposit amount and currency');return
    }
    setLogSaving(true);setLogError('')
    try{
      const nowIso=new Date().toISOString()
      const payload=buildRetentionContactPayload({vip:logVip,profile,channel:logChannel,outcome:logOutcome,notes:logNotes})
      const {error:insertError}=await supabase.from('contact_logs').insert(payload)
      if(insertError)throw insertError
      if(logOutcome==='Reactivated'){
        const {error:reactError}=await supabase.from('reactivation_logs').upsert({
          vip_id:logVip.id,
          username:logVip.username,
          tier:logVip.tier,
          currency:logRecoveryCurrency,
          reactivation_deposit:Number(logRecoveryAmount),
          host_name:profile?.full_name||logVip.host_assigned||null,
          reactivated_month:nowIso.slice(0,7),
          created_at:nowIso,
        },{onConflict:'username,reactivated_month'})
        if(reactError)throw reactError
      }
      setLogVip(null);setLogNotes('');setLogRecoveryAmount('');setLogRecoveryCurrency('MYR')
      await loadQueue()
    }catch(e){console.error(e);setLogError(e?.message||'Unable to save contact log')}finally{setLogSaving(false)}
  }
  async function loadQueue(){
    if(!profile){return}
    setLoading(true);setError('')
    try{
      const today=new Date(); const todayStr=today.toISOString().slice(0,10); const monthStr=todayStr.slice(0,7); const start=new Date(today); start.setDate(start.getDate()-7); const startStr=start.toISOString().slice(0,10)
      let memberQuery=supabase.from('vip_members').select('id,username,tier,host_assigned,currency,phone,whatsapp,days_inactive,last_deposit_date').in('tier',['DIAMOND','PLATINUM','GOLD']).eq('is_excluded',false)
      if(profile?.role==='host'&&myName)memberQuery=memberQuery.eq('host_assigned',myName)
      const {data:members,error:memberError}=await memberQuery
      if(memberError)throw memberError
      const names=(members||[]).map(v=>v.username).filter(Boolean)
      let logs=[],snaps=[],reactivationLogs=[]
      if(names.length){
        const [logResult,snapResult,reactResult]=await Promise.all([
          supabase.from('contact_logs').select('username,logged_at').in('username',names),
          supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit').in('username',names).gte('snapshot_date',startStr).lte('snapshot_date',todayStr),
          supabase.from('reactivation_logs').select('username,reactivated_month').in('username',names).eq('reactivated_month',monthStr),
        ])
        if(logResult.error)throw logResult.error;if(snapResult.error)throw snapResult.error;if(reactResult.error)throw reactResult.error
        logs=logResult.data||[];snaps=snapResult.data||[];reactivationLogs=reactResult.data||[]
      }
      const latest={};logs.forEach(x=>{if(!x?.username||!x?.logged_at)return;if(!latest[x.username]||new Date(x.logged_at)>new Date(latest[x.username]))latest[x.username]=x.logged_at})
      const reactivatedSet=new Set(reactivationLogs.map(x=>x.username).filter(Boolean))
      const byUser={};snaps.forEach(x=>{(byUser[x.username] ||= []).push(x)})
      const built=(members||[]).map(v=>{
        const contact=latest[v.username]||null
        const contactedToday=Boolean(contact&&new Date(contact).toISOString().slice(0,10)===todayStr)
        const due=isFollowUpDue({lastContact:contact,contactedToday},today)
        const ss=(byUser[v.username]||[]).sort((a,b)=>a.snapshot_date.localeCompare(b.snapshot_date))
        const midpoint=Math.ceil(ss.length/2)
        const first=ss.slice(0,midpoint).reduce((n,x)=>n+(Number(x.total_deposit)||0),0)
        const last=ss.slice(midpoint).reduce((n,x)=>n+(Number(x.total_deposit)||0),0)
        const decline=first>0?((last-first)/first)*100:null
        const inactive=Number(v.days_inactive)||0
        const priority=classifyRetentionQueue({tier:v.tier,followUpDue:due,contactedToday,declinePct:decline,daysInactive:inactive,reactivated:reactivatedSet.has(v.username)})
        return {...v,last_contact:contact,follow_up_due:due,contacted_today:contactedToday,decline_pct:decline,priority,status:STATUS_TEXT[priority]||priority}
      })
      setRows(built.sort((a,b)=>getRetentionTierRank(a.tier)-getRetentionTierRank(b.tier)||(PRIORITY_RANK[a.priority]??99)-(PRIORITY_RANK[b.priority]??99)||Number(b.days_inactive||0)-Number(a.days_inactive||0)||String(a.username).localeCompare(String(b.username))))
    }catch(e){console.error(e);setError(e?.message||'Unable to load retention queue')}finally{setLoading(false)}
  }
  const due=useMemo(()=>rows.filter(x=>x.priority==='FOLLOW_UP'),[rows]); const risk=useMemo(()=>rows.filter(x=>x.priority==='AT_RISK'),[rows]); const contacted=useMemo(()=>rows.filter(x=>x.priority==='CONTACTED_TODAY'),[rows]); const reactivated=useMemo(()=>rows.filter(x=>x.priority==='REACTIVATED'),[rows]); const monitor=useMemo(()=>rows.filter(x=>x.priority==='MONITOR'),[rows]); const gold=useMemo(()=>rows.filter(x=>x.tier==='GOLD'),[rows])
  return <div style={styles.page}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}><div><div style={styles.title}>Daily Retention Work Queue</div><div style={styles.sub}>Diamond → Platinum action queue · Gold monitoring · contact-to-reactivation workflow</div></div><button style={styles.primary} onClick={loadQueue}>↻ Refresh</button></div>
    {error&&<div style={{marginTop:14,padding:12,border:'1px solid #f85149',borderRadius:8,color:'#f85149',fontSize:12}}>{error}</div>}
    <div style={styles.grid}><div style={styles.card}><div style={{fontSize:11,color:'var(--muted)'}}>🔴 Follow-up Due</div><div style={{fontSize:28,fontWeight:900}}>{due.length}</div></div><div style={styles.card}><div style={{fontSize:11,color:'var(--muted)'}}>🟠 At Risk</div><div style={{fontSize:28,fontWeight:900}}>{risk.length}</div></div><div style={styles.card}><div style={{fontSize:11,color:'var(--muted)'}}>✅ Contacted Today</div><div style={{fontSize:28,fontWeight:900}}>{contacted.length}</div></div><div style={styles.card}><div style={{fontSize:11,color:'var(--muted)'}}>♻️ Reactivated</div><div style={{fontSize:28,fontWeight:900}}>{reactivated.length}</div></div></div>
    {loading?<div style={styles.card}>Loading retention queue…</div>:<><QueueSection title="Follow-up Due" icon="🔴" rows={due} empty="No Diamond or Platinum follow-up due right now." navigate={navigate} onLog={openQuickLog}/><QueueSection title="At Risk" icon="🟠" rows={risk} empty="No additional Diamond or Platinum at-risk VIPs." navigate={navigate} onLog={openQuickLog}/><QueueSection title="Gold Monitor" icon="🟡" rows={gold.filter(x=>x.priority==='MONITOR')} empty="No Gold monitoring items." navigate={navigate} onLog={openQuickLog}/><QueueSection title="Contacted Today" icon="✅" rows={contacted} empty="No contacts logged yet today." navigate={navigate} onLog={openQuickLog}/><QueueSection title="Reactivated This Month" icon="♻️" rows={reactivated} empty="No reactivated VIPs in this queue this month." navigate={navigate} onLog={openQuickLog}/><div style={{fontSize:11,color:'var(--muted)',padding:'4px 2px'}}>Host scope: {profile?.role==='host'?(myName||'—'):'All hosts'} · Monitor pool: {monitor.length} · Gold: {gold.length}</div></>}
    {logVip&&<div style={styles.overlay} onClick={closeQuickLog}><div style={styles.modal} onClick={e=>e.stopPropagation()}><div style={{fontSize:17,fontWeight:800,color:'var(--text)'}}>Log retention contact</div><div style={{fontSize:12,color:'var(--muted)',marginTop:4,marginBottom:16}}>{logVip.username} · {logVip.tier} · {logVip.host_assigned||'Unassigned'}</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}><div><div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>Channel</div><select style={styles.input} value={logChannel} onChange={e=>setLogChannel(e.target.value)}>{CHANNELS.map(x=><option key={x}>{x}</option>)}</select></div><div><div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>Outcome</div><select style={styles.input} value={logOutcome} onChange={e=>setLogOutcome(e.target.value)}>{OUTCOMES.map(x=><option key={x}>{x}</option>)}</select></div></div>{logOutcome==='Reactivated'&&<><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}><div><div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>Recovery Deposit *</div><input type="number" min="0" step="0.01" style={styles.input} value={logRecoveryAmount} onChange={e=>setLogRecoveryAmount(e.target.value)} placeholder="0.00"/></div><div><div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>Currency *</div><select style={styles.input} value={logRecoveryCurrency} onChange={e=>setLogRecoveryCurrency(e.target.value)}><option value="">Select</option><option value="MYR">MYR</option><option value="SGD">SGD</option><option value="KHUSD">KHUSD</option></select></div></div></>}
<div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>Notes *</div><textarea rows={4} style={{...styles.input,resize:'vertical',fontFamily:'inherit'}} value={logNotes} onChange={e=>setLogNotes(e.target.value)} placeholder="VIP response, mood, promise or follow-up detail..." autoFocus/>{logError&&<div style={{fontSize:12,color:'#f85149',marginTop:8}}>{logError}</div>}<div style={{display:'flex',gap:8,justifyContent:'space-between',alignItems:'center',marginTop:14,flexWrap:'wrap'}}><button style={styles.btn} onClick={()=>navigate(buildContactLogUrl(logVip.username))}>Open full Contact Log</button><div style={{display:'flex',gap:8}}><button style={styles.btn} onClick={closeQuickLog} disabled={logSaving}>Cancel</button><button style={{...styles.primary,opacity:!logNotes.trim()||logSaving?.55:1}} onClick={saveQuickLog} disabled={!logNotes.trim()||logSaving}>{logSaving?'Saving…':'Save Contact'}</button></div></div></div></div>}
  </div>
}
