import assert from 'node:assert/strict'
import { buildCampaignSummary, buildPayoutRows } from '../src/lib/campaignMetrics.js'

const levels = [
  { id:'l1', level_order:1, level_name:'Bronze', deposit_threshold:31000, reward_amount:1388 },
  { id:'l2', level_order:2, level_name:'Silver', deposit_threshold:80000, reward_amount:3888 },
  { id:'l3', level_order:3, level_name:'Gold', deposit_threshold:169000, reward_amount:6888 },
]
const players = [{ id:'p1', username:'_testauth_login' }]
const playerLevels = [
  { campaign_player_id:'p1', campaign_level_id:'l1', status:'unlocked' },
  { campaign_player_id:'p1', campaign_level_id:'l2', status:'in_progress' },
]
const rewards = [
  { id:'r1', campaign_player_id:'p1', campaign_level_id:'l1', reward_amount:1388, status:'pending' },
  { id:'r2', campaign_player_id:'p1', campaign_level_id:'l2', reward_amount:3888, status:'pending' },
]

const summary = buildCampaignSummary(players, levels, playerLevels, rewards)
assert.equal(summary.rewardRows, 1)
assert.equal(summary.pendingReward, 1388)
assert.equal(summary.totalReward, 1388)

const payoutRows = buildPayoutRows(players, levels, playerLevels, rewards)
assert.equal(payoutRows.length, 1)
assert.equal(payoutRows[0].rewardAmount, 1388)

console.log('PASS: locked reward rows are excluded from payout summary')
