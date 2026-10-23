// src/pages/Segments.jsx — Player segmentation overview, 4 dimensions (2026-10-23)
// Lifecycle (status) × Value (90-day real deposits, crm_rules value bands) × Behaviour (deposit style) × Preference (game type).
// Data: v_vip_segments (Gold+). Counts only in the matrix; money is shown per player in their own currency (MYR and SGD never added).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/depositProfile'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { TierBadge, StatusBadge, LastBet } from '../components/ui'
import { WaButton } from '../components/WaSenderModal'
import { STATUS_CONFIG } from '../lib/enums'

const LIFECYCLE = ['Active', 'Resting', 'At Risk', 'Churn', 'Dormant', 'Unknown']
const VALUE = ['V5 Top', 'V4 High', 'V3 Mid', 'V2 Low', 'V1 Minimal']
const BEHAVIOUR = ['Big ticket', 'Regular', 'Small & frequent', 'No deposit data']
const PREFERENCE = ['Live casino', 'Slots', 'Sports', 'Mixed', 'No game data']
const ZH = {
  'V5 Top': '顶级', 'V4 High': '高价值', 'V3 Mid': '中价值', 'V2 Low': '低价值', 'V1 Minimal': '极低',
  'Big ticket': '大额型', 'Regular': '常规型', 'Small & frequent': '小额多次', 'No deposit data': '无存款数据',
  'Live casino': '真人', 'Slots': '老虎机', 'Sports': '体育', 'Mixed': '混合', 'No game data': '无游戏数据',
}
const VALUE_KEY = { 'V5 Top': 'value_band_5', 'V4 High': 'value_band_4', 'V3 Mid': 'value_band_3', 'V2 Low': 'value_band_2' }
const VALUE_COLOR = { 'V5 Top': '#a78bfa', 'V4 High': '#58a6ff', 'V3 Mid': '#3fb950', 'V2 Low': '#d29922', 'V1 Minimal': '#8b949e' }
const mktOf = c => { const u = String(c || 'MYR').toUpperCase(); return u === 'SGD' ? 'SG' : u.startsWith('KH') ? 'KH' : 'MY' }
const kfmt = n => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

// quick views the boss / hosts will want most
const PRESETS = [
  { key: 'hv_risk', icon: '🚨', en: 'High value at risk', zh: '高价值有风险', test: r => ['V5 Top', 'V4 High'].includes(r.value_band) && ['At Risk', 'Churn'].includes(r.lifecycle) },
  { key: 'hv_dormant', icon: '💤', en: 'High value dormant', zh: '高价值休眠', test: r => ['V5 Top', 'V4 High'].includes(r.value_band) && r.lifecycle === 'Dormant' },
  { key: 'hv_resting', icon: '😴', en: 'High value resting', zh: '高价值休息中', test: r => ['V5 Top', 'V4 High'].includes(r.value_band) && r.lifecycle === 'Resting' },
  { key: 'top_active', icon: '🔥', en: 'Top & active', zh: '顶级且活跃', test: r => r.value_band === 'V5 Top' && r.lifecycle === 'Active' },
]

export default function Segments() {
  const navigate = useNavigate()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const tr = v => (lang === 'zh' ? (ZH[v] || v) : v)
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [bands, setBands] = useState({})
  const [mkt, setMkt] = useState('ALL')
  const [host, setHost] = useState('ALL')
  const [tier, setTier] = useState('ALL')
  const [search, setSearch] = useState('')
  const [f, setF] = useState({ lifecycle: null, value_band: null, behaviour: null, preference: null })
  const [preset, setPreset] = useState(null)
  const [limit, setLimit] = useState(100)

  useEffect(() => {
    fetchAll(() => supabase.from('v_vip_segments').select('*').order('username'))
      .then(setRows, e => { setErr(e.message || String(e)); setRows([]) })
    supabase.from('crm_rules').select('rule_key,value').like('rule_key', 'value_band_%')
      .then(({ data }) => setBands(Object.fromEntries((data || []).map(r => [r.rule_key, Number(r.value)]))))
  }, [])

  const base = useMemo(() => (rows || []).filter(r =>
    (mkt === 'ALL' || mktOf(r.currency) === mkt) && (host === 'ALL' || (r.host_assigned || '__none') === host) &&
    (tier === 'ALL' || r.tier === tier) && (!search || r.username.toLowerCase().includes(search.toLowerCase()))), [rows, mkt, host, tier, search])
  const filtered = useMemo(() => base.filter(r =>
    Object.entries(f).every(([k, v]) => !v || r[k] === v) && (!preset || PRESETS.find(p => p.key === preset).test(r)))
    .sort((a, b) => VALUE.indexOf(a.value_band) - VALUE.indexOf(b.value_band) || Number(b.dep_90d) - Number(a.dep_90d)), [base, f, preset])

  const count = (list, key) => { const c = {}; list.forEach(r => { c[r[key]] = (c[r[key]] || 0) + 1 }); return c }
  // each dimension card counts the rows matching the OTHER filters, so the numbers react to your clicks
  const without = key => base.filter(r => Object.entries(f).every(([k, v]) => k === key || !v || r[k] === v) && (!preset || PRESETS.find(p => p.key === preset).test(r)))
  const hosts = [...new Set((rows || []).map(r => r.host_assigned || '__none'))].sort()
  const tiers = [...new Set((rows || []).map(r => r.tier))].sort()
  const matrixRows = base.filter(r => ['behaviour', 'preference'].every(k => !f[k] || r[k] === f[k]))
  const cell = (lc, vb) => matrixRows.filter(r => r.lifecycle === lc && r.value_band === vb).length
  const maxCell = Math.max(1, ...LIFECYCLE.flatMap(lc => VALUE.map(vb => cell(lc, vb))))
  const toggle = (key, val) => { setPreset(null); setF(x => ({ ...x, [key]: x[key] === val ? null : val })); setLimit(100) }
  const anyFilter = preset || Object.values(f).some(Boolean)
  const valueLabel = v => (VALUE_KEY[v] && bands[VALUE_KEY[v]] ? `${tr(v)} ≥${kfmt(bands[VALUE_KEY[v]])}` : v === 'V1 Minimal' && bands.value_band_2 ? `${tr(v)} <${kfmt(bands.value_band_2)}` : tr(v))

  function exportCsv() {
    const head = ['Username', 'Tier', 'Market', 'Lifecycle', 'Value', 'Behaviour', 'Preference', 'Deposit 90d', 'Currency', 'Days inactive', 'Last deposit', 'Last bet', 'Host']
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = filtered.map(r => [r.username, r.tier, mktOf(r.currency), r.lifecycle, r.value_band, r.behaviour, r.preference, Math.round(r.dep_90d), r.currency, r.days_inactive, r.last_deposit_date, r.last_bet_date, r.host_assigned].map(esc).join(','))
    const blob = new Blob(['﻿' + [head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `segments-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }
  const btn = on => ({ padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--surface2)', color: on ? '#fff' : 'var(--text)', fontWeight: on ? 700 : 500 })
  const sel = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 8, fontSize: 13 }
  const th = { padding: '9px 12px', fontSize: 11, color: 'var(--muted)', fontWeight: 700, textAlign: 'left', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }

  const DimCard = ({ title, keyName, order, color, label }) => {
    const c = count(without(keyName), keyName)
    const total = Object.values(c).reduce((s, n) => s + n, 0) || 1
    return (
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
        {order.map(v => {
          const n = c[v] || 0, on = f[keyName] === v
          return (
            <button key={v} onClick={() => toggle(keyName, v)} style={{ display: 'block', width: '100%', textAlign: 'left', background: on ? 'rgba(255,107,0,.12)' : 'transparent', border: on ? '1px solid var(--brand)' : '1px solid transparent', borderRadius: 6, padding: '4px 6px', marginBottom: 2, cursor: 'pointer', color: 'var(--text)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{label ? label(v) : tr(v)}</span><b>{n}</b></div>
              <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, marginTop: 3 }}><div style={{ width: `${n / total * 100}%`, height: '100%', borderRadius: 2, background: (color && color(v)) || 'var(--accent)' }} /></div>
            </button>
          )
        })}
      </div>
    )
  }

  if (rows === null) return <div style={{ padding: 32, color: 'var(--muted)' }}>{L2('Loading segments…', '加载分层中…')}</div>

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', color: 'var(--text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>🧭 {L2('Player Segments', '玩家分层')}</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {L2('4 dimensions: lifecycle · value (real deposits, last 90 days) · behaviour (deposit style) · preference (game type). Click anything to filter.',
                '4 个维度：生命周期 · 价值（近90天真实存款）· 行为（存款风格）· 偏好（游戏类型）。点任何一项就能筛选。')}
          </div>
        </div>
        <button onClick={exportCsv} style={{ ...btn(false), background: '#22C55E', color: '#fff', border: 'none', fontWeight: 700 }}>📥 {L2('Export list', '导出名单')} ({filtered.length})</button>
      </div>
      {err && <div style={{ color: '#f85149', marginBottom: 12 }}>{err}</div>}

      {/* filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {['ALL', 'MY', 'SG', 'KH'].map(m => <button key={m} style={btn(mkt === m)} onClick={() => setMkt(m)}>{m === 'ALL' ? L2('All markets', '全部市场') : m}</button>)}
        <select style={sel} value={host} onChange={e => setHost(e.target.value)}>
          <option value="ALL">{L2('All hosts', '全部负责人')}</option>
          {hosts.map(h => <option key={h} value={h}>{h === '__none' ? L2('(No host)', '（无负责人）') : h}</option>)}
        </select>
        <select style={sel} value={tier} onChange={e => setTier(e.target.value)}>
          <option value="ALL">{L2('All tiers', '全部等级')}</option>
          {tiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input style={{ ...sel, width: 180 }} placeholder={L2('Search username…', '搜索用户名…')} value={search} onChange={e => setSearch(e.target.value)} />
        {anyFilter && <button style={btn(false)} onClick={() => { setF({ lifecycle: null, value_band: null, behaviour: null, preference: null }); setPreset(null) }}>✕ {L2('Clear filters', '清除筛选')}</button>}
      </div>

      {/* quick views */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {PRESETS.map(p => {
          const n = base.filter(p.test).length
          return <button key={p.key} style={btn(preset === p.key)} onClick={() => { setPreset(preset === p.key ? null : p.key); setF({ lifecycle: null, value_band: null, behaviour: null, preference: null }); setLimit(100) }}>
            {p.icon} {L2(p.en, p.zh)} <b>{n}</b></button>
        })}
      </div>

      {/* 4 dimension cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DimCard title={L2('Lifecycle', '生命周期')} keyName="lifecycle" order={LIFECYCLE} color={v => STATUS_CONFIG[v]?.color}
          label={v => <StatusBadge status={v} />} />
        <DimCard title={L2('Value (90-day deposits)', '价值（近90天存款）')} keyName="value_band" order={VALUE} color={v => VALUE_COLOR[v]} label={valueLabel} />
        <DimCard title={L2('Behaviour', '行为')} keyName="behaviour" order={BEHAVIOUR} />
        <DimCard title={L2('Preference', '偏好')} keyName="preference" order={PREFERENCE} />
      </div>

      {/* lifecycle × value matrix */}
      <div style={{ ...card, marginBottom: 14, overflowX: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>
          {L2('Lifecycle × value — number of VIPs (click a box to list them)', '生命周期 × 价值 — VIP 人数（点格子看名单）')}
        </div>
        <table style={{ borderCollapse: 'separate', borderSpacing: 4, width: '100%' }}>
          <thead><tr><th style={{ ...th, borderBottom: 'none' }} />{VALUE.map(v => <th key={v} style={{ ...th, borderBottom: 'none', textAlign: 'center', color: VALUE_COLOR[v] }}>{valueLabel(v)}</th>)}</tr></thead>
          <tbody>
            {LIFECYCLE.map(lc => (
              <tr key={lc}>
                <td style={{ fontSize: 13, paddingRight: 8, whiteSpace: 'nowrap' }}><StatusBadge status={lc} /></td>
                {VALUE.map(vb => {
                  const n = cell(lc, vb), on = f.lifecycle === lc && f.value_band === vb
                  const hot = ['V5 Top', 'V4 High'].includes(vb) && ['At Risk', 'Churn', 'Dormant'].includes(lc) && n > 0
                  return (
                    <td key={vb} onClick={() => { setPreset(null); setF(x => (on ? { ...x, lifecycle: null, value_band: null } : { ...x, lifecycle: lc, value_band: vb })); setLimit(100) }}
                      style={{ textAlign: 'center', borderRadius: 8, padding: '10px 6px', cursor: n ? 'pointer' : 'default', fontWeight: 700, fontSize: 15,
                        background: n ? `rgba(${hot ? '248,81,73' : '88,166,255'},${0.08 + 0.5 * n / maxCell})` : 'var(--surface2)',
                        color: n ? 'var(--text)' : 'var(--muted)', outline: on ? '2px solid var(--brand)' : 'none' }}>
                      {n || '·'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>🟥 {L2('Red = high-value VIPs who are at risk, churning or dormant — the ones to save first.', '红色 = 高价值但有风险、流失或休眠的 VIP — 最优先要救回的人。')}</div>
      </div>

      {/* player list */}
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>
          {L2(`${filtered.length} VIPs`, `${filtered.length} 位 VIP`)}{anyFilter ? L2(' match your filters', ' 符合筛选') : ''} · {L2('sorted by value', '按价值排序')}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{[L2('Player', '玩家'), L2('Tier', '等级'), L2('Lifecycle', '生命周期'), L2('Value', '价值'), L2('Behaviour', '行为'), L2('Preference', '偏好'), L2('Deposits 90d', '近90天存款'), L2('Days inactive', '不活跃天数'), L2('Host', '负责人'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.slice(0, limit).map(r => (
              <tr key={r.id}>
                <td style={td}><button onClick={() => navigate(`/vip360?player=${encodeURIComponent(r.username)}`)} style={{ background: 'none', border: 'none', color: 'var(--text)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 13 }}>{r.username}</button>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{mktOf(r.currency)}</div></td>
                <td style={td}><TierBadge tier={r.tier} /></td>
                <td style={td}><StatusBadge status={r.lifecycle} /></td>
                <td style={{ ...td, color: VALUE_COLOR[r.value_band], fontWeight: 700 }}>{tr(r.value_band)}</td>
                <td style={td}>{tr(r.behaviour)}</td>
                <td style={td}>{tr(r.preference)}</td>
                <td style={{ ...td, fontWeight: 600 }}>{formatMoney(r.dep_90d, r.currency)}</td>
                <td style={td}>{r.days_inactive != null ? L2(`${r.days_inactive}d`, `${r.days_inactive}天`) : '—'}<LastBet date={r.last_bet_date} status={r.lifecycle} /></td>
                <td style={{ ...td, color: 'var(--muted)' }}>{r.host_assigned || '—'}</td>
                <td style={td}>{(r.whatsapp || r.phone) ? <WaButton vip={{ ...r, activity_status: r.lifecycle }} style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 13, background: '#25D366', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>W</WaButton> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > limit && <div style={{ padding: 12, textAlign: 'center' }}><button style={btn(false)} onClick={() => setLimit(l => l + 200)}>{L2(`Show more (${filtered.length - limit} left)`, `显示更多（还有 ${filtered.length - limit} 位）`)}</button></div>}
      </div>
    </div>
  )
}
