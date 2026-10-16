// src/lib/dailyMilestone.js — "Daily Milestone" campaign (e.g. ⚡ VIP POWER PLAY)
// Each day is settled on its own: the day's turnover (valid bet) decides the credit tier.
// Data is T-1: the day D result is known on D+1 (vip_daily_snapshots), and paid on D+1.
// Streak: N consecutive qualifying days → X% of the deposits on those N days.
//   rolling = every day that completes a run of N pays (16-18, 17-19, 18-20 …)
//   block   = pays every N-th consecutive day (16-18, 19-21 …)
// Pure calculation — no Supabase calls here.
import { num, periodDates } from './challengeEngine'

export const DAILY_MODE = 'daily_milestone'

export function defaultDailyConfig() {
  return {
    mode: DAILY_MODE,
    tiers: [
      { turnover: 30000, reward: 158 },
      { turnover: 70000, reward: 388 },
      { turnover: 100000, reward: 588 },
      { turnover: 400000, reward: 888 },
      { turnover: 800000, reward: 3888 },
    ],
    reward_label: 'Credit',
    streak_enabled: true,
    streak_days: 3,
    streak_style: 'rolling',   // 'rolling' | 'block'
    streak_pct: 1,             // % of deposits on the streak days
    streak_cap: 0,             // 0 = no cap
    near_pct: 50,              // "almost" = turnover ≥ this % of the first tier
    turnover_multiplier: 3,    // reward turnover requirement shown on the payout list (x3 turnover)
    wa_templates: {},          // { intro|won|near|streak|idle|care : { en, zh } } — empty → built-in text
  }
}

export const sortedTiers = cfg => [...(cfg.tiers || [])].map(t => ({ turnover: num(t.turnover), reward: num(t.reward) }))
  .filter(t => t.turnover > 0).sort((a, b) => a.turnover - b.turnover)

export function tierFor(vb, tiers) {
  let idx = -1
  tiers.forEach((t, i) => { if (vb >= t.turnover) idx = i })
  return idx
}

// dailyMap: { 'YYYY-MM-DD': { dep, vb, wl } }; asOf = latest data date (yesterday)
export function computeDaily({ campaign, cfg, dailyMap = {}, asOf }) {
  const tiers = sortedTiers(cfg)
  const N = Math.max(1, Math.round(num(cfg.streak_days) || 3))
  const pct = num(cfg.streak_pct) / 100
  const cap = num(cfg.streak_cap)
  const dates = periodDates(campaign.start_date, campaign.end_date)
  let run = 0
  const days = dates.map((d, i) => {
    const r = dailyMap[d] || {}
    const vb = num(r.vb), dep = num(r.dep), wl = num(r.wl)
    const future = !asOf || d > asOf
    const ti = future ? -1 : tierFor(vb, tiers)
    const reward = ti >= 0 ? tiers[ti].reward : 0
    const next = tiers[ti + 1] || null
    const qualifies = ti >= 0
    run = qualifies ? run + 1 : 0
    let streakBonus = 0, streakBase = 0
    if (cfg.streak_enabled && qualifies && run >= N && (cfg.streak_style === 'rolling' || run % N === 0)) {
      for (let k = i - N + 1; k <= i; k++) streakBase += num((dailyMap[dates[k]] || {}).dep)
      streakBonus = Math.round(streakBase * pct)
      if (cap > 0) streakBonus = Math.min(streakBonus, cap)
    }
    return {
      date: d, vb, dep, wl, future, tier: ti, reward, qualifies, run,
      nextTurnover: next ? next.turnover : null, nextReward: next ? next.reward : null,
      missedBy: next ? Math.max(0, next.turnover - vb) : 0,
      missedReward: next ? next.reward - reward : 0,
      streakBonus, streakBase,
    }
  })
  const past = days.filter(x => !x.future)
  const last = past[past.length - 1] || null           // the settled day (yesterday)
  const credit = past.reduce((s, x) => s + x.reward, 0)
  const streak = past.reduce((s, x) => s + x.streakBonus, 0)
  const turnover = past.reduce((s, x) => s + x.vb, 0)
  const deposit = past.reduce((s, x) => s + x.dep, 0)
  const qualifiedDays = past.filter(x => x.qualifies).length
  const curRun = last ? last.run : 0
  const daysLeft = days.filter(x => x.future).length
  // streak estimate if they qualify again today
  let nextStreakEst = 0
  const oneMoreDay = cfg.streak_style === 'rolling' ? curRun >= N - 1 : curRun % N === N - 1
  if (cfg.streak_enabled && oneMoreDay && curRun > 0 && daysLeft > 0) {
    const base = past.slice(-(N - 1)).reduce((s, x) => s + x.dep, 0)
    nextStreakEst = Math.round(base * pct)
  }
  // primary follow-up group for TODAY (based on yesterday)
  let group = 'idle'
  if (last) {
    const oneMore = cfg.streak_style === 'rolling' ? curRun >= N - 1 : curRun % N === N - 1
    if (last.qualifies) group = cfg.streak_enabled && oneMore && daysLeft > 0 ? 'streak' : 'won'
    else if (tiers[0] && last.vb >= tiers[0].turnover * num(cfg.near_pct ?? 50) / 100) group = 'near'
  }
  return { days, last, credit, streak, cost: credit + streak, turnover, deposit, qualifiedDays, curRun, N, daysLeft, nextStreakEst, group, tiers }
}

export const GROUPS = {
  won:    { icon: '🎉', color: '#3fb950', en: 'Won yesterday',          zh: '昨天达标' },
  streak: { icon: '🔥', color: '#f97316', en: '1 day to streak bonus',  zh: '差1天拿连续奖励' },
  near:   { icon: '😬', color: '#fbbf24', en: 'Almost (missed)',         zh: '差一点' },
  idle:   { icon: '💤', color: '#8b949e', en: 'Not active yesterday',    zh: '昨天没参与' },
  care:   { icon: '💙', color: '#58a6ff', en: 'Big loss — care only',    zh: '昨天大输 — 只关怀' },
}

const fmt = v => Math.round(num(v)).toLocaleString('en-MY')

// Built-in message texts. Variables in {braces} — see VARS below.
export const DEFAULT_TEMPLATES = {
  intro: {
    zh: '您好 {username}！我是SureWin VIP部门的{agent} 😊\n\n⚡ {campaign}（{start} – {end}）现已开始！\n每天流水达标即可领取 VIP 专属 Credit，隔天派发：\n{tier_list}\n\n🔥 连续 {streak_n} 天达标，再加送这 {streak_n} 天总存款的 {streak_pct}%！\n\n每天都是新的一轮，祝您好运 🍀',
    en: 'Hi {username}! This is {agent} from SureWin VIP 😊\n\n⚡ {campaign} ({start} – {end}) is now LIVE!\nHit a daily turnover milestone and claim exclusive VIP Credit — paid the next day:\n{tier_list}\n\n🔥 Qualify {streak_n} days in a row for an extra {streak_pct}% of your deposits on those days!\n\nEvery day is a new round — good luck 🍀',
  },
  won: {
    zh: '恭喜 {username}！🎉\n昨天（{asof}）您的流水 {cur}{y_turnover}，达标领取 {y_reward} Credit，今天已为您派发 ✅\n\n今天流水达到 {cur}{next_target} 可以领 {next_reward} Credit 💪\n活动还剩 {days_left} 天，继续加油！',
    en: 'Congrats {username}! 🎉\nYesterday ({asof}) your turnover was {cur}{y_turnover} — you earned {y_reward} Credit, paid today ✅\n\nReach {cur}{next_target} turnover today to claim {next_reward} Credit 💪\n{days_left} day(s) left — keep it going!',
  },
  streak: {
    zh: '{username} 您已连续 {streak} 天达标 🔥🔥\n昨天的 {y_reward} Credit 今天已派发 ✅\n\n今天只要再达标（流水 {cur}{first_target}），就能额外拿到连续奖励约 {cur}{streak_est}！千万别断掉 💪',
    en: '{username}, you have qualified {streak} days in a row 🔥🔥\nYesterday\'s {y_reward} Credit has been paid today ✅\n\nQualify once more today ({cur}{first_target} turnover) and unlock an extra streak bonus of about {cur}{streak_est}! Don\'t break the streak 💪',
  },
  near: {
    zh: '{username} 好可惜 😢\n昨天（{asof}）您的流水 {cur}{y_turnover}，只差 {cur}{missed_by} 就能领 {miss_reward} Credit！\n\n昨天共有 {winners} 位VIP领取奖励，最高 {top_reward} Credit。\n今天是新的一轮，流水达到 {cur}{first_target} 就能拿 💪',
    en: 'So close, {username} 😢\nYesterday ({asof}) your turnover was {cur}{y_turnover} — only {cur}{missed_by} away from {miss_reward} Credit!\n\n{winners} VIPs claimed rewards yesterday, up to {top_reward} Credit.\nToday is a new round — reach {cur}{first_target} turnover to claim 💪',
  },
  idle: {
    zh: '您好 {username}！⚡ {campaign} 进行中，还剩 {days_left} 天！\n昨天有 {winners} 位VIP领取了奖励，最高 {top_reward} Credit 🎁\n每天流水达到 {cur}{first_target} 就可以领取，今天轮到您！',
    en: 'Hi {username}! ⚡ {campaign} is running — {days_left} day(s) left!\n{winners} VIPs claimed rewards yesterday, up to {top_reward} Credit 🎁\nHit {cur}{first_target} turnover in a day to claim — today could be yours!',
  },
  care: {
    zh: '您好 {username}，我是{agent}。看到您昨天手气不太顺，想关心一下您 🙏 有任何需要随时找我，好好休息～',
    en: 'Hi {username}, this is {agent}. Saw yesterday was a tough day — just checking in 🙏 Let me know if you need anything, take care!',
  },
}

export const VARS = ['{cur}', '{username}', '{agent}', '{campaign}', '{start}', '{end}', '{asof}', '{days_left}', '{y_turnover}', '{y_reward}', '{next_target}', '{next_reward}', '{missed_by}', '{miss_reward}', '{first_target}', '{streak}', '{streak_n}', '{streak_pct}', '{streak_est}', '{winners}', '{top_reward}', '{tier_list}']

export function fillMessage({ group, lang, cfg, campaign, prog, username, agent, summary, currency }) {
  const custom = cfg.wa_templates?.[group]?.[lang]
  const tpl = (custom && custom.trim()) || DEFAULT_TEMPLATES[group]?.[lang] || ''
  const tiers = prog?.tiers || sortedTiers(cfg)
  const last = prog?.last || {}
  const cur = currency === 'SGD' ? 'SGD ' : currency === 'KHUSD' ? 'USD ' : 'RM'
  const tierList = tiers.map(t => `• ${cur}${fmt(t.turnover)} → ${fmt(t.reward)} ${cfg.reward_label || 'Credit'}`).join('\n')
  const v = {
    cur, username, agent: agent || '', campaign: campaign.campaign_name, start: campaign.start_date, end: campaign.end_date,
    asof: summary?.asOf || '', days_left: prog?.daysLeft ?? '', y_turnover: fmt(last.vb), y_reward: fmt(last.reward),
    next_target: fmt(last.nextTurnover || (tiers[tiers.length - 1] || {}).turnover), next_reward: fmt(last.nextReward || (tiers[tiers.length - 1] || {}).reward),
    missed_by: fmt(last.missedBy), miss_reward: fmt(last.qualifies ? last.nextReward : (tiers[0] || {}).reward),
    first_target: fmt((tiers[0] || {}).turnover), streak: prog?.curRun ?? 0, streak_n: cfg.streak_days, streak_pct: cfg.streak_pct,
    streak_est: fmt(prog?.nextStreakEst), winners: summary?.winners ?? 0, top_reward: fmt(summary?.topReward), tier_list: tierList,
  }
  // for "near": missed_by should be to the FIRST tier
  if (group === 'near') v.missed_by = fmt(Math.max(0, num((tiers[0] || {}).turnover) - num(last.vb)))
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m))
}
