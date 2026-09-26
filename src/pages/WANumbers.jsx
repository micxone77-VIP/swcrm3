// src/pages/WANumbers.jsx — WhatsApp Number Manager
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

// ─── constants ────────────────────────────────────────────────────────────────
const STATUSES = ['Active', 'Cooling', 'Review', 'Suspended', 'Standby', 'Dead']
const TYPES    = ['Personal', 'Business']
const TELCOS   = ['HOTLINK', 'REDONE', 'Digi', 'UMobile', 'Celcom', 'Maxis', 'Other']

const STATUS_META = {
  Active:    { color: '#22C55E', bg: '#22C55E22', label: 'Active' },
  Cooling:   { color: '#F59E0B', bg: '#F59E0B22', label: 'Cooling' },
  Review:    { color: '#EF4444', bg: '#EF444422', label: 'Review' },
  Suspended: { color: '#DC2626', bg: '#DC262622', label: 'Suspended' },
  Standby:   { color: '#6B7280', bg: '#6B728022', label: 'Standby' },
  Dead:      { color: '#374151', bg: '#37415122', label: 'Dead' },
}

const EMPTY_FORM = {
  host: '', codename: '', number: '', type: 'Personal',
  telco: '', status: 'Standby', phone_slot: '',
  email: '', valid_until: '', last_reload_date: '', notes: '',
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const m = STATUS_META[status] || { color: '#6B7280', bg: '#6B728022', label: status }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, letterSpacing: '.4px',
      color: m.color, background: m.bg, border: `1px solid ${m.color}44`,
    }}>{m.label}</span>
  )
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  const copy = (e) => {
    e.stopPropagation()
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setDone(true); setTimeout(() => setDone(false), 1500)
    })
  }
  return (
    <button onClick={copy} title={`Copy ${text}`} style={{
      border: 'none', background: 'transparent', cursor: text ? 'pointer' : 'default',
      color: done ? '#4ade80' : 'var(--muted)', fontSize: 11,
      padding: '0 3px', lineHeight: 1, opacity: text ? 1 : 0.3,
    }}>{done ? '✓' : '📋'}</button>
  )
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────
function NumberModal({ initial, hosts, onSave, onClose }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const isStandby = form.status === 'Standby'

  async function handleSave() {
    if (!form.host.trim())                           return setErr('Host is required.')
    if (!isStandby && !form.codename.trim())         return setErr('Codename is required.')
    if (!form.number.trim())                         return setErr('Number is required.')
    setSaving(true); setErr('')
    try {
      const payload = {
        host: form.host.trim(),
        codename: form.codename.trim(),
        number: form.number.trim().replace(/\s/g, ''),
        type: form.type,
        telco: form.telco || null,
        status: form.status,
        phone_slot: form.phone_slot || null,
        email: form.email || null,
        valid_until: form.valid_until || null,
        last_reload_date: form.last_reload_date || null,
        notes: form.notes || null,
      }
      if (form.id) {
        const { error } = await supabase.from('wa_numbers').update(payload).eq('id', form.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('wa_numbers').insert(payload)
        if (error) throw error
      }
      onSave()
    } catch (e) {
      setErr(e.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const inp = (label, key, opts = {}) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</label>
      <input
        value={form[key] || ''}
        onChange={e => set(key, e.target.value)}
        placeholder={opts.placeholder || ''}
        type={opts.type || 'text'}
        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 13 }}
      />
    </div>
  )

  const sel = (label, key, options) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</label>
      <select
        value={form[key] || ''}
        onChange={e => set(key, e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 13 }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{form.id ? 'Edit Number' : 'Add New Number'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div>
            {/* Host — allow typing a new host or picking existing */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>Host</label>
              <input
                list="host-list"
                value={form.host || ''}
                onChange={e => set('host', e.target.value)}
                placeholder="e.g. Marcus"
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 13 }}
              />
              <datalist id="host-list">{hosts.map(h => <option key={h} value={h} />)}</datalist>
            </div>
            <div style={{ marginBottom: 12, opacity: isStandby ? 0.4 : 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                Codename {isStandby && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(assigned on promote)</span>}
              </label>
              <input
                value={form.codename || ''}
                onChange={e => set('codename', e.target.value)}
                placeholder="Marcus01"
                disabled={isStandby}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 13 }}
              />
            </div>
            {inp('Number', 'number', { placeholder: '601112365940' })}
            {sel('Type', 'type', TYPES)}
            {sel('Telco', 'telco', ['', ...TELCOS])}
          </div>
          <div>
            {sel('Status', 'status', STATUSES)}
            <div style={{ marginBottom: 12, opacity: isStandby ? 0.4 : 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                Phone Slot {isStandby && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(assigned on promote)</span>}
              </label>
              <input
                value={form.phone_slot || ''}
                onChange={e => set('phone_slot', e.target.value)}
                placeholder="opo ori 1"
                disabled={isStandby}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 13 }}
              />
            </div>
            {inp('Email', 'email', { placeholder: 'c.wapps101@gmail.com' })}
            {inp('Valid Until', 'valid_until', { type: 'date' })}
            {inp('Last Reload', 'last_reload_date', { type: 'date' })}
          </div>
        </div>

        {/* Notes full width */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>Notes</label>
          <textarea
            value={form.notes || ''}
            onChange={e => set('notes', e.target.value)}
            rows={2}
            placeholder="Any remarks..."
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: 13, resize: 'vertical' }}
          />
        </div>

        {err && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: 'var(--brand)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? .6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function ConfirmDelete({ row, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    await supabase.from('wa_numbers').delete().eq('id', row.id)
    onConfirm()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
        <h3 style={{ margin: '0 0 8px', color: 'var(--text)' }}>Delete {row.codename}?</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 20px' }}>This will permanently remove <strong>{row.number}</strong> from the system.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={go} disabled={busy} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: '#DC2626', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Promote Standby modal ────────────────────────────────────────────────────
function PromoteModal({ suspended, standbys, onDone, onClose }) {
  const [chosen, setChosen] = useState(standbys[0]?.id || '')
  const [busy, setBusy] = useState(false)

  async function go() {
    if (!chosen) return
    setBusy(true)
    // Suspend the old active number
    await supabase.from('wa_numbers').update({ status: 'Suspended' }).eq('id', suspended.id)
    // Promote standby: inherit codename, phone_slot, email from the suspended slot
    await supabase.from('wa_numbers').update({
      status: 'Active',
      codename:   suspended.codename,
      phone_slot: suspended.phone_slot,
      email:      suspended.email,
    }).eq('id', chosen)
    onDone()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: 420 }}>
        <h3 style={{ margin: '0 0 6px', color: 'var(--text)' }}>🔄 Promote Standby</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 18px' }}>
          <strong>{suspended.codename}</strong> ({suspended.number}) will be marked <strong style={{ color: '#DC2626' }}>Suspended</strong>. Choose which Standby to promote to <strong style={{ color: '#22C55E' }}>Active</strong>:
        </p>
        {standbys.length === 0 ? (
          <p style={{ color: '#EF4444', fontSize: 13 }}>No Standby numbers available for {suspended.host}.</p>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {standbys.map(s => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 7, marginBottom: 4, background: chosen === s.id ? 'rgba(34,197,94,.1)' : 'var(--surface2)', border: `1px solid ${chosen === s.id ? '#22C55E44' : 'var(--border)'}`, cursor: 'pointer' }}>
                <input type="radio" name="standby" value={s.id} checked={chosen === s.id} onChange={() => setChosen(s.id)} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.number}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.telco} · {s.type} — will take slot <strong style={{ color: 'var(--text)' }}>{suspended.codename}</strong> / {suspended.phone_slot}</div>
                </div>
              </label>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={go} disabled={busy || standbys.length === 0} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: '#22C55E', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: busy || standbys.length === 0 ? .5 : 1 }}>
            {busy ? 'Promoting…' : 'Promote'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────
function NumberRow({ row, standbys, onEdit, onDelete, onPromote }) {
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
  const isExpired = row.valid_until && new Date(row.valid_until) < new Date()

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <td style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--text)' }}>{row.codename}</td>
      <td style={{ padding: '8px 10px', color: 'var(--text)', fontFamily: 'monospace' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {row.number}
          <CopyBtn text={row.number} />
        </div>
      </td>
      <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{row.type}</td>
      <td style={{ padding: '8px 10px' }}>
        {row.telco ? (
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
            background: row.telco === 'HOTLINK' ? '#EF444422' : row.telco === 'REDONE' ? '#EF444422' : row.telco === 'Digi' ? '#FBBF2422' : row.telco === 'UMobile' ? '#F59E0B22' : 'var(--surface2)',
            color: row.telco === 'HOTLINK' ? '#EF4444' : row.telco === 'REDONE' ? '#DC2626' : row.telco === 'Digi' ? '#F59E0B' : row.telco === 'UMobile' ? '#F59E0B' : 'var(--muted)',
          }}>{row.telco}</span>
        ) : '—'}
      </td>
      <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{row.phone_slot || '—'}</td>
      <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 12 }}>
        {row.email ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{row.email}</span>
            <CopyBtn text={row.email} />
          </div>
        ) : '—'}
      </td>
      <td style={{ padding: '8px 10px', color: isExpired ? '#EF4444' : 'var(--muted)', fontSize: 12 }}>
        {fmtDate(row.valid_until)}{isExpired && <span style={{ marginLeft: 4, fontSize: 10, color: '#EF4444' }}>⚠️</span>}
      </td>
      <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 12 }}>{fmtDate(row.last_reload_date)}</td>
      <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 12, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '—'}</td>
      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {row.status === 'Active' && (
            <button onClick={() => onPromote(row)} title="Suspend & promote standby" style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #DC262644', background: '#DC262611', color: '#DC2626', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>🔄</button>
          )}
          <button onClick={() => onEdit(row)} style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer', fontSize: 11 }}>✏️</button>
          <button onClick={() => onDelete(row)} style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #DC262644', background: '#DC262611', color: '#DC2626', cursor: 'pointer', fontSize: 11 }}>🗑️</button>
        </div>
      </td>
    </tr>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────
function StatusSection({ status, rows, standbys, onEdit, onDelete, onPromote }) {
  const [open, setOpen] = useState(true)
  const m = STATUS_META[status] || { color: '#6B7280', bg: '#6B728011' }
  if (!rows.length) return null

  const cols = ['Codename', 'Number', 'Type', 'Telco', 'Phone Slot', 'Email', 'Valid Until', 'Last Reload', 'Notes', '']

  return (
    <div style={{ marginBottom: 20, borderRadius: 10, border: `1px solid ${m.color}33`, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: m.bg, border: 'none', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={status} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{rows.length} number{rows.length !== 1 ? 's' : ''}</span>
        </div>
        <span style={{ color: 'var(--muted)', fontSize: 12, transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform .2s' }}>▾</span>
      </button>

      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {cols.map(c => (
                  <th key={c} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', whiteSpace: 'nowrap' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <NumberRow key={r.id} row={r} standbys={standbys} onEdit={onEdit} onDelete={onDelete} onPromote={onPromote} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WANumbers() {
  const { profile } = useAuth()
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [hostFilter, setHostFilter] = useState('All')
  const [editModal, setEditModal]   = useState(null)   // null | row | 'new'
  const [deleteRow, setDeleteRow]   = useState(null)
  const [promoteRow, setPromoteRow] = useState(null)   // Active row being suspended

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('wa_numbers')
      .select('*')
      .order('host').order('codename')
    setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const hosts = [...new Set(rows.map(r => r.host))].sort()
  const visible = hostFilter === 'All' ? rows : rows.filter(r => r.host === hostFilter)

  // standbys for the same host as the promoted number
  const standbysFor = (host) => rows.filter(r => r.host === host && r.status === 'Standby')

  function handlePromote(row) {
    setPromoteRow(row)
  }

  const s = {
    page: { padding: '28px 20px', color: 'var(--text)', maxWidth: 1400, margin: '0 auto' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 },
    title: { fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 },
    addBtn: { padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 },
    filterBar: { display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' },
    chip: (active) => ({ padding: '5px 14px', borderRadius: 20, border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`, background: active ? 'var(--brand)' : 'var(--surface2)', color: active ? '#fff' : 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400 }),
  }

  const totalActive   = rows.filter(r => r.status === 'Active').length
  const totalStandby  = rows.filter(r => r.status === 'Standby').length
  const totalSuspended = rows.filter(r => r.status === 'Suspended').length

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>📱 WA Number Manager</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {totalActive} active &nbsp;·&nbsp; {totalStandby} standby &nbsp;·&nbsp; {totalSuspended} suspended
          </div>
        </div>
        <button style={s.addBtn} onClick={() => setEditModal({ ...EMPTY_FORM, host: profile?.full_name || '' })}>
          ＋ Add Number
        </button>
      </div>

      {/* Host filter */}
      <div style={s.filterBar}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Host:</span>
        {['All', ...hosts].map(h => (
          <button key={h} style={s.chip(hostFilter === h)} onClick={() => setHostFilter(h)}>{h}</button>
        ))}
      </div>

      {/* Sections */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📱</div>
          <div style={{ fontSize: 15 }}>No numbers yet. Click <strong>+ Add Number</strong> to start.</div>
        </div>
      ) : (
        STATUSES.map(status => (
          <StatusSection
            key={status}
            status={status}
            rows={visible.filter(r => r.status === status)}
            standbys={[]}
            onEdit={row => setEditModal(row)}
            onDelete={row => setDeleteRow(row)}
            onPromote={handlePromote}
          />
        ))
      )}

      {/* Add / Edit modal */}
      {editModal && (
        <NumberModal
          initial={editModal}
          hosts={hosts}
          onSave={() => { setEditModal(null); load() }}
          onClose={() => setEditModal(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteRow && (
        <ConfirmDelete
          row={deleteRow}
          onConfirm={() => { setDeleteRow(null); load() }}
          onClose={() => setDeleteRow(null)}
        />
      )}

      {/* Promote standby */}
      {promoteRow && (
        <PromoteModal
          suspended={promoteRow}
          standbys={standbysFor(promoteRow.host)}
          onDone={() => { setPromoteRow(null); load() }}
          onClose={() => setPromoteRow(null)}
        />
      )}
    </div>
  )
}
