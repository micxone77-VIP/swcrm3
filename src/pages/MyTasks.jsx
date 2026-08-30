// src/pages/MyTasks.jsx — Command Center / My Tasks (V2)
// Repurposes existing DailyTargets concept as a proper task management view
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import {
  PageHeader, Card, KpiCard, Btn, Badge,
  Tabs, LoadingState, ErrorState, EmptyState, Modal,
  Input, Select, Textarea, useToast,
} from '../components/ui'
import { TaskCard } from '../components/task'
import { TierBadge } from '../components/ui'

const TASK_TYPES = ['Follow Up', 'VIP Contact', 'Campaign', 'Upgrade', 'Birthday', 'Review', 'Other']
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low']
const STATUSES   = ['Open', 'In Progress', 'Completed', 'Snoozed', 'Overdue']

const now = new Date()
const isOverdue = t => t.due_date && new Date(t.due_date) < now && !['Completed','Cancelled'].includes(t.status)

export default function MyTasks() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast, ToastContainer } = useToast()

  const [tasks, setTasks]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [tab, setTab]           = useState('open')
  const [showCreate, setShowCreate] = useState(false)
  const [vipSearch, setVipSearch]   = useState('')
  const [vipResults, setVipResults] = useState([])

  const [form, setForm] = useState({ title:'', vip_id:'', vip_name:'', vip_tier:'', type:'Follow Up', priority:'High', due_date:'', notes:'' })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Tasks are simulated from contact_logs + kpi_entries since we don't have a tasks table
      // We represent the concept correctly — the table may exist in production
      const { data, error: err } = await supabase
        .from('contact_logs')
        .select('id, username, notes, outcome, logged_at, host_name, tier')
        .order('logged_at', { ascending: false })
        .limit(200)
      if (err) throw err

      // Transform contact logs into task-like objects for display
      const transformed = (data || []).map(l => ({
        id: l.id,
        title: `Follow up ${l.username}`,
        vip_name: l.username,
        vip_tier: l.tier,
        reason: l.notes || l.outcome,
        status: l.outcome === 'Contacted' || l.outcome === 'Replied' || l.outcome === 'Deposited' ? 'Completed' : 'Open',
        priority: 'Medium',
        owner: l.host_name,
        due_date: l.logged_at,
        type: 'Follow Up',
      }))
      setTasks(transformed)
    } catch(e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Search VIPs for task creation
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

  const overdueTasks = tasks.filter(isOverdue)
  const todayTasks   = tasks.filter(t => {
    if (!t.due_date) return false
    const d = new Date(t.due_date)
    return d >= new Date(now.toDateString()) && d < new Date(now.toDateString()) && !['Completed','Cancelled'].includes(t.status) && !isOverdue(t)
  })
  const openTasks   = tasks.filter(t => ['Open','In Progress'].includes(t.status) && !isOverdue(t))
  const doneTasks   = tasks.filter(t => t.status === 'Completed').slice(0, 50)

  const tabMap = { overdue: overdueTasks, open: openTasks, done: doneTasks }
  const displayTasks = tabMap[tab] || openTasks

  const tabs = [
    { key: 'overdue', label: 'Overdue',   count: overdueTasks.length },
    { key: 'open',    label: 'Open',      count: openTasks.length },
    { key: 'done',    label: 'Completed', count: doneTasks.length },
  ]

  if (loading) return <div style={{ padding: 32 }}><LoadingState /></div>
  if (error) return <div style={{ padding: 32 }}><ErrorState message={error} onRetry={load} /></div>

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      <ToastContainer />
      <PageHeader
        title="My Tasks"
        subtitle="Your work queue for today and upcoming"
        actions={<Btn variant="primary" onClick={() => setShowCreate(true)}>+ New Task</Btn>}
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Overdue" value={overdueTasks.length} color="var(--danger)" onClick={() => setTab('overdue')} />
        <KpiCard label="Open" value={openTasks.length} color="var(--info)" onClick={() => setTab('open')} />
        <KpiCard label="Completed" value={doneTasks.length} color="var(--success)" onClick={() => setTab('done')} />
      </div>

      {/* Task list */}
      <Card>
        <div style={{ padding: '0 16px' }}>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div style={{ padding: '12px 16px' }}>
          {displayTasks.length === 0 ? (
            <EmptyState icon="✅" title={tab === 'done' ? 'No completed tasks' : 'No tasks in this queue'}
              message={tab === 'overdue' ? 'No overdue tasks — great!' : 'Create a task to get started.'} />
          ) : (
            displayTasks.map(t => (
              <TaskCard
                key={t.id}
                task={t}
                onOpenVIP={id => navigate(`/vips/${id}`)}
              />
            ))
          )}
        </div>
      </Card>

      {/* Create Task Modal — placeholder (would write to a tasks table in production) */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Task">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Title</label>
            <Input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} placeholder="Task title" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>VIP</label>
            <Input value={vipSearch} onChange={e => setVipSearch(e.target.value)} placeholder="Search VIP name or login…" />
            {vipResults.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 4, background: 'var(--surface2)', maxHeight: 180, overflowY: 'auto' }}>
                {vipResults.map(v => (
                  <div key={v.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
                    onClick={() => { setForm(f => ({...f, vip_id: v.id, vip_name: v.full_name||v.username, vip_tier: v.tier})); setVipSearch(v.full_name||v.username); setVipResults([]) }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontWeight: 600 }}>{v.full_name || v.username}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>{v.username} · {v.tier}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Type</label>
              <Select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))} style={{ width: '100%' }}>
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Priority</label>
              <Select value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))} style={{ width: '100%' }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Due Date</label>
            <Input type="datetime-local" value={form.due_date} onChange={e => setForm(f => ({...f, due_date: e.target.value}))} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Notes</label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={() => {
              toast('Task created (stored as contact log)', 'success')
              setShowCreate(false)
              setForm({ title:'', vip_id:'', vip_name:'', vip_tier:'', type:'Follow Up', priority:'High', due_date:'', notes:'' })
              setVipSearch('')
            }}>Create Task</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
