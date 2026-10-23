// src/lib/bigWinLoss.js — "Big Win / Big Loss yesterday" alert logic
// Source: v_vip_winloss_recent (latest uploaded day from vip_daily_snapshots) + vip_members + v_vip_last_contact.
// win_loss is PLAYER perspective: negative = player lost money, positive = player won.
// Thresholds are per tier, in MYR; SGD / KHUSD amounts are converted with fx_to_myr.
// Settings live in app_settings (key 'big_winloss_thresholds') so everyone uses the same rules.
// Money alerts (big withdrawal, deposit spike, deposit drop) come from the RPC get_money_alerts, same settings.
import { supabase } from './supabase'
import { fetchAll } from './depositProfile'

export const WINLOSS_SETTINGS_KEY = 'big_winloss_thresholds'
export const WINLOSS_TIERS = ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE']
export const DEFAULT_WINLOSS_SETTINGS = {
  tiers: {
    // withdraw = big withdrawal ≥ RM; spike = minimum day deposit (RM) for a spike, and 2× this for the 7-day drop check
    BLACK: { loss: 30000, win: 30000, withdraw: 80000, spike: 30000 },
    'DIAMOND-P': { loss: 20000, win: 20000, withdraw: 40000, spike: 15000 },
    DIAMOND: { loss: 20000, win: 20000, withdraw: 40000, spike: 15000 },
    PLATINUM: { loss: 10000, win: 10000, withdraw: 20000, spike: 8000 },
    GOLD: { loss: 5000, win: 5000, withdraw: 10000, spike: 4000 },
    SILVER: { loss: 3000, win: 3000, withdraw: 5000, spike: 2000 },
    BRONZE: { loss: 2000, win: 2000, withdraw: 3000, spike: 1000 },
  },
  fx_to_myr: { MYR: 1, SGD: 3.3, KHUSD: 4.4 },
  gift_loss_rule: 100000, // net loss (since data start) that qualifies for a big-loss gift
  withdraw_x: 2,          // big withdrawal must also be ≥ this × the player's usual deposit
  spike_x: 3,             // deposit spike = day deposit ≥ this × usual deposit
  drop_pct: 70,           // deposit drop = last 7 days ≥ this % below the 7 days before
}

const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }

export async function loadWinLossSettings() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', WINLOSS_SETTINGS_KEY).maybeSingle()
  const v = data?.value || {}
  const D = DEFAULT_WINLOSS_SETTINGS
  return {
    // per tier: saved values win, missing fields (e.g. new withdraw / spike) fall back to the defaults
    tiers: Object.fromEntries(WINLOSS_TIERS.map(t => [t, { ...D.tiers[t], ...((v.tiers || {})[t] || {}) }])),
    fx_to_myr: { ...D.fx_to_myr, ...(v.fx_to_myr || {}) },
    gift_loss_rule: v.gift_loss_rule ?? D.gift_loss_rule,
    withdraw_x: v.withdraw_x ?? D.withdraw_x,
    spike_x: v.spike_x ?? D.spike_x,
    drop_pct: v.drop_pct ?? D.drop_pct,
  }
}

export async function saveWinLossSettings(settings, byName) {
  return supabase.from('app_settings').upsert({ key: WINLOSS_SETTINGS_KEY, value: settings, updated_by: byName || null, updated_at: new Date().toISOString() })
}

// Today banner, bell and Alerts page all ask at once — share one result for 2 minutes (default settings only)
let cache = null
export function loadBigWinLoss({ settings } = {}) {
  if (settings) { cache = null; return loadBigWinLossFresh({ settings }) }
  if (cache && Date.now() - cache.at < 120000) return cache.promise
  const promise = loadBigWinLossFresh({})
  cache = { at: Date.now(), promise }
  promise.catch(() => { cache = null })
  return promise
}

// Returns { dataDate, losses[], wins[], withdrawals[], spikes[], drops[], settings }.
// Each row has amounts in own currency + MYR equivalent.
async function loadBigWinLossFresh({ settings }) {
  const cfg = settings || await loadWinLossSettings()
  const [wl, members, contacts, money] = await Promise.all([
    fetchAll(() => supabase.from('v_vip_winloss_recent').select('*').order('username')),
    fetchAll(() => supabase.from('vip_members').select('id, username, full_name, tier, currency, host_assigned, affiliate_login, phone, whatsapp, is_excluded, last_contacted, last_contact_date, activity_status, days_inactive').order('username')),
    fetchAll(() => supabase.from('v_vip_last_contact').select('username, last_contact_at, last_contact_host').order('username')),
    supabase.rpc('get_money_alerts', { p_settings: cfg }).then(r => (r.error ? [] : r.data || [])),
  ])
  const mem = {}; members.forEach(m => { mem[m.username] = m })
  const lc = {}; contacts.forEach(c => { lc[c.username] = c })
  const dataDate = wl.find(r => r.data_date)?.data_date || null
  const losses = [], wins = []
  wl.forEach(r => {
    const m = mem[r.username]
    if (!m || m.is_excluded) return
    const day = n(r.wl_day)
    if (!day) return
    const tier = String(m.tier || '').toUpperCase()
    const th = cfg.tiers[tier]
    if (!th) return
    const fx = n(cfg.fx_to_myr[String(m.currency || 'MYR').toUpperCase()] || 1) || 1
    const dayMyr = day * fx
    const cands = [lc[r.username]?.last_contact_at, m.last_contacted, m.last_contact_date].filter(Boolean)
    const lastContact = cands.length ? cands.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null
    const row = {
      ...r, id: m.id, full_name: m.full_name || '', tier, currency: m.currency || 'MYR', host: m.host_assigned || '',
      affiliate: m.affiliate_login || '', phone: m.phone, whatsapp: m.whatsapp, fx, dayMyr,
      lastContact, lastContactHost: lc[r.username]?.last_contact_host || null,
      netSinceMyr: n(r.wl_since_start) * fx,
    }
    if (dayMyr <= -n(th.loss) && n(th.loss) > 0) {
      row.giftEligible = row.netSinceMyr <= -n(cfg.gift_loss_rule)
      losses.push(row)
    } else if (dayMyr >= n(th.win) && n(th.win) > 0) {
      row.withdrew = n(r.wd_day) > 0
      wins.push(row)
    }
  })
  losses.sort((a, b) => a.dayMyr - b.dayMyr)
  wins.sort((a, b) => b.dayMyr - a.dayMyr)

  // money alerts: add contact info the same way as win/loss rows
  const withdrawals = [], spikes = [], drops = []
  money.forEach(a => {
    const m = mem[a.username]
    if (!m) return
    const fx = n(cfg.fx_to_myr[String(m.currency || 'MYR').toUpperCase()] || 1) || 1
    const cands = [lc[a.username]?.last_contact_at, m.last_contacted, m.last_contact_date].filter(Boolean)
    const row = {
      ...a, id: m.id, full_name: m.full_name || '', currency: m.currency || 'MYR', host: m.host_assigned || '',
      affiliate: m.affiliate_login || '', phone: m.phone, whatsapp: m.whatsapp, activity_status: m.activity_status, days_inactive: m.days_inactive,
      fx, amountMyr: n(a.amount) * fx,
      lastContact: cands.length ? cands.reduce((x, y) => (new Date(x) > new Date(y) ? x : y)) : null,
      lastContactHost: lc[a.username]?.last_contact_host || null,
    }
    if (a.kind === 'withdrawal') withdrawals.push(row)
    else if (a.kind === 'spike') spikes.push(row)
    else if (a.kind === 'drop') drops.push(row)
  })
  withdrawals.sort((a, b) => b.amountMyr - a.amountMyr)
  spikes.sort((a, b) => n(b.ratio) - n(a.ratio))
  drops.sort((a, b) => n(b.prev7) * b.fx - n(a.prev7) * a.fx)
  return { dataDate, losses, wins, withdrawals, spikes, drops, settings: cfg }
}
