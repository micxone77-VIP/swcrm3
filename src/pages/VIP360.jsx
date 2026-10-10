// src/pages/VIP360.jsx — VIP 360 (V2) — replaces VIPDetail.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatMoney, fmtDate } from '../lib/format'
import { TIER_CONFIG, STATUS_CONFIG, RISK_CONFIG, CONTACT_TYPE, CONTACT_OUTCOME, enumLabel } from '../lib/enums'
import {
Card, CardHeader, CardBody, Tabs, Btn, Badge,
LoadingState, ErrorState, EmptyState, Modal,
Input, Select, Textarea, useToast,
} from '../components/ui'
import { TierBadge, StatusBadge, RiskBadge } from '../components/ui'
import { callAI } from '../lib/aiApi'
import { useLanguage } from '../contexts/LanguageContext'
import DepositProfileCard from '../components/vip/DepositProfileCard'

const TIERS = ['BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','BLACK']
const PERIODS = [
{ value: '30', label: '30D', zh: '30天' },
{ value: 'mtd', label: 'MTD', zh: '本月' },
{ value: '90', label: '90D', zh: '90天' },
{ value: '180', label: '6M', zh: '6个月' },
{ value: '365', label: '1Y', zh: '1年' },
]

function timeAgo(d, lang = 'en') {
if (!d) return '—'
const diff = Math.floor((Date.now() - new Date(d)) / 1000)
const zh = lang === 'zh'
if (diff < 60) return zh ? '刚刚' : 'just now'
if (diff < 3600) return Math.floor(diff/60) + (zh ? '分钟前' : 'm ago')
if (diff < 86400) return Math.floor(diff/3600) + (zh ? '小时前' : 'h ago')
if (diff < 86400*30) return Math.floor(diff/86400) + (zh ? '天前' : 'd ago')
return fmtDate(d, lang)
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
const { t, lang } = useLanguage()
const L2 = (en, zh) => (lang === 'zh' ? zh : en)
const ago = d => timeAgo(d, lang)

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
if (err) { toast(L2('Error: ', '错误：') + err.message, 'error'); return }
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
if (err) { toast(L2('Error: ', '错误：') + err.message, 'error'); return }
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
} catch(e) { toast(L2('AI unavailable', 'AI 不可用'), 'error') }
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
if (err) { toast(L2('Error: ', '错误：') + err.message, 'error'); return }
toast(L2('Profile saved ✓', '档案已保存 ✓'), 'success')
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
{ key: 'gaming', label: L2('🎮 Gaming', '🎮 游戏') },
{ key: 'profile', label: L2('👤 Profile', '👤 档案') },
{ key: 'activity', label: t('vip360.tabActivity') },
{ key: 'campaigns', label: t('vip360.tabCampaigns'), count: campaigns.length },
{ key: 'contact', label: t('vip360.tabContact'), count: contacts.length },
{ key: 'calendar', label: t('vip360.tabCalendar') },
{ key: 'notes', label: t('vip360.tabNotes') },
{ key: 'insights', label: t('vip360.tabInsights') },
{ key: 'spending', label: L2('💸 Dept Spending', '💸 部门开支') },
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
title={L2('Copy username', '复制用户名')}
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
{vip.host_assigned && <span> · {L2('Host', '负责人')}: {vip.host_assigned}</span>}
{vip.affiliate_login && <span> · {L2('Affiliate', '代理')}: <b style={{ color:'var(--brand)' }}>{vip.affiliate_login}</b></span>}
{vip.currency && <span> · {vip.currency}</span>}
</div>
{gamingLabel && (
<div style={{ marginTop:6 }}>
  <span
    onClick={() => setTab('gaming')}
    title={L2('Click to view Gaming tab', '点击查看游戏分页')}
    style={{
      display:'inline-flex', alignItems:'center', gap:5,
      fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, cursor:'pointer',
      background:'rgba(139,92,246,.15)', border:'1px solid rgba(139,92,246,.35)', color:'#a78bfa',
    }}
  >
    {gamingLabel.player_type_icon} {lang === 'zh' ? ({ 'Slots King':'老虎机之王','Live Casino VIP':'真人娱乐VIP','Sports Punter':'体育投注玩家','Slots + Live':'老虎机 + 真人','Live + Sports':'真人 + 体育','Multi-Platform':'多平台','Casual':'休闲' }[gamingLabel.player_type] || gamingLabel.player_type) : gamingLabel.player_type}
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
{ label:L2('Deposit', '存款'), value:formatMoney(sumDeposit, vip.currency), trend:null },
{ label:L2('Turnover', '流水'), value:formatMoney(sumTurnover, vip.currency), trend:null },
{ label:L2('Win/Loss', '输赢'), value:formatMoney(Math.abs(sumWL), vip.currency), isWL:true, wl:sumWL },
{ label:L2('Last Deposit', '最后存款'), value:daysInactive != null ? L2(`${daysInactive}d ago`, `${daysInactive}天前`) : '—', sub:vip.last_deposit_date ? fmtDate(vip.last_deposit_date, lang) : null },
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
}}>{L2(p.label, p.zh)}</button>
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
<>
<DepositProfileCard username={vip.username} />
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
{/* Left: profile summary */}
<div>
<SectionLabel>{L2('Profile', '档案')}</SectionLabel>
<Field label={L2('Username', '用户名')}>{vip.username}</Field>
<Field label={L2('Full Name', '全名')}>{vip.full_name}</Field>
<Field label={L2('Tier', '等级')}><TierBadge tier={vip.tier} /></Field>
<Field label={L2('Status', '状态')}><StatusBadge status={vip.activity_status} /></Field>
<Field label={L2('Risk', '风险')}><RiskBadge risk={vip.churn_risk} /></Field>
<Field label={L2('Region', '地区')}>{vip.region}</Field>
<Field label={L2('Currency', '货币')}>{vip.currency}</Field>
<Field label={L2('Host', '负责人')}>{vip.host_assigned}</Field>
<Field label={L2('Affiliate', '代理')}>{vip.affiliate_login ? vip.affiliate_login : vip.affiliate_updated_at ? L2('Direct (no affiliate)', '直客（无代理）') : '—'}</Field>
<Field label={L2('Phone', '电话')}>{vip.phone}</Field>
<Field label={L2('WhatsApp', 'WhatsApp')}>{vip.whatsapp}</Field>
<Field label={L2('Email', '电邮')}>{vip.email}</Field>
<Field label={L2('Telegram', 'Telegram')}>{vip.telegram ? `@${vip.telegram}` : '—'}</Field>
<Field label={L2('Address', '地址')}>{vip.address}</Field>
<Field label={L2('Remark', '备注')}>{vip.special_requests}</Field>
<Field label={L2('Birthday', '生日')}>{vip.birthday ? fmtDate(vip.birthday, lang) : '—'}</Field>
<Field label={L2('Registered', '注册日期')}>{fmtDate(vip.registration_date || vip.created_at, lang)}</Field>
<Field label={L2('T&G Verify', 'T&G 验证')}>
  {vip.tng_verify_status === 'verified' ? (
    <span style={{ color:'#3fb950', fontWeight:700 }}>✓ {L2('Verified', '已验证')} — {vip.tng_verified_name || '—'}</span>
  ) : vip.tng_verify_status === 'mismatch' ? (
    <span style={{ color:'#d29922', fontWeight:700 }}>⚠ {L2('Mismatch', '不匹配')} — {vip.tng_verified_name || '—'}</span>
  ) : (
    <span style={{ color:'var(--muted)' }}>{L2('Not checked', '未检查')}</span>
  )}
  {vip.tng_verified_at && <span style={{ fontSize:11, color:'var(--muted)', marginLeft:8 }}>({fmtDate(vip.tng_verified_at, lang)})</span>}
</Field>
</div>
{/* Right: recent activity */}
<div>
<SectionLabel>{L2('Recent Activity', '近期活动')}</SectionLabel>
{contacts.slice(0,5).length === 0 ? (
<EmptyState icon="📋" title={L2('No activity yet', '暂无活动')} />
) : contacts.slice(0,5).map(c => (
<div key={c.id} style={{ borderBottom:'1px solid var(--border)', padding:'10px 0' }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
<span style={{ fontSize:13, fontWeight:600 }}>{enumLabel(c.channel || c.outcome, lang) || L2('Contact', '联系')}</span>
<span style={{ fontSize:11, color:'var(--muted)' }}>{ago(c.logged_at)}</span>
</div>
{(c.notes || c.outcome) && (
<div style={{ fontSize:12, color:'var(--muted)', marginTop:3 }}>{enumLabel(c.outcome, lang)}{c.notes ? ' — ' + c.notes : ''}</div>
)}
{c.host_name && <div style={{ fontSize:11, color:'var(--disabled)', marginTop:2 }}>{L2('by', '由')} {c.host_name}</div>}
</div>
))}
{contacts.length > 5 && (
<Btn size="sm" variant="link" onClick={() => setTab('contact')}>{L2(`View all ${contacts.length} contacts →`, `查看全部 ${contacts.length} 条联系 →`)}</Btn>
)}
</div>
</div>
</>
)}

{/* FINANCIAL */}
{tab === 'financial' && (
<div>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
<SectionLabel>{L2('Financial History', '财务记录')}</SectionLabel>
<div style={{ display:'flex', gap:4 }}>
{PERIODS.map(p => (
<button key={p.value} onClick={() => setPeriod(p.value)} style={{
fontSize:12, fontWeight:700, padding:'4px 10px', borderRadius:6, border:'none',
background: period===p.value ? 'var(--brand)' : 'var(--surface2)',
color: period===p.value ? '#fff' : 'var(--muted)', cursor:'pointer',
}}>{L2(p.label, p.zh)}</button>
))}
</div>
</div>
{monthly.length === 0 ? (
<EmptyState icon="💰" title={L2('No financial data', '暂无财务数据')} message={L2('No monthly totals found for this VIP.', '未找到此VIP的月度汇总。')} />
) : (
<div style={{ overflowX:'auto' }}>
<table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
<thead>
<tr>
{[['Month','月份'],['Deposit','存款'],['Withdrawal','提款'],['Turnover','流水'],['Win/Loss','输赢'],['Rebate','返水']].map(([h, hz]) => (
<th key={h} style={{ padding:'9px 12px', textAlign: h==='Month'?'left':'right', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)' }}
>{L2(h, hz)}</th>
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
const CAT_LABEL = lang === 'zh' ? { live:'真人娱乐', slots:'老虎机', sports:'体育', other:'其他' } : { live:'Live Casino', slots:'Slots', sports:'Sports', other:'Other' }
const PT_ZH = { 'Slots King':'老虎机之王','Live Casino VIP':'真人娱乐VIP','Sports Punter':'体育投注玩家','Slots + Live':'老虎机 + 真人','Live + Sports':'真人 + 体育','Multi-Platform':'多平台','Casual':'休闲' }
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
    <LoadingState message={L2('Loading gaming data…', '载入游戏数据中…')} />
  ) : gaming.length === 0 ? (
    <EmptyState icon="🎮" title={L2('No gaming data', '暂无游戏数据')} message={L2('No provider stats found for this player. Upload gaming data via CSV Import.', '未找到此玩家的供应商数据。请通过CSV导入上传游戏数据。')} />
  ) : (
    <div>
      {/* Player Type Badge + Category Summary */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
        {/* Player Type */}
        <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:10 }}>{L2('Player Type', '玩家类型')}</div>
          {gl ? (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                <span style={{ fontSize:28 }}>{gl.player_type_icon}</span>
                <span style={{ fontSize:18, fontWeight:800, color: ptColor }}>{lang === 'zh' ? (PT_ZH[gl.player_type] || gl.player_type) : gl.player_type}</span>
              </div>
              <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>
                {gl.snapshot_month} · {L2(`${gl.active_providers} active provider${gl.active_providers !== 1 ? 's':''}`, `${gl.active_providers} 个活跃供应商`)}</div>
              {/* Category bars */}
              {[
                { label:CAT_LABEL.slots, pct: gl.slots_pct, color: CAT_COLOR.slots },
                { label:CAT_LABEL.live, pct: gl.live_pct, color: CAT_COLOR.live },
                { label:CAT_LABEL.sports, pct: gl.sports_pct, color: CAT_COLOR.sports },
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
            <div style={{ fontSize:13, color:'var(--muted)' }}>{L2('Label not yet computed. Run the SQL migration first.', '标签尚未计算。请先运行SQL迁移。')}</div>
          )}
        </div>

        {/* Good at / Bad at */}
        <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:10 }}>{L2('Strengths & Weaknesses', '强项与弱项')}</div>
          {gl?.best_provider && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:'var(--success)', fontWeight:700, marginBottom:4 }}>{L2('✅ Best at (player wins)', '✅ 强项（玩家赢）')}</div>
              <div style={{ fontSize:14, fontWeight:700 }}>{gl.best_provider}</div>
              <div style={{ fontSize:11, color:'var(--muted)' }}>
                {CAT_ICON[getCat(gl.best_provider)]} {CAT_LABEL[getCat(gl.best_provider)]}
              </div>
            </div>
          )}
          {gl?.worst_provider && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:'var(--danger)', fontWeight:700, marginBottom:4 }}>{L2('⚠️ Worst at (house wins most)', '⚠️ 弱项（庄家赢最多）')}</div>
              <div style={{ fontSize:14, fontWeight:700 }}>{gl.worst_provider}</div>
              <div style={{ fontSize:11, color:'var(--muted)' }}>
                {CAT_ICON[getCat(gl.worst_provider)]} {CAT_LABEL[getCat(gl.worst_provider)]}
              </div>
            </div>
          )}
          {!gl?.best_provider && !gl?.worst_provider && (
            <div style={{ fontSize:13, color:'var(--muted)' }}>{L2('No win/loss data available yet.', '暂无输赢数据。')}</div>
          )}
          {gl?.top_providers && (
            <div style={{ marginTop:4 }}>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:700, marginBottom:4 }}>{L2('TOP PROVIDERS (by turnover)', '主要供应商（按流水）')}</div>
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
              <div style={{ fontSize:11, fontWeight:700, color:'var(--info)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:6 }}>{L2('💡 Suggested Offer', '💡 建议优惠')}</div>
              <div style={{ fontSize:13, fontWeight:500 }}>{gl.offer_recommendation}</div>
            </div>
            <Btn size="sm" variant="secondary" onClick={getGamingAI} disabled={gamingAILoading} style={{ flexShrink:0 }}>
              {gamingAILoading ? L2('Thinking…', '思考中…') : L2('🤖 AI Recommendation', '🤖 AI 建议')}
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
        <SectionLabel>{L2('Provider Breakdown', '供应商明细')}</SectionLabel>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                {[['Provider','供应商'],['Category','类别'],['Turnover','流水'],['Win/Loss','输赢'],['Rebate','返水'],['Bonus','奖励'],['Sessions','场次']].map(([h, hz]) => (
                  <th key={h} style={{ padding:'8px 10px', textAlign: h==='Provider'||h==='Category'?'left':'right', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)' }}>{L2(h, hz)}</th>
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
<SectionLabel>{L2('Activity Timeline', '活动时间线')}</SectionLabel>
<Btn size="sm" variant="primary" onClick={() => setShowLog(true)}>{L2('+ Log Contact', '+ 记录联系')}</Btn>
</div>
{contacts.length === 0 ? (
<EmptyState icon="📋" title={L2('No activity yet', '暂无活动')} message={L2('Log the first contact to start the timeline.', '记录第一次联系以开始时间线。')} />
) : contacts.map(c => (
<div key={c.id} style={{ borderBottom:'1px solid var(--border)', padding:'12px 0', display:'flex', gap:12 }}>
<div style={{ width:36, height:36, borderRadius:'50%', background:'var(--surface2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
{c.channel === 'WhatsApp' ? '💬' : c.channel === 'Call' ? '📞' : '📋'}
</div>
<div style={{ flex:1 }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
<div style={{ fontSize:13, fontWeight:600 }}>{c.channel ? enumLabel(c.channel, lang) : L2('Contact', '联系')}</div>
<div style={{ fontSize:11, color:'var(--muted)' }}>{ago(c.logged_at)}</div>
</div>
<div style={{ fontSize:12, marginTop:3 }}>
<span style={{
fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:10,
background: c.outcome==='Deposited'||c.outcome==='Reactivated' ? 'rgba(34,197,94,.15)' : c.outcome==='No Reply' ? 'rgba(239,68,68,.12)' : 'var(--surface2)',
color: c.outcome==='Deposited'||c.outcome==='Reactivated' ? 'var(--success)' : c.outcome==='No Reply' ? 'var(--danger)' : 'var(--muted)',
marginRight:8,
}}>{enumLabel(c.outcome, lang)}</span>
{c.notes}
</div>
{c.host_name && <div style={{ fontSize:11, color:'var(--disabled)', marginTop:3 }}>{L2('by', '由')} {c.host_name}{c.wa_number_used && <span style={{ marginLeft:8, color:'#25d366', fontWeight:600 }}>📱 {c.wa_number_used}</span>}</div>}
</div>
</div>
))}
</div>
)}

{/* CAMPAIGNS */}
{tab === 'campaigns' && (
<div>
<SectionLabel>{L2('Campaign Participation', '活动参与')}</SectionLabel>
{campaigns.length === 0 ? (
<EmptyState icon="📢" title={L2('No campaigns', '暂无活动')} message={L2('This VIP has not joined any campaigns.', '此VIP尚未参加任何活动。')} />
) : campaigns.map(cp => (
<div key={cp.id} style={{ borderBottom:'1px solid var(--border)', padding:'12px 0' }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
<div>
<div style={{ fontSize:13, fontWeight:600 }}>{cp.campaigns?.campaign_name || L2('Campaign', '活动')}</div>
<div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
{L2('Joined', '加入于')} {fmtDate(cp.added_at, lang)}
{cp.campaigns?.start_date && ` · ${fmtDate(cp.campaigns.start_date, lang)} – ${fmtDate(cp.campaigns.end_date, lang)}`}
</div>
</div>
<span style={{
fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:20,
background: cp.campaigns?.status==='Active' ? 'rgba(34,197,94,.12)' : 'var(--surface2)',
color: cp.campaigns?.status==='Active' ? 'var(--success)' : 'var(--muted)',
}}>{enumLabel(cp.campaigns?.status, lang) || '—'}</span>
</div>
</div>
))}
</div>
)}

{/* CONTACT */}
{tab === 'contact' && (
<div>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
<SectionLabel>{L2('Contact History', '联系记录')}</SectionLabel>
<Btn size="sm" variant="primary" onClick={() => setShowLog(true)}>{L2('+ Log Contact', '+ 记录联系')}</Btn>
</div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
<Field label={L2('Phone', '电话')}>{vip.phone || '—'}</Field>
<Field label={L2('WhatsApp', 'WhatsApp')}>{vip.whatsapp || '—'}</Field>
<Field label={L2('Email', '电邮')}>{vip.email || '—'}</Field>
<Field label={L2('Telegram', 'Telegram')}>{vip.telegram ? `@${vip.telegram}` : '—'}</Field>
<Field label={L2('Address', '地址')}>{vip.address || '—'}</Field>
<Field label={L2('Remark', '备注')}>{vip.special_requests || '—'}</Field>
</div>
{contacts.length === 0 ? (
<EmptyState icon="📞" title={L2('No contact records', '暂无联系记录')} message={L2('No contact logs found for this VIP.', '未找到此VIP的联系记录。')} />
) : contacts.map(c => (
<div key={c.id} style={{ borderBottom:'1px solid var(--border)', padding:'10px 0' }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
<span style={{ fontSize:13, fontWeight:600 }}>{c.channel ? enumLabel(c.channel, lang) : L2('Contact', '联系')}</span>
<span style={{ fontSize:11, color:'var(--muted)' }}>{ago(c.logged_at)}</span>
</div>
<div style={{ fontSize:12, color:'var(--muted)', marginTop:3 }}>{enumLabel(c.outcome, lang)}{c.notes?' — '+c.notes:''}</div>
{c.host_name && <div style={{ fontSize:11, color:'var(--disabled)', marginTop:2 }}>{L2('by', '由')} {c.host_name}</div>}
</div>
))}
</div>
)}

{/* NOTES */}
{tab === 'notes' && (
<div>
<SectionLabel>{L2('Internal Notes', '内部备注')}</SectionLabel>
{vip.notes ? (
<div style={{ background:'var(--surface2)', borderRadius:8, padding:14, fontSize:13, lineHeight:1.6, whiteSpace:'pre-wrap' }}>
{vip.notes}
</div>
) : (
<EmptyState icon="📝" title={L2('No notes', '暂无备注')} message={L2('Notes added about this VIP will appear here.', '关于此VIP的备注将显示在这里。')} />
)}
{profile?.role !== 'readonly' && (
<div style={{ marginTop:14 }}>
<Btn variant="secondary" size="sm" onClick={() => setShowEdit(true)}>{L2('Edit Notes', '编辑备注')}</Btn>
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
const monthName = lang === 'zh' ? `${y}年${m}月` : new Date(y, m-1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
return (
<div>
{/* Header + nav */}
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
<div style={{ fontSize:13, fontWeight:800, letterSpacing:'.3px' }}>📅 {L2(`${monthName.toUpperCase()} DEPOSIT RECORDS`, `${monthName} 存款记录`)}</div>
<div style={{ display:'flex', gap:6 }}>
<Btn size="sm" variant="ghost" onClick={prevMonth}>‹</Btn>
<Btn size="sm" variant="ghost" onClick={nextMonth}>›</Btn>
</div>
</div>
{/* Stats */}
<div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
{[
{ label: L2(`${calMonth} Deposit Days`, `${calMonth} 存款天数`), value: L2(`${depositDays}/${daysInMonth} days`, `${depositDays}/${daysInMonth} 天`), color:'var(--success)' },
{ label: L2('Turnover Only, No Deposit', '仅流水，无存款'), value: turnoverOnlyDays, color:'#c9a961' },
{ label: L2(`${calMonth} Deposit`, `${calMonth} 存款`), value: 'RM '+fmtK(totalDeposit), color:'var(--text)' },
{ label: L2(`${calMonth} Valid Bet`, `${calMonth} 有效投注`), value: 'RM '+fmtK(totalBet), color:'var(--muted)' },
].map(s => (
<div key={s.label} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 14px' }}>
<div style={{ fontSize:17, fontWeight:800, color:s.color }}>{s.value}</div>
<div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{s.label}</div>
</div>
))}
</div>
<div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:18 }}>
{[
{ label: L2(`${calMonth} Active Rate`, `${calMonth} 活跃率`), value: Math.round(activeDays/daysInMonth*100)+'%', color: activeDays/daysInMonth >= 0.5 ? 'var(--success)' : 'var(--warning)' },
{ label: L2(`${calMonth} Deposit Rate`, `${calMonth} 存款率`), value: Math.round(depositDays/daysInMonth*100)+'%', color:'var(--success)' },
{ label: L2(`${calMonth} Withdrawal Rate`, `${calMonth} 提款率`), value: Math.round(withdrawalDays/daysInMonth*100)+'%', color:'var(--danger)' },
].map(s => (
<div key={s.label} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 14px' }}>
<div style={{ fontSize:17, fontWeight:800, color:s.color }}>{s.value}</div>
<div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{s.label}</div>
</div>
))}
</div>
{/* Legend */}
<div style={{ display:'flex', gap:16, marginBottom:12, fontSize:11, color:'var(--muted)' }}>
<span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, borderRadius:3, background:'rgba(34,197,94,.85)', display:'inline-block' }}></span>{L2('Deposited', '已存款')}</span>
<span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, borderRadius:3, background:'rgba(201,169,97,.85)', display:'inline-block' }}></span>{L2('Turnover only', '仅流水')}</span>
<span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, borderRadius:3, background:'var(--surface2)', border:'1px solid var(--border)', display:'inline-block' }}></span>{L2('Absent', '无活动')}</span>
</div>
{/* Calendar grid */}
{calLoading ? <LoadingState /> : (
<div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
<div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:'1px solid var(--border)' }}>
{(lang === 'zh' ? ['周日','周一','周二','周三','周四','周五','周六'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']).map(d => (
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
<div key={d} title={row ? L2(`Deposit: RM${dep} · Bet: RM${fmtK(bet)}`, `存款: RM${dep} · 投注: RM${fmtK(bet)}`) : L2('No activity', '无活动')}
style={{ background:bg, borderRadius:6, padding:'8px 4px', textAlign:'center', minHeight:52, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2,
outline: isToday ? '2px solid var(--accent)' : 'none', outlineOffset:'-2px' }}>
<div style={{ fontSize:12, fontWeight:700, color: isToday && !row ? 'var(--accent)' : textColor }}>{d}</div>
{isDeposit && <div style={{ fontSize:9, fontWeight:600, color:'rgba(255,255,255,.9)' }}>+{fmtK(dep)}</div>}
{isTurnover && <div style={{ fontSize:9, fontWeight:600, color:'rgba(255,255,255,.9)' }}>{L2('bet', '投注')}</div>}
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
<SectionLabel>{L2('AI Insights', 'AI 洞察')}</SectionLabel>
<div style={{ background:'var(--surface2)', borderRadius:8, padding:14, marginBottom:16 }}>
<div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', marginBottom:8, letterSpacing:'.4px' }}>{L2('SYSTEM FACTS', '系统数据')}</div>
<div style={{ fontSize:13, lineHeight:1.6 }}>
<div>{L2('Tier', '等级')}: <strong>{vip.tier}</strong> · {L2('Status', '状态')}: <strong>{enumLabel(vip.activity_status, lang)}</strong> · {L2('Risk', '风险')}: <strong>{enumLabel(vip.churn_risk, lang)}</strong></div>
<div>{L2('Days inactive', '不活跃天数')}: <strong>{daysInactive != null ? daysInactive + L2('d', '天') : '—'}</strong></div>
<div>{L2('Total deposit', '总存款')}: <strong>{formatMoney(vip.total_deposit, vip.currency)}</strong></div>
<div>{L2('Last deposit', '最后存款')}: <strong>{fmtDate(vip.last_deposit_date, lang)}</strong></div>
<div>{L2('Last contact', '最后联系')}: <strong>{fmtDate(vip.last_contacted || vip.last_contact_date, lang)}</strong></div>
</div>
</div>

{aiInsight ? (
<div style={{ background:'rgba(59,130,246,.08)', border:'1px solid rgba(59,130,246,.2)', borderRadius:8, padding:14 }}>
<div style={{ fontSize:11, fontWeight:700, color:'var(--info)', marginBottom:8, letterSpacing:'.4px' }}>{L2('AI INSIGHT', 'AI 洞察')}</div>
<div style={{ fontSize:13, lineHeight:1.6, whiteSpace:'pre-wrap' }}>{aiInsight}</div>
</div>
) : (
<div style={{ textAlign:'center', padding:'24px 0' }}>
<Btn variant="secondary" onClick={getAIInsight} disabled={aiLoading}>
{aiLoading ? t('vip360.aiLoading') : t('vip360.getInsight')}
</Btn>
<div style={{ fontSize:11, color:'var(--muted)', marginTop:8 }}>
{L2('AI insights are labeled and separate from confirmed CRM data.', 'AI 洞察已标注，并与已确认的CRM数据分开。')}
</div>
</div>
)}
</div>
)}

{/* PROFILE & INTERESTS */}
{tab === 'profile' && (() => {
const GAME_OPTIONS = [
  { val:'slots',        label:L2('🎰 Slots', '🎰 老虎机') },
  { val:'live_casino',  label:L2('🃏 Live Casino', '🃏 真人娱乐') },
  { val:'sports',       label:L2('⚽ Sports Betting', '⚽ 体育投注') },
  { val:'fishing',      label:L2('🎣 Fishing', '🎣 捕鱼') },
  { val:'poker',        label:L2('♠️ Poker', '♠️ 扑克') },
  { val:'esports',      label:L2('🕹️ E-Sports', '🕹️ 电竞') },
  { val:'arcade',       label:L2('🕹 Arcade', '🕹 街机') },
  { val:'mixed',        label:L2('🎲 Mixed / All', '🎲 混合 / 全部') },
]
const INTEREST_OPTIONS = [
  { val:'gadgets_3c',   label:L2('📱 Gadgets / 3C', '📱 电子产品 / 3C') },
  { val:'travel',       label:L2('✈️ Travel', '✈️ 旅行') },
  { val:'fine_dining',  label:L2('🍜 Fine Dining', '🍜 美食') },
  { val:'luxury_cars',  label:L2('🚗 Luxury Cars', '🚗 豪车') },
  { val:'fashion',      label:L2('👗 Fashion', '👗 时尚') },
  { val:'watches',      label:L2('⌚ Watches', '⌚ 手表') },
  { val:'property',     label:L2('🏠 Property', '🏠 房产') },
  { val:'sports_fan',   label:L2('🏆 Sports Fan', '🏆 体育迷') },
  { val:'family',       label:L2('👨‍👩‍👧 Family Oriented', '👨‍👩‍👧 顾家') },
  { val:'nightlife',    label:L2('🍸 Nightlife', '🍸 夜生活') },
  { val:'crypto',       label:L2('₿ Crypto / Finance', '₿ 加密货币 / 金融') },
  { val:'health',       label:L2('💪 Health & Fitness', '💪 健康健身') },
]
const PERSONALITY_OPTIONS = [
  { val:'risk_taker',          label:L2('🔥 Risk Taker', '🔥 爱冒险') },
  { val:'bonus_hunter',        label:L2('🎁 Bonus Hunter', '🎁 奖励猎人') },
  { val:'consistent_bettor',   label:L2('📊 Consistent Bettor', '📊 稳定投注') },
  { val:'relationship_driven', label:L2('🤝 Relationship Driven', '🤝 重视关系') },
  { val:'competitive',         label:L2('🏅 Competitive', '🏅 好胜') },
  { val:'vip_conscious',       label:L2('💎 VIP Conscious', '💎 重视VIP身份') },
  { val:'price_sensitive',     label:L2('💰 Price Sensitive', '💰 价格敏感') },
  { val:'big_spender',         label:L2('💸 Big Spender', '💸 大手笔') },
  { val:'quiet_player',        label:L2('🤫 Quiet / Private', '🤫 安静 / 低调') },
  { val:'social',              label:L2('😄 Social / Chatty', '😄 健谈 / 爱社交') },
]
const RELATIONSHIP_OPTIONS = [
  { val:'cold',     label:L2('🥶 Cold', '🥶 冷淡'),    color:'#60a5fa' },
  { val:'warming',  label:L2('🌤 Warming', '🌤 升温'), color:'#fbbf24' },
  { val:'neutral',  label:L2('😐 Neutral', '😐 一般'), color:'var(--muted)' },
  { val:'loyal',    label:L2('❤️ Loyal', '❤️ 忠诚'),   color:'#34d399' },
  { val:'at_risk',  label:L2('⚠️ At Risk', '⚠️ 有风险'), color:'#f87171' },
]
const CHANNEL_OPTIONS = [
  { val:'whatsapp', label:'WhatsApp' },
  { val:'call',     label:L2('Phone Call', '电话') },
  { val:'telegram', label:'Telegram' },
  { val:'sms',      label:L2('SMS', '短信') },
]
const MONTHS = lang === 'zh' ? ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'] : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

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

if (profileLoading) return <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>{L2('Loading profile…', '载入档案中…')}</div>

const relOpt = RELATIONSHIP_OPTIONS.find(r => r.val === profileForm.relationship_level) || RELATIONSHIP_OPTIONS[2]

return (
<div style={{ maxWidth:760 }}>
  {/* Relationship & Quick Info */}
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
    {/* Relationship Level */}
    <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px' }}>
      <SectionLabel>{L2('Relationship Level', '关系等级')}</SectionLabel>
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
      <SectionLabel>{L2('Preferred Contact', '偏好联系方式')}</SectionLabel>
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
        placeholder={L2('Best time (e.g. Weekday evenings 8–10pm)', '最佳时间（例如：平日晚上8–10点）')}
        style={{ width:'100%', fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', boxSizing:'border-box' }}
      />
    </div>
  </div>

  {/* Game Preferences */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
    <SectionLabel>{L2('Game Type Preferences', '游戏类型偏好')}</SectionLabel>
    <ChipRow
      options={GAME_OPTIONS}
      selected={profileForm.preferred_games}
      onToggle={val => toggleTag('preferred_games', val)}
    />
  </div>

  {/* Deposit Behaviour */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
    <SectionLabel>{L2('Deposit Behaviour', '存款行为')}</SectionLabel>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
      <div>
        <label style={{ fontSize:11, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Usual Deposit Time / Pattern', '惯常存款时间 / 模式')}</label>
        <textarea
          value={profileForm.deposit_pattern}
          onChange={e => setProfileForm(f=>({...f,deposit_pattern:e.target.value}))}
          placeholder={L2('e.g. Friday nights 9–11pm, after weekend football', '例如：周五晚上9–11点，周末足球赛后')}
          rows={3}
          style={{ width:'100%', fontSize:12, padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', resize:'vertical', boxSizing:'border-box' }}
        />
      </div>
      <div>
        <label style={{ fontSize:11, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('What Triggers Deposit', '存款触发因素')}</label>
        <textarea
          value={profileForm.deposit_trigger}
          onChange={e => setProfileForm(f=>({...f,deposit_trigger:e.target.value}))}
          placeholder={L2('e.g. Redeposits same day after big loss, or tops up after big win', '例如：大输后当天再存款，或大赢后加码')}
          rows={3}
          style={{ width:'100%', fontSize:12, padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', resize:'vertical', boxSizing:'border-box' }}
        />
      </div>
    </div>
  </div>

  {/* Real-Life Interests */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
    <SectionLabel>{L2('Real-Life Interests', '生活兴趣')}</SectionLabel>
    <ChipRow
      options={INTEREST_OPTIONS}
      selected={profileForm.interests}
      onToggle={val => toggleTag('interests', val)}
    />
  </div>

  {/* Personality Tags */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
    <SectionLabel>{L2('Personality / Betting Style', '性格 / 投注风格')}</SectionLabel>
    <ChipRow
      options={PERSONALITY_OPTIONS}
      selected={profileForm.personality_tags}
      onToggle={val => toggleTag('personality_tags', val)}
    />
  </div>

  {/* VIP Since & Birthday */}
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
    <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px' }}>
      <SectionLabel>{L2('VIP Since', 'VIP 起始日')}</SectionLabel>
      <input
        type="date"
        value={profileForm.vip_since}
        onChange={e => setProfileForm(f=>({...f,vip_since:e.target.value}))}
        style={{ fontSize:13, padding:'6px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', width:'100%', boxSizing:'border-box' }}
      />
    </div>
    <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px' }}>
      <SectionLabel>{L2('Birthday (for campaigns)', '生日（用于活动）')}</SectionLabel>
      <div style={{ display:'flex', gap:8 }}>
        <select
          value={profileForm.birthday_month}
          onChange={e => setProfileForm(f=>({...f,birthday_month:e.target.value}))}
          style={{ flex:1, fontSize:13, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)' }}
        >
          <option value="">{L2('Month', '月')}</option>
          {MONTHS.map((m,i) => <option key={m} value={String(i+1)}>{m}</option>)}
        </select>
        <select
          value={profileForm.birthday_day}
          onChange={e => setProfileForm(f=>({...f,birthday_day:e.target.value}))}
          style={{ flex:1, fontSize:13, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)' }}
        >
          <option value="">{L2('Day', '日')}</option>
          {Array.from({length:31},(_,i)=>i+1).map(d => <option key={d} value={String(d)}>{d}</option>)}
        </select>
      </div>
    </div>
  </div>

  {/* Host Notes */}
  <div style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px', marginBottom:20 }}>
    <SectionLabel>{L2('Host Notes (private)', '负责人备注（私密）')}</SectionLabel>
    <textarea
      value={profileForm.host_notes}
      onChange={e => setProfileForm(f=>({...f,host_notes:e.target.value}))}
      placeholder={L2('Anything the host knows about this VIP — family, hobbies, what gifts worked, what to avoid…', '负责人对此VIP的了解 — 家庭、爱好、哪些礼物有效、应避免什么…')}
      rows={4}
      style={{ width:'100%', fontSize:13, padding:'8px 12px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', resize:'vertical', boxSizing:'border-box' }}
    />
  </div>

  {/* Save */}
  <div style={{ display:'flex', justifyContent:'flex-end' }}>
    <Btn variant="primary" onClick={saveProfile} disabled={profileSaving}>
      {profileSaving ? L2('Saving…', '保存中…') : L2('💾 Save Profile', '💾 保存档案')}
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
    <SectionLabel>{L2('Department Spending on', '部门开支 —')} {vip.username}</SectionLabel>
  </div>
  {expensesLoading ? (
    <LoadingState message={L2('Loading spending records…', '载入开支记录中…')} />
  ) : vipExpenses.length === 0 ? (
    <EmptyState icon="💸" title={L2('No spending records', '暂无开支记录')} message={L2('No department expenses have been linked to this VIP yet. Add expenses in the Expense Tracker and tag this player\'s username.', '尚无部门开支关联到此VIP。请在开支追踪中添加开支并标记此玩家的用户名。')} />
  ) : (
    <div>
      {/* Lifetime total cards */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        {Object.entries(totals).map(([cur, total]) => (
          <div key={cur} style={{ background:'linear-gradient(135deg,rgba(249,97,103,.12),rgba(249,97,103,.05))', border:'1px solid rgba(249,97,103,.25)', borderRadius:10, padding:'14px 20px', minWidth:160 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:6 }}>{L2('Total Spent', '总开支')} ({cur})</div>
            <div style={{ fontSize:22, fontWeight:800, color:'#f96167' }}>{fmtExact(total, cur)}</div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{vipExpenses.filter(e=>(e.currency||'MYR')===cur).length} {L2('record' + (vipExpenses.filter(e=>(e.currency||'MYR')===cur).length!==1?'s':'') + ' · all time', '条记录 · 全部时间')}</div>
          </div>
        ))}
      </div>

      {/* Expense rows */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr>
              {[['Date','日期'],['Category','类别'],['Item','项目'],['Platform','平台'],['Type','类型'],['Amount','金额'],['Notes','备注']].map(([h, hz]) => (
                <th key={h} style={{ padding:'9px 12px', textAlign: h==='Amount'?'right':'left', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{L2(h, hz)}</th>
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
                    {e.expense_type ? (lang === 'zh' ? ({ online:'线上', offline:'线下' }[e.expense_type] || e.expense_type) : e.expense_type) : '—'}
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
<Modal open={showLog} onClose={() => setShowLog(false)} title={L2('Log Contact', '记录联系')} width={440}>
<div style={{ display:'flex', flexDirection:'column', gap:14 }}>
<div style={{ fontSize:14, fontWeight:600 }}>{vip.full_name || vip.username}</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Contact Type', '联系类型')}</label>
<Select value={logType} onChange={e => setLogType(e.target.value)} style={{ width:'100%' }}>
{CONTACT_TYPE.map(t => <option key={t} value={t}>{enumLabel(t, lang)}</option>)}
</Select>
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Outcome', '结果')}</label>
<Select value={logOutcome} onChange={e => setLogOutcome(e.target.value)} style={{ width:'100%' }}>
{CONTACT_OUTCOME.map(o => <option key={o} value={o}>{enumLabel(o, lang)}</option>)}
</Select>
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Notes (optional)', '备注（可选）')}</label>
<Textarea value={logNote} onChange={e => setLogNote(e.target.value)} rows={3} />
</div>
<div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
<Btn variant="ghost" onClick={() => setShowLog(false)}>{L2('Cancel', '取消')}</Btn>
<Btn variant="primary" onClick={submitLog} disabled={logSaving}>{logSaving?L2('Saving…', '保存中…'):L2('Save Log', '保存记录')}</Btn>
</div>
</div>
</Modal>

{/* ── Edit VIP Modal ── */}
<Modal open={showEdit} onClose={() => setShowEdit(false)} title={L2('Edit VIP', '编辑VIP')} width={480}>
<div style={{ display:'flex', flexDirection:'column', gap:14 }}>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Full Name', '全名')}</label>
<Input value={editForm.full_name||''} onChange={e => setEditForm(f=>({...f,full_name:e.target.value}))} placeholder={L2('Real name', '真实姓名')} />
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Birthday', '生日')}</label>
<Input type="date" value={editForm.birthday||''} onChange={e => setEditForm(f=>({...f,birthday:e.target.value}))} />
</div>
</div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Tier', '等级')}</label>
<Select value={editForm.tier} onChange={e => setEditForm(f=>({...f,tier:e.target.value}))} style={{ width:'100%' }}>
{TIERS.map(t => <option key={t} value={t}>{t}</option>)}
</Select>
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Host', '负责人')}</label>
<Select value={editForm.host_assigned||''} onChange={e => setEditForm(f=>({...f,host_assigned:e.target.value}))} style={{ width:'100%' }}>
<option value="">{L2('— Unassigned —', '— 未分配 —')}</option>
{hosts.map(h => <option key={h} value={h}>{h}</option>)}
</Select>
</div>
</div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Status', '状态')}</label>
<Select value={editForm.activity_status||''} onChange={e => setEditForm(f=>({...f,activity_status:e.target.value}))} style={{ width:'100%' }}>
{['Active','Watch','At Risk','Dormant'].map(s => <option key={s} value={s}>{enumLabel(s, lang)}</option>)}
</Select>
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Risk Level', '风险等级')}</label>
<Select value={editForm.churn_risk||''} onChange={e => setEditForm(f=>({...f,churn_risk:e.target.value}))} style={{ width:'100%' }}>
{['','LOW','MEDIUM','HIGH','CRITICAL'].map(r => <option key={r} value={r}>{r ? (lang === 'zh' ? ({ LOW:'低', MEDIUM:'中', HIGH:'高', CRITICAL:'严重' }[r] || r) : r) : L2('— None —', '— 无 —')}</option>)}
</Select>
</div>
</div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Phone', '电话')}</label>
<Input value={editForm.phone||''} onChange={e => setEditForm(f=>({...f,phone:e.target.value}))} />
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('WhatsApp', 'WhatsApp')}</label>
<Input value={editForm.whatsapp||''} onChange={e => setEditForm(f=>({...f,whatsapp:e.target.value}))} />
</div>
</div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Email', '电邮')}</label>
<Input value={editForm.email||''} onChange={e => setEditForm(f=>({...f,email:e.target.value}))} />
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Telegram', 'Telegram')}</label>
<Input value={editForm.telegram||''} onChange={e => setEditForm(f=>({...f,telegram:e.target.value}))} placeholder={L2('without @', '不含 @')} />
</div>
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Address', '地址')}</label>
<Textarea value={editForm.address||''} onChange={e => setEditForm(f=>({...f,address:e.target.value}))} rows={2} />
</div>
<div>
<label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Remark', '备注')}</label>
<Textarea value={editForm.special_requests||''} onChange={e => setEditForm(f=>({...f,special_requests:e.target.value}))} rows={2} />
</div>
<div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginTop:4 }}>
<label style={{ fontSize:12, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:10, textTransform:'uppercase', letterSpacing:'.5px' }}>{L2('T&G Verification', 'T&G 验证')}</label>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
  <div>
    <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Verified Name', '验证姓名')}</label>
    <Input value={editForm.tng_verified_name||''} onChange={e => setEditForm(f=>({...f,tng_verified_name:e.target.value}))} placeholder={L2('Name from T&G', 'T&G 上的姓名')} />
  </div>
  <div>
    <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Status', '状态')}</label>
    <Select value={editForm.tng_verify_status||''} onChange={e => setEditForm(f=>({...f,tng_verify_status:e.target.value}))}>
      <option value="">{L2('— Not checked —', '— 未检查 —')}</option>
      <option value="verified">{L2('✓ Verified (name matches)', '✓ 已验证（姓名相符）')}</option>
      <option value="mismatch">{L2('⚠ Mismatch (name differs)', '⚠ 不匹配（姓名不同）')}</option>
      <option value="pending">{L2('Pending', '待定')}</option>
    </Select>
  </div>
</div>
<div style={{ marginTop:10 }}>
  <label style={{ fontSize:12, color:'var(--muted)', display:'block', marginBottom:4 }}>{L2('Date Checked', '检查日期')}</label>
  <Input type="date" value={editForm.tng_verified_at||''} onChange={e => setEditForm(f=>({...f,tng_verified_at:e.target.value}))} style={{ maxWidth:180 }} />
</div>
</div>
<div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
<Btn variant="ghost" onClick={() => setShowEdit(false)}>{L2('Cancel', '取消')}</Btn>
<Btn variant="primary" onClick={saveEdit} disabled={editSaving}>{editSaving?L2('Saving…', '保存中…'):L2('Save Changes', '保存更改')}</Btn>
</div>
</div>
</Modal>
</div>
)
}
