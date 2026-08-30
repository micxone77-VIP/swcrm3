// PeriodReport.jsx — flexible period-over-period comparison for P+D+B VIPs
// Default is Monday-Sunday this-week-vs-last-week, but any two date ranges
// can be compared (e.g. Aug 1-15 vs Aug 16-31, or a full month vs a half-month).
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/format'
import { callAI } from '../lib/aiApi'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam } from '../hooks/useUrlParam'

const TIERS = ['BLACK', 'DIAMOND', 'PLATINUM', 'GOLD']

function toDateStr(d) { return d.toISOString().slice(0, 10) }
function getMonday(d) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }

function defaultRanges() {
  const today = new Date()
  const thisMonday = getMonday(today)
  const lastMonday = addDays(thisMonday, -7)
  const lastSunday = addDays(thisMonday, -1)
  return {
    aStart: toDateStr(thisMonday), aEnd: toDateStr(today),
    bStart: toDateStr(lastMonday), bEnd: toDateStr(lastSunday),
  }
}

// Fetches all daily snapshots for P+D+B in the given currency across the
// union of both date ranges, paginated (a month across 3 tiers can exceed
// Supabase's 1000-row cap per request).
async function fetchSnapshots(currency, minDate, maxDate) {
  let all = [], from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase.from('vip_daily_snapshots')
      .select('username, tier, snapshot_date, total_deposit, monthly_valid_bet')
      .in('tier', TIERS).eq('currency', currency)
      .gte('snapshot_date', minDate).lte('snapshot_date', maxDate)
      .range(from, from + PAGE - 1)
    if (error) { console.error('fetchSnapshots error', error); break }
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

function computeMetrics(snaps, start, end, tierFilter) {
  const rows = snaps.filter(s => s.snapshot_date >= start && s.snapshot_date <= end && (!tierFilter || s.tier === tierFilter))
  // CRITICAL: on days with no genuine betting activity, the platform's raw
  // export carries stale, non-zero total_deposit values left over from
  // before — only monthly_valid_bet reliably zeroes out on inactive days.
  // Summing total_deposit without this gate silently counts deposit amounts
  // from days that were actually inactive, wildly inflating the total.
  const activeRows = rows.filter(r => (parseFloat(r.monthly_valid_bet) || 0) > 0)

  const validBet = activeRows.reduce((sum, r) => sum + (parseFloat(r.monthly_valid_bet) || 0), 0)
  const deposit = activeRows.reduce((sum, r) => sum + (parseFloat(r.total_deposit) || 0), 0)

  const byDay = {}
  activeRows.forEach(r => {
    if (!byDay[r.snapshot_date]) byDay[r.snapshot_date] = new Set()
    if ((parseFloat(r.total_deposit) || 0) > 0) byDay[r.snapshot_date].add(r.username)
  })
  const dayKeys = Object.keys(byDay)
  const dailyAvgDepositors = dayKeys.length > 0
    ? Math.round(dayKeys.reduce((sum, d) => sum + byDay[d].size, 0) / dayKeys.length)
    : 0

  const depositorUsernames = new Set(activeRows.filter(r => (parseFloat(r.total_deposit) || 0) > 0).map(r => r.username))
  const uniqueDepositors = depositorUsernames.size
  const avgPerDepositor = uniqueDepositors > 0 ? deposit / uniqueDepositors : 0

  return { validBet, deposit, dailyAvgDepositors, uniqueDepositors, avgPerDepositor }
}

function pctChange(from, to) {
  if (!from) return to > 0 ? 100 : 0
  return Math.round((to - from) / from * 1000) / 10
}

const s = {
  page: { padding:'24px 28px', color:'var(--text)' },
  card: { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, marginBottom:20, overflow:'hidden' },
  th: { padding:'9px 14px', background:'var(--surface2)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)' },
  td: { padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:13 },
  input: { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:12, color:'var(--text)' },
}

export default function PeriodReport() {
  const { lang, t } = useLanguage()
  const d = defaultRanges()
  const [currency, setCurrency] = useUrlParam('currency', 'MYR')
  const [aStart, setAStart] = useUrlParam('aStart', d.aStart)
  const [aEnd, setAEnd] = useUrlParam('aEnd', d.aEnd)
  const [bStart, setBStart] = useUrlParam('bStart', d.bStart)
  const [bEnd, setBEnd] = useUrlParam('bEnd', d.bEnd)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  function applyPreset(preset) {
    const today = new Date()
    if (preset === 'week') {
      const thisMonday = getMonday(today)
      const lastMonday = addDays(thisMonday, -7)
      setAStart(toDateStr(thisMonday)); setAEnd(toDateStr(today))
      setBStart(toDateStr(lastMonday)); setBEnd(toDateStr(addDays(thisMonday, -1)))
    } else if (preset === 'month') {
      const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const lastMonthEnd = addDays(thisMonthStart, -1)
      setAStart(toDateStr(thisMonthStart)); setAEnd(toDateStr(today))
      setBStart(toDateStr(lastMonthStart)); setBEnd(toDateStr(lastMonthEnd))
    }
  }

  async function loadReport() {
    setLoading(true)
    setAnalysis(null)
    try {
      const minDate = bStart < aStart ? bStart : aStart
      const maxDate = bEnd > aEnd ? bEnd : aEnd
      const snaps = await fetchSnapshots(currency, minDate, maxDate)

      const overviewA = computeMetrics(snaps, aStart, aEnd, null)
      const overviewB = computeMetrics(snaps, bStart, bEnd, null)

      const tierRows = TIERS.map(tier => {
        const a = computeMetrics(snaps, aStart, aEnd, tier)
        const b = computeMetrics(snaps, bStart, bEnd, tier)
        return {
          tier, depositA: a.deposit, depositB: b.deposit,
          dollarChange: a.deposit - b.deposit, changePct: pctChange(b.deposit, a.deposit),
          depositorsA: a.uniqueDepositors, depositorsB: b.uniqueDepositors,
          depositorChangePct: pctChange(b.uniqueDepositors, a.uniqueDepositors),
        }
      })
      const totalAbsChange = tierRows.reduce((sum, t) => sum + Math.abs(t.dollarChange), 0)
      tierRows.forEach(t => { t.contributionPct = totalAbsChange > 0 ? Math.round(Math.abs(t.dollarChange) / totalAbsChange * 1000) / 10 : 0 })

      setReport({ overviewA, overviewB, tierRows })
    } finally {
      setLoading(false)
    }
  }

  async function runAnalysis() {
    if (!report) return
    setAnalyzing(true)
    try {
      const result = await callAI('period-report-analysis', {
        periodALabel: `${aStart} to ${aEnd}`,
        periodBLabel: `${bStart} to ${bEnd}`,
        currency,
        overview: {
          validBetA: Math.round(report.overviewA.validBet), validBetB: Math.round(report.overviewB.validBet),
          validBetChangePct: pctChange(report.overviewB.validBet, report.overviewA.validBet),
          depositA: Math.round(report.overviewA.deposit), depositB: Math.round(report.overviewB.deposit),
          depositChangePct: pctChange(report.overviewB.deposit, report.overviewA.deposit),
          dailyAvgDepositorsA: report.overviewA.dailyAvgDepositors, dailyAvgDepositorsB: report.overviewB.dailyAvgDepositors,
          depositorCountChangePct: pctChange(report.overviewB.dailyAvgDepositors, report.overviewA.dailyAvgDepositors),
          uniqueDepositorsA: report.overviewA.uniqueDepositors, uniqueDepositorsB: report.overviewB.uniqueDepositors,
          avgPerDepositorA: Math.round(report.overviewA.avgPerDepositor), avgPerDepositorB: Math.round(report.overviewB.avgPerDepositor),
        },
        tierBreakdown: report.tierRows.map(t => ({
          tier: t.tier, periodA: Math.round(t.depositA), periodB: Math.round(t.depositB),
          changePct: t.changePct, contributionPct: t.contributionPct,
          depositorsA: t.depositorsA, depositorsB: t.depositorsB, depositorChangePct: t.depositorChangePct,
        })),
        language: lang,
      })
      setAnalysis(result.analysis)
    } catch (e) {
      alert('Could not generate analysis: ' + e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const metricRows = report ? [
    { label: t('periodReport.metricValidBet'), a: report.overviewA.validBet, b: report.overviewB.validBet, isMoney: true },
    { label: t('periodReport.metricDeposit'), a: report.overviewA.deposit, b: report.overviewB.deposit, isMoney: true },
    { label: t('periodReport.metricDailyAvgDepositors'), a: report.overviewA.dailyAvgDepositors, b: report.overviewB.dailyAvgDepositors, isMoney: false },
    { label: t('periodReport.metricUniqueDepositors'), a: report.overviewA.uniqueDepositors, b: report.overviewB.uniqueDepositors, isMoney: false },
    { label: t('periodReport.metricAvgPerDepositor'), a: report.overviewA.avgPerDepositor, b: report.overviewB.avgPerDepositor, isMoney: true },
  ] : []

  return (
    <div style={s.page}>
      <div style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>📅 {t('periodReport.title')}</div>
      <div style={{ fontSize:13, color:'var(--muted)', marginBottom:12 }}>{t('periodReport.subtitle')}</div>

      <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 16px',marginBottom:16,fontSize:13,color:'var(--muted)'}}>
        📋 Compare two date ranges for selected tiers — deposit totals, depositor counts, valid bet, and daily averages. Currently supports Platinum, Diamond, Black, and Gold tiers.
      </div>

      <div style={s.card}>
        <div style={{ padding:16, display:'flex', flexWrap:'wrap', gap:16, alignItems:'flex-end' }}>
          <div>
            <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4 }}>{t('periodReport.currency')}</div>
            <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
              {['MYR','SGD','KHUSD'].map(c => (
                <button key={c} onClick={()=>setCurrency(c)} style={{ background:currency===c?'var(--accent)':'transparent', color:currency===c?'#fff':'var(--muted)', border:'none', padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>{c}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4 }}>{t('periodReport.quickPresets')}</div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={()=>applyPreset('week')} style={{ ...s.input, cursor:'pointer' }}>{t('periodReport.presetWeek')}</button>
              <button onClick={()=>applyPreset('month')} style={{ ...s.input, cursor:'pointer' }}>{t('periodReport.presetMonth')}</button>
            </div>
          </div>
        </div>
        <div style={{ padding:'0 16px 16px', display:'flex', flexWrap:'wrap', gap:24 }}>
          <div>
            <div style={{ fontSize:11, color:'#3fb950', fontWeight:700, marginBottom:6 }}>{t('periodReport.periodA')}</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input type="date" style={s.input} value={aStart} onChange={e=>setAStart(e.target.value)} />
              <span style={{ color:'var(--muted)' }}>→</span>
              <input type="date" style={s.input} value={aEnd} onChange={e=>setAEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:'#d29922', fontWeight:700, marginBottom:6 }}>{t('periodReport.periodB')}</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input type="date" style={s.input} value={bStart} onChange={e=>setBStart(e.target.value)} />
              <span style={{ color:'var(--muted)' }}>→</span>
              <input type="date" style={s.input} value={bEnd} onChange={e=>setBEnd(e.target.value)} />
            </div>
          </div>
          <button onClick={loadReport} disabled={loading}
            style={{ background:'var(--accent)', color:'#fff', border:'none', borderRadius:8, padding:'8px 20px', fontSize:13, fontWeight:700, cursor:'pointer', alignSelf:'flex-end' }}>
            {loading ? t('periodReport.loading') : t('periodReport.generateReport')}
          </button>
        </div>
      </div>

      {report && (
        <>
          <div style={s.card}>
            <div style={{ padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--border)' }}>{t('periodReport.overview')}</div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>{t('periodReport.colMetric')}</th>
                  <th style={s.th}>{t('periodReport.colPeriodB')} ({bStart} → {bEnd})</th>
                  <th style={s.th}>{t('periodReport.colPeriodA')} ({aStart} → {aEnd})</th>
                  <th style={s.th}>{t('periodReport.colChange')}</th>
                </tr>
              </thead>
              <tbody>
                {metricRows.map(m => {
                  const change = pctChange(m.b, m.a)
                  return (
                    <tr key={m.label}>
                      <td style={s.td}>{m.label}</td>
                      <td style={s.td}>{m.isMoney ? formatMoney(m.b, currency) : Math.round(m.b).toLocaleString()}</td>
                      <td style={{ ...s.td, fontWeight:700 }}>{m.isMoney ? formatMoney(m.a, currency) : Math.round(m.a).toLocaleString()}</td>
                      <td style={{ ...s.td, fontWeight:700, color: change >= 0 ? '#3fb950' : '#f85149' }}>{change >= 0 ? '+' : ''}{change}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={s.card}>
            <div style={{ padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--border)' }}>{t('periodReport.tierBreakdownTitle')}</div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>{t('periodReport.colTier')}</th>
                  <th style={s.th}>{t('periodReport.colDepositors')}</th>
                  <th style={s.th}>{t('periodReport.colPeriodB')}</th>
                  <th style={s.th}>{t('periodReport.colPeriodA')}</th>
                  <th style={s.th}>{t('periodReport.colChange')}</th>
                  <th style={s.th}>{t('periodReport.colContribution')}</th>
                </tr>
              </thead>
              <tbody>
                {report.tierRows.map(t => (
                  <tr key={t.tier}>
                    <td style={{ ...s.td, fontWeight:700 }}>{t.tier}</td>
                    <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{t.depositorsB} → {t.depositorsA} ({t.depositorChangePct >= 0 ? '+' : ''}{t.depositorChangePct}%)</td>
                    <td style={s.td}>{formatMoney(t.depositB, currency)}</td>
                    <td style={{ ...s.td, fontWeight:700 }}>{formatMoney(t.depositA, currency)}</td>
                    <td style={{ ...s.td, fontWeight:700, color: t.changePct >= 0 ? '#3fb950' : '#f85149' }}>{t.changePct >= 0 ? '+' : ''}{t.changePct}%</td>
                    <td style={s.td}>{t.contributionPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={s.card}>
            <div style={{ padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom: analysis ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize:13, fontWeight:700 }}>{t('periodReport.aiAnalysis')}</div>
              <button onClick={runAnalysis} disabled={analyzing}
                style={{ background:'#a78bfa', color:'#fff', border:'none', borderRadius:6, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                {analyzing ? t('periodReport.analyzing') : analysis ? t('periodReport.regenerate') : t('periodReport.generateAnalysis')}
              </button>
            </div>
            {analysis && <div style={{ padding:16, fontSize:13, lineHeight:1.7, whiteSpace:'pre-wrap' }}>{analysis}</div>}
          </div>
        </>
      )}
    </div>
  )
}
