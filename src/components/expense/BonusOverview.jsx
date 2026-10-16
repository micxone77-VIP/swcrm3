// src/components/expense/BonusOverview.jsx — Expenses › VIP Bonuses (BO): all pasted BO bonuses by month / category / VIP
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/depositProfile'
import { useLanguage } from '../../contexts/LanguageContext'
import { BONUS_CATS, money2 } from '../../lib/vipBonus'

export default function BonusOverview() {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [month, setMonth] = useState('ALL')
  const [plat, setPlat] = useState('ALL')

  useEffect(() => {
    fetchAll(() => supabase.from('vip_bonus_txns').select('txn_id, username, txn_at, month, bonus_name, category, amount, currency').order('txn_at', { ascending: false }))
      .then(setRows, e => { setErr(e.message); setRows([]) })
  }, [])

  const months = useMemo(() => [...new Set((rows || []).map(r => r.month))].sort().reverse(), [rows])
  const curs = useMemo(() => ['MYR', 'SGD', 'KHUSD'].filter(c => (rows || []).some(r => (r.currency || 'MYR') === c)), [rows])
  const scoped = (rows || []).filter(r => (month === 'ALL' || r.month === month) && (plat === 'ALL' || (r.currency || 'MYR') === plat))

  const add = (o, k, v) => { o[k] = (o[k] || 0) + v }
  const totCur = {}; const byCat = {}; const byVip = {}; const byMonth = {}
  scoped.forEach(r => {
    const c = r.currency || 'MYR', a = Number(r.amount || 0)
    add(totCur, c, a)
    byCat[r.category] = byCat[r.category] || {}; add(byCat[r.category], c, a)
    const v = byVip[r.username] = byVip[r.username] || { cur: c, amt: 0, n: 0, cats: {} }; v.amt += a; v.n++; add(v.cats, r.category, a)
  })
  ;(rows || []).filter(r => plat === 'ALL' || (r.currency || 'MYR') === plat).forEach(r => { byMonth[r.month] = byMonth[r.month] || {}; add(byMonth[r.month], r.currency || 'MYR', Number(r.amount || 0)) })
  const multi = o => Object.entries(o).map(([c, v]) => money2(v, c)).join(' · ') || '—'
  const vips = Object.entries(byVip).sort((a, b) => b[1].amt - a[1].amt)

  const card = { padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', minWidth: 160 }
  const chip = on => ({ padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'var(--surface2)', color: on ? '#fff' : 'var(--text)' })
  const th = { padding: '9px 12px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)' }

  if (!rows) return <div style={{ padding: 24, color: 'var(--muted)' }}>{L2('Loading…', '载入中…')}</div>
  if (err) return <div style={{ padding: 24, color: '#f85149' }}>{err}</div>
  if (!rows.length) return (
    <div style={{ padding: 24, color: 'var(--muted)' }}>
      {L2('No BO bonuses yet. Open a VIP → Dept Spending → "Paste BO bonuses" to add them.', '暂无BO奖励记录。请到 VIP360 → 部门开支 →「粘贴BO奖励记录」添加。')}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{L2('Platform:', '平台：')}</span>
        {['ALL', ...curs].map(c => <button key={c} style={chip(plat === c)} onClick={() => setPlat(c)}>{c === 'ALL' ? L2('All', '全部') : c === 'SGD' ? '🇸🇬 SG' : c === 'KHUSD' ? '🇰🇭 KH' : '🇲🇾 MY'}</button>)}
        <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 12 }}>{L2('Month:', '月份：')}</span>
        {['ALL', ...months].map(m => <button key={m} style={chip(month === m)} onClick={() => setMonth(m)}>{m === 'ALL' ? L2('All', '全部') : m}</button>)}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {Object.entries(totCur).map(([c, v]) => (
          <div key={c} style={{ ...card, borderColor: 'rgba(249,97,103,.35)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>🎁 {L2('Bonus total', '奖励总额')} ({c})</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f96167' }}>{money2(v, c)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{scoped.filter(r => (r.currency || 'MYR') === c).length} {L2('records', '条记录')} · {new Set(scoped.filter(r => (r.currency || 'MYR') === c).map(r => r.username)).size} VIP</div>
          </div>
        ))}
        {Object.entries(byCat).sort((a, b) => Object.values(b[1]).reduce((s, x) => s + x, 0) - Object.values(a[1]).reduce((s, x) => s + x, 0)).map(([k, o]) => {
          const c = BONUS_CATS[k] || BONUS_CATS.Other
          return (
            <div key={k} style={card}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.icon} {L2(k, c.zh)}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: c.color }}>{multi(o)}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(420px, 2fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase' }}>{L2('By month', '按月份')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={th}>{L2('Month', '月份')}</th><th style={{ ...th, textAlign: 'right' }}>{L2('Bonus', '奖励')}</th></tr></thead>
            <tbody>{Object.keys(byMonth).sort().reverse().map(m => (
              <tr key={m} onClick={() => setMonth(m)} style={{ cursor: 'pointer', background: month === m ? 'var(--surface2)' : 'transparent' }}>
                <td style={td}>{m}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{multi(byMonth[m])}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase' }}>{L2('By VIP', '按VIP')} ({vips.length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>
              <th style={th}>VIP</th><th style={th}>{L2('Breakdown', '明细')}</th><th style={{ ...th, textAlign: 'right' }}>#</th><th style={{ ...th, textAlign: 'right' }}>{L2('Total', '合计')}</th>
            </tr></thead>
            <tbody>{vips.map(([u, v]) => (
              <tr key={u}>
                <td style={td}><span onClick={() => navigate(`/vip360?player=${encodeURIComponent(u)}&tab=spending`)} style={{ color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>{u}</span></td>
                <td style={{ ...td, fontSize: 12, color: 'var(--muted)' }}>{Object.entries(v.cats).sort((a, b) => b[1] - a[1]).map(([k, a]) => `${(BONUS_CATS[k] || BONUS_CATS.Other).icon} ${money2(a, v.cur).trim()}`).join('  ')}</td>
                <td style={{ ...td, textAlign: 'right' }}>{v.n}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{money2(v.amt, v.cur)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
