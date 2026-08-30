// src/components/task/index.jsx — Shared Task components
import { Btn, Badge } from '../ui'
import { TASK_PRIORITY } from '../../lib/enums'

const PRIORITY_CONFIG = {
  Urgent: { color: '#EF4444', bg: 'rgba(239,68,68,.12)' },
  High:   { color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  Medium: { color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  Low:    { color: '#91A0B2', bg: 'rgba(145,160,178,.1)' },
}

const STATUS_CONFIG = {
  Open:        { color: '#3B82F6', label: 'Open'        },
  'In Progress':{ color: '#F59E0B', label: 'In Progress' },
  Completed:   { color: '#22C55E', label: 'Completed'   },
  Snoozed:     { color: '#91A0B2', label: 'Snoozed'     },
  Cancelled:   { color: '#617083', label: 'Cancelled'   },
  Overdue:     { color: '#EF4444', label: 'Overdue'     },
}

export function TaskPriorityBadge({ priority }) {
  if (!priority) return null
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.Medium
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, color: cfg.color, background: cfg.bg,
    }}>{priority}</span>
  )
}

export function TaskStatusBadge({ status }) {
  if (!status) return null
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.Open
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      color: cfg.color, background: cfg.color + '22',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color }} />
      {cfg.label}
    </span>
  )
}

export function TaskCard({ task, onComplete, onSnooze, onOpenVIP }) {
  const isOverdue = task.status === 'Overdue' || (
    task.due_date && new Date(task.due_date) < new Date() && task.status !== 'Completed'
  )
  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${isOverdue ? 'rgba(239,68,68,.3)' : 'var(--border)'}`,
      borderRadius: 10, padding: '14px 16px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{task.title}</div>
          {task.vip_name && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {task.vip_tier && <span style={{ marginRight: 6 }}>[{task.vip_tier}]</span>}
              {task.vip_name}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <TaskPriorityBadge priority={task.priority} />
          <TaskStatusBadge status={isOverdue ? 'Overdue' : task.status} />
        </div>
      </div>

      {task.reason && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, padding: '6px 10px', background: 'var(--surface2)', borderRadius: 6 }}>
          {task.reason}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <div style={{ fontSize: 11, color: isOverdue ? 'var(--danger)' : 'var(--muted)' }}>
          {task.due_date ? `Due: ${new Date(task.due_date).toLocaleDateString('en-MY', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}` : 'No due date'}
          {task.owner && <span style={{ marginLeft: 10 }}>· {task.owner}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onComplete && <Btn size="sm" variant="primary"   onClick={() => onComplete(task)}>Complete</Btn>}
          {onSnooze   && <Btn size="sm" variant="ghost"     onClick={() => onSnooze(task)}>Snooze</Btn>}
          {onOpenVIP  && task.vip_id && <Btn size="sm" variant="ghost" onClick={() => onOpenVIP(task.vip_id)}>Open VIP</Btn>}
        </div>
      </div>
    </div>
  )
}
