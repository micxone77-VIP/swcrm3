// src/hooks/useVIPs.js — Central VIP data hook
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const VIP_FIELDS = [
  'id','username','full_name','tier','region','currency',
  'days_inactive','churn_risk','host_assigned','phone','whatsapp',
  'last_deposit_date','total_deposit','win_loss','birthday',
  'last_contacted','last_contact_date','activity_status',
  'vip_score','created_at','registration_date','is_excluded',
].join(',')

export function useVIPs({ filter = {}, enabled = true } = {}) {
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true); setError(null)
    try {
      let q = supabase.from('vip_members').select(VIP_FIELDS).neq('is_excluded', true)
      if (filter.host && filter.host !== 'All') q = q.eq('host_assigned', filter.host)
      if (filter.tier && filter.tier !== 'ALL') q = q.eq('tier', filter.tier)
      if (filter.status && filter.status !== 'ALL') q = q.eq('activity_status', filter.status)
      if (filter.region && filter.region !== 'ALL') q = q.eq('region', filter.region)
      if (filter.search) {
        const s = filter.search.trim()
        q = q.or(`username.ilike.%${s}%,full_name.ilike.%${s}%,phone.ilike.%${s}%`)
      }
      q = q.order('tier', { ascending: true })
      const { data: rows, error: err } = await q
      if (err) throw err
      setData(rows || [])
    } catch(e) {
      setError(e.message || String(e))
    }
    setLoading(false)
  }, [enabled, JSON.stringify(filter)])

  useEffect(() => { load() }, [load])

  return { data, loading, error, refresh: load }
}

export function useVIP(id) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError(null)
    try {
      const { data: row, error: err } = await supabase
        .from('vip_members').select('*').eq('id', id).single()
      if (err) throw err
      setData(row)
    } catch(e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  return { data, loading, error, refresh: load }
}

export function useVIPFinancials(id) {
  const [monthly, setMonthly]   = useState([])
  const [daily, setDaily]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError(null)
    try {
      const [mRes, dRes] = await Promise.all([
        supabase.from('vip_monthly_totals')
          .select('snapshot_month,total_deposit,total_withdrawal,monthly_valid_bet,win_loss,total_rebate,bonus_amount')
          .eq('vip_id', id)
          .order('snapshot_month', { ascending: false })
          .limit(24),
        supabase.from('vip_daily_snapshots')
          .select('snapshot_date,total_deposit,total_withdrawal,monthly_valid_bet,win_loss')
          .eq('vip_id', id)
          .order('snapshot_date', { ascending: false })
          .limit(90),
      ])
      if (mRes.error) throw mRes.error
      if (dRes.error) throw dRes.error
      setMonthly(mRes.data || [])
      setDaily(dRes.data || [])
    } catch(e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  return { monthly, daily, loading, error, refresh: load }
}

export function useVIPActivity(id) {
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError(null)
    try {
      const { data: logs, error: err } = await supabase
        .from('contact_logs')
        .select('*')
        .eq('vip_id', id)
        .order('logged_at', { ascending: false })
        .limit(100)
      if (err) throw err
      setData(logs || [])
    } catch(e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])
  return { data, loading, error, refresh: load }
}
