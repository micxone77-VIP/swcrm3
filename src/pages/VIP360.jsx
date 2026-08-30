// src/pages/VIP360.jsx — VIP 360 (V2) — replaces VIPDetail.jsx
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatMoney, fmtDate } from '../lib/format'
import { TIER_CONFIG, STATUS_CONFIG, RISK_CONFIG, CONTACT_TYPE, CONTACT_OUTCOME } from '../lib/enums'
import {
  Card, CardHeader, CardBody, Tabs, Btn, Badge,
  LoadingState, ErrorState, EmptyState, Modal,
  Input, Select, Textarea, useToast,
} from '../components/ui'
import { TierBadge, StatusBadge, RiskBadge } from '../components/ui'
import { callAI } from '../lib/aiApi'

const TIERS = ['BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','BLACK']
const PERIODS = [
  { value: '30',  label: '30D' },
  { value: 'mtd', label: 'MTD' },
  { value: '90',  label: '90D' },
  { value: '180', label: '6M' },
  { value: '365', label: '1Y' },
]

function timeAgo(d) {
  if (!d) return '—'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff/60) + 'm ago'
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago'
  if (diff < 86400*30) return Math.floor(diff/86400) + 'd ago'
  return fmtDate(d)
}

function SectionLabel({ children }) {
  return <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:12 }}>{children}</div>
}
function Field({ label, children }) {
  return (
    <div style={{ borderBottom:'1px solid var(--border)', padding:'7px 0', display:'flex', flexDirection:'column', gap:3 }}>
      <div style={{ fontSize:11, color:'var(--muted)' }}>{label}</div>
      <div style={{ fontSize:13, fontWeight:500 }}>{children || '—'}</div>
    </div>
  )
}

export default function VIP360() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast, ToastContainer } = useToast()

  const [vip, setVip]             = useState(null)
  const [monthly, setMonthly]     = useState([])
  const [daily, setDaily]         = useState([])
  const [contacts, setContacts]   = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [tierLogs, setTierLogs]   = useState([])
  const [hosts, setHosts]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [tab, setTab]             = useState('overview')
  const [period, setPeriod]       = useState('30')
  const [aiInsight, setAiInsight] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  // Contact log modal
  const [showLog, setShowLog]   = useState(false)
  const [logType, setLogType]   = useState('WhatsApp')
  const [logOutcome, setLogOutcome] = useState('Contacted')
  const [logNote, setLogNote]   = useState('')
  const [logSaving, setLogSaving] = useState(false)

  // Edit modal
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const now = new Date()
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      const [vipRes, montRes, dailyRes, contRes, campRes, tierRes, hostRes] = await Promise.all([
        supabase.from('vip_members').select('*').eq('id', id).single(),
        supabase.from('vip_monthly_totals')
          .select('snapshot_month,total_deposit,total_withdrawal,monthly_valid_bet,win_loss,total_rebate,bonus_amount')
          .eq('vip_id', id)
          .order('snapshot_month', { ascending: false })
          .limit(24),
        supabase.from('vip_daily_snapshots')
          .select('snapshot_date,total_deposit,total_withdrawal,monthly_valid_bet,win_loss')
          .eq('vip_id', id)
          .order('snapshot_date', { ascending: false })
          .limit(90),
        supabase.from('contact_logs')
          .select('*')
          .eq('vip_id', id)
          .order('logged_at', { ascending: false })
          .limit(100),
        supabase.from('campaign_players')
          .select('*, campaigns(campaign_name,start_date,end_date,status)')
          .eq('vip_id', id)
          .order('added_at', { ascending: false }),
        supabase.from('tier_change_logs')
          .select('*')
          .eq('vip_id', id)
          .order('changed_at', { ascending: false }),
        supabase.from('profiles').select('full_name').in('role',['admin','host']).order('full_name'),
      ])
      if (vipRes.error) throw vipRes.error
      setVip(vipRes.data)
      setEditForm({ host_assigned: vipRes.data.host_assigned||'', tier: vipRes.data.tier||'', activity_status: vipRes.data.activity_status||'', phone: vipRes.data.phone||'', whatsapp: vipRes.data.whatsapp||'', churn_risk: vipRes.data.churn_risk||'', notes: vipRes.data.notes||'' })
      setMonthly(montRes.data || [])
      setDaily(dailyRes.data || [])
      setContacts(contRes.data || [])
      setCampaigns(campRes.data || [])
      setTierLogs(tierRes.data || [])
      setHosts((hostRes.data||[]).map(h => h.full_name).filter(Boolean))
    } catch(e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // Period-filtered monthly data
  const now = new Date()
  const cutoff = new Date()
  if (period === 'mtd') cutoff.setDate(1)
  else cutoff.setDate(now.getDate() - parseInt(period))

  const periodMonthly = monthly.filter(m => {
    if (period === 'mtd') return m.snapshot_month === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    const [y,mo] = m.snapshot_month.split('-').map(Number)
    const mDate = new Date(y, mo-1, 1)
    return mDate >= cutoff
  })
  const sumDeposit    = periodMonthly.reduce((s,m) => s + (parseFloat(m.total_deposit)||0), 0)
  const sumWithdrawal = periodMonthly.reduce((s,m) => s + (parseFloat(m.total_withdrawal)||0), 0)
  const sumTurnover   = periodMonthly.reduce((s,m) => s + (parseFloat(m.monthly_valid_bet)||0), 0)
  const sumWL         = periodMonthly.reduce((s,m) => s + (parseFloat(m.win_loss)||0), 0)

  const daysInactive = vip?.last_deposit_date
    ? Math.floor((now - new Date(vip.last_deposit_date)) / 86400000)
    : (vip?.days_inactive ?? null)

  async function submitLog() {
    if (logSaving) return
    setLogSaving(true)
    const nowStr = new Date().toISOString()
    const { error: err } = await supabase.from('contact_logs').insert({
      vip_id: id, username: vip.username,
      contact_type: logType, outcome: logOutcome,
      notes: logNote || null, host_name: profile?.full_name || null,
      logged_at: nowStr, created_at: nowStr,
    })
    await supabase.from('vip_members').update({ last_contact_date: nowStr }).eq('id', id)
    setLogSaving(false)
    if (err) { toast('Error: ' + err.message, 'error'); return }
    toast('Contact logged ✓', 'success')
    setShowLog(false); setLogNote('')
    load()
  }

  async function saveEdit() {
    setEditSaving(true)
    const { error: err } = await supabase.from('vip_members').update(editForm).eq('id', id)
    setEditSaving(false)
    if (err) { toast('Error: ' + err.message, 'error'); return }
    toast('Saved ✓', 'success')
    setShowEdit(false)
    load()
  }

  async function getAIInsight() {
    setAiLoading(true)
    try {
      const summary = `VIP: ${vip.full_name||vip.username}, Tier: ${vip.tier}, Risk: ${vip.churn_risk}, Days inactive: ${daysInactive}, Total deposit: ${formatMoney(vip.total_deposit, vip.currency)}. Last 3 months deposits: ${periodMonthly.slice(0,3).map(m=>formatMoney(m.total_deposit,vip.currency)).join(', ')}.`
      const result = await callAI(`Analyze this VIP player and provide a brief insight with recommended action: ${summary}`)
      setAiInsight(result)
    } catch(e) { toast('AI unavailable', 'error') }
    setAiLoading(false)
  }

  const TABS = [
    { key: 'overview',  label: 'Overview' },
    { key: 'financial', label: 'Financial' },
    { key: 'activity',  label: 'Activity' },
    { key: 'campaigns', label: 'Campaigns', count: campaigns.length },
    { key: 'contact',   label: 'Contact',   count: contacts.length },
    { key: 'notes',     label: 'Notes' },
    { key: 'insights',  label: 'Insights' },
  ]

  if (loading) return <div style={{ padding: 32 }}><LoadingState message="Loading VIP 360…" /></div>
  if (error || !vip) return <div style={{ padding: 32 }}><ErrorState message={error || 'VIP not found'} onRetry={load} /></div>

  const tierCfg   = TIER_CONFIG[(vip.tier||'').toUpperCase()] || TIER_CONFIG.SILVER
  const statusCfg = STATUS_CONFIG[vip.activity_status] || { color:'var(--muted)', bg:'var(--surface2)' }

  return (
    <div style={{ padding: '24px 28px' }}>
      <ToastContainer />

      {/* ── Back ── */}
      <button onClick={() => navigate(-1)} style={{
        background:'none', border:'none', color:'var(--muted)', fontSize:13,
        cursor:'pointer', display:'flex', alignItems:'center', gap:6, marginBottom:20, padding:0,
      }}>← Back to VIP Operations</button>

      {/* ── Identity Header ── */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'20px 24px', marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
          <div style={{ display:'flex', gap:16, alignItems:'center' }}>
            <div style={{
              width:52, height:52, borderRadius:'50%',
              background: tierCfg.bg, border:`2px solid ${tierCfg.color}`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:22, fontWeight:700, color:tierCfg.color, flexShrink:0,
            }}>
              {(vip.full_name||vip.username||'?')[0].toUpperCase()}
            </div>
            <div>
              <h2 style={{ fontSize:22, fontWeight:700, margin:0 }}>{vip.full_name || vip.username}</h2>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6, flexWrap:'wrap' }}>
                <span style={{ fontSize:12, color:'var(--muted)' }}>{vip.username}</span>
                <TierBadge tier={vip.tier} />
                <StatusBadge status={vip.activity_status} />
                <RiskBadge risk={vip.churn_risk} />
              </div>
              <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>
                {vip.region && <span>{vip.region}</span>}
                {vip.host_assigned && <span> · Host: {vip.host_assigned}</span>}
                {vip.currency && <span> · {vip.currency}</span>}
              </div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn variant="primary" onClick={() => setShowLog(true)}>+ Log Contact</Btn>
            {profile?.role !== 'readonly' && (
              <Btn variant="secondary" onClick={() => setShowEdit(true)}>Edit VIP</Btn>
            )}
          </div>
        </div>

        {/* ── Financial Summary ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginTop:20 }}>
          {[
            { label:'Deposit', value:formatMoney(sumDeposit, vip.currency), trend:null },
            { label:'Turnover', value:formatMoney(sumTurnover, vip.currency), trend:null },
            { label:'Win/Loss', value:formatMoney(Math.abs(sumWL), vip.currency), isWL:true, wl:sumWL },
            { label:'Last Deposit', value:daysInactive != null ? `${daysInactive}d ago` : '—', sub:vip.last_deposit_date ? fmtDate(vip.last_deposit_date) : null },
          ].map((m,i) => (
            <div key={i} style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 14px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ fontSize:11, color:'var(--muted)', fontWeight:600, letterSpacing:'.3px', textTransform:'uppercase' }}>{m.label}</span>
                {/* Period selector on first card only */}
                {i === 0 && (
                  <div style={{ display:'flex', gap:3 }}>
                    {PERIODS.map(p => (
                      <button key={p.value} onClick={() => setPeriod(p.value)} style={{
                        fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, border:'none',
                        background: period===p.value ? 'var(--brand)' : 'var(--surface)',
                        color: period===p.value ? '#fff' : 'var(--muted)', cursor:'pointer',
                      }}>{p.label}</button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{
                fontSize:18, fontWeight:700,
                color: m.isWL ? (m.wl <= 0 ? 'var(--success)' : 'var(--danger)') : 'var(--text)',
              }}>
                {m.isWL ? (m.wl <= 0 ? '+' : '-') : ''}{m.value}
              </div>
              {m.sub && <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{m.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
        <div style={{ padding:'0 16px', borderBottom:'1px solid var(--border)' }}>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>

        <div style={{ padding:'20px' }}>
          {/* OVERVIEW */}
          {tab === 'overview' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
              {/* Left: profile summary */}
              <div>
                <SectionLabel>Profile</SectionLabel>
                <Field label="Username">{vip.username}</Field>
                <Field label="Full Name">{vip.full_name}</Field>
                <Field label="Tier"><TierBadge tier={vip.tier} /></Field>
                <Field label="Status"><StatusBadge status={vip.activity_status} /></Field>
                <Field label="Risk"><RiskBadge risk={vip.churn_risk} /></Field>
                <Field label="Region">{vip.region}</Field>
                <Field label="Currency">{vip.currency}</Field>
                <Field label="Host">{vip.host_assigned}</Field>
                <Field label="Phone">{vip.phone}</Field>
                <Field label="WhatsApp">{vip.whatsapp}</Field>
                <Field label="Birthday">{vip.birthday ? fmtDate(vip.birthday) : '—'}</Field>
                <Field label="Registered">{fmtDate(vip.registration_date || vip.created_at)}</Field>
              </div>
              {/* Right: recent activity */}
              <div>
                <SectionLabel>Recent Activity</SectionLabel>
                {contacts.slice(0,5).length === 0 ? (
                  <EmptyState icon="📋" title="No activity yet" />
                ) : contacts.slice(0,5).map(c => (
                  <div key={c.id} style={{ borderBottom:'1px solid var(--border)', padding:'10px 0' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <span style={{ fontSize:13, fontWeight:600 }}>{c.contact_type || c.outcome || 'Contact'}</span>
                      <span style={{ fontSize:11, color:'var(--muted)' }}>{timeAgo(c.logged_at)}</span>
                    </div>
                    {(c.notes || c.outcome) && (
                      <div style={{ fontSize:12, color:'var(--muted)', marginTop:3 }}>{c.outcome}{c.notes ? ' — ' + c.notes : ''}</div>
                    )}
                    {c.host_name && <div style={{ fontSize:11, color:'var(--disabled)', marginTop:2 }}>by {c.host_name}</div>}
                  </div>
                ))}
                {contacts.length > 5 && (
                  <Btn size="sm" variant="link" onClick={() => setTab('contact')}>View all {contacts.length} contacts →</Btn>
                )}
              </div>
            </div>
          )}

          {/* FINANCIAL */}
          {tab === 'financial' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <SectionLabel>Financial History</SectionLabel>
                <div style={{ display:'flex', gap:4 }}>
                  {PERIODS.map(p => (
                    <button key={p.value} onClick={() => setPeriod(p.value)} style={{
                      fontSize:12, fontWeight:700, padding:'4px 10px', borderRadius:6, border:'none',
                      background: period===p.value ? 'var(--brand)' : 'var(--surface2)',
                      color: period===p.value ? '#fff' : 'var(--muted)', cursor:'pointer',
                    }}>{p.label}</button>
                  ))}
                </div>
              </div>
              {monthly.length === 0 ? (
                <EmptyState icon="💰" title="No financial data" message="No monthly totals found for this VIP." />
              ) : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr>
                        {['Month','Deposit','Withdrawal','Turnover','Win/Loss','Rebate'].map(h => (
                          <th key={h} style={{ padding:'9px 12px', textAlign: h==='Month'?'left':'right', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)' }}
                          >{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.map(m => {
                        const wl = parseFloat(m.win_loss) || 0
                        return (
                          <tr key={m.snapshot_month}
                            onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                            onMouseLeave={e => e.currentTarget.style.background='transparent'}
                          >
                            <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{m.snapshot_month}</td>
                            <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', textAlign:'right' }}>{formatMoney(m.total_deposit, vip.currency)}</td>
                            <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', textAlign:'right', color:'var(--muted)' }}>{formatMoney(m.total_withdrawal, vip.currency)}</td>
                            <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', textAlign:'right' }}>{formatMoney(m.monthly_valid_bet, vip.currency)}</td>
                            <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', textAlign:'right', fontWeight:600, color: wl<=0?'var(--success)':'var(--danger)' }}>
                              {wl<=0?'+':'-'}{formatMoney(Math.abs(wl), vip.currency)}
                            </td>
                            <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', textAlign:'right', color:'var(--muted)' }}>{formatMoney(m.total_rebate, vip.currency)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ACTIVITY (contact logs as timeline) */}
          {tab === 'activity' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <SectionLabel>Activity Timeline</SectionLabel>
                <Btn size="sm" variant="primary" onClick={() => setShowLog(true)}>+ Log Contact</Btn>
              </div>
              {contacts.length === 0 ? (
                <EmptyState icon="📋" title="No activity yet" message="Log the first contact to start the timeline." />
              ) : contacts.map(c => (
                <div key={c.id} style={{ borderBottom:'1px solid var(--border)', padding:'12px 0', display:'flex', gap:12 }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:'var(--surface2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
                    {c.contact_type === 'WhatsApp' ? '💬' : c.contact_type === 'Call' ? '📞' : '📋'}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>{c.contact_type || 'Contact'}</div>
                      <div style={{ fontSize:11, color:'var(--muted)' }}>{timeAgo(c.logged_at)}</div>
                    </div>
                    <div style={{ fontSize:12, marginTop:3 }}>
                      <span style={{
                        fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:10,
                        background: c.outcome==='Deposited'||c.outcome==='Reactivated' ? 'rgba(34,197,94,.15)' : c.outcome==='No Reply' ? 'rgba(239,68,68,.12)' : 'var(--surface2)',
                        color: c.outcome==='Deposited'||c.outcome==='Reactivated' ? 'var(--success)' : c.outcome==='No Reply' ? 'var(--danger)' : 'var(--muted)',
                        marginRight:8,
                      }}>{c.outcome}</span>
                      {c.notes}
                    </div>
                    {c.host_name && <div style={{ fontSize:11, color:'var(--disabled)', marginTop:3 }}>by {c.host_name}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CAMPAIGNS */}
          {tab === 'campaigns' && (
            <div>
              <SectionLabel>Campaign Participation</SectionLabel>
              {campaigns.length === 0 ? (
                <EmptyState icon="📢" title="No campaigns" message="This VIP has not joined any campaigns." />
              ) : campaigns.map(cp => (
                <div key={cp.id} style={{ borderBottom:'1px solid var(--border)', padding:'12px 0' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600 }}>{cp.campaigns?.campaign_name || 'Campaign'}</div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                        Joined {fmtDate(cp.added_at)}
                        {cp.campaigns?.start_date && ` · ${fmtDate(cp.campaigns.start_date)} – ${fmtDate(cp.campaigns.end_date)}`}
                      </div>
                    </div>
                    <span style={{
                      fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:20,
                      background: cp.campaigns?.status==='Active' ? 'rgba(34,197,94,.12)' : 'var(--surface2)',
                      color: cp.campaigns?.status==='Active' ? 'var(--success)' : 'var(--muted)',
                    }}>{cp.campaigns?.status || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CONTACT */}
          {tab === 'contact' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <SectionLabel>Contact History</SectionLabel>
                <Btn size="sm" variant="primary" onClick={() => setShowLog(true)}>+ Log Contact</Btn>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
                <Field label="Phone">{vip.phone || '—'}</Field>
                <Field label="WhatsApp">{vip.whatsapp || '—'}</Field>
              </div>
              {contacts.length === 0 ? (
                <EmptyState icon="📞" title="No contact records" message="No contact logs found for this VIP." />
              ) : contacts.map(c => (
                <div key={c.id} style={{ borderBottom:'1px solid var(--border)', padding:'10px 0' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ fontSize:13, fontWeight:600 }}>{c.contact_type || 'Contact'}</span>
                    <span style={{ fontSize:11, color:'var(--muted)' }}>{timeAgo(c.logged_at)}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:3 }}>{c.outcome}{c.notes?' — '+c.notes:''}</div>
                  {c.host_name && <div style={{ fontSize:11, color:'var(--disabled)', marginTop:2 }}>by {c.host_name}</div>}
                </div>
              ))}
            </div>
          )}

          {/* NOTES */}
          {tab === 'notes' && (
            <div>
              <SectionLabel>Internal Notes</SectionLabel>
              {vip.notes ? (
                <div style={{ background:'var(--surface2)', borderRadius:8, padding:14, fontSize:13, lineHeight:1.6, whiteSpace:'pre-wrap' }}>
                  {vip.notes}
                </div>
              ) : (
                <EmptyState icon="📝" title="No notes" message="Notes added about this VIP will appear here." />
              )}
              {profile?.role !== 'readonly' && (
                <div style={{ marginTop:14 }}>
                  <Btn variant="secondary" size="sm" onClick={() => setShowEdit(true)}>Edit Notes</Btn>
                </div>
              )}
            </div>
          )}

          {/* INSIGHTS */}
          {tab === 'insights' && (
            <div>
              <SectionLabel>AI Insights</SectionLabel>
              <div style={{ background:'var(--surface2)', borderRadius:8, padding:14, marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', marginBottom:8, letterSpacing:'.4px' }}>SYSTEM FACTS</div>
                <div style={{ fontSize:13, lineHeight:1.6 }}>
                  <div>Tier: <strong>{vip.tier}</strong> · Status: <strong>{vip.activity_status}</strong> · Risk: <strong>{vip.churn_risk}</strong></div>
                  <div>Days inactive: <strong>{daysInactive != null ? daysInactive + 'd' : '—'}</strong></div>
                  <div>Total deposit: <strong>{formatMoney(vip.total_deposit, vip.currency)}</strong></div>
                  <div>Last deposit: <strong>{fmtDate(vip.last_deposit_date)}</strong></div>
                  <div>Last contact: <strong>{fmtDate(vip.last_contacted || vip.last_contact_date)}</strong></div>
                </div>
              </div>

              {aiInsight ? (
                <div style={{ background:'rgba(59,130,246,.08)', border:'1px solid rgba(59,130,246,.2)', borderRadius:8, padding:14 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--info)', marginBottom:8, letterSpacing:'.4px' }}>AI INSIGHT</div>
                  <div style={{ fontSize:13, lineHeight:1.6, whiteSpace:'pre-wrap' }}>{aiInsight}</div>
                </div>
              ) : (
                <div style={{ textAlign:'center', padding:'24px 0' }}>
                  <Btn variant="secondary" onClick={getAIInsight} disabled={aiLoading}>
                    {aiLoading ? 'Generating…' : '✨ Generate AI Insight'}
                  </Btn>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:8 }}>
                    AI insights are labeled and separate from confirmed CRM data.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Log Contact Modal ── */}
      <Modal open={showLog} onClose={() => setShowLog(false)} title="Log Contact" width={440}>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{vip.full_name || vip.username}</div>
          <div>
            <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Contact Type</label>
            <Select value={logType} onChange={e => setLogType(e.target.value)} style={{ width:'100%' }}>
              {CONTACT_TYPE.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div>
            <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Outcome</label>
            <Select value={logOutcome} onChange={e => setLogOutcome(e.target.value)} style={{ width:'100%' }}>
              {CONTACT_OUTCOME.map(o => <option key={o} value={o}>{o}</option>)}
            </Select>
          </div>
          <div>
            <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Notes (optional)</label>
            <Textarea value={logNote} onChange={e => setLogNote(e.target.value)} rows={3} />
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <Btn variant="ghost" onClick={() => setShowLog(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={submitLog} disabled={logSaving}>{logSaving?'Saving…':'Save Log'}</Btn>
          </div>
        </div>
      </Modal>

      {/* ── Edit VIP Modal ── */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit VIP" width={480}>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Tier</label>
              <Select value={editForm.tier} onChange={e => setEditForm(f=>({...f,tier:e.target.value}))} style={{ width:'100%' }}>
                {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Host</label>
              <Select value={editForm.host_assigned||''} onChange={e => setEditForm(f=>({...f,host_assigned:e.target.value}))} style={{ width:'100%' }}>
                <option value="">— Unassigned —</option>
                {hosts.map(h => <option key={h} value={h}>{h}</option>)}
              </Select>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Status</label>
              <Select value={editForm.activity_status||''} onChange={e => setEditForm(f=>({...f,activity_status:e.target.value}))} style={{ width:'100%' }}>
                {['Active','Watch','At Risk','Dormant'].map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Risk Level</label>
              <Select value={editForm.churn_risk||''} onChange={e => setEditForm(f=>({...f,churn_risk:e.target.value}))} style={{ width:'100%' }}>
                {['','LOW','MEDIUM','HIGH','CRITICAL'].map(r => <option key={r} value={r}>{r||'— None —'}</option>)}
              </Select>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Phone</label>
              <Input value={editForm.phone||''} onChange={e => setEditForm(f=>({...f,phone:e.target.value}))} />
            </div>
            <div>
              <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>WhatsApp</label>
              <Input value={editForm.whatsapp||''} onChange={e => setEditForm(f=>({...f,whatsapp:e.target.value}))} />
            </div>
          </div>
          <div>
            <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Internal Notes</label>
            <Textarea value={editForm.notes||''} onChange={e => setEditForm(f=>({...f,notes:e.target.value}))} rows={3} />
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <Btn variant="ghost" onClick={() => setShowEdit(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={saveEdit} disabled={editSaving}>{editSaving?'Saving…':'Save Changes'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
