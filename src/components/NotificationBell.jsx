// src/components/NotificationBell.jsx
// A live status bell, not a traditional dismissible inbox — it recomputes
// current problems from the database every few minutes and shows whatever's
// true right now. Fix the underlying issue (assign the VIP, contact the
// Diamond, log an expense) and the alert disappears on its own next poll,
// no separate "mark as read" step needed.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const HIGH_RISK_DAYS = 60

// Plays a short two-tone chime using the Web Audio API — no audio file to
// host or ship, just generated on the fly. Browsers block audio from playing
// before the user has interacted with the page at all; that's a browser
// security rule, not a bug — the sound will start working after the first
// click anywhere on the page.
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const now = ctx.currentTime
    ;[[880, 0], [1108, 0.12]].forEach(([freq, delay]) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + delay)
      gain.gain.exponentialRampToValueAtTime(0.2, now + delay + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + delay)
      osc.stop(now + delay + 0.4)
    })
  } catch (e) {
    // Web Audio unsupported or blocked — fail silently, the badge still shows.
  }
}

async function checkAlerts() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const alerts = []

  const [
    { count: unassignedCount },
    { data: dpVips },
    { count: highRiskCount },
    { count: expensesCount },
    { data: contactedThisMonth },
  ] = await Promise.all([
    supabase.from('vip_members').select('id', { count: 'exact', head: true })
      .eq('is_excluded', false).or('host_assigned.is.null,host_assigned.eq.'),
    supabase.from('vip_members').select('username, tier')
      .in('tier', ['DIAMOND', 'PLATINUM']).eq('is_excluded', false),
    supabase.from('vip_members').select('id', { count: 'exact', head: true })
      .eq('is_excluded', false).or(`churn_risk.eq.HIGH,days_inactive.gte.${HIGH_RISK_DAYS}`),
    supabase.from('department_expenses').select('id', { count: 'exact', head: true }).eq('month', currentMonth),
    supabase.from('contact_logs').select('username').eq('log_month', currentMonth),
  ])

  if (unassignedCount > 0) {
    alerts.push({
      key: 'unassigned', icon: '🚫', severity: 'high',
      titleKey: 'notificationBell.unassignedTitle', titleParams: { n: unassignedCount, s: unassignedCount === 1 ? '' : 's' },
      descKey: 'notificationBell.unassignedDesc',
      link: '/vips?unassigned=true',
    })
  }

  if (dpVips?.length) {
    const contactedSet = new Set((contactedThisMonth || []).map(c => c.username))
    const uncontacted = dpVips.filter(v => !contactedSet.has(v.username))
    if (uncontacted.length > 0) {
      alerts.push({
        key: 'dp_uncontacted', icon: '💎', severity: 'high',
        titleKey: 'notificationBell.dpTitle', titleParams: { n: uncontacted.length },
        descKey: 'notificationBell.dpDesc',
        link: '/churn?tab=diamond',
      })
    }
  }

  if (highRiskCount > 0) {
    alerts.push({
      key: 'high_risk', icon: '🔴', severity: 'high',
      titleKey: 'notificationBell.highRiskTitle', titleParams: { n: highRiskCount, s: highRiskCount === 1 ? '' : 's', d: HIGH_RISK_DAYS },
      descKey: 'notificationBell.highRiskDesc',
      link: '/churn',
    })
  }

  if (!expensesCount || expensesCount === 0) {
    alerts.push({
      key: 'no_expenses', icon: '💸', severity: 'low',
      titleKey: 'notificationBell.noExpensesTitle', titleParams: { month: currentMonth },
      descKey: 'notificationBell.noExpensesDesc',
      link: '/expenses',
    })
  }

  return alerts
}

function applyParams(str, params) {
  if (!params) return str
  return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), str)
}

export default function NotificationBell() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const prevCountRef = useRef(0)
  const firstLoadRef = useRef(true)

  useEffect(() => {
    if (!profile) return
    let cancelled = false

    async function poll() {
      try {
        const next = await checkAlerts()
        if (cancelled) return
        // Only chime when the count goes UP — not on every poll, and not on
        // first load (so opening the app doesn't immediately make noise).
        if (!firstLoadRef.current && next.length > prevCountRef.current) playChime()
        firstLoadRef.current = false
        prevCountRef.current = next.length
        setAlerts(next)
      } catch (e) {
        console.error('NotificationBell poll error', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [profile])

  const highCount = alerts.filter(a => a.severity === 'high').length

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="System status"
        style={{
          position: 'relative', background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', fontSize: 16,
        }}>
        🔔
        {alerts.length > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 3px',
            borderRadius: 8, background: highCount > 0 ? '#f85149' : '#d29922', color: '#fff',
            fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {alerts.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'absolute', top: 42, left: 0, width: 320, maxHeight: 420, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,.4)', zIndex: 41,
          }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>
              {t('notificationBell.systemStatus')}
            </div>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{t('notificationBell.checking')}</div>
            ) : alerts.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#3fb950', fontSize: 12 }}>{t('notificationBell.allClear')}</div>
            ) : (
              alerts.map(a => (
                <div key={a.key}
                  onClick={() => { setOpen(false); navigate(a.link) }}
                  style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', gap: 10 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ fontSize: 18, flexShrink: 0 }}>{a.icon}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: a.severity === 'high' ? '#f85149' : '#d29922' }}>{applyParams(t(a.titleKey), a.titleParams)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t(a.descKey)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
