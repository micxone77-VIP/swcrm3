// src/lib/campaignImpact.js — "did the campaign work?"
// Data: supabase.rpc('campaign_impact', { p_campaign_id }) → windows + per-player sums for
//   before (window days before start) / during (campaign) / after (window days after end)
//   window = max(campaign length, 7 days). Players: t=true → in this campaign; t=false → comparison group
//   (same currency + tier, not in this campaign, not in another campaign running at the same time).
// Method: difference-in-differences per player-day
//   effect = campaign players' actual − (their own 'before' level × comparison group's % change)
//   so a platform-wide good/bad week does not count as campaign effect.
import { supabase } from './supabase'

export const IMPACT_METRICS = [
  { key: 'vb', i: 0, en: 'Turnover', zh: '流水' },
  { key: 'dep', i: 1, en: 'Deposit', zh: '存款' },
  { key: 'wd', i: 2, en: 'Withdrawal', zh: '提款' },
  { key: 'ggr', i: 3, en: 'GGR (house win)', zh: 'GGR（公司赢）' },
  { key: 'act', i: 4, en: 'Active players', zh: '活跃玩家' },
]
const PERIODS = ['before', 'during', 'after']

export async function loadImpact(campaignId) {
  const { data, error } = await supabase.rpc('campaign_impact', { p_campaign_id: campaignId })
  if (error) throw error
  return data
}

function sums(players, p) {
  const s = { vb: 0, dep: 0, wd: 0, ggr: 0, act: 0 }
  players.forEach(x => {
    const v = x.p?.[p]
    if (v) IMPACT_METRICS.forEach(m => { s[m.key] += Number(v[m.i]) || 0 })
  })
  return s
}

// cost: reward cost in this currency (number) or null if unknown
export function summarizeImpact(data, cur, cost = null) {
  if (!data) return null
  const W = data.windows || {}
  const days = { before: W.before?.days || 0, during: W.during?.days || 0, after: W.after?.days || 0 }
  const all = (data.players || []).filter(x => x.cur === cur)
  const T = all.filter(x => x.t), C = all.filter(x => !x.t)
  const nT = T.length, nC = C.length
  const tot = { T: {}, C: {} }
  PERIODS.forEach(p => { tot.T[p] = sums(T, p); tot.C[p] = sums(C, p) })

  // per player-day averages
  const ppd = (g, p, k) => {
    const n = g === 'T' ? nT : nC
    return n && days[p] ? tot[g][p][k] / n / days[p] : null
  }
  // per day (whole group)
  const perDay = (g, p, k) => (days[p] ? tot[g][p][k] / days[p] : null)

  // Effect uses the comparison group's % change (not ringgit per player): campaign players are often
  // much bigger players (Diamond/Platinum) than the comparison group (mostly Gold), so subtracting
  // RM-per-player changes would be unfair. Expected = campaign players' own "before" level × the
  // comparison group's growth ratio. GGR (can be negative / swings) scales with the comparison
  // group's TURNOVER ratio instead of its GGR ratio.
  function effect(p) {
    if (!days.before || !days[p] || !nT) return null
    const ratio = key => {
      if (!nC) return 1
      const cB = ppd('C', 'before', key), cX = ppd('C', p, key)
      return cB > 0 ? cX / cB : 1
    }
    const out = {}
    IMPACT_METRICS.forEach(({ key }) => {
      const tB = ppd('T', 'before', key), tX = ppd('T', p, key)
      const r = ratio(key === 'ggr' ? 'vb' : key)
      const expected = tB * r * nT * days[p]                     // what they would have done without the campaign
      const actual = tX * nT * days[p]
      const incremental = actual - expected
      const cB = nC ? ppd('C', 'before', key) : null, cX = nC ? ppd('C', p, key) : null
      out[key] = {
        tPct: tB ? ((tX - tB) / Math.abs(tB)) * 100 : null,
        cPct: cB ? ((cX - cB) / Math.abs(cB)) * 100 : null,
        incremental, expected,
        liftPct: expected ? (incremental / Math.abs(expected)) * 100 : null,
      }
    })
    return out
  }
  const during = effect('during'), after = effect('after')

  // per-player split (campaign players only): turnover per day, period vs before
  function split(p) {
    if (!days.before || !days[p]) return null
    const r = { up: [], down: [], flat: [], reactivated: [], stopped: [], idle: [] }
    T.forEach(x => {
      const b = (Number(x.p?.before?.[0]) || 0) / days.before
      const a = (Number(x.p?.[p]?.[0]) || 0) / days[p]
      const row = { u: x.u, tier: x.tier, host: x.host, b, a, diff: a - b, pct: b ? ((a - b) / b) * 100 : null }
      if (!b && !a) r.idle.push(row)
      else if (!b) r.reactivated.push(row)
      else if (!a) r.stopped.push(row)
      else if (row.pct >= 20) r.up.push(row)
      else if (row.pct <= -20) r.down.push(row)
      else r.flat.push(row)
    })
    const ranked = T.map(x => {
      const b = (Number(x.p?.before?.[0]) || 0) / days.before
      const a = (Number(x.p?.[p]?.[0]) || 0) / days[p]
      return { u: x.u, tier: x.tier, host: x.host, b, a, diff: a - b }
    }).filter(x => x.b || x.a).sort((x, y) => y.diff - x.diff)
    return { ...r, gainers: ranked.slice(0, 10), losers: ranked.slice(-10).reverse().filter(x => x.diff < 0) }
  }

  const incGGR = during?.ggr?.incremental ?? null
  const net = incGGR !== null && cost !== null ? incGGR - cost : null
  const roi = net !== null && cost ? (net / cost) * 100 : null

  // verdict
  let verdict = 'na'
  const lift = during?.vb?.liftPct
  if (!days.before) verdict = 'nobefore'
  else if (!days.during) verdict = 'notstarted'
  else if (lift === null || lift === undefined) verdict = 'na'
  else if (lift >= 10) verdict = net === null || net >= 0 ? 'worked' : 'costly'
  else if (lift >= 0) verdict = 'small'
  else verdict = 'nolift'
  let lasting = null
  if (after && days.after) lasting = (after.vb.liftPct ?? 0) >= 5 ? 'kept' : (after.vb.liftPct ?? 0) <= -5 ? 'dropped' : 'normal'

  return {
    cur, days, nT, nC, tot, ppd, perDay, during, after, cost, incGGR, net, roi, verdict, lasting,
    splitDuring: split('during'), splitAfter: split('after'),
    windows: W, smallControl: nC < 15, running: data.end > data.data_max,
  }
}

export const VERDICT = {
  worked:     { icon: '✅', color: '#3fb950', en: 'Worked — players played more than the comparison group, and the extra GGR covered the cost', zh: '有效 — 玩家比对照组玩得更多，额外GGR覆盖了成本' },
  costly:     { icon: '🟡', color: '#d29922', en: 'Lifted play, but the extra GGR did not cover the reward cost (GGR swings — check again after more days)', zh: '带动了投注，但额外GGR未覆盖奖励成本（GGR波动大 — 多几天再看）' },
  small:      { icon: '➖', color: '#8b949e', en: 'Small effect — less than +10% turnover vs the comparison group', zh: '效果小 — 相比对照组流水提升不到 +10%' },
  nolift:     { icon: '❌', color: '#f85149', en: 'No lift — campaign players did worse than the comparison group', zh: '无提升 — 活动玩家表现比对照组差' },
  nobefore:   { icon: 'ℹ️', color: '#8b949e', en: 'No data before the campaign (platform data starts later) — cannot judge', zh: '活动前没有数据（平台数据较晚开始）— 无法判断' },
  notstarted: { icon: '⏳', color: '#8b949e', en: 'Campaign has not started / no settled day yet', zh: '活动尚未开始 / 还没有结算日' },
  na:         { icon: 'ℹ️', color: '#8b949e', en: 'Not enough data', zh: '数据不足' },
}
export const LASTING = {
  kept:    { icon: '📈', color: '#3fb950', en: 'Effect lasted after the campaign', zh: '活动结束后效果仍在' },
  normal:  { icon: '↔️', color: '#8b949e', en: 'Back to normal after the campaign', zh: '活动结束后回到正常' },
  dropped: { icon: '📉', color: '#f85149', en: 'Dropped below normal after the campaign', zh: '活动结束后低于正常水平' },
}

// Save the reward cost so the Scorecard can show ROI for every campaign without opening it
export async function saveImpactCost(campaignId, costByCur, prev) {
  const clean = {}
  Object.entries(costByCur || {}).forEach(([c, v]) => { if (Number.isFinite(Number(v))) clean[c] = Math.round(Number(v) * 100) / 100 })
  if (!Object.keys(clean).length) return
  const same = prev && Object.keys(clean).every(c => Number(prev.byCur?.[c]) === clean[c]) && Object.keys(prev.byCur || {}).length === Object.keys(clean).length
  if (same) return
  await supabase.from('campaigns').update({ impact_cost: { byCur: clean, at: new Date().toISOString() } }).eq('id', campaignId)
}
