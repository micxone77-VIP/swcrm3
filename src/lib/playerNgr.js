// src/lib/playerNgr.js — personal NGR (what the company kept from one player in one month)
//   NGR = player's loss − bonus − rebate + cancelled bonus − offline spending
// win_loss is player side: negative = player lost = company won.
// Bet / win-loss / bonus / rebate source:
//   provider report (provider_player_monthly) when it covers the WHOLE month: some daily rows miss bets
//   otherwise the daily CSV (vip_monthly_totals), without win/loss on no-bet days (stale rows)
// Offline spending = department_expenses with expense_type 'offline' (not in BO bonus or rebate).
// Online expenses are NOT deducted. Campaign rewards are paid as BO bonus, so they are already in bonus.
import { supabase } from './supabase'
import { fetchAll } from './depositProfile'
import { fetchMembersFor, findMembersByNames } from './allPlayers'

const num = v => parseFloat(v) || 0
const key = u => String(u || '').toLowerCase()
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

export const monthEnd = month => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const TOTALS_COLS = 'username,snapshot_month,monthly_valid_bet,win_loss,bonus_amount,total_rebate,currency'
const STALE_COLS = 'username,snapshot_date,win_loss'
const SPEND_COLS = 'vip_username,month,amount,currency,expense_type'
const PROVIDER_COLS = 'username,period_month,period_end,currency,valid_turnover,win_loss,bonus,cancelled_bonus,rebate'
const WL_GAP_MIN = 100

// One player + one month → figures. Gap = daily win/loss differs from the provider report.
function buildRow(daily, staleWl, provider, spend, currency) {
  const dailyWl = num(daily?.win_loss) - staleWl
  const useProvider = !!provider
  const row = {
    source: useProvider ? 'provider' : 'daily',
    bet: useProvider ? provider.bet : num(daily?.monthly_valid_bet),
    win_loss: useProvider ? provider.win_loss : dailyWl,
    bonus: useProvider ? provider.bonus : num(daily?.bonus_amount),
    cancelled: useProvider ? provider.cancelled : 0,
    rebate: useProvider ? provider.rebate : num(daily?.total_rebate),
    offline: 0,
    spendOtherCurrency: false,
    dailyWinLoss: daily ? dailyWl : null,
  }
  ;(spend || []).forEach(e => {
    if (String(e.currency || 'MYR') === String(currency || 'MYR')) row.offline += num(e.amount)
    else row.spendOtherCurrency = true
  })
  row.ngr_before_spend = -row.win_loss - row.bonus - row.rebate + row.cancelled
  row.ngr = row.ngr_before_spend - row.offline
  row.gap = useProvider && daily ? Math.abs(dailyWl - provider.win_loss) > Math.max(Math.abs(provider.win_loss) * 0.01, WL_GAP_MIN) : false
  return row
}

const addProvider = (m, k, r) => {
  const p = m[k] || (m[k] = { bet: 0, win_loss: 0, bonus: 0, cancelled: 0, rebate: 0 })
  p.bet += num(r.valid_turnover); p.win_loss += num(r.win_loss); p.bonus += num(r.bonus); p.cancelled += num(r.cancelled_bonus); p.rebate += num(r.rebate)
}

// Months with data, newest first, e.g. ['2026-11', '2026-10', …]; latest = last daily date
export async function fetchNgrMonths() {
  const read = asc => supabase.from('vip_daily_snapshots').select('snapshot_date').order('snapshot_date', { ascending: asc }).limit(1)
  const [a, b] = await Promise.all([read(true), read(false)])
  if (a.error) throw a.error
  if (b.error) throw b.error
  const first = a.data?.[0]?.snapshot_date, latest = b.data?.[0]?.snapshot_date
  if (!first || !latest) return { months: [], latest: null }
  const months = []
  let [y, m] = latest.split('-').map(Number)
  const stop = first.slice(0, 7)
  for (;;) {
    const s = `${y}-${String(m).padStart(2, '0')}`
    months.push(s)
    if (s <= stop) break
    if (--m < 1) { m = 12; y-- }
  }
  return { months, latest }
}

// Every player for one month → [{ username, id, tier, host, currency, ...figures }]
export async function fetchMonthNgr(month) {
  const from = `${month}-01`, to = monthEnd(month)
  const [totals, stale, spend, cover] = await Promise.all([
    fetchAll(() => supabase.from('vip_monthly_totals').select(TOTALS_COLS).eq('snapshot_month', month).order('username')),
    fetchAll(() => supabase.from('vip_daily_snapshots').select(STALE_COLS).gte('snapshot_date', from).lte('snapshot_date', to).or('monthly_valid_bet.is.null,monthly_valid_bet.lte.0').neq('win_loss', 0).order('username')),
    fetchAll(() => supabase.from('department_expenses').select(SPEND_COLS).eq('month', month).eq('expense_type', 'offline').not('vip_username', 'is', null).order('vip_username')),
    supabase.from('provider_player_monthly').select('period_end').eq('period_month', from).order('period_end', { ascending: false }).limit(1),
  ])
  if (cover.error) throw cover.error
  const providerEnd = cover.data?.[0]?.period_end || null
  const providerWhole = !!providerEnd && String(providerEnd).slice(0, 10) >= to

  const dailyBy = {}; totals.forEach(r => { dailyBy[key(r.username)] = r })
  const staleBy = {}; stale.forEach(r => { staleBy[key(r.username)] = (staleBy[key(r.username)] || 0) + num(r.win_loss) })
  const spendBy = {}; spend.forEach(e => { (spendBy[key(e.vip_username)] = spendBy[key(e.vip_username)] || []).push(e) })

  // A gift can go to a player with no bets this month, so they are looked up too
  // (expense usernames are typed by hand, so their capitals can differ, e.g. Tay888 = tay888)
  const MEMBER_COLS = 'id,username,tier,currency,host_assigned,is_excluded'
  const [played, gifted] = await Promise.all([
    fetchMembersFor(totals.map(r => r.username), MEMBER_COLS),
    findMembersByNames(spend.map(e => e.vip_username), MEMBER_COLS),
  ])
  const members = [...new Map([...played, ...gifted].map(m => [key(m.username), m])).values()]
  const providerBy = {}
  if (providerWhole) {
    for (const ch of chunks(members.map(m => m.username), 150)) {
      const rows = await fetchAll(() => supabase.from('provider_player_monthly').select(PROVIDER_COLS).eq('period_month', from).in('username', ch).order('username'))
      rows.forEach(r => addProvider(providerBy, key(r.username), r))
    }
  }

  const rows = []
  members.forEach(m => {
    if (m.is_excluded) return
    const k = key(m.username)
    const row = buildRow(dailyBy[k], staleBy[k] || 0, providerBy[k], spendBy[k], m.currency)
    if (!(row.bet > 0 || row.offline > 0 || row.ngr !== 0)) return
    rows.push({ id: m.id, username: m.username, tier: m.tier, host: m.host_assigned, currency: m.currency || 'MYR', ...row })
  })
  return { rows, providerWhole, providerEnd }
}

// Every month added up per player. Months load one at a time: each read is heavy (limit 8s).
export async function fetchAllMonthsNgr(months, onMonth) {
  const byPlayer = {}
  const providerMonths = []
  const oldestFirst = [...months].reverse()
  for (let i = 0; i < oldestFirst.length; i++) {
    if (onMonth && onMonth(i + 1, oldestFirst.length) === false) return null
    const month = oldestFirst[i]
    const res = await fetchMonthNgr(month).catch(() => fetchMonthNgr(month))
    if (res.providerWhole) providerMonths.push(month)
    res.rows.forEach(r => {
      const t = byPlayer[key(r.username)]
      if (!t) { byPlayer[key(r.username)] = { ...r, dailyWinLoss: r.dailyWinLoss || 0 }; return }
      ;['bet', 'win_loss', 'bonus', 'cancelled', 'rebate', 'offline', 'ngr_before_spend', 'ngr'].forEach(f => { t[f] += r[f] })
      t.dailyWinLoss += r.dailyWinLoss || 0
      t.gap = t.gap || r.gap
      t.spendOtherCurrency = t.spendOtherCurrency || r.spendOtherCurrency
    })
  }
  return { rows: Object.values(byPlayer), providerMonths }
}

// One player → { rows: [{ month, currency, ...figures }] newest first, earlierSpend }
// Only months with game data count; earlierSpend = offline spending before that (no game loss to set against)
export async function fetchPlayerNgr(username, currency) {
  const [{ months: dataMonths }, totals, stale, spendRes, provider] = await Promise.all([
    fetchNgrMonths(),
    fetchAll(() => supabase.from('vip_monthly_totals').select(TOTALS_COLS).eq('username', username).order('snapshot_month')),
    fetchAll(() => supabase.from('vip_daily_snapshots').select(STALE_COLS).eq('username', username).or('monthly_valid_bet.is.null,monthly_valid_bet.lte.0').neq('win_loss', 0).order('snapshot_date')),
    fetchAll(() => supabase.from('department_expenses').select(SPEND_COLS).ilike('vip_username', username).eq('expense_type', 'offline').order('month')),
    fetchAll(() => supabase.from('provider_player_monthly').select(PROVIDER_COLS).eq('username', username).order('period_month')),
  ])
  const dailyBy = {}; totals.forEach(r => { dailyBy[r.snapshot_month] = r })
  const staleBy = {}; stale.forEach(r => { const m = String(r.snapshot_date).slice(0, 7); staleBy[m] = (staleBy[m] || 0) + num(r.win_loss) })
  const spendBy = {}; spendRes.filter(e => key(e.vip_username) === key(username)).forEach(e => { (spendBy[e.month] = spendBy[e.month] || []).push(e) })
  const providerBy = {}
  provider.forEach(r => {
    const m = String(r.period_month).slice(0, 7)
    if (String(r.period_end).slice(0, 10) >= monthEnd(m)) addProvider(providerBy, m, r)
  })
  const months = [...new Set([...Object.keys(dailyBy), ...Object.keys(spendBy), ...Object.keys(providerBy)])].sort().reverse()
  const all = months.map(month => ({ month, currency, ...buildRow(dailyBy[month], staleBy[month] || 0, providerBy[month], spendBy[month], currency) }))
  return {
    rows: all.filter(r => dataMonths.includes(r.month) && (r.bet > 0 || r.offline > 0 || r.ngr !== 0)),
    earlierSpend: all.filter(r => !dataMonths.includes(r.month)).reduce((n, r) => n + r.offline, 0),
  }
}
