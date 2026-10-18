// src/lib/allPlayers.js — reading ALL players incl. Silver / Bronze
// Database layout (since 2026-10-18):
//   vip_members_all          = every player (Gold+ AND Silver/Bronze)
//   vip_members              = VIEW, Gold and up only  → KPIs, queues, churn, Today… stay VIP-only
//   vip_daily_snapshots_all  = daily data for every player
//   vip_daily_snapshots      = VIEW, Gold and up only
// Use these helpers where Silver/Bronze must be included (VIP360, campaigns, search).
import { supabase } from './supabase'
import { fetchAll } from './depositProfile'

export const MEMBERS_ALL = 'vip_members_all'
export const DAILY_ALL = 'vip_daily_snapshots_all'
export const isPotentialTier = t => ['SILVER', 'BRONZE'].includes(String(t || '').toUpperCase())

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// members for a list of usernames (exact match), any tier
export async function fetchMembersFor(usernames, select = '*') {
  const list = [...new Set((usernames || []).filter(Boolean))]
  const out = []
  for (const ch of chunks(list, 150)) out.push(...await fetchAll(() => supabase.from(MEMBERS_ALL).select(select).in('username', ch).order('username')))
  return out
}

// members typed by hand (case-insensitive), any tier
export async function findMembersByNames(names, select = '*') {
  const raw = [...new Set((names || []).map(x => String(x).trim()).filter(Boolean))]
  const variants = [...new Set(raw.flatMap(x => [x, x.toLowerCase(), x.toUpperCase()]))]
  const rows = await fetchMembersFor(variants, select)
  const want = new Set(raw.map(x => x.toLowerCase()))
  const seen = new Set()
  return rows.filter(r => { const k = String(r.username).toLowerCase(); if (!want.has(k) || seen.has(k)) return false; seen.add(k); return true })
}

// daily snapshots for a list of usernames between two dates (inclusive), any tier
export async function fetchDailyFor(usernames, select, from, to) {
  const list = [...new Set((usernames || []).filter(Boolean))]
  const out = []
  for (const ch of chunks(list, 150)) {
    out.push(...await fetchAll(() => {
      let q = supabase.from(DAILY_ALL).select(select).in('username', ch)
      if (from) q = q.gte('snapshot_date', from)
      if (to) q = q.lte('snapshot_date', to)
      return q.order('snapshot_date').order('username')
    }))
  }
  return out
}
