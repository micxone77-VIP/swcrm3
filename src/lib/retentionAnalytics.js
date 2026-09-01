import { calculateRate, sumByCurrency } from './retention.js'

export function calculateRetentionMetrics({
  openingVipCount = 0,
  retainedVipCount = 0,
  churnedVipCount = 0,
  reactivatedVipCount = 0,
  recoveredDeposits = [],
}) {
  return {
    retentionRate: calculateRate(retainedVipCount, openingVipCount),
    churnRate: calculateRate(churnedVipCount, openingVipCount),
    reactivationRate: calculateRate(reactivatedVipCount, openingVipCount),
    recoveredDepositsByCurrency: sumByCurrency(recoveredDeposits),
  }
}

export function aggregateHostPerformance(rows = []) {
  const hosts = new Map()
  rows.forEach(row => {
    const host = row?.host_name || row?.host_assigned || row?.host || 'Unassigned'
    const entry = hosts.get(host) || { host, assignedVips: 0, contacts: 0, positiveReplies: 0, deposited: 0, reactivated: 0, recoveredDeposits: [] }
    entry.assignedVips += Number(row?.assignedVips || 0)
    entry.contacts += Number(row?.contacts || 0)
    entry.positiveReplies += Number(row?.positiveReplies || 0)
    entry.deposited += Number(row?.deposited || 0)
    entry.reactivated += Number(row?.reactivated || 0)
    if (Array.isArray(row?.amounts)) entry.recoveredDeposits.push(...row.amounts)
    else if (row?.amount !== undefined) entry.recoveredDeposits.push({ amount: row.amount, currency: row.currency })
    hosts.set(host, entry)
  })
  return [...hosts.values()].map(entry => ({
    ...entry,
    reactivationRate: calculateRate(entry.reactivated, entry.assignedVips),
    recoveredDepositByCurrency: sumByCurrency(entry.recoveredDeposits),
  })).sort((a, b) => b.reactivated - a.reactivated || b.assignedVips - a.assignedVips)
}
