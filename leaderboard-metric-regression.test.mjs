import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const editorSource = fs.readFileSync(new URL('./src/lib/campaignEditor.js', import.meta.url), 'utf8')
const createSource = fs.readFileSync(new URL('./src/pages/CampaignsUnifiedCreator.jsx', import.meta.url), 'utf8')
const campaignSource = fs.readFileSync(new URL('./src/pages/Campaigns.jsx', import.meta.url), 'utf8')


test('campaign editor persists leaderboard metric', () => {
  assert.match(editorSource, /leaderboard_metric/)
  assert.match(editorSource, /turnover_deposit/)
})

test('campaign creator offers all three leaderboard metric modes', () => {
  assert.match(createSource, /Turnover Race/)
  assert.match(createSource, /Deposit Race/)
  assert.match(createSource, /Turnover \+ Deposit Race/)
})

test('campaign editor exposes the metric only for leaderboard campaigns', () => {
  assert.match(campaignSource, /editCampForm\.campaign_type==='leaderboard'/)
  assert.match(campaignSource, /leaderboard_metric/)
})
