import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, CURRENCY_SYMBOL } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam } from '../hooks/useUrlParam'
import { callAI } from '../lib/aiApi'

const STATUS_COLOR = {
  Active:'#3fb950', Watch:'#d29922', 'At Risk':'#f0883e',
  Dormant:'#f85149', Unknown:'#8b949e',
}
const CHURN_COLOR = { LOW:'#3fb950', MEDIUM:'#d29922', HIGH:'#f85149', UNKNOWN:'#8b949e' }
const CONTACT_TYPES    = ['WhatsApp','Call','In-person','Birthday','Campaign','Other']
const CONTACT_OUTCOMES = ['Contacted','No Reply','Replied','Deposited','Reactivated']
const TIERS = ['BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','BLACK']

// This whole page is always about ONE VIP, so `currency` here is that VIP's own
// currency (pass vip?.currency at each call site) — never a mix of players.
function rmFmt(n, currency) {
  return formatMoney(n, currency)
}
function wlFmt(n, currency) {
  if (n === null || n === undefined) return '-'
  const abs = Math.abs(n)
  const sym = CURRENCY_SYMBOL[currency] || CURRENCY_SYMBOL.MYR
  const str = abs >= 1000000 ? (abs/1000000).toFixed(2)+'M' : abs >= 1000 ? (abs/1000).toFixed(0)+'K' : Math.round(abs).toLocaleString('en-MY')
  return n <= 0
    ? <span style={{color:'#3fb950',fontWeight:700}}>+{sym}{str}</span>
    : <span style={{color:'#f85149',fontWeight:700}}>-{sym}{str}</span>
}
function timeAgo(dateStr) {
  if (!dateStr) return '-'
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60)       return 'just now'
  if (diff < 3600)     return Math.floor(diff/60) + 'm ago'
  if (diff < 86400)    return Math.floor(diff/3600) + 'h ago'
  if (diff < 86400*30) return Math.floor(diff/86400) + 'd ago'
  return new Date(dateStr).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' })
}
function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' })
}

const s = {
  page:    { padding:'24px 28px', minHeight:'100vh', maxWidth:1100, margin:'0 auto' },
  back:    { display:'inline-flex', alignItems:'center', gap:6, color:'var(--muted)', fontSize:13, cursor:'pointer', marginBottom:20, border:'none', background:'none', padding:0 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, marginBottom:16 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' },
  cardBody:{ padding:'18px 20px' },
  grid2:   { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 28px' },
  grid3:   { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px 28px' },
  field:   { display:'flex', flexDirection:'column', gap:3, padding:'6px 0', borderBottom:'1px solid var(--border)' },
  flbl:    { fontSize:11, color:'var(--muted)' },
  fval:    { fontSize:13, color:'var(--text)', fontWeight:500 },
  badge:   { display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  btn:     { background:'var(--accent)', color:'#fff', border:'none', padding:'9px 20px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm:   { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'7px 16px', borderRadius:7, fontSize:12, cursor:'pointer' },
  input:   { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box' },
  sel:     { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none' },
  ta:      { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, resize:'vertical', outline:'none', boxSizing:'border-box', fontFamily:'inherit' },
  logEntry:{ padding:'12px 0', borderBottom:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:4 },
  tag:     { display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 },
}

function Field({ label, value, color, children }) {
  return (
    <div style={s.field}>
      <div style={s.flbl}>{label}</div>
      <div style={{ ...s.fval, color: color || 'var(--text)' }}>{children || value || '-'}</div>
    </div>
  )
}
function SectionHeader({ icon, title }) {
  return <div style={s.cardHdr}><span style={{fontSize:14}}>{icon}</span> {title}</div>
}

// {month}月存款日历热力图 — green = deposit increased that day, gray = no data, empty = no deposit change
function compactAmt(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return Math.round(n).toString()
}

function DepositCalendar({ snaps, month, currency }) {
  const { t } = useLanguage()
  // Both monthly_valid_bet (turnover) AND total_deposit are tracked per day now —
  // a day can have turnover with no deposit (played existing balance, didn't top
  // up) or, more rarely, a deposit recorded with no bet activity yet. These are
  // genuinely different situations worth telling apart, not just "active/not".
  const byDate = {}
  snaps.forEach(s => {
    byDate[s.snapshot_date] = {
      vb: parseFloat(s.monthly_valid_bet) || 0,
      dep: parseFloat(s.total_deposit) || 0,
      wd: parseFloat(s.total_withdrawal) || 0,
    }
  })

  if (!month) return null
  const [y, m] = month.split('-').map(Number)
  const totalDaysInMonth = new Date(y, m, 0).getDate()
  const now = new Date()
  const curMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const isCurrentMonth = month === curMonthStr
  const elapsedDays = isCurrentMonth ? now.getDate() : totalDaysInMonth

  if (snaps.length === 0) {
    return <div style={{ fontSize:12, color:'var(--muted)', padding:'8px 0' }}>{t('vipDetail.noDailySnapshotData', { month })}</div>
  }

  const days = []
  for (let d = 1; d <= totalDaysInMonth; d++) {
    days.push(`${month}-${String(d).padStart(2, '0')}`)
  }

  let depositDaysCount = 0, turnoverOnlyDaysCount = 0, activeDaysCount = 0, withdrawalDaysCount = 0
  let monthValidBet = 0, monthDeposit = 0, monthWithdrawal = 0
  const cells = days.map(dateStr => {
    const dayNum = parseInt(dateStr.slice(-2), 10)
    const isFuture = isCurrentMonth && dayNum > elapsedDays
    const hasData = dateStr in byDate
    const rec = hasData ? byDate[dateStr] : null
    const hasBet = hasData && rec.vb > 0
    const hasDeposit = hasData && rec.dep > 0
    const hasWithdrawal = hasData && rec.wd > 0
    // both | turnoverOnly | noBet | noData
    const state = !hasData ? 'noData' : (hasBet && hasDeposit) ? 'both' : hasBet ? 'turnoverOnly' : 'noBet'
    if (hasBet) { activeDaysCount++; monthValidBet += rec.vb }
    if (hasDeposit) { depositDaysCount++; monthDeposit += rec.dep }
    if (hasWithdrawal) { withdrawalDaysCount++; monthWithdrawal += rec.wd }
    if (state === 'turnoverOnly') turnoverOnlyDaysCount++
    return { dateStr, dayNum, state, rec, isFuture }
  })
  const activeRatePct = elapsedDays > 0 ? Math.round(activeDaysCount / elapsedDays * 100) : 0
  const depositRatePct = elapsedDays > 0 ? Math.round(depositDaysCount / elapsedDays * 100) : 0
  const withdrawalRatePct = elapsedDays > 0 ? Math.round(withdrawalDaysCount / elapsedDays * 100) : 0

  const STATE_STYLE = {
    both:         { bg:'#3fb950', color:'#fff' },
    turnoverOnly: { bg:'#d29922', color:'#fff' },
    noBet:        { bg:'var(--border)', color:'var(--muted)' },
    noData:       { bg:'var(--surface2)', color:'var(--muted)' },
  }

  return (
    <div>
      <div style={{ display:'flex', gap:16, marginBottom:10, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:'#3fb950' }}>{t('vipDetail.depositDaysLabel', { n: `${depositDaysCount}/${elapsedDays}` })}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('vipDetail.depositDaysThisMonth', { month })}</div>
        </div>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:'#d29922' }}>{turnoverOnlyDaysCount}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('vipDetail.turnoverOnlyDays')}</div>
        </div>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:'#3fb950' }}>{rmFmt(monthDeposit, currency)}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('vipDetail.depositThisMonth', { month })}</div>
        </div>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:'var(--accent)' }}>{rmFmt(monthValidBet, currency)}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('vipDetail.validBetThisMonth', { month })}</div>
        </div>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color: activeRatePct>=70?'#3fb950':activeRatePct>=30?'#f0883e':'#f85149' }}>{activeRatePct}%</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('vipDetail.activeRateThisMonth', { month })}</div>
        </div>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:'#3fb950' }}>{depositRatePct}%</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('vipDetail.depositRateThisMonth', { month })}</div>
        </div>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color: withdrawalRatePct>=50 ? '#f85149' : 'var(--text)' }}>{withdrawalRatePct}%</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{t('vipDetail.withdrawalRateThisMonth', { month })}</div>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(10, 1fr)', gap:4 }}>
        {cells.map(c => {
          const sty = STATE_STYLE[c.state]
          const bg = c.isFuture ? 'transparent' : sty.bg
          const color = c.isFuture ? 'var(--muted)' : sty.color
          const opacity = c.isFuture ? 0.3 : 1
          const title = c.isFuture
            ? c.dateStr + ' ' + t('vipDetail.notArrivedYet')
            : `${c.dateStr} — ${t('common.deposit')}: ${c.rec ? rmFmt(c.rec.dep, currency) : 'N/A'}, ${t('common.validBet')}: ${c.rec ? rmFmt(c.rec.vb, currency) : 'N/A'}`
          return (
            <div key={c.dateStr} title={title}
              style={{ aspectRatio:'0.8', borderRadius:5, background:bg, color, opacity, border:c.isFuture?'1px dashed var(--border)':'none', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:600, lineHeight:1.3 }}>
              <span>{c.dayNum}</span>
              {!c.isFuture && c.state === 'both' && <span style={{ fontSize:8, fontWeight:700, opacity:.9 }}>{compactAmt(c.rec.dep)}</span>}
            </div>
          )
        })}
      </div>
      <div style={{ display:'flex', gap:14, marginTop:8, fontSize:10, color:'var(--muted)', flexWrap:'wrap' }}>
        <span><span style={{ display:'inline-block', width:9, height:9, borderRadius:2, background:'#3fb950', marginRight:4 }} />{t('vipDetail.legendBoth')}</span>
        <span><span style={{ display:'inline-block', width:9, height:9, borderRadius:2, background:'#d29922', marginRight:4 }} />{t('vipDetail.legendTurnoverOnly')}</span>
        <span><span style={{ display:'inline-block', width:9, height:9, borderRadius:2, background:'var(--border)', marginRight:4 }} />{t('vipDetail.noBetLegend')}</span>
        <span><span style={{ display:'inline-block', width:9, height:9, borderRadius:2, background:'var(--surface2)', marginRight:4 }} />{t('vipDetail.noDataLegend')}</span>
      </div>
    </div>
  )
}

// {month}周度分解 — 每周固定从1号起算7天（1-7,8-14,15-21,22-28,29-月底）
// 活跃率 = 该周有投注天数 / 该周天数；存款占比 = 该周存款 / 整月总存款
// 存款按 monthly_valid_bet>0 才计入，避免平台脏数据（非活跃日残留旧存款数字）污染周度数字
function WeeklyBreakdown({ snaps, month, monthTotalDeposit, currency }) {
  const { t } = useLanguage()
  if (!month || snaps.length === 0) return null
  const byDate = {}
  snaps.forEach(s => { byDate[s.snapshot_date] = { vb: parseFloat(s.monthly_valid_bet) || 0, dep: parseFloat(s.total_deposit) || 0 } })

  const [y, m] = month.split('-').map(Number)
  const totalDaysInMonth = new Date(y, m, 0).getDate()
  const now = new Date()
  const curMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const isCurrentMonth = month === curMonthStr
  const elapsedDays = isCurrentMonth ? now.getDate() : totalDaysInMonth

  // Build fixed weekly ranges: 1-7, 8-14, 15-21, 22-28, 29-end
  const weekRanges = []
  let start = 1
  while (start <= totalDaysInMonth) {
    const end = Math.min(start + 6, totalDaysInMonth)
    weekRanges.push([start, end])
    start = end + 1
  }

  const weeks = weekRanges.map(([wStart, wEnd], idx) => {
    let activeDays = 0, weekDeposit = 0, effectiveDays = 0
    for (let d = wStart; d <= wEnd; d++) {
      if (isCurrentMonth && d > elapsedDays) continue // future day within current month, skip
      effectiveDays++
      const rec = byDate[`${month}-${String(d).padStart(2, '0')}`]
      if (rec && rec.vb > 0) { activeDays++; weekDeposit += rec.dep }
    }
    const activeRatePct = effectiveDays > 0 ? Math.round((activeDays / effectiveDays) * 100) : 0
    const depositSharePct = monthTotalDeposit > 0 ? (weekDeposit / monthTotalDeposit * 100) : 0
    return { label: t('vipDetail.weekLabel', { n: idx + 1 }), range: `${m}/${wStart}-${wEnd}`, activeDays, effectiveDays, activeRatePct, weekDeposit, depositSharePct }
  }).filter(w => w.effectiveDays > 0) // hide fully-future weeks when viewing current month

  if (weeks.length === 0) return null

  return (
    <div style={{ marginTop:16 }}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>📊 {t('vipDetail.weeklyBreakdownTitle', { month })}</div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid var(--border)' }}>
            <th style={{ textAlign:'left', padding:'4px 6px', color:'var(--muted)', fontWeight:600 }}>{t('vipDetail.colWeek')}</th>
            <th style={{ textAlign:'left', padding:'4px 6px', color:'var(--muted)', fontWeight:600 }}>{t('vipDetail.colActiveRate')}</th>
            <th style={{ textAlign:'left', padding:'4px 6px', color:'var(--muted)', fontWeight:600 }}>{t('vipDetail.colDepositShare')}</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map(w => (
            <tr key={w.label} style={{ borderBottom:'1px solid var(--border)' }}>
              <td style={{ padding:'6px', fontWeight:600, whiteSpace:'nowrap' }}>{w.label} <span style={{ color:'var(--muted)', fontWeight:400 }}>({w.range})</span></td>
              <td style={{ padding:'6px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ width:56, height:6, background:'var(--surface2)', borderRadius:3, overflow:'hidden', flexShrink:0 }}>
                    <div style={{ width:w.activeRatePct+'%', height:'100%', background: w.activeRatePct>=70?'#3fb950':w.activeRatePct>=30?'#f0883e':'#f85149', borderRadius:3 }} />
                  </div>
                  <span style={{ fontWeight:700, minWidth:32 }}>{w.activeRatePct}%</span>
                  <span style={{ color:'var(--muted)', fontSize:10 }}>{t('vipDetail.daysShort', { active: w.activeDays, total: w.effectiveDays })}</span>
                </div>
              </td>
              <td style={{ padding:'6px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ width:56, height:6, background:'var(--surface2)', borderRadius:3, overflow:'hidden', flexShrink:0 }}>
                    <div style={{ width:Math.min(100,w.depositSharePct)+'%', height:'100%', background:'#a78bfa', borderRadius:3 }} />
                  </div>
                  <span style={{ fontWeight:700, minWidth:38 }}>{w.depositSharePct.toFixed(1)}%</span>
                  <span style={{ color:'var(--muted)', fontSize:10 }}>{rmFmt(w.weekDeposit, currency)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
// 玩家历史月度趋势图 — ROI / 有效流水 / 盈亏 三条线，数据来自 vip_monthly_totals（按日累加的月度视图）
function MonthlyTrendChart({ trend }) {
  const { t } = useLanguage()
  if (!trend || trend.length === 0) {
    return <div style={{ fontSize:12, color:'var(--muted)', padding:'8px 0' }}>{t('vipDetail.noHistoricalMonthlyData')}</div>
  }

  const rows = trend.map(t => {
    const vb = parseFloat(t.monthly_valid_bet) || 0
    const wl = parseFloat(t.win_loss) || 0
    const roi = vb > 0 ? (wl / vb * 100) : 0
    return { month: t.snapshot_month, vb, wl, roi }
  })

  if (rows.length < 2) {
    return <div style={{ fontSize:12, color:'var(--muted)', padding:'8px 0' }}>{t('vipDetail.noHistoricalMonthlyData')}</div>
  }

  const W = 560, H = 160, padL = 36, padR = 10, padT = 14, padB = 22
  const plotW = W - padL - padR, plotH = H - padT - padB
  const n = rows.length
  const xFor = i => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)

  function buildLine(values, color, key) {
    const max = Math.max(...values, 0)
    const min = Math.min(...values, 0)
    const range = (max - min) || 1
    const yFor = v => padT + plotH - ((v - min) / range) * plotH
    const points = values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ')
    return { points, yFor, color, key }
  }

  const roiLine = buildLine(rows.map(r => r.roi), '#f59e0b', 'roi')
  const vbLine  = buildLine(rows.map(r => r.vb),  '#58a6ff', 'vb')
  const wlLine  = buildLine(rows.map(r => r.wl),  '#3fb950', 'wl')

  return (
    <div>
      <div style={{ display:'flex', gap:16, marginBottom:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, color:'#f59e0b', fontWeight:700 }}>● ROI %</span>
        <span style={{ fontSize:11, color:'#58a6ff', fontWeight:700 }}>● {t('vipDetail.legendValidBet')}</span>
        <span style={{ fontSize:11, color:'#3fb950', fontWeight:700 }}>● {t('vipDetail.legendWinLoss')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto' }}>
        {/* zero baseline for ROI/WL reference */}
        <line x1={padL} y1={padT+plotH} x2={W-padR} y2={padT+plotH} stroke="var(--border)" strokeWidth="1" />
        <polyline points={vbLine.points}  fill="none" stroke={vbLine.color}  strokeWidth="2" opacity="0.85" />
        <polyline points={wlLine.points}  fill="none" stroke={wlLine.color}  strokeWidth="2" opacity="0.85" />
        <polyline points={roiLine.points} fill="none" stroke={roiLine.color} strokeWidth="2.5" />
        {rows.map((r, i) => (
          <g key={r.month}>
            <circle cx={xFor(i)} cy={roiLine.yFor(r.roi)} r="3" fill={roiLine.color} />
            <text x={xFor(i)} y={H-4} fontSize="9" fill="var(--muted)" textAnchor="middle">{r.month.slice(5)}</text>
          </g>
        ))}
      </svg>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${n}, 1fr)`, gap:4, marginTop:6 }}>
        {rows.map(r => (
          <div key={r.month} style={{ textAlign:'center' }}>
            <div style={{ fontSize:11, fontWeight:700, color: r.roi > 0 ? '#f85149' : '#3fb950' }}>{r.roi >= 0 ? '+' : ''}{r.roi.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function VIPDetail() {
  const { id }       = useParams()
  const navigate     = useNavigate()
  const { profile }  = useAuth()
  const { t, lang }  = useLanguage()

  const [vip, setVip]             = useState(null)
  const [loading, setLoading]     = useState(true)
  const [logs, setLogs]           = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [activeTab, setActiveTab] = useUrlParam('tab', 'overview')
  const [deepDive, setDeepDive] = useState(null)
  const [deepDiveLoading, setDeepDiveLoading] = useState(false)
  const [summary, setSummary] = useState(null)
  const [summarizing, setSummarizing] = useState(false)
  const [editing, setEditing]     = useState(false)
  const [editData, setEditData]   = useState({})
  const [hosts,         setHosts]         = useState([])
  const [changingHost,  setChangingHost]  = useState(false)
  const [newHost,       setNewHost]       = useState('')
  const [savingHost,    setSavingHost]    = useState(false)
  const [saving, setSaving]       = useState(false)
  const [showLogForm, setShowLogForm] = useState(false)
  const [logForm, setLogForm]         = useState({ contact_type:'WhatsApp', outcome:'Contacted', bonus_offered:'', bonus_type:'', notes:'' })
  const [submittingLog, setSubmittingLog] = useState(false)
  const [editingLogId, setEditingLogId]   = useState(null)
  const [editingLogNote, setEditingLogNote] = useState('')
  const [dailySnaps, setDailySnaps] = useState([]) // daily deposit snapshots for the selected month
  const [monthlyTrend, setMonthlyTrend] = useState([]) // historical vip_monthly_totals for ROI/turnover/win-loss trend
  const [monthlyTotals, setMonthlyTotals] = useState(null) // selected-month true totals from vip_monthly_totals view
  const [tierShare, setTierShare] = useState(null) // this player's % share of total deposit within their tier+currency, selected month
  const [availableMonths, setAvailableMonths] = useState([]) // months this player has data for, desc order
  const [selectedMonth, setSelectedMonth] = useState(null) // 'YYYY-MM' currently viewed

  // FIX: only load when id is a valid UUID
  useEffect(() => {
    if (id && id !== 'null' && id !== 'undefined') loadAll()
  }, [id])

  // Lazy-loaded only when the tab is actually opened — this pulls the VIP's
  // entire history plus a site-wide comparison query, meaningfully heavier
  // than anything else on this page, so no reason to pay that cost on every
  // VIP page visit if nobody looks at this tab.
  useEffect(() => {
    if (activeTab === 'deepdive' && !deepDive && vip?.username) loadDeepDive()
  }, [activeTab, vip?.username])

  async function loadDeepDive() {
    setDeepDiveLoading(true)
    try {
      const [{ data: history, error: historyErr }, { data: dailyAll, error: dailyErr }] = await Promise.all([
        supabase.from('vip_monthly_totals')
          .select('snapshot_month, total_deposit, total_withdrawal, monthly_valid_bet, win_loss, total_rebate, bonus_amount')
          .eq('username', vip.username)
          .order('snapshot_month', { ascending: true }),
        supabase.from('vip_daily_snapshots')
          .select('snapshot_date, win_loss, monthly_valid_bet')
          .eq('username', vip.username)
          .order('snapshot_date', { ascending: true }),
      ])
      if (historyErr) console.error('loadDeepDive history error', historyErr)
      if (dailyErr) console.error('loadDeepDive daily error', dailyErr)

      // Net contribution = company gross P/L (i.e. -win_loss, since win_loss is
      // the PLAYER's win/loss) minus rebate minus bonus. Same formula used in
      // the earlier VIP program review work this session.
      const monthlyHistory = (history || []).map(m => {
        const deposit = parseFloat(m.total_deposit) || 0
        const withdrawal = parseFloat(m.total_withdrawal) || 0
        const validBet = parseFloat(m.monthly_valid_bet) || 0
        const winLoss = parseFloat(m.win_loss) || 0
        const rebate = parseFloat(m.total_rebate) || 0
        const bonus = parseFloat(m.bonus_amount) || 0
        const companyGross = -winLoss
        const netContribution = companyGross - rebate - bonus
        return { month: m.snapshot_month, deposit, withdrawal, validBet, companyGross, rebate, bonus, netContribution }
      })

      const lifetimeDeposit = monthlyHistory.reduce((s, m) => s + m.deposit, 0)
      const lifetimeWithdrawal = monthlyHistory.reduce((s, m) => s + m.withdrawal, 0)
      const lifetimeValidBet = monthlyHistory.reduce((s, m) => s + m.validBet, 0)
      const lifetimeNet = monthlyHistory.reduce((s, m) => s + m.netContribution, 0)
      const netMarginLifetime = lifetimeValidBet > 0 ? lifetimeNet / lifetimeValidBet * 100 : 0
      const last6 = monthlyHistory.slice(-6)
      const last6ValidBet = last6.reduce((s, m) => s + m.validBet, 0)
      const last6Net = last6.reduce((s, m) => s + m.netContribution, 0)
      const netMarginRecent6 = last6ValidBet > 0 ? last6Net / last6ValidBet * 100 : 0

      // Daily volatility — biggest single-day company win/loss and standard
      // deviation, computed from full history, not just the selected month.
      const dailyWinLoss = (dailyAll || []).map(d => -(parseFloat(d.win_loss) || 0)) // flip to company's perspective
      const maxCompanyLossDay = dailyWinLoss.length ? Math.min(...dailyWinLoss) : 0 // most negative = worst day for company
      const maxCompanyWinDay = dailyWinLoss.length ? Math.max(...dailyWinLoss) : 0
      const avgDaily = dailyWinLoss.length ? dailyWinLoss.reduce((s,v)=>s+v,0) / dailyWinLoss.length : 0
      const variance = dailyWinLoss.length ? dailyWinLoss.reduce((s,v)=>s+(v-avgDaily)**2,0) / dailyWinLoss.length : 0
      const stdDev = Math.sqrt(variance)
      const maxDailyValidBet = (dailyAll || []).reduce((max, d) => Math.max(max, parseFloat(d.monthly_valid_bet) || 0), 0)

      // Site-wide comparison for the current month, same currency — rank by
      // valid bet, and this VIP's share of total deposit among all VIPs in
      // the same currency (not just same tier, unlike the Overview tab's
      // tierShare — this is the broader, site-wide concentration figure).
      let rankInfo = null
      const currentMonth = new Date().toISOString().slice(0, 7)
      const monthToRank = monthlyHistory.some(m => m.month === currentMonth) ? currentMonth : (monthlyHistory[monthlyHistory.length-1]?.month || currentMonth)
      if (vip.currency) {
        const { data: allThisMonth, error: rankErr } = await supabase
          .from('vip_monthly_totals')
          .select('username, total_deposit, monthly_valid_bet')
          .eq('snapshot_month', monthToRank)
          .eq('currency', vip.currency)
        if (rankErr) console.error('loadDeepDive rank error', rankErr)
        if (allThisMonth && allThisMonth.length) {
          const sorted = [...allThisMonth].sort((a,b) => (parseFloat(b.monthly_valid_bet)||0) - (parseFloat(a.monthly_valid_bet)||0))
          const rank = sorted.findIndex(r => r.username === vip.username) + 1
          const totalDeposit = allThisMonth.reduce((s,r) => s + (parseFloat(r.total_deposit)||0), 0)
          const myDeposit = allThisMonth.find(r => r.username === vip.username)
          rankInfo = {
            month: monthToRank,
            rank: rank > 0 ? rank : null,
            totalPlayers: sorted.length,
            depositSharePct: totalDeposit > 0 ? ((parseFloat(myDeposit?.total_deposit)||0) / totalDeposit * 100) : 0,
          }
        }
      }

      setDeepDive({
        monthlyHistory, lifetimeDeposit, lifetimeWithdrawal, lifetimeValidBet, lifetimeNet, netMarginLifetime, netMarginRecent6,
        maxCompanyLossDay, maxCompanyWinDay, stdDev, maxDailyValidBet, rankInfo,
      })
    } finally {
      setDeepDiveLoading(false)
    }
  }

  useEffect(() => {
    async function loadHosts() {
      const { data } = await supabase.from('profiles').select('full_name').in('role',['admin','host']).order('full_name')
      setHosts((data||[]).map(h => h.full_name).filter(Boolean))
    }
    loadHosts()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: vipData }, { data: logData }, { data: campData }] = await Promise.all([
      supabase.from('vip_members').select('*').eq('id', id).single(),
      supabase.from('contact_logs').select('*').eq('vip_id', id).order('logged_at', { ascending: false }).limit(50),
      // FIX: removed order by joined_at - use added_at instead which exists
      supabase.from('campaign_players').select('*, campaigns(campaign_name, start_date, end_date, status)').eq('vip_id', id).order('added_at', { ascending: false }),
    ])
    if (vipData) {
      setVip(vipData); setEditData(vipData)
      loadMonthlyTrend(vipData.username)
      const { data: monthRows } = await supabase
        .from('vip_monthly_totals')
        .select('snapshot_month')
        .eq('username', vipData.username)
        .order('snapshot_month', { ascending: false })
      const months = (monthRows || []).map(r => r.snapshot_month)
      setAvailableMonths(months)
      const now = new Date()
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      // Default to current month if it has data yet, otherwise the most recent month that does
      const defaultMonth = months.includes(thisMonth) ? thisMonth : (months[0] || thisMonth)
      setSelectedMonth(defaultMonth)
      loadMonthData(vipData.username, vipData.tier, vipData.currency, defaultMonth)
    }
    setLogs(logData || [])
    setCampaigns(campData || [])
    setLoading(false)
  }

  async function handleSummarize() {
    if (!vip) return
    setSummarizing(true)
    try {
      const result = await callAI('summarize', {
        username: vip.username,
        tier: vip.tier,
        currency: vip.currency,
        financials: {
          totalDeposit: vip.total_deposit,
          winLoss: vip.win_loss,
          daysInactive: vip.days_inactive,
          status: vip.activity_status,
        },
        recentLogs: logs.slice(0, 15).map(l => ({ logged_at: l.logged_at, channel: l.channel, outcome: l.outcome, notes: l.notes })),
        language: lang,
      })
      setSummary(result.summary)
    } catch (e) {
      alert('Could not generate summary: ' + e.message)
    } finally {
      setSummarizing(false)
    }
  }

  function handleMonthChange(newMonth) {
    setSelectedMonth(newMonth)
    if (vip) loadMonthData(vip.username, vip.tier, vip.currency, newMonth)
  }

  async function loadMonthlyTrend(username) {
    if (!username) return
    const { data } = await supabase
      .from('vip_monthly_totals')
      .select('snapshot_month, monthly_valid_bet, win_loss')
      .eq('username', username)
      .order('snapshot_month', { ascending: true })
      .limit(12)
    setMonthlyTrend(data || [])
  }

  async function loadMonthData(username, tier, currency, month) {
    if (!username || !month) return
    const [y, m] = month.split('-').map(Number)
    const startStr = `${month}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const endStr = `${month}-${String(lastDay).padStart(2, '0')}`

    const [{ data: snapData }, { data: totalsData }] = await Promise.all([
      supabase.from('vip_daily_snapshots')
        .select('snapshot_date, monthly_valid_bet, total_deposit, total_withdrawal')
        .eq('username', username)
        .gte('snapshot_date', startStr)
        .lte('snapshot_date', endStr)
        .order('snapshot_date', { ascending: true }),
      supabase.from('vip_monthly_totals')
        .select('*')
        .eq('username', username)
        .eq('snapshot_month', month)
        .maybeSingle(),
    ])
    setDailySnaps(snapData || [])
    setMonthlyTotals(totalsData || null)

    // Deposit Rate = this player's share of total deposit among same-tier, same-currency
    // players for the SELECTED month. Filter by currency server-side (safe eq), then filter
    // tier client-side to avoid enum-cast quirks with PostgREST filters on the view's tier column.
    if (tier && currency) {
      const { data: tierRows } = await supabase
        .from('vip_monthly_totals')
        .select('username, tier, currency, total_deposit')
        .eq('snapshot_month', month)
        .eq('currency', currency)
      const sameTier = (tierRows || []).filter(r => r.tier === tier)
      const tierTotal = sameTier.reduce((s, r) => s + (parseFloat(r.total_deposit) || 0), 0)
      const myDeposit = parseFloat(totalsData?.total_deposit) || 0
      setTierShare({
        month,
        tierTotal,
        myDeposit,
        pct: tierTotal > 0 ? (myDeposit / tierTotal * 100) : 0,
        playerCount: sameTier.length,
      })
    } else {
      setTierShare(null)
    }
  }

  async function saveEdit() {
    setSaving(true)
    const { error } = await supabase.from('vip_members').update({
      full_name: editData.full_name, phone: editData.phone, whatsapp: editData.whatsapp,
      email: editData.email, address: editData.address, race: editData.race,
      tier: editData.tier, host_assigned: editData.host_assigned,
      activity_status: editData.activity_status, lang_pref: editData.lang_pref,
      msg_style: editData.msg_style, best_contact_time: editData.best_contact_time,
      city_state: editData.city_state, birthday: editData.birthday,
      fav_game: editData.fav_game, fav_game_2: editData.fav_game_2,
      personality_notes: editData.personality_notes,
      interests_topics: editData.interests_topics,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (!error) { await loadAll(); setEditing(false) }
    setSaving(false)
  }

  async function submitLog() {
    if (!logForm.notes.trim()) return
    setSubmittingLog(true)
    // FIX: get auth user for host_id to satisfy RLS policy
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('contact_logs').insert({
      vip_id:        id,
      username:      vip.username,
      tier:          vip.tier,
      host_name:     profile?.full_name || 'Marcus',
      host_id:       user?.id || null,
      logged_at:     new Date().toISOString(),
      channel:       logForm.contact_type,
      log_month:     new Date().toISOString().slice(0,7),
      log_week:      String(Math.ceil(new Date().getDate()/7)),
      direction:     'outbound',
      outcome:       logForm.outcome,
      notes:         logForm.notes,
    })
    if (error) { alert('Failed to save: ' + error.message); setSubmittingLog(false); return }
    setLogForm({ contact_type:'WhatsApp', outcome:'Contacted', bonus_offered:'', bonus_type:'', notes:'' })
    setShowLogForm(false)
    setSubmittingLog(false)
    loadAll()
  }

  async function deleteLog(logId) {
    if (!window.confirm('Delete this contact log?')) return
    await supabase.from('contact_logs').delete().eq('id', logId)
    loadAll()
  }

  async function saveHost() {
    if (!newHost || newHost === vip.host_assigned) { setChangingHost(false); return }
    setSavingHost(true)
    const { error } = await supabase
      .from('vip_members')
      .update({ host_assigned: newHost, updated_at: new Date().toISOString() })
      .eq('id', vip.id)
    if (!error) { await loadAll(); setChangingHost(false) }
    else alert('Error: ' + error.message)
    setSavingHost(false)
  }

  async function saveLogEdit(logId) {
    await supabase.from('contact_logs').update({ notes: editingLogNote, message_summary: editingLogNote }).eq('id', logId)
    setEditingLogId(null)
    loadAll()
  }

  if (loading) return <div style={{ ...s.page, display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}><div style={{ color:'var(--muted)', fontSize:14 }}>Loading VIP profile...</div></div>
  if (!vip) return <div style={{ ...s.page, display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}><div style={{ color:'#f85149', fontSize:14 }}>VIP not found.</div></div>

  const score = vip.vip_score || 0
  const scoreColor = score >= 80 ? '#3fb950' : score >= 60 ? '#d29922' : '#f85149'

  let birthdayBadge = null
  if (vip.birthday) {
    const today = new Date()
    const bday  = new Date(vip.birthday)
    const next  = new Date(today.getFullYear(), bday.getMonth(), bday.getDate())
    if (next < today) next.setFullYear(today.getFullYear() + 1)
    const days  = Math.ceil((next - today) / 86400000)
    if (days <= 30) birthdayBadge = days === 0 ? 'Birthday TODAY!' : `Birthday in ${days}d`
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <div style={s.page}>
      <div style={{ position:'sticky', top:0, zIndex:20, background:'var(--bg)', paddingTop:2 }}>
        <button style={s.back} onClick={() => navigate(-1)}>Back to VIP Members</button>

        {/* Header */}
        <div style={{ ...s.card, marginBottom:20 }}>
          <div style={{ padding:'22px 24px', display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:16 }}>
              <div style={{ width:56, height:56, borderRadius:'50%', background:TIER_BG[vip.tier]||'var(--surface2)', border:`2px solid ${TIER_COLOR[vip.tier]||'var(--border)'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:700, color:TIER_COLOR[vip.tier]||'var(--text)' }}>
                {(vip.username||'?')[0].toUpperCase()}
              </div>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span style={{ fontSize:24, fontWeight:700, color:'var(--text)' }}>{vip.username}</span>
                  <span style={{ ...s.badge, background:TIER_BG[vip.tier], color:TIER_COLOR[vip.tier] }}>{vip.tier}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:STATUS_COLOR[vip.activity_status]||'var(--muted)' }}>• {vip.activity_status||'Unknown'}</span>
                  {birthdayBadge && <span style={{ fontSize:12, fontWeight:700, color:'#d29922', background:'rgba(210,153,34,.12)', padding:'2px 10px', borderRadius:10 }}>{birthdayBadge}</span>}
                </div>
                <div style={{ fontSize:13, color:'var(--muted)', marginTop:4 }}>{vip.full_name||'(No name)'} · ID: {vip.vip_id} · Host: {vip.host_assigned||'-'}</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {isAdmin && !editing && <button style={s.btnSm} onClick={() => setEditing(true)}>Edit Profile</button>}
              {editing && <>
                <button style={s.btn} onClick={saveEdit} disabled={saving}>{saving?'Saving...':'Save Changes'}</button>
                <button style={s.btnSm} onClick={() => { setEditing(false); setEditData(vip) }}>Cancel</button>
              </>}
              <button style={{ ...s.btnSm, background:'#7c3aed', color:'#fff', border:'none' }} disabled={summarizing} onClick={handleSummarize}>
                {summarizing ? '⏳ Summarizing…' : '✨ Summarize'}
              </button>
              <button style={{ ...s.btn, background:'#1a7f37' }} onClick={() => { setShowLogForm(true); setActiveTab('contacts') }}>Log Contact</button>
            </div>
          </div>
          {summary && (
            <div style={{ background:'rgba(124,58,237,.08)', border:'1px solid rgba(124,58,237,.3)', borderRadius:10, padding:'14px 18px', marginBottom:16, display:'flex', gap:10 }}>
              <div style={{ fontSize:18 }}>✨</div>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:'#a78bfa', marginBottom:4, textTransform:'uppercase', letterSpacing:'.5px' }}>AI Summary</div>
                <div style={{ fontSize:13, lineHeight:1.6, color:'var(--text)' }}>{summary}</div>
              </div>
              <button onClick={() => setSummary(null)} style={{ marginLeft:'auto', background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:16, alignSelf:'flex-start' }}>×</button>
            </div>
          )}
          <div style={{ padding:'14px 24px', borderTop:'1px solid var(--border)', background:'var(--surface2)', display:'flex', gap:32, flexWrap:'wrap', borderRadius:'0 0 12px 12px' }}>
            {[
              { label:'VIP Score',     value:score||'-',    color:scoreColor },
              { label:'Churn Risk',    value:vip.churn_risk||'-', color:CHURN_COLOR[vip.churn_risk]||'var(--muted)' },
              { label:'Days Inactive', value:vip.days_inactive!=null?(vip.days_inactive===0?'Today':vip.days_inactive+'d'):'-', color:vip.days_inactive<=7?'#3fb950':vip.days_inactive<=30?'#d29922':'#f85149' },
              { label:"Today's Deposit", value:rmFmt(vip.total_deposit, vip?.currency), color:'#3fb950' },
              { label:'Win/Loss',      value:null, wl:vip.win_loss },
              { label:'Predicted Dep', value:vip.predicted_dep_pct?vip.predicted_dep_pct+'%':'-', color:'var(--accent)' },
            ].map(({ label, value, color, wl }) => (
              <div key={label} style={{ textAlign:'center', minWidth:80 }}>
                <div style={{ fontSize:20, fontWeight:700, color:color||'var(--text)' }}>{wl!==undefined?wlFmt(wl, vip?.currency):value}</div>
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{label}</div>
              </div>
            ))}
            <div style={{ flex:1, minWidth:120, display:'flex', flexDirection:'column', justifyContent:'center' }}>
              <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4 }}>Score Progress</div>
              <div style={{ height:6, background:'var(--border)', borderRadius:4, overflow:'hidden' }}>
                <div style={{ width:Math.min(100,score)+'%', height:'100%', background:scoreColor, borderRadius:4 }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'1px solid var(--border)' }}>
        {[
          { id:'overview',  label:'Overview' },
          { id:'contacts',  label:`Contact Log (${logs.length})` },
          { id:'campaigns', label:`Campaigns (${campaigns.length})` },
          { id:'churn',     label:'Churn & Activity' },
          { id:'deepdive',  label:'📊 Deep Analysis' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ background:'none', border:'none', cursor:'pointer', padding:'10px 18px', fontSize:13, fontWeight:600, color:activeTab===tab.id?'var(--accent)':'var(--muted)', borderBottom:activeTab===tab.id?'2px solid var(--accent)':'2px solid transparent', transition:'color .15s' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div style={s.card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <SectionHeader icon="💰" title="Financial" />
              {availableMonths.length > 0 && (
                <select value={selectedMonth || ''} onChange={e => handleMonthChange(e.target.value)}
                  style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'4px 10px', borderRadius:6, fontSize:12, marginRight:16, cursor:'pointer' }}>
                  {availableMonths.map(mo => <option key={mo} value={mo}>{mo}</option>)}
                </select>
              )}
            </div>
            <div style={{ ...s.cardBody, ...s.grid3 }}>
              <Field label={t('vipDetail.totalDepositToday')}    value={rmFmt(vip.total_deposit, vip?.currency)} color="#3fb950" />
              <Field label={t('vipDetail.totalWithdrawalToday')} value={rmFmt(vip.total_withdrawal, vip?.currency)} />
              <Field label="Win/Loss"><span>{wlFmt(vip.win_loss, vip?.currency)}</span></Field>
              <Field label="# Deposits"   value={vip.deposit_count} />
              <Field label="Last Deposit"  value={formatDate(vip.last_deposit_date)} />
              <Field label="Avg Bet Size"  value={rmFmt(vip.avg_bet_size, vip?.currency)} />
            </div>
            {monthlyTotals ? (
              <div style={{ padding:'0 20px 14px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>📆 {t('vipDetail.accumulatedFor', { month: monthlyTotals.snapshot_month, days: monthlyTotals.days_with_data })}</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px 16px' }}>
                  <Field label={t('vipDetail.monthTotalDeposit', { month: selectedMonth })}   value={rmFmt(monthlyTotals.total_deposit, vip?.currency)} color="#3fb950" />
                  <Field label={t('vipDetail.monthTotalWithdrawal', { month: selectedMonth })}   value={rmFmt(monthlyTotals.total_withdrawal, vip?.currency)} />
                  <Field label={t('vipDetail.monthValidBet', { month: selectedMonth })} value={rmFmt(monthlyTotals.monthly_valid_bet, vip?.currency)} color="var(--accent)" />
                  {tierShare && (
                    <Field label={t('vipDetail.tierDepositShare', { tier: vip.tier })} color="#a78bfa">
                      <div>
                        {tierShare.pct.toFixed(1)}%
                        <div style={{ fontSize:10, color:'var(--muted)', fontWeight:400, marginTop:2 }}>
                          {rmFmt(tierShare.myDeposit, vip?.currency)} / {rmFmt(tierShare.tierTotal, vip?.currency)}{t('vipDetail.playersAndCurrency', { count: tierShare.playerCount, currency: vip.currency })}
                        </div>
                      </div>
                    </Field>
                  )}
                </div>
              </div>
            ) : selectedMonth && (
              <div style={{ padding:'0 20px 14px', fontSize:12, color:'var(--muted)' }}>{t('vipDetail.noDataForMonth', { month: selectedMonth })}</div>
            )}
            <div style={{ padding:'0 20px 18px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>📅 {t('vipDetail.depositRecordsFor', { month: selectedMonth || '' })}</div>
              <DepositCalendar snaps={dailySnaps} month={selectedMonth} currency={vip?.currency} />
              <WeeklyBreakdown snaps={dailySnaps} month={selectedMonth} monthTotalDeposit={parseFloat(monthlyTotals?.total_deposit) || 0} currency={vip?.currency} />
            </div>
          </div>
          <div style={s.card}>
            <SectionHeader icon="📞" title="Contact Status" />
            <div style={{ ...s.cardBody, ...s.grid2 }}>
              {(() => {
                const sortedLogs = [...logs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at))
                const lastLog = sortedLogs[0]
                const thisMonthStr = new Date().toISOString().slice(0, 7)
                const touchesThisMonth = logs.filter(l => (l.logged_at || '').slice(0, 7) === thisMonthStr).length
                const daysSinceContact = lastLog ? Math.floor((new Date() - new Date(lastLog.logged_at)) / (1000*60*60*24)) : null
                return (
                  <>
                    <Field label="Last Contact" value={lastLog ? formatDate(lastLog.logged_at) : t('common.never')} />
                    <Field label="Days Since Contact">
                      {daysSinceContact === null ? <span style={{ color:'var(--muted)' }}>—</span> :
                        <span style={{ color: daysSinceContact >= 14 ? '#f85149' : daysSinceContact >= 7 ? '#d29922' : '#3fb950', fontWeight:700 }}>{daysSinceContact}d</span>}
                    </Field>
                    <Field label="Contacted By" value={lastLog?.host_name || '—'} />
                    <Field label="Last Outcome" value={lastLog?.outcome || '—'} />
                    <Field label="Touches This Month" value={touchesThisMonth} />
                    <Field label="Total Logs" value={logs.length} />
                  </>
                )
              })()}
            </div>
          </div>
          <div style={s.card}>
            <SectionHeader icon="📱" title="Contact Info" />
            <div style={{ ...s.cardBody, ...s.grid2 }}>
              {editing ? <>
                <div><div style={s.flbl}>Phone</div><input style={{...s.input,marginTop:4}} value={editData.phone||''} onChange={e=>setEditData({...editData,phone:e.target.value})} /></div>
                <div><div style={s.flbl}>WhatsApp</div><input style={{...s.input,marginTop:4}} value={editData.whatsapp||''} onChange={e=>setEditData({...editData,whatsapp:e.target.value})} /></div>
                <div><div style={s.flbl}>Email</div><input style={{...s.input,marginTop:4}} value={editData.email||''} onChange={e=>setEditData({...editData,email:e.target.value})} /></div>
                <div><div style={s.flbl}>Address</div><input style={{...s.input,marginTop:4}} value={editData.address||''} onChange={e=>setEditData({...editData,address:e.target.value})} /></div>
                <div><div style={s.flbl}>Language</div><input style={{...s.input,marginTop:4}} value={editData.lang_pref||''} onChange={e=>setEditData({...editData,lang_pref:e.target.value})} /></div>
                <div><div style={s.flbl}>Msg Style</div><input style={{...s.input,marginTop:4}} value={editData.msg_style||''} onChange={e=>setEditData({...editData,msg_style:e.target.value})} /></div>
                <div><div style={s.flbl}>Best Contact Time</div><input style={{...s.input,marginTop:4}} value={editData.best_contact_time||''} onChange={e=>setEditData({...editData,best_contact_time:e.target.value})} /></div>
                <div><div style={s.flbl}>Host Assigned</div><input style={{...s.input,marginTop:4}} value={editData.host_assigned||''} onChange={e=>setEditData({...editData,host_assigned:e.target.value})} /></div>
              </> : <>
                <Field label="Phone"             value={vip.phone} />
                <Field label="WhatsApp"          value={vip.whatsapp} />
                <Field label="Email"             value={vip.email} />
                <Field label="Address"           value={vip.address} />
                <Field label="Language"          value={vip.lang_pref} />
                <Field label="Msg Style"         value={vip.msg_style} />
                <Field label="Best Contact Time" value={vip.best_contact_time} />
                <div>
                  <div style={s.flbl}>Host Assigned</div>
                  {isAdmin && changingHost ? (
                    <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:4 }}>
                      <select
                        style={{ ...s.input, flex:1 }}
                        value={newHost}
                        onChange={e => setNewHost(e.target.value)}>
                        <option value="">— Select Host —</option>
                        {hosts.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <button
                        style={{ background:'#3fb950', color:'#fff', border:'none', padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}
                        onClick={saveHost} disabled={savingHost}>
                        {savingHost ? '...' : '✓'}
                      </button>
                      <button
                        style={{ background:'var(--surface2)', color:'var(--muted)', border:'1px solid var(--border)', padding:'6px 10px', borderRadius:6, fontSize:12, cursor:'pointer' }}
                        onClick={() => setChangingHost(false)}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                      <span style={{ fontSize:14, fontWeight:600, color:'var(--text)' }}>{vip.host_assigned || '—'}</span>
                      {isAdmin && (
                        <button
                          style={{ background:'none', border:'1px solid var(--border)', color:'var(--muted)', padding:'2px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}
                          onClick={() => { setNewHost(vip.host_assigned || ''); setChangingHost(true) }}>
                          Change
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>}
            </div>
          </div>
          <div style={s.card}>
            <SectionHeader icon="👤" title="Profile" />
            <div style={{ ...s.cardBody, ...s.grid2 }}>
              {editing ? <>
                <div><div style={s.flbl}>Full Name</div><input style={{...s.input,marginTop:4}} value={editData.full_name||''} onChange={e=>setEditData({...editData,full_name:e.target.value})} /></div>
                <div><div style={s.flbl}>City / State</div><input style={{...s.input,marginTop:4}} value={editData.city_state||''} onChange={e=>setEditData({...editData,city_state:e.target.value})} /></div>
                <div><div style={s.flbl}>Race</div><input style={{...s.input,marginTop:4}} value={editData.race||''} onChange={e=>setEditData({...editData,race:e.target.value})} /></div>
                <div><div style={s.flbl}>Birthday (YYYY-MM-DD)</div><input style={{...s.input,marginTop:4}} value={editData.birthday||''} onChange={e=>setEditData({...editData,birthday:e.target.value})} /></div>
                <div><div style={s.flbl}>Fav Game</div><input style={{...s.input,marginTop:4}} value={editData.fav_game||''} onChange={e=>setEditData({...editData,fav_game:e.target.value})} /></div>
                <div><div style={s.flbl}>Fav Game 2</div><input style={{...s.input,marginTop:4}} value={editData.fav_game_2||''} onChange={e=>setEditData({...editData,fav_game_2:e.target.value})} /></div>
                <div><div style={s.flbl}>Tier</div><select style={{...s.sel,marginTop:4}} value={editData.tier||''} onChange={e=>setEditData({...editData,tier:e.target.value})}>{TIERS.map(t=><option key={t}>{t}</option>)}</select></div>
                <div><div style={s.flbl}>Status</div><select style={{...s.sel,marginTop:4}} value={editData.activity_status||''} onChange={e=>setEditData({...editData,activity_status:e.target.value})}>{['Active','Watch','At Risk','Dormant','Unknown'].map(s=><option key={s}>{s}</option>)}</select></div>
              </> : <>
                <Field label="Full Name"      value={vip.full_name} />
                <Field label="City/State"     value={vip.city_state} />
                <Field label="Race"           value={vip.race} />
                <Field label="Birthday"       value={formatDate(vip.birthday)} />
                <Field label="Fav Game"       value={vip.fav_game} />
                <Field label="Fav Game 2"     value={vip.fav_game_2} />
                <Field label="Peak Play Time" value={vip.peak_play_time} />
              </>}
            </div>
          </div>
          <div style={{ ...s.card, gridColumn:'1 / -1' }}>
            <SectionHeader icon="📈" title={t('vipDetail.monthlyTrendTitle')} />
            <div style={s.cardBody}>
              <MonthlyTrendChart trend={monthlyTrend} />
            </div>
          </div>
          {logs.length > 0 && (
            <div style={{ ...s.card, gridColumn:'1 / -1' }}>
              <SectionHeader icon="📋" title={`Recent Contact Logs (${logs.length})`} />
              <div style={{ padding:'12px 20px' }}>
                {logs.slice(0,3).map(log => {
                  const c = { Contacted:'#3fb950', Replied:'#58a6ff', 'No Reply':'#d29922', Deposited:'#ffd700' }[log.outcome]||'var(--muted)'
                  return (
                    <div key={log.id} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)', display:'flex', gap:10, alignItems:'flex-start' }}>
                      <span style={{ ...s.tag, background:`${c}22`, color:c, flexShrink:0 }}>{log.outcome}</span>
                      <div style={{ flex:1, fontSize:13, color:'var(--text)' }}>{log.notes||'-'}</div>
                      <span style={{ fontSize:11, color:'var(--muted)', whiteSpace:'nowrap' }}>{timeAgo(log.logged_at)}</span>
                    </div>
                  )
                })}
                {logs.length > 3 && <div style={{ fontSize:12, color:'var(--accent)', marginTop:8, cursor:'pointer' }} onClick={() => setActiveTab('contacts')}>View all {logs.length} logs →</div>}
              </div>
            </div>
          )}

          <div style={s.card}>
            <SectionHeader icon="📝" title="Host Notes" />
            <div style={s.cardBody}>
              <div style={{ marginBottom:12 }}>
                <div style={s.flbl}>Personality Notes</div>
                <textarea style={{ ...s.ta, marginTop:6 }} rows={3} value={editing?editData.personality_notes||'':vip.personality_notes||''} onChange={e=>editing&&setEditData({...editData,personality_notes:e.target.value})} readOnly={!editing} placeholder={editing?'Communication style, what works...':'(No notes yet)'} />
              </div>
              <div>
                <div style={s.flbl}>Interests / Topics</div>
                <textarea style={{ ...s.ta, marginTop:6 }} rows={2} value={editing?editData.interests_topics||'':vip.interests_topics||''} onChange={e=>editing&&setEditData({...editData,interests_topics:e.target.value})} readOnly={!editing} placeholder={editing?'Hobbies, topics...':'(No interests noted)'} />
              </div>
              {!editing && <button style={{ ...s.btnSm, marginTop:12 }} onClick={() => setEditing(true)}>Edit Notes</button>}
            </div>
          </div>
        </div>
      )}

      {/* CONTACT LOG TAB */}
      {activeTab === 'contacts' && (
        <div>
          {showLogForm && (
            <div style={{ ...s.card, marginBottom:16, border:'1px solid var(--accent)' }}>
              <SectionHeader icon="+" title="Log New Contact" />
              <div style={{ padding:'18px 20px' }}>
                <div style={{ ...s.grid2, marginBottom:12 }}>
                  <div>
                    <div style={s.flbl}>Contact Type</div>
                    <select style={{...s.sel,marginTop:4}} value={logForm.contact_type} onChange={e=>setLogForm({...logForm,contact_type:e.target.value})}>
                      {CONTACT_TYPES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={s.flbl}>Outcome</div>
                    <select style={{...s.sel,marginTop:4}} value={logForm.outcome} onChange={e=>setLogForm({...logForm,outcome:e.target.value})}>
                      {CONTACT_OUTCOMES.map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <div style={s.flbl}>Notes *</div>
                  <textarea style={{ ...s.ta, marginTop:4 }} rows={3} value={logForm.notes} onChange={e=>setLogForm({...logForm,notes:e.target.value})} placeholder="What happened? VIP response, mood, any promises made..." />
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button style={s.btn} onClick={submitLog} disabled={submittingLog||!logForm.notes.trim()}>{submittingLog?'Saving...':'Save Contact Log'}</button>
                  <button style={s.btnSm} onClick={() => setShowLogForm(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
          {!showLogForm && <div style={{ marginBottom:14 }}><button style={s.btn} onClick={() => setShowLogForm(true)}>Log New Contact</button></div>}
          <div style={s.card}>
            <SectionHeader icon="📋" title={`Contact History (${logs.length})`} />
            <div style={s.cardBody}>
              {logs.length === 0 ? (
                <div style={{ color:'var(--muted)', fontSize:13, textAlign:'center', padding:'24px 0' }}>No contact logs yet. Log the first one above</div>
              ) : logs.map(log => {
                const outcomeColor = { Contacted:'#3fb950', Replied:'#58a6ff', 'No Reply':'#d29922', Deposited:'#ffd700', Reactivated:'#b9f2ff' }[log.outcome]||'var(--muted)'
                const typeColor = { WhatsApp:'#3fb950', Call:'#58a6ff', 'In-person':'#b9f2ff', Other:'#8b949e' }[log.channel]||'var(--muted)'
                const isEditing = editingLogId === log.id
                return (
                  <div key={log.id} style={s.logEntry}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <span style={{ ...s.tag, background:`${typeColor}22`, color:typeColor }}>{log.channel}</span>
                      <span style={{ ...s.tag, background:`${outcomeColor}22`, color:outcomeColor }}>{log.outcome}</span>
                      <span style={{ fontSize:11, color:'var(--muted)' }}>{log.host_name} · {timeAgo(log.logged_at)}</span>
                      <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
                        <button onClick={() => { setEditingLogId(log.id); setEditingLogNote(log.notes||'') }}
                          style={{ background:'none', border:'1px solid var(--border)', color:'var(--muted)', padding:'2px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>Edit</button>
                        <button onClick={() => deleteLog(log.id)}
                          style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>Delete</button>
                      </div>
                    </div>
                    {isEditing ? (
                      <div style={{ marginTop:6 }}>
                        <textarea style={{ ...s.ta, marginBottom:6 }} rows={3} value={editingLogNote} onChange={e => setEditingLogNote(e.target.value)} />
                        <div style={{ display:'flex', gap:6 }}>
                          <button style={{ ...s.btn, padding:'5px 14px', fontSize:12 }} onClick={() => saveLogEdit(log.id)}>Save</button>
                          <button style={{ ...s.btnSm, padding:'5px 12px', fontSize:12 }} onClick={() => setEditingLogId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      log.notes && <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.5, marginTop:2 }}>{log.notes}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* CAMPAIGNS TAB */}
      {activeTab === 'campaigns' && (
        <div style={s.card}>
          <SectionHeader icon="📢" title="Campaign History" />
          <div style={s.cardBody}>
            {campaigns.length === 0 ? (
              <div style={{ color:'var(--muted)', fontSize:13, textAlign:'center', padding:'24px 0' }}>Not enrolled in any campaigns yet.</div>
            ) : campaigns.map(cp => {
              const camp = cp.campaigns
              const statusColor = { active:'#3fb950', ended:'#8b949e', draft:'#d29922' }[camp?.status]||'var(--muted)'
              return (
                <div key={cp.id} style={s.logEntry}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>{camp?.campaign_name||'-'}</span>
                    {camp?.status && <span style={{ ...s.tag, background:`${statusColor}22`, color:statusColor }}>{camp.status}</span>}
                    <span style={{ fontSize:11, color:'var(--muted)', marginLeft:'auto' }}>Added {timeAgo(cp.added_at)}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)' }}>{formatDate(camp?.start_date)} - {formatDate(camp?.end_date)}</div>
                  <div style={{ fontSize:13, color:cp.total_deposit>=(cp.deposit_target||150000)?'#3fb950':'var(--muted)' }}>
                    Deposit: {rmFmt(cp.total_deposit||0, vip?.currency)} / {rmFmt(cp.deposit_target||150000, vip?.currency)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* CHURN TAB */}
      {activeTab === 'churn' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div style={s.card}>
            <SectionHeader icon="⚠️" title="Churn Risk Analysis" />
            <div style={s.cardBody}>
              <div style={{ textAlign:'center', marginBottom:20 }}>
                <div style={{ fontSize:48, fontWeight:800, color:CHURN_COLOR[vip.churn_risk]||'var(--muted)' }}>{vip.churn_risk||'-'}</div>
                <div style={{ fontSize:12, color:'var(--muted)' }}>Churn Risk Level</div>
                <div style={{ height:8, background:'var(--border)', borderRadius:4, overflow:'hidden', marginTop:12 }}>
                  <div style={{ width:vip.churn_risk==='HIGH'?'90%':vip.churn_risk==='MEDIUM'?'55%':'20%', height:'100%', background:CHURN_COLOR[vip.churn_risk]||'var(--muted)', borderRadius:4 }} />
                </div>
              </div>
              <div style={s.grid2}>
                <Field label="Days Inactive" value={vip.days_inactive!=null?(vip.days_inactive===0?'Today':vip.days_inactive+'d'):'-'} color={vip.days_inactive<=7?'#3fb950':vip.days_inactive<=30?'#d29922':'#f85149'} />
                <Field label="Activity Status" value={vip.activity_status} color={STATUS_COLOR[vip.activity_status]} />
                <Field label="Last Deposit" value={formatDate(vip.last_deposit_date)} />
                <Field label="Predicted Dep %" value={vip.predicted_dep_pct?vip.predicted_dep_pct+'%':'-'} color="var(--accent)" />
                <Field label="VIP Score" value={score||'-'} color={scoreColor} />
              </div>
            </div>
          </div>
          <div style={s.card}>
            <SectionHeader icon="📈" title="Activity Timeline" />
            <div style={s.cardBody}>
              {logs.length === 0 ? (
                <div style={{ color:'var(--muted)', fontSize:13, textAlign:'center', padding:'24px 0' }}>No activity data yet.</div>
              ) : logs.slice(0,8).map((log,i) => {
                const c = { Contacted:'#3fb950', Replied:'#58a6ff', 'No Reply':'#d29922', Deposited:'#ffd700' }[log.outcome]||'var(--muted)'
                return (
                  <div key={log.id} style={{ display:'flex', gap:12, paddingBottom:14, position:'relative' }}>
                    {i < Math.min(logs.length,8)-1 && <div style={{ position:'absolute', left:7, top:16, width:2, height:'100%', background:'var(--border)' }} />}
                    <div style={{ width:16, height:16, borderRadius:'50%', background:c, flexShrink:0, marginTop:2 }} />
                    <div>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{log.channel} - {log.outcome}</div>
                      <div style={{ fontSize:11, color:'var(--muted)' }}>{timeAgo(log.logged_at)} · {log.host_name}</div>
                      {log.notes && <div style={{ fontSize:12, color:'var(--text)', opacity:.7, marginTop:2 }}>{log.notes.slice(0,80)}{log.notes.length>80?'...':''}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{ ...s.card, gridColumn:'1 / -1' }}>
            <SectionHeader icon="🎂" title="Birthday & Bonus Info" />
            <div style={{ ...s.cardBody, ...s.grid3 }}>
              <Field label="Birthday"       value={formatDate(vip.birthday)} />
              <Field label="Fav Game"       value={vip.fav_game} />
              <Field label="Peak Play Time" value={vip.peak_play_time} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'deepdive' && (
        <div>
          {deepDiveLoading ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>{t('common.loading')}</div>
          ) : !deepDive || deepDive.monthlyHistory.length === 0 ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>No monthly history available for this VIP yet.</div>
          ) : (
            <>
              <div style={s.card}>
                <SectionHeader icon="📊" title="Lifetime Summary" />
                <div style={{ ...s.cardBody, ...s.grid3 }}>
                  <Field label="Lifetime Valid Bet" value={rmFmt(deepDive.lifetimeValidBet, vip?.currency)} color="var(--accent)" />
                  <Field label="Lifetime Deposit" value={rmFmt(deepDive.lifetimeDeposit, vip?.currency)} color="#3fb950" />
                  <Field label="Lifetime Withdrawal" value={rmFmt(deepDive.lifetimeWithdrawal, vip?.currency)} />
                  <Field label="Lifetime Net Contribution">
                    <span style={{ color: deepDive.lifetimeNet >= 0 ? '#3fb950' : '#f85149', fontWeight:700 }}>{rmFmt(deepDive.lifetimeNet, vip?.currency)}</span>
                    <span style={{ fontSize:11, color:'var(--muted)', marginLeft:6 }}>({deepDive.netMarginLifetime.toFixed(2)}% margin)</span>
                  </Field>
                  <Field label="Net Margin — Last 6 Months">
                    <span style={{ color: deepDive.netMarginRecent6 >= deepDive.netMarginLifetime ? '#3fb950' : '#d29922', fontWeight:700 }}>
                      {deepDive.netMarginRecent6.toFixed(2)}%
                    </span>
                    <span style={{ fontSize:11, color:'var(--muted)', marginLeft:6 }}>
                      {deepDive.netMarginRecent6 < deepDive.netMarginLifetime ? '↓ declining vs lifetime' : '↑ improving vs lifetime'}
                    </span>
                  </Field>
                  {deepDive.rankInfo && (
                    <Field label={`Site Rank by Valid Bet (${deepDive.rankInfo.month})`}>
                      {deepDive.rankInfo.rank
                        ? <span style={{ fontWeight:700, color:'#a78bfa' }}>#{deepDive.rankInfo.rank} / {deepDive.rankInfo.totalPlayers}</span>
                        : <span style={{ color:'var(--muted)' }}>—</span>}
                      <span style={{ fontSize:11, color:'var(--muted)', marginLeft:6 }}>{deepDive.rankInfo.depositSharePct.toFixed(1)}% of {vip?.currency} deposits this month</span>
                    </Field>
                  )}
                </div>
              </div>

              <div style={s.card}>
                <SectionHeader icon="⚠️" title="Risk Exposure" />
                <div style={{ ...s.cardBody, ...s.grid3 }}>
                  <Field label="Max Single-Day Company Loss">
                    <span style={{ color:'#f85149', fontWeight:700 }}>{rmFmt(deepDive.maxCompanyLossDay, vip?.currency)}</span>
                  </Field>
                  <Field label="Max Single-Day Company Win">
                    <span style={{ color:'#3fb950', fontWeight:700 }}>{rmFmt(deepDive.maxCompanyWinDay, vip?.currency)}</span>
                  </Field>
                  <Field label="Daily P/L Std Deviation" value={rmFmt(deepDive.stdDev, vip?.currency)} />
                  <Field label="Max Single-Day Valid Bet" value={rmFmt(deepDive.maxDailyValidBet, vip?.currency)} />
                </div>
                <div style={{ padding:'0 20px 16px', fontSize:11, color:'var(--muted)' }}>
                  Computed from full daily history. A large gap between max single-day loss and typical daily swing (std deviation) means this VIP's risk is concentrated in rare, extreme days rather than steady — worth knowing before setting any withdrawal or win caps.
                </div>
              </div>

              <div style={s.card}>
                <SectionHeader icon="🗓️" title="Full Monthly History" />
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--border)' }}>
                        <th style={{ textAlign:'left', padding:'8px 14px', color:'var(--muted)', fontWeight:600 }}>Month</th>
                        <th style={{ textAlign:'right', padding:'8px 14px', color:'var(--muted)', fontWeight:600 }}>Deposit</th>
                        <th style={{ textAlign:'right', padding:'8px 14px', color:'var(--muted)', fontWeight:600 }}>Withdrawal</th>
                        <th style={{ textAlign:'right', padding:'8px 14px', color:'var(--muted)', fontWeight:600 }}>Valid Bet</th>
                        <th style={{ textAlign:'right', padding:'8px 14px', color:'var(--muted)', fontWeight:600 }}>Company Gross</th>
                        <th style={{ textAlign:'right', padding:'8px 14px', color:'var(--muted)', fontWeight:600 }}>Rebate</th>
                        <th style={{ textAlign:'right', padding:'8px 14px', color:'var(--muted)', fontWeight:600 }}>Net Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...deepDive.monthlyHistory].reverse().map(m => (
                        <tr key={m.month} style={{ borderBottom:'1px solid var(--border)' }}>
                          <td style={{ padding:'8px 14px', fontWeight:700 }}>{m.month}</td>
                          <td style={{ padding:'8px 14px', textAlign:'right' }}>{rmFmt(m.deposit, vip?.currency)}</td>
                          <td style={{ padding:'8px 14px', textAlign:'right' }}>{rmFmt(m.withdrawal, vip?.currency)}</td>
                          <td style={{ padding:'8px 14px', textAlign:'right', color:'var(--accent)' }}>{rmFmt(m.validBet, vip?.currency)}</td>
                          <td style={{ padding:'8px 14px', textAlign:'right', color: m.companyGross >= 0 ? '#3fb950' : '#f85149' }}>{rmFmt(m.companyGross, vip?.currency)}</td>
                          <td style={{ padding:'8px 14px', textAlign:'right' }}>{rmFmt(m.rebate, vip?.currency)}</td>
                          <td style={{ padding:'8px 14px', textAlign:'right', fontWeight:700, color: m.netContribution >= 0 ? '#3fb950' : '#f85149' }}>{rmFmt(m.netContribution, vip?.currency)}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop:'2px solid var(--border)', fontWeight:700 }}>
                        <td style={{ padding:'8px 14px' }}>Total</td>
                        <td style={{ padding:'8px 14px', textAlign:'right' }}>{rmFmt(deepDive.lifetimeDeposit, vip?.currency)}</td>
                        <td style={{ padding:'8px 14px', textAlign:'right' }}>{rmFmt(deepDive.lifetimeWithdrawal, vip?.currency)}</td>
                        <td style={{ padding:'8px 14px', textAlign:'right', color:'var(--accent)' }}>{rmFmt(deepDive.lifetimeValidBet, vip?.currency)}</td>
                        <td style={{ padding:'8px 14px', textAlign:'right' }}>—</td>
                        <td style={{ padding:'8px 14px', textAlign:'right' }}>—</td>
                        <td style={{ padding:'8px 14px', textAlign:'right', color: deepDive.lifetimeNet >= 0 ? '#3fb950' : '#f85149' }}>{rmFmt(deepDive.lifetimeNet, vip?.currency)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ fontSize:11, color:'var(--muted)', padding:'8px 4px' }}>
                Net Contribution = Company Gross P/L − Rebate − Bonus. Site rank and deposit share are computed against all VIPs in the same currency for the shown month. Table/game-level breakdown (hold rate by table) is not available yet — the CRM doesn't currently import data at that granularity.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
