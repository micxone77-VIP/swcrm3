// src/lib/monthlyKpi.js — the 4 monthly VIP KPIs, each loaded on its own so one failed read only affects its card.
// Only Platinum, Diamond and Black count (Marcus, 2026-11-04), by the tier the player had in that month.
//   ① Retention: those tiers last month who deposited last month and deposited again this month
//   ② NGR: Player NGR totals, one per currency (lib/playerNgr)
//   ③ Recovered: no deposit for churn_days+ (crm_rules), deposited this month, host contacted them in the 14 days before
//   ④ Upgrades: tier moved up, by the month of the betting that earned it (back office records it the month after)
import { supabase } from './supabase'
import { fetchAll } from './depositProfile'
import { fetchMembersFor } from './allPlayers'
import { fetchMonthNgr } from './playerNgr'

const TIER_RANK = { BRONZE:1, SILVER:2, GOLD:3, PLATINUM:4, DIAMOND:5, 'DIAMOND-P':6, BLACK:7 }
const FIRST_VIP_RANK = TIER_RANK.GOLD
const KPI_TIERS = new Set(['PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK'])
const CONTACT_DAYS = 14
const DAY = 86400000

const num = v => parseFloat(v) || 0
const key = u => String(u || '').toLowerCase()
const shiftMonth = (month, by) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7)
}
const addDays = (ymd, by) => new Date(Date.parse(ymd + 'T00:00:00Z') + by * DAY).toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY)
const monthLast = month => addDays(shiftMonth(month, 1) + '-01', -1)
const dateMYT = ts => new Date(new Date(ts).getTime() + 8 * 3600000).toISOString().slice(0, 10)
const retry = f => f().catch(() => f())

const fetchExcluded = async () => new Set((await fetchAll(() => supabase.from('vip_members_all').select('username').eq('is_excluded', true).order('username'))).map(r => key(r.username)))

const countBy = (rows, cur) => rows.reduce((m, r) => { const c = cur(r) || 'MYR'; m[c] = (m[c] || 0) + 1; return m }, {})

// Targets live in crm_rules (kpi_* keys); no row = no target yet. Retention and upgrades keep the old page's numbers.
export async function loadKpiRules() {
  const { data, error } = await supabase.from('crm_rules').select('rule_key,value').in('rule_key', ['churn_days', 'kpi_retention_target', 'kpi_recovered_target', 'kpi_upgrades_target', 'kpi_ngr_target_myr', 'kpi_ngr_target_sgd'])
  if (error) throw error
  const rule = {}
  ;(data || []).forEach(r => { rule[r.rule_key] = Number(r.value) })
  return {
    churnDays: Number.isFinite(rule.churn_days) ? rule.churn_days : 7,
    targets: {
      retention: rule.kpi_retention_target ?? 85,
      recovered: rule.kpi_recovered_target ?? null,
      upgrades: rule.kpi_upgrades_target ?? 4,
      ngr: { MYR: rule.kpi_ngr_target_myr ?? null, SGD: rule.kpi_ngr_target_sgd ?? null },
    },
  }
}

export async function loadRetention(month) {
  const read = m => fetchAll(() => supabase.from('vip_monthly_totals').select('vip_id,username,total_deposit,currency,host_assigned,tier').eq('snapshot_month', m).order('username'))
  const [prev, cur, excluded] = await Promise.all([retry(() => read(shiftMonth(month, -1))), retry(() => read(month)), retry(fetchExcluded)])
  const paidNow = new Set(cur.filter(r => num(r.total_deposit) > 0).map(r => key(r.username)))
  const base = prev.filter(r => KPI_TIERS.has(r.tier) && num(r.total_deposit) > 0 && !excluded.has(key(r.username)))
  if (!base.length || !cur.length) return null
  const lost = base.filter(r => !paidNow.has(key(r.username)))
  const baseBy = countBy(base, r => r.currency), lostBy = countBy(lost, r => r.currency)
  const vipBy = countBy(prev.filter(r => KPI_TIERS.has(r.tier) && !excluded.has(key(r.username))), r => r.currency)
  const byCur = Object.keys(baseBy).sort().map(c => ({ currency: c, base: baseBy[c], kept: baseBy[c] - (lostBy[c] || 0) }))
  return {
    base: base.length,
    kept: base.length - lost.length,
    pct: Math.round((base.length - lost.length) / base.length * 1000) / 10,
    byCur,
    vipMonth: shiftMonth(month, -1),
    vipTotals: Object.keys(vipBy).sort().map(c => ({ currency: c, count: vipBy[c] })),
    lost: lost.map(r => ({ id: r.vip_id, username: r.username, tier: r.tier, host: r.host_assigned, currency: r.currency || 'MYR', lastDeposit: num(r.total_deposit) })).sort((a, b) => b.lastDeposit - a.lastDeposit),
  }
}

export async function loadNgrKpi(month) {
  const { rows, providerWhole } = await fetchMonthNgr(month).catch(() => fetchMonthNgr(month))
  const by = {}
  rows.filter(r => KPI_TIERS.has(r.monthTier || r.tier)).forEach(r => {
    const t = by[r.currency] || (by[r.currency] = { currency: r.currency, ngr: 0, before: 0, offline: 0, players: 0 })
    t.ngr += r.ngr; t.before += r.ngr_before_spend; t.offline += r.offline; t.players++
  })
  return { byCur: Object.values(by).sort((a, b) => a.currency.localeCompare(b.currency)), providerWhole }
}

export async function loadRecovered(month, churnDays) {
  const start = `${month}-01`, end = monthLast(month)
  // A gap of churnDays+ only needs the days just before each deposit, so this window is enough
  const windowStart = addDays(start, -(churnDays - 1))
  const [deposits, contacts] = await Promise.all([
    retry(() => fetchAll(() => supabase.from('vip_daily_snapshots').select('username,snapshot_date,currency,tier').gte('snapshot_date', windowStart).lte('snapshot_date', end).gt('total_deposit', 0).gt('monthly_valid_bet', 0).order('username').order('snapshot_date'))),
    retry(() => fetchAll(() => supabase.from('contact_logs').select('username,logged_at').gte('logged_at', `${addDays(start, -(CONTACT_DAYS + 1))}T00:00:00Z`).lte('logged_at', `${addDays(end, 1)}T23:59:59Z`).order('username').order('logged_at'))),
  ])
  const datesBy = {}
  deposits.forEach(r => { const d = datesBy[r.username] = datesBy[r.username] || { dates: [], currency: r.currency, tierOn: {} }; d.dates.push(r.snapshot_date); d.tierOn[r.snapshot_date] = r.tier })
  const contactBy = {}
  contacts.forEach(c => { (contactBy[key(c.username)] = contactBy[key(c.username)] || []).push(dateMYT(c.logged_at)) })

  const cameBack = []
  Object.entries(datesBy).forEach(([username, { dates, currency, tierOn }]) => {
    const sorted = [...new Set(dates)].sort()
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] < start) continue
      const gap = i > 0 ? daysBetween(sorted[i - 1], sorted[i]) : null // null: nothing in the window, so churnDays+
      if (gap === null || gap >= churnDays) { if (KPI_TIERS.has(tierOn[sorted[i]])) cameBack.push({ username, currency, backOn: sorted[i], gap, tier: tierOn[sorted[i]] }); break }
    }
  })
  const members = await retry(() => fetchMembersFor(cameBack.map(r => r.username), 'id,username,tier,host_assigned,is_excluded,registration_date'))
  const memberBy = Object.fromEntries(members.map(m => [key(m.username), m]))
  const eligible = cameBack.filter(r => {
    const m = memberBy[key(r.username)]
    if (!m || m.is_excluded) return false
    // A new sign-up's first deposit is not a recovery
    return !m.registration_date || String(m.registration_date).slice(0, 10) <= addDays(r.backOn, -churnDays)
  })
  const players = eligible.flatMap(r => {
    const logs = contactBy[key(r.username)] || []
    const from = addDays(r.backOn, -CONTACT_DAYS)
    const hit = logs.filter(d => d >= from && d <= r.backOn).pop()
    if (!hit) return []
    const m = memberBy[key(r.username)]
    return [{ id: m.id, username: r.username, tier: r.tier, host: m.host_assigned, currency: r.currency || 'MYR', backOn: r.backOn, gap: r.gap, contactedOn: hit }]
  }).sort((a, b) => a.backOn.localeCompare(b.backOn))
  const byCur = countBy(players, r => r.currency)
  return { count: players.length, cameBack: eligible.length, byCur: Object.keys(byCur).sort().map(c => ({ currency: c, count: byCur[c] })), players }
}

export async function loadUpgrades(month) {
  const logs = await retry(() => fetchAll(() => supabase.from('tier_change_logs').select('id,username,old_tier,new_tier,changed_at').eq('import_month', shiftMonth(month, 1)).order('username').order('id')))
  const ups = logs.filter(l => (TIER_RANK[l.new_tier] || 0) > (TIER_RANK[l.old_tier] || 0) && KPI_TIERS.has(l.new_tier))
  const members = await retry(() => fetchMembersFor(ups.map(l => l.username), 'id,username,host_assigned,currency,is_excluded'))
  const memberBy = Object.fromEntries(members.map(m => [key(m.username), m]))
  const rows = ups.filter(l => !memberBy[key(l.username)]?.is_excluded).map(l => {
    const m = memberBy[key(l.username)] || {}
    return { id: m.id, username: l.username, host: m.host_assigned, currency: m.currency || 'MYR', from: l.old_tier, to: l.new_tier, recordedOn: dateMYT(l.changed_at), newToVip: (TIER_RANK[l.old_tier] || 0) < FIRST_VIP_RANK }
  })
  return { vipToVip: rows.filter(r => !r.newToVip), newToVip: rows.filter(r => r.newToVip) }
}
