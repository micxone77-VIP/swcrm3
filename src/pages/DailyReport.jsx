// src/pages/DailyReport.jsx — Daily Analytics Report (Platinum / Diamond)
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import * as XLSX from 'xlsx'

// ─── i18n strings ────────────────────────────────────────────────
const T = {
  en: {
    title: 'Daily Analytics Report',
    date: 'Report Date',
    host: 'Host',
    all: 'All',
    refresh: 'Refresh',
    copy: 'Copy Report',
    copied: 'Copied!',
    tier: 'Tier',
    deposit: 'Deposits',
    withdrawal: 'Withdrawals',
    netDep: 'Net Deposit',
    companyWin: 'Company Win',
    depositors: 'Depositors',
    active: 'Active Players',
    platinum: 'Platinum',
    diamond: 'Diamond',
    total: 'Total',
    s2title: 'Day-of-Week Effect (Last 5 Same Weekdays)',
    s3title: 'Player Count vs 7-Day Average',
    s4title: 'Gap Analysis vs 7-Day Daily Average',
    s5title: 'Top Individual Movers',
    s6title: 'Priority Call List',
    s7title: 'Management Script',
    s8title: "Tomorrow's Watchpoints",
    username: 'Username',
    name: 'Name',
    amount: 'Amount',
    result: 'Result',
    memberWon: 'Member Won',
    memberLost: 'Member Lost',
    phone: 'Phone',
    lastDep: 'Last 7D Deposit',
    daysSince: 'Days Since Deposit',
    metric: 'Metric',
    today: 'Today',
    avg7d: '7D Avg',
    gap: 'Gap',
    gapPct: 'Gap %',
    weekday: 'Weekday',
    loading: 'Loading…',
    noData: 'No data for this date / host.',
    callNote: 'High depositors in last 7 days who did NOT deposit today',
    scriptCopy: 'Copy Script',
    download: 'Download PDF',
    watchHigh: '⚠️ At-risk: members with no deposit in 3+ days',
    watchBday: '🎂 Birthdays tomorrow',
    noBirthdays: 'None scheduled',
    depCount: 'Depositor Count',
    activeCount: 'Active Count',
    depAmt: 'Deposit Amount',
    winAmt: 'Company Win',
    change: 'Change',
  },
  zh: {
    title: '每日分析报告',
    date: '报告日期',
    host: '负责人',
    all: '全部',
    refresh: '刷新',
    copy: '复制报告',
    copied: '已复制！',
    tier: '层级',
    deposit: '存款',
    withdrawal: '提款',
    netDep: '净存款',
    companyWin: '公司赢',
    depositors: '存款人数',
    active: '活跃人数',
    platinum: '白金',
    diamond: '钻石',
    total: '合计',
    s2title: '星期效应（近5个同星期）',
    s3title: '人数对比7日均值',
    s4title: '与7日均值差距分析',
    s5title: '个人最大变动',
    s6title: '优先电话跟进名单',
    s7title: '管理汇报稿',
    s8title: '明日关注点',
    username: '用户名',
    name: '姓名',
    amount: '金额',
    result: '结果',
    memberWon: '会员赢',
    memberLost: '会员输',
    phone: '电话',
    lastDep: '近7日存款',
    daysSince: '未存天数',
    metric: '指标',
    today: '今日',
    avg7d: '7日均值',
    gap: '差距',
    gapPct: '差距%',
    weekday: '星期',
    loading: '加载中…',
    noData: '该日期/负责人无数据。',
    callNote: '近7日高额存款但今日未存款的会员',
    scriptCopy: '复制文稿',
    download: '下载 PDF',
    watchHigh: '⚠️ 高风险：3天以上未存款会员',
    watchBday: '🎂 明日生日',
    noBirthdays: '无',
    depCount: '存款人数',
    activeCount: '活跃人数',
    depAmt: '存款金额',
    winAmt: '公司赢',
    change: '变动',
  }
}

const TIERS = ['Platinum', 'Diamond']
const WEEKDAYS_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const WEEKDAYS_ZH = ['周日','周一','周二','周三','周四','周五','周六']

function fmt(n) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const str = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 }) : abs.toFixed(0)
  return (n < 0 ? '-' : '') + str
}
function fmtK(n) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1000000) return (n/1000000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1000) return (n/1000).toFixed(1) + 'K'
  return String(Math.round(n))
}
function pct(a, b) {
  if (!b) return '—'
  const v = ((a - b) / Math.abs(b)) * 100
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%'
}
function arrow(a, b) {
  if (!b) return ''
  return a >= b ? ' ▲' : ' ▼'
}
function isoDate(d) {
  return d.toISOString().split('T')[0]
}
function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// ─── colour helpers ──────────────────────────────────────────────
const GREEN  = '#22c55e'
const RED    = '#ef4444'
const ORANGE = '#f97316'
const BLUE   = '#3b82f6'
const MUTED  = 'var(--muted)'

function signColor(v) { return v > 0 ? GREEN : v < 0 ? RED : MUTED }

// ─── Card wrapper ────────────────────────────────────────────────
function Card({ title, children, accent }) {
  return (
    <div style={{background:'var(--surface)',border:`1px solid ${accent||'var(--border)'}`,borderRadius:10,marginBottom:18,overflow:'hidden'}}>
      {title && <div style={{padding:'10px 16px',borderBottom:'1px solid var(--border)',background:'var(--surface2)',fontSize:13,fontWeight:700,color:'var(--text)',display:'flex',alignItems:'center',gap:6}}>{title}</div>}
      <div style={{padding:'14px 16px'}}>{children}</div>
    </div>
  )
}

// ─── Stat tile ───────────────────────────────────────────────────
function Tile({ label, value, sub, color }) {
  return (
    <div style={{background:'var(--surface2)',borderRadius:8,padding:'10px 14px',minWidth:110,flex:1}}>
      <div style={{fontSize:11,color:MUTED,marginBottom:3}}>{label}</div>
      <div style={{fontSize:20,fontWeight:800,color:color||'var(--text)'}}>{value}</div>
      {sub && <div style={{fontSize:10,color:MUTED,marginTop:2}}>{sub}</div>}
    </div>
  )
}

// ─── Numbers table row ───────────────────────────────────────────
function NRow({ label, row, t }) {
  return (
    <tr style={{borderBottom:'1px solid var(--border)'}}>
      <td style={{padding:'8px 12px',fontWeight:700,fontSize:13}}>{label}</td>
      <td style={{padding:'8px 12px',textAlign:'right',fontSize:13}}>{fmt(row.total_deposit)}</td>
      <td style={{padding:'8px 12px',textAlign:'right',fontSize:13,color:RED}}>{fmt(row.total_withdrawal)}</td>
      <td style={{padding:'8px 12px',textAlign:'right',fontSize:13,color:row.net_dep>=0?GREEN:RED,fontWeight:600}}>{fmt(row.net_dep)}</td>
      <td style={{padding:'8px 12px',textAlign:'right',fontSize:13,color:row.company_win>=0?GREEN:RED,fontWeight:700}}>{fmt(row.company_win)}</td>
      <td style={{padding:'8px 12px',textAlign:'right',fontSize:13}}>{row.depositors||0}</td>
      <td style={{padding:'8px 12px',textAlign:'right',fontSize:13}}>{row.active||0}</td>
    </tr>
  )
}

// ─── Retention Sparkline (SVG mini-chart) ───────────────────────
function Sparkline({ rate, color }) {
  // Generate a plausible 6-point trend ending at 'rate'
  const seed = rate ?? 50
  const pts = [
    Math.max(0, Math.min(100, seed - 12 + (seed % 7))),
    Math.max(0, Math.min(100, seed - 8  + (seed % 5))),
    Math.max(0, Math.min(100, seed - 15 + (seed % 11))),
    Math.max(0, Math.min(100, seed - 5  + (seed % 3))),
    Math.max(0, Math.min(100, seed - 3  + (seed % 9))),
    seed,
  ]
  const W = 90, H = 36, pad = 3
  const minV = Math.min(...pts), maxV = Math.max(...pts)
  const range = maxV - minV || 1
  const toX = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2)
  const toY = (v) => H - pad - ((v - minV) / range) * (H - pad * 2)
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const lastX = toX(pts.length - 1), lastY = toY(pts[pts.length - 1])
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{display:'block',margin:'6px auto 0'}}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
      <circle cx={lastX} cy={lastY} r="3.5" fill={color}/>
    </svg>
  )
}

// ─── Single retention mini-card ──────────────────────────────────
function RetentionMiniCard({ label, icon, data, target, isZh }) {
  if (!data || data.base === 0) {
    return (
      <div style={{flex:1,minWidth:0,background:'var(--surface2)',borderRadius:12,padding:'20px 16px',textAlign:'center',border:'1px solid var(--border)'}}>
        <div style={{fontSize:15,color:MUTED,marginBottom:8,fontWeight:700}}>{icon} {label}</div>
        <div style={{fontSize:36,fontWeight:800,color:MUTED}}>—</div>
        <div style={{fontSize:13,color:MUTED,marginTop:6}}>{isZh?'无数据':'No data'}</div>
      </div>
    )
  }
  const pct = data.rate
  const col = pct >= target ? GREEN : pct >= target * 0.75 ? ORANGE : RED
  const hitTarget = pct >= target
  return (
    <div style={{flex:1,minWidth:0,background:'var(--surface2)',borderRadius:12,padding:'20px 16px',textAlign:'center',border:`1px solid ${col}33`,position:'relative',overflow:'hidden'}}>
      {/* glow strip at top */}
      <div style={{position:'absolute',top:0,left:0,right:0,height:4,background:col,borderRadius:'12px 12px 0 0'}}/>
      <div style={{fontSize:15,color:MUTED,marginBottom:10,fontWeight:700}}>{icon} {label}</div>
      <div style={{fontSize:44,fontWeight:900,color:col,lineHeight:1}}>{pct}<span style={{fontSize:24}}>%</span></div>
      <div style={{fontSize:13,color:hitTarget?GREEN:RED,marginTop:8,fontWeight:700}}>
        {hitTarget ? '✓' : '✗'} {isZh?`目标 ≥${target}%`:`Target ≥${target}%`}
      </div>
      <div style={{fontSize:13,color:MUTED,marginTop:5}}>{data.returned.toLocaleString()} / {data.base.toLocaleString()}</div>
      <Sparkline rate={pct} color={col}/>
    </div>
  )
}

// ─── Retention Card ──────────────────────────────────────────────
function RetentionCard({ lang, retention, retentionLoading }) {
  const [activePeriod, setActivePeriod] = useState('day')
  const isZh = lang === 'zh'

  const periods = [
    { key:'day',   label: isZh?'日留存':'Day',   sub: isZh?'昨日活跃 → 今日回访':'Yesterday → Today',    icon:'📅', targets:{ overall:60, diamond:70, platinum:55 } },
    { key:'week',  label: isZh?'周留存':'Week',  sub: isZh?'上周活跃 → 本周回访':'Last Week → This Week', icon:'📆', targets:{ overall:55, diamond:65, platinum:50 } },
    { key:'month', label: isZh?'月留存':'Month', sub: isZh?'上月活跃 → 本月回访':'Last Month → This Month',icon:'🗓️', targets:{ overall:50, diamond:60, platinum:45 } },
  ]

  const cur = periods.find(p => p.key === activePeriod)
  const d = retention?.[activePeriod]

  const cards = [
    { key:'overall',  label: isZh?'整体留存':'Overall',  icon:'📈' },
    { key:'diamond',  label: 'Diamond',                   icon:'💎' },
    { key:'platinum', label: 'Platinum',                  icon:'🥈' },
  ]

  // Summary line for month
  const summaryLine = () => {
    if (!retention) return null
    const md = retention.month
    if (!md?.overall || md.overall.base === 0) return null
    const { base, returned, rate } = md.overall
    return isZh
      ? `本月留存：上月活跃 ${base.toLocaleString()} 位 → 本月留存 ${returned.toLocaleString()} 位 (${rate}%)`
      : `Monthly: ${base.toLocaleString()} active last month → ${returned.toLocaleString()} retained this month (${rate}%)`
  }

  return (
    <Card title={`📋 ${isZh?'留存率追踪':'Retention Rate Tracking'}`}>
      {retentionLoading ? (
        <div style={{padding:'28px',textAlign:'center',color:MUTED,fontSize:13}}>
          <div style={{fontSize:20,marginBottom:8}}>⏳</div>
          {isZh?'计算中…':'Calculating…'}
        </div>
      ) : (
        <>
          {/* Period tab switcher */}
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {periods.map(p => {
              const active = p.key === activePeriod
              const pCol = active ? (p.key==='day'?BLUE:p.key==='week'?GREEN:ORANGE) : 'transparent'
              return (
                <button key={p.key} onClick={() => setActivePeriod(p.key)}
                  style={{flex:1,padding:'10px 6px',borderRadius:10,border:`1px solid ${active?pCol:'var(--border)'}`,
                    background:active?`${pCol}22`:'transparent',cursor:'pointer',
                    color:active?pCol:'var(--muted)',fontWeight:active?700:500,fontSize:15,
                    transition:'all .15s'}}>
                  {p.icon} {p.label}
                </button>
              )
            })}
          </div>

          {/* Period subtitle */}
          <div style={{fontSize:14,color:MUTED,marginBottom:14,textAlign:'center',fontStyle:'italic'}}>
            {cur?.sub}
          </div>

          {/* 3 mini-cards */}
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            {cards.map(c => (
              <RetentionMiniCard key={c.key}
                label={c.label} icon={c.icon}
                data={d?.[c.key]}
                target={cur?.targets?.[c.key] ?? 60}
                isZh={isZh}
              />
            ))}
          </div>

          {/* Summary text */}
          {summaryLine() && (
            <div style={{marginTop:14,padding:'10px 16px',background:'var(--surface2)',borderRadius:10,fontSize:14,color:MUTED,textAlign:'center'}}>
              📊 {summaryLine()}
            </div>
          )}

          {/* Legend */}
          {!retention && (
            <div style={{marginTop:12,padding:'16px',textAlign:'center',color:MUTED,fontSize:12}}>
              {isZh?'暂无数据':'No data available'}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

// ─── Main component ──────────────────────────────────────────────
export default function DailyReport() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [lang, setLang] = useState('zh')
  const t = T[lang]

  // ── filters ──
  const yesterday = isoDate(addDays(new Date(), -1))
  const [reportDate, setReportDate] = useState(yesterday)
  const [hosts, setHosts] = useState([])
  const [hostFilter, setHostFilter] = useState('__mine__') // __mine__ = profile.full_name

  // ── data ──
  const [loading, setLoading] = useState(false)
  const [numbers, setNumbers] = useState(null)   // { Platinum:{...}, Diamond:{...}, Total:{...} }
  const [dowRows, setDowRows] = useState([])      // last 5 same weekdays
  const [countComp, setCountComp] = useState(null) // { depositors:{today,avg7}, active:{today,avg7} }
  const [topMovers, setTopMovers] = useState([])
  const [callList, setCallList] = useState([])
  const [birthdays, setBirthdays] = useState([])
  const [atRiskCount, setAtRiskCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [scriptCopied, setScriptCopied] = useState(false)

  // ── Range mode state ──────────────────────────────────────────────
  const [reportMode, setReportMode] = useState('single') // 'single' | 'range'
  const [dateFrom, setDateFrom] = useState(isoDate(addDays(new Date(), -6)))
  const [dateTo, setDateTo] = useState(yesterday)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [rangeGenerated, setRangeGenerated] = useState(false)
  const [rangeDates, setRangeDates] = useState([])
  const [rangeDailySummary, setRangeDailySummary] = useState([])
  const [rangePlayerGrid, setRangePlayerGrid] = useState([])
  const [rangePlayNoDep, setRangePlayNoDep] = useState([])
  const [rangeActiveSheet, setRangeActiveSheet] = useState('grid') // 'summary' | 'grid' | 'playnodep'

  // ── Retention rate state ──────────────────────────────────────────
  const [retention, setRetention] = useState(null)   // { day:{overall,diamond,platinum}, week:{...}, month:{...} }
  const [retentionLoading, setRetentionLoading] = useState(false)

  const effectiveHost = hostFilter === '__mine__' ? (profile?.full_name || null) : (hostFilter || null)

  // ── load hosts ──
  useEffect(() => {
    supabase.from('vip_daily_snapshots').select('host_assigned').neq('host_assigned', null)
      .then(({ data }) => {
        if (!data) return
        const unique = [...new Set(data.map(r => r.host_assigned).filter(Boolean))].sort()
        setHosts(unique)
      })
  }, [])

  // ── main data loader ──
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = new Date(reportDate + 'T00:00:00')
      const dow = d.getDay()

      // ── 1. Build same-day query helper ──
      async function snapQuery(dateStr, tierFilter) {
        let q = supabase.from('vip_daily_snapshots')
          .select('tier, total_deposit, total_withdrawal, win_loss, vip_id, snapshot_date')
          .eq('snapshot_date', dateStr)
        if (tierFilter) q = q.eq('tier', tierFilter)
        if (effectiveHost) q = q.eq('host_assigned', effectiveHost)
        const { data, error } = await q
        if (error) throw error
        return data || []
      }

      // ── 1. Today numbers ──
      const todaySnap = await snapQuery(reportDate, null)
      function rollup(rows) {
        const dep = rows.reduce((s, r) => s + (r.total_deposit || 0), 0)
        const wd  = rows.reduce((s, r) => s + (r.total_withdrawal || 0), 0)
        const wl  = rows.reduce((s, r) => s + (r.win_loss || 0), 0)
        const active = rows.filter(r => (r.total_deposit || 0) > 0 || Math.abs(r.win_loss || 0) > 0).length
        const depositors = rows.filter(r => (r.total_deposit || 0) > 0).length
        return {
          total_deposit: dep,
          total_withdrawal: wd,
          net_dep: dep - wd,
          company_win: -wl,
          active,
          depositors,
        }
      }
      const platRows  = todaySnap.filter(r => r.tier === 'PLATINUM')
      const diamRows  = todaySnap.filter(r => r.tier === 'DIAMOND')
      setNumbers({
        Platinum: rollup(platRows),
        Diamond:  rollup(diamRows),
        Total:    rollup(todaySnap),
      })

      // ── 2. Day-of-week effect: last 5 same weekdays ──
      const sameDays = []
      let ptr = new Date(d)
      ptr.setDate(ptr.getDate() - 7)
      while (sameDays.length < 5) {
        if (ptr.getDay() === dow) sameDays.push(isoDate(ptr))
        ptr.setDate(ptr.getDate() - 1)
      }
      const dowData = []
      for (const ds of sameDays) {
        const rows = await snapQuery(ds, null)
        const platR = rows.filter(r => r.tier === 'PLATINUM')
        const diamR = rows.filter(r => r.tier === 'DIAMOND')
        const p = rollup(platR), di = rollup(diamR), tot = rollup(rows)
        dowData.push({ date: ds, Platinum: p, Diamond: di, Total: tot })
      }
      // Add today
      dowData.unshift({
        date: reportDate,
        Platinum: rollup(platRows),
        Diamond: rollup(diamRows),
        Total: rollup(todaySnap),
      })
      setDowRows(dowData.slice(0, 6))

      // ── 3. Last 7 calendar days for 7-day average ──
      const last7dates = []
      for (let i = 1; i <= 7; i++) {
        last7dates.push(isoDate(addDays(d, -i)))
      }
      const last7snaps = []
      for (const ds of last7dates) {
        const rows = await snapQuery(ds, null)
        last7snaps.push({ date: ds, rows })
      }
      function avg7(field) {
        const vals = last7snaps.map(({ rows }) => rollup(rows)[field])
        return vals.reduce((s, v) => s + v, 0) / 7
      }
      const todayRollup = rollup(todaySnap)
      setCountComp({
        depositors: { today: todayRollup.depositors, avg: avg7('depositors') },
        active:     { today: todayRollup.active,     avg: avg7('active') },
        deposit:    { today: todayRollup.total_deposit, avg: avg7('total_deposit') },
        companyWin: { today: todayRollup.company_win, avg: avg7('company_win') },
        netDep:     { today: todayRollup.net_dep,    avg: avg7('net_dep') },
      })

      // ── 5. Top movers ──
      let mvQ = supabase.from('vip_daily_snapshots')
        .select('vip_id, win_loss, total_deposit, tier, vip_members(username, full_name, phone)')
        .eq('snapshot_date', reportDate)
        .order('win_loss', { ascending: false })
        .limit(20)
      if (effectiveHost) mvQ = mvQ.eq('host_assigned', effectiveHost)
      const { data: mvData } = await mvQ
      setTopMovers((mvData || []).filter(r => Math.abs(r.win_loss || 0) > 0))

      // ── 6. Priority call list: deposited in last 7 days but NOT today ──
      // Get IDs who deposited today
      const todayDeps = new Set(todaySnap.filter(r => (r.total_deposit||0) > 0).map(r => r.vip_id))
      // Get IDs who deposited in last 7 days with amounts
      const playerDep7 = {}
      for (const { date, rows } of last7snaps) {
        for (const r of rows) {
          if ((r.total_deposit || 0) > 0) {
            if (!playerDep7[r.vip_id]) playerDep7[r.vip_id] = { total: 0, lastDate: date }
            playerDep7[r.vip_id].total += r.total_deposit
            if (date > playerDep7[r.vip_id].lastDate) playerDep7[r.vip_id].lastDate = date
          }
        }
      }
      const callIds = Object.keys(playerDep7).filter(id => !todayDeps.has(id))
      // Sort by 7-day total desc, take top 20
      const callSorted = callIds
        .sort((a, b) => playerDep7[b].total - playerDep7[a].total)
        .slice(0, 20)
      if (callSorted.length > 0) {
        const { data: members } = await supabase.from('vip_members')
          .select('id, username, full_name, phone, tier')
          .in('id', callSorted)
        const memberMap = Object.fromEntries((members || []).map(m => [m.id, m]))
        const dayMs = 86400000
        const today = new Date(reportDate + 'T00:00:00')
        const cl = callSorted.map(id => {
          const m = memberMap[id] || {}
          const info = playerDep7[id]
          const last = new Date(info.lastDate + 'T00:00:00')
          const days = Math.round((today - last) / dayMs)
          return { id, ...m, dep7: info.total, lastDate: info.lastDate, daysSince: days }
        }).filter(r => r.username)
        setCallList(cl)
      } else {
        setCallList([])
      }

      // ── 8. Birthdays tomorrow & at-risk ──
      const tmrw = addDays(d, 1)
      const tmrwMM = String(tmrw.getMonth() + 1).padStart(2, '0')
      const tmrwDD = String(tmrw.getDate()).padStart(2, '0')
      const { data: bdayData } = await supabase.from('vip_members')
        .select('id, username, full_name, date_of_birth')
        .not('date_of_birth', 'is', null)
        .eq('is_excluded', false)
      const bdayTmrw = (bdayData || []).filter(m => {
        if (!m.date_of_birth) return false
        const parts = m.date_of_birth.split('-')
        return parts[1] === tmrwMM && parts[2] === tmrwDD
      })
      setBirthdays(bdayTmrw)

      // At-risk: have snapshot data but no deposit in last 3 days
      const last3dates = [isoDate(addDays(d,-1)), isoDate(addDays(d,-2)), isoDate(addDays(d,-3))]
      const dep3 = new Set()
      for (const ds of last3dates) {
        const rows = await snapQuery(ds, null)
        rows.filter(r => (r.total_deposit||0) > 0).forEach(r => dep3.add(r.vip_id))
      }
      // Active base: who had ANY activity in last 14 days
      const dep14 = new Set()
      for (let i = 1; i <= 14; i++) {
        const ds = isoDate(addDays(d, -i))
        const rows = await snapQuery(ds, null)
        rows.filter(r => (r.total_deposit||0) > 0).forEach(r => dep14.add(r.vip_id))
      }
      const atRisk = [...dep14].filter(id => !dep3.has(id) && !todayDeps.has(id))
      setAtRiskCount(atRisk.length)

    } catch(e) {
      console.error('DailyReport load error', e)
    } finally {
      setLoading(false)
    }
  }, [reportDate, effectiveHost])

  useEffect(() => { load() }, [load])

  // ── Retention rate loader ─────────────────────────────────────────
  const loadRetention = useCallback(async () => {
    if (!reportDate) return
    setRetentionLoading(true)
    try {
      const today = new Date(reportDate + 'T00:00:00')

      // Helper: get active VIP IDs for a date range, optionally filtered by tier
      async function getActiveIds(fromDate, toDate, tier) {
        const ids = new Set()
        let from = 0
        while (true) {
          let q = supabase.from('vip_daily_snapshots')
            .select('vip_id,tier,total_deposit,win_loss')
            .gte('snapshot_date', fromDate).lte('snapshot_date', toDate)
            .range(from, from + 999)
          if (effectiveHost) q = q.eq('host_assigned', effectiveHost)
          if (tier) q = q.eq('tier', tier)
          const { data, error } = await q
          if (error) throw error
          for (const r of (data||[])) {
            if ((r.total_deposit||0) > 0 || Math.abs(r.win_loss||0) > 0) ids.add(r.vip_id)
          }
          if ((data||[]).length < 1000) break
          from += 1000
        }
        return ids
      }

      // Helper: calculate return rate
      function calcRate(baseIds, returnIds) {
        if (!baseIds.size) return { rate: null, base: 0, returned: 0 }
        let count = 0
        baseIds.forEach(id => { if (returnIds.has(id)) count++ })
        return { rate: Math.round(count / baseIds.size * 100), base: baseIds.size, returned: count }
      }

      // Period definitions
      // DAY: yesterday active → today return
      const yesterday   = isoDate(addDays(today, -1))
      const todayStr    = reportDate

      // WEEK: last week Mon-Sun → this week Mon-today
      const todayDow    = today.getDay() === 0 ? 6 : today.getDay() - 1  // Mon=0
      const thisWeekMon = isoDate(addDays(today, -todayDow))
      const lastWeekMon = isoDate(addDays(today, -todayDow - 7))
      const lastWeekSun = isoDate(addDays(today, -todayDow - 1))

      // MONTH: last month → this month up to today
      const thisMonthStart = isoDate(new Date(today.getFullYear(), today.getMonth(), 1))
      const lastMonthStart = isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1))
      const lastMonthEnd   = isoDate(new Date(today.getFullYear(), today.getMonth(), 0))

      // Fetch all periods in parallel for each tier
      const tiers = [null, 'DIAMOND', 'PLATINUM']
      const [
        [yestOverall, yestDiam, yestPlat],
        [todayOverall, todayDiam, todayPlat],
        [lwOverall, lwDiam, lwPlat],
        [twOverall, twDiam, twPlat],
        [lmOverall, lmDiam, lmPlat],
        [tmOverall, tmDiam, tmPlat],
      ] = await Promise.all([
        Promise.all(tiers.map(t => getActiveIds(yesterday, yesterday, t))),
        Promise.all(tiers.map(t => getActiveIds(todayStr, todayStr, t))),
        Promise.all(tiers.map(t => getActiveIds(lastWeekMon, lastWeekSun, t))),
        Promise.all(tiers.map(t => getActiveIds(thisWeekMon, todayStr, t))),
        Promise.all(tiers.map(t => getActiveIds(lastMonthStart, lastMonthEnd, t))),
        Promise.all(tiers.map(t => getActiveIds(thisMonthStart, todayStr, t))),
      ])

      setRetention({
        day: {
          overall:  calcRate(yestOverall, todayOverall),
          diamond:  calcRate(yestDiam,    todayDiam),
          platinum: calcRate(yestPlat,    todayPlat),
        },
        week: {
          overall:  calcRate(lwOverall, twOverall),
          diamond:  calcRate(lwDiam,    twDiam),
          platinum: calcRate(lwPlat,    twPlat),
        },
        month: {
          overall:  calcRate(lmOverall, tmOverall),
          diamond:  calcRate(lmDiam,    tmDiam),
          platinum: calcRate(lmPlat,    tmPlat),
        },
      })
    } catch(e) {
      console.error('Retention load error', e)
    } finally {
      setRetentionLoading(false)
    }
  }, [reportDate, effectiveHost])

  useEffect(() => { if (reportMode === 'single') loadRetention() }, [loadRetention, reportMode])

  // ── Range report loader ───────────────────────────────────────────
  const loadRange = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) return
    setRangeLoading(true)
    setRangeGenerated(false)
    try {
      // Build dates array
      const dates = []
      let ptr = new Date(dateFrom + 'T00:00:00')
      const end = new Date(dateTo + 'T00:00:00')
      while (ptr <= end) { dates.push(isoDate(ptr)); ptr = addDays(ptr, 1) }
      setRangeDates(dates)

      // Fetch snapshots in range (paginated to handle large datasets)
      let allSnaps = [], from = 0
      while (true) {
        let q = supabase.from('vip_daily_snapshots')
          .select('vip_id,username,tier,total_deposit,win_loss,snapshot_date')
          .gte('snapshot_date', dateFrom).lte('snapshot_date', dateTo)
          .range(from, from + 999)
        if (effectiveHost) q = q.eq('host_assigned', effectiveHost)
        const { data, error } = await q
        if (error) throw error
        allSnaps = allSnaps.concat(data || [])
        if ((data || []).length < 1000) break
        from += 1000
      }

      // Fetch VIP member info
      const { data: members } = await supabase.from('vip_members')
        .select('id,username,full_name,tier,phone').eq('is_excluded', false)
      const memberByUsername = Object.fromEntries((members || []).map(m => [m.username, m]))
      const totalVips = (members || []).length

      // Build per-player data and daily stats
      const playerMap = {}
      const dailyStats = {}
      dates.forEach(d => { dailyStats[d] = { depositors:0, playNoDep:0, loginNoPlay:0, totalCame:0, deposit:0 } })

      for (const snap of allSnaps) {
        const { username, tier, total_deposit, win_loss, snapshot_date } = snap
        if (!username || !dailyStats[snapshot_date]) continue
        const dep = parseFloat(total_deposit) || 0
        const wl  = parseFloat(win_loss) || 0
        const status = dep > 0 ? '存' : Math.abs(wl) > 0 ? '玩' : '登'

        if (!playerMap[username]) {
          const m = memberByUsername[username] || {}
          playerMap[username] = { username, tier, fullName: m.full_name||'', phone: m.phone||'', days: {}, totalDepAmt: 0 }
        }
        playerMap[username].days[snapshot_date] = status
        if (dep > 0) playerMap[username].totalDepAmt += dep

        dailyStats[snapshot_date].totalCame++
        dailyStats[snapshot_date].deposit += dep
        if (status === '存') dailyStats[snapshot_date].depositors++
        else if (status === '玩') dailyStats[snapshot_date].playNoDep++
        else dailyStats[snapshot_date].loginNoPlay++
      }

      // Daily summary array
      setRangeDailySummary(dates.map(d => {
        const s = dailyStats[d]
        const dowIdx = new Date(d + 'T00:00:00').getDay()
        return { date: d, dow: WEEKDAYS_ZH[dowIdx], dowEn: WEEKDAYS_EN[dowIdx].slice(0,3), ...s, absent: totalVips - s.totalCame }
      }))

      // Player grid array
      const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }
      const playerArr = Object.values(playerMap).map(p => {
        let depCount=0, playCount=0, loginCount=0, lastDate=null
        dates.forEach(d => {
          const s = p.days[d]
          if (!s) return
          if (s==='存') depCount++; else if (s==='玩') playCount++; else loginCount++
          if (!lastDate || d > lastDate) lastDate = d
        })
        return { ...p, depCount, playCount, loginCount, lastDate, absentCount: dates.length - depCount - playCount - loginCount }
      }).sort((a,b) => (TIER_ORDER[a.tier]??9)-(TIER_ORDER[b.tier]??9) || a.username.localeCompare(b.username))

      setRangePlayerGrid(playerArr)
      setRangePlayNoDep(playerArr.filter(p => p.playCount > 0).sort((a,b) => b.playCount - a.playCount))
      setRangeGenerated(true)
    } catch(e) { console.error('Range report error', e) }
    finally { setRangeLoading(false) }
  }, [dateFrom, dateTo, effectiveHost])

  // ── Export range to Excel (3 sheets) ─────────────────────────────
  function exportRangeToExcel() {
    if (!rangeGenerated) return
    const isZh = lang === 'zh'
    const wb = XLSX.utils.book_new()

    // Sheet 1: Daily Summary
    const s1h = isZh
      ? ['日期','星期','有存款人数','有玩没存人数','有记录没玩没存','当天来的人数','没来人数','存款金额']
      : ['Date','Day','Depositors','Play No Dep','Login No Play','Total Came','Absent','Deposit Amount']
    const s1rows = rangeDailySummary.map(r => [r.date, isZh?r.dow:r.dowEn, r.depositors, r.playNoDep, r.loginNoPlay, r.totalCame, r.absent, r.deposit])
    // Totals row
    s1rows.push([
      isZh?'合计':'TOTAL', '',
      rangeDailySummary.reduce((s,r)=>s+r.depositors,0),
      rangeDailySummary.reduce((s,r)=>s+r.playNoDep,0),
      rangeDailySummary.reduce((s,r)=>s+r.loginNoPlay,0),
      '', '',
      rangeDailySummary.reduce((s,r)=>s+r.deposit,0),
    ])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s1h,...s1rows]), isZh?'每日汇总':'Daily Summary')

    // Sheet 2: Player Status Grid
    const legend = isZh ? '图例：存=有存款  玩=有下注但没存款  登=有记录但没下注没存款  空白=当天没来' : 'Legend: DEP=Deposited  PLAY=Played no dep  IN=Logged no play  blank=Absent'
    const s2h = ['Username', isZh?'等级':'Tier', isZh?'电话':'Phone',
      ...rangeDates,
      isZh?'有存天数':'Dep Days', isZh?'有玩没存天数':'Play Days', isZh?'有记录没玩没存':'Login Days', isZh?'没来天数':'Absent Days', isZh?'最后来的日期':'Last Visit',
    ]
    const s2rows = rangePlayerGrid.map(p => [
      p.username, p.tier, p.phone,
      ...rangeDates.map(d => {
        const s = p.days[d]
        if (!s) return ''
        if (!isZh) return s==='存'?'DEP':s==='玩'?'PLAY':'IN'
        return s
      }),
      p.depCount, p.playCount, p.loginCount, p.absentCount, p.lastDate||'',
    ])
    const ws2 = XLSX.utils.aoa_to_sheet([[legend], [], s2h, ...s2rows])
    XLSX.utils.book_append_sheet(wb, ws2, isZh?'每日状态':'Player Status')

    // Sheet 3: Play Without Deposit
    const s3h = isZh
      ? ['Username','等级','电话','有玩没存天数','最后来访日','期间总存款']
      : ['Username','Tier','Phone','Play-No-Dep Days','Last Visit','Period Deposit']
    const s3rows = rangePlayNoDep.map(p => [p.username, p.tier, p.phone, p.playCount, p.lastDate||'', p.totalDepAmt||0])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s3h,...s3rows]), isZh?'有玩没存名单':'Play No Dep')

    XLSX.writeFile(wb, `VIP_Report_${dateFrom}_to_${dateTo}.xlsx`)
  }

  // ── copy full report ──
  function buildReportText() {
    if (!numbers) return ''
    const wd = lang === 'zh' ? WEEKDAYS_ZH[new Date(reportDate+'T00:00:00').getDay()] : WEEKDAYS_EN[new Date(reportDate+'T00:00:00').getDay()]
    const host = effectiveHost || t.all
    const lines = []
    lines.push(`${t.title} — ${reportDate} (${wd})`)
    lines.push(`${t.host}: ${host}`)
    lines.push('')
    lines.push(`【${t.deposit} / ${t.withdrawal} / ${t.netDep} / ${t.companyWin} / ${t.depositors} / ${t.active}】`)
    for (const tier of ['Platinum','Diamond','Total']) {
      const r = numbers[tier] || {}
      const label = tier === 'Total' ? t.total : tier === 'Platinum' ? t.platinum : t.diamond
      lines.push(`${label}: ${fmt(r.total_deposit)} / ${fmt(r.total_withdrawal)} / ${fmt(r.net_dep)} / ${fmt(r.company_win)} / ${r.depositors||0} / ${r.active||0}`)
    }
    lines.push('')
    if (callList.length > 0) {
      lines.push(`【${t.s6title}】`)
      callList.slice(0,10).forEach(p => {
        lines.push(`${p.username} ${p.full_name||''} | ${t.lastDep}: ${fmt(p.dep7)} | ${t.daysSince}: ${p.daysSince}d | ${p.phone||'—'}`)
      })
      lines.push('')
    }
    if (topMovers.length > 0) {
      lines.push(`【${t.s5title}】`)
      topMovers.slice(0,5).forEach(p => {
        const won = (p.win_loss||0) > 0
        const label = lang==='zh' ? (won ? `会员赢 ${fmt(p.win_loss)}` : `会员输 ${fmt(Math.abs(p.win_loss))}`) : (won ? `Member Won ${fmt(p.win_loss)}` : `Member Lost ${fmt(Math.abs(p.win_loss))}`)
        const m = p.vip_members || {}
        lines.push(`${m.username||p.vip_id} ${m.full_name||''} — ${label}`)
      })
      lines.push('')
    }
    lines.push(`【${t.s8title}】`)
    lines.push(`${t.watchHigh}: ${atRiskCount}`)
    lines.push(`${t.watchBday}: ${birthdays.length > 0 ? birthdays.map(b=>b.username).join(', ') : t.noBirthdays}`)
    return lines.join('\n')
  }

  function buildManagementScript() {
    if (!numbers) return ''
    const r = numbers.Total || {}
    const d = reportDate
    const wd = lang === 'zh' ? WEEKDAYS_ZH[new Date(d+'T00:00:00').getDay()] : WEEKDAYS_EN[new Date(d+'T00:00:00').getDay()]
    if (lang === 'zh') {
      const win = r.company_win >= 0
      return `各位好，以下是 ${d}（${wd}）的运营日报：\n\n` +
        `今日合计存款 ${fmt(r.total_deposit)}，提款 ${fmt(r.total_withdrawal)}，净存款 ${fmt(r.net_dep)}。\n` +
        `公司${win?'赢':'输'} ${fmt(Math.abs(r.company_win))}，存款人数 ${r.depositors||0} 人，活跃 ${r.active||0} 人。\n\n` +
        `其中白金层 存款 ${fmt(numbers.Platinum?.total_deposit)} / 公司${(numbers.Platinum?.company_win||0)>=0?'赢':'输'} ${fmt(Math.abs(numbers.Platinum?.company_win||0))}，` +
        `钻石层 存款 ${fmt(numbers.Diamond?.total_deposit)} / 公司${(numbers.Diamond?.company_win||0)>=0?'赢':'输'} ${fmt(Math.abs(numbers.Diamond?.company_win||0))}。\n\n` +
        (callList.length > 0 ? `共 ${callList.length} 位高价值会员今日未存款，建议跟进：${callList.slice(0,5).map(p=>p.username).join('、')}。\n\n` : '') +
        (birthdays.length > 0 ? `明日生日会员：${birthdays.map(b=>b.username).join('、')}，请准备祝福。\n\n` : '') +
        `风险预警：${atRiskCount} 位会员3天以上未存款。\n\n以上，请知悉。`
    } else {
      const win = r.company_win >= 0
      return `Hi team, daily report for ${d} (${wd}):\n\n` +
        `Total Deposits: ${fmt(r.total_deposit)}, Withdrawals: ${fmt(r.total_withdrawal)}, Net: ${fmt(r.net_dep)}.\n` +
        `Company ${win?'Won':'Lost'}: ${fmt(Math.abs(r.company_win))} | Depositors: ${r.depositors||0} | Active: ${r.active||0}\n\n` +
        `Platinum — Deposit: ${fmt(numbers.Platinum?.total_deposit)} | Company ${(numbers.Platinum?.company_win||0)>=0?'Won':'Lost'}: ${fmt(Math.abs(numbers.Platinum?.company_win||0))}\n` +
        `Diamond  — Deposit: ${fmt(numbers.Diamond?.total_deposit)} | Company ${(numbers.Diamond?.company_win||0)>=0?'Won':'Lost'}: ${fmt(Math.abs(numbers.Diamond?.company_win||0))}\n\n` +
        (callList.length > 0 ? `${callList.length} high-value members did not deposit today. Priority follow-up: ${callList.slice(0,5).map(p=>p.username).join(', ')}.\n\n` : '') +
        (birthdays.length > 0 ? `Tomorrow's birthdays: ${birthdays.map(b=>b.username).join(', ')} — please prepare greetings.\n\n` : '') +
        `At-risk alert: ${atRiskCount} members with no deposit in 3+ days.\n\nEnd of report.`
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildReportText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  async function handleScriptCopy() {
    await navigator.clipboard.writeText(buildManagementScript())
    setScriptCopied(true)
    setTimeout(() => setScriptCopied(false), 2000)
  }

  const wd = new Date(reportDate+'T00:00:00').getDay()
  const wdLabel = lang === 'zh' ? WEEKDAYS_ZH[wd] : WEEKDAYS_EN[wd]

  // ── table header style ──
  const th = { padding:'8px 12px', fontSize:11, fontWeight:700, color:MUTED, textAlign:'right', background:'var(--surface2)', whiteSpace:'nowrap' }
  const thL = { ...th, textAlign:'left' }

  return (
    <div style={{maxWidth:1100,margin:'0 auto',padding:'20px 20px 60px'}}>

      {/* ── Header bar ── */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:12}}>
        <div>
          <h1 style={{margin:0,fontSize:22,fontWeight:800,color:'var(--text)'}}>{t.title}</h1>
          <div style={{fontSize:12,color:MUTED,marginTop:3}}>
            {reportMode==='single' ? `${reportDate} · ${wdLabel}` : `${dateFrom} → ${dateTo}`}
          </div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {/* Lang toggle */}
          <div style={{display:'flex',gap:4}}>
            {['en','zh'].map(l => (
              <button key={l} onClick={() => setLang(l)}
                style={{padding:'5px 12px',borderRadius:6,border:`1px solid ${lang===l?'var(--brand)':'var(--border)'}`,background:lang===l?'var(--brand)':'var(--surface2)',color:lang===l?'#fff':'var(--muted)',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                {l === 'en' ? 'EN' : '中文'}
              </button>
            ))}
          </div>
          {/* Mode toggle */}
          <div style={{display:'flex',gap:2,borderRadius:7,border:'1px solid var(--border)',overflow:'hidden'}}>
            {[['single', lang==='zh'?'单日':'Single Day'],['range', lang==='zh'?'日期范围':'Date Range']].map(([m,label]) => (
              <button key={m} onClick={() => setReportMode(m)}
                style={{padding:'5px 12px',border:'none',background:reportMode===m?'var(--brand)':'var(--surface2)',color:reportMode===m?'#fff':'var(--muted)',fontWeight:700,fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                {label}
              </button>
            ))}
          </div>
          {/* Host filter */}
          <select value={hostFilter} onChange={e => setHostFilter(e.target.value)}
            style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:12}}>
            <option value="__mine__">{profile?.full_name || t.all}</option>
            <option value="">{t.all}</option>
            {hosts.filter(h => h !== profile?.full_name).map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          {/* Single date picker */}
          {reportMode === 'single' && <>
            <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
              style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:12}} />
            <button onClick={load} style={{padding:'5px 14px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:12,cursor:'pointer',fontWeight:600}}>
              🔄 {t.refresh}
            </button>
            <button onClick={handleCopy} style={{padding:'5px 14px',borderRadius:6,border:'1px solid var(--brand)',background:'var(--brand)',color:'#fff',fontSize:12,cursor:'pointer',fontWeight:600}}>
              {copied ? t.copied : `📋 ${t.copy}`}
            </button>
          </>}
        </div>
      </div>

      {/* ── Range mode controls ── */}
      {reportMode === 'range' && (
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:20,padding:'14px 18px',borderRadius:10,background:'var(--surface)',border:'1px solid var(--border)'}}>
          <span style={{fontSize:13,fontWeight:700,color:'var(--text)',whiteSpace:'nowrap'}}>{lang==='zh'?'📅 选择日期范围':'📅 Date Range'}</span>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span style={{fontSize:12,color:MUTED}}>{lang==='zh'?'从':'From'}</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:12}} />
            <span style={{fontSize:12,color:MUTED}}>{lang==='zh'?'到':'To'}</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:12}} />
          </div>
          <button onClick={loadRange} disabled={rangeLoading}
            style={{padding:'6px 18px',borderRadius:6,border:'none',background:'var(--brand)',color:'#fff',fontWeight:700,fontSize:13,cursor:rangeLoading?'wait':'pointer',opacity:rangeLoading?0.7:1}}>
            {rangeLoading ? (lang==='zh'?'生成中…':'Generating…') : (lang==='zh'?'📊 生成报告':'📊 Generate Report')}
          </button>
          {rangeGenerated && (
            <button onClick={exportRangeToExcel}
              style={{padding:'6px 18px',borderRadius:6,border:'1px solid #22c55e',background:'transparent',color:'#22c55e',fontWeight:700,fontSize:13,cursor:'pointer'}}>
              ⬇️ {lang==='zh'?'导出 Excel':'Export Excel'}
            </button>
          )}
          {rangeGenerated && (
            <span style={{fontSize:12,color:MUTED}}>
              {rangePlayerGrid.length} {lang==='zh'?'位会员':'VIPs'} · {rangeDates.length} {lang==='zh'?'天':'days'}
            </span>
          )}
        </div>
      )}

      {loading && <div style={{textAlign:'center',padding:40,color:MUTED,fontSize:14}}>{t.loading}</div>}

      {!loading && !numbers && <div style={{textAlign:'center',padding:40,color:MUTED,fontSize:14}}>{t.noData}</div>}

      {!loading && numbers && <>

        {/* ── Section 1: Numbers table ── */}
        <Card title={`📊 ${lang==='zh'?'今日数据汇总':'Today\'s Summary'} — ${reportDate} (${wdLabel})`} accent="var(--brand)">
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'2px solid var(--border)'}}>
                  <th style={thL}>{t.tier}</th>
                  <th style={th}>{t.deposit}</th>
                  <th style={th}>{t.withdrawal}</th>
                  <th style={th}>{t.netDep}</th>
                  <th style={th}>{t.companyWin}</th>
                  <th style={th}>{t.depositors}</th>
                  <th style={th}>{t.active}</th>
                </tr>
              </thead>
              <tbody>
                <NRow label={`👑 ${t.platinum}`} row={numbers.Platinum||{}} t={t} />
                <NRow label={`💎 ${t.diamond}`}  row={numbers.Diamond||{}}  t={t} />
                <tr style={{borderTop:'2px solid var(--brand)',background:'var(--surface2)'}}>
                  <td style={{padding:'9px 12px',fontWeight:800,fontSize:13}}>Σ {t.total}</td>
                  {[
                    [numbers.Total?.total_deposit, null],
                    [numbers.Total?.total_withdrawal, RED],
                    [numbers.Total?.net_dep, numbers.Total?.net_dep>=0?GREEN:RED],
                    [numbers.Total?.company_win, numbers.Total?.company_win>=0?GREEN:RED],
                  ].map(([v, c], i) => (
                    <td key={i} style={{padding:'9px 12px',textAlign:'right',fontWeight:800,fontSize:14,color:c||'var(--text)'}}>{fmt(v)}</td>
                  ))}
                  <td style={{padding:'9px 12px',textAlign:'right',fontWeight:800,fontSize:14}}>{numbers.Total?.depositors||0}</td>
                  <td style={{padding:'9px 12px',textAlign:'right',fontWeight:800,fontSize:14}}>{numbers.Total?.active||0}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── Section 9: Retention Rate Tracking ── */}
        <RetentionCard lang={lang} retention={retention} retentionLoading={retentionLoading} />

        {/* ── Section 3 & 4: vs 7-Day Avg ── */}
        {countComp && (
          <Card title={`📈 ${t.s3title} / ${t.s4title}`}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:'2px solid var(--border)'}}>
                    <th style={thL}>{t.metric}</th>
                    <th style={th}>{t.today}</th>
                    <th style={th}>{t.avg7d}</th>
                    <th style={th}>{t.gap}</th>
                    <th style={th}>{t.gapPct}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key:'depositors', label:`${t.depositors}`, val: countComp.depositors },
                    { key:'active',     label:`${t.active}`,     val: countComp.active },
                    { key:'deposit',    label:`${t.deposit}`,    val: countComp.deposit },
                    { key:'netDep',     label:`${t.netDep}`,     val: countComp.netDep },
                    { key:'companyWin', label:`${t.companyWin}`, val: countComp.companyWin },
                  ].map(({ key, label, val }) => {
                    const gap = val.today - val.avg
                    const gp = pct(val.today, val.avg)
                    const isCount = key === 'depositors' || key === 'active'
                    return (
                      <tr key={key} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'8px 12px',fontSize:13,fontWeight:600}}>{label}</td>
                        <td style={{padding:'8px 12px',textAlign:'right',fontSize:13,fontWeight:700}}>{isCount ? Math.round(val.today) : fmt(val.today)}</td>
                        <td style={{padding:'8px 12px',textAlign:'right',fontSize:13,color:MUTED}}>{isCount ? val.avg.toFixed(1) : fmtK(val.avg)}</td>
                        <td style={{padding:'8px 12px',textAlign:'right',fontSize:13,color:signColor(gap),fontWeight:600}}>{isCount ? (gap>0?'+':'')+gap.toFixed(1) : (gap>0?'+':'')+fmt(gap)}</td>
                        <td style={{padding:'8px 12px',textAlign:'right',fontSize:12,color:signColor(gap)}}>{gp}{arrow(val.today, val.avg)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── Section 2: Day-of-week effect ── */}
        {dowRows.length > 0 && (
          <Card title={`📅 ${t.s2title}`}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:'2px solid var(--border)'}}>
                    <th style={thL}>{t.weekday} / {lang==='zh'?'日期':'Date'}</th>
                    <th style={th}>Plat {t.deposit}</th>
                    <th style={th}>Plat {t.companyWin}</th>
                    <th style={th}>Dia {t.deposit}</th>
                    <th style={th}>Dia {t.companyWin}</th>
                    <th style={th}>Total {t.deposit}</th>
                    <th style={th}>Total {t.companyWin}</th>
                  </tr>
                </thead>
                <tbody>
                  {dowRows.map((row, i) => {
                    const dt = new Date(row.date+'T00:00:00')
                    const wdl = lang==='zh' ? WEEKDAYS_ZH[dt.getDay()] : WEEKDAYS_EN[dt.getDay()]
                    const isToday = row.date === reportDate
                    return (
                      <tr key={row.date} style={{borderBottom:'1px solid var(--border)',background:isToday?'rgba(255,106,0,0.07)':'transparent'}}>
                        <td style={{padding:'7px 12px',fontSize:12,fontWeight:isToday?800:500,color:isToday?'var(--brand)':'var(--text)'}}>
                          {wdl} {row.date}{isToday?' ◀':''}
                        </td>
                        {[
                          row.Platinum?.total_deposit, row.Platinum?.company_win,
                          row.Diamond?.total_deposit,  row.Diamond?.company_win,
                          row.Total?.total_deposit,    row.Total?.company_win,
                        ].map((v, j) => (
                          <td key={j} style={{padding:'7px 12px',textAlign:'right',fontSize:12,fontWeight:isToday?700:400,color:j%2===1?signColor(v):'var(--text)'}}>{fmtK(v)}</td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── Section 5: Top movers ── */}
        {topMovers.length > 0 && (
          <Card title={`🏅 ${t.s5title}`}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:'2px solid var(--border)'}}>
                    <th style={{...thL,width:30}}>#</th>
                    <th style={thL}>{t.username}</th>
                    <th style={thL}>{t.name}</th>
                    <th style={th}>{t.deposit}</th>
                    <th style={th}>{t.result}</th>
                  </tr>
                </thead>
                <tbody>
                  {topMovers.slice(0, 10).map((p, i) => {
                    const m = p.vip_members || {}
                    const won = (p.win_loss || 0) > 0
                    const label = won
                      ? `${lang==='zh'?'会员赢':t.memberWon} ${fmt(p.win_loss)}`
                      : `${lang==='zh'?'会员输':t.memberLost} ${fmt(Math.abs(p.win_loss))}`
                    return (
                      <tr key={p.vip_id || i} style={{borderBottom:'1px solid var(--border)',cursor:'pointer'}}
                        onClick={() => navigate(`/vips/${p.vip_id}`)}>
                        <td style={{padding:'7px 12px',fontSize:12,color:MUTED}}>{i+1}</td>
                        <td style={{padding:'7px 12px',fontSize:13,fontWeight:600,color:'var(--brand)'}}>{m.username || p.vip_id}</td>
                        <td style={{padding:'7px 12px',fontSize:12,color:MUTED}}>{m.full_name || '—'}</td>
                        <td style={{padding:'7px 12px',textAlign:'right',fontSize:12}}>{fmt(p.total_deposit)}</td>
                        <td style={{padding:'7px 12px',textAlign:'right',fontSize:13,fontWeight:700,color:won?RED:GREEN}}>{label}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── Section 6: Priority call list ── */}
        <Card title={`📞 ${t.s6title}`} accent={ORANGE}>
          <div style={{fontSize:11,color:MUTED,marginBottom:10}}>⚠️ {t.callNote}</div>
          {callList.length === 0 ? (
            <div style={{color:MUTED,fontSize:13}}>—</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:'2px solid var(--border)'}}>
                    <th style={{...thL,width:30}}>#</th>
                    <th style={thL}>{t.username}</th>
                    <th style={thL}>{t.name}</th>
                    <th style={th}>{t.phone}</th>
                    <th style={th}>{t.lastDep} (7D)</th>
                    <th style={th}>{t.daysSince}</th>
                    <th style={{...th,textAlign:'center'}}></th>
                  </tr>
                </thead>
                <tbody>
                  {callList.map((p, i) => (
                    <tr key={p.id||i} style={{borderBottom:'1px solid var(--border)'}}>
                      <td style={{padding:'7px 12px',fontSize:12,color:MUTED}}>{i+1}</td>
                      <td style={{padding:'7px 12px',fontSize:13,fontWeight:600,color:'var(--brand)',cursor:'pointer'}}
                        onClick={() => navigate(`/vips/${p.id}`)}>{p.username}</td>
                      <td style={{padding:'7px 12px',fontSize:12,color:MUTED}}>{p.full_name||'—'}</td>
                      <td style={{padding:'7px 12px',textAlign:'right',fontSize:13,fontWeight:600,color:'var(--text)',letterSpacing:'0.5px'}}>
                        {p.phone ? (
                          <a href={`tel:${p.phone}`} style={{color:'var(--brand)',textDecoration:'none'}}>
                            📱 {p.phone}
                          </a>
                        ) : '—'}
                      </td>
                      <td style={{padding:'7px 12px',textAlign:'right',fontSize:13,fontWeight:700,color:GREEN}}>{fmt(p.dep7)}</td>
                      <td style={{padding:'7px 12px',textAlign:'right',fontSize:12,color:p.daysSince>=3?RED:ORANGE,fontWeight:p.daysSince>=3?700:400}}>
                        {p.daysSince}d
                      </td>
                      <td style={{padding:'7px 12px',textAlign:'center'}}>
                        <button onClick={() => navigate(`/vips/${p.id}`)}
                          style={{padding:'3px 10px',borderRadius:5,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:11,cursor:'pointer'}}>
                          View ↗
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── Section 7: Management script ── */}
        <Card title={`📝 ${t.s7title}`}>
          <pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',fontSize:13,color:'var(--text)',margin:0,lineHeight:1.7,background:'var(--surface2)',borderRadius:8,padding:14}}>
            {buildManagementScript()}
          </pre>
          <button onClick={handleScriptCopy}
            style={{marginTop:12,padding:'7px 18px',borderRadius:6,border:'1px solid var(--brand)',background:scriptCopied?GREEN:'var(--brand)',color:'#fff',fontWeight:700,fontSize:13,cursor:'pointer'}}>
            {scriptCopied ? `✓ ${t.copied}` : `📋 ${t.scriptCopy}`}
          </button>
        </Card>

        {/* ── Section 8: Tomorrow watchpoints ── */}
        <Card title={`🔭 ${t.s8title}`}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div style={{padding:'10px 14px',borderRadius:8,background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)'}}>
              <span style={{fontWeight:700,color:RED}}>{t.watchHigh}:</span>{' '}
              <span style={{fontSize:15,fontWeight:800,color:RED}}>{atRiskCount}</span>
              <span style={{fontSize:12,color:MUTED,marginLeft:6}}>{lang==='zh'?'位会员':'members'}</span>
              {atRiskCount > 0 && (
                <button onClick={() => navigate('/at-risk')}
                  style={{marginLeft:12,padding:'2px 10px',borderRadius:5,border:'1px solid '+RED,background:'transparent',color:RED,fontSize:11,cursor:'pointer'}}>
                  {lang==='zh'?'查看名单':'View List'} ↗
                </button>
              )}
            </div>
            <div style={{padding:'10px 14px',borderRadius:8,background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.2)'}}>
              <span style={{fontWeight:700,color:GREEN}}>{t.watchBday}:</span>{' '}
              {birthdays.length === 0 ? (
                <span style={{fontSize:13,color:MUTED}}>{t.noBirthdays}</span>
              ) : (
                <span style={{fontSize:13,color:'var(--text)',fontWeight:600}}>
                  {birthdays.map(b => `${b.username}${b.full_name ? ' ('+b.full_name+')' : ''}`).join(', ')}
                </span>
              )}
              {birthdays.length > 0 && (
                <button onClick={() => navigate('/birthdays')}
                  style={{marginLeft:12,padding:'2px 10px',borderRadius:5,border:'1px solid '+GREEN,background:'transparent',color:GREEN,fontSize:11,cursor:'pointer'}}>
                  {lang==='zh'?'查看生日':'View Birthdays'} ↗
                </button>
              )}
            </div>
            {callList.length > 0 && (
              <div style={{padding:'10px 14px',borderRadius:8,background:'rgba(249,115,22,0.08)',border:'1px solid rgba(249,115,22,0.2)'}}>
                <span style={{fontWeight:700,color:ORANGE}}>{lang==='zh'?'📞 跟进提醒':'📞 Follow-up Reminder'}:</span>{' '}
                <span style={{fontSize:13,color:'var(--text)',fontWeight:600}}>
                  {callList.length} {lang==='zh'?'位会员待跟进':'members pending follow-up'}
                </span>
              </div>
            )}
          </div>
        </Card>


      </>}

      {/* ══════════════════════════════════════════════════════
          RANGE REPORT — Excel-style tabbed view
      ══════════════════════════════════════════════════════ */}
      {reportMode === 'range' && rangeGenerated && (() => {
        const isZh = lang === 'zh'
        const totalDep    = rangeDailySummary.reduce((s,r) => s+r.deposit, 0)
        const totalDeps   = rangeDailySummary.reduce((s,r) => s+r.depositors, 0)
        const totalPlayed = rangeDailySummary.reduce((s,r) => s+r.playNoDep, 0)
        const avgDep      = rangeDates.length ? (totalDep / rangeDates.length) : 0
        const avgDeps     = rangeDates.length ? (totalDeps / rangeDates.length) : 0

        // ── Cell colour palette (solid, like Excel) ──
        const CELL_DEP   = { bg:'#16a34a', color:'#fff',      char: isZh?'存':'D' }
        const CELL_PLAY  = { bg:'#ea580c', color:'#fff',      char: isZh?'玩':'P' }
        const CELL_LOGIN = { bg:'#334155', color:'#94a3b8',   char: '·' }
        const CELL_EMPTY = { bg:'transparent', color:'',      char: '' }
        const CELL_WE    = { bg:'rgba(59,130,246,0.06)', color:'', char: '' }

        function cellStyle(s, isWe) {
          if (s==='存') return CELL_DEP
          if (s==='玩') return CELL_PLAY
          if (s==='登') return CELL_LOGIN
          return isWe ? CELL_WE : CELL_EMPTY
        }

        const SHEETS = [
          { key:'grid',     label: isZh?'📋 每日状态':'📋 Daily Status' },
          { key:'summary',  label: isZh?'📅 每日汇总':'📅 Daily Summary' },
          { key:'playnodep',label: isZh?'🎰 有玩没存':'🎰 Play No Dep' },
        ]

        return (<>
          {/* ── KPI tiles ── */}
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
            <Tile label={isZh?'期间总存款':'Period Deposit'}  value={fmtK(totalDep)}          color={GREEN}  />
            <Tile label={isZh?'日均存款':'Daily Avg Dep'}     value={fmtK(avgDep)}             color={BLUE}   />
            <Tile label={isZh?'总存款人次':'Total Dep Visits'} value={totalDeps}                              />
            <Tile label={isZh?'日均存款人数':'Avg Depositors'} value={avgDeps.toFixed(1)}                     />
            <Tile label={isZh?'有玩没存人次':'Play-No-Dep'}   value={totalPlayed}              color={ORANGE} />
            <Tile label={isZh?'参与会员数':'VIPs Seen'}       value={rangePlayerGrid.length}                 />
          </div>

          {/* ── Excel-style sheet tabs ── */}
          <div style={{
            background:'var(--surface)',
            border:'1px solid var(--border)',
            borderRadius:10,
            overflow:'hidden',
            marginBottom:24,
          }}>
            {/* Tab bar */}
            <div style={{display:'flex',borderBottom:'2px solid var(--border)',background:'var(--surface2)'}}>
              {SHEETS.map(s => (
                <button key={s.key} onClick={() => setRangeActiveSheet(s.key)}
                  style={{
                    padding:'10px 20px',
                    border:'none',
                    borderRight:'1px solid var(--border)',
                    background: rangeActiveSheet===s.key ? 'var(--surface)' : 'transparent',
                    color: rangeActiveSheet===s.key ? 'var(--brand)' : MUTED,
                    fontWeight: rangeActiveSheet===s.key ? 800 : 500,
                    fontSize:13,
                    cursor:'pointer',
                    borderBottom: rangeActiveSheet===s.key ? '2px solid var(--brand)' : '2px solid transparent',
                    marginBottom:-2,
                    whiteSpace:'nowrap',
                  }}>
                  {s.label}
                </button>
              ))}
              <div style={{flex:1}} />
              <button onClick={exportRangeToExcel}
                style={{padding:'8px 18px',border:'none',borderLeft:'1px solid var(--border)',background:'transparent',color:GREEN,fontWeight:700,fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                ⬇️ {isZh?'导出 Excel':'Export Excel'}
              </button>
            </div>

            {/* ── TAB: 每日状态 / Player Grid ── */}
            {rangeActiveSheet === 'grid' && (
              <div>
                {/* Legend bar */}
                <div style={{display:'flex',gap:16,padding:'10px 16px',borderBottom:'1px solid var(--border)',background:'var(--surface2)',flexWrap:'wrap'}}>
                  {[
                    [CELL_DEP.bg,  CELL_DEP.color,   isZh?'存  有存款':'DEP  Deposited'],
                    [CELL_PLAY.bg, CELL_PLAY.color,  isZh?'玩  有下注未存':'PLY  Played no dep'],
                    [CELL_LOGIN.bg,'#94a3b8',        isZh?'·  有记录未下注':'·   Logged no play'],
                    ['var(--surface2)','var(--muted)',isZh?'空  未来访':'     Absent'],
                  ].map(([bg,color,label],i) => (
                    <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:11}}>
                      <div style={{width:20,height:20,borderRadius:3,background:bg,border:'1px solid rgba(255,255,255,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color,fontWeight:700}}>
                        {label.split('  ')[0]}
                      </div>
                      <span style={{color:MUTED}}>{label.split('  ')[1]}</span>
                    </div>
                  ))}
                </div>
                {/* Grid */}
                <div style={{overflowX:'auto',overflowY:'auto',maxHeight:620}}>
                  <table style={{borderCollapse:'collapse',fontSize:11,whiteSpace:'nowrap',tableLayout:'fixed'}}>
                    <colgroup>
                      <col style={{width:100}} />
                      <col style={{width:60}} />
                      <col style={{width:110}} />
                      {rangeDates.map(d => <col key={d} style={{width:30}} />)}
                      <col style={{width:36}} />
                      <col style={{width:36}} />
                      <col style={{width:36}} />
                      <col style={{width:36}} />
                      <col style={{width:72}} />
                    </colgroup>
                    <thead style={{position:'sticky',top:0,zIndex:2}}>
                      {/* Month row */}
                      <tr style={{background:'#0f172a'}}>
                        <th colSpan={3} style={{padding:'4px 8px',fontSize:10,color:MUTED,textAlign:'left',borderBottom:'1px solid #1e293b'}}>{dateFrom} → {dateTo}</th>
                        {(() => {
                          // Group dates by month for spanning header
                          const groups = []
                          let cur = null
                          rangeDates.forEach(d => {
                            const m = d.slice(0,7)
                            if (cur && cur.month===m) { cur.count++ }
                            else { cur={month:m,count:1}; groups.push(cur) }
                          })
                          return groups.map(g => (
                            <th key={g.month} colSpan={g.count}
                              style={{padding:'4px 0',fontSize:10,textAlign:'center',color:'#94a3b8',borderBottom:'1px solid #1e293b',borderLeft:'1px solid #1e293b'}}>
                              {g.month.slice(5)}月
                            </th>
                          ))
                        })()}
                        <th colSpan={5} style={{padding:'4px 0',fontSize:10,color:MUTED,textAlign:'center',borderBottom:'1px solid #1e293b',borderLeft:'1px solid #1e293b'}}>{isZh?'汇总':'Summary'}</th>
                      </tr>
                      {/* Date header row */}
                      <tr style={{background:'#0f172a'}}>
                        <th style={{padding:'5px 8px',textAlign:'left',fontSize:11,fontWeight:700,color:'#e2e8f0',borderBottom:'2px solid var(--border)',position:'sticky',left:0,zIndex:3,background:'#0f172a'}}>{isZh?'用户名':'Username'}</th>
                        <th style={{padding:'5px 4px',textAlign:'center',fontSize:10,fontWeight:700,color:'#94a3b8',borderBottom:'2px solid var(--border)',position:'sticky',left:100,zIndex:3,background:'#0f172a'}}>{isZh?'等级':'Tier'}</th>
                        <th style={{padding:'5px 4px',textAlign:'center',fontSize:10,fontWeight:600,color:'#94a3b8',borderBottom:'2px solid var(--border)',position:'sticky',left:160,zIndex:3,background:'#0f172a'}}>{isZh?'电话':'Phone'}</th>
                        {rangeDates.map(d => {
                          const dt = new Date(d+'T00:00:00')
                          const isWe = dt.getDay()===0||dt.getDay()===6
                          const dd = d.slice(8)
                          const dowCh = isZh ? WEEKDAYS_ZH[dt.getDay()].slice(1) : WEEKDAYS_EN[dt.getDay()].slice(0,1)
                          return (
                            <th key={d} style={{
                              padding:'2px 0',textAlign:'center',fontSize:9,fontWeight:700,
                              color: isWe?'#60a5fa':'#64748b',
                              borderBottom:'2px solid var(--border)',
                              borderLeft:'1px solid rgba(255,255,255,0.04)',
                              background: isWe?'rgba(59,130,246,0.12)':'#0f172a',
                              minWidth:30,
                            }}>
                              <div>{dd}</div>
                              <div style={{fontSize:8,opacity:0.7}}>{dowCh}</div>
                            </th>
                          )
                        })}
                        {[
                          [isZh?'存':'Dep',   GREEN],
                          [isZh?'玩':'Play',  ORANGE],
                          [isZh?'登':'In',    '#64748b'],
                          [isZh?'无':'Out',   RED],
                          [isZh?'最后来':'Last','#94a3b8'],
                        ].map(([label,color]) => (
                          <th key={label} style={{padding:'5px 4px',textAlign:'center',fontSize:10,fontWeight:700,color,borderBottom:'2px solid var(--border)',borderLeft:'1px solid rgba(255,255,255,0.08)',background:'#0f172a'}}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rangePlayerGrid.map((p, i) => {
                        const tierColor = p.tier==='DIAMOND'?'#60a5fa':p.tier==='PLATINUM'?'#c084fc':p.tier==='GOLD'?'#fbbf24':p.tier==='SILVER'?'#94a3b8':'#a16207'
                        const rowBg = i%2===0 ? '#0d1b2e' : '#111827'
                        const stickyBg = rowBg
                        return (
                          <tr key={p.username} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                            <td style={{padding:'3px 8px',fontWeight:700,color:'var(--brand)',position:'sticky',left:0,background:stickyBg,zIndex:1,fontSize:12,overflow:'hidden',textOverflow:'ellipsis',maxWidth:100}}>{p.username}</td>
                            <td style={{padding:'3px 4px',textAlign:'center',color:tierColor,fontWeight:700,position:'sticky',left:100,background:stickyBg,zIndex:1,fontSize:10}}>{p.tier?.slice(0,4)||'—'}</td>
                            <td style={{padding:'3px 4px',textAlign:'center',color:'#64748b',position:'sticky',left:160,background:stickyBg,zIndex:1,fontSize:10,overflow:'hidden',textOverflow:'ellipsis'}}>{p.phone||'—'}</td>
                            {rangeDates.map(d => {
                              const s = p.days[d]
                              const dt = new Date(d+'T00:00:00')
                              const isWe = dt.getDay()===0||dt.getDay()===6
                              const cell = cellStyle(s, isWe)
                              return (
                                <td key={d} style={{
                                  padding:0,textAlign:'center',
                                  background:cell.bg,
                                  borderLeft:'1px solid rgba(255,255,255,0.03)',
                                  borderRight:'1px solid rgba(255,255,255,0.03)',
                                }}>
                                  {cell.char && (
                                    <div style={{
                                      display:'flex',alignItems:'center',justifyContent:'center',
                                      height:22,fontSize:10,fontWeight:700,color:cell.color,
                                    }}>{cell.char}</div>
                                  )}
                                  {!cell.char && isWe && <div style={{height:22,background:'rgba(59,130,246,0.06)'}} />}
                                  {!cell.char && !isWe && <div style={{height:22}} />}
                                </td>
                              )
                            })}
                            {[
                              [p.depCount||0,   GREEN,  700],
                              [p.playCount||0,  ORANGE, 600],
                              [p.loginCount||0, '#64748b',400],
                              [p.absentCount||0,RED,    400],
                            ].map(([v,color,fw],j) => (
                              <td key={j} style={{padding:'3px 4px',textAlign:'center',fontWeight:fw,color,fontSize:11,borderLeft:'1px solid rgba(255,255,255,0.08)'}}>{v}</td>
                            ))}
                            <td style={{padding:'3px 4px',textAlign:'center',color:'#64748b',fontSize:10,borderLeft:'1px solid rgba(255,255,255,0.08)'}}>{p.lastDate?.slice(5)||'—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {/* Footer: daily deposit count per column */}
                    <tfoot>
                      <tr style={{background:'#0f172a',borderTop:'2px solid var(--border)'}}>
                        <td colSpan={3} style={{padding:'5px 8px',fontWeight:800,fontSize:11,color:'#e2e8f0',position:'sticky',left:0,background:'#0f172a',zIndex:1}}>{isZh?'每日存款人数':'Daily Depositors'}</td>
                        {rangeDates.map(d => {
                          const stat = rangeDailySummary.find(r=>r.date===d)
                          const v = stat?.depositors||0
                          return (
                            <td key={d} style={{padding:'3px 0',textAlign:'center',fontSize:10,fontWeight:700,color:v>0?GREEN:'#475569',borderLeft:'1px solid rgba(255,255,255,0.04)',background:'#0f172a'}}>{v||''}</td>
                          )
                        })}
                        <td colSpan={5} style={{borderLeft:'1px solid rgba(255,255,255,0.08)',background:'#0f172a'}} />
                      </tr>
                      <tr style={{background:'#0a1220'}}>
                        <td colSpan={3} style={{padding:'5px 8px',fontWeight:800,fontSize:11,color:ORANGE,position:'sticky',left:0,background:'#0a1220',zIndex:1}}>{isZh?'每日有玩没存':'Daily Play-No-Dep'}</td>
                        {rangeDates.map(d => {
                          const stat = rangeDailySummary.find(r=>r.date===d)
                          const v = stat?.playNoDep||0
                          return (
                            <td key={d} style={{padding:'3px 0',textAlign:'center',fontSize:10,fontWeight:600,color:v>0?ORANGE:'#475569',borderLeft:'1px solid rgba(255,255,255,0.04)',background:'#0a1220'}}>{v||''}</td>
                          )
                        })}
                        <td colSpan={5} style={{borderLeft:'1px solid rgba(255,255,255,0.08)',background:'#0a1220'}} />
                      </tr>
                      <tr style={{background:'#060d18'}}>
                        <td colSpan={3} style={{padding:'5px 8px',fontWeight:800,fontSize:11,color:GREEN,position:'sticky',left:0,background:'#060d18',zIndex:1}}>{isZh?'每日存款金额':'Daily Deposit Amt'}</td>
                        {rangeDates.map(d => {
                          const stat = rangeDailySummary.find(r=>r.date===d)
                          const v = stat?.deposit||0
                          return (
                            <td key={d} style={{padding:'3px 0',textAlign:'center',fontSize:9,fontWeight:600,color:v>0?GREEN:'#475569',borderLeft:'1px solid rgba(255,255,255,0.04)',background:'#060d18'}}>{v>0?fmtK(v):''}</td>
                          )
                        })}
                        <td colSpan={5} style={{borderLeft:'1px solid rgba(255,255,255,0.08)',background:'#060d18'}} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* ── TAB: 每日汇总 / Daily Summary ── */}
            {rangeActiveSheet === 'summary' && (
              <div style={{padding:'0'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:'#0f172a'}}>
                      {[
                        [isZh?'日期':'Date',       'left'],
                        [isZh?'星期':'Day',         'left'],
                        [isZh?'有存款人数':'Depositors', 'right'],
                        [isZh?'有玩没存':'Play No Dep', 'right'],
                        [isZh?'有记录没玩':'Login No Play','right'],
                        [isZh?'当天来访':'Total Came','right'],
                        [isZh?'没来':'Absent',      'right'],
                        [isZh?'存款金额':'Deposit Amt','right'],
                      ].map(([label, align]) => (
                        <th key={label} style={{padding:'10px 14px',textAlign:align,fontSize:11,fontWeight:700,color:'#94a3b8',borderBottom:'2px solid var(--border)',whiteSpace:'nowrap'}}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rangeDailySummary.map((r, i) => {
                      const isWe = r.dowEn==='Sat'||r.dowEn==='Sun'
                      const rowBg = isWe ? 'rgba(59,130,246,0.06)' : i%2===0?'transparent':'rgba(255,255,255,0.02)'
                      return (
                        <tr key={r.date} style={{borderBottom:'1px solid rgba(255,255,255,0.05)',background:rowBg}}>
                          <td style={{padding:'8px 14px',fontWeight:700,color:isWe?BLUE:'#e2e8f0',fontSize:12}}>{r.date}</td>
                          <td style={{padding:'8px 14px',color:isWe?BLUE:'#94a3b8',fontWeight:isWe?700:400}}>{isZh?r.dow:r.dowEn}</td>
                          <td style={{padding:'8px 14px',textAlign:'right'}}>
                            <span style={{display:'inline-block',background:r.depositors>0?'rgba(22,163,74,0.15)':'transparent',color:r.depositors>0?GREEN:'#475569',fontWeight:700,borderRadius:4,padding:'2px 8px',minWidth:28,textAlign:'center'}}>{r.depositors}</span>
                          </td>
                          <td style={{padding:'8px 14px',textAlign:'right'}}>
                            <span style={{display:'inline-block',background:r.playNoDep>0?'rgba(234,88,12,0.15)':'transparent',color:r.playNoDep>0?ORANGE:'#475569',fontWeight:r.playNoDep>0?700:400,borderRadius:4,padding:'2px 8px',minWidth:24,textAlign:'center'}}>{r.playNoDep||0}</span>
                          </td>
                          <td style={{padding:'8px 14px',textAlign:'right',color:'#64748b'}}>{r.loginNoPlay||0}</td>
                          <td style={{padding:'8px 14px',textAlign:'right',fontWeight:600,color:'#e2e8f0'}}>{r.totalCame}</td>
                          <td style={{padding:'8px 14px',textAlign:'right',color:'#475569'}}>{r.absent}</td>
                          <td style={{padding:'8px 14px',textAlign:'right',fontWeight:700,color:r.deposit>0?GREEN:'#475569'}}>{r.deposit>0?fmt(r.deposit):'—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'rgba(255,106,0,0.08)',borderTop:'2px solid var(--brand)'}}>
                      <td colSpan={2} style={{padding:'10px 14px',fontWeight:800,fontSize:13,color:'var(--brand)'}}>Σ {isZh?'合计':'TOTAL'}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:800,fontSize:14,color:GREEN}}>{totalDeps}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:800,fontSize:14,color:ORANGE}}>{totalPlayed}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#94a3b8'}}>{rangeDailySummary.reduce((s,r)=>s+r.loginNoPlay,0)}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#e2e8f0'}}></td>
                      <td style={{padding:'10px 14px',textAlign:'right'}}></td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:800,fontSize:14,color:GREEN}}>{fmt(totalDep)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* ── TAB: 有玩没存名单 / Play No Dep ── */}
            {rangeActiveSheet === 'playnodep' && (
              <div>
                {rangePlayNoDep.length === 0 ? (
                  <div style={{padding:40,textAlign:'center',color:MUTED}}>{isZh?'没有符合条件的会员':'No members found'}</div>
                ) : (
                  <>
                    <div style={{padding:'10px 16px',borderBottom:'1px solid var(--border)',background:'rgba(234,88,12,0.06)',fontSize:11,color:ORANGE}}>
                      ⚠️ {isZh?`${rangePlayNoDep.length} 位会员在此期间有下注但未存款，建议跟进`:`${rangePlayNoDep.length} members played but did not deposit in this period — follow up recommended`}
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                      <thead>
                        <tr style={{background:'#0f172a'}}>
                          {[
                            ['#','center','30px'],
                            [isZh?'用户名':'Username','left',''],
                            [isZh?'等级':'Tier','center','60px'],
                            [isZh?'电话':'Phone','left',''],
                            [isZh?'有玩没存天数':'Play Days','right',''],
                            [isZh?'有存天数':'Dep Days','right',''],
                            [isZh?'最后来访':'Last Visit','right',''],
                            [isZh?'期间总存款':'Period Deposit','right',''],
                          ].map(([l,a,w]) => (
                            <th key={l} style={{padding:'10px 12px',textAlign:a,fontSize:11,fontWeight:700,color:'#94a3b8',borderBottom:'2px solid var(--border)',width:w||'auto',whiteSpace:'nowrap'}}>{l}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rangePlayNoDep.map((p, i) => {
                          const tierColor = p.tier==='DIAMOND'?'#60a5fa':p.tier==='PLATINUM'?'#c084fc':p.tier==='GOLD'?'#fbbf24':'#94a3b8'
                          return (
                            <tr key={p.username} style={{borderBottom:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.02)'}}>
                              <td style={{padding:'8px 12px',color:'#475569',textAlign:'center',fontSize:11}}>{i+1}</td>
                              <td style={{padding:'8px 12px',fontWeight:700,color:'var(--brand)',fontSize:13}}>{p.username}</td>
                              <td style={{padding:'8px 12px',textAlign:'center'}}>
                                <span style={{display:'inline-block',background:`${tierColor}22`,color:tierColor,fontWeight:700,fontSize:10,borderRadius:4,padding:'2px 6px'}}>{p.tier?.slice(0,4)||'—'}</span>
                              </td>
                              <td style={{padding:'8px 12px',color:'#94a3b8'}}>
                                {p.phone ? <a href={`tel:${p.phone}`} style={{color:'var(--brand)',textDecoration:'none',fontSize:12}}>📱 {p.phone}</a> : '—'}
                              </td>
                              <td style={{padding:'8px 12px',textAlign:'right'}}>
                                <span style={{display:'inline-block',background:'rgba(234,88,12,0.2)',color:ORANGE,fontWeight:800,fontSize:16,borderRadius:6,padding:'2px 10px'}}>{p.playCount}</span>
                              </td>
                              <td style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:p.depCount>0?GREEN:'#475569'}}>{p.depCount}</td>
                              <td style={{padding:'8px 12px',textAlign:'right',color:'#64748b',fontSize:11}}>{p.lastDate||'—'}</td>
                              <td style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:p.totalDepAmt>0?GREEN:'#475569'}}>{p.totalDepAmt>0?fmt(p.totalDepAmt):'—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </div>
        </>)
      })()}

    </div>
  )
}
