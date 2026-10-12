// src/pages/Alerts.jsx — Command Center / Alerts (V2)
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import BigWinLoss from '../components/alerts/BigWinLoss'
import { loadBigWinLoss } from '../lib/bigWinLoss'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Tabs, Btn, Badge, LoadingState, EmptyState } from '../components/ui'
import { TierBadge, RiskBadge } from '../components/ui'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../hooks/useAuth'

function timeAgo(d, lang = 'en') {
  if (!d) return '—'
  const zh = lang === 'zh'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 60) return zh ? '刚刚' : 'just now'
  if (diff < 3600) return Math.floor(diff/60) + (zh ? '分钟前' : 'm ago')
  if (diff < 86400) return Math.floor(diff/3600) + (zh ? '小时前' : 'h ago')
  return Math.floor(diff/86400) + (zh ? '天前' : 'd ago')
}

export default function Alerts() {
  const navigate = useNavigate()
  const { t, lang } = useLanguage()
  const [vips, setVips]       = useState([])
  const [loading, setLoading] = useState(true)
  const [params, setParams]   = useSearchParams()
  const tab = params.get('tab') || 'critical'
  const setTab = k => setParams(p => { const n = new URLSearchParams(p); n.set('tab', k); return n }, { replace: true })
  const [wlCount, setWlCount] = useState(null)
  const { profile } = useAuth()
  const myName = profile?.full_name || ''
  useEffect(() => { loadBigWinLoss().then(r => setWlCount(r.losses.length + r.wins.length)).catch(() => {}) }, [])

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('vip_members')
        .select('id,username,full_name,tier,churn_risk,activity_status,days_inactive,last_deposit_date,last_contacted,last_contact_date,host_assigned,total_deposit,currency')
        .neq('is_excluded', true)
        .order('tier', { ascending: true })
      setVips(data || [])
      setLoading(false)
    })()
  }, [])

  const now = new Date()
  const getDays = v => {
    if (v.last_deposit_date) return Math.floor((now - new Date(v.last_deposit_date)) / 86400000)
    return v.days_inactive ?? null
  }

  // Host filter: defaults to my own VIPs (if I have any), switchable to any host or All
  const hostList = [...new Set(vips.map(v => (v.host_assigned || '').trim()).filter(Boolean))].sort()
  const hostF = params.get('host') || (hostList.includes(myName) ? myName : 'ALL')
  const setHostF = h => setParams(p => { const n = new URLSearchParams(p); n.set('host', h); return n }, { replace: true })
  const scoped = hostF === 'ALL' ? vips : vips.filter(v => (v.host_assigned || '').trim() === hostF)

  const critical  = scoped.filter(v => (v.churn_risk||'').toUpperCase() === 'CRITICAL')
  const highRisk  = scoped.filter(v => (v.churn_risk||'').toUpperCase() === 'HIGH')
  // Only VIPs that have a host assigned — unassigned VIPs have nobody to contact them yet
  const noContact = scoped.filter(v => (v.host_assigned || '').trim()).filter(v => {
    const lastC = v.last_contacted || v.last_contact_date
    if (!lastC) return true
    return Math.floor((now - new Date(lastC)) / 86400000) >= 7
  }).filter(v => !['CRITICAL','HIGH'].includes((v.churn_risk||'').toUpperCase()))

  const tabs = [
    { key: 'critical', label: t('alerts.tabCritical'),  count: critical.length },
    { key: 'high',     label: t('alerts.tabHigh'),      count: highRisk.length },
    { key: 'contact',  label: t('alerts.tabNoContact'), count: noContact.length },
    { key: 'winloss',  label: lang === 'zh' ? '💰 昨日大赢/大输' : '💰 Big Win/Loss', count: wlCount ?? undefined },
  ]

  const displayMap = { critical, high: highRisk, contact: noContact }
  const display = displayMap[tab] || []

  return (
    <div style={{ padding: '24px 28px', maxWidth: tab === 'winloss' ? 1400 : 1100 }}>
      <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} />

      {loading ? <LoadingState /> : (
        <Card>
          <div style={{ padding: '0 16px' }}>
            <Tabs tabs={tabs} active={tab} onChange={setTab} />
          </div>
          {tab !== 'winloss' && (
            <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginRight: 4 }}>{lang === 'zh' ? '负责人：' : 'Host:'}</span>
              {['ALL', ...hostList].map(h => {
                const on = hostF === h
                return (
                  <button key={h} onClick={() => setHostF(h)} style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--brand)' : 'var(--border)'}`,
                    background: on ? 'var(--brand-dim)' : 'transparent', color: on ? 'var(--brand)' : 'var(--muted)',
                  }}>
                    {h === 'ALL' ? (lang === 'zh' ? '全部' : 'All') : h}{h === myName ? (lang === 'zh' ? '（我）' : ' (me)') : ''}
                  </button>
                )
              })}
            </div>
          )}
          {tab === 'winloss' ? (
            <div style={{ padding: 16 }}><BigWinLoss /></div>
          ) : display.length === 0 ? (
            <EmptyState icon="✅" title={t('alerts.noAlerts')} message={t('alerts.noAlertsMsg')} />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[t('alerts.colVip'), t('alerts.colTier'), t('alerts.colRisk'), t('alerts.colDaysInactive'), t('alerts.colLastContact'), t('alerts.colHost'), t('alerts.colAction')].map(h => (
                      <th key={h} style={{ padding: '9px 14px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {display.map(v => (
                    <tr key={v.id}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      style={{ cursor: 'pointer', transition: 'background .1s' }}
                      onClick={() => navigate(`/vips/${v.id}`)}
                    >
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 600 }}>{v.full_name || v.username}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{v.username}</div>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}><TierBadge tier={v.tier} /></td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}><RiskBadge risk={v.churn_risk} /></td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                        {getDays(v) != null ? (lang === 'zh' ? `${getDays(v)}天` : `${getDays(v)}d`) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 12 }}>
                        {timeAgo(v.last_contacted || v.last_contact_date, lang)}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{v.host_assigned || '—'}</td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <Btn size="sm" variant="primary" onClick={e => { e.stopPropagation(); navigate(`/vips/${v.id}`) }}>{t('alerts.openVip')}</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
