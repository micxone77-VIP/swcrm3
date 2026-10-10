// src/lib/challengeEngine.js — pure calculation logic for the "Challenge" campaign type
// (Trust Credit 信任金 / Rebate Challenge 返水挑战). No Supabase calls here.
//
// Daily data comes from vip_daily_snapshots. A day's values are only trusted when
// monthly_valid_bet > 0 (the platform CSV repeats stale lifetime totals on inactive
// days — same gate as the vip_monthly_totals view). "Turnover" = daily valid bet.

export function defaultChallengeConfig(mode = 'trust_credit') {
  const trust = mode === 'trust_credit'
  return {
    mode,                                   // 'trust_credit' | 'rebate'
    credit_enabled: trust,
    credit_default: trust ? 6888 : 0,       // default upfront credit per player
    credit_cap: trust ? 20000 : 0,          // max suggested credit
    credit_suggest_pct_of_loss: 5,          // suggested credit = 30-day net loss × %
    goal_metric: 'turnover',                // 'turnover' | 'deposit' | 'both'
    target_turnover_default: trust ? 1500000 : 500000,
    target_deposit_default: 50000,
    target_suggest_multiplier: 1.3,         // suggested target = avg daily turnover × days × this
    completion_type: trust ? 'review' : 'rebate_pct', // 'review' | 'rebate_pct' | 'fixed' | 'none'
    completion_pct: trust ? 0.2 : 0.3,      // review: suggested % of turnover · rebate: rebate %
    completion_fixed: 0,
    completion_cap: trust ? 10000 : 20000,
    streak_enabled: true,
    streak_min_days: 4,                     // at least N deposit days…
    streak_min_daily_deposit: 500,          // …with deposit ≥ this amount
    streak_bonus_type: 'fixed',             // 'fixed' | 'pct'
    streak_bonus_fixed: 388,
    streak_bonus_pct: 1,                    // % of total period deposit
    streak_bonus_cap: 3000,
    followup_days: 30,
  }
}

export const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
export const roundUp = (v, step) => Math.ceil(num(v) / step) * step
export const roundTo = (v, step) => Math.round(num(v) / step) * step

export function periodDates(start, end) {
  const out = []
  if (!start || !end) return out
  const d = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z')
  while (d <= e && out.length < 400) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000)
}

// Risk / escalation flags from v_vip_recent_stats row
export function riskFlags(stats) {
  if (!stats) return []
  const f = []
  if (num(stats.max_deps_one_day_14d) >= 8) f.push('many_deposits_per_day')
  const weeklyAvg = num(stats.dep_prev_28d) / 4
  if (num(stats.dep_7d) > 5000 && num(stats.dep_7d) > 2 * weeklyAvg) f.push('deposit_spike')
  return f
}

export const FLAG_LABEL = {
  many_deposits_per_day: { en: '8+ deposits in one day (last 14d)', zh: '14天内单日存款8次以上' },
  deposit_spike: { en: 'Last 7d deposits > 2× normal', zh: '近7天存款超过平时2倍' },
}

// Suggested per-player values when enrolling
export function suggestForPlayer(stats, cfg, days) {
  const loss = Math.max(0, num(stats?.loss_30d))
  let credit = 0
  if (cfg.credit_enabled) {
    credit = loss > 0 ? roundTo(loss * num(cfg.credit_suggest_pct_of_loss) / 100, 100) : num(cfg.credit_default)
    if (num(cfg.credit_cap) > 0) credit = Math.min(credit, num(cfg.credit_cap))
    if (credit <= 0) credit = num(cfg.credit_default)
  }
  const avgTo = num(stats?.avg_daily_turnover_30d)
  let targetTurnover = avgTo > 0 ? roundUp(avgTo * Math.max(1, days) * num(cfg.target_suggest_multiplier || 1), 10000) : num(cfg.target_turnover_default)
  if (targetTurnover <= 0) targetTurnover = num(cfg.target_turnover_default)
  const avgDep = num(stats?.dep_30d) / 30
  let targetDeposit = avgDep > 0 ? roundUp(avgDep * Math.max(1, days) * num(cfg.target_suggest_multiplier || 1), 1000) : num(cfg.target_deposit_default)
  if (targetDeposit <= 0) targetDeposit = num(cfg.target_deposit_default)
  return { credit, targetTurnover, targetDeposit, loss30: loss, avgDailyTurnover: avgTo, flags: riskFlags(stats) }
}

// dailyMap: { 'YYYY-MM-DD': { dep, wd, vb, wl } } for this player
export function computeProgress({ player, campaign, cfg, dailyMap = {}, followMap = {}, asOf }) {
  const dates = periodDates(campaign.start_date, campaign.end_date)
  const today = asOf || new Date().toISOString().slice(0, 10)
  let turnover = 0, deposit = 0, withdrawal = 0, winLoss = 0
  const dayList = dates.map(d => {
    const r = dailyMap[d] || {}
    const dep = num(r.dep), vb = num(r.vb)
    turnover += vb; deposit += dep; withdrawal += num(r.wd); winLoss += num(r.wl)
    const future = d > today
    return { date: d, dep, vb, future, qualifies: dep >= num(cfg.streak_min_daily_deposit) && dep > 0 }
  })
  const qualifiedDays = dayList.filter(x => x.qualifies).length
  const depositDays = dayList.filter(x => x.dep > 0).length
  const remainingDays = dayList.filter(x => x.future).length

  const tTo = num(player.ch_target_turnover) || num(cfg.target_turnover_default)
  const tDep = num(player.ch_target_deposit) || num(cfg.target_deposit_default)
  const toPct = tTo > 0 ? turnover / tTo : 0
  const depPct = tDep > 0 ? deposit / tDep : 0
  const metric = cfg.goal_metric || 'turnover'
  const completed = metric === 'turnover' ? toPct >= 1 : metric === 'deposit' ? depPct >= 1 : (toPct >= 1 && depPct >= 1)
  const goalPct = metric === 'turnover' ? toPct : metric === 'deposit' ? depPct : Math.min(toPct, depPct)

  // completion reward
  let suggestedReward = 0
  const ct = cfg.completion_type || 'none'
  if (ct === 'review' || ct === 'rebate_pct') suggestedReward = turnover * num(cfg.completion_pct) / 100
  if (ct === 'fixed') suggestedReward = num(cfg.completion_fixed)
  if (num(cfg.completion_cap) > 0) suggestedReward = Math.min(suggestedReward, num(cfg.completion_cap))
  suggestedReward = Math.round(suggestedReward)
  let reward = 0
  if (completed) {
    if (ct === 'review') reward = player.ch_approved_bonus != null && player.ch_approved_bonus !== '' ? num(player.ch_approved_bonus) : 0
    else reward = suggestedReward
  }

  // streak
  const minDays = Math.max(1, Math.round(num(cfg.streak_min_days) || 1))
  const streakQualified = Boolean(cfg.streak_enabled) && qualifiedDays >= minDays
  const streakPossible = Boolean(cfg.streak_enabled) && qualifiedDays + remainingDays >= minDays
  let streakBonus = 0
  if (streakQualified) {
    streakBonus = cfg.streak_bonus_type === 'pct' ? deposit * num(cfg.streak_bonus_pct) / 100 : num(cfg.streak_bonus_fixed)
    if (num(cfg.streak_bonus_cap) > 0) streakBonus = Math.min(streakBonus, num(cfg.streak_bonus_cap))
    streakBonus = Math.round(streakBonus)
  }

  // status
  let status
  if (today < campaign.start_date) status = 'upcoming'
  else if (today <= campaign.end_date) status = completed ? 'done' : 'in_progress'
  else status = completed ? 'completed' : 'failed'

  // follow-up (after end date)
  let followDeposit = 0, followDays = 0
  Object.entries(followMap).forEach(([, r]) => { followDeposit += num(r.dep); if (num(r.dep) > 0) followDays++ })

  const credit = player.ch_credit_status === 'given' ? num(player.ch_credit) : 0
  const cost = credit + reward + streakBonus
  return {
    turnover, deposit, withdrawal, winLoss, dayList, qualifiedDays, depositDays, remainingDays,
    targetTurnover: tTo, targetDeposit: tDep, toPct, depPct, goalPct, completed, status,
    suggestedReward, reward, streakQualified, streakPossible, streakBonus, minDays,
    followDeposit, followDays, credit, cost, net: deposit - withdrawal - cost,
  }
}

export const STATUS_STYLE = {
  upcoming:    { color: '#8b949e', en: 'Upcoming', zh: '未开始' },
  in_progress: { color: '#fbbf24', en: 'In progress', zh: '进行中' },
  done:        { color: '#34d399', en: 'Target reached', zh: '已达标' },
  completed:   { color: '#34d399', en: 'Completed', zh: '已完成' },
  failed:      { color: '#f87171', en: 'Not completed', zh: '未完成' },
}

// WhatsApp progress message (EN / 中文)
export function progressMessage({ lang, username, campaignName, p, cfg, hostName }) {
  const rm = v => 'RM ' + Math.round(num(v)).toLocaleString('en-MY')
  const metric = cfg.goal_metric || 'turnover'
  const left = p.remainingDays
  if (lang === 'zh') {
    const lines = [`您好 ${username}！我是SureWin VIP部门的${hostName || ''}。`, '', `🎯 ${campaignName} 挑战进度：`]
    if (metric !== 'deposit') lines.push(`• 流水：${rm(p.turnover)} / ${rm(p.targetTurnover)}（${Math.round(p.toPct * 100)}%）`)
    if (metric !== 'turnover') lines.push(`• 存款：${rm(p.deposit)} / ${rm(p.targetDeposit)}（${Math.round(p.depPct * 100)}%）`)
    if (cfg.streak_enabled) lines.push(`• 连续奖励：已有 ${p.qualifiedDays} / ${p.minDays} 天每日存款 ≥ ${rm(cfg.streak_min_daily_deposit)}`)
    lines.push('', p.completed ? '✅ 恭喜您已完成任务！奖励将在活动结束后为您处理。' : left > 0 ? `⏳ 还剩 ${left} 天，加油！` : '活动已结束，感谢您的参与！')
    return lines.join('\n')
  }
  const lines = [`Hi ${username}! This is ${hostName || 'your host'} from SureWin VIP.`, '', `🎯 Your ${campaignName} challenge progress:`]
  if (metric !== 'deposit') lines.push(`• Turnover: ${rm(p.turnover)} / ${rm(p.targetTurnover)} (${Math.round(p.toPct * 100)}%)`)
  if (metric !== 'turnover') lines.push(`• Deposit: ${rm(p.deposit)} / ${rm(p.targetDeposit)} (${Math.round(p.depPct * 100)}%)`)
  if (cfg.streak_enabled) lines.push(`• Streak bonus: ${p.qualifiedDays} / ${p.minDays} days with deposit ≥ ${rm(cfg.streak_min_daily_deposit)}`)
  lines.push('', p.completed ? '✅ Congratulations, you have completed the task! Your reward will be processed after the campaign ends.' : left > 0 ? `⏳ ${left} day${left === 1 ? '' : 's'} left — you can do it!` : 'The campaign has ended — thank you for joining!')
  return lines.join('\n')
}
