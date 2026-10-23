// src/pages/ExecOverview.jsx — Executive overview for the boss (2026-10-23), read-only.
// One page that pulls the phase-1 pieces together, using the same sources as the detail pages so numbers match:
//   KPI (get_manager_kpi) · segments (v_vip_segments) · money / win-loss alerts (loadBigWinLoss).
// Money is per currency (MYR and SGD never added). Every block links to its detail page.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/depositProfile'
import { formatMoney } from '../lib/format'
import { loadBigWinLoss } from '../lib/bigWinLoss'
import { useLanguage } from '../contexts/LanguageContext'
import { StatusBadge, TierBadge } from '../components/ui'
import { STATUS_CONFIG } from '../lib/enums'

const LIFECYCLE = ['Active', 'Resting', 'At Risk', 'Churn', 'Dormant']
const HV = ['V5 Top', 'V4 High']
const CURS = ['MYR', 'SGD', 'KHUSD']
const pct = (a, b) => (b ? Math.round(a / b * 100) : null)
const thisMonth = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)

export default function ExecOverview() {
  const navigate = useNavigate()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const month = thisMonth()
  const [kpi, setKpi] = useState(null)
  const [seg, setSeg] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [mood, setMood] = useState({ rated: 0, pts: 0, neg: 0 })

  useEffect(() => {
    supabase.rpc('get_manager_kpi', { p_month: month }).then(({ data }) => setKpi(data || []))
    supabase.rpc('get_sentiment_kpi', { p_month: month }).then(({ data }) =>
      setMood((data || []).reduce((t, r) => ({ rated: t.rated + r.rated, pts: t.pts + r.positive * 100 + r.neutral * 50, neg: t.neg + r.negative }), { rated: 0, pts: 0, neg: 0 })))
    fetchAll(() => supabase.from('v_vip_segments').select('id,username,tier,currency,host_assigned,lifecycle,value_band,dep_90d,days_inactive').order('username')).then(setSeg, () => setSeg([]))
    loadBigWinLoss().then(setAlerts, () => setAlerts({ losses: [], wins: [], withdrawals: [], spikes: [], drops: [] }))
  }, [month])

  const team = useMemo(() => {
    const t = { money: {} }, hosts = {}
    ;(kpi || []).forEach(r => {
      ;['contacts', 'replies', 'prev_depositors', 'retained', 'recall_contacted', 'recalled', 'tasks_done', 'tasks_missed', 'vips', 'vips_contacted'].forEach(k => {
        t[k] = (t[k] || 0) + Number(r[k] || 0)
        const h = hosts[r.host] || (hosts[r.host] = { host: r.host }); h[k] = (h[k] || 0) + Number(r[k] || 0)
      })
      const m = t.money[r.currency] || (t.money[r.currency] = { dep: 0, ggr: 0, act: 0 })
      m.dep += Number(r.deposit_total || 0); m.ggr += Number(r.ggr || 0); m.act += Number(r.active_depositors || 0)
    })
    return { t, hosts: Object.values(hosts).filter(h => h.host !== '(no host)').sort((a, b) => a.host.localeCompare(b.host)) }
  }, [kpi])

  const segs = seg || []
  const lc = c => segs.filter(r => r.lifecycle === c).length
  const hvRisk = segs.filter(r => HV.includes(r.value_band) && ['At Risk', 'Churn'].includes(r.lifecycle)).sort((a, b) => Number(b.dep_90d) - Number(a.dep_90d))
  const hvDormant = segs.filter(r => HV.includes(r.value_band) && r.lifecycle === 'Dormant').length
  const noHost = segs.filter(r => !r.host_assigned).length
  const moves = alerts ? [...alerts.withdrawals.map(r => ({ ...r, mk: 'wd' })), ...alerts.spikes.map(r => ({ ...r, mk: 'sp' }))].sort((a, b) => b.amountMyr - a.amountMyr).slice(0, 6) : []

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }
  const h2 = { fontSize: 13, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const more = to => <button onClick={() => navigate(to)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>{L2('Details →', '详细 →')}</button>
  const td = { padding: '7px 8px', fontSize: 13, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const t = team.t
  const money = field => CURS.filter(c => t.money[c]?.act > 0).map(c => formatMoney(t.money[c][field] / t.money[c].act, c)).join(' · ') || '—'
  const Big = ({ label, value, sub, color }) => (
    <div style={card}>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, margin: '4px 0', color: color || 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
    </div>
  )
  const P = (a, b) => (pct(a, b) == null ? '—' : `${pct(a, b)}%`)
  const loading = kpi === null || seg === null || alerts === null

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', color: 'var(--text)' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>🏛️ {L2('Executive Overview', '上司总览')}</h1>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          {L2(`VIP department at a glance — ${month}`, `VIP 部门一页总览 — ${month}`)}{alerts?.dataDate ? L2(` · data up to ${alerts.dataDate}`, ` · 数据截至 ${alerts.dataDate}`) : ''} · {L2('read-only', '只读')}
        </div>
      </div>
      {loading ? <div style={{ color: 'var(--muted)' }}>{L2('Loading…', '加载中…')}</div> : <>
        {/* 1. KPI headline */}
        <div style={{ ...h2 }}><span>📊 {L2('This month — team', '本月 — 团队')}</span>{more('/manager-kpi')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
          <Big label={L2('Retention', '留存率')} value={P(t.retained, t.prev_depositors)} sub={L2(`${t.retained || 0} of ${t.prev_depositors || 0} kept depositing`, `${t.prev_depositors || 0} 人中 ${t.retained || 0} 人继续存款`)} color="#3fb950" />
          <Big label={L2('Recall rate', '召回率')} value={P(t.recalled, t.recall_contacted)} sub={L2(`${t.recalled || 0} of ${t.recall_contacted || 0} came back`, `${t.recall_contacted || 0} 人中 ${t.recalled || 0} 人回来`)} />
          <Big label={L2('Contacts', '接触次数')} value={t.contacts || 0} sub={L2(`reply rate ${P(t.replies, t.contacts)}`, `回复率 ${P(t.replies, t.contacts)}`)} />
          <Big label={L2('ARPU (deposit)', 'ARPU（人均存款）')} value={<span style={{ fontSize: 17 }}>{money('dep')}</span>} sub={L2('per active depositor', '每位有存款的 VIP')} />
          <Big label={L2('ARPU (GGR)', 'ARPU（人均 GGR）')} value={<span style={{ fontSize: 17 }}>{money('ggr')}</span>} sub={L2('house win per active depositor', '平台每人赢的钱')} />
          <Big label={L2('Daily tasks done', '每日任务完成')} value={P(t.tasks_done, (t.tasks_done || 0) + (t.tasks_missed || 0))} sub={L2(`${t.tasks_done || 0} done · ${t.tasks_missed || 0} missed`, `完成 ${t.tasks_done || 0} · 未完成 ${t.tasks_missed || 0}`)}
            color={pct(t.tasks_done, (t.tasks_done || 0) + (t.tasks_missed || 0)) < 50 ? '#f85149' : '#3fb950'} />
          <Big label={L2('Sentiment score', '情感评分')} value={mood.rated ? Math.round(mood.pts / mood.rated) : '—'}
            sub={mood.rated ? L2(`0–100 · ${mood.rated} rated · 😠 ${mood.neg}`, `0–100 · ${mood.rated} 次评分 · 😠 ${mood.neg}`) : L2('No mood tagged yet', '还没有情绪评分')} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14, marginBottom: 14 }}>
          {/* 2. Segments */}
          <div style={card}>
            <div style={h2}><span>🧭 {L2('Players by lifecycle', '玩家生命周期')}</span>{more('/segments')}</div>
            <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 8 }}>
              {LIFECYCLE.map(c => <div key={c} title={`${c} ${lc(c)}`} style={{ width: `${lc(c) / Math.max(1, segs.length) * 100}%`, background: STATUS_CONFIG[c]?.color }} />)}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              {LIFECYCLE.map(c => <span key={c} style={{ fontSize: 12 }}><StatusBadge status={c} /> <b>{lc(c)}</b></span>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[[L2('🚨 High value at risk', '🚨 高价值有风险'), hvRisk.length, '#f85149'], [L2('💤 High value dormant', '💤 高价值休眠'), hvDormant, '#d29922'], [L2('👤 VIPs without a host', '👤 没有负责人'), noHost, 'var(--muted)']].map(([l, n, c]) => (
                <div key={l} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{l}</div><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{n}</div></div>
              ))}
            </div>
          </div>
          {/* 3. Alerts */}
          <div style={card}>
            <div style={h2}><span>🔔 {L2('Yesterday\'s alerts', '昨日预警')}</span>{more('/alerts?tab=winloss')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 10 }}>
              {[['🔻', L2('Big loss', '大输'), alerts.losses.length, '#f85149'], ['🔺', L2('Big win', '大赢'), alerts.wins.length, '#3fb950'], ['💸', L2('Big withdrawal', '大额提款'), alerts.withdrawals.length, '#d29922'], ['📈', L2('Deposit spike', '存款暴增'), alerts.spikes.length, '#3fb950'], ['📉', L2('Deposit drop', '存款骤降'), alerts.drops.length, '#f85149']].map(([i, l, n, c]) => (
                <div key={l} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}><div style={{ fontSize: 16 }}>{i}</div><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{n}</div><div style={{ fontSize: 10, color: 'var(--muted)' }}>{l}</div></div>
              ))}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              {moves.map(r => (
                <tr key={r.mk + r.username} style={{ cursor: 'pointer' }} onClick={() => navigate(`/vip360?player=${encodeURIComponent(r.username)}`)}>
                  <td style={td}>{r.mk === 'wd' ? '💸' : '📈'} <b>{r.username}</b></td><td style={td}><TierBadge tier={r.tier} /></td>
                  <td style={{ ...td, fontWeight: 700, color: r.mk === 'wd' ? '#d29922' : '#3fb950' }}>{formatMoney(r.amount, r.currency)}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{r.ratio ? `${Number(r.ratio).toFixed(1)}× ${L2('usual', '平常')}` : ''}</td><td style={{ ...td, color: 'var(--muted)' }}>{r.host || L2('no host', '无负责人')}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14 }}>
          {/* 4. Top high-value at risk */}
          <div style={card}>
            <div style={h2}><span>🚨 {L2('Top 10 high-value VIPs at risk', '高价值有风险 — 前 10 位')}</span>{more('/segments')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              {hvRisk.slice(0, 10).map((r, i) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/vip360?player=${encodeURIComponent(r.username)}`)}>
                  <td style={{ ...td, color: 'var(--muted)' }}>{i + 1}</td><td style={td}><b>{r.username}</b></td><td style={td}><TierBadge tier={r.tier} /></td>
                  <td style={td}><StatusBadge status={r.lifecycle} /> <span style={{ color: 'var(--muted)', fontSize: 12 }}>{L2(`${r.days_inactive}d`, `${r.days_inactive}天`)}</span></td>
                  <td style={{ ...td, fontWeight: 700 }}>{formatMoney(r.dep_90d, r.currency)}<div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{L2('deposits, 90 days', '近90天存款')}</div></td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{r.host_assigned || L2('no host', '无负责人')}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          {/* 5. Managers */}
          <div style={card}>
            <div style={h2}><span>👥 {L2('Managers this month', '本月各经理')}</span>{more('/manager-kpi')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{[L2('Manager', '经理'), L2('VIPs', 'VIP'), L2('Contacts', '接触'), L2('Retention', '留存'), L2('Recall', '召回'), L2('Daily tasks', '每日任务')].map(h => <th key={h} style={{ ...td, fontSize: 11, color: 'var(--muted)', textAlign: 'left' }}>{h}</th>)}</tr></thead>
              <tbody>{team.hosts.map(h => (
                <tr key={h.host}>
                  <td style={{ ...td, fontWeight: 700 }}>{h.host}</td><td style={td}>{h.vips || 0}</td><td style={td}>{h.contacts || 0}</td>
                  <td style={td}>{P(h.retained, h.prev_depositors)}</td><td style={td}>{P(h.recalled, h.recall_contacted)}</td>
                  <td style={td}>{P(h.tasks_done, (h.tasks_done || 0) + (h.tasks_missed || 0))}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </>}
    </div>
  )
}
