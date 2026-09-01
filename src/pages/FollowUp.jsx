// src/pages/FollowUp.jsx — VIP Operations / Follow Up (V2)
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  PageHeader, Card, KpiCard, Btn, FilterPills,
  LoadingState, ErrorState, EmptyState, Modal,
  Select, Textarea, useToast,
} from '../components/ui'
import { TierBadge, RiskBadge } from '../components/ui'

function daysAgoLabel(d) {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d)) / 86400000)
  if (days === 0) return 'Today'; if (days === 1) return 'Yesterday'
  return days + 'd ago'
}

const OUTCOMES = ['Contacted', 'No Reply', 'Replied', 'Deposited', 'Reactivated']

export default function FollowUp() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedVipId = searchParams.get('vip') || ''
  const { profile } = useAuth()
  const { toast, ToastContainer } = useToast()

  const [vips, setVips] = useState([])
  const [todayLogs, setTodayLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [urgency, setUrgency] = useState('All')

  const [logTarget, setLogTarget] = useState(null)
  const [logOutcome, setLogOutcome] = useState('Contacted')
  const [logNote, setLogNote] = useState('')
  const [logSaving, setLogSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const [vipRes, logRes] = await Promise.all([
      supabase.from('vip_members')
        .select('id,username,full_name,tier,churn_risk,host_assigned,last_contacted,last_contact_date,total_deposit,currency,days_inactive,last_deposit_date,activity_status,is_excluded')
        .neq('is_excluded', true),
      supabase.from('contact_logs')
        .select('username')
        .gte('created_at', todayStr + 'T00:00:00')
        .lte('created_at', todayStr + 'T23:59:59'),
    ])
    if (vipRes.error || logRes.error) {
      setLoadError(vipRes.error?.message || logRes.error?.message || 'Unable to load follow-up data')
      setVips([])
      setTodayLogs([])
      setLoading(false)
      return
    }
    setVips(vipRes.data || [])
    setTodayLogs(logRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const now = new Date()
  const contactedSet = new Set(todayLogs.map(l => l.username))

  const queue = useMemo(() => vips.filter(v => {
    if (contactedSet.has(v.username)) return false
    const lastC = v.last_contacted || v.last_contact_date
    if (!lastC) return true
    const days = Math.floor((now - new Date(lastC)) / 86400000)
    return days >= 3
  }), [vips, todayLogs])

  const getDays = v => {
    const lastC = v.last_contacted || v.last_contact_date
    if (!lastC) return 999
    return Math.floor((now - new Date(lastC)) / 86400000)
  }

  const urgent = queue.filter(v => getDays(v) >= 7 || ['HIGH','CRITICAL'].includes((v.churn_risk||'').toUpperCase()))
  const moderate = queue.filter(v => getDays(v) >= 3 && getDays(v) < 7 && !['HIGH','CRITICAL'].includes((v.churn_risk||'').toUpperCase()))

  const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }
  const sortQueue = arr => [...arr].sort((a,b) =>
    (TIER_ORDER[(a.tier||'').toUpperCase()]??9) - (TIER_ORDER[(b.tier||'').toUpperCase()]??9) ||
    getDays(b) - getDays(a)
  )

  const displayMap = { All: sortQueue(queue), Urgent: sortQueue(urgent), Moderate: sortQueue(moderate) }
  const display = displayMap[urgency] || sortQueue(queue)
  const requestedVip = requestedVipId ? vips.find(v => String(v.id) === String(requestedVipId)) : null
  const requestedInQueue = requestedVip ? queue.some(v => String(v.id) === String(requestedVip.id)) : false
  const focusedDisplay = requestedInQueue && requestedVip
    ? [requestedVip, ...display.filter(v => String(v.id) !== String(requestedVip.id))]
    : display

  async function submitLog() {
    if (!logTarget || logSaving) return
    setLogSaving(true)
    const nowIso = new Date().toISOString()
    const { error: contactError } = await supabase.from('contact_logs').insert({
      username: logTarget.username, vip_id: logTarget.id,
      outcome: logOutcome, notes: logNote || null,
      host_name: profile?.full_name || null,
      logged_at: nowIso, created_at: nowIso,
    })
    if (contactError) {
      setLogSaving(false)
      toast(`Save failed: ${contactError.message}`, 'error')
      return
    }
    const { error: vipError } = await supabase.from('vip_members')
      .update({ last_contact_date: nowIso })
      .eq('id', logTarget.id)
    if (vipError) {
      setLogSaving(false)
      toast(`Contact saved, but VIP update failed: ${vipError.message}`, 'error')
      await load()
      return
    }
    setLogSaving(false)
    toast(`Logged: ${logTarget.username} — ${logOutcome}`, 'success')
    setLogTarget(null); setLogNote(''); setLogOutcome('Contacted')
    await load()
  }

  if (loading) return <div style={{ padding: 32 }}><LoadingState /></div>
  if (loadError) return <div style={{ padding: 32 }}><ErrorState message={loadError} onRetry={load} /></div>

  return (
    <div style={{ padding: '24px 28px' }}>
      <ToastContainer />
      <PageHeader title="Follow Up" subtitle="VIPs requiring outreach today" />
      {requestedVipId && !requestedVip && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ padding: 16, fontSize: 13, color: 'var(--warning)' }}>
            VIP <strong>{requestedVipId}</strong> could not be found in the current VIP records.
          </div>
        </Card>
      )}
      {requestedVip && !requestedInQueue && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ padding: 16, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
            <div style={{ fontSize: 13 }}><strong>{requestedVip.full_name || requestedVip.username}</strong> is not currently due in the Follow Up queue.</div>
            <Btn size="sm" variant="ghost" onClick={() => navigate(`/vips/${requestedVip.id}`)}>Open VIP</Btn>
          </div>
        </Card>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Needs Follow Up" value={queue.length} color="var(--info)" />
        <KpiCard label="Urgent (7d+ or High Risk)" value={urgent.length} color="var(--danger)" onClick={() => setUrgency('Urgent')} />
        <KpiCard label="Contacted Today" value={contactedSet.size} color="var(--success)" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <FilterPills options={[
          { value: 'All', label: `All (${queue.length})` },
          { value: 'Urgent', label: `Urgent (${urgent.length})` },
          { value: 'Moderate', label: `Moderate (${moderate.length})` },
        ]} active={urgency} onChange={setUrgency} />
      </div>
      <Card>
        {focusedDisplay.length === 0 ? <EmptyState icon="✅" title="All followed up" message="No VIPs need follow-up right now." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['VIP', 'Tier', 'Last Contact', 'Days Since', 'Risk', 'Host', 'Action'].map(h => <th key={h} style={{ padding:'9px 14px', textAlign:'left', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>{focusedDisplay.map(v => {
                const days = getDays(v)
                const isUrgent = days >= 7 || ['HIGH','CRITICAL'].includes((v.churn_risk||'').toUpperCase())
                const isFocused = requestedVip && String(v.id) === String(requestedVip.id)
                return <tr key={v.id}
                  ref={el => { if (isFocused && el && !el.dataset.focused) { el.dataset.focused='true'; requestAnimationFrame(()=>el.scrollIntoView({block:'center', behavior:'smooth'})) } }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  style={{ cursor:'pointer', transition:'background .1s', outline: isFocused ? '2px solid var(--accent)' : 'none', outlineOffset:'-2px' }}
                  onClick={() => navigate(`/vips/${v.id}`)}>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}><div style={{ fontWeight:600, color: isUrgent ? 'var(--danger)' : 'var(--text)' }}>{v.full_name || v.username}</div><div style={{ fontSize:11, color:'var(--muted)' }}>{v.username}</div></td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}><TierBadge tier={v.tier} /></td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12 }}>{daysAgoLabel(v.last_contacted || v.last_contact_date)}</td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}><span style={{ fontWeight:600, color: days >= 7 ? 'var(--danger)' : days >= 3 ? 'var(--warning)' : 'var(--muted)', fontSize:13 }}>{days >= 999 ? 'Never' : `${days}d`}</span></td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}><RiskBadge risk={v.churn_risk} /></td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', color:'var(--muted)' }}>{v.host_assigned || '—'}</td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}><div style={{ display:'flex', gap:6 }}><Btn size="sm" variant="primary" onClick={e => { e.stopPropagation(); setLogTarget(v) }}>Log Contact</Btn><Btn size="sm" variant="ghost" onClick={e => { e.stopPropagation(); navigate(`/vips/${v.id}`) }}>Open</Btn></div></td>
                </tr>
              })}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={!!logTarget} onClose={() => { if (!logSaving) { setLogTarget(null); setLogNote('') } }} title="Log Contact" width={420}>
        {logTarget && <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{logTarget.full_name || logTarget.username}</div>
          <div><label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Outcome</label><Select value={logOutcome} onChange={e => setLogOutcome(e.target.value)} style={{ width:'100%' }}>{OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}</Select></div>
          <div><label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Notes (optional)</label><Textarea value={logNote} onChange={e => setLogNote(e.target.value)} rows={3} placeholder="What happened?" /></div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}><Btn variant="ghost" onClick={() => { if (!logSaving) { setLogTarget(null); setLogNote('') } }}>Cancel</Btn><Btn variant="primary" onClick={submitLog} disabled={logSaving}>{logSaving ? 'Saving…' : 'Save Log'}</Btn></div>
        </div>}
      </Modal>
    </div>
  )
}
