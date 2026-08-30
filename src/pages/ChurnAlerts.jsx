// ChurnAlerts v2 — with reactivation tracking + monthly stats
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, MONTHS } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamNumber, useUrlParamBool, useUrlParamsRaw } from '../hooks/useUrlParam'

const RISK_COLOR = { HIGH:'#f85149', MEDIUM:'#d29922', LOW:'#3fb950' }
const RISK_BG    = { HIGH:'rgba(248,81,73,.12)', MEDIUM:'rgba(210,153,34,.12)', LOW:'rgba(63,185,80,.1)' }

const s = {
  page:   { padding:'24px 28px', minHeight:'100vh' },
  title:  { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:    { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:   { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  tbl:    { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:     { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:     { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  badge:  { display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  tag:    { display:'inline-block', padding:'2px 9px', borderRadius:6, fontSize:11, fontWeight:600 },
  btn:    (c='var(--accent)') => ({ background:c, color:'#fff', border:'none', padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' }),
  btnSm:  { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer' },
  input:  { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:7, fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' },
  sel:    { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none' },
  modal:  { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' },
  mBox:   { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'28px 32px', width:440, maxWidth:'90vw' },
}

function StatCard({ icon, label, value, color, sub }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}>
      <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>{icon} {label}</div>
      <div style={{ fontSize:28, fontWeight:800, color: color||'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{sub}</div>}
    </div>
  )
}

// ── Reactivation Modal ────────────────────────────────────────────────────────
function ReactivateModal({ vip, month, onClose, onSaved }) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [notes,   setNotes]   = useState('')
  const [saving,  setSaving]  = useState(false)

  async function handleSave() {
    setSaving(true)
    const myName = profile?.full_name || profile?.username || 'Host'
    const { error } = await supabase.from('reactivation_logs').upsert({
      username:           vip.username,
      tier:               vip.tier,
      vip_id:             vip.id,
      reactivated_month:  month,
      days_was_inactive:  vip.days_inactive,
      prev_last_deposit:  vip.last_deposit_date || null,
      host_name:          myName,
      notes:              notes || null,
    }, { onConflict: 'username,reactivated_month' })
    if (error) { alert(t('churnAlerts.saveFailed', { msg: error.message })); setSaving(false); return }
    onSaved()
    onClose()
  }

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={s.mBox} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:700, marginBottom:4 }}>{t('churnAlerts.markActivatedModalTitle')}</div>
        <div style={{ fontSize:13, color:'var(--muted)', marginBottom:20 }}>
          {t('churnAlerts.recordActivationDesc', { username: vip.username, month })}
        </div>
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:4 }}>{t('common.daysInactive')}</div>
          <div style={{ fontSize:14, fontWeight:600, color:'#f85149' }}>{t('churnAlerts.daysShort', { n: vip.days_inactive })}</div>
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:4 }}>{t('churnAlerts.notesLabel')}</div>
          <textarea rows={3} style={{ ...s.input, resize:'vertical', fontFamily:'inherit' }}
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={t('churnAlerts.notesPlaceholder')} />
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button style={s.btnSm} onClick={onClose}>{t('common.cancel')}</button>
          <button style={s.btn('#3fb950')} onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('churnAlerts.confirmReactivated')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChurnAlerts() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { t } = useLanguage()
  const now = new Date()
  const [month, setMonth] = useUrlParamNumber('month', now.getMonth())
  const [year,  setYear]  = useUrlParamNumber('year', now.getFullYear())
  const [tab,   setTab]   = useUrlParam('tab', 'priority') // 'priority' | 'churn' | 'reactivated' | 'dormant' | 'diamond' | 'platinum'
  const [priorityList, setPriorityList] = useState([])
  const [priorityLoading, setPriorityLoading] = useState(true)

  const [vips,                 setVips]                 = useState([])
  const [reactivated,          setReactivated]          = useState([])
  const [reactivatedSet,       setReactivatedSet]       = useState(new Set())
  const [diamondUncontacted,   setDiamondUncontacted]   = useState([])
  const [platinumUncontacted,  setPlatinumUncontacted]  = useState([])
  const [dormantList,          setDormantList]          = useState([])
  const [dormantDays,          setDormantDays]          = useUrlParamNumber('dormantDays', 30) // 14 | 30
  const [dormantTierF,         setDormantTierF]         = useUrlParam('dormantTier', 'ALL')
  const [loading,       setLoading]       = useState(true)
  const myName  = profile?.full_name || ''

  // Shared by every tab's Contact column. Prefers 'phone' — kept clean by the
  // CSV import fix — over 'whatsapp', an older field import never touches and
  // can hold stale/mistyped values. Requires 10+ digits so an obviously
  // truncated number never gets used.
  function getWaLink(v) {
    const rawNumber = (v.phone && v.phone.replace(/\D/g,'').length >= 10) ? v.phone
      : (v.whatsapp && v.whatsapp.replace(/\D/g,'').length >= 10) ? v.whatsapp
      : ''
    if (!rawNumber) return null
    const waNumber = rawNumber.replace(/\D/g, '')
    const greeting = encodeURIComponent(`Hi ${v.username}, this is ${myName || 'the VIP department'}.`)
    return `https://wa.me/${waNumber}?text=${greeting}`
  }
  function WaButton({ v }) {
    const link = getWaLink(v)
    if (!link) return <span style={{ color:'var(--muted)' }}>—</span>
    return (
      <a href={link} target="_blank" rel="noopener noreferrer"
        style={{ display:'inline-flex', width:26, height:26, borderRadius:13, background:'#25D366', color:'#fff', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, textDecoration:'none' }}>W</a>
    )
  }
  const [mineOnly, setMineOnly] = useUrlParamBool('mine', false)
  const [riskF,         setRiskF]         = useUrlParam('risk', 'ALL')
  const [tierF,         setTierF]         = useUrlParam('tier', 'ALL')
  const [reactTierF,    setReactTierF]    = useUrlParam('reactTier', 'ALL')
  const [sortCol,       setSortCol]       = useUrlParam('sort', 'days_inactive')
  const [sortAsc,       setSortAsc]       = useUrlParamBool('asc', false)
  const [stats,         setStats]         = useState({ high:0, medium:0, dormant:0, atRisk:0 })
  const [reactivateModal, setReactivateModal] = useState(null)

  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`

  useEffect(() => { loadAll() }, [riskF, tierF, sortCol, sortAsc, month, year, mineOnly, dormantDays])
  useEffect(() => { loadPriorityContacts() }, [])

  async function loadPriorityContacts() {
    setPriorityLoading(true)
    try {
      const today = new Date()
      const todayStr = today.toISOString().slice(0, 10)
      const start14 = new Date(today); start14.setDate(start14.getDate() - 14)
      const start14Str = start14.toISOString().slice(0, 10)
      const sevenAgo = new Date(today); sevenAgo.setDate(sevenAgo.getDate() - 7)
      const sevenAgoStr = sevenAgo.toISOString().slice(0, 10)
      const threeAgo = new Date(today); threeAgo.setDate(threeAgo.getDate() - 3)
      const threeAgoStr = threeAgo.toISOString().slice(0, 10)

      // Filtered by tier (only 2 values) rather than by username list — avoids
      // the known PostgREST issue where .in('username', largeArray) silently
      // fails once the array gets big. Paginated since 14 days × ~100 P+D VIPs
      // can exceed Supabase's 1000-row cap per request.
      let allSnaps = []
      let from = 0
      const PAGE = 1000
      while (true) {
        const { data: page, error } = await supabase
          .from('vip_daily_snapshots')
          .select('username, snapshot_date, total_deposit, monthly_valid_bet, win_loss')
          .in('tier', ['DIAMOND', 'PLATINUM'])
          .gte('snapshot_date', start14Str)
          .lte('snapshot_date', todayStr)
          .range(from, from + PAGE - 1)
        if (error) { console.error('loadPriorityContacts snapshot error', error); break }
        allSnaps = allSnaps.concat(page || [])
        if (!page || page.length < PAGE) break
        from += PAGE
      }

      const { data: pdVips, error: vipError } = await supabase
        .from('vip_members')
        .select('id, username, tier, host_assigned, currency, whatsapp, phone')
        .in('tier', ['DIAMOND', 'PLATINUM'])
        .eq('is_excluded', false)
      if (vipError) { console.error('loadPriorityContacts vip error', vipError); setPriorityList([]); return }

      const vipMap = {}
      ;(pdVips || []).forEach(v => { vipMap[v.username] = v })

      const byUser = {}
      allSnaps.forEach(s => {
        if (!byUser[s.username]) byUser[s.username] = []
        byUser[s.username].push(s)
      })

      const results = []
      Object.entries(byUser).forEach(([username, rawSnaps]) => {
        const vip = vipMap[username]
        if (!vip) return
        const snaps = [...rawSnaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))

        const last7 = snaps.filter(s => s.snapshot_date >= sevenAgoStr && s.snapshot_date <= todayStr)
        const prev7 = snaps.filter(s => s.snapshot_date < sevenAgoStr)
        const last7Deposit = last7.reduce((sum, s) => sum + (parseFloat(s.total_deposit) || 0), 0)
        const prev7Deposit = prev7.reduce((sum, s) => sum + (parseFloat(s.total_deposit) || 0), 0)
        const declinePct = prev7Deposit > 0 ? Math.round((last7Deposit - prev7Deposit) / prev7Deposit * 100) : null

        const depositDates = snaps.filter(s => (parseFloat(s.total_deposit) || 0) > 0).map(s => s.snapshot_date)
        const lastDepositDate = depositDates.length ? depositDates[depositDates.length - 1] : null
        const daysSinceDeposit = lastDepositDate
          ? Math.floor((today - new Date(lastDepositDate)) / (1000 * 60 * 60 * 24))
          : null

        const depletionDays = last7.filter(s => (parseFloat(s.monthly_valid_bet) || 0) > 0 && (parseFloat(s.total_deposit) || 0) === 0).length

        const last3 = snaps.filter(s => s.snapshot_date >= threeAgoStr && s.snapshot_date <= todayStr)
        const netWinLoss3d = last3.reduce((sum, s) => sum + (parseFloat(s.win_loss) || 0), 0)

        const reasons = []
        let urgencyScore = 0
        if (declinePct !== null && declinePct <= -50) {
          reasons.push(`7-day deposit dropped ${Math.abs(declinePct)}% (${formatMoney(prev7Deposit, vip.currency)} → ${formatMoney(last7Deposit, vip.currency)})`)
          urgencyScore += 3
        }
        if (daysSinceDeposit !== null && daysSinceDeposit >= 3) {
          reasons.push(`No deposit for ${daysSinceDeposit} days — may become a churn case soon`)
          urgencyScore += 2
        }
        if (depletionDays >= 1) {
          reasons.push(`Balance running low: bet but didn't deposit on ${depletionDays} day${depletionDays > 1 ? 's' : ''} in the last 7`)
          urgencyScore += 2
        }
        if (netWinLoss3d <= -2000) {
          reasons.push(`Net loss ${formatMoney(Math.abs(netWinLoss3d), vip.currency)} in 3 days — recommend appeasement`)
          urgencyScore += 1
        }

        if (reasons.length > 0) {
          results.push({
            id: vip.id, username, tier: vip.tier, currency: vip.currency, hostAssigned: vip.host_assigned,
            whatsapp: vip.whatsapp, phone: vip.phone,
            last7Deposit, netWinLoss3d, lastDepositDate, daysSinceDeposit,
            reasons, urgencyScore,
          })
        }
      })

      results.sort((a, b) => b.urgencyScore - a.urgencyScore)
      setPriorityList(results)
    } finally {
      setPriorityLoading(false)
    }
  }

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadVIPs(), loadReactivated(), loadUncontacted(), loadDormant()])
    setLoading(false)
  }

  async function loadDormant() {
    const { data, error } = await supabase
      .from('vip_members')
      .select('id, username, tier, host_assigned, days_inactive, last_deposit_date, currency, region, phone, whatsapp')
      .eq('is_excluded', false)
      .gte('days_inactive', dormantDays)
      .order('days_inactive', { ascending: false })
    if (error) { console.error('loadDormant error', error); return }
    setDormantList(data || [])
  }

  async function loadUncontacted() {
    // Get all Diamond + Platinum VIPs
    const { data: vips } = await supabase
      .from('vip_members')
      .select('id, username, tier, host_assigned, days_inactive, last_deposit_date, currency, phone, whatsapp')
      .in('tier', ['DIAMOND', 'PLATINUM'])
      .eq('is_excluded', false)

    if (!vips || vips.length === 0) { setDiamondUncontacted([]); setPlatinumUncontacted([]); return }

    // Merge in accumulated month-to-date deposit total (vip_members.total_deposit is now just the last uploaded day)
    // NOTE: don't filter with .in('username', usernames) — fetch the whole month's totals instead,
    // since the username list here can run into the hundreds and exceed URL length limits.
    const now = new Date()
    const thisMonthCu = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    const { data: _cuCheck } = await supabase.from('vip_monthly_totals').select('snapshot_month').eq('snapshot_month', thisMonthCu).limit(1)
    const currentMonth = (_cuCheck && _cuCheck.length > 0) ? thisMonthCu : await (async () => {
      const { data: _cuLatest } = await supabase.from('vip_monthly_totals').select('snapshot_month').order('snapshot_month', { ascending: false }).limit(1)
      return _cuLatest?.[0]?.snapshot_month || thisMonthCu
    })()
    const { data: totals, error: totalsErr } = await supabase
      .from('vip_monthly_totals')
      .select('username, total_deposit')
      .eq('snapshot_month', currentMonth)
    if (totalsErr) console.error('loadUncontacted: vip_monthly_totals fetch error', totalsErr)
    const totalsMap = {}
    ;(totals || []).forEach(t => { totalsMap[t.username] = t.total_deposit })
    const vipsWithDeposit = vips
      .map(v => ({ ...v, total_deposit: totalsMap[v.username] ?? 0 }))
      .sort((a, b) => (b.total_deposit||0) - (a.total_deposit||0))

    // Get contacted usernames this month
    // NOTE: don't filter with .in('username', ...) — DIAMOND+PLATINUM list can be 90+ usernames,
    // which risks the same URL length issue. Fetch all contacts for the month instead.
    const { data: contacted, error: contactedErr } = await supabase
      .from('contact_logs')
      .select('username')
      .eq('log_month', monthStr)
    if (contactedErr) console.error('loadUncontacted: contact_logs fetch error', contactedErr)

    const contactedSet = new Set((contacted||[]).map(c => c.username))
    setDiamondUncontacted(vipsWithDeposit.filter(d => d.tier === 'DIAMOND'  && !contactedSet.has(d.username)))
    setPlatinumUncontacted(vipsWithDeposit.filter(d => d.tier === 'PLATINUM' && !contactedSet.has(d.username)))
  }

  async function loadVIPs() {
    let q = supabase
      .from('vip_members')
      .select('*')
      .eq('is_excluded', false)
      .or('churn_risk.eq.HIGH,churn_risk.eq.MEDIUM,activity_status.eq.At Risk,activity_status.eq.Dormant,days_inactive.gte.30')
    if (riskF !== 'ALL') q = q.eq('churn_risk', riskF)
    if (tierF !== 'ALL') q = q.eq('tier', tierF)
    const currentName = profile?.full_name || ''
    if (mineOnly && currentName) q = q.eq('host_assigned', currentName)
    // Sorting on total_deposit happens client-side below since it now lives in vip_monthly_totals,
    // not on vip_members directly (vip_members.total_deposit is just the last uploaded day's number).
    if (sortCol !== 'total_deposit') q = q.order(sortCol, { ascending: sortAsc, nullsFirst: false })
    const { data } = await q
    let all = data || []

    // Merge in accumulated month-to-date deposit total
    // NOTE: don't filter with .in('username', usernames) — the churn-risk list can run into
    // the hundreds, which can exceed URL length limits. Fetch the whole month instead.
    if (all.length > 0) {
      const now = new Date()
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      // Auto-detect active month: use current month if data exists, else fall back to most recent available.
      // This handles month boundaries (e.g. Jul 1 when all data is still Jun).
      const { data: _monthCheck } = await supabase.from('vip_monthly_totals').select('snapshot_month').eq('snapshot_month', thisMonth).limit(1)
      const currentMonth = (_monthCheck && _monthCheck.length > 0) ? thisMonth : await (async () => {
        const { data: _latest } = await supabase.from('vip_monthly_totals').select('snapshot_month').order('snapshot_month', { ascending: false }).limit(1)
        return _latest?.[0]?.snapshot_month || thisMonth
      })()
      const { data: totals, error: totalsErr } = await supabase
        .from('vip_monthly_totals')
        .select('username, total_deposit')
        .eq('snapshot_month', currentMonth)
      if (totalsErr) console.error('loadVIPs: vip_monthly_totals fetch error', totalsErr)
      const totalsMap = {}
      ;(totals || []).forEach(t => { totalsMap[t.username] = t.total_deposit })
      all = all.map(v => ({ ...v, total_deposit: totalsMap[v.username] ?? 0 }))
    }

    if (sortCol === 'total_deposit') {
      all = [...all].sort((a, b) => sortAsc ? (a.total_deposit||0) - (b.total_deposit||0) : (b.total_deposit||0) - (a.total_deposit||0))
    }

    setVips(all)
    setStats({
      high:    all.filter(v => v.churn_risk === 'HIGH').length,
      medium:  all.filter(v => v.churn_risk === 'MEDIUM').length,
      dormant: all.filter(v => v.activity_status === 'Dormant').length,
      atRisk:  all.filter(v => v.activity_status === 'At Risk').length,
    })
  }

  async function loadReactivated() {
    const { data } = await supabase
      .from('reactivation_logs')
      .select('*')
      .eq('reactivated_month', monthStr)
      .order('created_at', { ascending: false })
    setReactivated(data || [])
    setReactivatedSet(new Set((data||[]).map(r => r.username)))
  }

  const urlRaw = useUrlParamsRaw()

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else urlRaw.set({ sort: col, asc: 'false' }, { sort: 'days_inactive', asc: 'false' })
  }

  function SortIcon({ col }) {
    if (sortCol !== col) return <span style={{opacity:.3}}>↕</span>
    return <span style={{color:'var(--accent)'}}>{sortAsc?'↑':'↓'}</span>
  }

  const priorityLabel = (v) => {
    if (v.churn_risk === 'HIGH' || v.days_inactive >= 60) return { label:'P1 URGENT', color:'#f85149', bg:'rgba(248,81,73,.12)' }
    if (v.churn_risk === 'MEDIUM' || v.days_inactive >= 30) return { label:'P2 HIGH', color:'#d29922', bg:'rgba(210,153,34,.12)' }
    return { label:'P3 WATCH', color:'#8b949e', bg:'rgba(139,148,158,.1)' }
  }

  const reactivationTarget = 15

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>🚨 Churn Alerts</div>
          <div style={s.sub}>{t('churnAlerts.subtitle')}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <select style={s.sel} value={month} onChange={e => setMonth(parseInt(e.target.value))}>
            {MONTHS.map((m,i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select style={s.sel} value={year} onChange={e => setYear(parseInt(e.target.value))}>
            {[2024,2025,2026,2027].map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 }}>
        <StatCard icon="🔴" label={t('churnAlerts.statHighRisk')}       value={stats.high}              color="#f85149" sub={t('churnAlerts.statHighSub')} />
        <StatCard icon="🟡" label={t('churnAlerts.statMediumRisk')}      value={stats.medium}            color="#d29922" sub={t('churnAlerts.statMediumSub')} />
        <StatCard icon="💤" label={t('common.dormant')}              value={stats.dormant}           color="#8b949e" sub={t('churnAlerts.statDormantSub')} />
        <StatCard icon="✅" label={t('churnAlerts.reactivatedThisMonth', { month: MONTHS[month] })} value={reactivated.length} color="#3fb950"
          sub={`${t('churnAlerts.targetLabel', { n: reactivationTarget })} | ${reactivated.length >= reactivationTarget ? t('churnAlerts.metTarget') : t('churnAlerts.shortBy', { n: reactivationTarget - reactivated.length })}`} />
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}>
          <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>{t('churnAlerts.activationProgress')}</div>
          <div style={{ height:8, background:'var(--surface2)', borderRadius:4, overflow:'hidden', marginBottom:6 }}>
            <div style={{ height:'100%', borderRadius:4, background: reactivated.length >= reactivationTarget ? '#3fb950' : '#d29922',
              width:`${Math.min(100, reactivated.length/reactivationTarget*100)}%`, transition:'width .5s' }} />
          </div>
          <div style={{ fontSize:13, fontWeight:700, color: reactivated.length >= reactivationTarget ? '#3fb950':'#d29922' }}>
            {reactivated.length} / {reactivationTarget}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'1px solid var(--border)', paddingBottom:0 }}>
        {[
          ['priority', '🚨 Priority Contacts'],
          ['churn', t('churnAlerts.tabAtRisk', { n: vips.filter(v => v.churn_risk === 'HIGH' || v.churn_risk === 'MEDIUM').length }) || ('⚠️ At-Risk (' + vips.filter(v => v.churn_risk === 'HIGH' || v.churn_risk === 'MEDIUM').length + ')')],
          ['reactivated', t('churnAlerts.tabReactivated', { n: reactivated.length })],
          ['dormant', `💤 Dormant (${dormantList.length})`],
          ['diamond', t('churnAlerts.tabDiamondUncontacted', { n: diamondUncontacted.length })],
          ['platinum', t('churnAlerts.tabPlatinumUncontacted', { n: platinumUncontacted.length })],
        ].map(([v,l]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding:'8px 18px', borderRadius:'8px 8px 0 0',
            border:'1px solid var(--border)', borderBottom: tab===v ? '1px solid var(--surface)' : '1px solid var(--border)',
            background: tab===v ? 'var(--surface)' : 'transparent',
            color: tab===v ? (v==='diamond' ? '#b9f2ff' : v==='platinum' ? '#C0C0C0' : 'var(--text)') : 'var(--muted)',
            fontWeight: tab===v ? 600 : 400, fontSize:13, cursor:'pointer', marginBottom:-1,
          }}>{l}</button>
        ))}
        {tab === 'churn' && (
          <div style={{ marginLeft:'auto', display:'flex', gap:8, paddingBottom:8 }}>
            <button onClick={() => setMineOnly(m => !m)} style={{ background:mineOnly?'var(--accent)':'var(--surface2)', color:mineOnly?'#fff':'var(--text)', border:mineOnly?'none':'1px solid var(--border)', padding:'6px 12px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              {mineOnly ? t('churnAlerts.mineStarred') : t('churnAlerts.mineUnstarred')}
            </button>
            <select style={s.sel} value={riskF} onChange={e => setRiskF(e.target.value)}>
              <option value="ALL">{t('churnAlerts.allRisk')}</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
            </select>
            <select style={s.sel} value={tierF} onChange={e => setTierF(e.target.value)}>
              {['ALL','BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ── PRIORITY CONTACTS TAB ── */}
      {tab === 'priority' && (
        <div style={{ ...s.card, overflow:'hidden' }}>
          <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:13, fontWeight:700 }}>🚨 Priority Contacts — Diamond &amp; Platinum, sorted by urgency</span>
            <span style={{ fontSize:11, color:'var(--muted)' }}>Deposit decline ≥50% (7d) · No deposit ≥3 days · Playing on dwindling balance · Loss ≥RM2,000 (3d)</span>
            <span style={{ fontSize:12, color:'var(--muted)', marginLeft:'auto' }}>{priorityList.length} flagged</span>
          </div>
          <div style={{ overflowX:'auto' }}>
            {priorityLoading ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--muted)' }}>{t('common.loading')}</div>
            ) : priorityList.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'#3fb950' }}>✓ No Diamond/Platinum VIPs currently flagged as urgent.</div>
            ) : (
              <table style={s.tbl}>
                <thead>
                  <tr>
                    <th style={s.th}>VIP</th>
                    <th style={s.th}>Tier</th>
                    <th style={s.th}>Urgency</th>
                    <th style={s.th}>Reasons</th>
                    <th style={s.th}>7-Day Deposit</th>
                    <th style={s.th}>3-Day W/L</th>
                    <th style={s.th}>Last Deposit</th>
                    <th style={s.th}>Host</th>
                    <th style={s.th}>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {priorityList.map(r => {
                    const fireCount = r.urgencyScore >= 6 ? 3 : r.urgencyScore >= 4 ? 2 : 1
                    return (
                      <tr key={r.username}
                        style={{ cursor:'pointer' }}
                        onClick={() => navigate(`/vips/${r.id}`)}
                        onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        <td style={{ ...s.td, fontWeight:700 }}>{r.username}</td>
                        <td style={s.td}><span style={{ ...s.badge, background:TIER_BG[r.tier]||'transparent', color:TIER_COLOR[r.tier]||'var(--text)' }}>{r.tier}</span></td>
                        <td style={s.td}>{'🔥'.repeat(fireCount)}</td>
                        <td style={{ ...s.td, fontSize:11, maxWidth:320 }}>
                          <ul style={{ margin:0, paddingLeft:16 }}>
                            {r.reasons.map((reason, i) => <li key={i} style={{ marginBottom:2 }}>{reason}</li>)}
                          </ul>
                        </td>
                        <td style={{ ...s.td, fontWeight:600 }}>{formatMoney(r.last7Deposit, r.currency)}</td>
                        <td style={{ ...s.td, fontWeight:600, color: r.netWinLoss3d < 0 ? '#f85149' : '#3fb950' }}>{formatMoney(r.netWinLoss3d, r.currency)}</td>
                        <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{r.lastDepositDate || '—'} {r.daysSinceDeposit !== null ? `(${r.daysSinceDeposit}d ago)` : ''}</td>
                        <td style={{ ...s.td, fontSize:12 }}>{r.hostAssigned || <span style={{ color:'#f85149' }}>Unassigned</span>}</td>
                        <td style={s.td} onClick={e => e.stopPropagation()}><WaButton v={r} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── CHURN TAB ── */}
      {tab === 'churn' && (
        <div style={{ ...s.card, overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={s.tbl}>
              <thead>
                <tr>
                  <th style={s.th}>{t('churnAlerts.colPriority')}</th>
                  <th style={{...s.th,cursor:'pointer'}} onClick={() => toggleSort('username')}>VIP <SortIcon col="username"/></th>
                  <th style={s.th}>Tier</th>
                  <th style={{...s.th,cursor:'pointer'}} onClick={() => toggleSort('days_inactive')}>{t('common.daysInactive')} <SortIcon col="days_inactive"/></th>
                  <th style={s.th}>{t('churnAlerts.colRisk')}</th>
                  <th style={{...s.th,cursor:'pointer'}} onClick={() => toggleSort('total_deposit')}>{t('churnAlerts.colTotalDeposit')} <SortIcon col="total_deposit"/></th>
                  <th style={s.th}>Host</th>
                  <th style={s.th}>{t('common.contact')}</th>
                  <th style={s.th}>{t('common.status')}</th>
                  <th style={s.th}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{...s.td,textAlign:'center',padding:40,color:'var(--muted)'}}>{t('common.loading')}</td></tr>
                ) : vips.length === 0 ? (
                  <tr><td colSpan={10} style={{...s.td,textAlign:'center',padding:40,color:'#3fb950'}}>{t('churnAlerts.allVipsHealthy')}</td></tr>
                ) : vips.map(v => {
                  const p = priorityLabel(v)
                  const isReactivated = reactivatedSet.has(v.username)
                  return (
                    <tr key={v.id}
                      style={{ cursor:'pointer', background: isReactivated ? 'rgba(63,185,80,.05)' : (myName && v.host_assigned===myName ? 'rgba(99,102,241,0.06)' : 'transparent'), borderLeft: (myName && v.host_assigned===myName) ? '3px solid var(--accent)' : '3px solid transparent' }}
                      onClick={() => navigate(`/vips/${v.id}`)}
                      onMouseEnter={e => e.currentTarget.style.background = isReactivated ? 'rgba(63,185,80,.1)' : (myName && v.host_assigned===myName ? 'rgba(99,102,241,0.12)' : 'var(--surface2)')}
                      onMouseLeave={e => e.currentTarget.style.background = isReactivated ? 'rgba(63,185,80,.05)' : 'transparent'}>
                      <td style={s.td}>
                        <span style={{ ...s.tag, background:p.bg, color:p.color }}>{p.label}</span>
                      </td>
                      <td style={{ ...s.td, fontWeight:700 }}>{v.username}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background:TIER_BG[v.tier]||'transparent', color:TIER_COLOR[v.tier]||'var(--text)' }}>{v.tier}</span>
                      </td>
                      <td style={s.td}>
                        <span style={{ color: v.days_inactive>=60?'#f85149':v.days_inactive>=30?'#d29922':'#f0883e', fontWeight:700 }}>
                          {v.days_inactive !== null ? (v.days_inactive===0?t('common.today'):t('churnAlerts.daysShort',{n:v.days_inactive})) : '—'}
                        </span>
                      </td>
                      <td style={s.td}>
                        <span style={{ ...s.tag, background:RISK_BG[v.churn_risk]||'transparent', color:RISK_COLOR[v.churn_risk]||'var(--muted)' }}>
                          {v.churn_risk||'—'}
                        </span>
                      </td>
                      <td style={{ ...s.td, fontSize:12 }}>{formatMoney(v.total_deposit, v.currency)}</td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{v.host_assigned||'—'}</td>
                      <td style={s.td} onClick={e => e.stopPropagation()}><WaButton v={v} /></td>
                      <td style={s.td}>
                        {isReactivated
                          ? <span style={{ ...s.tag, background:'rgba(63,185,80,.15)', color:'#3fb950' }}>{t('churnAlerts.reactivatedTag')}</span>
                          : <span style={{ ...s.tag, background:'rgba(248,81,73,.1)', color:'#f85149' }}>{t('churnAlerts.pendingTag')}</span>
                        }
                      </td>
                      <td style={s.td} onClick={e => e.stopPropagation()}>
                        <div style={{ display:'flex', gap:6 }}>
                          <button style={s.btnSm} onClick={() => navigate(`/vips/${v.id}`)}>{t('churnAlerts.viewButton')}</button>
                          {!isReactivated && (
                            <button
                              style={{ ...s.btnSm, borderColor:'#3fb950', color:'#3fb950' }}
                              onClick={() => setReactivateModal(v)}>
                              {t('churnAlerts.markReactivated')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!loading && vips.length > 0 && (
            <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)', display:'flex', justifyContent:'space-between' }}>
              <span>{t('churnAlerts.vipsNeedAttention', { n: vips.length })}</span>
              <span style={{ color:'#3fb950' }}>{t('churnAlerts.markedThisMonth', { n: reactivatedSet.size })}</span>
            </div>
          )}
        </div>
      )}

      {/* ── REACTIVATED TAB ── */}
      {tab === 'reactivated' && (
        <div style={{ ...s.card, overflow:'hidden' }}>
          {reactivated.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--muted)', fontSize:14 }}>
              {t('churnAlerts.noReactivationRecords', { month: MONTHS[month] })}<br />
              <span style={{ fontSize:12 }}>{t('churnAlerts.clickMarkHint')}</span>
            </div>
          ) : (
            <>
              <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                <span style={{ fontSize:13, fontWeight:700 }}>{t('churnAlerts.reactivationRecords', { month: MONTHS[month], year })}</span>
                <span style={{ ...s.tag, background:'rgba(63,185,80,.15)', color:'#3fb950' }}>
                  {t('churnAlerts.ofTarget', { n: reactivated.length, target: reactivationTarget })}
                </span>
                {reactivated.length >= reactivationTarget && (
                  <span style={{ fontSize:12, color:'#3fb950', fontWeight:600 }}>{t('churnAlerts.kpiMet')}</span>
                )}
                <select style={{ ...s.sel, marginLeft:'auto' }} value={reactTierF} onChange={e => setReactTierF(e.target.value)}>
                  {['ALL','BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(tierOpt => <option key={tierOpt}>{tierOpt}</option>)}
                </select>
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={s.tbl}>
                  <thead>
                    <tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>VIP</th>
                      <th style={s.th}>Tier</th>
                      <th style={s.th}>{t('churnAlerts.colDaysInactiveAtTime')}</th>
                      <th style={s.th}>{t('common.lastDeposit')}</th>
                      <th style={s.th}>{t('churnAlerts.colRecordedBy')}</th>
                      <th style={s.th}>{t('common.notes')}</th>
                      <th style={s.th}>{t('churnAlerts.colRecordedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reactivated.filter(r => reactTierF === 'ALL' || r.tier === reactTierF).map((r, i) => (
                      <tr key={r.id}
                        onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                        <td style={{ ...s.td, fontWeight:700 }}>{r.username}</td>
                        <td style={s.td}>
                          <span style={{ ...s.badge, background:TIER_BG[r.tier]||'transparent', color:TIER_COLOR[r.tier]||'var(--text)' }}>{r.tier||'—'}</span>
                        </td>
                        <td style={{ ...s.td, color:'#d29922', fontWeight:600 }}>{r.days_was_inactive ? t('churnAlerts.daysShort', { n: r.days_was_inactive }) : '—'}</td>
                        <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>
                          {r.prev_last_deposit ? new Date(r.prev_last_deposit).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'}
                        </td>
                        <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{r.host_name||'—'}</td>
                        <td style={{ ...s.td, fontSize:12, color:'var(--text)', maxWidth:200 }}>
                          <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.notes||'—'}</div>
                        </td>
                        <td style={{ ...s.td, fontSize:11, color:'var(--muted)', whiteSpace:'nowrap' }}>
                          {new Date(r.created_at).toLocaleDateString('en-MY',{day:'numeric',month:'short'})}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── DORMANT TAB ── */}
      {tab === 'dormant' && (
        <div style={{ ...s.card, overflow:'hidden' }}>
          <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, fontWeight:700 }}>💤 Dormant VIPs — {dormantDays}+ days inactive</span>
            <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
              {[14, 30].map(d => (
                <button key={d} onClick={() => setDormantDays(d)} style={{
                  background: dormantDays===d ? 'var(--accent)' : 'transparent',
                  color: dormantDays===d ? '#fff' : 'var(--muted)',
                  border:'none', padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer',
                }}>{d}+ days</button>
              ))}
            </div>
            <select style={{ ...s.sel, marginLeft:'auto' }} value={dormantTierF} onChange={e => setDormantTierF(e.target.value)}>
              {['ALL','BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(tierOpt => <option key={tierOpt}>{tierOpt}</option>)}
            </select>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={s.tbl}>
              <thead>
                <tr>
                  <th style={s.th}>#</th>
                  <th style={s.th}>VIP</th>
                  <th style={s.th}>Tier</th>
                  <th style={s.th}>Region</th>
                  <th style={s.th}>{t('common.daysInactive')}</th>
                  <th style={s.th}>{t('common.lastDeposit')}</th>
                  <th style={s.th}>{t('common.host')}</th>
                  <th style={s.th}>{t('common.contact')}</th>
                  <th style={s.th}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {dormantList.filter(v => dormantTierF === 'ALL' || v.tier === dormantTierF).length === 0 ? (
                  <tr><td colSpan={9} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:32 }}>No VIPs dormant {dormantDays}+ days.</td></tr>
                ) : dormantList.filter(v => dormantTierF === 'ALL' || v.tier === dormantTierF).map((v, i) => (
                  <tr key={v.id}
                    onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                    <td style={{ ...s.td, fontWeight:700 }}>{v.username}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, background:TIER_BG[v.tier]||'transparent', color:TIER_COLOR[v.tier]||'var(--text)' }}>{v.tier}</span>
                    </td>
                    <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{v.region || '—'}</td>
                    <td style={{ ...s.td, color:v.days_inactive>=60?'#f85149':v.days_inactive>=30?'#d29922':'#f0883e', fontWeight:700 }}>{t('churnAlerts.daysShort', { n: v.days_inactive })}</td>
                    <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>
                      {v.last_deposit_date ? new Date(v.last_deposit_date).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'}
                    </td>
                    <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{v.host_assigned || '—'}</td>
                    <td style={s.td}><WaButton v={v} /></td>
                    <td style={s.td}>
                      <button style={s.btnSm} onClick={() => navigate(`/vips/${v.id}`)}>{t('churnAlerts.viewButton')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DIAMOND UNCONTACTED TAB ── */}
      {tab === 'diamond' && (
        <div style={{ ...s.card, overflow:'hidden' }}>
          <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <span style={{ fontSize:14, fontWeight:700, color:'#b9f2ff' }}>{t('churnAlerts.diamondUncontactedTitle')}</span>
              <span style={{ fontSize:12, color:'var(--muted)', marginLeft:10 }}>{monthStr} {t('churnAlerts.noContactYet')}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>
                {t('churnAlerts.uncontactedLabel')} <span style={{ color:'#f85149', fontWeight:700 }}>{diamondUncontacted.length}</span>
                {' / '}{t('common.total')} <span style={{ color:'#b9f2ff', fontWeight:700 }}>{diamondUncontacted.length + (diamondUncontacted.length > 0 ? 0 : 0)}</span>
              </span>
            </div>
          </div>
          {loading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--muted)' }}>Loading…</div>
          ) : diamondUncontacted.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'#3fb950', fontSize:15, fontWeight:600 }}>
              {t('churnAlerts.allDiamondContacted')}
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={s.tbl}>
                <thead>
                  <tr>
                    <th style={s.th}>#</th>
                    <th style={s.th}>Username</th>
                    <th style={s.th}>Host</th>
                    <th style={s.th}>{t('churnAlerts.colTotalDeposit')}</th>
                    <th style={s.th}>{t('common.daysInactive')}</th>
                    <th style={s.th}>{t('common.lastDeposit')}</th>
                    <th style={s.th}>{t('common.contact')}</th>
                    <th style={s.th}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {diamondUncontacted.map((v, i) => (
                    <tr key={v.id}
                      style={{ cursor:'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                      onClick={() => navigate(`/vips/${v.id}`)}>
                      <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                      <td style={{ ...s.td, fontWeight:700, color:'#b9f2ff' }}>{v.username}</td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{v.host_assigned||'—'}</td>
                      <td style={{ ...s.td, fontWeight:600 }}>{formatMoney(v.total_deposit, v.currency)}</td>
                      <td style={{ ...s.td }}>
                        {v.days_inactive > 0
                          ? <span style={{ color: v.days_inactive > 30 ? '#f85149' : '#d29922', fontWeight:600 }}>{t('churnAlerts.daysShort',{n:v.days_inactive})}</span>
                          : <span style={{ color:'#3fb950' }}>{t('common.active')}</span>}
                      </td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>
                        {v.last_deposit_date ? new Date(v.last_deposit_date).toLocaleDateString('en-MY',{day:'numeric',month:'short'}) : '—'}
                      </td>
                      <td style={s.td} onClick={e => e.stopPropagation()}><WaButton v={v} /></td>
                      <td style={s.td} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/contacts?username=${v.username}`)}
                          style={{ background:'var(--accent)', color:'#fff', border:'none', padding:'4px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                          {t('churnAlerts.addContactLog')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── PLATINUM UNCONTACTED TAB ── */}
      {tab === 'platinum' && (
        <div style={{ ...s.card, overflow:'hidden' }}>
          <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <span style={{ fontSize:14, fontWeight:700, color:'#C0C0C0' }}>{t('churnAlerts.platinumUncontactedTitle')}</span>
              <span style={{ fontSize:12, color:'var(--muted)', marginLeft:10 }}>{monthStr} {t('churnAlerts.noContactYet')}</span>
            </div>
            <span style={{ fontSize:12, color:'var(--muted)' }}>
              {t('churnAlerts.uncontactedLabel')} <span style={{ color:'#f85149', fontWeight:700 }}>{platinumUncontacted.length}</span>
            </span>
          </div>
          {loading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--muted)' }}>Loading…</div>
          ) : platinumUncontacted.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'#3fb950', fontSize:15, fontWeight:600 }}>
              {t('churnAlerts.allPlatinumContacted')}
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={s.tbl}>
                <thead>
                  <tr>
                    <th style={s.th}>#</th>
                    <th style={s.th}>Username</th>
                    <th style={s.th}>Host</th>
                    <th style={s.th}>{t('churnAlerts.colTotalDeposit')}</th>
                    <th style={s.th}>{t('common.daysInactive')}</th>
                    <th style={s.th}>{t('common.lastDeposit')}</th>
                    <th style={s.th}>{t('common.contact')}</th>
                    <th style={s.th}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {platinumUncontacted.map((v, i) => (
                    <tr key={v.id}
                      style={{ cursor:'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                      onClick={() => navigate(`/vips/${v.id}`)}>
                      <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                      <td style={{ ...s.td, fontWeight:700, color:'#C0C0C0' }}>{v.username}</td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{v.host_assigned||'—'}</td>
                      <td style={{ ...s.td, fontWeight:600 }}>{formatMoney(v.total_deposit, v.currency)}</td>
                      <td style={{ ...s.td }}>
                        {v.days_inactive > 0
                          ? <span style={{ color: v.days_inactive > 30 ? '#f85149' : '#d29922', fontWeight:600 }}>{t('churnAlerts.daysShort',{n:v.days_inactive})}</span>
                          : <span style={{ color:'#3fb950' }}>{t('common.active')}</span>}
                      </td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>
                        {v.last_deposit_date ? new Date(v.last_deposit_date).toLocaleDateString('en-MY',{day:'numeric',month:'short'}) : '—'}
                      </td>
                      <td style={s.td} onClick={e => e.stopPropagation()}><WaButton v={v} /></td>
                      <td style={s.td} onClick={e => e.stopPropagation()}>
                        <button onClick={() => navigate(`/contacts?username=${v.username}`)}
                          style={{ background:'var(--accent)', color:'#fff', border:'none', padding:'4px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                          {t('churnAlerts.addContactLog')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reactivation Modal */}
      {reactivateModal && (
        <ReactivateModal
          vip={reactivateModal}
          month={monthStr}
          onClose={() => setReactivateModal(null)}
          onSaved={() => { loadReactivated(); setReactivateModal(null) }}
        />
      )}
    </div>
  )
}
