// src/pages/DailyReport.jsx — Daily Analytics Report (Platinum / Diamond)
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

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
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:20}}>
        <div>
          <h1 style={{margin:0,fontSize:22,fontWeight:800,color:'var(--text)'}}>{t.title}</h1>
          <div style={{fontSize:12,color:MUTED,marginTop:3}}>{reportDate} · {wdLabel}</div>
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
          {/* Date picker */}
          <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
            style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:12}} />
          {/* Host filter */}
          <select value={hostFilter} onChange={e => setHostFilter(e.target.value)}
            style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:12}}>
            <option value="__mine__">{profile?.full_name || t.all}</option>
            <option value="">{t.all}</option>
            {hosts.filter(h => h !== profile?.full_name).map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          {/* Refresh */}
          <button onClick={load} style={{padding:'5px 14px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:12,cursor:'pointer',fontWeight:600}}>
            🔄 {t.refresh}
          </button>
          {/* Copy report */}
          <button onClick={handleCopy} style={{padding:'5px 14px',borderRadius:6,border:'1px solid var(--brand)',background:'var(--brand)',color:'#fff',fontSize:12,cursor:'pointer',fontWeight:600}}>
            {copied ? t.copied : `📋 ${t.copy}`}
          </button>
        </div>
      </div>

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
    </div>
  )
}
