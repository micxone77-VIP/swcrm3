// src/lib/vipCampaignRewards.js — campaign rewards MARKED PAID for one VIP (VIP360 › Dept Spending).
// Per campaign type, the same place the Campaigns page reads "paid":
//   daily dual tier   → daily_turnover_entries rows with payout_status 'paid' (credit + WCash)
//   streak bonuses    → campaign_streak_bonuses with payout_status 'paid'
//   Daily Milestone   → campaign_players.ch_paid[day].c (tier reward) / .s (streak), amounts from computeDaily
//   multi-level fixed → campaign_rewards with status 'paid'
//   other types       → campaign_players.payout_status 'paid' + reward from the campaign formula
import { supabase } from './supabase'
import { fetchDailyFor } from './allPlayers'
import { calcDualTierReward, calcReward } from './campaignRewardCalc'
import { DAILY_MODE, defaultDailyConfig, computeDaily } from './dailyMilestone'

const num = v => parseFloat(v) || 0
const todayMYT = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)

// → [{ campaign_id, name, type, start, end, reward, streak, total, note }] (only campaigns with something paid)
export async function fetchPaidCampaignRewards(username) {
  const { data: cps, error } = await supabase.from('campaign_players').select('*').eq('username', username)
  if (error) throw error
  if (!cps?.length) return []
  const campIds = [...new Set(cps.map(p => p.campaign_id))]
  const cpIds = cps.map(p => p.id)
  const [campRes, dayRes, streakRes, lvlRes] = await Promise.all([
    supabase.from('campaigns').select('*').in('id', campIds),
    supabase.from('daily_turnover_entries').select('player_id,credit_reward,wcash_reward,payout_status').in('player_id', cpIds).eq('payout_status', 'paid'),
    supabase.from('campaign_streak_bonuses').select('campaign_player_id,bonus_amount,payout_status').in('campaign_player_id', cpIds).eq('payout_status', 'paid'),
    supabase.from('campaign_rewards').select('campaign_player_id,reward_amount,status').in('campaign_player_id', cpIds).eq('status', 'paid'),
  ])
  for (const r of [campRes, dayRes, streakRes, lvlRes]) if (r.error) throw r.error
  const camps = Object.fromEntries((campRes.data || []).map(c => [c.id, c]))
  const sumBy = (rows, key, f) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + f(r)), m), {})
  const dayPaid = sumBy(dayRes.data || [], 'player_id', r => num(r.credit_reward) + num(r.wcash_reward))
  const streakPaid = sumBy(streakRes.data || [], 'campaign_player_id', r => num(r.bonus_amount))
  const lvlPaid = sumBy(lvlRes.data || [], 'campaign_player_id', r => num(r.reward_amount))

  const out = []
  for (const p of cps) {
    const c = camps[p.campaign_id]
    if (!c) continue
    const type = c.campaign_type
    const isDaily = type === 'dual_tier' && c.settlement_frequency === 'daily'
    const dep = c.requires_period_deposit === false ? num(p.total_deposit) : num(p.campaign_period_deposit)
    let reward = 0, streak = streakPaid[p.id] || 0, note = ''

    if (type === 'challenge' && c.challenge_config?.mode === DAILY_MODE) {
      const days = Object.entries(p.ch_paid || {}).filter(([, v]) => v && (v.c || v.s))
      if (days.length) {
        const cfg = { ...defaultDailyConfig(), ...(c.challenge_config || {}) }
        const rows = await fetchDailyFor([username], 'username,snapshot_date,total_deposit,win_loss,monthly_valid_bet', c.start_date, c.end_date)
        const dailyMap = {}
        rows.forEach(r => {
          const ok = num(r.monthly_valid_bet) > 0
          dailyMap[r.snapshot_date] = { vb: Math.max(0, num(r.monthly_valid_bet)), dep: ok ? num(r.total_deposit) : 0, wl: ok ? num(r.win_loss) : 0 }
        })
        const prog = computeDaily({ campaign: c, cfg, dailyMap, asOf: todayMYT() })
        for (const [date, v] of days) {
          const d = prog.days.find(x => x.date === date)
          if (!d) continue
          if (v.c) reward += d.reward
          if (v.s) streak += d.streakBonus
        }
        note = `${days.length} day${days.length > 1 ? 's' : ''}`
      }
    } else if (isDaily) {
      reward = dayPaid[p.id] || 0
    } else if (c.is_multi_level && type === 'fixed_reward') {
      reward = lvlPaid[p.id] || 0
    } else if (p.payout_status === 'paid') {
      if (type === 'dual_tier') {
        const r = calcDualTierReward(dep, p.valid_bet, c.reward_tiers)
        reward = r.creditAmount + r.wcashAmount
      } else if (type === 'leaderboard') {
        // rank = saved position, else position by the campaign's metric among its players
        let rank = Number(p.rank_position) || 0
        if (!rank) {
          const { data: all } = await supabase.from('campaign_players').select('username,valid_bet,total_deposit,campaign_period_deposit').eq('campaign_id', c.id)
          const val = x => (c.leaderboard_metric === 'deposit' ? (c.requires_period_deposit === false ? num(x.total_deposit) : num(x.campaign_period_deposit)) : num(x.valid_bet))
          rank = [...(all || [])].sort((a, b) => val(b) - val(a)).findIndex(x => x.username === username) + 1
        }
        if (rank > 0 && rank <= (Number(c.top_n) || 3)) reward = num((c.rank_rewards || [])[rank - 1]?.amount)
      } else {
        reward = calcReward(type, dep, c.reward_pct, c.reward_fixed, c.gold_bar_value, c.reward_cap, c.reward_tiers)
      }
    }
    if (reward > 0 || streak > 0) out.push({ campaign_id: c.id, name: c.campaign_name, type, start: c.start_date, end: c.end_date, reward, streak, total: reward + streak, note })
  }
  return out.sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')))
}
