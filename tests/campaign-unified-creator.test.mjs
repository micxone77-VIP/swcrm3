import test from 'node:test'
import assert from 'node:assert/strict'
import { CAMPAIGN_CREATOR_TYPES, buildCampaignInsert, buildTieredLevels } from '../src/lib/campaignCreatorModel.js'

test('unified creator exposes every existing campaign type plus tiered deposit reward', () => {
  assert.deepEqual(Object.keys(CAMPAIGN_CREATOR_TYPES), [
    'gold_bar', 'pct_reward', 'fixed_reward', 'tiered_reward', 'dual_tier', 'leaderboard', 'tiered_deposit_reward'
  ])
})

test('tiered deposit reward stores fixed_reward + multi-level without creating a second campaign type', () => {
  const row = buildCampaignInsert({ campaign_type:'tiered_deposit_reward', campaign_name:'Merdeka', countries:['MY','SG'], tiers:['GOLD','PLATINUM'] })
  assert.equal(row.campaign_type, 'fixed_reward')
  assert.equal(row.is_multi_level, true)
  assert.deepEqual(row.target_countries, ['MY','SG'])
  assert.deepEqual(row.target_tier, ['GOLD','PLATINUM'])
  assert.equal(row.enrollment_mode, 'auto_tier')
})

test('manual IDs switch mixed campaign enrollment mode', () => {
  const row = buildCampaignInsert({ campaign_type:'pct_reward', campaign_name:'Cashback', countries:['MY'], tiers:['GOLD'], manualUserIds:['VIP001'] })
  assert.equal(row.enrollment_mode, 'mixed')
})

test('tiered deposit levels are normalized as fixed credit levels', () => {
  const levels = buildTieredLevels([
    { deposit_threshold:'10000', reward_amount:'150', level_name:'Level 1' },
    { deposit_threshold:'50000', reward_amount:'3000', level_name:'Level 2' },
  ])
  assert.deepEqual(levels.map(x => [x.level_order, x.deposit_threshold, x.reward_amount, x.reward_type]), [
    [1, 10000, 150, 'credit'], [2, 50000, 3000, 'credit']
  ])
})
