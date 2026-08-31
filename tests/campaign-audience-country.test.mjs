import test from 'node:test'
import assert from 'node:assert/strict'
import { countryFromPlayer, buildFilteredCampaignAudience } from '../src/lib/campaignAudience.js'

test('maps VIP currency to campaign country', () => {
  assert.equal(countryFromPlayer({ currency:'MYR' }), 'MY')
  assert.equal(countryFromPlayer({ currency:'SGD' }), 'SG')
  assert.equal(countryFromPlayer({ currency:'KHUSD' }), 'KH')
})

test('filters automatic enrollment by country and tier together', () => {
  const players = [
    { username:'mygold', tier:'GOLD', currency:'MYR', is_excluded:false },
    { username:'sggold', tier:'GOLD', currency:'SGD', is_excluded:false },
    { username:'khgold', tier:'GOLD', currency:'KHUSD', is_excluded:false },
    { username:'myplat', tier:'PLATINUM', currency:'MYR', is_excluded:false },
  ]
  const result = buildFilteredCampaignAudience(players, ['MY','SG'], ['GOLD'], [])
  assert.deepEqual(result.map(p => p.username), ['mygold','sggold'])
})

test('supports MY + SG while excluding KH', () => {
  const players = [
    { username:'mygold', tier:'GOLD', currency:'MYR', is_excluded:false },
    { username:'sggold', tier:'GOLD', currency:'SGD', is_excluded:false },
    { username:'khgold', tier:'GOLD', currency:'KHUSD', is_excluded:false },
  ]
  const result = buildFilteredCampaignAudience(players, ['MY','SG'], ['GOLD'], [])
  assert.equal(result.length, 2)
  assert.equal(result.some(p => p.username === 'khgold'), false)
})

test('manual IDs bypass country and tier filters but excluded players stay excluded', () => {
  const players = [
    { username:'khblack', tier:'BLACK', currency:'KHUSD', is_excluded:false },
    { username:'excluded', tier:'GOLD', currency:'MYR', is_excluded:true },
  ]
  const result = buildFilteredCampaignAudience(players, ['MY'], ['GOLD'], ['khblack','excluded'])
  assert.deepEqual(result.map(p => p.username), ['khblack'])
  assert.equal(result[0].enrollment_source, 'manual')
})
