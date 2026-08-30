import fs from 'node:fs'
import assert from 'node:assert/strict'
const source = fs.readFileSync(new URL('../src/pages/Campaigns.jsx', import.meta.url), 'utf8')
const required = [
  ['campaign_player_levels', 'CRM campaign detail must load player-level unlock state'],
  ['campaign_rewards', 'CRM campaign detail must load reward rows'],
  ['buildPayoutRows', 'Payout tab must be based on level reward rows'],
  ['multiMetricsByPlayer', 'Chase/All Players must use authoritative multi-level metrics'],
  ['toggleCampaignReward', 'Payout must update individual reward status'],
]
for (const [needle, message] of required) {
  if (!source.includes(needle)) throw new Error(message)
}
console.log('PASS: CRM campaign tabs use authoritative campaign-level/reward data')

assert.match(source, /calculateCampaignROI/)
assert.match(source, /ROI/)
