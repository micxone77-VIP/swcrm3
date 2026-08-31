import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCampaignAudience, parseManualUserIds } from '../src/lib/campaignEnrollment.js'

test('auto-enrolls all players from selected tiers', () => {
  const players = [
    { id: '1', username: 'gold01', tier: 'GOLD', is_excluded: false },
    { id: '2', username: 'plat01', tier: 'PLATINUM', is_excluded: false },
    { id: '3', username: 'silver01', tier: 'SILVER', is_excluded: false },
  ]
  const result = buildCampaignAudience(players, ['GOLD', 'PLATINUM'], [])
  assert.deepEqual(result.map(p => p.username), ['gold01', 'plat01'])
  assert.equal(result.length, 2)
})

test('mixes tier audience with manual user IDs and deduplicates', () => {
  const players = [
    { id: '1', username: 'gold01', tier: 'GOLD', is_excluded: false },
    { id: '2', username: 'plat01', tier: 'PLATINUM', is_excluded: false },
    { id: '3', username: 'black01', tier: 'BLACK', is_excluded: false },
  ]
  const result = buildCampaignAudience(players, ['GOLD'], ['plat01', 'black01', 'gold01'])
  assert.deepEqual(result.map(p => p.username), ['gold01', 'plat01', 'black01'])
  assert.deepEqual(result.map(p => p.enrollment_source), ['both', 'manual', 'manual'])
})

test('marks a manual player already matched by tier as both sources', () => {
  const players = [{ id: '1', username: 'gold01', tier: 'GOLD', is_excluded: false }]
  const result = buildCampaignAudience(players, ['GOLD'], ['gold01'])
  assert.equal(result.length, 1)
  assert.equal(result[0].enrollment_source, 'both')
})

test('ignores excluded players from tier enrollment but permits valid manual players', () => {
  const players = [
    { id: '1', username: 'gold01', tier: 'GOLD', is_excluded: true },
    { id: '2', username: 'plat01', tier: 'PLATINUM', is_excluded: false },
  ]
  const result = buildCampaignAudience(players, ['GOLD', 'PLATINUM'], ['gold01'])
  assert.deepEqual(result.map(p => p.username), ['plat01'])
})

test('parses comma, newline and whitespace separated manual IDs', () => {
  assert.deepEqual(parseManualUserIds(' ABC123, VIP888\nUSER001\nVIP888 '), ['ABC123', 'VIP888', 'USER001'])
})
