// src/pages/MonthlyReportExport.jsx — One-click Monthly PPT Report Generator
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchPPTData, generateMonthlyPPT } from '../lib/pptReportGenerator'
import { generateServiceReport } from '../lib/serviceReportGenerator'
import { useLanguage } from '../contexts/LanguageContext'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n, sym = 'RM') => {
  if (n == null || isNaN(n)) return '—'
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e6) return `${s}${sym} ${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}${sym} ${(a / 1e3).toFixed(1)}K`
  return `${s}${sym} ${Math.round(a).toLocaleString()}`
}
const pct = n => (n == null || isNaN(n)) ? '—' : `${Number(n).toFixed(1)}%`

// Generate last 12 months options
function getMonthOptions(lang) {
  const opts = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', year: 'numeric' })
    opts.push({ val, label })
  }
  return opts
}

// ─── KPI Preview Tile ─────────────────────────────────────────────────────────
function KpiTile({ label, value, sub, color = '#4A90E2', icon }) {
  return (
    <div style={{
      background: '#162040', border: '1px solid #2A3F6F', borderRadius: 10,
      padding: '16px 18px', minWidth: 140, flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
        <span style={{ fontSize: 11, fontWeight: 700, color: '#8B9BB8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#8B9BB8', marginTop: 5 }}>{sub}</div>}
    </div>
  )
}

// ─── Slide Coverage Badge ─────────────────────────────────────────────────────
function SlideBadge({ num, label, type }) {
  const colors = {
    auto: { bg: '#1A3D2B', border: '#3FB950', text: '#3FB950' },
    approx: { bg: '#2D2A1A', border: '#D29922', text: '#D29922' },
    placeholder: { bg: '#1A2A3D', border: '#4A90E2', text: '#4A90E2' },
  }
  const c = colors[type] || colors.auto
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 6,
      background: c.bg, border: `1px solid ${c.border}`,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: c.text, minWidth: 18, textAlign: 'center' }}>
        {num}
      </span>
      <span style={{ fontSize: 11, color: '#CBD5E1' }}>{label}</span>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MonthlyReportExport() {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const monthOptions = getMonthOptions(lang)
  const [month, setMonth] = useState(monthOptions[1]?.val || monthOptions[0]?.val) // default = last month
  const [previewData, setPreviewData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [generated, setGenerated] = useState(null)

  const loadPreview = useCallback(async (m) => {
    setLoading(true)
    setError(null)
    setPreviewData(null)
    try {
      const d = await fetchPPTData(m, supabase)
      setPreviewData(d)
    } catch (e) {
      setError(e.message || L2('Failed to load data','载入数据失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (month) loadPreview(month)
  }, [month, loadPreview])

  async function handleGenerate() {
    if (!month || generating) return
    setGenerating(true)
    setError(null)
    setGenerated(null)
    try {
      const fileName = await generateMonthlyPPT(month, supabase)
      setGenerated(fileName)
    } catch (e) {
      setError(e.message || L2('PPT generation failed','PPT 生成失败'))
    } finally {
      setGenerating(false)
    }
  }

  // ─── Compute preview KPIs ────────────────────────────────────────────────
  const kpis = previewData ? (() => {
    const rows = previewData.currRows || []
    const pRows = previewData.prevRows || []
    const tiers = ['DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'BLACK']

    const activeVips = rows.filter(r => (r.total_deposit || 0) > 0 || (r.monthly_valid_bet || 0) > 0).length
    const totalDeposit = rows.reduce((s, r) => s + (r.total_deposit || 0), 0)
    const prevDeposit = pRows.reduce((s, r) => s + (r.total_deposit || 0), 0)
    const depositChg = prevDeposit > 0 ? ((totalDeposit - prevDeposit) / prevDeposit * 100) : null

    const totalWL = rows.reduce((s, r) => s + (r.win_loss || 0), 0)
    const totalBet = rows.reduce((s, r) => s + (r.monthly_valid_bet || 0), 0)
    const holdPct = totalBet > 0 ? (totalWL / totalBet * 100) : null

    const reactLogs = previewData.reactLogs || []
    const reactivated = reactLogs.length
    const allVips = rows.length
    const reactivationRate = allVips > 0 ? (reactivated / allVips * 100) : null

    const campaigns = (previewData.campaigns || []).length
    const totalExp = (previewData.expenses || []).reduce((s, e) => s + (e.amount || 0), 0)

    const tierBreakdown = tiers.map(tier => {
      const tierRows = rows.filter(r => (r.tier || '').toUpperCase() === tier)
      return { tier, count: tierRows.length, deposit: tierRows.reduce((s, r) => s + (r.total_deposit || 0), 0) }
    }).filter(t => t.count > 0)

    return { activeVips, totalDeposit, depositChg, holdPct, reactivated, reactivationRate, campaigns, totalExp, tierBreakdown, allVips }
  })() : null

  const selectedLabel = monthOptions.find(o => o.val === month)?.label || month

  return (
    <div style={{ padding: '28px 32px', minHeight: '100vh', background: '#0D1B3E', color: '#FFFFFF', fontFamily: 'system-ui, sans-serif' }}>

      {/* ─── Page header ─── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 24 }}>📊</span>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#FFFFFF' }}>{L2('Monthly PPT Report','每月 PPT 报告')}</h1>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#8B9BB8' }}>
          {L2('Generate a 33-slide VIP Operations PowerPoint report for any month.','为任意月份生成 33 页 VIP 运营 PowerPoint 报告。')}
        </p>
      </div>

      {/* ─── Controls ─── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 28,
        background: '#162040', border: '1px solid #2A3F6F', borderRadius: 10, padding: '18px 20px',
      }}>
        <div style={{ flex: 1, maxWidth: 260 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#8B9BB8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {L2('Report Month','报告月份')}
          </label>
          <select
            value={month}
            onChange={e => { setMonth(e.target.value); setGenerated(null) }}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid #2A3F6F',
              background: '#0D1B3E', color: '#FFFFFF', fontSize: 14, cursor: 'pointer',
            }}
          >
            {monthOptions.map(o => (
              <option key={o.val} value={o.val}>{o.label}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || loading || !previewData}
          style={{
            padding: '9px 24px', borderRadius: 7, border: 'none', cursor: generating || loading || !previewData ? 'not-allowed' : 'pointer',
            background: generating ? '#1A3260' : previewData ? '#4A90E2' : '#2A3F6F',
            color: generating || !previewData ? '#8B9BB8' : '#FFFFFF',
            fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.2s',
          }}
        >
          {generating ? (
            <>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 16 }}>⏳</span>
              {L2('Generating...','生成中...')}
            </>
          ) : (
            <>{L2('⬇ Generate & Download PPT','⬇ 生成并下载 PPT')}</>
          )}
        </button>
      </div>

      {/* ─── Error banner ─── */}
      {error && (
        <div style={{
          marginBottom: 20, padding: '12px 16px', borderRadius: 8,
          background: '#2D1A1A', border: '1px solid #F85149', color: '#F85149', fontSize: 13,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ─── Success banner ─── */}
      {generated && (
        <div style={{
          marginBottom: 20, padding: '12px 16px', borderRadius: 8,
          background: '#1A3D2B', border: '1px solid #3FB950', color: '#3FB950', fontSize: 13,
        }}>
          ✅ {L2('Downloaded:','已下载：')} <strong>{generated}</strong>
        </div>
      )}

      {/* ─── Loading state ─── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#8B9BB8' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
          <div style={{ fontSize: 14 }}>{L2(`Loading ${selectedLabel} data…`, `正在载入 ${selectedLabel} 数据…`)}</div>
        </div>
      )}

      {/* ─── KPI Preview ─── */}
      {!loading && kpis && (
        <>
          <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 700, color: '#8B9BB8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {L2('Data Preview','数据预览')} — {selectedLabel}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <KpiTile icon="👥" label={L2('Active VIPs','活跃 VIP')} value={kpis.activeVips.toLocaleString()} sub={L2(`of ${kpis.allVips} total`, `共 ${kpis.allVips} 名`)} color="#FFFFFF" />
            <KpiTile icon="💰" label={L2('Total Deposit','总存款')} value={fmt(kpis.totalDeposit)}
              sub={kpis.depositChg != null ? `${kpis.depositChg >= 0 ? '▲' : '▼'} ${Math.abs(kpis.depositChg).toFixed(1)}% ${L2('vs prev month','较上月')}` : undefined}
              color={kpis.depositChg != null ? (kpis.depositChg >= 0 ? '#3FB950' : '#F85149') : '#FFFFFF'} />
            <KpiTile icon="📈" label={L2('GGR (Win/Loss)','GGR（输赢）')} value={fmt(previewData.currRows.reduce((s, r) => s + (r.win_loss || 0), 0))}
              sub={kpis.holdPct != null ? `Hold% ${pct(kpis.holdPct)}` : undefined} color="#4A90E2" />
            <KpiTile icon="🔄" label={L2('Reactivated','已重新激活')} value={kpis.reactivated.toLocaleString()}
              sub={kpis.reactivationRate != null ? L2(`Rate: ${pct(kpis.reactivationRate)}`, `比率：${pct(kpis.reactivationRate)}`) : undefined} color="#F59E0B" />
            <KpiTile icon="📢" label={L2('Campaigns','活动')} value={kpis.campaigns} sub={L2('this month','本月')} color="#4A90E2" />
            <KpiTile icon="💳" label={L2('Total Expenses','总开支')} value={fmt(kpis.totalExp)} sub={L2('dept. expenses','部门开支')} color="#D29922" />
          </div>

          {/* Tier breakdown */}
          {kpis.tierBreakdown.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8B9BB8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {L2('Tier Breakdown','等级分布')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {kpis.tierBreakdown.map(t => {
                  const tierColors = { DIAMOND: '#7DD3FC', PLATINUM: '#CBD5E1', GOLD: '#FCD34D', SILVER: '#D1D5DB', BRONZE: '#D97706', BLACK: '#A0A0C0' }
                  return (
                    <div key={t.tier} style={{
                      padding: '8px 14px', borderRadius: 8, background: '#162040', border: '1px solid #2A3F6F',
                      display: 'flex', flexDirection: 'column', gap: 3,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: tierColors[t.tier] || '#FFFFFF' }}>{t.tier}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>{t.count} {L2('VIPs','位 VIP')}</span>
                      <span style={{ fontSize: 10, color: '#8B9BB8' }}>{fmt(t.deposit)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* PPT Scope Filters */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8B9BB8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {L2('PPT Report Scope','PPT 报告范围')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: '#1A3D2B', border: '1px solid #3FB950', fontSize: 12, color: '#3FB950' }}>
                ✓ {L2('Host-Assigned VIPs Only','仅限已分配负责人的 VIP')}
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: '#1A3D2B', border: '1px solid #3FB950', fontSize: 12, color: '#3FB950' }}>
                ✓ {L2('Exclusion List Removed','已移除排除名单')}
              </div>
            </div>
          </div>

          {/* Data source indicators */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8B9BB8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {L2('Data Sources','数据来源')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: '#1A3D2B', border: '1px solid #3FB950', fontSize: 12, color: '#3FB950' }}>
                ✓ {L2('VIP Monthly Totals','VIP 每月总计')} ({previewData.currRows.length} {L2('records','条记录')})
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: previewData.reactLogs.length > 0 ? '#1A3D2B' : '#1A2A3D', border: `1px solid ${previewData.reactLogs.length > 0 ? '#3FB950' : '#4A90E2'}`, fontSize: 12, color: previewData.reactLogs.length > 0 ? '#3FB950' : '#4A90E2' }}>
                {previewData.reactLogs.length > 0 ? '✓' : '○'} {L2('Reactivation Logs','重新激活记录')} ({previewData.reactLogs.length})
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: previewData.dailySnaps.length > 0 ? '#1A3D2B' : '#1A2A3D', border: `1px solid ${previewData.dailySnaps.length > 0 ? '#3FB950' : '#4A90E2'}`, fontSize: 12, color: previewData.dailySnaps.length > 0 ? '#3FB950' : '#4A90E2' }}>
                {previewData.dailySnaps.length > 0 ? '✓' : '○'} {L2('Daily Snapshots','每日快照')} ({previewData.dailySnaps.length})
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: previewData.campaigns.length > 0 ? '#1A3D2B' : '#1A2A3D', border: `1px solid ${previewData.campaigns.length > 0 ? '#3FB950' : '#4A90E2'}`, fontSize: 12, color: previewData.campaigns.length > 0 ? '#3FB950' : '#4A90E2' }}>
                {previewData.campaigns.length > 0 ? '✓' : '○'} {L2('Campaigns','活动')} ({previewData.campaigns.length})
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: previewData.expenses.length > 0 ? '#1A3D2B' : '#1A2A3D', border: `1px solid ${previewData.expenses.length > 0 ? '#3FB950' : '#4A90E2'}`, fontSize: 12, color: previewData.expenses.length > 0 ? '#3FB950' : '#4A90E2' }}>
                {previewData.expenses.length > 0 ? '✓' : '○'} {L2('Expenses','开支')} ({previewData.expenses.length} {L2('items','项')})
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Slide coverage map ─── */}
      <div style={{ background: '#162040', border: '1px solid #2A3F6F', borderRadius: 10, padding: '18px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF', marginBottom: 4 }}>{L2('Slide Coverage — 33 Slides','幻灯片覆盖 — 33 页')}</div>
        <div style={{ fontSize: 12, color: '#8B9BB8', marginBottom: 14 }}>
          <span style={{ color: '#3FB950', marginRight: 16 }}>● {L2('Auto','自动')} (26)</span>
          <span style={{ color: '#D29922', marginRight: 16 }}>● {L2('Approximate','近似')} (3)</span>
          <span style={{ color: '#4A90E2' }}>● {L2('Placeholder','占位')} (4)</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { num: 1,  label: 'Cover Page', zh: '封面', type: 'auto' },
            { num: 2,  label: 'Diamond + Platinum VIP Total KPIs', zh: '钻石 + 白金 VIP 总 KPI', type: 'auto' },
            { num: 3,  label: 'Tier Active Rate Overview', zh: '等级活跃率概览', type: 'auto' },
            { num: 4,  label: '3-Month Retention Trend', zh: '3个月留存趋势', type: 'auto' },
            { num: 5,  label: 'Deposit Behavior Quality', zh: '存款行为质量', type: 'approx' },
            { num: 6,  label: 'Top 10 Deposit Drop', zh: '存款下降前10名', type: 'auto' },
            { num: 7,  label: 'MoM Active Rate Comparison', zh: '环比活跃率对比', type: 'auto' },
            { num: 8,  label: 'Behavior Quadrant', zh: '行为象限', type: 'approx' },
            { num: '9-10', label: 'Diamond VIP Detail', zh: '钻石 VIP 详情', type: 'auto' },
            { num: 11, label: 'Diamond Performance Table', zh: '钻石表现表', type: 'auto' },
            { num: 12, label: 'Deposit Surge Analysis', zh: '存款激增分析', type: 'auto' },
            { num: 13, label: 'Priority Retention List', zh: '优先留存名单', type: 'auto' },
            { num: 14, label: 'Platinum Performance Table', zh: '白金表现表', type: 'auto' },
            { num: 15, label: 'Department Expenses Summary', zh: '部门开支汇总', type: 'auto' },
            { num: '16-17', label: 'Campaign Report', zh: '活动报告', type: 'auto' },
            { num: '18-19', label: 'Festival Campaign ROI', zh: '节日活动投资回报', type: 'auto' },
            { num: 20, label: 'Monthly Retrospective', zh: '每月回顾', type: 'placeholder' },
            { num: 21, label: 'Churn Rule Calibration', zh: '流失规则校准', type: 'auto' },
            { num: 22, label: 'Retention Analysis Detail', zh: '留存分析详情', type: 'auto' },
            { num: 23, label: 'Score Divergence', zh: '评分偏差', type: 'placeholder' },
            { num: 24, label: 'GGR Concentration (Pareto)', zh: 'GGR 集中度（帕累托）', type: 'auto' },
            { num: 25, label: '5-Period Intra-Month Trend', zh: '月内5期趋势', type: 'auto' },
            { num: 26, label: 'Action Plan', zh: '行动计划', type: 'auto' },
            { num: 27, label: 'Strategic Direction', zh: '战略方向', type: 'placeholder' },
            { num: 28, label: 'Upcoming Campaigns', zh: '即将进行的活动', type: 'auto' },
            { num: 29, label: 'Hold% Analysis by Tier', zh: '按等级 Hold% 分析', type: 'auto' },
            { num: 30, label: 'Expense Report by Platform', zh: '按平台开支报告', type: 'auto' },
            { num: 31, label: 'Next Month Budget', zh: '下月预算', type: 'placeholder' },
            { num: 32, label: '3-Month Member Health Summary', zh: '3个月会员健康汇总', type: 'auto' },
            { num: 33, label: 'Closing Page', zh: '结束页', type: 'auto' },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, textAlign: 'right', fontSize: 10, color: '#4A90E2', fontWeight: 700, flexShrink: 0 }}>
                {s.num}
              </div>
              <div style={{
                flex: 1, padding: '4px 10px', borderRadius: 5, fontSize: 12,
                background: s.type === 'auto' ? '#1A3D2B22' : s.type === 'approx' ? '#2D2A1A44' : '#1A2A3D44',
                border: `1px solid ${s.type === 'auto' ? '#3FB95033' : s.type === 'approx' ? '#D2992233' : '#4A90E233'}`,
                color: '#CBD5E1',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>{lang === 'zh' ? (s.zh || s.label) : s.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4,
                  color: s.type === 'auto' ? '#3FB950' : s.type === 'approx' ? '#D29922' : '#4A90E2',
                  background: s.type === 'auto' ? '#3FB95022' : s.type === 'approx' ? '#D2992222' : '#4A90E222',
                }}>
                  {s.type === 'auto' ? L2('AUTO','自动') : s.type === 'approx' ? L2('APPROX','近似') : L2('PLACEHOLDER','占位')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Generate button (bottom) ─── */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 32 }}>
        <button
          onClick={handleGenerate}
          disabled={generating || loading || !previewData}
          style={{
            padding: '13px 40px', borderRadius: 8, border: 'none',
            cursor: generating || loading || !previewData ? 'not-allowed' : 'pointer',
            background: generating ? '#1A3260' : previewData ? '#4A90E2' : '#2A3F6F',
            color: generating || !previewData ? '#8B9BB8' : '#FFFFFF',
            fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: previewData && !generating ? '0 4px 20px #4A90E233' : 'none',
            transition: 'all 0.2s',
          }}
        >
          {generating ? (
            <>{L2('⏳ Generating PPT — please wait…','⏳ 正在生成 PPT — 请稍候…')}</>
          ) : (
            <>{L2(`⬇ Generate & Download ${selectedLabel} Report (.pptx)`, `⬇ 生成并下载 ${selectedLabel} 报告 (.pptx)`)}</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>

      {/* ═══════════════════════════════════════════════════════════════════
          3-Month VIP Service Report Section
          ═══════════════════════════════════════════════════════════════════ */}
      <ServiceReportSection />
    </div>
  )
}

// ─── 3-Month Service Report ───────────────────────────────────────────────────
function ServiceReportSection() {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const monthOptions = getMonthOptions(lang)
  // Default: most recent month
  const [endMonth, setEndMonth] = useState(monthOptions[0].val)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Derive the 3-month labels for display
  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number)
    let month = m + delta, year = y
    while (month < 1)  { month += 12; year-- }
    while (month > 12) { month -= 12; year++ }
    return `${year}-${String(month).padStart(2, '0')}`
  }
  function toLabel(ym) {
    const [y, m] = ym.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', year: 'numeric' })
  }
  const m0 = shiftMonth(endMonth, -2)
  const m1 = shiftMonth(endMonth, -1)
  const m2 = endMonth
  const rangeLabel = `${toLabel(m0)} – ${toLabel(m2)}`

  async function handleDownload() {
    setBusy(true)
    setError(null)
    try {
      await generateServiceReport(endMonth, supabase)
    } catch (e) {
      setError(e.message || L2('Failed to generate report','生成报告失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      marginTop: 36,
      background: '#0F1C3A',
      border: '1px solid #2A3F6F',
      borderRadius: 14,
      padding: '28px 32px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 24 }}>📋</span>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#E2E8F0' }}>
            {L2('3-Month VIP Service Report','3个月 VIP 服务报告')}
          </div>
          <div style={{ fontSize: 12, color: '#8B9BB8', marginTop: 2 }}>
            {L2('Diamond & Platinum contact coverage — exported as Excel (.xlsx)','钻石与白金联系覆盖率 — 导出为 Excel (.xlsx)')}
          </div>
        </div>
      </div>

      {/* Description */}
      <div style={{
        background: '#162040', border: '1px solid #2A3F6F', borderRadius: 8,
        padding: '12px 16px', marginBottom: 22, fontSize: 13, color: '#94A3B8', lineHeight: 1.6,
      }}>
        {L2("Shows every Diamond and Platinum VIP with a ✓ / ✗ for each of the 3 selected months. Use it to track who has and hasn't been contacted, and to report coverage to management.", '显示所有钻石和白金 VIP 在所选 3 个月中每月的 ✓ / ✗。用于追踪哪些玩家已联系或未联系，并向管理层汇报覆盖率。')}
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#8B9BB8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {L2('End Month (most recent)','结束月份（最近）')}
          </label>
          <select
            value={endMonth}
            onChange={e => setEndMonth(e.target.value)}
            disabled={busy}
            style={{
              background: '#162040', border: '1px solid #2A3F6F', borderRadius: 7,
              color: '#E2E8F0', padding: '8px 14px', fontSize: 14, cursor: 'pointer',
            }}
          >
            {monthOptions.map(o => (
              <option key={o.val} value={o.val}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Range indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 18,
          background: '#162040', border: '1px solid #2A3F6F', borderRadius: 7,
          padding: '8px 16px',
        }}>
          {[m0, m1, m2].map((m, i) => (
            <span key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: '#1E2761', border: '1px solid #4A90E2', borderRadius: 5,
                padding: '3px 10px', fontSize: 13, color: '#4A90E2', fontWeight: 600,
              }}>{toLabel(m)}</span>
              {i < 2 && <span style={{ color: '#4A5568', fontSize: 12 }}>→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#2D1515', border: '1px solid #7F1D1D', borderRadius: 7,
          padding: '10px 14px', marginBottom: 16, color: '#FCA5A5', fontSize: 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Download button */}
      <button
        onClick={handleDownload}
        disabled={busy}
        style={{
          padding: '12px 36px', borderRadius: 8, border: 'none',
          cursor: busy ? 'not-allowed' : 'pointer',
          background: busy ? '#1A3260' : '#16A34A',
          color: busy ? '#8B9BB8' : '#FFFFFF',
          fontSize: 15, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: !busy ? '0 4px 20px #16A34A33' : 'none',
          transition: 'all 0.2s',
        }}
      >
        {busy ? (
          <>
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
            {L2('Fetching data & building Excel…','正在获取数据并生成 Excel…')}
          </>
        ) : (
          <>{L2('⬇ Generate Service Report','⬇ 生成服务报告')} — {rangeLabel} (.xlsx)</>
        )}
      </button>

      <div style={{ marginTop: 14, fontSize: 11, color: '#475569' }}>
        {L2('The file downloads directly in your browser. 3 sheets: Overview, Diamond VIPs, Platinum VIPs.','文件将直接在浏览器中下载。包含 3 个工作表：Overview、Diamond VIPs、Platinum VIPs。')}
      </div>
    </div>
  )
}
