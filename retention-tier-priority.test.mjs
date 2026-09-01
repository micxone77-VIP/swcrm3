import test from 'node:test'
import assert from 'node:assert/strict'
import { getRetentionTierRank, isPriorityRetentionTier, sortRetentionPlayers } from './src/lib/retention.js'

test('Diamond ranks above Platinum, Gold, Silver and Bronze', () => {
  assert.ok(getRetentionTierRank('DIAMOND') < getRetentionTierRank('PLATINUM'))
  assert.ok(getRetentionTierRank('PLATINUM') < getRetentionTierRank('GOLD'))
  assert.ok(getRetentionTierRank('GOLD') < getRetentionTierRank('SILVER'))
  assert.ok(getRetentionTierRank('SILVER') < getRetentionTierRank('BRONZE'))
})

test('Diamond and Platinum are priority retention tiers', () => {
  assert.equal(isPriorityRetentionTier('DIAMOND'), true)
  assert.equal(isPriorityRetentionTier('PLATINUM'), true)
  assert.equal(isPriorityRetentionTier('GOLD'), false)
  assert.equal(isPriorityRetentionTier('SILVER'), false)
  assert.equal(isPriorityRetentionTier('BRONZE'), false)
})

test('sortRetentionPlayers puts focus tiers first, then risk and inactivity', () => {
  const rows = [
    { username: 'gold-high', tier: 'GOLD', churn_risk: 'HIGH', days_inactive: 30 },
    { username: 'diamond-normal', tier: 'DIAMOND', churn_risk: 'NORMAL', days_inactive: 2 },
    { username: 'platinum-high', tier: 'PLATINUM', churn_risk: 'HIGH', days_inactive: 5 },
    { username: 'diamond-high', tier: 'DIAMOND', churn_risk: 'HIGH', days_inactive: 10 },
    { username: 'gold-normal', tier: 'GOLD', churn_risk: 'NORMAL', days_inactive: 8 },
  ]
  const sorted = sortRetentionPlayers(rows).map(row => row.username)
  assert.deepEqual(sorted, ['diamond-high', 'diamond-normal', 'platinum-high', 'gold-high', 'gold-normal'])
})
