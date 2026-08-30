// src/components/vip/index.jsx — Shared VIP display components
import { TierBadge, StatusBadge, RiskBadge, Btn } from '../ui'
import { TIER_CONFIG, RISK_CONFIG } from '../../lib/enums'
import { formatMoney } from '../../lib/format'

// VIP avatar initials
export function VIPAvatar({ name, size = 36 }) {
  const initial = (name || '?')[0].toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--surface2)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: 'var(--text-2)',
      flexShrink: 0,
    }}>{initial}</div>
  )
}

// VIP identity cell — avatar + name + login
export function VIPIdentity({ vip, onClick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <VIPAvatar name={vip.full_name || vip.username} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {vip.full_name || vip.username}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{vip.username}</div>
      </div>
    </div>
  )
}

// Compact VIP summary — used in cards
export function VIPSummary({ vip }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <VIPAvatar name={vip.full_name || vip.username} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{vip.full_name || vip.username}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <TierBadge tier={vip.tier} />
            <StatusBadge status={vip.activity_status} />
          </div>
        </div>
      </div>
      {vip.host_assigned && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Host: {vip.host_assigned}</div>
      )}
    </div>
  )
}

// Risk indicator
export function VIPRisk({ risk, style }) {
  if (!risk) return null
  const key = (risk || '').toUpperCase()
  const cfg = RISK_CONFIG[risk] || RISK_CONFIG[key]
  if (!cfg) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...style }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
    </div>
  )
}

// Financial mini-summary (deposit, trend)
export function VIPFinancialMini({ deposit, currency, daysAgo, trend }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{formatMoney(deposit, currency)}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
        {daysAgo != null ? `${daysAgo}d ago` : '—'}
        {trend != null && (
          <span style={{ marginLeft: 6, color: trend >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
    </div>
  )
}

// Action row for VIP operations
export function VIPActions({ vipId, onContact, onCreateTask, onOpenVIP }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {onContact    && <Btn size="sm" variant="primary"   onClick={e => { e.stopPropagation(); onContact(vipId) }}>Contact</Btn>}
      {onCreateTask && <Btn size="sm" variant="secondary" onClick={e => { e.stopPropagation(); onCreateTask(vipId) }}>Task</Btn>}
      {onOpenVIP    && <Btn size="sm" variant="ghost"     onClick={e => { e.stopPropagation(); onOpenVIP(vipId) }}>Open</Btn>}
    </div>
  )
}
