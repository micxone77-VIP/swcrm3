// src/pages/Today.jsx — Command Center / Today (V2)
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDashboard } from '../hooks/useDashboard'
import { supabase } from '../lib/supabase'
import {
  KpiCard, Btn, Card, CardHeader, CardBody,
  LoadingState, ErrorState, FilterPills, Badge, Modal,
  Select, Textarea, useToast,
} from '../components/ui'
import { TierBadge, RiskBadge } from '../components/ui'
import { formatMoney } from '../lib/format'
import VipQuickSearch from '../components/VipQuickSearch'

const HOSTS = ['All', 'Marcus', 'Angel']
const OUTCOMES = ['Contacted', 'No Reply', 'Replied', 'Deposited', 'Reactivated']
const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }

function timeAgo(d) {
  if (!d) return '—'
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return `${diff}d ago`
}

export default function Today() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast, ToastContainer } = useToast()
  const [host, setHost] = useState('All')
  const [activeQueue, setActiveQueue] = useState('all')

  const {
    loading, error, refresh,
    contactedToday, needContact,
    priorityQueue, overdue, followUp, atRisk, birthdays,
    contactedTodaySet, hostVips, getDays,
  } = useDashboard({ host })

  // Quick-log modal
  const [logTarget, setLogTarget] = useState(null)
  const [logOutcome, setLogOutcome] = useState('Replied')
  const [logNote, setLogNote] = useState('')
  const [logSaving, setLogSaving] = useState(false)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateStr = now.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' })

  async function submitLog() {
    if (!logTarget || logSaving) return
    setLogSaving(true)
    const { error: err } = await supabase.from('contact_logs').insert({
      username: logTarget.username,
      vip_id: logTarget.id,
      outcome: logOutcome,
      notes: logNote || null,
      host_name: profile?.full_name || null,
      logged_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
    setLogSaving(false)
    if (err) { toast('Failed to log contact: ' + err.message, 'error'); return }
    toast(`Logged: ${logTarget.username} — ${logOutcome}`, 'success')
    setLogTarget(null); setLogNote(''); setLogOutcome('Replied')
    refresh()
  }

  // Queue data
  const queueMap = {
    all: priorityQueue,
    overdue: overdue,
    follow: followUp,
    risk: atRisk,
    birthday: birthdays,
  }
  const displayItems = (queueMap[activeQueue] || priorityQueue).slice(0, 30)

  if (loading) return <div style={{ padding: 32 }}><LoadingState message="Loading today's work…" /></div>
  if (error) return <div style={{ padding: 32 }}><ErrorState message={error} onRetry={refresh} /></div>

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      <ToastContainer />

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
              {greeting}, {profile?.full_name?.split(' ')[0] || 'there'}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              {dateStr} · Here's what needs your attention today.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <VipQuickSearch />
            <Btn variant="primary" onClick={refresh} size="sm">↺ Refresh</Btn>
          </div>
        </div>

        {/* Host filter */}
        <div style={{ marginTop: 16 }}>
          <FilterPills
            options={HOSTS.map(h => ({ value: h, label: h === 'All' ? 'All Hosts' : h }))}
            active={host}
            onChange={setHost}
          />
        </div>
      </div>

      {/* ── KPI Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard
          label="VIP Follow-ups"
          value={followUp.length}
          color="var(--info)"
          onClick={() => setActiveQueue('follow')}
          sub="Need contact today"
        />
        <KpiCard
          label="Overdue"
          value={overdue.length}
          color="var(--danger)"
          onClick={() => setActiveQueue('overdue')}
          sub="High risk, no contact 3d+"
        />
        <KpiCard
          label="At Risk"
          value={atRisk.length}
          color="var(--warning)"
          onClick={() => setActiveQueue('risk')}
          sub="High or critical churn risk"
        />
        <KpiCard
          label="Birthdays Today"
          value={birthdays.length}
          color="#EC4899"
          onClick={() => setActiveQueue('birthday')}
          sub="VIPs with birthday today"
        />
      </div>

      {/* ── Progress bar ── */}
      <Card style={{ marginBottom: 24, padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Contacted Today
            <span style={{ marginLeft: 12, fontSize: 22, fontWeight: 700, color: 'var(--success)' }}>{contactedToday}</span>
            <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--muted)' }}>/ {contactedToday + needContact} VIPs</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {contactedToday + needContact > 0 ? Math.round(contactedToday / (contactedToday + needContact) * 100) : 0}% done
          </div>
        </div>
        <div style={{ background: 'var(--surface2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, var(--success), #16a34a)',
            width: `${contactedToday + needContact > 0 ? Math.min(100, Math.round(contactedToday / (contactedToday + needContact) * 100)) : 0}%`,
            transition: 'width .4s',
          }} />
        </div>
      </Card>

      {/* ── Priority Queue ── */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span>⚡ Priority Today</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { value: 'all', label: 'All Priority' },
                { value: 'overdue', label: `Overdue (${overdue.length})` },
                { value: 'follow', label: `Follow Up (${followUp.length})` },
                { value: 'risk', label: `At Risk (${atRisk.length})` },
                { value: 'birthday', label: `Birthdays (${birthdays.length})` },
              ].map(q => (
                <button key={q.value} onClick={() => setActiveQueue(q.value)} style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${activeQueue === q.value ? 'var(--brand)' : 'var(--border)'}`,
                  background: activeQueue === q.value ? 'var(--brand-dim)' : 'transparent',
                  color: activeQueue === q.value ? 'var(--brand)' : 'var(--muted)',
                  cursor: 'pointer', textTransform: 'none',
                }}>{q.label}</button>
              ))}
            </div>
          </div>
        </CardHeader>

        {displayItems.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>All clear</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>No items in this queue right now.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['VIP', 'Tier', 'Trigger / Reason', 'Last Contact', 'Last Deposit', 'Risk', 'Action'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', letterSpacing: '.3px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayItems.map((v, i) => {
                  const isContacted = contactedTodaySet.has(v.username)
                  const isBirthday = birthdays.some(b => b.id === v.id)
                  return (
                    <tr key={v.id}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      style={{ transition: 'background .1s', opacity: isContacted ? .6 : 1 }}
                    >
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}
                          onClick={() => navigate(`/vips/${v.id}`)}>{v.full_name || v.username}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{v.username}</div>
                        {isBirthday && <span style={{ fontSize: 10, color: '#EC4899' }}>🎂 Birthday!</span>}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <TierBadge tier={v.tier} />
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: v._color || 'var(--text)',
                          background: (v._color || '#888') + '18',
                          padding: '3px 9px', borderRadius: 6,
                        }}>{v._reason || '—'}</span>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 12 }}>
                        {timeAgo(v.last_contacted || v.last_contact_date)}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        <div style={{ color: 'var(--text)' }}>{formatMoney(v.total_deposit, v.currency)}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{timeAgo(v.last_deposit_date)}</div>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <RiskBadge risk={v.churn_risk} />
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn size="sm" variant={isContacted ? 'ghost' : 'primary'}
                            onClick={() => setLogTarget(v)}>
                            {isContacted ? '✓ Logged' : 'Log Contact'}
                          </Btn>
                          <Btn size="sm" variant="ghost" onClick={() => navigate(`/vips/${v.id}`)}>Open</Btn>
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

      {/* ── Quick Log Modal ── */}
      <Modal open={!!logTarget} onClose={() => { setLogTarget(null); setLogNote('') }} title="Log Contact" width={420}>
        {logTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{logTarget.full_name || logTarget.username}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Outcome</label>
              <Select value={logOutcome} onChange={e => setLogOutcome(e.target.value)}>
                {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
              </Select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Notes (optional)</label>
              <Textarea value={logNote} onChange={e => setLogNote(e.target.value)} placeholder="What happened?" rows={3} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => { setLogTarget(null); setLogNote('') }}>Cancel</Btn>
              <Btn variant="primary" onClick={submitLog} disabled={logSaving}>
                {logSaving ? 'Saving…' : 'Save Log'}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
