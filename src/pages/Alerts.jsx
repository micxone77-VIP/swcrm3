// src/pages/Alerts.jsx — Command Center / Alerts (V2)
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Tabs, Btn, Badge, LoadingState, EmptyState } from '../components/ui'
import { TierBadge, RiskBadge } from '../components/ui'

function timeAgo(d) {
  if (!d) return '—'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff/60) + 'm ago'
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago'
  return Math.floor(diff/86400) + 'd ago'
}

export default function Alerts() {
  const navigate = useNavigate()
  const [vips, setVips]       = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('critical')

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

  const critical  = vips.filter(v => (v.churn_risk||'').toUpperCase() === 'CRITICAL')
  const highRisk  = vips.filter(v => (v.churn_risk||'').toUpperCase() === 'HIGH')
  const noContact = vips.filter(v => {
    const lastC = v.last_contacted || v.last_contact_date
    if (!lastC) return true
    return Math.floor((now - new Date(lastC)) / 86400000) >= 7
  }).filter(v => !['CRITICAL','HIGH'].includes((v.churn_risk||'').toUpperCase()))

  const tabs = [
    { key: 'critical', label: 'Critical',      count: critical.length },
    { key: 'high',     label: 'High Risk',     count: highRisk.length },
    { key: 'contact',  label: 'No Contact 7d+',count: noContact.length },
  ]

  const displayMap = { critical, high: highRisk, contact: noContact }
  const display = displayMap[tab] || []

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      <PageHeader title="Alerts" subtitle="VIPs that need immediate attention" />

      {loading ? <LoadingState /> : (
        <Card>
          <div style={{ padding: '0 16px' }}>
            <Tabs tabs={tabs} active={tab} onChange={setTab} />
          </div>
          {display.length === 0 ? (
            <EmptyState icon="✅" title="No alerts in this category" message="Great — nothing critical to action right now." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['VIP', 'Tier', 'Risk', 'Days Inactive', 'Last Contact', 'Host', 'Action'].map(h => (
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
                        {getDays(v) != null ? `${getDays(v)}d` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 12 }}>
                        {timeAgo(v.last_contacted || v.last_contact_date)}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>{v.host_assigned || '—'}</td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <Btn size="sm" variant="primary" onClick={e => { e.stopPropagation(); navigate(`/vips/${v.id}`) }}>Open VIP</Btn>
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
