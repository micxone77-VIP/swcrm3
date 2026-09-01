import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateRetentionMetrics, aggregateHostPerformance } from '../lib/retentionAnalytics'

const monthKey = (date) => { const d = new Date(date); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}` }
const previousMonth = (month) => { const [y,m] = month.split('-').map(Number); return monthKey(new Date(Date.UTC(y,m-2,1))) }
const money = (n,c) => `${c || ''} ${Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:2})}`.trim()

export default function RetentionAnalytics() {
  const [month,setMonth]=useState(monthKey(new Date()))
  const [rows,setRows]=useState([]), [reactivated,setReactivated]=useState([]), [loading,setLoading]=useState(true), [error,setError]=useState('')
  useEffect(()=>{let cancelled=false;async function load(){setLoading(true);setError('');const prev=previousMonth(month);const [m,r]=await Promise.all([
    supabase.from('vip_monthly_totals').select('vip_id,username,snapshot_month,total_deposit,currency,tier,host_assigned').in('snapshot_month',[prev,month]),
    supabase.from('reactivation_logs').select('vip_id,username,tier,host_name,reactivated_month').eq('reactivated_month',month)
  ]);if(cancelled)return;if(m.error||r.error){setError(m.error?.message||r.error?.message||'Unable to load retention analytics');setLoading(false);return}setRows(m.data||[]);setReactivated(r.data||[]);setLoading(false)}load();return()=>{cancelled=true}},[month])
  const stats=useMemo(()=>{const prev=previousMonth(month),map=new Map();rows.forEach(r=>{const k=r.vip_id||r.username;const x=map.get(k)||{id:k,username:r.username,tier:r.tier,currency:r.currency,host:r.host_assigned,prev:0,current:0};if(r.snapshot_month===prev)x.prev=Number(r.total_deposit)||0;if(r.snapshot_month===month)x.current=Number(r.total_deposit)||0;map.set(k,x)});return [...map.values()]},[rows,month])
  const previousActive=stats.filter(x=>x.prev>0), retained=previousActive.filter(x=>x.current>0), churned=previousActive.filter(x=>x.current<=0)
  const reactivationSet=new Set(reactivated.map(r=>r.vip_id||r.username)), reactivatedRows=stats.filter(x=>reactivationSet.has(x.id)||reactivationSet.has(x.username))
  const metrics=calculateRetentionMetrics({openingVipCount:previousActive.length,retainedVipCount:retained.length,churnedVipCount:churned.length,reactivatedVipCount:reactivatedRows.length,recoveredDeposits:reactivatedRows.map(x=>({amount:x.current,currency:x.currency}))})
  const hosts=useMemo(()=>aggregateHostPerformance(reactivatedRows.map(x=>({host_assigned:x.host,reactivated:1,amount:x.current,currency:x.currency}))),[reactivatedRows])
  if(loading)return <div className="p-8 text-sm opacity-60">Loading retention analytics…</div>
  if(error)return <div className="rounded-xl border p-6 text-sm">Unable to load retention analytics: {error}</div>
  return <div className="space-y-6"><div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><h1 className="text-2xl font-semibold">📊 Retention Analytics</h1><p className="mt-1 text-sm opacity-70">Retention, churn, reactivation and host recovery performance</p></div><input aria-label="Reporting month" type="month" value={month} onChange={e=>setMonth(e.target.value)} className="rounded-lg border bg-transparent px-3 py-2"/></div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6"><Kpi label="Previous Active" value={previousActive.length}/><Kpi label="Retained" value={retained.length}/><Kpi label="Churned" value={churned.length}/><Kpi label="Retention" value={`${metrics.retentionRate}%`}/><Kpi label="Churn" value={`${metrics.churnRate}%`}/><Kpi label="Reactivated" value={`${reactivatedRows.length} (${metrics.reactivationRate}%)`}/></div>
    <section className="rounded-xl border"><div className="border-b px-5 py-4 font-medium">Recovered Deposit</div><div className="grid gap-3 p-5 md:grid-cols-3">{Object.entries(metrics.recoveredDepositsByCurrency).map(([currency,amount])=><div key={currency} className="rounded-lg border p-4"><div className="text-xs opacity-60">{currency}</div><div className="mt-1 text-xl font-semibold">{money(amount,currency)}</div></div>)}{!Object.keys(metrics.recoveredDepositsByCurrency).length&&<div className="text-sm opacity-60">No reactivated deposit found for this month.</div>}</div></section>
    <section className="rounded-xl border overflow-hidden"><div className="border-b px-5 py-4 font-medium">Host Performance</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="px-5 py-3">Host</th><th className="px-5 py-3">Assigned VIPs</th><th className="px-5 py-3">Reactivated</th><th className="px-5 py-3">Reactivation Rate</th><th className="px-5 py-3">Recovered Deposit</th></tr></thead><tbody>{hosts.map(h=><tr key={h.host} className="border-b last:border-0"><td className="px-5 py-3 font-medium">{h.host}</td><td className="px-5 py-3">{h.assignedVips || '—'}</td><td className="px-5 py-3">{h.reactivated}</td><td className="px-5 py-3">{h.reactivationRate}%</td><td className="px-5 py-3">{Object.entries(h.recoveredDepositByCurrency).map(([c,a])=><div key={c}>{money(a,c)}</div>)}</td></tr>)}{!hosts.length&&<tr><td colSpan="5" className="p-8 text-center opacity-60">No reactivation records for this month.</td></tr>}</tbody></table></div></section>
    <div className="rounded-xl border p-5 text-sm opacity-75"><strong>Definitions:</strong> Retention = retained ÷ previous-month active VIPs. Churn = churned ÷ previous-month active VIPs. Reactivation = reactivated ÷ previous-month active VIPs. Recovery amounts remain separated by currency.</div>
  </div>
}
function Kpi({label,value}){return <div className="rounded-xl border p-5"><div className="text-xs uppercase tracking-wide opacity-60">{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div></div>}
