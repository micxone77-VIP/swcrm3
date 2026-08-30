// src/hooks/useDashboard.js — Today / Command Center data
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const todayStart = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString() }
const todayEnd   = () => { const d = new Date(); d.setHours(23,59,59,999); return d.toISOString() }

export function useDashboard({ host = 'All' } = {}) {
  const [vips, setVips]               = useState([])
  const [todayLogs, setTodayLogs]     = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const now = new Date()
      const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      const [vipRes, logRes] = await Promise.all([
        supabase.from('vip_members')
          .select('id,username,full_name,tier,region,currency,days_inactive,churn_risk,host_assigned,phone,whatsapp,last_deposit_date,total_deposit,birthday,last_contacted,last_contact_date,activity_status,created_at,registration_date,is_excluded')
          .neq('is_excluded', true),
        supabase.from('contact_logs')
          .select('username,outcome')
          .gte('created_at', todayStart())
          .lte('created_at', todayEnd()),
      ])
      if (vipRes.error) throw vipRes.error
      setVips(vipRes.data || [])
      setTodayLogs(logRes.data || [])
    } catch(e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const now = new Date()
  const getDays = v => {
    if (v.last_deposit_date) return Math.floor((now - new Date(v.last_deposit_date)) / 86400000)
    return v.days_inactive ?? null
  }

  const contactedTodaySet = new Set(todayLogs.map(l => l.username))

  // Apply host filter
  const hostVips = host === 'All' ? vips : vips.filter(v => v.host_assigned === host)

  const isHighRisk  = v => ['HIGH','CRITICAL'].includes((v.churn_risk||'').toUpperCase())
  const isMedRisk   = v => (v.churn_risk||'').toUpperCase() === 'MEDIUM'

  // Compute queues
  const overdue = hostVips.filter(v => {
    const d = getDays(v)
    return isHighRisk(v) && !contactedTodaySet.has(v.username) && (d ?? 0) >= 3
  })

  const followUp = hostVips.filter(v => {
    if (!v.last_contacted && !v.last_contact_date) return true
    const lastC = v.last_contacted || v.last_contact_date
    const daysSince = Math.floor((now - new Date(lastC)) / 86400000)
    return daysSince >= 3 && !contactedTodaySet.has(v.username)
  })

  const atRisk = hostVips.filter(v => isHighRisk(v) || isMedRisk(v))

  const birthdays = hostVips.filter(v => {
    if (!v.birthday) return false
    const bd = new Date(v.birthday)
    return (bd.getUTCMonth()+1) === (now.getMonth()+1) && bd.getUTCDate() === now.getDate()
  })

  // Priority queue (top 20, sorted by urgency)
  const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }
  const seen = new Set(); const items = []
  const addQ = (v, reason, color, priority) => {
    if (seen.has(v.id)) return; seen.add(v.id)
    items.push({ ...v, _reason: reason, _color: color, _priority: priority, _days: getDays(v) })
  }
  birthdays.forEach(v => addQ(v, '🎂 Birthday today', '#EC4899', 10))
  hostVips.filter(v => (v.churn_risk||'').toUpperCase() === 'CRITICAL' && !contactedTodaySet.has(v.username))
    .forEach(v => addQ(v, '🔴 Critical risk', '#EF4444', 9))
  hostVips.filter(v => (v.churn_risk||'').toUpperCase() === 'HIGH' && !contactedTodaySet.has(v.username))
    .forEach(v => addQ(v, '⚠️ High risk', '#F59E0B', 8))
  hostVips.filter(v => getDays(v) === 1 && !contactedTodaySet.has(v.username))
    .forEach(v => addQ(v, '🔴 Lost yesterday', '#EF4444', 7))
  hostVips.filter(v => { const d=getDays(v); return d>=2&&d<=3&&!contactedTodaySet.has(v.username) })
    .forEach(v => addQ(v, '⚡ 2-3 day gap', '#F59E0B', 6))
  followUp.filter(v => !contactedTodaySet.has(v.username))
    .forEach(v => addQ(v, '📅 Follow-up due', '#3B82F6', 5))

  items.sort((a,b) =>
    (b._priority - a._priority) ||
    ((TIER_ORDER[(a.tier||'').toUpperCase()]??9) - (TIER_ORDER[(b.tier||'').toUpperCase()]??9)) ||
    ((b._days??0) - (a._days??0))
  )

  return {
    loading, error,
    refresh: load,
    contactedToday: contactedTodaySet.size,
    needContact: hostVips.filter(v => !contactedTodaySet.has(v.username)).length,
    priorityQueue: items.slice(0, 20),
    overdue,
    followUp,
    atRisk,
    birthdays,
    contactedTodaySet,
    allVips: vips,
    hostVips,
    getDays,
  }
}
