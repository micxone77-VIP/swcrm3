export const CAMPAIGN_CREATOR_TYPES = {
  gold_bar: { label:'🥇 Gold Bar' },
  pct_reward: { label:'💰 % Reward' },
  fixed_reward: { label:'🎁 Fixed Reward' },
  tiered_reward: { label:'📊 Tiered % Reward' },
  dual_tier: { label:'🎯 Deposit + Turnover Tiers' },
  leaderboard: { label:'🏆 Leaderboard' },
  tiered_deposit_reward: { label:'🎁 Tiered Deposit Reward' },
}

export function buildCampaignInsert({ campaign_type, campaign_name, campaign_code, countries=[], tiers=[], manualUserIds=[] }) {
  const type = campaign_type === 'tiered_deposit_reward' ? 'fixed_reward' : campaign_type
  return {
    campaign_type: type,
    campaign_name: String(campaign_name || '').trim(),
    campaign_code: String(campaign_code || '').trim(),
    target_countries: countries,
    target_tier: tiers,
    auto_enroll_tiers: tiers,
    enrollment_mode: manualUserIds.length ? 'mixed' : 'auto_tier',
    is_multi_level: campaign_type === 'tiered_deposit_reward',
  }
}

export function buildTieredLevels(levels=[]) {
  return levels.map((level, index) => ({
    level_order: index + 1,
    level_code: String(level.level_code || `L${index + 1}`).trim().toUpperCase(),
    level_name: String(level.level_name || `Level ${index + 1}`).trim(),
    deposit_threshold: Number(level.deposit_threshold) || 0,
    reward_amount: Number(level.reward_amount) || 0,
    max_reward_pct: Number(level.max_reward_pct || 0.05),
    reward_type: 'credit',
    description: String(level.description || '').trim() || null,
  }))
}
