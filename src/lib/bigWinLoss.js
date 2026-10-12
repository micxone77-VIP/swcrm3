// src/lib/bigWinLoss.js — "Big Win / Big Loss yesterday" alert logic
// Source: v_vip_winloss_recent (latest uploaded day from vip_daily_snapshots) + vip_members + v_vip_last_contact.
// win_loss is PLAYER perspective: negative = player lost money, positive = player won.
// Thresholds are per tier, in MYR; SGD / KHUSD amounts are converted with fx_to_myr.
// Settings live in app_settings (key 'big_winloss_thresholds') so everyone uses the same rules.
import { supabase } from './supabase'
import { fetchAll } from './depositProfile'

export const WINLOSS_SETTINGS_KEY = 'big_winloss_thresholds'
export const WINLOSS_TIERS = ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE']
export const DEFAULT_WINLOSS_SETTINGS = {
  tiers: {
    BLACK: { loss: 30000, win: 30000 },
    'DIAMOND-P': { loss: 20000, win: 20000 },
    DIAMOND: { loss: 20000, win: 20000 },
    PLATINUM: { loss: 10000, win: 10000 },
    GOLD: { loss: 5000, win: 5000 },
    SILVER: { loss: 3000, win: 3000 },
    BRONZE: { loss: 2000, win: 2000 },
  },
  fx_to_myr: { MYR: 1, SGD: 3.3, KHUSD: 4.4 },
  gift_loss_rule: 100000, // net loss (since data start) that qualifies for a big-loss gift
}

const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }

export async function loadWinLossSettings() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', WINLOSS_SETTINGS_KEY).maybeSingle()
  const v = data?.value || {}
  return {
    tiers: { ...DEFAULT_WINLOSS_SETTINGS.tiers, ...(v.tiers || {}) },
    fx_to_myr: { ...DEFAULT_WINLOSS_SETTINGS.fx_to_myr, ...(v.fx_to_myr || {}) },
    gift_loss_rule: v.gift_loss_rule ?? DEFAULT_WINLOSS_SETTINGS.gift_loss_rule,
  }
}

export async function saveWinLossSettings(settings, byName) {
  return supabase.from('app_settings').upsert({ key: WINLOSS_SETTINGS_KEY, value: settings, updated_by: byName || null, updated_at: new Date().toISOString() })
}

// Returns { dataDate, losses[], wins[], settings }. Each row has amounts in own currency + MYR equivalent.
export async function loadBigWinLoss({ settings } = {}) {
  const cfg = settings || await loadWinLossSettings()
  const [wl, members, contacts] = await Promise.all([
    fetchAll(() => supabase.from('v_vip_winloss_recent').select('*').order('username')),
    fetchAll(() => supabase.from('vip_members').select('id, username, full_name, tier, currency, host_assigned, affiliate_login, phone, whatsapp, is_excluded, last_contacted, last_contact_date').order('username')),
    fetchAll(() => supabase.from('v_vip_last_contact').select('username, last_contact_at, last_contact_host').order('username')),
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
  return { dataDate, losses, wins, settings: cfg }
}
