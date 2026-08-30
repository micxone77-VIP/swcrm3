import assert from 'node:assert/strict'
import { buildCampaignUpdate, buildLevelUpsert, normalizeCampaignForEdit, validateCampaignEditor } from '../src/lib/campaignEditor.js'

const campaign = {
  campaign_name: 'MERDEKA 31•8•69', campaign_code: 'MERDEKA-2026', campaign_type: 'deposit_reward',
  platform: 'MY', target_tier: ['PLATINUM','DIAMOND'], start_date: '2026-08-15T00:00:00Z',
  end_date: '2026-08-31T00:00:00Z', budget_rm: 10000, reward_tiers: [], rank_rewards: null,
  is_multi_level: true, max_levels: 3, requires_period_deposit: true, status: 'active',
}

const form = normalizeCampaignForEdit(campaign)
assert.equal(form.start_date, '2026-08-15')
assert.deepEqual(form.target_tier, ['PLATINUM','DIAMOND'])
assert.equal(form.is_multi_level, true)
assert.equal(form.max_levels, 3)

const levels = [
  { id:'a', level_order:1, level_code:'CODE31', level_name:'Level 1', deposit_threshold:31000, reward_amount:1388, max_reward_pct:.05, reward_type:'cash' },
  { id:'b', level_order:2, level_code:'CODE8', level_name:'Level 2', deposit_threshold:80000, reward_amount:3888, max_reward_pct:.05, reward_type:'cash' },
  { id:'c', level_order:3, level_code:'CODE69', level_name:'Level 3', deposit_threshold:169000, reward_amount:6888, max_reward_pct:.05, reward_type:'cash' },
]
assert.deepEqual(validateCampaignEditor(form, levels), [])
assert.match(validateCampaignEditor({ ...form, campaign_name:'' }, levels)[0], /Campaign name/)
assert.match(validateCampaignEditor(form, [{ ...levels[0], reward_amount:2000 }])[0], /exceeds/)

const update = buildCampaignUpdate({ ...form, campaign_type:'pct_reward', festival:'Merdeka', reward_pct:'5', reward_cap:'5000', target_tier:['GOLD'] })
assert.equal(update.campaign_code, 'MERDEKA-2026')
assert.equal(update.start_date, '2026-08-15')
assert.equal(update.reward_cap, 5000)
assert.deepEqual(update.target_tier, ['GOLD'])

const upsert = buildLevelUpsert({ ...levels[0], campaign_id:'camp-1', reward_amount:'1388' }, 0)
assert.equal(upsert.campaign_id, 'camp-1')
assert.equal(upsert.reward_amount, 1388)
assert.equal(upsert.level_order, 1)

console.log('campaignEditor tests: PASS')
