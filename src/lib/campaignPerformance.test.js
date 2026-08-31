import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveMetricValue, rankLeaderboard } from './campaignPerformance.js'

test('manual override wins over system value', () => {
  assert.equal(resolveMetricValue(48500, null), 48500)
  assert.equal(resolveMetricValue(48500, 50000), 50000)
})

test('leaderboard ranks by final turnover', () => {
  const rows = rankLeaderboard([
    { username: 'A', turnover: 900 },
    { username: 'B', turnover: 1200 },
    { username: 'C', turnover: 1000 },
  ], 2)
  assert.deepEqual(rows.map(r => r.username), ['B', 'C', 'A'])
  assert.deepEqual(rows.slice(0, 2).map(r => r.rank), [1, 2])
  assert.deepEqual(rows.slice(0, 2).map(r => r.inTop), [true, true])
})
