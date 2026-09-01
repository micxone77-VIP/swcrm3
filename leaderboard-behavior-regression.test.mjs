import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const crmSource = fs.readFileSync(new URL('./src/pages/Campaigns.jsx', import.meta.url), 'utf8')

// RED test: a leaderboard must rank by the selected metric, while qualification
// remains a separate rule. Deposit races must never qualify everyone merely
// because min_valid_bet defaults to 0.
test('CRM leaderboard no longer hard-codes valid-bet ranking', () => {
  assert.doesNotMatch(crmSource, /\[\.\.\.players\]\.sort\(\(a,b\)=>\(parseFloat\(b\.valid_bet\)/)
})

test('CRM leaderboard no longer uses OR qualification for deposit races', () => {
  assert.doesNotMatch(crmSource, /vb>=minBet\|\|\(minDep>0&&dep>=minDep\)/)
})

test('CRM leaderboard has metric-aware ranking and qualification branches', () => {
  assert.match(crmSource, /leaderboardMetric/)
  assert.match(crmSource, /rankingValue/)
  assert.match(crmSource, /leaderboard_metric.*deposit/)
  assert.match(crmSource, /leaderboard_metric.*turnover_deposit/)
})

test('CRM campaign detail modal uses a wide desktop layout', () => {
  assert.doesNotMatch(crmSource, /modal:\s*\{[^}]*maxWidth:720/)
  assert.match(crmSource, /modal:\s*\{[^}]*maxWidth:\s*1200/)
})
