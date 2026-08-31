export const EDITABLE_CAMPAIGN_FIELDS = [
  'campaign_name','campaign_code','festival','start_date','end_date','target_tier',
  'offer_desc','budget_rm','status','notes','deposit_target','gold_bar_value',
  'campaign_type','platform','reward_pct','reward_fixed','reward_cap','reward_delivery',
  'reward_tiers','min_valid_bet','top_n','rank_rewards','min_deposit_lb',
  'settlement_frequency','campaign_category','is_multi_level','max_levels','requires_period_deposit',
  'enrollment_mode','auto_enroll_tiers',
]

export const EMPTY_LEVEL = () => ({
  id: null,
  level_order: 1,
  level_code: '',
  level_name: '',
  deposit_threshold: '',
  reward_amount: '',
  max_reward_pct: 0.05,
  reward_type: 'credit',
  description: '',
})

export function normalizeDate(value) {
  return value ? String(value).slice(0, 10) : ''
}

export function normalizeLevel(level, index = 0, defaultRewardType = 'credit') {
  return {
    ...EMPTY_LEVEL(),
    ...level,
    level_order: Number(level?.level_order) || index + 1,
    max_reward_pct: level?.max_reward_pct == null ? 0.05 : Number(level.max_reward_pct),
    reward_type: level?.reward_type || defaultRewardType,
    deposit_threshold: level?.deposit_threshold ?? '',
    reward_amount: level?.reward_amount ?? '',
  }
}

export function normalizeCampaignForEdit(campaign) {
  const c = campaign || {}
  const form = {}
  for (const key of EDITABLE_CAMPAIGN_FIELDS) form[key] = c[key] ?? null
  form.campaign_name = c.campaign_name || ''
  form.campaign_code = c.campaign_code || ''
  form.platform = c.platform || 'MY'
  form.status = c.status || 'draft'
  form.campaign_type = c.campaign_type || 'gold_bar'
  form.target_tier = Array.isArray(c.target_tier) ? [...c.target_tier] : []
  form.reward_tiers = Array.isArray(c.reward_tiers) ? structuredClone(c.reward_tiers) : []
  form.rank_rewards = Array.isArray(c.rank_rewards) ? structuredClone(c.rank_rewards) : []
  form.top_n = Number(c.top_n) || 3
  form.min_valid_bet = Number(c.min_valid_bet) || 0
  form.min_deposit_lb = Number(c.min_deposit_lb) || 0
  form.max_levels = Number(c.max_levels) || 1
  form.is_multi_level = Boolean(c.is_multi_level)
  form.requires_period_deposit = c.requires_period_deposit == null ? true : Boolean(c.requires_period_deposit)
  form.enrollment_mode = c.enrollment_mode || (form.target_tier.length ? 'auto_tier' : 'manual')
  form.auto_enroll_tiers = Array.isArray(c.auto_enroll_tiers) ? [...c.auto_enroll_tiers] : [...form.target_tier]
  form.start_date = normalizeDate(c.start_date)
  form.end_date = normalizeDate(c.end_date)
  return form
}

export function validateCampaignEditor(form, levels = []) {
  const errors = []
  if (!String(form?.campaign_name || '').trim()) errors.push('Campaign name is required.')
  if (!String(form?.campaign_code || '').trim()) errors.push('Campaign code is required.')
  if (form?.start_date && form?.end_date && form.start_date > form.end_date) errors.push('End date cannot be before start date.')

  if (form?.is_multi_level) {
    if (levels.length < 1) errors.push('A multi-level campaign needs at least one level.')
    const seen = new Set()
    levels.forEach((level, i) => {
      const order = Number(level.level_order) || i + 1
      const threshold = Number(level.deposit_threshold)
      const reward = Number(level.reward_amount)
      if (seen.has(order)) errors.push(`Level order ${order} is duplicated.`)
      seen.add(order)
      if (!(threshold > 0)) errors.push(`Level ${order}: deposit threshold must be greater than 0.`)
      if (!(reward > 0)) errors.push(`Level ${order}: reward amount must be greater than 0.`)
      const cap = Number(level.max_reward_pct)
      if (!(cap > 0 && cap <= 1)) errors.push(`Level ${order}: max reward % must be between 0% and 100%.`)
      if (threshold > 0 && reward > threshold * cap) errors.push(`Level ${order}: reward exceeds its ${cap * 100}% cap.`)
    })
  }

  if (form?.campaign_type === 'pct_reward') {
    const pct = Number(form.reward_pct)
    if (!(pct >= 0)) errors.push('Reward % must be 0 or greater.')
    if (form.reward_cap !== '' && form.reward_cap != null && Number(form.reward_cap) < 0) errors.push('Reward cap cannot be negative.')
  }

  const tiers = Array.isArray(form?.target_tier) ? form.target_tier : []
  if (tiers.some(t => !['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].includes(String(t).toUpperCase()))) {
    errors.push('Target tiers contain an invalid tier.')
  }

  return errors
}

export function buildCampaignUpdate(form) {
  const numeric = (value) => value === '' || value == null ? null : Number(value)
  const type = form.campaign_type || 'gold_bar'
  const targetTiers = Array.isArray(form.target_tier) ? form.target_tier : []
  const enrollmentMode = targetTiers.length && parseManualUserIds(form.manual_user_ids).length ? 'mixed' : targetTiers.length ? 'auto_tier' : 'manual'
  return {
    campaign_name: String(form.campaign_name || '').trim(),
    campaign_code: String(form.campaign_code || '').trim().toUpperCase(),
    festival: form.festival || null,
    start_date: normalizeDate(form.start_date) || null,
    end_date: normalizeDate(form.end_date) || null,
    target_tier: targetTiers.length ? targetTiers : null,
    auto_enroll_tiers: targetTiers.length ? targetTiers : null,
    enrollment_mode: enrollmentMode,
    offer_desc: form.offer_desc || null,
    budget_rm: numeric(form.budget_rm),
    status: form.status || 'draft',
    notes: form.notes || null,
    deposit_target: type === 'leaderboard' || type === 'dual_tier' ? null : numeric(form.deposit_target),
    gold_bar_value: type === 'gold_bar' ? numeric(form.gold_bar_value) : null,
    campaign_type: type,
    platform: form.platform || 'MY',
    reward_pct: type === 'pct_reward' ? numeric(form.reward_pct) : null,
    reward_fixed: type === 'fixed_reward' && !form.is_multi_level ? numeric(form.reward_fixed) : null,
    reward_cap: type === 'pct_reward' ? numeric(form.reward_cap) : null,
    reward_delivery: form.reward_delivery || 'credit',
    reward_tiers: (type === 'tiered_reward' || type === 'dual_tier') && Array.isArray(form.reward_tiers) && form.reward_tiers.length ? form.reward_tiers : null,
    min_valid_bet: type === 'leaderboard' ? numeric(form.min_valid_bet) : null,
    top_n: type === 'leaderboard' ? Number(form.top_n) || 3 : null,
    rank_rewards: type === 'leaderboard' && Array.isArray(form.rank_rewards) ? form.rank_rewards : null,
    min_deposit_lb: type === 'leaderboard' ? numeric(form.min_deposit_lb) : null,
    settlement_frequency: type === 'dual_tier' ? (form.settlement_frequency || 'total') : null,
    campaign_category: form.campaign_category || null,
    is_multi_level: Boolean(form.is_multi_level),
    max_levels: Boolean(form.is_multi_level) ? Number(form.max_levels) || 1 : 1,
    requires_period_deposit: form.requires_period_deposit !== false,
  }
}

export function buildLevelUpsert(level, index, defaultRewardType = 'credit') {
  const row = {
    campaign_id: level.campaign_id,
    level_order: Number(level.level_order) || index + 1,
    level_code: String(level.level_code || '').trim() || null,
    level_name: String(level.level_name || '').trim() || null,
    deposit_threshold: Number(level.deposit_threshold),
    reward_amount: Number(level.reward_amount),
    max_reward_pct: Number(level.max_reward_pct == null ? 0.05 : level.max_reward_pct),
    reward_type: level.reward_type || defaultRewardType,
    description: String(level.description || '').trim() || null,
  }
  if (level.id) row.id = level.id
  return row
}

function parseManualUserIds(value) {
  if (Array.isArray(value)) return [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))]
  return [...new Set(String(value || '').split(/[\s,;]+/).map(v => v.trim()).filter(Boolean))]
}
