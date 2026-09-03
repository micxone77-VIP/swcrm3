// src/pages/MonthlyReportExport.jsx — One-click Monthly PPT Report Generator
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchPPTData, generateMonthlyPPT } from '../lib/pptReportGenerator'

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
function getMonthOptions() {
  const opts = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
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
  const monthOptions = getMonthOptions()
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
      setError(e.message || 'Failed to load data')
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
      setError(e.message || 'PPT generation failed')
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
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#FFFFFF' }}>Monthly PPT Report</h1>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#8B9BB8' }}>
          Generate a 33-slide VIP Operations PowerPoint report for any month.
        </p>
      </div>

      {/* ─── Controls ─── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 28,
        background: '#162040', border: '1px solid #2A3F6F', borderRadius: 10, padding: '18px 20px',
      }}>
        <div style={{ flex: 1, maxWidth: 260 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#8B9BB8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Report Month
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
              Generating...
            </>
          ) : (
            <>⬇ Generate & Download PPT</>
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
          ✅ Downloaded: <strong>{generated}</strong>
        </div>
      )}

      {/* ─── Loading state ─── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#8B9BB8' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
          <div style={{ fontSize: 14 }}>Loading {selectedLabel} data…</div>
        </div>
      )}

      {/* ─── KPI Preview ─── */}
      {!loading && kpis && (
        <>
          <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 700, color: '#8B9BB8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Data Preview — {selectedLabel}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <KpiTile icon="👥" label="Active VIPs" value={kpis.activeVips.toLocaleString()} sub={`of ${kpis.allVips} total`} color="#FFFFFF" />
            <KpiTile icon="💰" label="Total Deposit" value={fmt(kpis.totalDeposit)}
              sub={kpis.depositChg != null ? `${kpis.depositChg >= 0 ? '▲' : '▼'} ${Math.abs(kpis.depositChg).toFixed(1)}% vs prev month` : undefined}
              color={kpis.depositChg != null ? (kpis.depositChg >= 0 ? '#3FB950' : '#F85149') : '#FFFFFF'} />
            <KpiTile icon="📈" label="GGR (Win/Loss)" value={fmt(previewData.currRows.reduce((s, r) => s + (r.win_loss || 0), 0))}
              sub={kpis.holdPct != null ? `Hold% ${pct(kpis.holdPct)}` : undefined} color="#4A90E2" />
            <KpiTile icon="🔄" label="Reactivated" value={kpis.reactivated.toLocaleString()}
              sub={kpis.reactivationRate != null ? `Rate: ${pct(kpis.reactivationRate)}` : undefined} color="#F59E0B" />
            <KpiTile icon="📢" label="Campaigns" value={kpis.campaigns} sub="this month" color="#4A90E2" />
            <KpiTile icon="💳" label="Total Expenses" value={fmt(kpis.totalExp)} sub="dept. expenses" color="#D29922" />
          </div>

          {/* Tier breakdown */}
          {kpis.tierBreakdown.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8B9BB8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Tier Breakdown
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
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>{t.count} VIPs</span>
                      <span style={{ fontSize: 10, color: '#8B9BB8' }}>{fmt(t.deposit)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Data source indicators */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8B9BB8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Data Sources
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: '#1A3D2B', border: '1px solid #3FB950', fontSize: 12, color: '#3FB950' }}>
                ✓ VIP Monthly Totals ({previewData.currRows.length} records)
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: previewData.reactLogs.length > 0 ? '#1A3D2B' : '#1A2A3D', border: `1px solid ${previewData.reactLogs.length > 0 ? '#3FB950' : '#4A90E2'}`, fontSize: 12, color: previewData.reactLogs.length > 0 ? '#3FB950' : '#4A90E2' }}>
                {previewData.reactLogs.length > 0 ? '✓' : '○'} Reactivation Logs ({previewData.reactLogs.length})
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: previewData.dailySnaps.length > 0 ? '#1A3D2B' : '#1A2A3D', border: `1px solid ${previewData.dailySnaps.length > 0 ? '#3FB950' : '#4A90E2'}`, fontSize: 12, color: previewData.dailySnaps.length > 0 ? '#3FB950' : '#4A90E2' }}>
                {previewData.dailySnaps.length > 0 ? '✓' : '○'} Daily Snapshots ({previewData.dailySnaps.length})
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: previewData.campaigns.length > 0 ? '#1A3D2B' : '#1A2A3D', border: `1px solid ${previewData.campaigns.length > 0 ? '#3FB950' : '#4A90E2'}`, fontSize: 12, color: previewData.campaigns.length > 0 ? '#3FB950' : '#4A90E2' }}>
                {previewData.campaigns.length > 0 ? '✓' : '○'} Campaigns ({previewData.campaigns.length})
              </div>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: previewData.expenses.length > 0 ? '#1A3D2B' : '#1A2A3D', border: `1px solid ${previewData.expenses.length > 0 ? '#3FB950' : '#4A90E2'}`, fontSize: 12, color: previewData.expenses.length > 0 ? '#3FB950' : '#4A90E2' }}>
                {previewData.expenses.length > 0 ? '✓' : '○'} Expenses ({previewData.expenses.length} items)
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Slide coverage map ─── */}
      <div style={{ background: '#162040', border: '1px solid #2A3F6F', borderRadius: 10, padding: '18px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF', marginBottom: 4 }}>Slide Coverage — 33 Slides</div>
        <div style={{ fontSize: 12, color: '#8B9BB8', marginBottom: 14 }}>
          <span style={{ color: '#3FB950', marginRight: 16 }}>● Auto (26)</span>
          <span style={{ color: '#D29922', marginRight: 16 }}>● Approximate (3)</span>
          <span style={{ color: '#4A90E2' }}>● Placeholder (4)</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { num: 1,  label: 'Cover Page', type: 'auto' },
            { num: 2,  label: 'Diamond + Platinum VIP Total KPIs', type: 'auto' },
            { num: 3,  label: 'Tier Active Rate Overview', type: 'auto' },
            { num: 4,  label: '3-Month Retention Trend', type: 'auto' },
            { num: 5,  label: 'Deposit Behavior Quality', type: 'approx' },
            { num: 6,  label: 'Top 10 Deposit Drop', type: 'auto' },
            { num: 7,  label: 'MoM Active Rate Comparison', type: 'auto' },
            { num: 8,  label: 'Behavior Quadrant', type: 'approx' },
            { num: '9-10', label: 'Diamond VIP Detail', type: 'auto' },
            { num: 11, label: 'Diamond Performance Table', type: 'auto' },
            { num: 12, label: 'Deposit Surge Analysis', type: 'auto' },
            { num: 13, label: 'Priority Retention List', type: 'auto' },
            { num: 14, label: 'Platinum Performance Table', type: 'auto' },
            { num: 15, label: 'Department Expenses Summary', type: 'auto' },
            { num: '16-17', label: 'Campaign Report', type: 'auto' },
            { num: '18-19', label: 'Festival Campaign ROI', type: 'auto' },
            { num: 20, label: 'Monthly Retrospective', type: 'placeholder' },
            { num: 21, label: 'Churn Rule Calibration', type: 'auto' },
            { num: 22, label: 'Retention Analysis Detail', type: 'auto' },
            { num: 23, label: 'Score Divergence', type: 'placeholder' },
            { num: 24, label: 'GGR Concentration (Pareto)', type: 'auto' },
            { num: 25, label: '5-Period Intra-Month Trend', type: 'auto' },
            { num: 26, label: 'Action Plan', type: 'auto' },
            { num: 27, label: 'Strategic Direction', type: 'placeholder' },
            { num: 28, label: 'Upcoming Campaigns', type: 'auto' },
            { num: 29, label: 'Hold% Analysis by Tier', type: 'auto' },
            { num: 30, label: 'Expense Report by Platform', type: 'auto' },
            { num: 31, label: 'Next Month Budget', type: 'placeholder' },
            { num: 32, label: '3-Month Member Health Summary', type: 'auto' },
            { num: 33, label: 'Closing Page', type: 'auto' },
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
                <span>{s.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4,
                  color: s.type === 'auto' ? '#3FB950' : s.type === 'approx' ? '#D29922' : '#4A90E2',
                  background: s.type === 'auto' ? '#3FB95022' : s.type === 'approx' ? '#D2992222' : '#4A90E222',
                }}>
                  {s.type === 'auto' ? 'AUTO' : s.type === 'approx' ? 'APPROX' : 'PLACEHOLDER'}
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
            <>⏳ Generating PPT — please wait…</>
          ) : (
            <>⬇ Generate & Download {selectedLabel} Report (.pptx)</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
