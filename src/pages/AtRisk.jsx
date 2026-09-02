// src/pages/AtRisk.jsx — VIP Operations / At Risk (V2)
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  PageHeader, Card, KpiCard, Btn, FilterPills,
  LoadingState, ErrorState, EmptyState,
} from '../components/ui'
import { TierBadge, RiskBadge } from '../components/ui'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'

function daysAgoLabel(d) {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d)) / 86400000)
  if (days === 0) return 'Today'; if (days === 1) return 'Yesterday'
  return days + 'd ago'
}

const RISK_LEVELS = ['All', 'Critical', 'High', 'Medium']

export default function AtRisk() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [vips, setVips]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [riskFilter, setRiskFilter] = useState('All')
  const [host, setHost]       = useState('All')
  const [hosts, setHosts]     = useState(['All'])

  useEffect(() => {
    (async () => {
      const [vipRes, hostRes] = await Promise.all([
        supabase.from('vip_members')
          .select('id,username,full_name,tier,churn_risk,activity_status,days_inactive,last_deposit_date,total_deposit,win_loss,currency,last_contacted,last_contact_date,host_assigned,region,is_excluded')
          .neq('is_excluded', true)
          .in('churn_risk', ['HIGH','MEDIUM','CRITICAL']),
        supabase.from('profiles').select('full_name').in('role',['admin','host']).order('full_name'),
      ])
      if (vipRes.error) { setError(vipRes.error.message); setLoading(false); return }
      setVips(vipRes.data || [])
      setHosts(['All', ...(hostRes.data||[]).map(h => h.full_name).filter(Boolean)])
      setLoading(false)
    })()
  }, [])

  const now = new Date()
  const getDays = v => {
    if (v.last_deposit_date) return Math.floor((now - new Date(v.last_deposit_date)) / 86400000)
    return v.days_inactive ?? null
  }

  const riskNorm = r => (r||'').toUpperCase()
  const filtered = vips.filter(v => {
    if (host !== 'All' && v.host_assigned !== host) return false
    if (riskFilter === 'All') return true
    return riskNorm(v.churn_risk) === riskFilter.toUpperCase()
  })

  const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }
  const sorted = [...filtered].sort((a, b) => {
    const rOrd = { CRITICAL:0, HIGH:1, MEDIUM:2 }
    const ra = rOrd[riskNorm(a.churn_risk)] ?? 9
    const rb = rOrd[riskNorm(b.churn_risk)] ?? 9
    if (ra !== rb) return ra - rb
    return (TIER_ORDER[(a.tier||'').toUpperCase()]??9) - (TIER_ORDER[(b.tier||'').toUpperCase()]??9)
  })

  const critical = vips.filter(v => riskNorm(v.churn_risk) === 'CRITICAL')
  const high     = vips.filter(v => riskNorm(v.churn_risk) === 'HIGH')
  const medium   = vips.filter(v => riskNorm(v.churn_risk) === 'MEDIUM')

  if (loading) return <div style={{ padding: 32 }}><LoadingState /></div>
  if (error)   return <div style={{ padding: 32 }}><ErrorState message={error} /></div>

  return (
    <div style={{ padding: '24px 28px' }}>
      <PageHeader title={t('atRisk.title')} subtitle={t('atRisk.subtitle')} />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label={t('atRisk.criticalKpi')} value={critical.length} color="var(--danger)" onClick={() => setRiskFilter('Critical')} />
        <KpiCard label={t('atRisk.highKpi')} value={high.length} color="var(--warning)" onClick={() => setRiskFilter('High')} />
        <KpiCard label={t('atRisk.mediumKpi')} value={medium.length} color="var(--info)" onClick={() => setRiskFilter('Medium')} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterPills options={RISK_LEVELS.map(r => ({ value: r, label: r }))} active={riskFilter} onChange={setRiskFilter} />
        <select value={host} onChange={e => setHost(e.target.value)}
          style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 12px', borderRadius:7, fontSize:13, outline:'none', marginLeft:'auto' }}>
          {hosts.map(h => <option key={h} value={h}>{h === 'All' ? t('atRisk.allHosts') : h}</option>)}
        </select>
      </div>

      {/* Table */}
      <Card>
        {sorted.length === 0 ? (
          <EmptyState icon="🟢" title={t('atRisk.noAtRisk')} message={t('atRisk.noAtRiskMsg')} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {[t('atRisk.colVip'), t('common.tier'), t('atRisk.colRiskLevel'), t('atRisk.colReason'), t('atRisk.colDaysInactive'), t('atRisk.colLastContact'), t('atRisk.colDeposit'), t('common.host'), t('atRisk.colAction')].map(h => (
                    <th key={h} style={{ padding:'9px 14px', textAlign:'left', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(v => {
                  const days = getDays(v)
                  const reasons = []
                  if (days != null && days >= 7) reasons.push(`No deposit ${days}d`)
                  const lastC = v.last_contacted || v.last_contact_date
                  if (lastC) {
                    const dC = Math.floor((now - new Date(lastC)) / 86400000)
                    if (dC >= 3) reasons.push(`No contact ${dC}d`)
                  } else { reasons.push('Never contacted') }

                  return (
                    <tr key={v.id}
                      onClick={() => navigate(`/vips/${v.id}`)}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      style={{ cursor:'pointer', transition:'background .1s' }}
                    >
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ fontWeight:600 }}>{v.username}</div>
                        <div style={{ fontSize:11, color:'var(--muted)' }}>{v.full_name || ''}</div>
                      </td>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}><TierBadge tier={v.tier} /></td>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}><RiskBadge risk={v.churn_risk} /></td>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>
                        {reasons.join(' · ') || '—'}
                      </td>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12 }}>
                        {days != null ? `${days}d` : '—'}
                      </td>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12 }}>
                        {daysAgoLabel(v.last_contacted || v.last_contact_date)}
                      </td>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>
                        {formatMoney(v.total_deposit, v.currency)}
                      </td>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', color:'var(--muted)' }}>
                        {v.host_assigned || '—'}
                      </td>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', gap:6 }}>
                          <Btn size="sm" variant="primary" onClick={e => { e.stopPropagation(); navigate(`/vips/${v.id}`) }}>{t('atRisk.openVip')}</Btn>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
