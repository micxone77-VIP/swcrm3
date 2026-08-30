import assert from 'node:assert/strict'
import {
  UNLOCKED_LEVEL_STATUSES,
  buildMultiLevelPlayerMetrics,
  buildPayoutRows,
  buildCampaignSummary,
} from '../src/lib/campaignMetrics.js'

const levels = [
  { id: 'l1', level_order: 1, level_name: 'Bronze', deposit_threshold: 31000, reward_amount: 1388, reward_type: 'credit' },
  { id: 'l2', level_order: 2, level_name: 'Silver', deposit_threshold: 80000, reward_amount: 3888, reward_type: 'credit' },
  { id: 'l3', level_order: 3, level_name: 'Gold', deposit_threshold: 169000, reward_amount: 6888, reward_type: 'credit' },
]
const player = { id: 'p1', username: '_testauth_login', tier: 'GOLD', campaign_period_deposit: 82000, total_deposit: 82000, payout_status: 'pending' }
const playerLevels = [
  { campaign_player_id: 'p1', campaign_level_id: 'l1', status: 'unlocked', unlocked_at: '2026-08-29T10:00:00Z' },
  { campaign_player_id: 'p1', campaign_level_id: 'l2', status: 'unlocked', unlocked_at: '2026-08-29T11:00:00Z' },
  { campaign_player_id: 'p1', campaign_level_id: 'l3', status: 'in_progress', unlocked_at: null },
]
const rewards = [
  { id: 'r1', campaign_player_id: 'p1', campaign_level_id: 'l1', reward_amount: 1388, status: 'pending' },
  { id: 'r2', campaign_player_id: 'p1', campaign_level_id: 'l2', reward_amount: 3888, status: 'pending' },
]

assert(UNLOCKED_LEVEL_STATUSES.has('unlocked'))
assert(!UNLOCKED_LEVEL_STATUSES.has('in_progress'))

const metrics = buildMultiLevelPlayerMetrics(player, levels, playerLevels)
assert.equal(metrics.completedCount, 2)
assert.equal(metrics.nextLevel.id, 'l3')
assert.equal(metrics.allCompleted, false)
assert.equal(metrics.qualifiedRewardTotal, 5276)

const payoutRows = buildPayoutRows([player], levels, playerLevels, rewards)
assert.equal(payoutRows.length, 2)
assert.deepEqual(payoutRows.map(r => r.levelId), ['l1', 'l2'])
assert.equal(payoutRows.reduce((s, r) => s + r.rewardAmount, 0), 5276)

const summary = buildCampaignSummary([player], levels, playerLevels, rewards)
assert.equal(summary.players, 1)
assert.equal(summary.unlockedLevels, 2)
assert.equal(summary.pendingReward, 5276)
assert.equal(summary.paidReward, 0)
assert.equal(summary.successRate, 0)

console.log('PASS: campaign metrics')

// ROI is based on real campaign P&L divided by reward cost.
import { calculateCampaignROI } from '../src/lib/campaignMetrics.js'
assert.equal(calculateCampaignROI(1388, -1388), -100)
assert.equal(calculateCampaignROI(1000, 500), 50)
assert.equal(calculateCampaignROI(0, 0), null)
