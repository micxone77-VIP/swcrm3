// src/pages/ManagerKPI.jsx — VIP manager KPI board (2026-10-23)
// Data: get_manager_kpi(month) — one row per host × player currency.
// Counts/rates add up across currencies; money (ARPU, GGR) is shown per currency — MYR and SGD are never added.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'

const mktOf = c => { const u = String(c || 'MYR').toUpperCase(); return u === 'SGD' ? 'SG' : u.startsWith('KH') ? 'KH' : 'MY' }
const CURS = ['MYR', 'SGD', 'KHUSD']
const pct = (a, b) => (b ? Math.round(a / b * 100) : null)
function monthOptions(n = 6) {
  const out = []; const d = new Date(Date.now() + 8 * 3600e3)
  for (let i = 0; i < n; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)) }
  return out
}
const SUM_KEYS = ['vips', 'contacts', 'vips_contacted', 'replies', 'prev_depositors', 'retained', 'active_depositors', 'recall_contacted', 'recalled', 'tasks_done', 'tasks_missed', 'tasks_open']

export default function ManagerKPI() {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const months = monthOptions()
  const [month, setMonth] = useState(months[0])
  const [mkt, setMkt] = useState('ALL')
  const [rows, setRows] = useState(null)
  const [mood, setMood] = useState({})   // host → { rated, positive, neutral, negative, score } (get_sentiment_kpi)
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    setRows(null); setErr('')
    supabase.rpc('get_manager_kpi', { p_month: month }).then(({ data, error }) => {
      if (off) return
      if (error) setErr(error.message)
      setRows(data || [])
    })
    supabase.rpc('get_sentiment_kpi', { p_month: month }).then(({ data }) => {
      if (!off) setMood(Object.fromEntries((data || []).map(r => [r.host, r])))
    })
    return () => { off = true }
  }, [month])
  // team sentiment = weighted over all rated replies
  const teamMood = Object.values(mood).reduce((t, r) => ({ rated: t.rated + r.rated, pts: t.pts + r.positive * 100 + r.neutral * 50 }), { rated: 0, pts: 0 })
  const moodOf = h => (h === '__team' ? (teamMood.rated ? { score: Math.round(teamMood.pts / teamMood.rated), rated: teamMood.rated } : null) : mood[h] || null)
  const MoodCell = ({ h }) => {
    const m = moodOf(h)
    if (!m || !m.rated) return <span style={{ color: 'var(--muted)' }}>—</span>
    const s = Number(m.score)
    return <div><b style={{ fontSize: 15, color: s >= 70 ? '#3fb950' : s >= 40 ? '#d29922' : '#f85149' }}>{s}</b>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.positive != null ? `😊${m.positive} 😐${m.neutral} 😠${m.negative}` : L2(`${m.rated} rated`, `${m.rated} 次评分`)}</div></div>
  }

  // group into hosts; money kept per currency
  const hosts = useMemo(() => {
    const by = {}
    ;(rows || []).filter(r => mkt === 'ALL' || mktOf(r.currency) === mkt).forEach(r => {
      const h = by[r.host] || (by[r.host] = { host: r.host, money: {} })
      SUM_KEYS.forEach(k => { h[k] = (h[k] || 0) + Number(r[k] || 0) })
      const m = h.money[r.currency] || (h.money[r.currency] = { dep: 0, ggr: 0, act: 0 })
      m.dep += Number(r.deposit_total || 0); m.ggr += Number(r.ggr || 0); m.act += Number(r.active_depositors || 0)
    })
    const order = h => (h === '(no host)' ? 'zz' : h.toLowerCase())
    const list = Object.values(by).sort((a, b) => order(a.host).localeCompare(order(b.host)))
    const team = { host: '__team', money: {} }
    list.forEach(h => {
      SUM_KEYS.forEach(k => { team[k] = (team[k] || 0) + h[k] })
      Object.entries(h.money).forEach(([c, m]) => { const t = team.money[c] || (team.money[c] = { dep: 0, ggr: 0, act: 0 }); t.dep += m.dep; t.ggr += m.ggr; t.act += m.act })
    })
    return { list, team }
  }, [rows, mkt])

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }
  const btn = on => ({ padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--surface2)', color: on ? '#fff' : 'var(--text)', fontWeight: on ? 700 : 500 })
  const th = { padding: '9px 12px', fontSize: 11, color: 'var(--muted)', fontWeight: 700, textAlign: 'left', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
  const rateColor = (p, good, ok) => (p == null ? 'var(--muted)' : p >= good ? '#3fb950' : p >= ok ? '#d29922' : '#f85149')
  const Rate = ({ a, b, good = 60, ok = 30 }) => {
    const p = pct(a, b)
    return <div><b style={{ color: rateColor(p, good, ok), fontSize: 15 }}>{p == null ? '—' : `${p}%`}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{b ? L2(`${a} of ${b}`, `${b} 中 ${a}`) : ''}</div></div>
  }
  const Money = ({ money, field }) => {
    const cs = CURS.filter(c => money[c] && money[c].act > 0)
    if (!cs.length) return <span style={{ color: 'var(--muted)' }}>—</span>
    return <div>{cs.map(c => <div key={c}><b>{formatMoney(money[c][field] / money[c].act, c)}</b></div>)}</div>
  }
  const name = h => (h === '__team' ? L2('Team total', '团队合计') : h === '(no host)' ? L2('(No host)', '（无负责人）') : h)

  const t = hosts.team
  const kpis = [
    { label: L2('Contacts', '接触次数'), value: t.contacts ?? 0, sub: L2(`${t.vips_contacted ?? 0} VIPs reached`, `接触了 ${t.vips_contacted ?? 0} 位 VIP`) },
    { label: L2('Reply rate', '回复率'), value: pct(t.replies, t.contacts) == null ? '—' : `${pct(t.replies, t.contacts)}%`, sub: L2(`${t.replies ?? 0} replies`, `${t.replies ?? 0} 次回复`) },
    { label: L2('Retention', '留存率'), value: pct(t.retained, t.prev_depositors) == null ? '—' : `${pct(t.retained, t.prev_depositors)}%`, sub: L2(`${t.retained ?? 0} of ${t.prev_depositors ?? 0} kept depositing`, `${t.prev_depositors ?? 0} 人中 ${t.retained ?? 0} 人继续存款`) },
    { label: L2('Recall rate', '召回率'), value: pct(t.recalled, t.recall_contacted) == null ? '—' : `${pct(t.recalled, t.recall_contacted)}%`, sub: L2(`${t.recalled ?? 0} of ${t.recall_contacted ?? 0} came back`, `${t.recall_contacted ?? 0} 人中 ${t.recalled ?? 0} 人回来`) },
    { label: L2('Daily tasks done', '每日任务完成'), value: pct(t.tasks_done, (t.tasks_done || 0) + (t.tasks_missed || 0)) == null ? '—' : `${pct(t.tasks_done, (t.tasks_done || 0) + (t.tasks_missed || 0))}%`, sub: L2(`${t.tasks_done ?? 0} done · ${t.tasks_missed ?? 0} missed · ${t.tasks_open ?? 0} open`, `完成 ${t.tasks_done ?? 0} · 未完成 ${t.tasks_missed ?? 0} · 待办 ${t.tasks_open ?? 0}`) },
    { label: L2('Sentiment score', '情感评分'), value: teamMood.rated ? Math.round(teamMood.pts / teamMood.rated) : '—',
      sub: teamMood.rated ? L2(`0–100 · from ${teamMood.rated} rated replies`, `0–100 · 来自 ${teamMood.rated} 次回复评分`) : L2('No mood tagged yet — tag 😊😐😠 when a VIP replies', '还没有情绪评分 — VIP 回复时点 😊😐😠') },
  ]

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', color: 'var(--text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📊 {L2('VIP Manager KPI Board', 'VIP 经理 KPI 看板')}</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{L2('Contacts, reply rate, retention, recall, ARPU and daily-task completion per manager, per month.', '每位经理每月的接触次数、回复率、留存率、召回率、ARPU 和每日任务完成率。')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['ALL', 'MY', 'SG', 'KH'].map(m => <button key={m} style={btn(mkt === m)} onClick={() => setMkt(m)}>{m === 'ALL' ? L2('All markets', '全部市场') : m}</button>)}
          <select value={month} onChange={e => setMonth(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 8, fontSize: 13 }}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      {err && <div style={{ color: '#f85149', marginBottom: 12 }}>{err}</div>}
      {rows === null ? <div style={{ color: 'var(--muted)' }}>{L2('Loading…', '加载中…')}</div> : <>
        {/* team summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
          {kpis.map(k => (
            <div key={k.label} style={card}>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{k.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, margin: '4px 0' }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* per manager */}
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>{L2('Manager', '经理')}</th><th style={th}>{L2('VIPs', 'VIP 数')}</th>
              <th style={th}>{L2('Contacts', '接触次数')}</th><th style={th}>{L2('Coverage', '覆盖率')}</th><th style={th}>{L2('Reply rate', '回复率')}</th>
              <th style={th}>{L2('Retention', '留存率')}</th><th style={th}>{L2('Recall', '召回率')}</th>
              <th style={th}>{L2('Active depositors', '有存款人数')}</th><th style={th}>{L2('ARPU (deposit)', 'ARPU（人均存款）')}</th><th style={th}>{L2('ARPU (GGR)', 'ARPU（人均 GGR）')}</th>
              <th style={th}>{L2('Daily tasks', '每日任务')}</th><th style={th}>{L2('Sentiment', '情感评分')}</th>
            </tr></thead>
            <tbody>
              {[...hosts.list, hosts.team].map(h => (
                <tr key={h.host} style={h.host === '__team' ? { background: 'var(--surface2)', fontWeight: 700 } : null}>
                  <td style={{ ...td, fontWeight: 700 }}>{name(h.host)}</td>
                  <td style={td}>{h.vips || 0}</td>
                  <td style={td}><b>{h.contacts || 0}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2(`${h.vips_contacted || 0} VIPs`, `${h.vips_contacted || 0} 位 VIP`)}</div></td>
                  <td style={td}>{h.host === '(no host)' ? <span style={{ color: 'var(--muted)' }}>—</span> : <Rate a={Math.min(h.vips_contacted || 0, h.vips || 0)} b={h.vips} good={70} ok={40} />}</td>
                  <td style={td}><Rate a={h.replies} b={h.contacts} good={40} ok={20} /></td>
                  <td style={td}><Rate a={h.retained} b={h.prev_depositors} good={80} ok={60} /></td>
                  <td style={td}><Rate a={h.recalled} b={h.recall_contacted} good={40} ok={20} /></td>
                  <td style={td}>{h.active_depositors || 0}</td>
                  <td style={td}><Money money={h.money} field="dep" /></td>
                  <td style={td}><Money money={h.money} field="ggr" /></td>
                  <td style={td}>{(h.tasks_done || 0) + (h.tasks_missed || 0) + (h.tasks_open || 0) ? <div><b style={{ color: '#3fb950' }}>{h.tasks_done || 0}</b> / <span style={{ color: '#f85149' }}>{h.tasks_missed || 0}</span> / <span style={{ color: 'var(--muted)' }}>{h.tasks_open || 0}</span><div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('done / missed / open', '完成 / 未完成 / 待办')}</div></div> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td style={td}><MoodCell h={h.host} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
          {L2('How each number is counted:', '每个数字怎么算：')}<br />
          • {L2('Contacts / reply rate: contact logs by the manager this month; reply = Replied / Reactivated / Deposited. Coverage = assigned VIPs reached this month.', '接触次数 / 回复率：经理本月的联系记录；回复 = 已回复 / 已召回 / 已存款。覆盖率 = 名下 VIP 本月有被联系到的比例。')}<br />
          • {L2('Retention: assigned VIPs with a real deposit (with bets) last month who also made one this month.', '留存率：名下上个月有真实存款（有投注）的 VIP，这个月也有存款的比例。')}<br />
          • {L2('Recall: players contacted while At Risk / Resting / Churn / Dormant who deposited on the contact day or the next day.', '召回率：联系时是有风险 / 休息中 / 流失 / 休眠的玩家，联系当天或第二天有存款。')}<br />
          • {L2('ARPU: this month\'s real deposits (or GGR = house win) ÷ active depositors, per currency. MYR and SGD are never added together.', 'ARPU：本月真实存款（或 GGR = 平台赢的钱）÷ 有存款人数，按币种分开，MYR 和 SGD 不相加。')}<br />
          • {L2('Daily tasks: tasks from the daily list / follow-up dates created this month.', '每日任务：本月每日名单和跟进日自动产生的任务。')}<br />
          • {L2('Sentiment: mood the manager tagged when a VIP replied (WA popup / call log): 😊 = 100, 😐 = 50, 😠 = 0, averaged. Untagged replies are left out.', '情感评分：VIP 回复时经理点的情绪（WA 弹窗 / 记录通话）：😊 = 100、😐 = 50、😠 = 0，取平均。没点的不算。')}
        </div>
      </>}
    </div>
  )
}
