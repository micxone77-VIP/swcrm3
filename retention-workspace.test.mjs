import assert from 'node:assert/strict'
import {
  daysSince,
  isFollowUpDue,
  getRetentionPriority,
  calculateRate,
  sumByCurrency,
  latestSnapshotMonth,
  resolveSnapshotWindow,
} from './src/lib/retention.js'
import { calculateRetentionMetrics, aggregateHostPerformance } from './src/lib/retentionAnalytics.js'

assert.equal(daysSince('2026-09-01T00:00:00Z', new Date('2026-09-04T00:00:00Z')), 3)
assert.equal(isFollowUpDue({ lastContact: null, contactedToday: false }), true)
assert.equal(isFollowUpDue({ lastContact: '2026-09-01T00:00:00Z', contactedToday: false }, new Date('2026-09-04T00:00:00Z')), true)
assert.equal(isFollowUpDue({ lastContact: '2026-09-02T00:00:00Z', contactedToday: false }, new Date('2026-09-04T00:00:00Z')), false)
assert.equal(getRetentionPriority({ tier: 'DIAMOND', churn_risk: 'CRITICAL', days_inactive: 8 }), 'CRITICAL')
assert.equal(calculateRate(3, 4), 75)
assert.deepEqual(sumByCurrency([
  { amount: 100, currency: 'MYR' },
  { amount: 50, currency: 'MYR' },
  { amount: 20, currency: 'SGD' },
]), { MYR: 150, SGD: 20 })

// Retention defaults to the latest completed snapshot, not the current month when its snapshot is absent.
assert.equal(latestSnapshotMonth(['2026-06', '2026-07', '2026-08'], '2026-09'), '2026-08')
assert.equal(latestSnapshotMonth(['2026-08', '2026-09'], '2026-09'), '2026-09')
assert.equal(latestSnapshotMonth([], '2026-09'), '2026-09')
assert.deepEqual(
  resolveSnapshotWindow(['2026-06', '2026-07', '2026-08'], '2026-09'),
  { selectedMonth: '2026-09', currentMonth: '2026-08', previousMonth: '2026-07', usedFallback: true }
)
assert.deepEqual(
  resolveSnapshotWindow(['2026-06', '2026-07', '2026-08'], '2026-08'),
  { selectedMonth: '2026-08', currentMonth: '2026-08', previousMonth: '2026-07', usedFallback: false }
)

const metrics = calculateRetentionMetrics({
  openingVipCount: 100,
  retainedVipCount: 60,
  churnedVipCount: 40,
  reactivatedVipCount: 10,
  recoveredDeposits: [
    { amount: 1000, currency: 'MYR' },
    { amount: 500, currency: 'SGD' },
  ],
})
assert.equal(metrics.retentionRate, 60)
assert.equal(metrics.churnRate, 40)
assert.equal(metrics.reactivationRate, 10)
assert.deepEqual(metrics.recoveredDepositsByCurrency, { MYR: 1000, SGD: 500 })

const hosts = aggregateHostPerformance([
  { host_assigned: 'Host A', assignedVips: 10, reactivated: 2, amount: 1000, currency: 'MYR' },
  { host_assigned: 'Host A', assignedVips: 10, reactivated: 1, amount: 500, currency: 'MYR' },
  { host_assigned: 'Host B', assignedVips: 5, reactivated: 1, amount: 300, currency: 'SGD' },
])
assert.equal(hosts[0].host, 'Host A')
assert.equal(hosts[0].reactivated, 3)
assert.deepEqual(hosts[0].recoveredDepositByCurrency, { MYR: 1500 })

console.log('retention-workspace tests: PASS')
