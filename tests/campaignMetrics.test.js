import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCampaignSummary, buildPayoutRows } from '../src/lib/campaignMetrics.js'

test('campaign summary ignores reward rows outside the selected campaign', () => {
  const players=[{id:'p1',username:'P1'}], levels=[{id:'l1',campaign_id:'c1',level_order:1,level_name:'Bronze',deposit_threshold:31000,reward_amount:100}]
  const playerLevels=[{campaign_player_id:'p1',campaign_level_id:'l1',status:'unlocked'}]
  const rewards=[{id:'r1',campaign_player_id:'p1',campaign_level_id:'l1',reward_amount:100,status:'pending'},{id:'r2',campaign_player_id:'p2',campaign_level_id:'l2',reward_amount:9999,status:'paid'}]
  const summary=buildCampaignSummary(players,levels,playerLevels,rewards)
  assert.equal(summary.rewardRows,1); assert.equal(summary.pendingReward,100); assert.equal(summary.paidReward,0); assert.equal(summary.totalReward,100)
})

test('payout rows ignore rewards outside the selected campaign player and levels', () => {
  const players=[{id:'p1',username:'P1'}], levels=[{id:'l1',campaign_id:'c1',level_order:1,level_name:'Bronze',deposit_threshold:31000,reward_amount:100}]
  const playerLevels=[{campaign_player_id:'p1',campaign_level_id:'l1',status:'unlocked'}]
  const rewards=[{id:'r1',campaign_player_id:'p1',campaign_level_id:'l1',reward_amount:100,status:'pending'},{id:'r2',campaign_player_id:'p2',campaign_level_id:'l2',reward_amount:9999,status:'paid'}]
  assert.deepEqual(buildPayoutRows(players,levels,playerLevels,rewards).map(r=>r.rewardId),['r1'])
})


test('Campaigns loader scopes dependent rows to selected campaign players', () => {
  const source = fs.readFileSync(new URL('../src/pages/Campaigns.jsx', import.meta.url), 'utf8')
  assert.match(source, /\.from\('campaign_players'\)[\s\S]*?\.eq\('campaign_id', campId\)/)
  assert.equal((source.match(/\.in\('campaign_player_id', playerIds\)/g) || []).length, 2)
  assert.doesNotMatch(source, /from\('campaign_rewards'\)\.select\([^)]*\)\s*,\s*supabase\.from\('campaign_player_levels'/s)
})
