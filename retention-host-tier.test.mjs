import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateHostPerformance } from './src/lib/retentionAnalytics.js'

test('host performance separates Diamond, Platinum and Gold recovery', () => {
  const [host] = aggregateHostPerformance([
    {
      host: 'Marcus',
      assignedVips: 10,
      reactivated: 3,
      amounts: [
        { amount: 100, currency: 'MYR' },
        { amount: 50, currency: 'MYR' },
        { amount: 10, currency: 'MYR' },
      ],
      tierRows: [
        { tier: 'DIAMOND', reactivated: 1, amount: 100, currency: 'MYR' },
        { tier: 'PLATINUM', reactivated: 1, amount: 50, currency: 'MYR' },
        { tier: 'GOLD', reactivated: 1, amount: 10, currency: 'MYR' },
      ],
    },
  ])

  assert.equal(host.assignedVips, 10)
  assert.equal(host.reactivated, 3)
  assert.equal(host.reactivationRate, 30)
  assert.equal(host.byTier.DIAMOND.reactivated, 1)
  assert.equal(host.byTier.DIAMOND.recoveredDepositByCurrency.MYR, 100)
  assert.equal(host.byTier.PLATINUM.reactivated, 1)
  assert.equal(host.byTier.PLATINUM.recoveredDepositByCurrency.MYR, 50)
  assert.equal(host.byTier.GOLD.reactivated, 1)
  assert.equal(host.byTier.GOLD.recoveredDepositByCurrency.MYR, 10)
  assert.equal(host.recoveredDepositByCurrency.MYR, 160)
})

test('unassigned reactivation remains visible and retains tier recovery', () => {
  const [host] = aggregateHostPerformance([
    {
      host: 'Unassigned',
      assignedVips: 0,
      reactivated: 1,
      amounts: [{ amount: 250, currency: 'SGD' }],
      tierRows: [{ tier: 'DIAMOND', reactivated: 1, amount: 250, currency: 'SGD' }],
    },
  ])

  assert.equal(host.host, 'Unassigned')
  assert.equal(host.byTier.DIAMOND.reactivated, 1)
  assert.equal(host.byTier.DIAMOND.recoveredDepositByCurrency.SGD, 250)
})
