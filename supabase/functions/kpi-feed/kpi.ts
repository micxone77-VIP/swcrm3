// The 4 monthly VIP KPIs for the hub. Server copy of src/lib/monthlyKpi.js + src/lib/playerNgr.js + the score in
// src/components/MonthlyKpiBoard.jsx: a rule changed there must be changed here too, or the hub and the page disagree.
// Only totals are saved from this file, never usernames or hosts. The hub receives the score + items (see index.ts).
// deno-lint-ignore-file no-explicit-any

const WEIGHT = { retention: 20, ngr: 20, recovered: 30, upgrades: 30 }
const TIER_RANK: Record<string, number> = { BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, DIAMOND: 5, 'DIAMOND-P': 6, BLACK: 7 }
const FIRST_VIP_RANK = TIER_RANK.GOLD
const CONTACT_DAYS = 14
const DAY = 86400000

const num = (v: unknown) => parseFloat(String(v)) || 0
const key = (u: unknown) => String(u || '').toLowerCase()
const money = (n: number) => Math.round(n * 100) / 100
const chunks = <T>(arr: T[], n: number) => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7)
}
const addDays = (ymd: string, by: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + by * DAY).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY)
const monthLast = (month: string) => addDays(shiftMonth(month, 1) + '-01', -1)
const dateMYT = (ts: string) => new Date(new Date(ts).getTime() + 8 * 3600000).toISOString().slice(0, 10)
const retry = <T>(f: () => Promise<T>) => f().catch(() => f())
const countBy = (rows: any[], cur: (r: any) => string) => rows.reduce((m, r) => { const c = cur(r) || 'MYR'; m[c] = (m[c] || 0) + 1; return m }, {} as Record<string, number>)

async function fetchAll(query: () => any) {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

async function fetchMembersFor(db: any, usernames: string[], select: string) {
  const out: any[] = []
  for (const ch of chunks([...new Set(usernames.filter(Boolean))], 150)) out.push(...await fetchAll(() => db.from('vip_members_all').select(select).in('username', ch).order('username')))
  return out
}

async function findMembersByNames(db: any, names: string[], select: string) {
  const raw = [...new Set(names.map(x => String(x).trim()).filter(Boolean))]
  const rows = await fetchMembersFor(db, [...new Set(raw.flatMap(x => [x, x.toLowerCase(), x.toUpperCase()]))], select)
  const want = new Set(raw.map(x => x.toLowerCase()))
  const seen = new Set<string>()
  return rows.filter(r => { const k = key(r.username); if (!want.has(k) || seen.has(k)) return false; seen.add(k); return true })
}

async function loadRules(db: any) {
  const { data, error } = await db.from('crm_rules').select('rule_key,value').in('rule_key', ['churn_days', 'kpi_retention_target', 'kpi_recovered_target', 'kpi_upgrades_target', 'kpi_ngr_target_myr', 'kpi_ngr_target_sgd'])
  if (error) throw new Error(error.message)
  const rule: Record<string, number> = {}
  ;(data || []).forEach((r: any) => { rule[r.rule_key] = Number(r.value) })
  return {
    churnDays: Number.isFinite(rule.churn_days) ? rule.churn_days : 7,
    targets: {
      retention: rule.kpi_retention_target ?? 85,
      recovered: rule.kpi_recovered_target ?? null,
      upgrades: rule.kpi_upgrades_target ?? 4,
      upgradesSet: rule.kpi_upgrades_target ?? null, // the 4 above is only the old page's number: the hub sees "not set"
      ngr: { MYR: rule.kpi_ngr_target_myr ?? null, SGD: rule.kpi_ngr_target_sgd ?? null },
    },
  }
}

async function loadRetention(db: any, month: string) {
  const read = (m: string) => fetchAll(() => db.from('vip_monthly_totals').select('username,total_deposit,currency').eq('snapshot_month', m).order('username'))
  const excludedRead = () => fetchAll(() => db.from('vip_members_all').select('username').eq('is_excluded', true).order('username'))
  const [prev, cur, excludedRows] = await Promise.all([retry(() => read(shiftMonth(month, -1))), retry(() => read(month)), retry(excludedRead)])
  const excluded = new Set(excludedRows.map(r => key(r.username)))
  const paidNow = new Set(cur.filter(r => num(r.total_deposit) > 0).map(r => key(r.username)))
  const base = prev.filter(r => num(r.total_deposit) > 0 && !excluded.has(key(r.username)))
  if (!base.length || !cur.length) return null
  const lost = base.filter(r => !paidNow.has(key(r.username)))
  const baseBy = countBy(base, r => r.currency), lostBy = countBy(lost, r => r.currency)
  return {
    base: base.length,
    kept: base.length - lost.length,
    pct: Math.round((base.length - lost.length) / base.length * 1000) / 10,
    by_currency: Object.keys(baseBy).sort().map(c => ({ currency: c, base: baseBy[c], kept: baseBy[c] - (lostBy[c] || 0) })),
  }
}

async function loadNgr(db: any, month: string) {
  const from = `${month}-01`, to = monthLast(month)
  const [totals, stale, spend, cover] = await Promise.all([
    fetchAll(() => db.from('vip_monthly_totals').select('username,monthly_valid_bet,win_loss,bonus_amount,total_rebate').eq('snapshot_month', month).order('username')),
    fetchAll(() => db.from('vip_daily_snapshots').select('username,win_loss').gte('snapshot_date', from).lte('snapshot_date', to).or('monthly_valid_bet.is.null,monthly_valid_bet.lte.0').neq('win_loss', 0).order('username')),
    fetchAll(() => db.from('department_expenses').select('vip_username,amount,currency').eq('month', month).eq('expense_type', 'offline').not('vip_username', 'is', null).order('vip_username')),
    db.from('provider_player_monthly').select('period_end').eq('period_month', from).order('period_end', { ascending: false }).limit(1),
  ])
  if (cover.error) throw new Error(cover.error.message)
  const providerEnd = cover.data?.[0]?.period_end
  const providerWhole = !!providerEnd && String(providerEnd).slice(0, 10) >= to

  const dailyBy: Record<string, any> = {}; totals.forEach(r => { dailyBy[key(r.username)] = r })
  const staleBy: Record<string, number> = {}; stale.forEach(r => { staleBy[key(r.username)] = (staleBy[key(r.username)] || 0) + num(r.win_loss) })
  const spendBy: Record<string, any[]> = {}; spend.forEach(e => { (spendBy[key(e.vip_username)] = spendBy[key(e.vip_username)] || []).push(e) })

  const cols = 'username,currency,is_excluded'
  const [played, gifted] = await Promise.all([fetchMembersFor(db, totals.map(r => r.username), cols), findMembersByNames(db, spend.map(e => e.vip_username), cols)])
  const members = [...new Map([...played, ...gifted].map(m => [key(m.username), m])).values()]

  const providerBy: Record<string, any> = {}
  if (providerWhole) {
    for (const ch of chunks(members.map(m => m.username), 150)) {
      const rows = await fetchAll(() => db.from('provider_player_monthly').select('username,valid_turnover,win_loss,bonus,cancelled_bonus,rebate').eq('period_month', from).in('username', ch).order('username'))
      rows.forEach(r => {
        const p = providerBy[key(r.username)] || (providerBy[key(r.username)] = { bet: 0, win_loss: 0, bonus: 0, cancelled: 0, rebate: 0 })
        p.bet += num(r.valid_turnover); p.win_loss += num(r.win_loss); p.bonus += num(r.bonus); p.cancelled += num(r.cancelled_bonus); p.rebate += num(r.rebate)
      })
    }
  }

  const by: Record<string, any> = {}
  members.forEach(m => {
    if (m.is_excluded) return
    const k = key(m.username), currency = String(m.currency || 'MYR'), daily = dailyBy[k], p = providerBy[k]
    const bet = p ? p.bet : num(daily?.monthly_valid_bet)
    const winLoss = p ? p.win_loss : num(daily?.win_loss) - (staleBy[k] || 0)
    const bonus = p ? p.bonus : num(daily?.bonus_amount)
    const cancelled = p ? p.cancelled : 0
    const rebate = p ? p.rebate : num(daily?.total_rebate)
    let offline = 0
    ;(spendBy[k] || []).forEach(e => { if (String(e.currency || 'MYR') === currency) offline += num(e.amount) })
    const before = -winLoss - bonus - rebate + cancelled
    const ngr = before - offline
    if (!(bet > 0 || offline > 0 || ngr !== 0)) return
    const t = by[currency] || (by[currency] = { currency, ngr: 0, ngr_before_offline: 0, offline: 0, players: 0 })
    t.ngr += ngr; t.ngr_before_offline += before; t.offline += offline; t.players++
  })
  return {
    source: providerWhole ? 'provider_report' : 'daily_import',
    by_currency: Object.values(by).sort((a: any, b: any) => a.currency.localeCompare(b.currency)).map((t: any) => ({ ...t, ngr: money(t.ngr), ngr_before_offline: money(t.ngr_before_offline), offline: money(t.offline) })),
  }
}

async function loadRecovered(db: any, month: string, churnDays: number) {
  const start = `${month}-01`, end = monthLast(month)
  const windowStart = addDays(start, -(churnDays - 1))
  const [deposits, contacts] = await Promise.all([
    retry(() => fetchAll(() => db.from('vip_daily_snapshots').select('username,snapshot_date,currency,total_deposit').gte('snapshot_date', windowStart).lte('snapshot_date', end).gt('total_deposit', 0).gt('monthly_valid_bet', 0).order('username').order('snapshot_date'))),
    retry(() => fetchAll(() => db.from('contact_logs').select('username,logged_at').gte('logged_at', `${addDays(start, -(CONTACT_DAYS + 1))}T00:00:00Z`).lte('logged_at', `${addDays(end, 1)}T23:59:59Z`).order('username').order('logged_at'))),
  ])
  const datesBy: Record<string, { dates: string[]; currency: string }> = {}
  deposits.forEach(r => { (datesBy[r.username] = datesBy[r.username] || { dates: [], currency: r.currency }).dates.push(r.snapshot_date) })
  const contactBy: Record<string, string[]> = {}
  contacts.forEach(c => { (contactBy[key(c.username)] = contactBy[key(c.username)] || []).push(dateMYT(c.logged_at)) })

  const cameBack: { username: string; currency: string; backOn: string }[] = []
  Object.entries(datesBy).forEach(([username, { dates, currency }]) => {
    const sorted = [...new Set(dates)].sort()
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] < start) continue
      const gap = i > 0 ? daysBetween(sorted[i - 1], sorted[i]) : null
      if (gap === null || gap >= churnDays) { cameBack.push({ username, currency, backOn: sorted[i] }); break }
    }
  })
  const members = await retry(() => fetchMembersFor(db, cameBack.map(r => r.username), 'username,is_excluded,registration_date'))
  const memberBy = Object.fromEntries(members.map(m => [key(m.username), m]))
  const eligible = cameBack.filter(r => {
    const m = memberBy[key(r.username)]
    if (!m || m.is_excluded) return false
    return !m.registration_date || String(m.registration_date).slice(0, 10) <= addDays(r.backOn, -churnDays)
  })
  const players = eligible.filter(r => {
    const from = addDays(r.backOn, -CONTACT_DAYS)
    return (contactBy[key(r.username)] || []).some(d => d >= from && d <= r.backOn)
  })
  const byCur = countBy(players, r => r.currency)
  // Deposited by recovered players from the day they came back to the end of the month, one total per currency
  const amountBy: Record<string, number> = {}
  const backOn = new Map(players.map(r => [r.username, r]))
  deposits.forEach(d => {
    const r = backOn.get(d.username)
    if (r && d.snapshot_date >= r.backOn) amountBy[r.currency || 'MYR'] = (amountBy[r.currency || 'MYR'] || 0) + num(d.total_deposit)
  })
  return { count: players.length, came_back: eligible.length, by_currency: Object.keys(byCur).sort().map(c => ({ currency: c, count: byCur[c], amount: money(amountBy[c] || 0) })) }
}

async function loadUpgrades(db: any, month: string) {
  const logs = await retry(() => fetchAll(() => db.from('tier_change_logs').select('id,username,old_tier,new_tier').eq('import_month', shiftMonth(month, 1)).order('username').order('id')))
  const ups = logs.filter(l => (TIER_RANK[l.new_tier] || 0) > (TIER_RANK[l.old_tier] || 0) && (TIER_RANK[l.new_tier] || 0) >= FIRST_VIP_RANK)
  const members = await retry(() => fetchMembersFor(db, ups.map(l => l.username), 'username,is_excluded'))
  const memberBy = Object.fromEntries(members.map(m => [key(m.username), m]))
  const rows = ups.filter(l => !memberBy[key(l.username)]?.is_excluded)
  const newToVip = rows.filter(l => (TIER_RANK[l.old_tier] || 0) < FIRST_VIP_RANK).length
  return { vip_to_vip: rows.length - newToVip, new_to_vip: newToVip }
}

const rateOf = (actual: number, target: number | null) => (target ? Math.min(1, actual / target) : null)

// One month → the breakdown saved in the CRM. Any failed part throws, so a half-calculated month is never saved.
export async function buildPayload(db: any, month: string, dataDate: string) {
  const rules = await loadRules(db)
  const { targets } = rules
  const retention = await loadRetention(db, month)
  const recovered = await loadRecovered(db, month, rules.churnDays)
  const upgrades = await loadUpgrades(db, month)
  const ngr = await retry(() => loadNgr(db, month))
  const thisMonth = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
  const unfinished = month >= thisMonth

  // Same score as the KPI page: only ① and ③ can count, and only once they have a target
  const parts = [
    { name: 'retention', rate: rateOf(retention?.pct ?? 0, targets.retention), weight: WEIGHT.retention },
    { name: 'recovered', rate: rateOf(recovered.count, targets.recovered), weight: WEIGHT.recovered },
  ].filter(p => p.rate !== null)
  const value = parts.length ? Math.round(parts.reduce((a, p) => a + (p.rate as number) * p.weight, 0) / parts.reduce((a, p) => a + p.weight, 0) * 1000) / 10 : null
  const counted = parts.map(p => p.name)

  // The 4 lines the hub shows. Item score = rate × 100, capped at 100 like the page. MYR and SGD are never added.
  const itemScore = (rate: number | null) => (rate === null ? null : Math.round(rate * 1000) / 10)
  const ngrOf = (c: string) => ngr.by_currency.find((t: any) => t.currency === c) as any
  const myr = ngrOf('MYR'), sgd = ngrOf('SGD')
  const recoveredRate = rateOf(recovered.count, targets.recovered)
  const amountIn = (c: string) => recovered.by_currency.find(t => t.currency === c)?.amount ?? 0
  const items = [
    { key: 'retention_rate', label: '① VIP 月留存率', weight: WEIGHT.retention, actual: retention?.pct ?? null, target: targets.retention, excellent: null, unit: '%', is_scored: true, score: itemScore(rateOf(retention?.pct ?? 0, targets.retention)), detail: { kept: retention?.kept ?? null, base: retention?.base ?? null, by_currency: retention?.by_currency ?? [] } },
    { key: 'ngr_total', label: '② VIP 月 NGR 总额', weight: WEIGHT.ngr, actual: myr?.ngr ?? null, target: targets.ngr.MYR, excellent: null, unit: 'RM', is_scored: false, score: null, note: '已扣除线下开支,不要再扣一次。SGD 单独列在 detail,不可与 RM 相加。', detail: { source: ngr.source, myr: myr ?? null, sgd: sgd ?? null, target_sgd: targets.ngr.SGD } },
    { key: 'churn_recovery', label: '③ 流失 VIP 挽回数', weight: WEIGHT.recovered, actual: recovered.count, target: targets.recovered, excellent: null, unit: '人', is_scored: recoveredRate !== null, score: itemScore(recoveredRate), ...(recoveredRate === null ? { note: '目标未定,只显示不计分' } : {}), detail: { recovered_count: recovered.count, came_back_count: recovered.came_back, recovery_amount_rm: amountIn('MYR'), recovery_amount_sgd: amountIn('SGD') } },
    { key: 'new_promotion', label: '④ 新晋升 VIP 数', weight: WEIGHT.upgrades, actual: unfinished ? null : upgrades.vip_to_vip, target: targets.upgradesSet, excellent: null, unit: '人', is_scored: false, score: null, note: unfinished ? '本月升级要到月底后才记录,目标未定' : '目标未定,只显示不计分', ...(unfinished ? {} : { detail: { vip_to_vip: upgrades.vip_to_vip, new_to_vip: upgrades.new_to_vip } }) },
  ]

  return {
    month,
    month_status: unfinished ? 'in_progress' : 'ended',
    data_date: dataDate,
    items,
    score: {
      value,
      max: 100,
      complete: counted.length === Object.keys(WEIGHT).length,
      counted,
      not_counted: Object.keys(WEIGHT).filter(k => !counted.includes(k)),
    },
    kpis: {
      retention: { weight: WEIGHT.retention, target_pct: targets.retention, pct: retention?.pct ?? null, kept: retention?.kept ?? null, base: retention?.base ?? null, by_currency: retention?.by_currency ?? [] },
      ngr: { weight: WEIGHT.ngr, source: ngr.source, targets: targets.ngr, by_currency: ngr.by_currency },
      recovered: { weight: WEIGHT.recovered, target: targets.recovered, ...recovered },
      upgrades: { weight: WEIGHT.upgrades, target: targets.upgrades, status: unfinished ? 'pending' : 'recorded', ...upgrades },
    },
  }
}
