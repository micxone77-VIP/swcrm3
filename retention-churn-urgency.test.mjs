import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateChurnUrgency } from './src/lib/retention.js'

test('churn urgency accumulates independent risk signals', () => {
  const result = calculateChurnUrgency({ declinePct: -60, daysSinceDeposit: 5, depletionDays: 2, netWinLoss3d: -3000, memberInactiveDays: 0 })
  assert.equal(result.urgencyScore, 8)
  assert.deepEqual(result.reasons, ['deposit_decline', 'no_recent_deposit', 'balance_depletion', 'recent_net_loss'])
})

test('member inactivity fallback creates urgency when snapshot deposit date is unavailable', () => {
  const result = calculateChurnUrgency({ declinePct: null, daysSinceDeposit: null, depletionDays: 0, netWinLoss3d: 0, memberInactiveDays: 7 })
  assert.equal(result.urgencyScore, 2)
  assert.deepEqual(result.reasons, ['member_inactive'])
})
