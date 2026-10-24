// src/lib/campaignImpact.js — "did the campaign work?"
// Data: supabase.rpc('campaign_impact', { p_campaign_id }) → windows + per-player sums for
//   before (window days before start) / during (campaign) / after (window days after end)
//   window = max(campaign length, 7 days). Players: t=true → in this campaign; t=false → comparison group
//   (same currency + tier, not in this campaign, not in another campaign running at the same time).
// Method: difference-in-differences per player-day
//   effect = campaign players' actual − (their own 'before' level × comparison group's % change)
//   so a platform-wide good/bad week does not count as campaign effect.
import { supabase } from './supabase'
import { IMPACT_METRICS, summarizeImpact, VERDICT, LASTING } from './campaignImpactCore'

export { IMPACT_METRICS, summarizeImpact, VERDICT, LASTING }

export async function loadImpact(campaignId) {
  const { data, error } = await supabase.rpc('campaign_impact', { p_campaign_id: campaignId })
  if (error) throw error
  return data
}

// Save the reward cost so the Scorecard can show ROI for every campaign without opening it
export async function saveImpactCost(campaignId, costByCur, prev) {
  const clean = {}
  Object.entries(costByCur || {}).forEach(([c, v]) => { if (Number.isFinite(Number(v))) clean[c] = Math.round(Number(v) * 100) / 100 })
  if (!Object.keys(clean).length) return
  const same = prev && Object.keys(clean).every(c => Number(prev.byCur?.[c]) === clean[c]) && Object.keys(prev.byCur || {}).length === Object.keys(clean).length
  if (same) return
  await supabase.from('campaigns').update({ impact_cost: { byCur: clean, at: new Date().toISOString() } }).eq('id', campaignId)
}
