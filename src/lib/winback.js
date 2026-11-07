// src/lib/winback.js — Win-back bonus tracker (Churn Urgency, 2026-11-07)
// Bonuses live in winback_bonuses; v_winback_results adds the result from the daily import:
//   deposited   = real deposit day (deposit > 0 and valid bet > 0) within crm_rules.winback_window_days (7) after the bonus
//   bonus_only  = played (valid bet) in that window but never deposited
//   no_response = no bet at all in that window
//   waiting     = window not over yet and no deposit so far
//   stayed_active = 2+ deposit days within crm_rules.winback_retain_days (30)
import { supabase } from './supabase'
import { fetchAll } from './depositProfile'

export const RESULT_INFO = {
  deposited:   { icon: '✅', en: 'Came back & deposited', zh: '已回归并存款', color: '#3fb950', bg: 'rgba(63,185,80,.12)' },
  bonus_only:  { icon: '⚠️', en: 'Played bonus only',     zh: '只玩奖金没存款', color: '#d29922', bg: 'rgba(210,153,34,.12)' },
  no_response: { icon: '❌', en: 'No response',           zh: '没有反应', color: '#f85149', bg: 'rgba(248,81,73,.12)' },
  waiting:     { icon: '⏳', en: 'Waiting',               zh: '等待中', color: '#58a6ff', bg: 'rgba(88,166,255,.12)' },
}

export const BONUS_TYPES = {
  direct_credit: { en: 'Direct credit', zh: '直接入账' },
  deposit_bonus: { en: 'Deposit bonus offer', zh: '存款奖金' },
}

export const num = v => parseFloat(v) || 0

// Malaysia "today" as YYYY-MM-DD
export const todayMYT = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)

// Company result after the bonus (retain window): player loss − bonuses − rebate.
// If the bonus has not shown up in the daily import yet, take off the recorded amount instead.
export function ngrAfter(r) {
  const bonus = Math.max(num(r.bonus_retain), num(r.amount))
  return num(r.player_loss_retain) - bonus - num(r.rebate_retain)
}

export async function loadWinbackResults() {
  return fetchAll(() => supabase.from('v_winback_results').select('*').order('given_on', { ascending: false }).order('id'))
}

// Past win-back bonuses for these players (for the warning in the Give bonus popup)
export async function loadWinbackHistory(usernames) {
  const list = [...new Set((usernames || []).filter(Boolean))]
  const out = []
  for (let i = 0; i < list.length; i += 100) {
    const { data, error } = await supabase.from('v_winback_results').select('username,given_on,amount,currency,result').in('username', list.slice(i, i + 100)).order('given_on', { ascending: false })
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

// Totals for one group of results, one currency
export function summarize(rows) {
  const t = { count: rows.length, players: new Set(rows.map(r => r.username)).size, cost: 0, deposited: 0, bonus_only: 0, no_response: 0, waiting: 0, stayed: 0, depositWindow: 0, depositAfter: 0, ngr: 0, notSeen: 0, daysToDep: [] }
  rows.forEach(r => {
    t.cost += num(r.amount)
    t[r.result] = (t[r.result] || 0) + 1
    if (r.stayed_active) t.stayed++
    t.depositWindow += num(r.deposit_window)
    t.depositAfter += num(r.deposit_retain)
    t.ngr += ngrAfter(r)
    if (r.bonus_type === 'direct_credit' && num(r.bonus_seen) <= 0 && r.data_through && r.data_through > r.given_on) t.notSeen++
    if (r.days_to_deposit != null) t.daysToDep.push(Number(r.days_to_deposit))
  })
  t.finished = t.deposited + t.bonus_only + t.no_response
  const pct = n => t.finished ? Math.round(n / t.finished * 1000) / 10 : null
  t.pctDeposited = pct(t.deposited); t.pctBonusOnly = pct(t.bonus_only); t.pctNoResponse = pct(t.no_response)
  t.pctStayed = t.deposited ? Math.round(t.stayed / t.deposited * 1000) / 10 : null
  t.returnPer1 = t.cost ? t.ngr / t.cost : null
  t.avgDaysToDep = t.daysToDep.length ? Math.round(t.daysToDep.reduce((a, b) => a + b, 0) / t.daysToDep.length * 10) / 10 : null
  return t
}

export const AMOUNT_BANDS = [
  ['≤100', 0, 100], ['101–300', 100.01, 300], ['301–1,000', 300.01, 1000], ['1,000+', 1000.01, Infinity],
]
