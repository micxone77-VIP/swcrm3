// src/components/campaign/CampaignImpact.jsx — 📈 Impact tab: Before / During / After vs a comparison group
// Used by every campaign type (Campaigns.jsx detail modal, Daily Milestone, Challenge).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../hooks/useAuth'
import { loadImpact, summarizeImpact, saveImpactCost, IMPACT_METRICS, VERDICT, LASTING } from '../../lib/campaignImpact'

const CUR_LABEL = { MYR: '🇲🇾 MY (RM)', SGD: '🇸🇬 SG (SGD)', KHUSD: '🇰🇭 KH (USD)' }
const sym = c => (c === 'SGD' ? 'SGD ' : c === 'KHUSD' ? 'USD ' : 'RM ')

export default function CampaignImpact({ campaign, costByCur = null, defaultCur = null, big = false }) {
  const { lang } = useLanguage()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [cur, setCur] = useState(defaultCur)
  const [view, setView] = useState('during')

  useEffect(() => {
    let off = false
    setData(null); setErr('')
    loadImpact(campaign.id).then(d => { if (!off) setData(d) }, e => { if (!off) setErr(e.message) })
    return () => { off = true }
  }, [campaign.id])

  // remember the cost for the Scorecard
  useEffect(() => {
    if (costByCur && (profile?.role === 'admin' || profile?.role === 'host')) saveImpactCost(campaign.id, costByCur, campaign.impact_cost).catch(() => {})
  }, [campaign.id, JSON.stringify(costByCur)]) // eslint-disable-line react-hooks/exhaustive-deps

  const curs = data ? ['MYR', 'SGD', 'KHUSD'].filter(c => (data.players || []).some(p => p.t && p.cur === c)) : []
  const c = cur && curs.includes(cur) ? cur : curs[0]
  const costKnown = costByCur || campaign.impact_cost?.byCur || null
  const cost = !costKnown ? null : costKnown[c] !== undefined ? Number(costKnown[c]) || 0 : curs.length === 1 && Object.keys(costKnown).length ? Number(Object.values(costKnown)[0]) || 0 : null
  const S = data && c ? summarizeImpact(data, c, cost) : null

  const fs = big ? 1.12 : 1
  const fmt = v => (v === null || v === undefined || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-MY'))
  const money = v => (v === null || v === undefined ? '—' : (v < 0 ? '-' : '') + sym(c) + fmt(Math.abs(v)))
  const pct = v => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
  const col = v => (v === null || v === undefined ? 'var(--muted)' : v >= 0 ? '#3fb950' : '#f85149')
  const card = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }
  const th = { padding: '9px 12px', textAlign: 'right', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 * fs, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap', fontSize: 14 * fs }
  const chip = on => ({ padding: '6px 13px', borderRadius: 8, fontSize: 13 * fs, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'var(--surface2)', color: on ? '#fff' : 'var(--text)' })
  const W = data?.windows || {}
  const rng = p => (W[p]?.days ? `${W[p].from} → ${W[p].to}` : L2('no data yet', '暂无数据'))

  if (err) return <div style={{ padding: 20, color: '#f85149' }}>{err}</div>
  if (!data) return <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>{L2('Calculating before / during / after…', '正在计算活动前 / 中 / 后…')}</div>
  if (!S) return <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>{L2('No enrolled players with platform data.', '没有带平台数据的参与玩家。')}</div>

  const V = VERDICT[S.verdict]
  const E = view === 'after' ? S.after : S.during
  const sp = view === 'after' ? S.splitAfter : S.splitDuring

  const metricRow = (m, perPlayer) => {
    const v = (g, p) => (perPlayer ? S.ppd(g, p, m.key) : S.perDay(g, p, m.key))
    const isMoney = m.key !== 'act'
    const f = x => (isMoney ? money(x) : x === null ? '—' : perPlayer ? (x * 100).toFixed(0) + '%' : x.toFixed(1))
    const e = E?.[m.key]
    return (
      <tr key={m.key + perPlayer}>
        <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{L2(m.en, m.zh)}</td>
        <td style={td}>{f(v('T', 'before'))}</td>
        <td style={{ ...td, fontWeight: 700 }}>{f(v('T', 'during'))}</td>
        <td style={td}>{S.days.after ? f(v('T', 'after')) : '—'}</td>
        <td style={{ ...td, color: col(e?.tPct) }}>{pct(e?.tPct)}</td>
        <td style={{ ...td, color: col(e?.cPct) }}>{S.nC ? pct(e?.cPct) : '—'}</td>
        <td style={{ ...td, fontWeight: 800, color: col(e?.incremental) }}>{e ? (isMoney ? money(e.incremental) : `${e.incremental >= 0 ? '+' : ''}${fmt(e.incremental)} ${L2('player-days', '人次')}`) : '—'}</td>
      </tr>
    )
  }

  const playerTable = (rows, title, color) => (
    <div style={{ flex: '1 1 380px', minWidth: 0 }}>
      <div style={{ fontSize: 13 * fs, fontWeight: 700, color, marginBottom: 6 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={{ ...th, textAlign: 'left' }}>VIP</th><th style={th}>{L2('Before /day', '活动前/天')}</th><th style={th}>{view === 'after' ? L2('After /day', '活动后/天') : L2('During /day', '活动中/天')}</th><th style={th}>{L2('Change', '变化')}</th>
        </tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.u}>
            <td style={{ ...td, textAlign: 'left' }}>
              <span onClick={() => navigate(`/vip360?player=${encodeURIComponent(r.u)}`)} style={{ color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>{r.u}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}> {r.tier}{r.host ? ' · ' + r.host : ''}</span>
            </td>
            <td style={td}>{money(r.b)}</td><td style={td}>{money(r.a)}</td>
            <td style={{ ...td, fontWeight: 700, color: col(r.diff) }}>{r.diff >= 0 ? '+' : ''}{money(r.diff)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )

  return (
    <div style={{ fontSize: 14 * fs }}>
      {curs.length > 1 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--muted)', fontSize: 13 * fs }}>{L2('Platform:', '平台：')}</span>
          {curs.map(x => <button key={x} style={chip(x === c)} onClick={() => setCur(x)}>{CUR_LABEL[x] || x} · {(data.players || []).filter(p => p.t && p.cur === x).length}</button>)}
        </div>
      )}

      {/* Verdict */}
      <div style={{ ...card, borderColor: V.color, background: V.color + '14', marginBottom: 14 }}>
        <div style={{ fontSize: 18 * fs, fontWeight: 800, color: V.color }}>{V.icon} {L2(V.en, V.zh)}</div>
        <div style={{ fontSize: 13 * fs, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
          {S.during && <>{L2('Turnover vs comparison group', '相比对照组流水')}: <b style={{ color: col(S.during.vb.liftPct) }}>{pct(S.during.vb.liftPct)}</b> ({money(S.during.vb.incremental)})
            {' · '}{L2('Extra GGR', '额外GGR')}: <b style={{ color: col(S.incGGR) }}>{money(S.incGGR)}</b>
            {S.cost !== null && <>{' · '}{L2('Reward cost', '奖励成本')}: <b>{money(S.cost)}</b>{' · '}{L2('Net value', '净价值')}: <b style={{ color: col(S.net) }}>{money(S.net)}</b></>}</>}
          {S.lasting && <div style={{ marginTop: 4, color: LASTING[S.lasting].color, fontWeight: 700 }}>{LASTING[S.lasting].icon} {L2(LASTING[S.lasting].en, LASTING[S.lasting].zh)} ({L2('turnover', '流水')} {pct(S.after?.vb?.liftPct)})</div>}
          {!S.lasting && S.days.during > 0 && <div style={{ marginTop: 4 }}>⏳ {L2(`"After" fills in from ${W.after?.from} (${data.window} days after the campaign ends).`, `「活动后」将从 ${W.after?.from} 开始计算（活动结束后 ${data.window} 天）。`)}</div>}
        </div>
      </div>

      {/* Periods */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[['before', '⏪', L2('Before', '活动前')], ['during', '🎯', L2('During', '活动中')], ['after', '⏩', L2('After', '活动后')]].map(([p, ic, lb]) => (
          <div key={p} style={card}>
            <div style={{ fontSize: 12 * fs, color: 'var(--muted)', fontWeight: 700 }}>{ic} {lb} · {S.days[p]} {L2('days', '天')}</div>
            <div style={{ fontSize: 13 * fs, marginTop: 2 }}>{rng(p)}</div>
          </div>
        ))}
        <div style={card}>
          <div style={{ fontSize: 12 * fs, color: 'var(--muted)', fontWeight: 700 }}>👥 {L2('Players', '玩家')}</div>
          <div style={{ fontSize: 13 * fs, marginTop: 2 }}>{L2('Campaign', '活动')} <b>{S.nT}</b> · {L2('Comparison', '对照组')} <b>{S.nC}</b></div>
        </div>
      </div>

      {(S.smallControl || S.running) && (
        <div style={{ fontSize: 12 * fs, color: '#d29922', marginBottom: 10 }}>
          {S.smallControl && <div>⚠️ {L2(`Small comparison group (${S.nC} VIPs) — the effect is less reliable.`, `对照组较小（${S.nC} 位VIP）— 结果可靠性较低。`)}</div>}
          {S.running && <div>⏳ {L2(`Campaign still running — "During" covers ${S.days.during} settled day(s) so far.`, `活动进行中 —「活动中」目前只有 ${S.days.during} 个结算日。`)}</div>}
        </div>
      )}

      {/* During / After switch */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button style={chip(view === 'during')} onClick={() => setView('during')}>🎯 {L2('During vs before', '活动中 vs 活动前')}</button>
        <button style={chip(view === 'after')} onClick={() => setView('after')} disabled={!S.days.after}>⏩ {L2('After vs before', '活动后 vs 活动前')}{!S.days.after ? L2(' (not yet)', '（未到）') : ''}</button>
      </div>

      {E && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
          {[
            [L2('Extra turnover', '额外流水'), money(E.vb.incremental), col(E.vb.incremental), pct(E.vb.liftPct) + L2(' vs expected', ' 对比预期')],
            [L2('Extra deposit', '额外存款'), money(E.dep.incremental), col(E.dep.incremental), pct(E.dep.liftPct)],
            [L2('Extra GGR', '额外GGR'), money(E.ggr.incremental), col(E.ggr.incremental), L2('house win vs expected', '公司赢 对比预期')],
            [L2('Extra active player-days', '额外活跃人次'), `${E.act.incremental >= 0 ? '+' : ''}${fmt(E.act.incremental)}`, col(E.act.incremental), pct(E.act.liftPct)],
            ...(view === 'during' && S.cost !== null ? [[L2('Net value (extra GGR − cost)', '净价值（额外GGR − 成本）'), money(S.net), col(S.net), 'ROI ' + pct(S.roi)]] : []),
          ].map(([l, v, cc, sub]) => (
            <div key={l} style={card}>
              <div style={{ fontSize: 12 * fs, color: 'var(--muted)' }}>{l}</div>
              <div style={{ fontSize: 22 * fs, fontWeight: 800, color: cc }}>{v}</div>
              <div style={{ fontSize: 11 * fs, color: 'var(--muted)' }}>{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto', marginBottom: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>{L2('Campaign players — per day', '活动玩家 — 每天')}</th>
            <th style={th}>⏪ {L2('Before', '活动前')}</th><th style={th}>🎯 {L2('During', '活动中')}</th><th style={th}>⏩ {L2('After', '活动后')}</th>
            <th style={th}>{L2('Campaign change', '活动玩家变化')}</th><th style={th}>{L2('Comparison change', '对照组变化')}</th>
            <th style={th}>{view === 'after' ? L2('Effect (after)', '效果（活动后）') : L2('Effect (during)', '效果（活动中）')}</th>
          </tr></thead>
          <tbody>{IMPACT_METRICS.map(m => metricRow(m, false))}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 12 * fs, color: 'var(--muted)', marginBottom: 18, lineHeight: 1.6 }}>
        {L2('Effect = what campaign players actually did minus what they would have done without the campaign: their own "before" level × the comparison group\'s % change over the same days (comparison group = same currency + tier at enrolment, not enrolled, not in another campaign at the same time, with platform history). Using % keeps it fair when campaign players are bigger players than the comparison group. GGR follows the comparison group\'s turnover change. Before and after = the same number of days as the campaign (minimum 7). Deposit, withdrawal and GGR only count days the player bet.', '效果 = 活动玩家实际表现 − 没有活动时的预期：玩家自己「活动前」的水平 × 对照组同期的百分比变化（对照组 = 同币种 + 报名时同等级、未参加、同期未参加其他活动、并有平台历史数据）。用百分比比较，避免活动玩家比对照组玩得更大造成不公平。GGR 按对照组的流水变化推算。活动前和活动后 = 与活动相同天数（至少 7 天）。存款、提款和GGR只计算玩家有投注的日子。')}
      </div>

      {/* Player split */}
      {sp && (
        <>
          <div style={{ fontSize: 14 * fs, fontWeight: 800, marginBottom: 8 }}>👤 {L2('Players', '玩家')} — {view === 'after' ? L2('after vs before (turnover per day)', '活动后 vs 活动前（每日流水）') : L2('during vs before (turnover per day)', '活动中 vs 活动前（每日流水）')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[
              ['📈', L2('Up 20%+', '上升 20%+'), sp.up.length, '#3fb950'],
              ['🔁', L2('Reactivated', '重新活跃'), sp.reactivated.length, '#38bdf8'],
              ['↔️', L2('About the same', '差不多'), sp.flat.length, '#8b949e'],
              ['📉', L2('Down 20%+', '下降 20%+'), sp.down.length, '#f97316'],
              ['⛔', L2('Stopped', '停止'), sp.stopped.length, '#f85149'],
              ['💤', L2('Inactive both', '前后都没玩'), sp.idle.length, '#6e7681'],
            ].map(([ic, l, n, cc]) => (
              <div key={l} style={{ ...card, padding: '8px 14px', borderColor: cc + '66' }}>
                <span style={{ fontSize: 13 * fs }}>{ic} {l}</span> <b style={{ fontSize: 18 * fs, color: cc, marginLeft: 6 }}>{n}</b>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {playerTable(sp.gainers.filter(x => x.diff > 0), L2('🏆 Top gainers', '🏆 提升最多'), '#3fb950')}
            {sp.losers.length > 0 && playerTable(sp.losers, L2('🔻 Biggest drops', '🔻 下降最多'), '#f85149')}
          </div>
        </>
      )}
    </div>
  )
}
