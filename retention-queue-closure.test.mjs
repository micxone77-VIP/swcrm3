import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyRetentionQueue, buildContactLogUrl } from './src/lib/retention.js'

test('Diamond and Platinum follow-up due stay action-first', () => {
  assert.equal(classifyRetentionQueue({ tier:'DIAMOND', followUpDue:true, contactedToday:false, declinePct:-10, daysInactive:1 }), 'FOLLOW_UP')
  assert.equal(classifyRetentionQueue({ tier:'PLATINUM', followUpDue:true, contactedToday:false, declinePct:0, daysInactive:0 }), 'FOLLOW_UP')
})

test('contacted today leaves the action queue even if still commercially at risk', () => {
  assert.equal(classifyRetentionQueue({ tier:'DIAMOND', followUpDue:false, contactedToday:true, declinePct:-80, daysInactive:9 }), 'CONTACTED_TODAY')
})

test('Gold is monitoring only and does not enter the daily action queue', () => {
  assert.equal(classifyRetentionQueue({ tier:'GOLD', followUpDue:true, contactedToday:false, declinePct:-90, daysInactive:30 }), 'MONITOR')
})

test('reactivated VIP is removed from action queue', () => {
  assert.equal(classifyRetentionQueue({ tier:'PLATINUM', followUpDue:true, contactedToday:false, declinePct:-80, daysInactive:10, reactivated:true }), 'REACTIVATED')
})

test('risk classification applies to Diamond and Platinum when follow-up is not due', () => {
  assert.equal(classifyRetentionQueue({ tier:'DIAMOND', followUpDue:false, contactedToday:false, declinePct:-55, daysInactive:1 }), 'AT_RISK')
  assert.equal(classifyRetentionQueue({ tier:'PLATINUM', followUpDue:false, contactedToday:false, declinePct:null, daysInactive:3 }), 'AT_RISK')
})

test('contact log deep link preserves exact VIP identity and opens new-log form', () => {
  assert.equal(buildContactLogUrl('vip 888+'), '/contacts?view=log&search=vip%20888%2B&vip=vip%20888%2B')
})
