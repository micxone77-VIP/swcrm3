// src/lib/playerCost.js — what the company has spent on each player so far (Churn Urgency, 2026-11-10)
//   bonus    = daily report bonus (only days with valid bet, same as vip_monthly_totals), from 2026-06
//   rebate   = daily report rebate (same rule)
//   campaign = paid campaign rewards (level rewards marked paid, else campaign_players paid reward_amount)
//   boBonus  = BO bonus records (vip_bonus_txns: angpow, birthday, check-in…); "Campaign" ones are left out
//              because the campaign reward is already counted above
//   spend    = department expenses tagged with this player (cash vouchers, service fees, gifts…)
// Only rows in the player's own currency are counted: MYR and SGD are never added together.
// Returns { costs: { username: { bonus, rebate, campaign, boBonus, spend, total } }, missing: [sources not readable] }
import { supabase } from './supabase'
import { fetchAll } from './depositProfile'

const n = v => parseFloat(v) || 0
const chunks = (arr, size = 150) => { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out }

export async function loadPlayerCosts(players) {
  const list = (players || []).filter(p => p?.username)
  const cur = {}, key = {}
  list.forEach(p => { cur[p.username] = String(p.currency || 'MYR').toUpperCase(); key[String(p.username).toLowerCase()] = p.username })
  const out = {}
  list.forEach(p => { out[p.username] = { bonus: 0, rebate: 0, campaign: 0, boBonus: 0, spend: 0, total: 0 } })
  const names = Object.keys(out)
  const sameCur = (u, c) => !c || String(c).toUpperCase() === cur[u]

  // A source this account cannot read is skipped (listed in out._missing) instead of failing the whole column
  const missing = []
  const safe = (label, p) => p.catch(e => { console.error('player cost:', label, e); missing.push(label); return [] })
  const [monthly, cps, paidRewards, txns, expenses] = await Promise.all([
    safe('bonus/rebate', Promise.all(chunks(names).map(c => fetchAll(() => supabase.from('vip_monthly_totals').select('username,snapshot_month,currency,bonus_amount,total_rebate').in('username', c).order('username').order('snapshot_month')))).then(r => r.flat())),
    safe('campaign', Promise.all(chunks(names).map(c => fetchAll(() => supabase.from('campaign_players').select('id,username,reward_amount,payout_status').in('username', c).order('id')))).then(r => r.flat())),
    safe('campaign', fetchAll(() => supabase.from('campaign_rewards').select('id,campaign_player_id,reward_amount').eq('status', 'paid').order('id'))),
    safe('BO bonus', Promise.all(chunks(names).map(c => fetchAll(() => supabase.from('vip_bonus_txns').select('txn_id,username,amount,currency,category').in('username', c).order('txn_id')))).then(r => r.flat())),
    safe('expenses', fetchAll(() => supabase.from('department_expenses').select('id,vip_username,amount,currency').not('vip_username', 'is', null).order('id'))),
  ])

  monthly.forEach(m => { const o = out[m.username]; if (!o || !sameCur(m.username, m.currency)) return; o.bonus += n(m.bonus_amount); o.rebate += n(m.total_rebate) })

  const levelPaid = {}
  paidRewards.forEach(r => { levelPaid[r.campaign_player_id] = (levelPaid[r.campaign_player_id] || 0) + n(r.reward_amount) })
  cps.forEach(cp => {
    const o = out[cp.username]; if (!o) return
    o.campaign += levelPaid[cp.id] != null ? levelPaid[cp.id] : cp.payout_status === 'paid' ? n(cp.reward_amount) : 0
  })

  txns.forEach(t => { const o = out[t.username]; if (!o || t.category === 'Campaign' || !sameCur(t.username, t.currency)) return; o.boBonus += n(t.amount) })

  expenses.forEach(e => { const u = key[String(e.vip_username || '').trim().toLowerCase()]; if (!u || !sameCur(u, e.currency)) return; out[u].spend += n(e.amount) })

  names.forEach(u => { const o = out[u]; o.total = o.bonus + o.rebate + o.campaign + o.boBonus + o.spend })
  return { costs: out, missing: [...new Set(missing)] }
}
