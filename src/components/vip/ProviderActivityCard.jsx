// src/components/vip/ProviderActivityCard.jsx — 本月供应商活动 card for VIP360 Gaming tab
// Data: provider_player_monthly (back office 10.3 Provider Report Detail, month-to-date,
// loaded by C:\Project\Gaming Report\_tools\upload.mjs). Amounts are from the player's side:
// negative win/loss = player lost.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney, fmtDate } from '../../lib/format'
import { useLanguage } from '../../contexts/LanguageContext'

const box = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }
const label = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 10 }
const th = { padding: '8px 10px', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' }

const wlColor = v => (v > 0 ? 'var(--success)' : v < 0 ? 'var(--danger)' : 'var(--muted)')

function Kpi({ title, value, sub, color }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function ProviderActivityCard({ username, currency = 'MYR' }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)

  useEffect(() => {
    if (!username) return
    let cancelled = false
    setLoading(true); setErr(null)
    supabase.from('provider_player_monthly')
      .select('period_month, period_start, period_end, provider, currency, bet_count, valid_turnover, win_loss, bonus, rebate, total_win_loss')
      .eq('username', username)
      .eq('currency', currency)
      .order('period_month', { ascending: false })
      .limit(300)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.error('ProviderActivityCard load error', error); setErr(error.message) }
        // Latest month only (the newest upload is month-to-date).
        const latest = data?.[0]?.period_month
        setRows((data || []).filter(r => r.period_month === latest))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [username, currency])

  if (loading) return <div style={{ ...box, marginBottom: 20, color: 'var(--muted)', fontSize: 13 }}>{L2('Loading provider activity…', '载入供应商活动中…')}</div>
  if (err) return <div style={{ ...box, marginBottom: 20, color: '#f87171', fontSize: 13 }}>{L2('Provider activity error', '供应商活动错误')}: {err}</div>
  if (!rows.length) return (
    <div style={{ ...box, marginBottom: 20, color: 'var(--muted)', fontSize: 13 }}>
      {L2('🎯 Provider Activity — no back office provider data for this player yet.', '🎯 供应商活动 — 暂无此玩家的后台供应商数据。')}
    </div>
  )

  const sorted = [...rows].sort((a, b) => (b.valid_turnover || 0) - (a.valid_turnover || 0))
  const num = v => parseFloat(v) || 0
  const totTurnover = sorted.reduce((s, r) => s + num(r.valid_turnover), 0)
  const totWL = sorted.reduce((s, r) => s + num(r.win_loss), 0)
  const totNet = sorted.reduce((s, r) => s + num(r.total_win_loss), 0)
  const totBets = sorted.reduce((s, r) => s + (r.bet_count || 0), 0)
  const top = sorted[0]
  const { period_start, period_end } = sorted[0]
  const period = `${fmtDate(period_start, lang)} – ${fmtDate(period_end, lang)}`

  return (
    <div style={{ ...box, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={label}>{L2('🎯 Provider Activity — This Month', '🎯 供应商活动 — 本月')}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>{period} · {L2('back office', '后台数据')}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Kpi title={L2('Valid Turnover', '有效流水')} value={formatMoney(totTurnover, currency)} sub={L2(`${totBets.toLocaleString()} bets`, `${totBets.toLocaleString()} 笔投注`)} />
        <Kpi title={L2('Player Win/Loss', '玩家输赢')} value={formatMoney(totWL, currency)} color={wlColor(totWL)} sub={L2('− = player lost', '负数 = 玩家输')} />
        <Kpi title={L2('Net W/L (after rebate & bonus)', '净输赢（含返水和奖励）')} value={formatMoney(totNet, currency)} color={wlColor(totNet)} />
        <Kpi title={L2('Providers Played', '游玩供应商')} value={sorted.length} sub={L2(`Top: ${top.provider}`, `最多：${top.provider}`)} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>{L2('Provider', '供应商')}</th>
              <th style={th}>{L2('Valid Turnover', '有效流水')}</th>
              <th style={th}>{L2('Share', '占比')}</th>
              <th style={th}>{L2('Bets', '投注数')}</th>
              <th style={th}>{L2('Player W/L', '玩家输赢')}</th>
              <th style={th}>{L2('Rebate', '返水')}</th>
              <th style={th}>{L2('Bonus', '奖励')}</th>
              <th style={th}>{L2('Net W/L', '净输赢')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const share = totTurnover ? num(r.valid_turnover) / totTurnover * 100 : 0
              return (
                <tr key={r.provider}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.provider}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{formatMoney(r.valid_turnover, currency)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      <div style={{ width: 50, height: 4, background: 'var(--border)', borderRadius: 2 }}>
                        <div style={{ height: 4, borderRadius: 2, background: 'var(--brand)', width: `${Math.round(share)}%` }} />
                      </div>
                      <span style={{ color: 'var(--muted)', minWidth: 32 }}>{share.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{(r.bet_count || 0).toLocaleString()}</td>
                  <td style={{ ...td, fontWeight: 700, color: wlColor(num(r.win_loss)) }}>{formatMoney(r.win_loss, currency)}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{formatMoney(r.rebate, currency)}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{formatMoney(r.bonus, currency)}</td>
                  <td style={{ ...td, fontWeight: 700, color: wlColor(num(r.total_win_loss)) }}>{formatMoney(r.total_win_loss, currency)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
