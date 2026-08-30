// src/components/ui/index.jsx
// Shared UI component library — all pages import from here, not page-specific duplicates.

import { useState, useRef, useEffect } from 'react'
import { TIER_CONFIG, STATUS_CONFIG, RISK_CONFIG } from '../../lib/enums'

// ── Button ──────────────────────────────────────────────────────────────────
export function Btn({ children, variant = 'secondary', size = 'md', onClick, disabled, style, type = 'button' }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    border: 'none', borderRadius: 'var(--r-sm)', fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? .5 : 1,
    transition: 'opacity .15s, background .15s',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  }
  const sizes = {
    sm: { padding: '5px 12px', fontSize: 12 },
    md: { padding: '8px 16px', fontSize: 13 },
    lg: { padding: '10px 22px', fontSize: 14 },
  }
  const variants = {
    primary:   { background: 'var(--brand)',    color: '#fff' },
    secondary: { background: 'var(--surface2)', color: 'var(--text)',  border: '1px solid var(--border)' },
    danger:    { background: '#EF4444',          color: '#fff' },
    ghost:     { background: 'transparent',      color: 'var(--muted)', border: '1px solid var(--border)' },
    link:      { background: 'transparent',      color: 'var(--brand)', padding: 0 },
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

// ── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ children, color, bg, style }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      color: color || 'var(--text)',
      background: bg || 'var(--surface2)',
      ...style,
    }}>{children}</span>
  )
}

export function TierBadge({ tier }) {
  if (!tier) return null
  const cfg = TIER_CONFIG[(tier || '').toUpperCase()] || TIER_CONFIG.SILVER
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 4,
      fontSize: 11, fontWeight: 700,
      color: cfg.color, background: cfg.bg,
    }}>{tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase()}</span>
  )
}

export function StatusBadge({ status }) {
  if (!status) return null
  const cfg = STATUS_CONFIG[status] || { color: 'var(--muted)', bg: 'var(--surface2)' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      color: cfg.color, background: cfg.bg,
    }}>{status}</span>
  )
}

export function RiskBadge({ risk }) {
  if (!risk) return null
  const key = (risk || '').toUpperCase()
  const cfg = RISK_CONFIG[risk] || RISK_CONFIG[key] || { color: 'var(--muted)', bg: 'var(--surface2)', label: risk }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      color: cfg.color, background: cfg.bg,
    }}>{cfg.label}</span>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style, onClick, hover = false }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hover && setHovered(true)}
      onMouseLeave={() => hover && setHovered(false)}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${hovered ? 'var(--border)' : 'var(--border)'}`,
        borderRadius: 'var(--r-md)',
        ...(onClick ? { cursor: 'pointer' } : {}),
        ...(hovered ? { background: 'var(--surface2)' } : {}),
        transition: 'background .15s',
        ...style,
      }}>{children}</div>
  )
}

export function CardHeader({ children, style }) {
  return (
    <div style={{
      padding: '12px 18px', borderBottom: '1px solid var(--border)',
      fontSize: 12, fontWeight: 700, color: 'var(--muted)',
      textTransform: 'uppercase', letterSpacing: '.5px',
      display: 'flex', alignItems: 'center', gap: 8,
      ...style,
    }}>{children}</div>
  )
}

export function CardBody({ children, style }) {
  return <div style={{ padding: '16px 18px', ...style }}>{children}</div>
}

// KPI summary card
export function KpiCard({ label, value, sub, color, onClick, icon }) {
  return (
    <Card onClick={onClick} hover={!!onClick} style={{ padding: '18px 20px', borderTop: `3px solid ${color || 'var(--border)'}` }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.3px', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 700, color: color || 'var(--text)', lineHeight: 1 }}>{value}</span>
        {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </Card>
  )
}

// ── Input / Select / Textarea ─────────────────────────────────────────────────
export function Input({ value, onChange, placeholder, type = 'text', style, disabled }) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        color: 'var(--text)', padding: '8px 12px',
        borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none',
        width: '100%',
        ...style,
      }} />
  )
}

export function Select({ value, onChange, children, style, disabled }) {
  return (
    <select value={value} onChange={onChange} disabled={disabled}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        color: 'var(--text)', padding: '8px 12px',
        borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none',
        ...style,
      }}>{children}</select>
  )
}

export function Textarea({ value, onChange, placeholder, rows = 3, style }) {
  return (
    <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        color: 'var(--text)', padding: '8px 12px',
        borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none',
        width: '100%', resize: 'vertical', fontFamily: 'inherit',
        ...style,
      }} />
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange, style }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', ...style }}>
      {tabs.map(tab => (
        <button key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            padding: '10px 16px', background: 'none', border: 'none',
            fontSize: 13, fontWeight: active === tab.key ? 600 : 400,
            color: active === tab.key ? 'var(--text)' : 'var(--muted)',
            borderBottom: `2px solid ${active === tab.key ? 'var(--brand)' : 'transparent'}`,
            cursor: 'pointer', transition: 'color .15s',
            marginBottom: -1,
          }}>
          {tab.label}
          {tab.count != null && (
            <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700,
              background: active === tab.key ? 'var(--brand-dim)' : 'var(--surface2)',
              color: active === tab.key ? 'var(--brand)' : 'var(--muted)',
              padding: '1px 6px', borderRadius: 10 }}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 480 }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])
  if (!open) return null
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', padding: 24, width: '100%', maxWidth: width,
        boxShadow: 'var(--shadow-md)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
export function Toast({ message, type = 'success', onClose }) {
  const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--info)', warning: 'var(--warning)' }
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
      background: 'var(--surface2)', border: `1px solid ${colors[type]}`,
      borderLeft: `4px solid ${colors[type]}`,
      borderRadius: 'var(--r-md)', padding: '12px 18px',
      color: 'var(--text)', fontSize: 13, fontWeight: 500,
      boxShadow: 'var(--shadow-md)', display: 'flex', gap: 10, alignItems: 'center',
    }}>
      {message}
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
    </div>
  )
}

// ── Empty / Loading / Error states ────────────────────────────────────────────
export function LoadingState({ message = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', color: 'var(--muted)', gap: 10 }}>
      <div style={{ width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      {message}
    </div>
  )
}

export function EmptyState({ icon = '📭', title, message, action }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', color: 'var(--muted)', textAlign: 'center', gap: 12 }}>
      <div style={{ fontSize: 36 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)' }}>{title}</div>
      {message && <div style={{ fontSize: 13, maxWidth: 300 }}>{message}</div>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', color: 'var(--muted)', textAlign: 'center', gap: 12 }}>
      <div style={{ fontSize: 36 }}>⚠️</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--danger)' }}>Something went wrong</div>
      <div style={{ fontSize: 13, maxWidth: 360 }}>{message}</div>
      {onRetry && <Btn variant="secondary" onClick={onRetry}>Retry</Btn>}
    </div>
  )
}

// ── DataTable ─────────────────────────────────────────────────────────────────
export function DataTable({ columns, rows, onRowClick, emptyState, loading, keyFn }) {
  if (loading) return <LoadingState />
  if (!rows || rows.length === 0) return emptyState || <EmptyState title="No data" message="No records match the current filters." />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{
                padding: '9px 12px', textAlign: col.align || 'left',
                background: 'var(--surface)', color: 'var(--muted)',
                fontWeight: 600, fontSize: 11, letterSpacing: '.3px',
                borderBottom: '1px solid var(--border)',
                whiteSpace: 'nowrap',
                ...col.thStyle,
              }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={keyFn ? keyFn(row) : i}
              onClick={() => onRowClick?.(row)}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
                transition: 'background .1s',
              }}
              onMouseEnter={e => onRowClick && (e.currentTarget.style.background = 'var(--surface2)')}
              onMouseLeave={e => onRowClick && (e.currentTarget.style.background = 'transparent')}
            >
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '9px 12px',
                  borderBottom: '1px solid var(--border)',
                  verticalAlign: 'middle',
                  textAlign: col.align || 'left',
                  ...col.tdStyle,
                }}>
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────
export function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
      </span>
      <Btn size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>← Prev</Btn>
      <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 60, textAlign: 'center' }}>
        {page} / {totalPages}
      </span>
      <Btn size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next →</Btn>
    </div>
  )
}

// ── PageHeader ────────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      marginBottom: 24, flexWrap: 'wrap', gap: 12, ...style,
    }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>}
    </div>
  )
}

// ── Filter pill row ───────────────────────────────────────────────────────────
export function FilterPills({ options, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(opt => (
        <button key={opt.value ?? opt}
          onClick={() => onChange(opt.value ?? opt)}
          style={{
            padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            border: `1px solid ${(active === (opt.value ?? opt)) ? 'var(--brand)' : 'var(--border)'}`,
            background: (active === (opt.value ?? opt)) ? 'var(--brand-dim)' : 'transparent',
            color: (active === (opt.value ?? opt)) ? 'var(--brand)' : 'var(--muted)',
            cursor: 'pointer',
          }}>
          {opt.label ?? opt}
        </button>
      ))}
    </div>
  )
}

// ── Divider ───────────────────────────────────────────────────────────────────
export function Divider({ style }) {
  return <div style={{ borderBottom: '1px solid var(--border)', margin: '16px 0', ...style }} />
}

// ── useToast hook ─────────────────────────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = useState([])
  const toast = (message, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, type }])
  }
  const remove = id => setToasts(t => t.filter(x => x.id !== id))
  const ToastContainer = () => (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => <Toast key={t.id} message={t.message} type={t.type} onClose={() => remove(t.id)} />)}
    </div>
  )
  return { toast, ToastContainer }
}
