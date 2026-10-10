// src/components/vip/DepositProfileCard.jsx — 充值画像 card for VIP360 Profile tab
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SEGMENTS, STYLES, DAY_NAMES, DAY_NAMES_ZH, dayNameZh, fmtHour, fmtRM, contactHint } from '../../lib/depositProfile'
import { useLanguage } from '../../contexts/LanguageContext'

const DAYPART_ZH = { Morning: '早上', Afternoon: '下午', Evening: '傍晚', Night: '晚上', 'Late night': '深夜', 'Late Night': '深夜', Midnight: '午夜' }

const box = { background: 'var(--surface2)', borderRadius: 10, padding: '14px 16px' }
const label = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 10 }

function Kpi({ title, value, sub, color }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function DepositProfileCard({ username }) {
  const [p, setP] = useState(null)
  const [monthly, setMonthly] = useState([])
  const [heat, setHeat] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)

  useEffect(() => {
    if (!username) return
    let cancelled = false
    setLoading(true); setErr(null)
    Promise.all([
      supabase.from('v_vip_deposit_profile').select('*').eq('login', username).maybeSingle(),
      supabase.from('v_vip_deposit_monthly').select('ym, dep_count, dep_amount, active_days').eq('login', username).order('ym'),
      supabase.from('v_vip_deposit_heatmap').select('day_of_week, hour_of_day, dep_count').eq('login', username),
    ]).then(([a, b, c]) => {
      if (cancelled) return
      const e = a.error || b.error || c.error
      if (e) { console.error('DepositProfileCard load error', e); setErr(e.message) }
      setP(a.data || null)
      setMonthly(b.data || [])
      setHeat(c.data || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [username])

  if (loading) return <div style={{ ...box, marginBottom: 20, color: 'var(--muted)', fontSize: 13 }}>{L2('Loading deposit profile…', '载入存款画像中…')}</div>
  if (err) return <div style={{ ...box, marginBottom: 20, color: '#f87171', fontSize: 13 }}>{L2('Deposit profile error', '存款画像错误')}: {err}</div>
  if (!p) return (
    <div style={{ ...box, marginBottom: 20, color: 'var(--muted)', fontSize: 13 }}>
      {L2('📊 Deposit Profile — no deposit records for this VIP in the imported data.', '📊 充值画像 — 导入数据中没有此VIP的存款记录。')}
    </div>
  )

  const seg = SEGMENTS[p.segment] || SEGMENTS.Stable
  const sty = STYLES[p.deposit_style] || STYLES.Regular
  const normalMonthly = Number(p.dep_prev_60d || 0) / 2
  const trend = p.trend_pct === null || p.trend_pct === undefined ? null : Number(p.trend_pct)
  const maxMonth = Math.max(1, ...monthly.map(m => Number(m.dep_amount || 0)))

  // heatmap grid 7 x 24
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
  heat.forEach(h => { grid[h.day_of_week][h.hour_of_day] = Number(h.dep_count || 0) })
  const maxCell = Math.max(1, ...grid.flat())

  return (
    <div style={{ ...box, marginBottom: 20, border: `1px solid ${seg.color}55` }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{L2('📊 Deposit Profile', '📊 充值画像')}</div>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: seg.bg, color: seg.color }}>
          {seg.icon} {L2(p.segment, seg.zh)}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {sty.icon} {L2(p.deposit_style, sty.zh)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
          {L2('Data up to', '数据截至')} {String(p.data_as_of || '').slice(0, 10)}
        </span>
      </div>

      {/* Host hint */}
      <div style={{ fontSize: 13, background: 'rgba(255,107,0,.10)', border: '1px solid rgba(255,107,0,.35)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
        💡 {contactHint(p, lang)}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi title={L2('Last 30 days', '近30天')} value={fmtRM(p.dep_30d)} sub={L2(`${p.cnt_30d || 0} deposits`, `${p.cnt_30d || 0} 笔存款`)} />
        <Kpi title={L2('Normal / month', '平常 / 月')} value={fmtRM(normalMonthly)} sub={L2('avg of prior 60 days', '前60天平均')} />
        <Kpi title={L2('Trend', '趋势')} value={trend === null ? '—' : `${trend > 0 ? '+' : ''}${trend}%`}
             color={trend === null ? undefined : trend < -40 ? '#f87171' : trend > 40 ? '#34d399' : undefined} sub={L2('vs normal', '对比平常')} />
        <Kpi title={L2('Avg ticket', '平均单笔')} value={fmtRM(p.avg_ticket)} sub={`${L2('max', '最高')} ${fmtRM(p.max_ticket)}`} />
        <Kpi title={L2('Deposit gap', '存款间隔')} value={p.avg_gap_days ? L2(`${Number(p.avg_gap_days)} d`, `${Number(p.avg_gap_days)} 天`) : '—'}
             sub={L2(`${p.days_since_last} d since last`, `距上次 ${p.days_since_last} 天`)} color={Number(p.overdue_ratio) >= 2 ? '#f87171' : undefined} />
        <Kpi title={L2('Main method', '主要方式')} value={<span style={{ fontSize: 13 }}>{p.main_method || '—'}</span>}
             sub={[p.uses_crypto && L2('Crypto', '加密货币'), p.uses_bank && L2('Bank', '银行')].filter(Boolean).join(' + ') || L2('Gateway only', '仅支付网关')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 2fr', gap: 16 }}>
        {/* Monthly bars */}
        <div>
          <div style={label}>{L2('Monthly deposits', '每月存款')}</div>
          {monthly.map(m => (
            <div key={m.ym} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12 }}>
              <span style={{ width: 52, color: 'var(--muted)' }}>{m.ym}</span>
              <div style={{ flex: 1, height: 10, background: 'var(--surface)', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${(Number(m.dep_amount) / maxMonth) * 100}%`, height: '100%', background: 'var(--brand, #FF6B00)', borderRadius: 5 }} />
              </div>
              <span style={{ width: 92, textAlign: 'right', fontWeight: 700 }}>{fmtRM(m.dep_amount)}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            {L2(`${p.dep_count} deposits · ${p.active_days} active days · weekend ${Number(p.weekend_pct || 0)}%`, `${p.dep_count} 笔存款 · ${p.active_days} 活跃天 · 周末 ${Number(p.weekend_pct || 0)}%`)}
          </div>
        </div>

        {/* Heatmap */}
        <div style={{ overflowX: 'auto' }}>
          <div style={label}>{L2('When they deposit (day × hour)', '存款时段（星期 × 小时）')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(24, minmax(12px, 1fr))', gap: 2, minWidth: 360 }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>{h % 3 === 0 ? h : ''}</div>
            ))}
            {grid.map((row, d) => (
              [<div key={`l${d}`} style={{ fontSize: 10, color: 'var(--muted)', lineHeight: '14px' }}>{L2(DAY_NAMES[d], DAY_NAMES_ZH[d])}</div>,
               ...row.map((v, h) => (
                 <div key={`${d}-${h}`} title={L2(`${DAY_NAMES[d]} ${fmtHour(h)}: ${v} deposit${v === 1 ? '' : 's'}`, `${DAY_NAMES_ZH[d]} ${fmtHour(h, 'zh')}: ${v} 笔存款`)}
                   style={{ height: 14, borderRadius: 2,
                     background: v === 0 ? 'var(--surface)' : `rgba(255,107,0,${0.15 + 0.85 * (v / maxCell)})`,
                     outline: d === p.peak_dow && h === p.peak_hour ? '1.5px solid #22d3ee' : 'none' }} />
               ))]
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            {L2('Peak', '高峰')}: <b style={{ color: 'var(--text)' }}>{L2(p.peak_day_name, dayNameZh(p.peak_day_name))} {fmtHour(p.peak_hour, lang)}</b> ({L2(p.peak_daypart, DAYPART_ZH[p.peak_daypart] || p.peak_daypart)}) — {L2('best window to reach out', '最佳联系时段')}
          </div>
        </div>
      </div>
    </div>
  )
}
