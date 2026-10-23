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
    wa_templates: {},          // { intro|won|near|streak|idle|care|ended : { en, zh } } — empty → built-in text
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

// Built-in message texts — Malaysian style, peer-to-peer ("bro"), relaxed. Variables in {braces} — see VARS below.
// Edit per campaign in ⚙️ Rules & messages (the editor starts from these texts).
export const DEFAULT_TEMPLATES = {
  intro: {
    zh: "哈咯 {username}～我是sureWin VIP部门的 {agent} 😄\n\n跟你讲个好东西 ⚡ {campaign} 开跑了（{start} – {end}）\n每天流水到就有 VIP Credit，隔天我直接帮你派：\n{tier_list}\n\n🔥 连续 {streak_n} 天都有到的话，再多送你这 {streak_n} 天存款的 {streak_pct}%！\n\n每天重新算的，有空就来玩一下，祝你旺 🍀",
    en: "Yo {username}! I'm {agent} from sureWin VIP department 😄\n\nGot something nice for you bro — ⚡ {campaign} is on from {start} to {end}!\nHit the daily turnover and you get VIP Credit, I bank in for you the next day:\n{tier_list}\n\n🔥 Hit it {streak_n} days in a row, you get extra {streak_pct}% of your deposits on those days!\n\nEvery day fresh start one, jom try. Good luck bro 🍀",
  },
  won: {
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}～\n\n哇你可以哦 🎉 昨天（{asof}）流水 {cur}{y_turnover}，{y_reward} Credit 我今天已经帮你派进去了 ✅\n\n今天冲到 {cur}{next_target} 就有 {next_reward} Credit 💪\n还有 {days_left} 天，继续旺下去！",
    en: "Yo {username}! {agent} here from sureWin VIP department~\n\nWah steady bro 🎉 Yesterday ({asof}) your turnover {cur}{y_turnover} — {y_reward} Credit I already banked in today ✅\n\nToday hit {cur}{next_target} can get {next_reward} Credit 💪\nStill got {days_left} day(s), keep going bro!",
  },
  streak: {
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}～\n\n你很稳哦，已经连续 {streak} 天了 🔥🔥\n昨天的 {y_reward} Credit 今天派了 ✅\n\n今天只要再到 {cur}{first_target}，连续奖励大概 {cur}{streak_est} 就是你的了！别断掉啊 💪",
    en: "Yo {username}! {agent} here from sureWin VIP department~\n\nBro, {streak} days in a row already, power lah 🔥🔥\nYesterday's {y_reward} Credit banked in today ✅\n\nToday hit {cur}{first_target} one more time and the streak bonus, around {cur}{streak_est}, is yours! Don't break it ah 💪",
  },
  near: {
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}～\n\n昨天好可惜啊 😅 流水 {cur}{y_turnover}，就差 {cur}{missed_by} 而已，{miss_reward} Credit 就到手了！\n\n昨天 {winners} 个VIP有拿到，最高 {top_reward} Credit。\n今天重新来，流水到 {cur}{first_target} 就有了 💪",
    en: "Yo {username}! {agent} here from sureWin VIP department~\n\nAiyo, so close yesterday bro 😅 Your turnover {cur}{y_turnover}, short only {cur}{missed_by} to get {miss_reward} Credit!\n\n{winners} VIPs got rewards yesterday, highest {top_reward} Credit.\nToday new round — hit {cur}{first_target} and it's yours 💪",
  },
  idle: {
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}，最近好吗～\n\n⚡ {campaign} 还在跑，剩 {days_left} 天哦\n昨天 {winners} 个VIP拿了奖励，最高 {top_reward} Credit 🎁\n一天流水到 {cur}{first_target} 就有，有空来玩一下 😄",
    en: "Hey {username}! {agent} here from sureWin VIP department, how's it going bro~\n\n⚡ {campaign} still running, {days_left} day(s) left!\n{winners} VIPs grabbed rewards yesterday, up to {top_reward} Credit 🎁\nJust hit {cur}{first_target} turnover in a day can claim — free come try ya 😄",
  },
  // after the last day is settled: thank-you + more campaigns coming. {final_line} / {total_line} are empty when not earned.
  ended: {
    zh: "哈咯 {username}，我是sureWin VIP部门的 {agent}～\n\n⚡ {campaign}（{start} – {end}）已经圆满结束啦 🏁\n{final_line}\n{total_line}\n\n谢谢你这段时间一路的支持，有你一起玩真的很开心 🙏\n我们很快会有新的活动，到时第一时间通知你！\n\n祝你天天好运，越玩越旺，赢多多 🍀💰",
    en: "Yo {username}! I'm {agent} from sureWin VIP department~\n\n⚡ {campaign} ({start} – {end}) has officially ended 🏁\n{final_line}\n{total_line}\n\nThanks a lot for being with us the whole way bro, really appreciate it 🙏\nMore campaigns coming soon — I'll let you know first!\n\nWish you good luck always and win more more bro 🍀💰",
  },
  care: {
    zh: "{username}，我是sureWin VIP部门的 {agent}。看你昨天手气不太顺，来问候一下 🙏 好好休息，不用急。有什么事随时找我～",
    en: "Hey {username}, {agent} here from sureWin VIP department. Saw yesterday not so ong for you bro, just checking on you 🙏 Rest well ya, no rush. Anything just WhatsApp me~",
  },
}

export const VARS = ['{cur}', '{username}', '{agent}', '{campaign}', '{start}', '{end}', '{asof}', '{days_left}', '{y_turnover}', '{y_reward}', '{next_target}', '{next_reward}', '{missed_by}', '{miss_reward}', '{first_target}', '{streak}', '{streak_n}', '{streak_pct}', '{streak_est}', '{winners}', '{top_reward}', '{tier_list}', '{total_reward}', '{final_line}', '{total_line}']

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
  // campaign-ended lines: only when the player actually earned something
  const label = cfg.reward_label || 'Credit'
  const zh = lang === 'zh'
  v.total_reward = fmt(prog?.credit)
  v.final_line = last.qualifies && num(last.reward) > 0
    ? (zh ? `最后一天的 ${fmt(last.reward)} ${label} 今天已经帮你派进去了 ✅` : `Your last day's ${fmt(last.reward)} ${label} already banked in today ✅`) : ''
  const streakPart = num(prog?.streak) > 0 ? (zh ? ` + ${cur}${fmt(prog.streak)} 连续奖励` : ` + ${cur}${fmt(prog.streak)} streak bonus`) : ''
  v.total_line = num(prog?.credit) > 0 || num(prog?.streak) > 0
    ? (zh ? `这次活动你一共拿了 ${fmt(prog.credit)} ${label}${streakPart} 🎉` : `This campaign you got total ${fmt(prog.credit)} ${label}${streakPart} 🎉`) : ''
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m)).replace(/\n{3,}/g, '\n\n')
}
