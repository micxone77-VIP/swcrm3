// src/components/expense/CashVoucherOverview.jsx — Expenses › 🎟️ Cash Voucher tab
// Totals (Online vs Offline, per currency), month-by-month summary, and the full claim list with Pending first.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { fetchAll } from '../../lib/depositProfile'
import { setClaimStatus } from '../../lib/cashVoucherImport'

const ST = { pending: ['#d29922', 'Pending', '待处理'], accepted: ['#3fb950', 'Accepted', '已批准'], declined: ['#f85149', 'Declined', '已拒绝'] }
const sym = c => (c === 'SGD' ? 'SGD ' : c === 'KHUSD' ? 'USD ' : 'RM ')
const money = (n, c) => sym(c) + Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 })

export default function CashVoucherOverview() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const canEdit = profile?.role === 'admin' || profile?.role === 'host'
  const [rows, setRows] = useState(null)
  const [monthF, setMonthF] = useState('ALL')
  const [statusF, setStatusF] = useState('ALL')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)

  async function load() {
    const data = await fetchAll(() => supabase.from('cash_voucher_claims')
      .select('id, claimed_at, claim_month, username, full_name, currency, amount, status, remark, feedback, satisfaction, recommend_score, receipt_url, expense_id, department_expenses(expense_type)')
      .order('claimed_at', { ascending: false }))
    setRows(data.map(r => ({ ...r, type: r.department_expenses?.expense_type || null })))
  }
  useEffect(() => { load().catch(e => { console.error(e); setRows([]) }) }, [])

  const months = useMemo(() => [...new Set((rows || []).map(r => r.claim_month))].sort().reverse(), [rows])
  const inMonth = (rows || []).filter(r => monthF === 'ALL' || r.claim_month === monthF)

  // Summary per currency
  const sum = {}
  inMonth.forEach(r => {
    const c = r.currency || 'MYR'
    sum[c] = sum[c] || { online: 0, offline: 0, onlineN: 0, offlineN: 0, pending: 0, pendingN: 0, declinedN: 0 }
    const a = Number(r.amount) || 0
    if (r.status === 'accepted') { if (r.type === 'offline') { sum[c].offline += a; sum[c].offlineN++ } else { sum[c].online += a; sum[c].onlineN++ } }
    else if (r.status === 'pending') { sum[c].pending += a; sum[c].pendingN++ }
    else sum[c].declinedN++
  })

  // Month-by-month (accepted, MYR + SGD)
  const byMonth = {}
  ;(rows || []).forEach(r => {
    const k = r.claim_month; byMonth[k] = byMonth[k] || { n: 0, pend: 0, MYR: { on: 0, off: 0 }, SGD: { on: 0, off: 0 }, KHUSD: { on: 0, off: 0 } }
    if (r.status === 'pending') byMonth[k].pend++
    if (r.status !== 'accepted') return
    byMonth[k].n++
    const c = byMonth[k][r.currency || 'MYR'] || (byMonth[k][r.currency] = { on: 0, off: 0 })
    if (r.type === 'offline') c.off += Number(r.amount) || 0; else c.on += Number(r.amount) || 0
  })

  const list = inMonth
    .filter(r => statusF === 'ALL' || r.status === statusF)
    .filter(r => !q.trim() || r.username.toLowerCase().includes(q.trim().toLowerCase()) || String(r.full_name || '').toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || String(b.claimed_at).localeCompare(String(a.claimed_at)))

  async function changeStatus(r, status) {
    if (busy || r.status === status) return
    setBusy(r.id)
    try {
      const res = await setClaimStatus(r, status, profile?.id)
      setRows(rs => rs.map(x => (x.id === r.id ? { ...x, ...res, type: res.expense_id ? (x.type || 'online') : null } : x)))
    } catch (e) { window.alert(L2(`Update failed: ${e.message}`, `更新失败：${e.message}`)) } finally { setBusy(null) }
  }
  async function changeType(r, type) {
    if (!r.expense_id) return
    const { error } = await supabase.from('department_expenses').update({ expense_type: type }).eq('id', r.expense_id)
    if (error) { window.alert(error.message); return }
    setRows(rs => rs.map(x => (x.id === r.id ? { ...x, type } : x)))
  }

  if (!rows) return <div style={{ padding: 30, color: 'var(--muted)' }}>{L2('Loading…', '载入中…')}</div>

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', minWidth: 170 }
  const th = { padding: '9px 12px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' }
  const sel = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '6px 10px', fontSize: 13 }
  const pendTotal = Object.values(sum).reduce((s, v) => s + v.pendingN, 0)

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select style={sel} value={monthF} onChange={e => setMonthF(e.target.value)}>
          <option value="ALL">{L2('All months', '全部月份')}</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {['ALL', 'pending', 'accepted', 'declined'].map(s => (
          <button key={s} onClick={() => setStatusF(s)} style={{ ...sel, cursor: 'pointer', fontWeight: statusF === s ? 700 : 500,
            background: statusF === s ? (s === 'ALL' ? 'var(--accent)' : ST[s][0]) : 'var(--surface2)', color: statusF === s ? '#fff' : 'var(--text)' }}>
            {s === 'ALL' ? L2('All', '全部') : L2(ST[s][1], ST[s][2])}{s === 'pending' && pendTotal ? ` (${pendTotal})` : ''}
          </button>
        ))}
        <input style={{ ...sel, minWidth: 180 }} placeholder={L2('Search VIP…', '搜索VIP…')} value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        {Object.entries(sum).map(([c, v]) => (
          <div key={c} style={{ ...card, minWidth: 260 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>{c} · {monthF === 'ALL' ? L2('all months', '全部月份') : monthF}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#3fb950' }}>{money(v.online + v.offline, c)}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <span style={{ color: '#58a6ff', fontWeight: 600 }}>{L2('Online', '线上')} {money(v.online, c)} ({v.onlineN})</span>
              {' · '}
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>{L2('Offline', '线下')} {money(v.offline, c)} ({v.offlineN})</span>
            </div>
            <div style={{ fontSize: 12, marginTop: 4, color: v.pendingN ? '#d29922' : 'var(--muted)' }}>
              ⏳ {L2('Pending', '待处理')} {v.pendingN} · {money(v.pending, c)}{v.declinedN ? ` · ${L2('Declined', '已拒绝')} ${v.declinedN}` : ''}
            </div>
          </div>
        ))}
        {!Object.keys(sum).length && <div style={{ color: 'var(--muted)' }}>{L2('No claims for this month.', '本月没有申请。')}</div>}
      </div>

      {/* Monthly summary */}
      {monthF === 'ALL' && (
        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{L2('BY MONTH (accepted)', '按月份（已批准）')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{[L2('Month', '月份'), L2('Claims', '笔数'), L2('MYR Online', 'MYR 线上'), L2('MYR Offline', 'MYR 线下'), L2('SGD Online', 'SGD 线上'), L2('SGD Offline', 'SGD 线下'), L2('Pending', '待处理')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {Object.keys(byMonth).sort().reverse().map(m => {
                const v = byMonth[m]
                return (
                  <tr key={m} style={{ cursor: 'pointer' }} onClick={() => setMonthF(m)}>
                    <td style={{ ...td, fontWeight: 700 }}>{m}</td>
                    <td style={td}>{v.n}</td>
                    <td style={{ ...td, color: '#58a6ff' }}>{v.MYR.on ? money(v.MYR.on, 'MYR') : '—'}</td>
                    <td style={{ ...td, color: '#f59e0b' }}>{v.MYR.off ? money(v.MYR.off, 'MYR') : '—'}</td>
                    <td style={{ ...td, color: '#58a6ff' }}>{v.SGD.on ? money(v.SGD.on, 'SGD') : '—'}</td>
                    <td style={{ ...td, color: '#f59e0b' }}>{v.SGD.off ? money(v.SGD.off, 'SGD') : '—'}</td>
                    <td style={{ ...td, color: v.pend ? '#d29922' : 'var(--muted)', fontWeight: v.pend ? 700 : 400 }}>{v.pend || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Claim list */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{L2(`CLAIMS (${list.length}) — pending first`, `申请（${list.length}）— 待处理优先`)}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['#', L2('Date', '日期'), 'VIP', L2('Amount', '金额'), L2('Status', '状态'), L2('Online / Offline', '线上 / 线下'), '⭐', L2('Remark', '备注')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map((r, i) => {
              const st = ST[r.status] || ST.pending
              return (
                <tr key={r.id} style={{ background: r.status === 'pending' ? 'rgba(210,153,34,.06)' : 'transparent' }}>
                  <td style={{ ...td, color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>{new Date(r.claimed_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={td}>
                    <button onClick={() => navigate(`/vip360?player=${encodeURIComponent(r.username)}&tab=spending`)} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>{r.username}</button>
                    {r.full_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.full_name}</div>}
                  </td>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{money(r.amount, r.currency)}</td>
                  <td style={td}>
                    {canEdit ? (
                      <select value={r.status} disabled={busy === r.id} onChange={e => changeStatus(r, e.target.value)}
                        style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 10, border: `1px solid ${st[0]}66`, background: st[0] + '22', color: st[0], cursor: 'pointer' }}>
                        {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{L2(v[1], v[2])}</option>)}
                      </select>
                    ) : <span style={{ fontSize: 11, fontWeight: 700, color: st[0] }}>{L2(st[1], st[2])}</span>}
                  </td>
                  <td style={td}>
                    {r.status === 'accepted' && r.expense_id ? (
                      <select value={r.type || 'online'} disabled={!canEdit} onChange={e => changeType(r, e.target.value)}
                        style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 10, cursor: 'pointer', border: '1px solid var(--border)',
                          background: r.type === 'offline' ? 'rgba(245,158,11,.12)' : 'rgba(59,130,246,.12)', color: r.type === 'offline' ? '#f59e0b' : '#58a6ff' }}>
                        <option value="online">{L2('Online', '线上')}</option>
                        <option value="offline">{L2('Offline', '线下')}</option>
                      </select>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>{r.satisfaction ?? '—'} / {r.recommend_score ?? '—'}</td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--muted)', maxWidth: 320 }}>{r.remark || r.feedback || '—'}</td>
                </tr>
              )
            })}
            {!list.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 30 }}>{L2('No claims match.', '没有符合的申请。')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
