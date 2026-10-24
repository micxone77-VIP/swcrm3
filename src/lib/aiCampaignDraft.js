// src/lib/aiCampaignDraft.js — builds a COMPLETE campaign draft for Ask Data (functions/api/chat.js),
// with the same fields, defaults and checks as the Campaigns page creators
// (CampaignsUnifiedCreator.jsx + ChallengeCreator.jsx), so a confirmed draft can launch without editing.
// Pure: no Supabase calls. The DB function ai_apply_action('create_campaign_draft') saves it.
import { CAMPAIGN_GUIDE } from './campaignGuide'
import { defaultChallengeConfig, suggestForPlayer, periodDates, num } from './challengeEngine'
import { defaultDailyConfig } from './dailyMilestone'
import { validateCampaignEditor } from './campaignEditor'

// kind = what the user picks on the Campaigns page (guide key); campaign_type = what is stored
export const DRAFT_KINDS = {
  challenge_daily:       { type: 'challenge', mode: 'daily_milestone', en: 'Daily Milestone (challenge)', zh: '每日流水里程碑（挑战）' },
  challenge_trust:       { type: 'challenge', mode: 'trust_credit', en: 'Trust Credit Challenge', zh: '信任金挑战' },
  challenge_rebate:      { type: 'challenge', mode: 'rebate', en: 'Rebate Challenge', zh: '返水挑战' },
  dual_tier:             { type: 'dual_tier', en: 'Deposit + Turnover Tiers', zh: '存款 + 流水阶梯' },
  tiered_deposit_reward: { type: 'fixed_reward', en: 'Tiered Deposit Reward (levels)', zh: '阶梯存款奖励（多级）' },
  tiered_reward:         { type: 'tiered_reward', en: 'Tiered % Reward', zh: '阶梯 % 奖励' },
  pct_reward:            { type: 'pct_reward', en: '% Reward', zh: '% 奖励' },
  fixed_reward:          { type: 'fixed_reward', en: 'Fixed Reward', zh: '固定奖励' },
  gold_bar:              { type: 'gold_bar', en: 'Gold Bar / Gift', zh: '金条 / 礼品' },
  leaderboard:           { type: 'leaderboard', en: 'Leaderboard', zh: '排行榜' },
}

// Which kind fits which goal — given to the AI together with the page's own guide text
export const GOAL_TO_KIND = `Pick the campaign kind by the goal:
- Daily play habit, reward each day's TURNOVER with fixed credits + streak → challenge_daily
- Daily DEPOSIT reward by deposit size (each day settled on its own, fixed credit per tier, optional streak) → dual_tier with settlement "daily" (turnover thresholds 0 if only deposit counts). There is no "% of each day's deposit" type: convert % into fixed credits per tier (e.g. 30k × 3% = 900).
- Reward the TOTAL deposit of the whole period with a % that rises by band → tiered_reward
- One simple % cashback above one deposit target → pct_reward
- Fixed credits at several deposit milestones over the period → tiered_deposit_reward
- Reward real play: deposit AND turnover together (whole period) → dual_tier with settlement "total"
- Competition, top N by turnover/deposit win prizes → leaderboard
- Win back valuable players after big losses, upfront trust credit + task → challenge_trust
- Rebate % of turnover when a personal target is hit, plus deposit streak → challenge_rebate
- One big gift for one big deposit target → gold_bar
- Single fixed credit above one target → fixed_reward`

export function kindGuideText() {
  return Object.entries(DRAFT_KINDS).map(([k, v]) => {
    const g = CAMPAIGN_GUIDE[k]
    return `• ${k} — ${v.en}: ${g ? g.logic.en.replace(/\s+/g, ' ').slice(0, 420) : ''}`
  }).join('\n')
}

const TIERS = ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE']
const n0 = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
const fmt = v => (v == null ? '—' : Number(v).toLocaleString('en-US'))

// input = the AI tool arguments. Returns { campaign, levels, cfg, kind, errors, warnings, summary }
export function buildCampaignDraft(input, todayYmd) {
  const a = input || {}
  const kind = DRAFT_KINDS[a.kind] ? a.kind : null
  const errors = [], warnings = []
  if (!kind) return { errors: [`Unknown kind "${a.kind}". Use one of: ${Object.keys(DRAFT_KINDS).join(', ')}`] }
  const K = DRAFT_KINDS[kind]
  const platform = a.platform === 'SG' ? 'SG' : a.platform === 'MY' ? 'MY' : null
  if (!platform) errors.push('platform must be MY or SG (one currency per campaign)')
  const tiers = (a.target_tiers || []).map(t => String(t).toUpperCase()).filter(t => TIERS.includes(t))
  if (!a.start_date || !a.end_date) errors.push('start_date and end_date are required')
  else if (a.end_date < a.start_date) errors.push('end_date is before start_date')
  else if (todayYmd && a.start_date < todayYmd) errors.push(`start_date is in the past (today is ${todayYmd})`)
  const days = periodDates(a.start_date, a.end_date).length || 1
  const allInTiers = a.audience !== 'list'
  if (allInTiers && !tiers.length) errors.push('audience "all_in_tiers" needs target_tiers')
  if (!allInTiers && !(a.usernames || []).length) errors.push('audience "list" needs usernames')

  const base = {
    campaign_type: K.type,
    campaign_name: String(a.campaign_name || '').trim(),
    platform, target_countries: platform ? [platform] : ['MY'],
    target_tier: tiers.length ? tiers : null,
    start_date: a.start_date || null, end_date: a.end_date || null,
    budget_rm: n0(a.budget_rm), offer_desc: a.offer_desc || null, notes: a.notes || null,
    reward_delivery: a.reward_delivery === 'wcash' ? 'wcash' : 'credit',
    turnover_multiplier: n0(a.turnover_multiplier),
    whatsapp_template: a.whatsapp_template || null, whatsapp_template_zh: a.whatsapp_template_zh || null,
  }
  // Same enrolment rule as the unified creator: tiers → auto-enrol; challenges always use an explicit list
  if (K.type !== 'challenge') {
    Object.assign(base, allInTiers
      ? { enrollment_mode: 'auto_tier', auto_enroll_tiers: tiers }
      : { enrollment_mode: 'manual', auto_enroll_tiers: null, target_tier: tiers.length ? tiers : null })
  }

  let campaign = { ...base }, levels = [], cfg = null
  const rows = []   // [label en, label zh, value] for the confirm card

  if (kind === 'gold_bar') {
    campaign.deposit_target = n0(a.deposit_target); campaign.gold_bar_value = n0(a.gold_bar_value)
    if (!(campaign.deposit_target > 0)) errors.push('deposit_target is required')
    if (!(campaign.gold_bar_value > 0)) errors.push('gold_bar_value (gift value) is required')
    rows.push(['Deposit target', '存款门槛', fmt(campaign.deposit_target)], ['Gift value', '礼品价值', fmt(campaign.gold_bar_value)])
  } else if (kind === 'pct_reward') {
    campaign.deposit_target = n0(a.deposit_target); campaign.reward_pct = n0(a.reward_pct); campaign.reward_cap = n0(a.reward_cap)
    if (!(campaign.deposit_target > 0)) errors.push('deposit_target is required')
    if (!(campaign.reward_pct > 0)) errors.push('reward_pct is required')
    rows.push(['Deposit target', '存款门槛', fmt(campaign.deposit_target)], ['Reward', '奖励', `${campaign.reward_pct}% of deposit`], ['Cap per player', '每人上限', fmt(campaign.reward_cap)])
  } else if (kind === 'fixed_reward') {
    campaign.deposit_target = n0(a.deposit_target); campaign.reward_fixed = n0(a.reward_fixed)
    if (!(campaign.deposit_target > 0)) errors.push('deposit_target is required')
    if (!(campaign.reward_fixed > 0)) errors.push('reward_fixed is required')
    rows.push(['Deposit target', '存款门槛', fmt(campaign.deposit_target)], ['Reward', '奖励', fmt(campaign.reward_fixed)])
  } else if (kind === 'tiered_deposit_reward') {
    levels = (a.levels || []).map(l => ({ deposit_threshold: n0(l.deposit_threshold), reward_amount: n0(l.reward_amount), level_name: l.level_name || '' }))
      .filter(l => l.deposit_threshold > 0).sort((x, y) => x.deposit_threshold - y.deposit_threshold)
      .map((l, i) => ({ level_order: i + 1, level_code: `L${i + 1}`, level_name: l.level_name || `Level ${i + 1}`, deposit_threshold: l.deposit_threshold,
                        reward_amount: l.reward_amount, max_reward_pct: 0.05, reward_type: 'credit', description: null }))
    if (!levels.length) errors.push('levels are required (deposit_threshold + reward_amount each)')
    Object.assign(campaign, { is_multi_level: true, max_levels: levels.length, deposit_target: levels[0]?.deposit_threshold || null,
      reward_fixed: levels[0]?.reward_amount || null, payout_mode: a.payout_mode === 'highest_only' ? 'highest_only' : 'all' })
    rows.push(['Payout', '发放方式', campaign.payout_mode === 'highest_only' ? 'Highest level only' : 'Every level reached'])
  } else if (kind === 'tiered_reward') {
    const t = (a.tiers || []).map(x => ({ min: n0(x.min), max: n0(x.max), pct: n0(x.pct) })).filter(x => x.min > 0 && x.pct > 0).sort((x, y) => x.min - y.min)
    t.forEach((x, i) => { if (i < t.length - 1) x.max = t[i + 1].min - 1; else x.max = null })   // no gaps / overlaps, top band open
    if (!t.length) errors.push('tiers are required (min + pct each)')
    campaign.reward_tiers = t.map(x => ({ min: String(x.min), max: x.max == null ? '' : String(x.max), pct: String(x.pct) }))
    campaign.deposit_target = t[0]?.min || null
  } else if (kind === 'dual_tier') {
    const t = (a.dual_tiers || []).map(x => ({ d: n0(x.deposit) || 0, t: n0(x.turnover) || 0, c: n0(x.credit) || 0, w: n0(x.wcash) || 0 }))
      .filter(x => (x.d > 0 || x.t > 0) && (x.c > 0 || x.w > 0)).sort((x, y) => (x.d - y.d) || (x.t - y.t))
    if (!t.length) errors.push('dual_tiers are required (deposit and/or turnover threshold + credit/wcash)')
    campaign.reward_tiers = t.map(x => ({ depositThreshold: String(x.d), turnoverThreshold: String(x.t), creditAmount: String(x.c), wcashAmount: String(x.w) }))
    campaign.settlement_frequency = a.settlement === 'daily' ? 'daily' : 'total'
    campaign.deposit_target = null
    const s = a.streak || {}
    Object.assign(campaign, { streak_enabled: !!s.enabled, streak_days: Math.max(1, Math.round(num(s.days) || 3)),
      streak_bonus_type: s.type === 'fixed' ? 'fixed' : 'pct', streak_bonus_pct: num(s.pct ?? 1), streak_bonus_fixed: num(s.fixed), streak_bonus_cap: num(s.cap) })
    rows.push(['Settlement', '结算', campaign.settlement_frequency === 'daily' ? 'Every day on its own' : 'Whole period total'])
    if (campaign.streak_enabled) rows.push(['Streak bonus', '连续奖励', campaign.streak_bonus_type === 'pct'
      ? `${campaign.streak_days} days in a row → ${campaign.streak_bonus_pct}% of those days' deposits${campaign.streak_bonus_cap ? ` (cap ${fmt(campaign.streak_bonus_cap)})` : ''}`
      : `${campaign.streak_days} days in a row → ${fmt(campaign.streak_bonus_fixed)}`])
  } else if (kind === 'leaderboard') {
    const topN = Math.max(1, Math.round(num(a.top_n) || (a.rank_rewards || []).length || 3))
    const ranks = (a.rank_rewards || []).map((r, i) => ({ rank: Math.round(num(r.rank) || i + 1), amount: num(r.amount) })).filter(r => r.amount > 0).sort((x, y) => x.rank - y.rank).slice(0, topN)
    if (ranks.length !== topN) errors.push(`rank_rewards must list a prize for each of the top ${topN} ranks`)
    Object.assign(campaign, { leaderboard_metric: ['turnover', 'deposit', 'turnover_deposit'].includes(a.metric) ? a.metric : 'turnover',
      top_n: topN, rank_rewards: ranks, min_valid_bet: n0(a.min_valid_bet) || 0, min_deposit_lb: n0(a.min_deposit) || 0, deposit_target: null })
    rows.push(['Ranked by', '排名依据', campaign.leaderboard_metric], ['Minimum valid bet', '最低有效投注', fmt(campaign.min_valid_bet)], ['Minimum deposit', '最低存款', fmt(campaign.min_deposit_lb)])
  } else if (kind === 'challenge_daily') {
    const d = defaultDailyConfig()
    const tiersIn = (a.daily_tiers || []).map(x => ({ turnover: num(x.turnover), reward: num(x.reward) })).filter(x => x.turnover > 0 && x.reward > 0).sort((x, y) => x.turnover - y.turnover)
    cfg = { ...d, tiers: tiersIn.length ? tiersIn : d.tiers,
      streak_enabled: a.streak_enabled ?? d.streak_enabled, streak_days: Math.max(1, Math.round(num(a.streak_days) || d.streak_days)),
      streak_style: a.streak_style === 'block' ? 'block' : 'rolling', streak_pct: num(a.streak_pct ?? d.streak_pct), streak_cap: num(a.streak_cap ?? d.streak_cap),
      near_pct: d.near_pct, turnover_multiplier: num(a.turnover_multiplier ?? d.turnover_multiplier), reward_label: a.reward_delivery === 'wcash' ? 'WCash' : 'Credit' }
    if (!tiersIn.length) warnings.push('No daily tiers given — using the standard tiers (30K→158 … 800K→3,888).')
    Object.assign(campaign, { challenge_config: cfg, enrollment_mode: 'manual', auto_enroll_tiers: null, streak_enabled: false, requires_period_deposit: false,
      deposit_target: null, min_valid_bet: cfg.tiers[0]?.turnover || null, notes: (a.notes ? a.notes + ' · ' : '') + 'Daily Milestone 每日流水里程碑' })
    rows.push(['Streak', '连续奖励', cfg.streak_enabled ? `${cfg.streak_days} days (${cfg.streak_style}) → ${cfg.streak_pct}% of deposits on those days${cfg.streak_cap ? `, cap ${fmt(cfg.streak_cap)}` : ''}` : 'Off'],
              ['Reward turnover requirement', '奖励流水要求', `×${cfg.turnover_multiplier}`])
  } else {   // challenge_trust / challenge_rebate
    const d = defaultChallengeConfig(K.mode)
    const keys = Object.keys(d).filter(k => k !== 'mode')
    cfg = { ...d }
    for (const k of keys) if (a.challenge?.[k] !== undefined && a.challenge?.[k] !== null && a.challenge?.[k] !== '') cfg[k] = typeof d[k] === 'number' ? num(a.challenge[k]) : a.challenge[k]
    Object.assign(campaign, { challenge_config: cfg, enrollment_mode: 'manual', auto_enroll_tiers: null, streak_enabled: false, requires_period_deposit: false,
      deposit_target: cfg.goal_metric !== 'turnover' ? num(cfg.target_deposit_default) : null,
      min_valid_bet: cfg.goal_metric !== 'deposit' ? num(cfg.target_turnover_default) : null,
      notes: (a.notes ? a.notes + ' · ' : '') + (K.mode === 'trust_credit' ? 'Trust Credit Challenge 信任金挑战' : 'Rebate Challenge 返水挑战') })
    rows.push(
      ['Upfront credit', '预先信用额', cfg.credit_enabled ? `${cfg.credit_suggest_pct_of_loss}% of 30-day loss (default ${fmt(cfg.credit_default)}, max ${fmt(cfg.credit_cap)})` : 'No'],
      ['Goal', '任务目标', `${cfg.goal_metric} — personal target = avg daily × ${days} days × ${cfg.target_suggest_multiplier}`],
      ['When completed', '完成后', cfg.completion_type === 'fixed' ? `fixed ${fmt(cfg.completion_fixed)}` : cfg.completion_type === 'none' ? 'no reward' : `${cfg.completion_pct}% of turnover (${cfg.completion_type})${cfg.completion_cap ? `, cap ${fmt(cfg.completion_cap)}` : ''}`],
      ['Streak', '连续奖励', cfg.streak_enabled ? `deposit ≥ ${fmt(cfg.streak_min_daily_deposit)} on ${cfg.streak_min_days} days → ${cfg.streak_bonus_type === 'fixed' ? fmt(cfg.streak_bonus_fixed) : cfg.streak_bonus_pct + '% of period deposits'}${cfg.streak_bonus_cap ? `, cap ${fmt(cfg.streak_bonus_cap)}` : ''}` : 'Off'])
  }

  // Same checks as editing a campaign on the Campaigns page
  if (K.type !== 'challenge') {
    for (const e of validateCampaignEditor({ ...campaign, campaign_code: 'AI-DRAFT', target_tier: campaign.target_tier || [] }, levels)) errors.push(e)
  }
  if (!campaign.campaign_name) errors.push('campaign_name is required')
  if (campaign.budget_rm == null) warnings.push('No budget set.')

  const summary = {
    kind, kind_en: K.en, kind_zh: K.zh, days, platform, currency: platform === 'SG' ? 'SGD' : 'MYR',
    rows,
    tier_table: kind === 'tiered_reward' ? { cols: ['Deposit from', 'to', 'Reward %'], rows: (campaign.reward_tiers || []).map(t => [fmt(t.min), t.max ? fmt(t.max) : 'and above', `${t.pct}%`]) }
      : kind === 'dual_tier' ? { cols: ['Deposit ≥', 'Turnover ≥', 'Credit', 'WCash'], rows: (campaign.reward_tiers || []).map(t => [fmt(t.depositThreshold), fmt(t.turnoverThreshold), fmt(t.creditAmount), fmt(t.wcashAmount)]) }
      : kind === 'tiered_deposit_reward' ? { cols: ['Level', 'Deposit ≥', 'Reward'], rows: levels.map(l => [l.level_name, fmt(l.deposit_threshold), fmt(l.reward_amount)]) }
      : kind === 'leaderboard' ? { cols: ['Rank', 'Prize'], rows: (campaign.rank_rewards || []).map(r => [`#${r.rank}`, fmt(r.amount)]) }
      : kind === 'challenge_daily' ? { cols: ["Day's turnover ≥", 'Reward'], rows: cfg.tiers.map(t => [fmt(t.turnover), fmt(t.reward)]) }
      : null,
  }
  return { campaign, levels, cfg, kind, days, allInTiers, tiers, errors, warnings, summary }
}

// Per-player challenge values, same as ChallengeCreator (stats = v_vip_recent_stats row)
export function challengePlayer(username, stats, cfg, days) {
  const sug = suggestForPlayer(stats, cfg, days)
  if (cfg.mode === 'daily_milestone') return { username, ch_credit_status: 'none' }
  return {
    username,
    ch_credit: cfg.credit_enabled ? num(sug.credit) : null, ch_credit_status: cfg.credit_enabled ? 'pending' : 'none',
    ch_target_turnover: num(sug.targetTurnover), ch_target_deposit: num(sug.targetDeposit),
    ch_baseline: { loss_30d: sug.loss30, avg_daily_turnover_30d: sug.avgDailyTurnover, dep_30d: num(stats?.dep_30d), flags: sug.flags, as_of: stats?.data_as_of || null },
  }
}

// "If these players repeat their last N days": history = ai_campaign_history() result
export function estimateCost(draft, history, playerRows = []) {
  const { campaign: c, levels, cfg, kind } = draft
  const players = history?.players || []
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)
  const tot = p => ({ dep: sum(p.d, x => num(x[0])), vb: sum(p.d, x => num(x[1])) })
  let payout = 0, winners = 0, note = ''
  const pay = v => { if (v > 0) { payout += v; winners++ } }
  if (kind === 'gold_bar') players.forEach(p => pay(tot(p).dep >= num(c.deposit_target) ? num(c.gold_bar_value) : 0))
  else if (kind === 'pct_reward') players.forEach(p => { const { dep } = tot(p); let r = dep >= num(c.deposit_target) ? dep * num(c.reward_pct) / 100 : 0; if (num(c.reward_cap) > 0) r = Math.min(r, num(c.reward_cap)); pay(r) })
  else if (kind === 'fixed_reward') players.forEach(p => pay(tot(p).dep >= num(c.deposit_target) ? num(c.reward_fixed) : 0))
  else if (kind === 'tiered_deposit_reward') players.forEach(p => { const { dep } = tot(p); const hit = levels.filter(l => dep >= l.deposit_threshold); pay(c.payout_mode === 'highest_only' ? num(hit[hit.length - 1]?.reward_amount) : sum(hit, l => num(l.reward_amount))) })
  else if (kind === 'tiered_reward') players.forEach(p => { const { dep } = tot(p); const band = [...c.reward_tiers].reverse().find(t => dep >= num(t.min)); pay(band ? dep * num(band.pct) / 100 : 0) })
  else if (kind === 'dual_tier') {
    const best = (dep, vb) => { const t = [...c.reward_tiers].reverse().find(x => dep >= num(x.depositThreshold) && vb >= num(x.turnoverThreshold)); return t ? num(t.creditAmount) + num(t.wcashAmount) : 0 }
    if (c.settlement_frequency === 'daily') players.forEach(p => pay(sum(p.d, x => best(num(x[0]), num(x[1])))))
    else players.forEach(p => { const { dep, vb } = tot(p); pay(best(dep, vb)) })
    if (c.streak_enabled) note = 'Streak bonus not included.'
  } else if (kind === 'leaderboard') {
    const metric = p => { const { dep, vb } = tot(p); return c.leaderboard_metric === 'deposit' ? dep : c.leaderboard_metric === 'turnover_deposit' ? dep + vb : vb }
    const ok = players.filter(p => tot(p).vb >= num(c.min_valid_bet) && tot(p).dep >= num(c.min_deposit_lb)).sort((x, y) => metric(y) - metric(x))
    c.rank_rewards.forEach((r, i) => { if (ok[i]) pay(num(r.amount)) })
    note = `${ok.length} player(s) would qualify for the ranking.`
  } else if (kind === 'challenge_daily') {
    players.forEach(p => pay(sum(p.d, x => { const t = [...cfg.tiers].reverse().find(t => num(x[1]) >= t.turnover); return t ? t.reward : 0 })))
    if (cfg.streak_enabled) note = 'Streak bonus not included.'
  } else {
    const credit = sum(playerRows, r => num(r.ch_credit))
    const cap = num(cfg.completion_cap)
    payout = credit; winners = playerRows.filter(r => num(r.ch_credit) > 0).length
    note = `Upfront credit only. Completion rewards are paid only to players who beat their personal target (${cfg.target_suggest_multiplier}× their normal play)` +
      (cap ? `, max ${cap.toLocaleString('en-US')} each` : '') + '.'
  }
  return { lookback_days: history?.days, data_from: history?.data_from, data_to: history?.data_to, players: players.length,
           est_payout: Math.round(payout), est_winners: winners, note }
}
