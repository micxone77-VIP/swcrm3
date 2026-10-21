// src/components/RecallByLayer.jsx — recall rate per host per layer (fix 5, 2026-10-22)
// Source: v_recall_summary_monthly (from v_recall_attribution). Layer = the VIP's status on the contact day,
// same crm_rules as the status everywhere else. Recalled = real deposit (with bets) on the contact day or next day.
// Rates count players, not messages. Money is not summed here (MYR and SGD must not be added together).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../contexts/LanguageContext'
import { STATUS_CONFIG } from '../lib/enums'

const LAYERS = [
  { key: 'At Risk', en: 'At Risk (3–6d)',  zh: '有风险 (3–6天)' },
  { key: 'Resting', en: '😴 Resting',       zh: '😴 休息中' },
  { key: 'Churn',   en: 'Churn (7–14d)',   zh: '流失 (7–14天)' },
  { key: 'Dormant', en: 'Dormant (15d+)',  zh: '休眠 (15天+)' },
]
const SIDE = [
  { key: 'Active',     en: 'Already active', zh: '本来就活跃' },
  { key: 'No history', en: 'No history',     zh: '无记录' },
]

function monthOptions(n = 6) {
  const out = []; const d = new Date(Date.now() + 8 * 3600e3)
  for (let i = 0; i < n; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)) }
  return out
}

export default function RecallByLayer() {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const months = monthOptions()
  const [month, setMonth] = useState(months[0])
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    setRows(null); setErr('')
    supabase.from('v_recall_summary_monthly').select('host_name, recall_layer, players_contacted, players_recalled').eq('month', month)
      .then(({ data, error }) => { if (off) return; if (error) setErr(error.message); setRows(data || []) })
    return () => { off = true }
  }, [month])

  const hosts = [...new Set((rows || []).map(r => r.host_name))].sort()
  const cell = (host, layer) => {
    const list = (rows || []).filter(r => r.recall_layer === layer && (host === null || r.host_name === host))
    return { c: list.reduce((s, r) => s + Number(r.players_contacted || 0), 0), r: list.reduce((s, r) => s + Number(r.players_recalled || 0), 0) }
  }
  const realTotal = host => LAYERS.reduce((t, l) => { const x = cell(host, l.key); return { c: t.c + x.c, r: t.r + x.r } }, { c: 0, r: 0 })
  const pct = x => (x.c ? Math.round(x.r / x.c * 100) : null)
  const rateColor = p => (p == null ? 'var(--muted)' : p >= 40 ? '#3fb950' : p >= 20 ? '#d29922' : '#f85149')

  const td = { padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 13, textAlign: 'center', whiteSpace: 'nowrap' }
  const th = { ...td, fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }
  const Cell = ({ x, muted }) => {
    const p = pct(x)
    if (!x.c) return <td style={{ ...td, color: 'var(--muted)' }}>—</td>
    return <td style={td}>
      <div style={{ fontWeight: 700, color: muted ? 'var(--muted)' : rateColor(p) }}>{p}%</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2(`${x.r} of ${x.c}`, `${x.c} 人中 ${x.r}`)}</div>
    </td>
  }
  const Row = ({ host, label, bold }) => {
    const tot = realTotal(host)
    return <tr style={bold ? { background: 'var(--surface2)' } : null}>
      <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{label}</td>
      {LAYERS.map(l => <Cell key={l.key} x={cell(host, l.key)} />)}
      <Cell x={tot} />
      {SIDE.map(l => <Cell key={l.key} x={cell(host, l.key)} muted />)}
    </tr>
  }

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', padding: '18px 20px', marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>🎯 {L2('Recall rate by host and layer', '各负责人按层级的召回率')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {L2('Layer = the VIP\'s status on the contact day. Recalled = real deposit (with bets) on the contact day or the next day. Counts players, not messages.',
                '层级 = 联系当天VIP的状态。召回 = 联系当天或第二天有真实存款（有投注）。按玩家计算，不按信息条数。')}
          </div>
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)}
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 8, fontSize: 13 }}>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {err ? <div style={{ color: '#f85149', fontSize: 13 }}>{err}</div>
        : rows === null ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{L2('Loading…', '加载中…')}</div>
        : !rows.length ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{L2('No contacts logged this month.', '本月没有联系记录。')}</div>
        : <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>{L2('Host', '负责人')}</th>
                {LAYERS.map(l => <th key={l.key} style={{ ...th, color: STATUS_CONFIG[l.key]?.color || th.color }}>{L2(l.en, l.zh)}</th>)}
                <th style={th}>{L2('Real recall total', '真实召回合计')}</th>
                {SIDE.map(l => <th key={l.key} style={th}>{L2(l.en, l.zh)}</th>)}
              </tr></thead>
              <tbody>
                {hosts.map(h => <Row key={h} host={h} label={h} />)}
                <Row host={null} label={L2('Team', '团队')} bold />
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              {L2('"Already active" contacts are shown apart: those players were depositing anyway, so they are not counted as recalls.',
                  '"本来就活跃"的联系单独显示：这些玩家本来就在存款，不算召回。')}
            </div>
          </div>}
    </div>
  )
}
