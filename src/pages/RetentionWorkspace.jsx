import { useMemo, useState } from 'react'
import { calculateRate, getRetentionPriority } from '../lib/retention'

const demoRows = []

export default function RetentionWorkspace() {
  const [view, setView] = useState('overview')
  const [tier, setTier] = useState('ALL')
  const [hideReactivated, setHideReactivated] = useState(true)

  const rows = useMemo(() => demoRows.filter((row) => tier === 'ALL' || row.tier === tier), [tier])
  const churned = rows.filter((row) => !row.reactivated)
  const retained = rows.filter((row) => row.retained)
  const retentionRate = calculateRate(retained.length, rows.length)

  const nav = [
    ['overview', 'Overview'],
    ['churn', 'Churn List'],
    ['reactivated', 'Reactivated'],
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">📉 Monthly Churn</h1>
          <p className="mt-1 text-sm opacity-70">上月有存款，本月至今未存款的玩家</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {nav.map(([key, label]) => (
            <button key={key} onClick={() => setView(key)} className={`rounded-lg px-3 py-2 text-sm ${view === key ? 'bg-blue-600 text-white' : 'border'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Kpi label="上月存款玩家" value={rows.length} />
        <Kpi label="本月流失" value={churned.length} />
        <Kpi label="本月留存" value={retained.length} />
        <Kpi label="Retention Rate" value={`${retentionRate}%`} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
        <label className="text-sm">Tier</label>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className="rounded-lg border bg-transparent px-3 py-2">
          <option value="ALL">All Tiers</option>
          <option value="GOLD">Gold</option>
          <option value="PLATINUM">Platinum</option>
          <option value="DIAMOND">Diamond</option>
          <option value="BLACK">Black</option>
          <option value="SILVER">Silver</option>
          <option value="BRONZE">Bronze</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hideReactivated} onChange={(e) => setHideReactivated(e.target.checked)} />
          Hide reactivated
        </label>
      </div>

      {view === 'overview' && <EmptyState title="Monthly Retention Overview" text="Select a month pair after the data connector is wired." />}
      {view === 'churn' && <ChurnTable rows={hideReactivated ? churned : rows} />}
      {view === 'reactivated' && <EmptyState title="Reactivated" text="Reactivation results will appear here from the existing reactivation log." />}
    </div>
  )
}

function Kpi({ label, value }) {
  return <div className="rounded-xl border p-5"><div className="text-xs uppercase tracking-wide opacity-60">{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div></div>
}

function ChurnTable({ rows }) {
  return <div className="overflow-hidden rounded-xl border"><div className="border-b px-5 py-4 font-medium">玩家名单 <span className="ml-2 text-sm opacity-60">{rows.length}</span></div>{rows.length === 0 ? <div className="p-8 text-center text-sm opacity-60">No churn players for the selected filters.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="px-5 py-3">Player</th><th className="px-5 py-3">Tier</th><th className="px-5 py-3">Days</th><th className="px-5 py-3">Priority</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="px-5 py-3">{row.username}</td><td className="px-5 py-3">{row.tier}</td><td className="px-5 py-3">{row.days_inactive}</td><td className="px-5 py-3">{getRetentionPriority(row)}</td></tr>)}</tbody></table></div>}</div>
}

function EmptyState({ title, text }) {
  return <div className="rounded-xl border p-10 text-center"><div className="text-lg font-medium">{title}</div><div className="mt-2 text-sm opacity-60">{text}</div></div>
}
