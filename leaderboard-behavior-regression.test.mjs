import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const crmSource = fs.readFileSync(new URL('./src/pages/Campaigns.jsx', import.meta.url), 'utf8')

// RED test: a leaderboard must rank by the selected metric, while qualification
// remains a separate rule. Deposit races must never qualify everyone merely
// because min_valid_bet defaults to 0.
test('CRM leaderboard ranking uses selected metric and separates qualification', () => {
  assert.match(crmSource, /leaderboardMetric/)
  assert.match(crmSource, /rankingValue/)
  assert.match(crmSource, /leaderboard_metric.*deposit/)
  assert.match(crmSource, /leaderboard_metric.*turnover_deposit/)
  assert.match(crmSource, /qualified.*minDepLb/)
})

test('CRM campaign detail modal uses a wide desktop layout', () => {
  assert.match(crmSource, /maxWidth:\s*1200/)
})
