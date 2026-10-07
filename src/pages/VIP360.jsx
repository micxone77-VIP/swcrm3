// src/pages/VIP360.jsx — VIP 360 (V2) — replaces VIPDetail.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
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
import { useLanguage } from '../contexts/LanguageContext'

const TIERS = ['BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','BLACK']
const PERIODS = [
{ value: '30', label: '30D' },
{ value: 'mtd', label: 'MTD' },
{ value: '90', label: '90D' },
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
const [searchParams] = useSearchParams()
const playerQuery = searchParams.get('player')
const navigate = useNavigate()
const { profile } = useAuth()
const { toast, ToastContainer } = useToast()
const { t } = useLanguage()

const [vip, setVip] = useState(null)
const [monthly, setMonthly] = useState([])
const [daily, setDaily] = useState([])
const [contacts, setContacts] = useState([])
const [campaigns, setCampaigns] = useState([])
const [tierLogs, setTierLogs] = useState([])
const [hosts, setHosts] = useState([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState(null)
const [tab, setTab] = useState('overview')
const [period, setPeriod] = useState('30')
const [aiInsight, setAiInsight] = useState(null)
const [aiLoading, setAiLoading] = useState(false)

// Contact log modal
const [showLog, setShowLog] = useState(false)
const [logType, setLogType] = useState('WhatsApp')
const [logOutcome, setLogOutcome] = useState('Contacted')
const [logNote, setLogNote] = useState('')
const [logSaving, setLogSaving] = useState(false)

// Edit modal
const [showEdit, setShowEdit] = useState(false)
const [editForm, setEditForm] = useState({})
const [editSaving, setEditSaving] = useState(false)

// Deposit calendar
const [calMonth, setCalMonth] = useState(() => {
const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`
})
const [calData, setCalData] = useState([])
const [calLoading, setCalLoading] = useState(false)

// Gaming tab state
const [gaming, setGaming] = useState([])          // provider_player_stats rows
const [gamingLabel, setGamingLabel] = useState(null) // player_gaming_labels row
const [gamingLoading, setGamingLoading] = useState(false)
const [gamingAI, setGamingAI] = useState(null)
const [gamingAILoading, setGamingAILoading] = useState(false)

// Department spending state
const [vipExpenses, setVipExpenses] = useState([])
const [expensesLoading, setExpensesLoading] = useState(false)

// VIP Profile & Interests state
const [vipProfile, setVipProfile] = useState(null)
const [profileForm, setProfileForm] = useState({
  preferred_games: [], interests: [], personality_tags: [],
  deposit_pattern: '', deposit_trigger: '',
  preferred_contact_time: '', preferred_contact_channel: 'whatsapp',
  host_notes: '', relationship_level: 'neutral',
  vip_since: '', birthday_month: '', birthday_day: '',
})
const [profileLoading, setProfileLoading] = useState(false)
const [profileSaving, setProfileSaving] = useState(false)
const profileLoadedFor = useRef(null)

const load = useCallback(async () => {
setLoading(true); setError(null)
try {
const now = new Date()
const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`

// Step 1: Resolve VIP — by UUID (path param) or by username (query param from ExpenseTracker link)
let vipRes
if (id) {
  vipRes = await supabase.from('vip_members').select('*').eq('id', id).single()
} else if (playerQuery) {
  vipRes = await supabase.from('vip_members').select('*').eq('username', playerQuery).single()
} else {
  throw new Error('No VIP identifier provided')
}
if (vipRes.error) throw vipRes.error
const resolvedId = vipRes.data.id

// Step 2: Load related data in parallel using resolved UUID
const [montRes, dailyRes, contRes, campRes, tierRes, hostRes] = await Promise.all([
supabase.from('vip_monthly_totals')
.select('snapshot_month,total_deposit,total_withdrawal,monthly_valid_bet,win_loss,total_rebate,bonus_amount')
.eq('vip_id', resolvedId)
.order('snapshot_month', { ascending: false })
.limit(24),
supabase.from('vip_daily_snapshots')
.select('snapshot_date,total_deposit,total_withdrawal,monthly_valid_bet,win_loss')
.eq('vip_id', resolvedId)
.order('snapshot_date', { ascending: false })
.limit(90),
supabase.from('contact_logs')
.select('*')
.eq('vip_id', resolvedId)
.order('logged_at', { ascending: false })
.limit(100),
supabase.from('campaign_players')
.select('*, campaigns(campaign_name,start_date,end_date,status)')
.eq('vip_id', resolvedId)
.order('added_at', { ascending: false }),
supabase.from('tier_change_logs')
.select('*')
.eq('vip_id', resolvedId)
.order('changed_at', { ascending: false }),
supabase.from('profiles').select('full_name').in('role',['admin','host']).order('full_name'),
])
setVip(vipRes.data)
setEditForm({ full_name: vipRes.data.full_name||'', birthday: vipRes.data.birthday||'', host_assigned: vipRes.data.host_assigned||'', tier: vipRes.data.tier||'', activity_status: vipRes.data.activity_status||'', phone: vipRes.data.phone||'', whatsapp: vipRes.data.whatsapp||'', email: vipRes.data.email||'', telegram: vipRes.data.telegram||'', churn_risk: vipRes.data.churn_risk||'', address: vipRes.data.address||'', special_requests: vipRes.data.special_requests||'', tng_verified_name: vipRes.data.tng_verified_name||'', tng_verify_status: vipRes.data.tng_verify_status||'', tng_verified_at: vipRes.data.tng_verified_at||'' })
setMonthly(montRes.data || [])
setDaily(dailyRes.data || [])
setContacts(contRes.data || [])
setCampaigns(campRes.data || [])
setTierLogs(tierRes.data || [])
setHosts((hostRes.data||[]).map(h => h.full_name).filter(Boolean))
// Load gaming label eagerly for badge display (lightweight, single row)
if (vipRes.data.username) {
  supabase.from('player_gaming_labels')
    .select('player_type,player_type_icon,offer_recommendation,snapshot_month')
    .eq('username', vipRes.data.username)
    .order('snapshot_month', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data }) => { if (data) setGamingLabel(data) })
}
} catch(e) { setError(e.message || String(e)) }
setLoading(false)
}, [id, playerQuery])

useEffect(() => { load() }, [load])

// Deposit calendar fetch
useEffect(() => {
if (tab !== 'calendar' || !id) return
setCalLoading(true)
const [y, m] = calMonth.split('-').map(Number)
const start = `${calMonth}-01`
const daysInMonth = new Date(y, m, 0).getDate()
const end = `${calMonth}-${String(daysInMonth).padStart(2,'0')}`
supabase.from('vip_daily_snapshots')
.select('snapshot_date,total_deposit,total_withdrawal,monthly_valid_bet,bet_count')
.eq('vip_id', id)
.gte('snapshot_date', start)
.lte('snapshot_date', end)
.order('snapshot_date', { ascending: true })
.then(({ data }) => { setCalData(data || []); setCalLoading(false) })
}, [tab, calMonth, id])

// Lazy-load full gaming stats when tab switches to 'gaming'
useEffect(() => {
if (tab !== 'gaming' || !vip?.username) return
if (gaming.length > 0 || gamingLoading) return
setGamingLoading(true)
Promise.all([
  supabase.from('provider_player_stats')
    .select('*')
    .eq('username', vip.username)
    .order('valid_turnover', { ascending: false }),
  supabase.from('player_gaming_labels')
    .select('*')
    .eq('username', vip.username)
    .order('snapshot_month', { ascending: false })
    .limit(1)
    .maybeSingle(),
]).then(([provRes, labelRes]) => {
  setGaming(provRes.data || [])
  if (labelRes.data) setGamingLabel(labelRes.data)
  setGamingLoading(false)
})
}, [tab, vip?.username, gaming.length, gamingLoading])

// Lazy-load VIP profile when profile tab opens
useEffect(() => {
if (tab !== 'profile' || !vip?.username) return
if (profileLoadedFor.current === vip.username) return
profileLoadedFor.current = vip.username
setProfileLoading(true)
supabase.from('vip_profiles')
  .select('*').eq('username', vip.username).maybeSingle()
  .then(({ data }) => {
    if (data) {
      setVipProfile(data)
      setProfileForm({
        preferred_games:          data.preferred_games || [],
        interests:                data.interests || [],
        personality_tags:         data.personality_tags || [],
        deposit_pattern:          data.deposit_pattern || '',
        deposit_trigger:          data.deposit_trigger || '',
        preferred_contact_time:   data.preferred_contact_time || '',
        preferred_contact_channel: data.preferred_contact_channel || 'whatsapp',
        host_notes:               data.host_notes || '',
        relationship_level:       data.relationship_level || 'neutral',
        vip_since:                data.vip_since || '',
        birthday_month:           data.birthday_month ? String(data.birthday_month) : '',
        birthday_day:             data.birthday_day  ? String(data.birthday_day)  : '',
      })
    }
    setProfileLoading(false)
  })
}, [tab, vip?.username])

// Lazy-load department expenses when spending tab opens
useEffect(() => {
if (tab !== 'spending' || !vip?.username) return
if (vipExpenses.length > 0 || expensesLoading) return
setExpensesLoading(true)
supabase.from('department_expenses')
  .select('id,category,item_name,platform,currency,amount,expense_type,notes,created_at')
  .eq('vip_username', vip.username)
  .order('created_at', { ascending: false })
  .then(({ data }) => { setVipExpenses(data || []); setExpensesLoading(false) })
}, [tab, vip?.username, vipExpenses.length, expensesLoading])

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
const sumDeposit = periodMonthly.reduce((s,m) => s + (parseFloat(m.total_deposit)||0), 0)
const sumWithdrawal = periodMonthly.reduce((s,m) => s + (parseFloat(m.total_withdrawal)||0), 0)
const sumTurnover = periodMonthly.reduce((s,m) => s + (parseFloat(m.monthly_valid_bet)||0), 0)
const sumWL = periodMonthly.reduce((s,m) => s + (parseFloat(m.win_loss)||0), 0)

const daysInactive = vip?.last_deposit_date
? Math.floor((now - new Date(vip.last_deposit_date)) / 86400000)
: (vip?.days_inactive ?? null)

async function submitLog() {
if (logSaving) return
setLogSaving(true)
const nowStr = new Date().toISOString()
const { error: err } = await supabase.from('contact_logs').insert({
vip_id: id, username: vip.username,
channel: logType, outcome: logOutcome,
notes: logNote || null, host_name: profile?.full_name || null,
logged_at: nowStr,
})
await supabase.from('vip_members').update({ last_contacted: nowStr, last_contact_date: nowStr.slice(0,10) }).eq('id', id)
setLogSaving(false)
if (err) { toast('Error: ' + err.message, 'error'); return }
toast(t('vip360.contactLogged'), 'success')
setShowLog(false); setLogNote('')
load()
}

async function saveEdit() {
setEditSaving(true)
// Only include columns that exist in vip_members (notes is not a column)
const ALLOWED = ['full_name','birthday','host_assigned','tier','activity_status','phone','whatsapp','email','telegram','churn_risk','address','special_requests','tng_verified_name','tng_verify_status','tng_verified_at']
const clean = Object.fromEntries(
  ALLOWED.map(k => [k, editForm[k] === '' ? null : (editForm[k] ?? null)])
)
const { error: err } = await supabase.from('vip_members').update(clean).eq('id', id)
setEditSaving(false)
if (err) { toast('Error: ' + err.message, 'error'); return }
toast(t('vip360.savedMsg'), 'success')
setShowEdit(false)
load()
}

async function getAIInsight() {
setAiLoading(true)
try {
const summary = `VIP: ${vip.full_name||vip.username}, Tier: ${vip.tier}, Risk: ${vip.churn_risk}, Days inactive: ${daysInactive}, Total deposit: ${formatMoney(vip.total_deposit, vip.currency)}. Last 3 months deposits: ${periodMonthly.slice(0,3).map(m=>formatMoney(m.total_deposit,vip.currency)).join(', ')}.`
const result = await callAI(`Analyze this VIP player and provide a brief insight with recommended action: ${summary}`)
setAiInsight(result)
} catch(e) { toast(t('vip360.aiUnavailable'), 'error') }
setAiLoading(false)
}

async function getGamingAI() {
setGamingAILoading(true)
try {
const gl = gamingLabel
const topProviders = gaming.slice(0,5).map(p => `${p.provider}(turnover:${p.valid_turnover?.toFixed(0)||0},wl:${p.win_loss?.toFixed(0)||0})`).join(', ')
const summary = `Player: ${vip.username}, Type: ${gl?.player_type||'Unknown'}, Tier: ${vip.tier}.
Category split: Slots ${gl?.slots_pct||0}%, Live Casino ${gl?.live_pct||0}%, Sports ${gl?.sports_pct||0}%.
Top providers by turnover: ${topProviders||'none'}.
Best provider (player wins): ${gl?.best_provider||'none'}.
Worst provider (house wins): ${gl?.worst_provider||'none'}.
Active providers: ${gl?.active_providers||0}.
System suggestion: ${gl?.offer_recommendation||'N/A'}.`
const result = await callAI(`Based on this VIP player's gaming data, provide a specific campaign offer recommendation with reasoning. Be concise and actionable (2-3 sentences): ${summary}`)
setGamingAI(result)
} catch(e) { toast('AI unavailable', 'error') }
setGamingAILoading(false)
}

async function saveProfile() {
setProfileSaving(true)
const payload = {
  username:                  vip.username,
  preferred_games:           profileForm.preferred_games,
  interests:                 profileForm.interests,
  personality_tags:          profileForm.personality_tags,
  deposit_pattern:           profileForm.deposit_pattern || '',
  deposit_trigger:           profileForm.deposit_trigger || '',
  preferred_contact_time:    profileForm.preferred_contact_time || '',
  preferred_contact_channel: profileForm.preferred_contact_channel || 'whatsapp',
  host_notes:                profileForm.host_notes || '',
  relationship_level:        profileForm.relationship_level || 'neutral',
  vip_since:                 profileForm.vip_since || null,
  birthday_month:            profileForm.birthday_month ? parseInt(profileForm.birthday_month) : null,
  birthday_day:              profileForm.birthday_day  ? parseInt(profileForm.birthday_day)  : null,
  updated_at:                new Date().toISOString(),
}
const { error: err } = await supabase.from('vip_profiles')
  .upsert(payload, { onConflict: 'username' })
setProfileSaving(false)
if (err) { toast('Error: ' + err.message, 'error'); return }
toast('Profile saved ✓', 'success')
setVipProfile(payload)
}

function toggleTag(field, val) {
setProfileForm(f => {
  const arr = f[field] || []
  return { ...f, [field]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] }
})
}

const TABS = [
{ key: 'overview', label: t('vip360.tabOverview') },
{ key: 'financial', label: t('vip360.tabFinancial') },
{ key: 'gaming', label: '🎮 Gaming' },
{ key: 'profile', label: '👤 Profile' },
{ key: 'activity', label: t('vip360.tabActivity') },
{ key: 'campaigns', label: t('vip360.tabCampaigns'), count: campaigns.length },
{ key: 'contact', label: t('vip360.tabContact'), count: contacts.length },
{ key: 'calendar', label: t('vip360.tabCalendar') },
{ key: 'notes', label: t('vip360.tabNotes') },
{ key: 'insights', label: t('vip360.tabInsights') },
{ key: 'spending', label: '💸 Dept Spending' },
]

if (loading) return <div style={{ padding: 32 }}><LoadingState message={t('vip360.loadingMsg')} /></div>
if (error || !vip) return <div style={{ padding: 32 }}><ErrorState message={error || t('vip360.vipNotFound')} onRetry={load} /></div>

const tierCfg = TIER_CONFIG[(vip.tier||'').toUpperCase()] || TIER_CONFIG.SILVER
const statusCfg = STATUS_CONFIG[vip.activity_status] || { color:'var(--muted)', bg:'var(--surface2)' }

return (
<div style={{ padding: '24px 28px' }}>
<ToastContainer />

{/* ── Back ── */}
<button onClick={() => navigate(-1)} style={{
background:'none', border:'none', color:'var(--muted)', fontSize:13,
cursor:'pointer', display:'flex', alignItems:'center', gap:6, marginBottom:20, padding:0,
}}>{t('vip360.backBtn')}</button>

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
{(vip.username||vip.full_name||'?')[0].toUpperCase()}
</div>
<div>
<div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
<h2 style={{ fontSize:22, fontWeight:700, margin:0 }}>{vip.username}</h2>
<button
title="Copy username"
onClick={() => navigator.clipboard.writeText(vip.username)}
style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:14, padding:'0 2px', lineHeight:1, opacity:.6 }}
onMouseEnter={e => e.currentTarget.style.opacity=1}
onMouseLeave={e => e.currentTarget.style.opacity=.6}
>⎘</button>
</div>
{vip.full_name && <div style={{ fontSize:13, color:'var(--muted)', marginBottom:4 }}>{vip.full_name}</div>}
<div style={{ display:'flex', alignItems:'center', gap:8, marginTop:2, flexWrap:'wrap' }}>
<TierBadge tier={vip.tier} />
<StatusBadge status={vip.activity_status} />
<RiskBadge risk={vip.churn_risk} />
</div>
<div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>
{vip.region && <span>{vip.region}</span>}
{vip.host_assigned && <span> · Host: {vip.host_assigned}</span>}
{vip.currency && <span> · {vip.currency}</span>}
</div>
{gamingLabel && (
<div style={{ marginTop:6 }}>
  <span
    onClick={() => setTab('gaming')}
    title="Click to view Gaming tab"
    style={{
      display:'inline-flex', alignItems:'center', gap:5,
      fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, cursor:'pointer',
      background:'rgba(139,92,246,.15)', border:'1px solid rgba(139,92,246,.35)', color:'#a78bfa',
    }}
  >
    {gamingLabel.player_type_icon} {gamingLabel.player_type}
  </span>
</div>
)}
</div>
</div>
<div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
<Btn variant="primary" onClick={() => setShowLog(true)}>{t('vip360.logContact')}</Btn>
{profile?.role !== 'readonly' && (
<Btn variant="secondary" onClick={() => setShowEdit(true)}>{t('vip360.editVip')}</Btn>
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
<Field label="Email">{vip.email}</Field>
<Field label="Telegram">{vip.telegram ? `@${vip.telegram}` : '—'}</Field>
<Field label="Address">{vip.address}</Field>
<Field label="Remark">{vip.special_requests}</Field>
<Field label="Birthday">{vip.birthday ? fmtDate(vip.birthday) : '—'}</Field>
<Field label="Registered">{fmtDate(vip.registration_date || vip.created_at)}</Field>
<Field label="T&G Verify">
  {vip.tng_verify_status === 'verified' ? (
    <span style={{ color:'#3fb950', fontWeight:700 }}>✓ Verified — {vip.tng_verified_name || '—'}</span>
  ) : vip.tng_verify_status === 'mismatch' ? (
    <span style={{ color:'#d29922', fontWeight:700 }}>⚠ Mismatch — {vip.tng_verified_name || '—'}</span>
  ) : (
    <span style={{ color:'var(--muted)' }}>Not checked</span>
  )}
  {vip.tng_verified_at && <span style={{ fontSize:11, color:'var(--muted)', marginLeft:8 }}>({fmtDate(vip.tng_verified_at)})</span>}
</Field>
</div>
{/* Right: recent activity */}
<div>
<SectionLabel>Recent Activity</SectionLabel>
{contacts.slice(0,5).length === 0 ? (
<EmptyState icon="📋" title="No activity yet" />
) : contacts.slice(0,5).map(c => (
<div key={c.id} style={{ borderBottom:'1px solid var(--border)', padding:'10px 0' }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
<span style={{ fontSize:13, fontWeight:600 }}>{c.channel || c.outcome || 'Contact'}</span>
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

{/* GAMING */}
{tab === 'gaming' && (() => {
const fmtK = v => !v ? '0' : Math.abs(v) >= 1000000 ? (v/1000000).toFixed(2)+'M' : Math.abs(v) >= 1000 ? (v/1000).toFixed(1)+'K' : Number(v).toFixed(0)
const fmtKAbs = v => !v ? '0' : Math.abs(v) >= 1000000 ? (Math.abs(v)/1000000).toFixed(2)+'M' : Math.abs(v) >= 1000 ? (Math.abs(v)/1000).toFixed(1)+'K' : Math.abs(v).toFixed(0)

// Provider category map
const LIVE_PROVIDERS = new Set(['Evo','DG','SA','MTL','AES2','PPL'])
const SLOTS_PROVIDERS = new Set(['PP Slot','JL','NS','FC','PT4','MEGA','SG','BNG','SCR2','PTL4'])
const SPORTS_PROVIDERS = new Set(['CBX','IBC','CMD','L365','BTI2'])
const getCat = p => LIVE_PROVIDERS.has(p) ? 'live' : SLOTS_PROVIDERS.has(p) ? 'slots' : SPORTS_PROVIDERS.has(p) ? 'sports' : 'other'
const CAT_COLOR = { live:'#f59e0b', slots:'#8b5cf6', sports:'#22c55e', other:'var(--muted)' }
const CAT_LABEL = { live:'Live Casino', slots:'Slots', sports:'Sports', other:'Other' }
const CAT_ICON  = { live:'🎲', slots:'🎰', sports:'⚽', other:'🃏' }

// Sort by turnover
const sortedProviders = [...gaming].sort((a,b) => (b.valid_turnover||0) - (a.valid_turnover||0))
const maxTurnover = sortedProviders[0]?.valid_turnover || 1

// Category totals from label
const gl = gamingLabel
const PLAYER_TYPE_COLOR = {
  'Slots King': '#8b5cf6',
  'Live Casino VIP': '#f59e0b',
  'Sports Punter': '#22c55e',
  'Slots + Live': '#a855f7',
  'Live + Sports': '#f97316',
  'Multi-Platform': '#3b82f6',
  'Casual': 'var(--muted)',
}
const ptColor = gl ? (PLAYER_TYPE_COLOR[gl.player_type] || 'var(--muted)') : 'var(--muted)'

return (
<div>
  {gamingLoading ? (
    <LoadingState message="Loading gaming data…" />
  ) : gaming.length === 0 ? (
    <EmptyState icon="🎮" title="No gaming data" message="No provider stats found for this player. Upload gaming data via CSV Import." />
  ) : (
    <div>
      {/* Player Type Badge + Category Summary */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
        {/* Player Type */}
        <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:10 }}>Player Type</div>
          {gl ? (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                <span style={{ fontSize:28 }}>{gl.player_type_icon}</span>
                <span style={{ fontSize:18, fontWeight:800, color: ptColor }}>{gl.player_type}</span>
              </div>
              <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>
                {gl.snapshot_month} · {gl.active_providers} active provider{gl.active_providers !== 1 ? 's':''}</div>
              {/* Category bars */}
              {[
                { label:'Slots', pct: gl.slots_pct, color: CAT_COLOR.slots },
                { label:'Live Casino', pct: gl.live_pct, color: CAT_COLOR.live },
                { label:'Sports', pct: gl.sports_pct, color: CAT_COLOR.sports },
              ].filter(b => b.pct > 0).map(b => (
                <div key={b.label} style={{ marginBottom:6 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                    <span style={{ color:'var(--muted)' }}>{b.label}</span>
                    <span style={{ fontWeight:700, color: b.color }}>{b.pct}%</span>
                  </div>
                  <div style={{ height:5, background:'var(--border)', borderRadius:3 }}>
                    <div style={{ height:5, borderRadius:3, background: b.color, width:`${b.pct}%`, transition:'width .4s' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize:13, color:'var(--muted)' }}>Label not yet computed. Run the SQL migration first.</div>
          )}
        </div>

        {/* Good at / Bad at */}
        <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:10 }}>Strengths & Weaknesses</div>
          {gl?.best_provider && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:'var(--success)', fontWeight:700, marginBottom:4 }}>✅ Best at (player wins)</div>
              <div style={{ fontSize:14, fontWeight:700 }}>{gl.best_provider}</div>
              <div style={{ fontSize:11, color:'var(--muted)' }}>
                {CAT_ICON[getCat(gl.best_provider)]} {CAT_LABEL[getCat(gl.best_provider)]}
              </div>
            </div>
          )}
          {gl?.worst_provider && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:'var(--danger)', fontWeight:700, marginBottom:4 }}>⚠️ Worst at (house wins most)</div>
              <div style={{ fontSize:14, fontWeight:700 }}>{gl.worst_provider}</div>
              <div style={{ fontSize:11, color:'var(--muted)' }}>
                {CAT_ICON[getCat(gl.worst_provider)]} {CAT_LABEL[getCat(gl.worst_provider)]}
              </div>
            </div>
          )}
          {!gl?.best_provider && !gl?.worst_provider && (
            <div style={{ fontSize:13, color:'var(--muted)' }}>No win/loss data available yet.</div>
          )}
          {gl?.top_providers && (
            <div style={{ marginTop:4 }}>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:700, marginBottom:4 }}>TOP PROVIDERS (by turnover)</div>
              <div style={{ fontSize:12 }}>{gl.top_providers}</div>
            </div>
          )}
        </div>
      </div>

      {/* Offer Recommendation */}
      {gl?.offer_recommendation && (
        <div style={{ background:'rgba(59,130,246,.07)', border:'1px solid rgba(59,130,246,.2)', borderRadius:10, padding:'14px 18px', marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--info)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:6 }}>💡 Suggested Offer</div>
              <div style={{ fontSize:13, fontWeight:500 }}>{gl.offer_recommendation}</div>
            </div>
            <Btn size="sm" variant="secondary" onClick={getGamingAI} disabled={gamingAILoading} style={{ flexShrink:0 }}>
              {gamingAILoading ? 'Thinking…' : '🤖 AI Recommendation'}
            </Btn>
          </div>
          {gamingAI && (
            <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid rgba(59,130,246,.2)', fontSize:13, lineHeight:1.6, color:'var(--text)' }}>
              <span style={{ fontSize:11, fontWeight:700, color:'var(--info)', marginRight:8 }}>AI:</span>{gamingAI}
            </div>
          )}
        </div>
      )}

      {/* Provider Breakdown Table */}
      <div>
        <SectionLabel>Provider Breakdown</SectionLabel>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                {['Provider','Category','Turnover','Win/Loss','Rebate','Bonus','Sessions'].map(h => (
                  <th key={h} style={{ padding:'8px 10px', textAlign: h==='Provider'||h==='Category'?'left':'right', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedProviders.map(p => {
                const cat = getCat(p.provider)
                const wl = parseFloat(p.win_loss)||0
                return (
                  <tr key={p.provider + (p.snapshot_month||'')}
                    onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}
                  >
                    <td style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        {/* Turnover bar */}
                        <div style={{ width:40, height:4, background:'var(--border)', borderRadius:2, flexShrink:0 }}>
                          <div style={{ height:4, borderRadius:2, background: CAT_COLOR[cat], width:`${Math.round((p.valid_turnover||0)/maxTurnover*100)}%` }} />
                        </div>
                        {p.provider}
                      </div>
                    </td>
                    <td style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:10, background: `${CAT_COLOR[cat]}22`, color: CAT_COLOR[cat] }}>
                        {CAT_ICON[cat]} {CAT_LABEL[cat]}
                      </span>
                    </td>
                    <td style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'right', fontWeight:600 }}>{fmtK(p.valid_turnover)}</td>
                    <td style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'right', fontWeight:700, color: wl>0?'var(--success)':wl<0?'var(--danger)':'var(--muted)' }}>
                      {wl>0?'+':''}{fmtK(wl)}
                    </td>
                    <td style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'right', color:'var(--muted)' }}>{fmtK(p.total_rebate)}</td>
                    <td style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'right', color:'var(--muted)' }}>{fmtK(p.total_bonus)}</td>
                    <td style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'right', color:'var(--muted)' }}>{p.transfer_in_count||0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )}
</div>
)
})()}

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
{c.channel === 'WhatsApp' ? '💬' : c.channel === 'Call' ? '📞' : '📋'}
</div>
<div style={{ flex:1 }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
<div style={{ fontSize:13, fontWeight:600 }}>{c.channel || 'Contact'}</div>
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
{c.host_name && <div style={{ fontSize:11, color:'var(--disabled)', marginTop:3 }}>by {c.host_name}{c.wa_number_used && <span style={{ marginLeft:8, color:'#25d366', fontWeight:600 }}>📱 {c.wa_number_used}</span>}</div>}
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
<Field label="Email">{vip.email || '—'}</Field>
<Field label="Telegram">{vip.telegram ? `@${vip.telegram}` : '—'}</Field>
<Field label="Address">{vip.address || '—'}</Field>
<Field label="Remark">{vip.special_requests || '—'}</Field>
</div>
{contacts.length === 0 ? (
<EmptyState icon="📞" title="No contact records" message="No contact logs found for this VIP." />
) : contacts.map(c => (
<div key={c.id} style={{ borderBottom:'1px solid var(--border)', padding:'10px 0' }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
<span style={{ fontSize:13, fontWeight:600 }}>{c.channel || 'Contact'}</span>
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

{/* DEPOSIT CALENDAR */}
{tab === 'calendar' && (() => {
const [y, m] = calMonth.split('-').map(Number)
const daysInMonth = new Date(y, m, 0).getDate()
const firstDow = new Date(y, m - 1, 1).getDay() // 0=Sun
const byDay = {}
calData.forEach(r => { byDay[r.snapshot_date] = r })

// FIX: total_deposit is a cumulative MTD value in vip_daily_snapshots.
// Calculate daily deposit deltas by subtracting the previous day's cumulative.
// This prevents the same MTD value from appearing as separate deposits on each day.
const dailyDeposit = {}
let runningDep = 0
// calData is already ordered ascending (snapshot_date ASC) from the query
calData.forEach(row => {
  const curr = Number(row.total_deposit || 0)
  dailyDeposit[row.snapshot_date] = Math.max(0, curr - runningDep)
  runningDep = curr
})

let depositDays = 0, turnoverOnlyDays = 0, absentDays = 0
let totalDeposit = 0, totalBet = 0, totalWithdrawal = 0, withdrawalDays = 0
for (let d = 1; d <= daysInMonth; d++) {
const key = `${calMonth}-${String(d).padStart(2,'0')}`
const row = byDay[key]
if (!row) { absentDays++; continue }
// FIX: use delta deposit (not raw cumulative) for accurate per-day count
const dep = dailyDeposit[key] || 0
const bet = Number(row.monthly_valid_bet || 0)
// FIX: use monthly_valid_bet (per-day valid bet) not bet_count (cumulative)
const mvb = Number(row.monthly_valid_bet || 0)
const wd = Number(row.total_withdrawal || 0)
totalDeposit += dep; totalBet += bet
if (wd > 0) { totalWithdrawal += wd; withdrawalDays++ }
if (dep > 0) depositDays++
else if (mvb > 0) turnoverOnlyDays++
else absentDays++
}
const activeDays = depositDays + turnoverOnlyDays
const fmtK = v => v >= 1000000 ? (v/1000000).toFixed(2)+'M' : v >= 1000 ? (v/1000).toFixed(1)+'K' : v.toFixed(0)
const prevMonth = () => { const d=new Date(y,m-2,1); setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }
const nextMonth = () => { const d=new Date(y,m,1); setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }
const monthName = new Date(y, m-1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
return (
<div>
{/* Header + nav */}
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
<div style={{ fontSize:13, fontWeight:800, letterSpacing:'.3px' }}>📅 {monthName.toUpperCase()} DEPOSIT RECORDS</div>
<div style={{ display:'flex', gap:6 }}>
<Btn size="sm" variant="ghost" onClick={prevMonth}>‹</Btn>
<Btn size="sm" variant="ghost" onClick={nextMonth}>›</Btn>
</div>
</div>
{/* Stats */}
<div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
{[
{ label: `${calMonth} Deposit Days`, value: `${depositDays}/${daysInMonth} days`, color:'var(--success)' },
{ label: 'Turnover Only, No Deposit', value: turnoverOnlyDays, color:'#c9a961' },
{ label: `${calMonth} Deposit`, value: 'RM '+fmtK(totalDeposit), color:'var(--text)' },
{ label: `${calMonth} Valid Bet`, value: 'RM '+fmtK(totalBet), color:'var(--muted)' },
].map(s => (
<div key={s.label} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 14px' }}>
<div style={{ fontSize:17, fontWeight:800, color:s.color }}>{s.value}</div>
<div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{s.label}</div>
</div>
))}
</div>
<div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:18 }}>
{[
{ label: `${calMonth} Active Rate`, value: Math.round(activeDays/daysInMonth*100)+'%', color: activeDays/daysInMonth >= 0.5 ? 'var(--success)' : 'var(--warning)' },
{ label: `${calMonth} Deposit Rate`, value: Math.round(depositDays/daysInMonth*100)+'%', color:'var(--success)' },
{ label: `${calMonth} Withdrawal Rate`, value: Math.round(withdrawalDays/daysInMonth*100)+'%', color:'var(--danger)' },
].map(s => (
<div key={s.label} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 14px' }}>
<div style={{ fontSize:17, fontWeight:800, color:s.color }}>{s.value}</div>
<div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{s.label}</div>
</div>
))}
</div>
{/* Legend */}
<div style={{ display:'flex', gap:16, marginBottom:12, fontSize:11, color:'var(--muted)' }}>
<span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, borderRadius:3, background:'rgba(34,197,94,.85)', display:'inline-block' }}></span>Deposited</span>
<span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, borderRadius:3, background:'rgba(201,169,97,.85)', display:'inline-block' }}></span>Turnover only</span>
<span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, borderRadius:3, background:'var(--surface2)', border:'1px solid var(--border)', display:'inline-block' }}></span>Absent</span>
</div>
{/* Calendar grid */}
{calLoading ? <LoadingState /> : (
<div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
<div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:'1px solid var(--border)' }}>
{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
<div key={d} style={{ padding:'7px 0', textAlign:'center', fontSize:10, fontWeight:700, color:'var(--muted)' }}>{d}</div>
))}
</div>
<div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3, padding:6 }}>
{Array.from({ length: firstDow }).map((_,i) => <div key={`e${i}`} />)}
{Array.from({ length: daysInMonth }).map((_,i) => {
const d = i + 1
const key = `${calMonth}-${String(d).padStart(2,'0')}`
const row = byDay[key]
// FIX: use delta deposit not raw cumulative
const dep = dailyDeposit[key] || 0
// FIX: use monthly_valid_bet (per-day) not bet_count (cumulative MTD)
const mvb = row ? Number(row.monthly_valid_bet || 0) : 0
const bet = mvb
const isDeposit = dep > 0
const isTurnover = !isDeposit && mvb > 0
const bg = isDeposit ? 'rgba(34,197,94,.82)' : isTurnover ? 'rgba(201,169,97,.82)' : 'transparent'
const textColor = (isDeposit || isTurnover) ? '#fff' : 'var(--muted)'
const today = new Date()
const isToday = today.getFullYear()===y && today.getMonth()+1===m && today.getDate()===d
return (
<div key={d} title={row ? `Deposit: RM${dep} · Bet: RM${fmtK(bet)}` : 'No activity'}
style={{ background:bg, borderRadius:6, padding:'8px 4px', textAlign:'center', minHeight:52, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2,
outline: isToday ? '2px solid var(--accent)' : 'none', outlineOffset:'-2px' }}>
<div style={{ fontSize:12, fontWeight:700, color: isToday && !row ? 'var(--accent)' : textColor }}>{d}</div>
{isDeposit && <div style={{ fontSize:9, fontWeight:600, color:'rgba(255,255,255,.9)' }}>+{fmtK(dep)}</div>}
{isTurnover && <div style={{ fontSize:9, fontWeight:600, color:'rgba(255,255,255,.9)' }}>bet</div>}
</div>
)
})}
</div>
</div>
)}
</div>
)
})()}

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
{aiLoading ? t('vip360.aiLoading') : t('vip360.getInsight')}
</Btn>
<div style={{ fontSize:11, color:'var(--muted)', marginTop:8 }}>
AI insights are labeled and separate from confirmed CRM data.
</div>
</div>
)}
</div>
)}

{/* PROFILE & INTERESTS */}
{tab === 'profile' && (() => {
const GAME_OPTIONS = [
  { val:'slots',        label:'🎰 Slots' },
  { val:'live_casino',  label:'🃏 Live Casino' },
  { val:'sports',       label:'⚽ Sports Betting' },
  { val:'fishing',      label:'🎣 Fishing' },
  { val:'poker',        label:'♠️ Poker' },
  { val:'esports',      label:'🕹️ E-Sports' },
  { val:'arcade',       label:'🕹 Arcade' },
  { val:'mixed',        label:'🎲 Mixed / All' },
]
const INTEREST_OPTIONS = [
  { val:'gadgets_3c',   label:'📱 Gadgets / 3C' },
  { val:'travel',       label:'✈️ Travel' },
  { val:'fine_dining',  label:'🍜 Fine Dining' },
  { val:'luxury_cars',  label:'🚗 Luxury Cars' },
  { val:'fashion',      label:'👗 Fashion' },
  { val:'watches',      label:'⌚ Watches' },
  { val:'property',     label:'🏠 Property' },
  { val:'sports_fan',   label:'🏆 Sports Fan' },
  { val:'family',       label:'👨‍👩‍👧 Family Oriented' },
  { val:'nightlife',    label:'🍸 Nightlife' },
  { val:'crypto',       label:'₿ Crypto / Finance' },
  { val:'health',       label:'💪 Health & Fitness' },
]
const PERSONALITY_OPTIONS = [
  { val:'risk_taker',          label:'🔥 Risk Taker' },
  { val:'bonus_hunter',        label:'🎁 Bonus Hunter' },
  { val:'consistent_bettor',   label:'📊 Consistent Bettor' },
  { val:'relationship_driven', label:'🤝 Relationship Driven' },
  { val:'competitive',         label:'🏅 Competitive' },
  { val:'vip_conscious',       label:'💎 VIP Conscious' },
  { val:'price_sensitive',     label:'💰 Price Sensitive' },
  { val:'big_spender',         label:'💸 Big Spender' },
  { val:'quiet_player',        label:'🤫 Quiet / Private' },
  { val:'social',              label:'😄 Social / Chatty' },
]
const RELATIONSHIP_OPTIONS = [
  { val:'cold',     label:'🥶 Cold',    color:'#60a5fa' },
  { val:'warming',  label:'🌤 Warming', color:'#fbbf24' },
  { val:'neutral',  label:'😐 Neutral', color:'var(--muted)' },
  { val:'loyal',    label:'❤️ Loyal',   color:'#34d399' },
  { val:'at_risk',  label:'⚠️ At Risk', color:'#f87171' },
]
const CHANNEL_OPTIONS = [
  { val:'whatsapp', label:'WhatsApp' },
  { val:'call',     label:'Phone Call' },
  { val:'telegram', label:'Telegram' },
  { val:'sms',      label:'SMS' },
]
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function ChipRow({ options, selected, onToggle }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
      {options.map(o => {
        const active = (selected||[]).includes(o.val)
        return (
          <button key={o.val} onClick={() => onToggle(o.val)} style={{
            fontSize:12, fontWeight:active?700:500, padding:'5px 12px', borderRadius:20,
            border: active ? '1.5px solid var(--brand)' : '1px solid var(--border)',
            background: active ? 'rgba(255,107,0,.12)' : 'var(--surface2)',
            color: active ? 'var(--brand)' : 'var(--text)',
            cursor:'pointer', transition:'all .15s',
          }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

if (profileLoading) return <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>Loading profile…</div>

const relOpt = RELATIONSHIP_OPTIONS.find(r => r.val === profileForm.relationship_level) || RELATIONSHIP_OPTIONS[2]

return (
<div style={{ maxWidth:760 }}>
  {/* Relationship & Quick Info */}
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
    {/* Relationship Level */}
    <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px' }}>
      <SectionLabel>Relationship Level</SectionLabel>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {RELATIONSHIP_OPTIONS.map(o => (
          <button key={o.val} onClick={() => setProfileForm(f=>({...f,relationship_level:o.val}))} style={{
            fontSize:12, fontWeight:profileForm.relationship_level===o.val?700:500,
            padding:'5px 12px', borderRadius:20, cursor:'pointer', transition:'all .15s',
            border: profileForm.relationship_level===o.val ? `1.5px solid ${o.color}` : '1px solid var(--border)',
            background: profileForm.relationship_level===o.val ? `${o.color}22` : 'var(--surface)',
            color: profileForm.relationship_level===o.val ? o.color : 'var(--text)',
          }}>{o.label}</button>
        ))}
      </div>
    </div>

    {/* Contact Preference */}
    <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px' }}>
      <SectionLabel>Preferred Contact</SectionLabel>
      <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:10 }}>
        {CHANNEL_OPTIONS.map(o => (
          <button key={o.val} onClick={() => setProfileForm(f=>({...f,preferred_contact_channel:o.val}))} style={{
            fontSize:12, fontWeight:profileForm.preferred_contact_channel===o.val?700:500,
            padding:'5px 12px', borderRadius:20, cursor:'pointer',
            border: profileForm.preferred_contact_channel===o.val ? '1.5px solid var(--brand)' : '1px solid var(--border)',
            background: profileForm.preferred_contact_channel===o.val ? 'rgba(255,107,0,.12)' : 'var(--surface)',
            color: profileForm.preferred_contact_channel===o.val ? 'var(--brand)' : 'var(--text)',
          }}>{o.label}</button>
        ))}
      </div>
      <input
        value={profileForm.preferred_contact_time}
        onChange={e => setProfileForm(f=>({...f,preferred_contact_time:e.target.value}))}
        placeholder="Best time (e.g. Weekday evenings 8–10pm)"
        style={{ width:'100%', fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', boxSizing:'border-box' }}
      />
    </div>
  </div>

  {/* Game Preferences */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
    <SectionLabel>Game Type Preferences</SectionLabel>
    <ChipRow
      options={GAME_OPTIONS}
      selected={profileForm.preferred_games}
      onToggle={val => toggleTag('preferred_games', val)}
    />
  </div>

  {/* Deposit Behaviour */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
    <SectionLabel>Deposit Behaviour</SectionLabel>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
      <div>
        <label style={{ fontSize:11, color:'var(--muted)', display:'block', marginBottom:4 }}>Usual Deposit Time / Pattern</label>
        <textarea
          value={profileForm.deposit_pattern}
          onChange={e => setProfileForm(f=>({...f,deposit_pattern:e.target.value}))}
          placeholder="e.g. Friday nights 9–11pm, after weekend football"
          rows={3}
          style={{ width:'100%', fontSize:12, padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', resize:'vertical', boxSizing:'border-box' }}
        />
      </div>
      <div>
        <label style={{ fontSize:11, color:'var(--muted)', display:'block', marginBottom:4 }}>What Triggers Deposit</label>
        <textarea
          value={profileForm.deposit_trigger}
          onChange={e => setProfileForm(f=>({...f,deposit_trigger:e.target.value}))}
          placeholder="e.g. Redeposits same day after big loss, or tops up after big win"
          rows={3}
          style={{ width:'100%', fontSize:12, padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', resize:'vertical', boxSizing:'border-box' }}
        />
      </div>
    </div>
  </div>

  {/* Real-Life Interests */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
    <SectionLabel>Real-Life Interests</SectionLabel>
    <ChipRow
      options={INTEREST_OPTIONS}
      selected={profileForm.interests}
      onToggle={val => toggleTag('interests', val)}
    />
  </div>

  {/* Personality Tags */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
    <SectionLabel>Personality / Betting Style</SectionLabel>
    <ChipRow
      options={PERSONALITY_OPTIONS}
      selected={profileForm.personality_tags}
      onToggle={val => toggleTag('personality_tags', val)}
    />
  </div>

  {/* VIP Since & Birthday */}
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
    <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px' }}>
      <SectionLabel>VIP Since</SectionLabel>
      <input
        type="date"
        value={profileForm.vip_since}
        onChange={e => setProfileForm(f=>({...f,vip_since:e.target.value}))}
        style={{ fontSize:13, padding:'6px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', width:'100%', boxSizing:'border-box' }}
      />
    </div>
    <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px' }}>
      <SectionLabel>Birthday (for campaigns)</SectionLabel>
      <div style={{ display:'flex', gap:8 }}>
        <select
          value={profileForm.birthday_month}
          onChange={e => setProfileForm(f=>({...f,birthday_month:e.target.value}))}
          style={{ flex:1, fontSize:13, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)' }}
        >
          <option value="">Month</option>
          {MONTHS.map((m,i) => <option key={m} value={String(i+1)}>{m}</option>)}
        </select>
        <select
          value={profileForm.birthday_day}
          onChange={e => setProfileForm(f=>({...f,birthday_day:e.target.value}))}
          style={{ flex:1, fontSize:13, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)' }}
        >
          <option value="">Day</option>
          {Array.from({length:31},(_,i)=>i+1).map(d => <option key={d} value={String(d)}>{d}</option>)}
        </select>
      </div>
    </div>
  </div>

  {/* Host Notes */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:20 }}>
    <SectionLabel>Host Notes (private)</SectionLabel>
    <textarea
      value={profileForm.host_notes}
      onChange={e => setProfileForm(f=>({...f,host_notes:e.target.value}))}
      placeholder="Anything the host knows about this VIP — family, hobbies, what gifts worked, what to avoid…"
      rows={4}
      style={{ width:'100%', fontSize:13, padding:'8px 12px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', resize:'vertical', boxSizing:'border-box' }}
    />
  </div>

  {/* Save */}
  <div style={{ display:'flex', justifyContent:'flex-end' }}>
    <Btn variant="primary" onClick={saveProfile} disabled={profileSaving}>
      {profileSaving ? 'Saving…' : '💾 Save Profile'}
    </Btn>
  </div>
</div>
)
})()}

{/* DEPT SPENDING */}
{tab === 'spending' && (() => {
function fmtExact(n, currency) {
  if (n === null || n === undefined || n === '') return '—'
  const sym = currency==='SGD'?'SGD ':currency==='USD'?'USD ':currency==='KHUSD'?'USD ':'RM '
  return sym + parseFloat(n).toLocaleString('en-MY', { minimumFractionDigits:2, maximumFractionDigits:2 })
}
// Group totals by currency
const totals = vipExpenses.reduce((acc, e) => {
  const cur = e.currency || 'MYR'
  acc[cur] = (acc[cur] || 0) + (parseFloat(e.amount) || 0)
  return acc
}, {})
const TYPE_COLOR = { online: 'var(--info)', offline: '#f59e0b' }

return (
<div>
  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
    <SectionLabel>Department Spending on {vip.username}</SectionLabel>
  </div>
  {expensesLoading ? (
    <LoadingState message="Loading spending records…" />
  ) : vipExpenses.length === 0 ? (
    <EmptyState icon="💸" title="No spending records" message="No department expenses have been linked to this VIP yet. Add expenses in the Expense Tracker and tag this player's username." />
  ) : (
    <div>
      {/* Lifetime total cards */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        {Object.entries(totals).map(([cur, total]) => (
          <div key={cur} style={{ background:'linear-gradient(135deg,rgba(249,97,103,.12),rgba(249,97,103,.05))', border:'1px solid rgba(249,97,103,.25)', borderRadius:10, padding:'14px 20px', minWidth:160 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:6 }}>Total Spent ({cur})</div>
            <div style={{ fontSize:22, fontWeight:800, color:'#f96167' }}>{fmtExact(total, cur)}</div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{vipExpenses.filter(e=>(e.currency||'MYR')===cur).length} record{vipExpenses.filter(e=>(e.currency||'MYR')===cur).length!==1?'s':''} · all time</div>
          </div>
        ))}
      </div>

      {/* Expense rows */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr>
              {['Date','Category','Item','Platform','Type','Amount','Notes'].map(h => (
                <th key={h} style={{ padding:'9px 12px', textAlign: h==='Amount'?'right':'left', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vipExpenses.map(e => (
              <tr key={e.id}
                onMouseEnter={ev => ev.currentTarget.style.background='var(--surface2)'}
                onMouseLeave={ev => ev.currentTarget.style.background='transparent'}
              >
                <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap', color:'var(--muted)', fontSize:12 }}>
                  {e.created_at ? e.created_at.slice(0,10) : '—'}
                </td>
                <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{e.category || '—'}</td>
                <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12 }}>{e.item_name || '—'}</td>
                <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                  <span style={{ fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:10, background:'var(--surface2)', color:'var(--text)' }}>{e.platform || '—'}</span>
                </td>
                <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)' }}>
                  <span style={{ fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:10, background: e.expense_type==='online'?'rgba(59,130,246,.12)':'rgba(245,158,11,.12)', color: TYPE_COLOR[e.expense_type] || 'var(--muted)' }}>
                    {e.expense_type || '—'}
                  </span>
                </td>
                <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', textAlign:'right', fontWeight:700, whiteSpace:'nowrap' }}>
                  {fmtExact(e.amount, e.currency)}
                </td>
                <td style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', color:'var(--muted)', fontSize:12, maxWidth:200 }}>
                  {e.notes || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )}
</div>
)
})()}
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
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Full Name</label>
<Input value={editForm.full_name||''} onChange={e => setEditForm(f=>({...f,full_name:e.target.value}))} placeholder="Real name" />
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Birthday</label>
<Input type="date" value={editForm.birthday||''} onChange={e => setEditForm(f=>({...f,birthday:e.target.value}))} />
</div>
</div>
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
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Email</label>
<Input value={editForm.email||''} onChange={e => setEditForm(f=>({...f,email:e.target.value}))} />
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Telegram</label>
<Input value={editForm.telegram||''} onChange={e => setEditForm(f=>({...f,telegram:e.target.value}))} placeholder="without @" />
</div>
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Address</label>
<Textarea value={editForm.address||''} onChange={e => setEditForm(f=>({...f,address:e.target.value}))} rows={2} />
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Remark</label>
<Textarea value={editForm.special_requests||''} onChange={e => setEditForm(f=>({...f,special_requests:e.target.value}))} rows={2} />
</div>
<div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginTop:4 }}>
<label style={{ fontSize:12, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:10, textTransform:'uppercase', letterSpacing:'.5px' }}>T&G Verification</label>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
  <div>
    <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Verified Name</label>
    <Input value={editForm.tng_verified_name||''} onChange={e => setEditForm(f=>({...f,tng_verified_name:e.target.value}))} placeholder="Name from T&G" />
  </div>
  <div>
    <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Status</label>
    <Select value={editForm.tng_verify_status||''} onChange={e => setEditForm(f=>({...f,tng_verify_status:e.target.value}))}>
      <option value="">— Not checked —</option>
      <option value="verified">✓ Verified (name matches)</option>
      <option value="mismatch">⚠ Mismatch (name differs)</option>
      <option value="pending">Pending</option>
    </Select>
  </div>
</div>
<div style={{ marginTop:10 }}>
  <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>Date Checked</label>
  <Input type="date" value={editForm.tng_verified_at||''} onChange={e => setEditForm(f=>({...f,tng_verified_at:e.target.value}))} style={{ maxWidth:180 }} />
</div>
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
