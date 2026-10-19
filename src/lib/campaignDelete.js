// src/lib/campaignDelete.js — delete a campaign and everything attached to it
// (players, daily entries, rewards, levels, streak bonuses, flyers incl. stored files).
// Most child tables also cascade in the DB; deleting explicitly keeps the order safe.
import { supabase } from './supabase'

export async function deleteCampaignCascade(campaignId) {
  // flyers: remove stored files first (the table rows cascade, the files would not)
  const { data: media } = await supabase.from('campaign_media').select('path').eq('campaign_id', campaignId)
  const paths = (media || []).map(m => m.path)
  if (paths.length) await supabase.storage.from('campaign-media').remove(paths)

  await supabase.from('daily_turnover_entries').delete().eq('campaign_id', campaignId)
  const { data: cpRows } = await supabase.from('campaign_players').select('id').eq('campaign_id', campaignId)
  const cpIds = (cpRows || []).map(r => r.id)
  for (let i = 0; i < cpIds.length; i += 200) {
    const ids = cpIds.slice(i, i + 200)
    await supabase.from('campaign_rewards').delete().in('campaign_player_id', ids)
    await supabase.from('campaign_player_levels').delete().in('campaign_player_id', ids)
  }
  await supabase.from('campaign_streak_bonuses').delete().eq('campaign_id', campaignId)
  await supabase.from('campaign_players').delete().eq('campaign_id', campaignId)
  await supabase.from('campaign_levels').delete().eq('campaign_id', campaignId)
  const { error } = await supabase.from('campaigns').delete().eq('id', campaignId)
  if (error) throw error
}

// Asks the user to type the campaign name (prevents deleting the wrong one by accident)
export function confirmCampaignDelete(campaign, lang) {
  const zh = lang === 'zh'
  const typed = window.prompt(zh
    ? `删除「${campaign.campaign_name}」？\n所有玩家、派发记录和海报都会一起删除，无法恢复。\n\n请输入活动名称确认：`
    : `Delete "${campaign.campaign_name}"?\nAll its players, payout records and flyers are deleted too. This cannot be undone.\n\nType the campaign name to confirm:`)
  if (typed === null) return false
  if (typed.trim().toLowerCase() !== String(campaign.campaign_name).trim().toLowerCase()) {
    window.alert(zh ? '名称不符，未删除。' : 'Name does not match — nothing was deleted.')
    return false
  }
  return true
}
