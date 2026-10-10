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
// Display-only Chinese labels for stored enum values (never compare against these)
export const ENUM_ZH = {
  Active: '活跃', Watch: '观察', 'At Risk': '有风险', Dormant: '休眠', Unknown: '未知', Inactive: '不活跃',
  Normal: '正常', Critical: '严重', High: '高', Medium: '中', Low: '低', Urgent: '紧急',
  HIGH: '高', MEDIUM: '中', LOW: '低',
  Open: '待处理', 'In Progress': '进行中', Completed: '已完成', Snoozed: '已延后', Cancelled: '已取消', Overdue: '已逾期',
  Draft: '草稿', Planned: '已计划', Archived: '已归档',
  WhatsApp: 'WhatsApp', Call: '电话', 'In-person': '面对面', Birthday: '生日', Campaign: '活动', Other: '其他',
  Contacted: '已联系', 'No Reply': '未回复', Replied: '已回复', Deposited: '已存款', Reactivated: '已重新激活',
  Churned: '已流失', Lost: '流失',
  admin: '管理员', host: '负责人', readonly: '只读',
}
// enumLabel('At Risk', 'zh') -> '有风险'; falls back to the stored value
export function enumLabel(v, lang = 'en') {
  if (lang !== 'zh' || v == null) return v
  return ENUM_ZH[v] || v
}

export const TIER_CONFIG = {
  BLACK:    { color: '#E5E7EB', bg: 'rgba(229,231,235,.1)',  cssVar: 'var(--tier-black)'    },
  DIAMOND:  { color: '#8B5CF6', bg: 'rgba(139,92,246,.12)', cssVar: 'var(--tier-diamond)'  },
  PLATINUM: { color: '#3B82F6', bg: 'rgba(59,130,246,.12)', cssVar: 'var(--tier-platinum)' },
  GOLD:     { color: '#EAB308', bg: 'rgba(234,179,8,.12)',   cssVar: 'var(--tier-gold)'     },
  SILVER:   { color: '#94A3B8', bg: 'rgba(148,163,184,.1)', cssVar: 'var(--tier-silver)'   },
  BRONZE:   { color: '#CD7F32', bg: 'rgba(205,127,50,.1)',   cssVar: 'var(--tier-bronze)'   },
}

export const STATUS_CONFIG = {
  Active:   { color: '#22C55E', bg: 'rgba(34,197,94,.12)',  zh: '活跃'   },
  Watch:    { color: '#F59E0B', bg: 'rgba(245,158,11,.12)', zh: '观察'   },
  'At Risk':{ color: '#EF4444', bg: 'rgba(239,68,68,.12)',  zh: '有风险' },
  Dormant:  { color: '#EF4444', bg: 'rgba(239,68,68,.12)',  zh: '休眠'   },
  Unknown:  { color: '#91A0B2', bg: 'rgba(145,160,178,.1)', zh: '未知'   },
}

export const RISK_CONFIG = {
  Normal:   { color: '#22C55E', bg: 'rgba(34,197,94,.12)',   label: 'Normal',   zh: '正常'   },
  Watch:    { color: '#F59E0B', bg: 'rgba(245,158,11,.12)',  label: 'Watch',    zh: '观察'   },
  'At Risk':{ color: '#EF4444', bg: 'rgba(239,68,68,.12)',   label: 'At Risk',  zh: '有风险' },
  Critical: { color: '#EF4444', bg: 'rgba(239,68,68,.15)',   label: 'Critical', zh: '严重'   },
  HIGH:     { color: '#EF4444', bg: 'rgba(239,68,68,.12)',   label: 'High',     zh: '高'     },
  MEDIUM:   { color: '#F59E0B', bg: 'rgba(245,158,11,.12)',  label: 'Medium',   zh: '中'     },
  LOW:      { color: '#22C55E', bg: 'rgba(34,197,94,.12)',   label: 'Low',      zh: '低'     },
}
