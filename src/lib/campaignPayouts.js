// src/lib/campaignPayouts.js — what each campaign's players earned and were paid (Monthly PPT).
// Per campaign type, the same place the Campaigns page reads rewards (see vipCampaignRewards.js):
//   daily dual tier   → daily_turnover_entries (credit + WCash, payout_status per day)
//   streak bonuses    → campaign_streak_bonuses (payout_status per bonus)
//   Daily Milestone   → computeDaily for the amounts, campaign_players.ch_paid[day].c / .s for paid
//   multi-level fixed → campaign_rewards (status)
//   other types       → campaign formula, paid when campaign_players.payout_status = 'paid'
// supabase is passed in, like the rest of the PPT generator.
import { fetchAll } from './depositProfile'
import { calcDualTierReward, calcReward } from './campaignRewardCalc'
import { DAILY_MODE, defaultDailyConfig, computeDaily } from './dailyMilestone'

const num = v => parseFloat(v) || 0
const todayMYT = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
const addTo = (m, k, v) => { if (v) m[k] = (m[k] || 0) + v; return m }

async function byChunks(ids, read) {
  const out = []
  for (const ch of chunks(ids, 150)) out.push(...await fetchAll(() => read(ch)))
  return out
}

// One campaign → { enrolled, players: [{ username, currency, earned, paid, paidReward, paidStreak }],
//                  earnedByCur, paidByCur, paidRewardByCur, paidStreakByCur, paidPlayers }
export async function fetchCampaignPayout(c, supabase) {
  const cps = await fetchAll(() => supabase.from('campaign_players').select('*').eq('campaign_id', c.id).order('id'))
  const ids = cps.map(p => p.id)
  const usernames = [...new Set(cps.map(p => p.username))]
  const [members, days, streaks, levels] = await Promise.all([
    byChunks(usernames, ch => supabase.from('vip_members_all').select('username,currency').in('username', ch).order('username')),
    byChunks(ids, ch => supabase.from('daily_turnover_entries').select('id,player_id,credit_reward,wcash_reward,payout_status').in('player_id', ch).order('id')),
    byChunks(ids, ch => supabase.from('campaign_streak_bonuses').select('id,campaign_player_id,bonus_amount,payout_status').in('campaign_player_id', ch).order('id')),
    byChunks(ids, ch => supabase.from('campaign_rewards').select('id,campaign_player_id,reward_amount,status').in('campaign_player_id', ch).order('id')),
  ])
  const curOf = Object.fromEntries(members.map(m => [m.username, m.currency || 'MYR']))
  const type = c.campaign_type
  const isMilestone = type === 'challenge' && c.challenge_config?.mode === DAILY_MODE
  const isDaily = type === 'dual_tier' && c.settlement_frequency === 'daily'
  const isLevels = c.is_multi_level && type === 'fixed_reward'
  const dep = p => (c.requires_period_deposit === false ? num(p.total_deposit) : num(p.campaign_period_deposit))

  const earnedOf = {}, paidOf = {}, streakEarned = {}, streakPaid = {}
  days.forEach(r => {
    if (!isDaily) return
    const v = num(r.credit_reward) + num(r.wcash_reward)
    addTo(earnedOf, r.player_id, v)
    if (r.payout_status === 'paid') addTo(paidOf, r.player_id, v)
  })
  levels.forEach(r => {
    if (!isLevels) return
    addTo(earnedOf, r.campaign_player_id, num(r.reward_amount))
    if (r.status === 'paid') addTo(paidOf, r.campaign_player_id, num(r.reward_amount))
  })
  streaks.forEach(r => {
    addTo(streakEarned, r.campaign_player_id, num(r.bonus_amount))
    if (r.payout_status === 'paid') addTo(streakPaid, r.campaign_player_id, num(r.bonus_amount))
  })

  if (isMilestone) {
    const cfg = { ...defaultDailyConfig(), ...(c.challenge_config || {}) }
    const rows = await byChunks(usernames, ch => supabase.from('vip_daily_snapshots_all')
      .select('username,snapshot_date,total_deposit,win_loss,monthly_valid_bet')
      .in('username', ch).gte('snapshot_date', c.start_date).lte('snapshot_date', c.end_date)
      .order('username').order('snapshot_date'))
    const maps = {}
    rows.forEach(r => {
      const ok = num(r.monthly_valid_bet) > 0
      const m = maps[r.username] || (maps[r.username] = {})
      m[r.snapshot_date] = { vb: Math.max(0, num(r.monthly_valid_bet)), dep: ok ? num(r.total_deposit) : 0, wl: ok ? num(r.win_loss) : 0 }
    })
    const asOf = todayMYT()
    cps.forEach(p => {
      const prog = computeDaily({ campaign: c, cfg, dailyMap: maps[p.username] || {}, asOf })
      addTo(earnedOf, p.id, prog.credit)
      addTo(streakEarned, p.id, prog.streak)
      Object.entries(p.ch_paid || {}).forEach(([date, v]) => {
        const d = prog.days.find(x => x.date === date)
        if (!d || !v) return
        if (v.c) addTo(paidOf, p.id, d.reward)
        if (v.s) addTo(streakPaid, p.id, d.streakBonus)
      })
    })
  } else if (!isDaily && !isLevels) {
    // rank = saved position, else position by the campaign's metric among its players
    const metric = p => (c.leaderboard_metric === 'deposit' ? dep(p) : num(p.valid_bet))
    const ranked = [...cps].sort((a, b) => metric(b) - metric(a))
    cps.forEach(p => {
      let v = 0
      if (type === 'dual_tier') {
        const r = calcDualTierReward(dep(p), p.valid_bet, c.reward_tiers)
        v = r.creditAmount + r.wcashAmount
      } else if (type === 'leaderboard') {
        const rank = Number(p.rank_position) || ranked.indexOf(p) + 1
        if (rank <= (Number(c.top_n) || 3)) v = num((c.rank_rewards || [])[rank - 1]?.amount)
      } else if (type !== 'challenge') {
        v = calcReward(type, dep(p), c.reward_pct, c.reward_fixed, c.gold_bar_value, c.reward_cap, c.reward_tiers)
      }
      addTo(earnedOf, p.id, v)
      if (p.payout_status === 'paid') addTo(paidOf, p.id, v)
    })
  }

  const out = { enrolled: cps.length, players: [], earnedByCur: {}, paidByCur: {}, paidRewardByCur: {}, paidStreakByCur: {}, paidPlayers: 0 }
  cps.forEach(p => {
    const currency = curOf[p.username] || 'MYR'
    const paidReward = paidOf[p.id] || 0, paidStreak = streakPaid[p.id] || 0
    const earned = (earnedOf[p.id] || 0) + (streakEarned[p.id] || 0), paid = paidReward + paidStreak
    out.players.push({ username: p.username, currency, earned, paid, paidReward, paidStreak })
    addTo(out.earnedByCur, currency, earned)
    addTo(out.paidByCur, currency, paid)
    addTo(out.paidRewardByCur, currency, paidReward)
    addTo(out.paidStreakByCur, currency, paidStreak)
    if (paid > 0) out.paidPlayers++
  })
  return out
}
