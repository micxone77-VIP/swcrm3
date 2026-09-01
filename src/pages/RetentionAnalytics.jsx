import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateRetentionMetrics, aggregateHostPerformance } from '../lib/retentionAnalytics'
import { resolveSnapshotWindow } from '../lib/retention.js'
import { useLanguage } from '../contexts/LanguageContext'

const monthKey = (date) => { const d = new Date(date); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}` }
const money = (n,c) => `${c || ''} ${Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:2})}`.trim()
const recoveryAmount = row => Number(row?.reactivation_deposit ?? row?.deposit_amount ?? row?.amount ?? 0) || 0
const playerKey = row => String(row?.vip_id || row?.username || row?.id || '').trim().toLowerCase()

function aggregateReactivationLogs(logs = [], stats = []) {
  const grouped = new Map()
  logs.forEach(log => {
    const key = playerKey(log)
    if (!key) return
    const stat = stats.find(s => (log.vip_id && String(s.id) === String(log.vip_id)) || (log.username && String(s.username).trim().toLowerCase() === String(log.username).trim().toLowerCase()))
    const current = grouped.get(key)
    const amount = recoveryAmount(log)
    if (!current) {
      grouped.set(key, {
        ...log,
        id: log.vip_id || stat?.id || log.id,
        username: log.username || stat?.username,
        tier: log.tier || stat?.tier,
        currency: log.currency || stat?.currency,
        host: log.host_name || stat?.host,
        recoveryAmount: amount,
      })
      return
    }
    current.recoveryAmount += amount
    if (!current.currency && log.currency) current.currency = log.currency
    if (!current.host && log.host_name) current.host = log.host_name
  })
  return [...grouped.values()]
}

export default function RetentionAnalytics() {
  const { t } = useLanguage()
  const [month,setMonth]=useState(monthKey(new Date()))
  const [effectiveMonth,setEffectiveMonth]=useState(monthKey(new Date()))
  const [previousSnapshotMonth,setPreviousSnapshotMonth]=useState(null)
  const [usedFallback,setUsedFallback]=useState(false)
  const [rows,setRows]=useState([]), [reactivated,setReactivated]=useState([]), [members,setMembers]=useState([]), [loading,setLoading]=useState(true), [error,setError]=useState('')

  useEffect(()=>{let cancelled=false;async function load(){
    setLoading(true);setError('')
    const latestResult = await supabase.from('vip_monthly_totals').select('snapshot_month').lte('snapshot_month',month).order('snapshot_month',{ascending:false}).limit(1)
    if(cancelled)return
    if(latestResult.error){setError(latestResult.error.message||t('retention.analyticsLoadError'));setLoading(false);return}

    const latestMonth = latestResult.data?.[0]?.snapshot_month || null
    const previousResult = latestMonth
      ? await supabase.from('vip_monthly_totals').select('snapshot_month').lt('snapshot_month',latestMonth).order('snapshot_month',{ascending:false}).limit(1)
      : { data: [], error: null }
    if(cancelled)return
    if(previousResult.error){setError(previousResult.error.message||t('retention.analyticsLoadError'));setLoading(false);return}

    const window = resolveSnapshotWindow([previousResult.data?.[0]?.snapshot_month,latestMonth].filter(Boolean),month)
    const current = window.currentMonth
    const previous = window.previousMonth
    const [m,r,v]=await Promise.all([
      current ? supabase.from('vip_monthly_totals').select('vip_id,username,snapshot_month,total_deposit,currency,tier,host_assigned').in('snapshot_month',[previous,current].filter(Boolean)) : { data: [], error: null },
      current ? supabase.from('reactivation_logs').select('*').eq('reactivated_month',current).order('created_at',{ascending:false}) : { data: [], error: null },
      supabase.from('vip_members').select('id,username,host_assigned,is_excluded').neq('is_excluded',true)
    ])
    if(cancelled)return
    if(m.error||r.error||v.error){setError(m.error?.message||r.error?.message||v.error?.message||t('retention.analyticsLoadError'));setLoading(false);return}
    setRows(m.data||[]);setReactivated(r.data||[]);setMembers(v.data||[])
    setEffectiveMonth(current||month);setPreviousSnapshotMonth(previous);setUsedFallback(Boolean(window.usedFallback));setLoading(false)
  }load();return()=>{cancelled=true}},[month,t])

  const stats=useMemo(()=>{const prev=previousSnapshotMonth,map=new Map();rows.forEach(r=>{const k=r.vip_id||r.username;const x=map.get(k)||{id:k,username:r.username,tier:r.tier,currency:r.currency,host:r.host_assigned,prev:0,current:0};if(r.snapshot_month===prev)x.prev=Number(r.total_deposit)||0;if(r.snapshot_month===effectiveMonth)x.current=Number(r.total_deposit)||0;if(r.host_assigned)x.host=r.host_assigned;map.set(k,x)});return [...map.values()]},[rows,effectiveMonth,previousSnapshotMonth])
  const previousActive=stats.filter(x=>x.prev>0), retained=previousActive.filter(x=>x.current>0), churned=previousActive.filter(x=>x.current<=0)
  const reactivatedRows=useMemo(()=>aggregateReactivationLogs(reactivated,stats),[reactivated,stats])
  const reactivatedCount=reactivatedRows.length
  const metrics=calculateRetentionMetrics({openingVipCount:previousActive.length,retainedVipCount:retained.length,churnedVipCount:churned.length,reactivatedVipCount:reactivatedCount,recoveredDeposits:reactivatedRows.filter(r=>r.recoveryAmount>0).map(r=>({amount:r.recoveryAmount,currency:r.currency}))})
  const hosts=useMemo(()=>{const assignedByHost=new Map();members.forEach(v=>{const host=v.host_assigned||'Unassigned';assignedByHost.set(host,(assignedByHost.get(host)||0)+1)});const reactivatedByHost=new Map();reactivatedRows.forEach(x=>{const host=x.host||'Unassigned';const e=reactivatedByHost.get(host)||{host,reactivated:0,amounts:[]};e.reactivated++;if(x.recoveryAmount>0)e.amounts.push({amount:x.recoveryAmount,currency:x.currency});reactivatedByHost.set(host,e)});const summaries=[];assignedByHost.forEach((assignedVips,host)=>{const r=reactivatedByHost.get(host);summaries.push({host,assignedVips,reactivated:r?.reactivated||0,amounts:r?.amounts||[]})});reactivatedByHost.forEach((r,host)=>{if(!assignedByHost.has(host))summaries.push(r)});return aggregateHostPerformance(summaries)},[members,reactivatedRows])
  if(loading)return <div className="p-8 text-sm opacity-60">{t('retention.loadingAnalytics')}</div>
  if(error)return <div className="rounded-xl border p-6 text-sm">{t('retention.analyticsLoadError')}: {error}</div>
  return <div className="space-y-6"><div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><h1 className="text-2xl font-semibold">📊 {t('retention.analytics')}</h1><p className="mt-1 text-sm opacity-70">{t('retention.analyticsSubtitle')}</p></div><div><label className="mr-2 text-sm opacity-70">{t('retention.reportingMonth')}</label><input aria-label={t('retention.reportingMonth')} type="month" value={month} onChange={e=>setMonth(e.target.value)} className="rounded-lg border bg-transparent px-3 py-2"/></div></div>
    {usedFallback&&<div className="rounded-xl border px-5 py-4 text-sm">{t('retention.snapshotFallback',{month:effectiveMonth})}</div>}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6"><Kpi label={t('retention.previousActive')} value={previousActive.length}/><Kpi label={t('retention.retained')} value={retained.length}/><Kpi label={t('retention.churned')} value={churned.length}/><Kpi label={t('retention.retention')} value={`${metrics.retentionRate}%`}/><Kpi label={t('retention.churn')} value={`${metrics.churnRate}%`}/><Kpi label={t('retention.reactivatedCount')} value={`${reactivatedCount} (${metrics.reactivationRate}%)`}/></div>
    <section className="rounded-xl border"><div className="border-b px-5 py-4 font-medium">{t('retention.reactivatedDeposit')}</div><div className="grid gap-3 p-5 md:grid-cols-3">{Object.entries(metrics.recoveredDepositsByCurrency).map(([currency,amount])=><div key={currency} className="rounded-lg border p-4"><div className="text-xs opacity-60">{currency}</div><div className="mt-1 text-xl font-semibold">{money(amount,currency)}</div></div>)}{!Object.keys(metrics.recoveredDepositsByCurrency).length&&<div className="text-sm opacity-60">{t('retention.noRecovery')}</div>}</div></section>
    <section className="rounded-xl border overflow-hidden"><div className="border-b px-5 py-4 font-medium">{t('retention.hostPerformance')}</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="px-5 py-3">{t('retention.host')}</th><th className="px-5 py-3">{t('retention.assignedVips')}</th><th className="px-5 py-3">{t('retention.reactivatedCount')}</th><th className="px-5 py-3">{t('retention.reactivationRateShort')}</th><th className="px-5 py-3">{t('retention.reactivatedDeposit')}</th></tr></thead><tbody>{hosts.map(h=><tr key={h.host} className="border-b last:border-0"><td className="px-5 py-3 font-medium">{h.host}</td><td className="px-5 py-3">{h.assignedVips || '—'}</td><td className="px-5 py-3">{h.reactivated}</td><td className="px-5 py-3">{h.reactivationRate}%</td><td className="px-5 py-3">{Object.entries(h.recoveredDepositByCurrency).map(([c,a])=><div key={c}>{money(a,c)}</div>)}</td></tr>)}{!hosts.length&&<tr><td colSpan="5" className="p-8 text-center opacity-60">{t('retention.noHostRecords')}</td></tr>}</tbody></table></div></section>
    <div className="rounded-xl border p-5 text-sm opacity-75"><strong>{t('retention.definitions')}:</strong> {t('retention.definitionsText')}</div>
  </div>
}
function Kpi({label,value}){return <div className="rounded-xl border p-5"><div className="text-xs uppercase tracking-wide opacity-60">{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div></div>}
