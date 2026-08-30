// src/lib/enums.js
// Single source of truth for all status enums. All UI badges, filters, and
// queries derive from these definitions — never define ad-hoc status strings
// in individual pages.

export const VIP_TIER = ['BLACK', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE']

export const VIP_STATUS = {
  ACTIVE:   'Active',
  WATCH:    'Watch',
  AT_RISK:  'At Risk',
  DORMANT:  'Dormant',
  UNKNOWN:  'Unknown',
}

export const RISK_LEVEL = {
  NORMAL:   'Normal',
  WATCH:    'Watch',
  AT_RISK:  'At Risk',
  CRITICAL: 'Critical',
}

export const TASK_STATUS = {
  OPEN:        'Open',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  SNOOZED:     'Snoozed',
  CANCELLED:   'Cancelled',
  OVERDUE:     'Overdue',
}

export const TASK_PRIORITY = {
  LOW:    'Low',
  MEDIUM: 'Medium',
  HIGH:   'High',
  URGENT: 'Urgent',
}

export const CAMPAIGN_STATUS = {
  DRAFT:     'Draft',
  PLANNED:   'Planned',
  ACTIVE:    'Active',
  COMPLETED: 'Completed',
  ARCHIVED:  'Archived',
}

export const CONTACT_TYPE = [
  'WhatsApp', 'Call', 'In-person', 'Birthday', 'Campaign', 'Other',
]

export const CONTACT_OUTCOME = [
  'Contacted', 'No Reply', 'Replied', 'Deposited', 'Reactivated',
]

export const ACTIVITY_TYPE = {
  DEPOSIT:      'deposit',
  WITHDRAWAL:   'withdrawal',
  CONTACT:      'contact',
  WHATSAPP:     'whatsapp',
  TASK:         'task',
  CAMPAIGN:     'campaign',
  UPGRADE:      'upgrade',
  NOTE:         'note',
  CHURN_CHANGE: 'churn_change',
  TIER_CHANGE:  'tier_change',
}

export const USER_ROLE = {
  ADMIN:    'admin',
  HOST:     'host',
  READONLY: 'readonly',
}

// Tier display config
export const TIER_CONFIG = {
  BLACK:    { color: '#E5E7EB', bg: 'rgba(229,231,235,.1)',  cssVar: 'var(--tier-black)'    },
  DIAMOND:  { color: '#8B5CF6', bg: 'rgba(139,92,246,.12)', cssVar: 'var(--tier-diamond)'  },
  PLATINUM: { color: '#3B82F6', bg: 'rgba(59,130,246,.12)', cssVar: 'var(--tier-platinum)' },
  GOLD:     { color: '#EAB308', bg: 'rgba(234,179,8,.12)',   cssVar: 'var(--tier-gold)'     },
  SILVER:   { color: '#94A3B8', bg: 'rgba(148,163,184,.1)', cssVar: 'var(--tier-silver)'   },
  BRONZE:   { color: '#CD7F32', bg: 'rgba(205,127,50,.1)',   cssVar: 'var(--tier-bronze)'   },
}

export const STATUS_CONFIG = {
  Active:   { color: '#22C55E', bg: 'rgba(34,197,94,.12)'  },
  Watch:    { color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  'At Risk':{ color: '#EF4444', bg: 'rgba(239,68,68,.12)'  },
  Dormant:  { color: '#EF4444', bg: 'rgba(239,68,68,.12)'  },
  Unknown:  { color: '#91A0B2', bg: 'rgba(145,160,178,.1)' },
}

export const RISK_CONFIG = {
  Normal:   { color: '#22C55E', bg: 'rgba(34,197,94,.12)',   label: 'Normal'   },
  Watch:    { color: '#F59E0B', bg: 'rgba(245,158,11,.12)',  label: 'Watch'    },
  'At Risk':{ color: '#EF4444', bg: 'rgba(239,68,68,.12)',   label: 'At Risk'  },
  Critical: { color: '#EF4444', bg: 'rgba(239,68,68,.15)',   label: 'Critical' },
  HIGH:     { color: '#EF4444', bg: 'rgba(239,68,68,.12)',   label: 'High'     },
  MEDIUM:   { color: '#F59E0B', bg: 'rgba(245,158,11,.12)',  label: 'Medium'   },
  LOW:      { color: '#22C55E', bg: 'rgba(34,197,94,.12)',   label: 'Low'      },
}
