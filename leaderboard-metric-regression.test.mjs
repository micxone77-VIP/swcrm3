import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const editorSource = fs.readFileSync(new URL('./src/lib/campaignEditor.js', import.meta.url), 'utf8')
const createSource = fs.readFileSync(new URL('./src/pages/CampaignsUnifiedCreator.jsx', import.meta.url), 'utf8')
const campaignSource = fs.readFileSync(new URL('./src/pages/Campaigns.jsx', import.meta.url), 'utf8')

test('campaign editor persists leaderboard metric', () => {
  assert.match(editorSource, /leaderboard_metric/)
  assert.match(editorSource, /turnover_deposit/)
  assert.match(editorSource, /type === 'leaderboard'/)
})

test('campaign creator offers all three leaderboard metric modes', () => {
  assert.match(createSource, /LEADERBOARD METRIC/)
  assert.match(createSource, /Turnover Race/)
  assert.match(createSource, /Deposit Race/)
  assert.match(createSource, /Turnover \+ Deposit Race/)
})

test('campaign creator persists selected leaderboard metric', () => {
  assert.match(createSource, /leaderboard_metric:form\.campaign_type==='leaderboard'\?form\.leaderboard_metric:'turnover'/)
})

test('campaign editor exposes leaderboard metric for existing campaigns', () => {
  assert.match(campaignSource, /LEADERBOARD METRIC/)
  assert.match(campaignSource, /value=\{editCampForm\.leaderboard_metric\}/)
  assert.match(campaignSource, /Turnover Race/)
  assert.match(campaignSource, /Deposit Race/)
  assert.match(campaignSource, /Turnover \+ Deposit Race/)
})

test('campaign editor wires leaderboard metric changes into the edit form', () => {
  assert.match(campaignSource, /leaderboard_metric:e\.target\.value/)
})
