import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { isFollowUpDue, getRetentionTierRank } from '../lib/retention'
import { formatMoney } from '../lib/format'

const styles={page:{padding:'24px 28px',minHeight:'100vh'},title:{fontSize:22,fontWeight:800,color:'var(--text)'},sub:{fontSize:13,color:'var(--muted)',marginTop:4},grid:{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:10,margin:'18px 0'},card:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 18px'},section:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:14},head:{padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'},table:{width:'100%',borderCollapse:'collapse',fontSize:13},th:{padding:'9px 12px',textAlign:'left',fontSize:11,color:'var(--muted)',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'},td:{padding:'10px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'},btn:{border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',borderRadius:6,padding:'5px 9px',fontSize:11,cursor:'pointer'},primary:{border:'none',background:'var(--brand)',color:'#fff',borderRadius:6,padding:'6px 10px',fontSize:11,fontWeight:700,cursor:'pointer'}}

function QueueSection({title,icon,rows,empty,navigate,onContacts}){
  return <div style={styles.section}><div style={styles.head}><div style={{fontWeight:800,color:'var(--text)'}}>{icon} {title}</div><div style={{fontSize:12,color:'var(--muted)'}}>{rows.length}</div></div>{rows.length?<div style={{overflowX:'auto'}}><table style={styles.table}><thead><tr>{['Player','Tier','Host','Status','Last Contact','Actions'].map(x=><th key={x} style={styles.th}>{x}</th>)}</tr></thead><tbody>{rows.map(v=><tr key={v.id}><td style={styles.td}><button onClick={()=>navigate(`/vips/${v.id}`)} style={{background:'none',border:0,padding:0,color:'var(--text)',fontWeight:700,cursor:'pointer'}}>{v.username}</button></td><td style={styles.td}><span style={{fontWeight:800}}>{v.tier}</span></td><td style={styles.td}>{v.host||'—'}</td><td style={styles.td}><span style={{fontSize:11,fontWeight:700,color:v.priority==='FOLLOW_UP'?'#f85149':v.priority==='AT_RISK'?'#d29922':'var(--muted)'}}>{v.status}</span></td><td style={styles.td}>{v.last_contact?new Date(v.last_contact).toLocaleDateString('en-MY',{day:'2-digit',month:'short'}):'Never'}</td><td style={styles.td}><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button style={styles.btn} onClick={onContacts}>📝 Log</button>{v.whatsapp||v.phone?<a style={{...styles.btn,textDecoration:'none'}} href={waLink(v)} target="_blank" rel="noreferrer">WhatsApp</a>:null}<button style={styles.primary} onClick={()=>navigate(`/vips/${v.id}`)}>Open VIP</button></div></td></tr>)}</tbody></table></div>:<div style={{padding:22,color:'var(--muted)',fontSize:13}}>{empty}</div>}</div>
}

function waLink(v){const raw=(v.whatsapp||v.phone||'').replace(/\D/g,'');return raw?`https://wa.me/${raw}`:'#'}

export default function RetentionQueue(){
  const navigate=useNavigate(); const {profile}=useAuth(); const [rows,setRows]=useState([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('')
  useEffect(()=>{loadQueue()},[])
  async function loadQueue(){
    setLoading(true);setError('')
    try{
      const today=new Date(); const todayStr=today.toISOString().slice(0,10); const start=new Date(today); start.setDate(start.getDate()-7); const startStr=start.toISOString().slice(0,10)
      const {data:members,error:memberError}=await supabase.from('vip_members').select('id,username,tier,host_assigned,currency,phone,whatsapp,days_inactive,last_deposit_date').in('tier',['DIAMOND','PLATINUM','GOLD']).eq('is_excluded',false)
      if(memberError)throw memberError
      const names=(members||[]).map(v=>v.username).filter(Boolean)
      let logs=[]
      if(names.length){const {data,error:logError}=await supabase.from('contact_logs').select('username,logged_at').in('username',names);if(logError)throw logError;logs=logError?[]:(data||[])}
      const latest={};logs.forEach(x=>{if(!x?.username||!x?.logged_at)return;if(!latest[x.username]||new Date(x.logged_at)>new Date(latest[x.username]))latest[x.username]=x.logged_at})
      let snaps=[]
      if(names.length){const {data,error:snapError}=await supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit').in('username',names).gte('snapshot_date',startStr).lte('snapshot_date',todayStr);if(snapError)throw snapError;snaps=data||[]}
      const byUser={};snaps.forEach(x=>{(byUser[x.username] ||= []).push(x)})
      const built=(members||[]).map(v=>{
        const contact=latest[v.username]||null; const contactedToday=Boolean(contact&&new Date(contact).toISOString().slice(0,10)===todayStr); const due=isFollowUpDue({lastContact:contact,contactedToday},today); const ss=(byUser[v.username]||[]).sort((a,b)=>a.snapshot_date.localeCompare(b.snapshot_date)); const recent=ss.filter(x=>x.snapshot_date>=startStr); const first=recent.slice(0,Math.ceil(recent.length/2)).reduce((n,x)=>n+(Number(x.total_deposit)||0),0); const last=recent.slice(Math.ceil(recent.length/2)).reduce((n,x)=>n+(Number(x.total_deposit)||0),0); const decline=first>0?((last-first)/first)*100:null; const inactive=Number(v.days_inactive)||0; const atRisk=(decline!==null&&decline<=-50)||inactive>=3; const priority=due?'FOLLOW_UP':atRisk?'AT_RISK':'MONITOR'; return {...v,last_contact:contact,follow_up_due:due,contacted_today:contactedToday,decline_pct:decline,priority,status:due?'Follow-up due':atRisk?'At risk':'Monitor'}
      })
      setRows(built.sort((a,b)=>getRetentionTierRank(a.tier)-getRetentionTierRank(b.tier)||Number(b.follow_up_due)-Number(a.follow_up_due)||Number(b.days_inactive||0)-Number(a.days_inactive||0)))
    }catch(e){console.error(e);setError(e?.message||'Unable to load retention queue')}finally{setLoading(false)}
  }
  const due=useMemo(()=>rows.filter(x=>x.priority==='FOLLOW_UP'),[rows]); const risk=useMemo(()=>rows.filter(x=>x.priority==='AT_RISK'&&!x.follow_up_due),[rows]); const monitor=useMemo(()=>rows.filter(x=>x.priority==='MONITOR'),[rows]); const diamond=useMemo(()=>rows.filter(x=>x.tier==='DIAMOND'),[rows]); const platinum=useMemo(()=>rows.filter(x=>x.tier==='PLATINUM'),[rows]); const gold=useMemo(()=>rows.filter(x=>x.tier==='GOLD'),[rows])
  const myName=profile?.full_name||''
  return <div style={styles.page}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}><div><div style={styles.title}>Daily Retention Work Queue</div><div style={styles.sub}>Diamond → Platinum → Gold · action-first host workflow</div></div><button style={styles.primary} onClick={loadQueue}>↻ Refresh</button></div>
    {error&&<div style={{marginTop:14,padding:12,border:'1px solid #f85149',borderRadius:8,color:'#f85149',fontSize:12}}>{error}</div>}
    <div style={styles.grid}><div style={styles.card}><div style={{fontSize:11,color:'var(--muted)'}}>🔴 Follow-up Due</div><div style={{fontSize:28,fontWeight:900}}>{due.length}</div></div><div style={styles.card}><div style={{fontSize:11,color:'var(--muted)'}}>🟠 At Risk</div><div style={{fontSize:28,fontWeight:900}}>{risk.length}</div></div><div style={styles.card}><div style={{fontSize:11,color:'var(--muted)'}}>💎 Diamond</div><div style={{fontSize:28,fontWeight:900}}>{diamond.length}</div></div><div style={styles.card}><div style={{fontSize:11,color:'var(--muted)'}}>🔷 Platinum</div><div style={{fontSize:28,fontWeight:900}}>{platinum.length}</div></div></div>
    {loading?<div style={styles.card}>Loading retention queue…</div>:<><QueueSection title="Follow-up Due" icon="🔴" rows={due} empty="No follow-up due right now." navigate={navigate} onContacts={()=>navigate('/contacts')}/><QueueSection title="At Risk" icon="🟠" rows={risk} empty="No additional at-risk VIPs." navigate={navigate} onContacts={()=>navigate('/contacts')}/><QueueSection title="Gold Monitor" icon="🟡" rows={gold.filter(x=>x.priority==='MONITOR')} empty="No Gold monitoring items." navigate={navigate} onContacts={()=>navigate('/contacts')}/><div style={{fontSize:11,color:'var(--muted)',padding:'4px 2px'}}>Host: {myName||'—'} · Monitor pool: {monitor.length} · Platinum: {platinum.length} · Gold: {gold.length}</div></>}
  </div>
}
