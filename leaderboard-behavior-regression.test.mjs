import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const crmSource = fs.readFileSync(new URL('./src/pages/Campaigns.jsx', import.meta.url), 'utf8')

// Regression coverage for metric-aware ranking, qualification separation, and the wide campaign modal.
test('CRM leaderboard no longer hard-codes valid-bet ranking', () => {
  assert.doesNotMatch(crmSource, /\[\.\.\.players\]\.sort\(\(a,b\)=>\(parseFloat\(b\.valid_bet\)/)
})

test('CRM leaderboard no longer uses OR qualification for deposit races', () => {
  assert.doesNotMatch(crmSource, /vb>=minBet\|\|\(minDep>0&&dep>=minDep\)/)
})

test('CRM leaderboard has metric-aware ranking and qualification branches', () => {
  assert.match(crmSource, /const leaderboardMetric/)
  assert.match(crmSource, /leaderboardRankingValue/)
  assert.match(crmSource, /leaderboard_metric[\s\S]*deposit/)
  assert.match(crmSource, /leaderboard_metric[\s\S]*turnover_deposit/)
  assert.match(crmSource, /leaderboardMetric === 'turnover_deposit'[\s\S]*&& dep >= minDepLb/)
  assert.match(crmSource, /const rank = i \+ 1/)
})

test('CRM campaign detail modal uses a wide desktop layout', () => {
  assert.doesNotMatch(crmSource, /modal:\s*\{[^}]*maxWidth:720/)
  assert.match(crmSource, /modal:\s*\{[^}]*maxWidth:\s*1200/)
})
