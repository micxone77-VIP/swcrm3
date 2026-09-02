// src/pages/MyTasks.jsx — Real tasks backed by the tasks table
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { generateAutoTasks } from '../lib/taskEngine'
import {
  PageHeader, Card, KpiCard, Btn, Badge,
  Tabs, LoadingState, ErrorState, EmptyState, Modal,
  Input, Select, Textarea, useToast,
} from '../components/ui'
import { TierBadge } from '../components/ui'
import { useLanguage } from '../contexts/LanguageContext'

const TASK_TYPES = ['Follow Up', 'VIP Contact', 'Campaign', 'Upgrade', 'Birthday', 'Review', 'Other']
const PRIORITIES  = ['Urgent', 'High', 'Medium', 'Low']
const PRIORITY_COLOR = { Urgent: 'var(--danger)', High: '#f59e0b', Medium: 'var(--info)', Low: 'var(--muted)' }

const isOverdue = t => {
  if (!t.due_date) return false
  if (['Completed','Cancelled','Snoozed'].includes(t.status)) return false
  return new Date(t.due_date) < new Date()
}

const fmtDate = d => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' })
}

const sourceLabel = src => {
  const map = {
    manual: null,
    auto_birthday: '🎂 Auto',
    auto_churn_risk: '⚠️ Auto',
    auto_churn_snapshot: '📊 Auto',
    auto_upgrade: '⬆️ Auto',
    auto_campaign_deadline: '📢 Auto',
    auto_kpi_reminder: '🏆 Auto',
  }
  return map[src] || null
}

function TaskRow({ task, onStatusChange, onDelete, onOpen, t }) {
  const [saving, setSaving] = useState(false)

  async function setStatus(status) {
    setSaving(true)
    const update = { status, updated_at: new Date().toISOString() }
    if (status === 'Completed') update.completed_at = new Date().toISOString()
    await supabase.from('tasks').update(update).eq('id', task.id)
    setSaving(false)
    onStatusChange?.()
  }

  const overdue = isOverdue(task)
  const src = sourceLabel(task.source)

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      opacity: task.status === 'Completed' ? 0.55 : 1,
      transition: 'opacity .2s',
    }}>
      {/* Priority stripe */}
      <div style={{ width: 3, borderRadius: 2, alignSelf: 'stretch', flexShrink: 0,
        background: PRIORITY_COLOR[task.priority] || 'var(--border)' }} />

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: task.status === 'Completed' ? 'var(--muted)' : 'var(--text)',
            textDecoration: task.status === 'Completed' ? 'line-through' : 'none' }}>
            {task.title}
          </span>
          {src && <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--surface2)',
            padding: '1px 6px', borderRadius: 10, fontWeight: 600 }}>{src}</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
          {task.vip_username && (
            <span style={{ cursor: 'pointer', color: 'var(--brand)', textDecoration: 'underline' }}
              onClick={() => task.vip_id && onOpen?.(task.vip_id)}>
              {task.vip_username}
              {task.vip_tier && <span style={{ marginLeft: 4 }}>({task.vip_tier})</span>}
            </span>
          )}
          <span style={{ color: overdue ? 'var(--danger)' : 'var(--muted)', fontWeight: overdue ? 700 : 400 }}>
            {overdue ? '⏰ Overdue · ' : ''}{fmtDate(task.due_date)}
          </span>
          <span>{task.task_type}</span>
          {task.assigned_to && <span>→ {task.assigned_to}</span>}
          {task.notes && <span style={{ fontStyle: 'italic', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.notes}</span>}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
        {task.status !== 'Completed' && (
          <Btn size="sm" variant="ghost" disabled={saving} onClick={() => setStatus('Completed')}
            style={{ color: 'var(--success)', borderColor: 'var(--success)' }}>{t('myTasks.doneBtn')}</Btn>
        )}
        {task.status === 'Open' && (
          <Btn size="sm" variant="ghost" disabled={saving} onClick={() => setStatus('In Progress')}>{t('myTasks.startBtn')}</Btn>
        )}
        {task.status === 'Completed' && (
          <Btn size="sm" variant="ghost" disabled={saving} onClick={() => setStatus('Open')}>{t('myTasks.reopenBtn')}</Btn>
        )}
        <Btn size="sm" variant="ghost" disabled={saving} onClick={() => onDelete?.(task.id)}
          style={{ color: 'var(--muted)', fontSize: 16, padding: '2px 8px' }}>×</Btn>
      </div>
    </div>
  )
}

export default function MyTasks() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast, ToastContainer } = useToast()
  const { t } = useLanguage()

  const [tasks, setTasks]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [tab, setTab]                   = useState('open')
  const [showCreate, setShowCreate]     = useState(false)
  const [saving, setSaving]             = useState(false)
  const [syncing, setSyncing]           = useState(false)
  const [vipSearch, setVipSearch]       = useState('')
  const [vipResults, setVipResults]     = useState([])

  const emptyForm = { title:'', vip_id:'', vip_username:'', vip_tier:'', task_type:'Follow Up', priority:'High', due_date:'', notes:'' }
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('tasks')
        .select('*')
        .not('status', 'eq', 'Cancelled')
        .order('created_at', { ascending: false })
        .limit(500)
      if (err) throw err
      setTasks(data || [])
    } catch(e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // VIP search for create modal
  useEffect(() => {
    if (!vipSearch.trim()) { setVipResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('vip_members')
        .select('id,username,full_name,tier')
        .or(`username.ilike.%${vipSearch}%,full_name.ilike.%${vipSearch}%`)
        .limit(8)
      setVipResults(data || [])
    }, 300)
    return () => clearTimeout(t)
  }, [vipSearch])

  async function runAutoSync() {
    setSyncing(true)
    try {
      const result = await generateAutoTasks()
      const created = result.total
      toast(created > 0
        ? `Auto-sync complete — ${created} new task${created === 1 ? '' : 's'} generated`
        : 'Auto-sync complete — no new tasks to create', 'success')
      await load()
    } catch(e) {
      toast('Auto-sync failed: ' + e.message, 'error')
    }
    setSyncing(false)
  }

  async function createTask() {
    if (!form.title.trim()) { toast('Please enter a task title', 'error'); return }
    setSaving(true)
    const { error: err } = await supabase.from('tasks').insert({
      title: form.title.trim(),
      task_type: form.task_type,
      vip_id: form.vip_id || null,
      vip_username: form.vip_username || null,
      vip_tier: form.vip_tier || null,
      priority: form.priority,
      status: 'Open',
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      notes: form.notes.trim() || null,
      source: 'manual',
      assigned_to: profile?.full_name || null,
      created_by: profile?.full_name || null,
    })
    setSaving(false)
    if (err) { toast('Failed to create task: ' + err.message, 'error'); return }
    toast('Task created', 'success')
    setShowCreate(false)
    setForm(emptyForm)
    setVipSearch('')
    load()
  }

  async function deleteTask(id) {
    await supabase.from('tasks').update({ status: 'Cancelled' }).eq('id', id)
    load()
  }

  // Partition tasks
  const now = new Date()
  const overdueTasks = tasks.filter(isOverdue)
  const openTasks    = tasks.filter(t => ['Open','In Progress'].includes(t.status) && !isOverdue(t))
  const snoozed      = tasks.filter(t => t.status === 'Snoozed')
  const doneTasks    = tasks.filter(t => t.status === 'Completed').slice(0, 60)

  const tabMap = { overdue: overdueTasks, open: openTasks, snoozed, done: doneTasks }
  const displayTasks = tabMap[tab] || openTasks

  const tabs = [
    { key: 'overdue', label: t('myTasks.tabOverdue'),  count: overdueTasks.length },
    { key: 'open',    label: t('myTasks.tabOpen'),     count: openTasks.length },
    { key: 'snoozed', label: t('myTasks.tabSnoozed'),  count: snoozed.length },
    { key: 'done',    label: t('myTasks.tabDone'),     count: doneTasks.length },
  ]

  if (loading) return <div style={{ padding: 32 }}><LoadingState /></div>
  if (error) return <div style={{ padding: 32 }}><ErrorState message={error} onRetry={load} /></div>

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      <ToastContainer />
      <PageHeader
        title={t('myTasks.title')}
        subtitle={t('myTasks.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={runAutoSync} disabled={syncing}>
              {syncing ? t('myTasks.syncing') : t('myTasks.autoSync')}
            </Btn>
            <Btn variant="primary" onClick={() => setShowCreate(true)}>{t('myTasks.newTask')}</Btn>
          </div>
        }
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label={t('myTasks.kpiOverdue')}   value={overdueTasks.length} color="var(--danger)"  onClick={() => setTab('overdue')} />
        <KpiCard label={t('myTasks.kpiOpen')}      value={openTasks.length}    color="var(--info)"    onClick={() => setTab('open')} />
        <KpiCard label={t('myTasks.kpiSnoozed')}   value={snoozed.length}      color="var(--muted)"   onClick={() => setTab('snoozed')} />
        <KpiCard label={t('myTasks.kpiCompleted')} value={doneTasks.length}    color="var(--success)" onClick={() => setTab('done')} />
      </div>

      {/* Task list */}
      <Card>
        <div style={{ padding: '0 16px' }}>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div>
          {displayTasks.length === 0 ? (
            <div style={{ padding: 32 }}>
              <EmptyState
                icon={tab === 'done' ? '✅' : tab === 'overdue' ? '🎉' : '📋'}
                title={tab === 'done' ? t('myTasks.emptyDone') : tab === 'overdue' ? t('myTasks.emptyOverdue') : t('myTasks.emptyTasks')}
                message={tab === 'open' ? t('myTasks.emptyOpenHint') : ''}
              />
            </div>
          ) : (
            displayTasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                onStatusChange={load}
                onDelete={deleteTask}
                onOpen={id => navigate(`/vips/${id}`)}
                t={t}
              />
            ))
          )}
        </div>
      </Card>

      {/* Create Task Modal */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setForm(emptyForm); setVipSearch('') }} title={t('myTasks.modalTitle')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t('myTasks.titleLabel')}</label>
            <Input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} placeholder="What needs to be done?" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t('myTasks.vipLabel')}</label>
            <Input value={vipSearch} onChange={e => setVipSearch(e.target.value)} placeholder={t('myTasks.searchVip')} />
            {vipResults.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 4, background: 'var(--surface2)', maxHeight: 180, overflowY: 'auto' }}>
                {vipResults.map(v => (
                  <div key={v.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                      setForm(f => ({...f, vip_id: v.id, vip_username: v.username, vip_tier: v.tier}))
                      setVipSearch(v.username)
                      setVipResults([])
                    }}>
                    <span style={{ fontWeight: 600 }}>{v.username}</span>
                    {v.full_name && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{v.full_name}</span>}
                    <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>· {v.tier}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t('myTasks.typeLabel')}</label>
              <Select value={form.task_type} onChange={e => setForm(f => ({...f, task_type: e.target.value}))} style={{ width: '100%' }}>
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t('myTasks.priorityLabel')}</label>
              <Select value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))} style={{ width: '100%' }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t('myTasks.dueDateLabel')}</label>
            <Input type="datetime-local" value={form.due_date} onChange={e => setForm(f => ({...f, due_date: e.target.value}))} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t('myTasks.notesLabel')}</label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} placeholder={t('myTasks.notesPlaceholder')} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => { setShowCreate(false); setForm(emptyForm); setVipSearch('') }}>{t('common.cancel')}</Btn>
            <Btn variant="primary" onClick={createTask} disabled={saving}>{saving ? t('myTasks.creating') : t('myTasks.createTask')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
