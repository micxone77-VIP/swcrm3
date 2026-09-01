import assert from 'node:assert/strict'
import {
  daysSince,
  isFollowUpDue,
  getRetentionPriority,
  calculateRate,
  sumByCurrency,
} from './src/lib/retention.js'

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

console.log('retention-workspace tests: PASS')
