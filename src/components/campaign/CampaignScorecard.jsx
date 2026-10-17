// src/components/campaign/CampaignScorecard.jsx — 📈 one table: did each campaign work?
// Runs campaign_impact for every campaign (before / during / after vs comparison group).
// Reward cost comes from campaigns.impact_cost (saved when the campaign's 📈 Impact tab is opened).
import { useEffect, useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadImpact, summarizeImpact, VERDICT, LASTING } from '../../lib/campaignImpact'

const sym = c => (c === 'SGD' ? 'SGD ' : c === 'KHUSD' ? 'USD ' : 'RM ')
const FLAG = { MYR: '🇲🇾', SGD: '🇸🇬', KHUSD: '🇰🇭' }

export default function CampaignScorecard({ campaigns, onOpen, onClose }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [rows, setRows] = useState([])
  const [done, setDone] = useState(0)

  const list = (campaigns || []).filter(c => c.start_date && c.end_date && c.status !== 'draft')
    .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))

  useEffect(() => {
    let off = false
    setRows([]); setDone(0)
    ;(async () => {
      for (const camp of list) {
        let out = []
        try {
          const d = await loadImpact(camp.id)
          const curs = ['MYR', 'SGD', 'KHUSD'].filter(c => (d.players || []).some(p => p.t && p.cur === c))
          const byCur = camp.impact_cost?.byCur || null
          out = curs.map(cur => {
            const cost = !byCur ? null : byCur[cur] !== undefined ? Number(byCur[cur]) || 0 : curs.length === 1 && Object.keys(byCur).length ? Number(Object.values(byCur)[0]) || 0 : null
            return { camp, cur, S: summarizeImpact(d, cur, cost) }
          })
          if (!curs.length) out = [{ camp, cur: null, S: null }]
        } catch (e) { out = [{ camp, cur: null, S: null, err: e.message }] }
        if (off) return
        setRows(r => [...r, ...out]); setDone(n => n + 1)
      }
    })()
    return () => { off = true }
  }, [list.map(c => c.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = v => Math.round(Math.abs(v)).toLocaleString('en-MY')
  const money = (v, c) => (v === null || v === undefined ? '—' : (v < 0 ? '-' : '+') + sym(c) + fmt(v))
  const pct = v => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
  const col = v => (v === null || v === undefined ? 'var(--muted)' : v >= 0 ? '#3fb950' : '#f85149')
  const th = { padding: '10px 12px', textAlign: 'right', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 12, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', position: 'sticky', top: 0 }
  const td = { padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap', fontSize: 14 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, width: 'min(1700px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', zoom: 1.1 }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>📈 {L2('Campaign Scorecard — did it work?', '活动成效 — 有没有效？')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {L2('Each campaign\'s players vs a comparison group (same currency + tier, not enrolled), before / during / after. Click a row to open the campaign. Cost shows once the campaign\'s 📈 Impact tab has been opened.',
                '每个活动的玩家 vs 对照组（同币种 + 同等级、未参加），活动前 / 中 / 后。点击一行打开活动。成本在打开该活动的 📈 成效 标签后显示。')}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {done < list.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Calculating', '计算中')} {done}/{list.length}…</span>}
            <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '6px 12px', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        </div>
        <div style={{ overflow: 'auto', padding: '0 0 10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>{L2('Campaign', '活动')}</th>
              <th style={th}>{L2('Players', '玩家')}</th>
              <th style={th}>{L2('Turnover lift', '流水提升')}</th>
              <th style={th}>{L2('Extra turnover', '额外流水')}</th>
              <th style={th}>{L2('Extra deposit', '额外存款')}</th>
              <th style={th}>{L2('Extra GGR', '额外GGR')}</th>
              <th style={th}>{L2('Cost', '成本')}</th>
              <th style={th}>{L2('Net value', '净价值')}</th>
              <th style={{ ...th, textAlign: 'left' }}>{L2('Verdict', '结论')}</th>
              <th style={{ ...th, textAlign: 'left' }}>{L2('After campaign', '活动后')}</th>
            </tr></thead>
            <tbody>
              {rows.map(({ camp, cur, S, err }, i) => {
                const V = S ? VERDICT[S.verdict] : null
                const Lt = S?.lasting ? LASTING[S.lasting] : null
                return (
                  <tr key={camp.id + (cur || '') + i} onClick={() => onOpen && onOpen(camp)} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <div style={{ fontWeight: 700 }}>{camp.campaign_name} {cur && <span style={{ fontSize: 12 }}>{FLAG[cur]}</span>}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{camp.start_date} → {camp.end_date}</div>
                    </td>
                    <td style={td}>{S ? <>{S.nT}<span style={{ fontSize: 11, color: 'var(--muted)' }}> / {S.nC}</span></> : '—'}</td>
                    <td style={{ ...td, fontWeight: 800, color: col(S?.during?.vb?.liftPct) }}>{pct(S?.during?.vb?.liftPct)}</td>
                    <td style={{ ...td, color: col(S?.during?.vb?.incremental) }}>{S?.during ? money(S.during.vb.incremental, cur) : '—'}</td>
                    <td style={{ ...td, color: col(S?.during?.dep?.incremental) }}>{S?.during ? money(S.during.dep.incremental, cur) : '—'}</td>
                    <td style={{ ...td, color: col(S?.incGGR) }}>{S?.during ? money(S.incGGR, cur) : '—'}</td>
                    <td style={td}>{S?.cost !== null && S?.cost !== undefined ? sym(cur) + fmt(S.cost) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>{L2('open tab', '待打开')}</span>}</td>
                    <td style={{ ...td, fontWeight: 800, color: col(S?.net) }}>{S?.net !== null && S?.net !== undefined ? money(S.net, cur) : '—'}</td>
                    <td style={{ ...td, textAlign: 'left', color: V?.color || '#f85149', fontWeight: 700, whiteSpace: 'normal', minWidth: 160 }}>
                      {err ? err : V ? `${V.icon} ${L2(V.en.split(' — ')[0], V.zh.split(' — ')[0])}` : L2('No players', '没有玩家')}
                    </td>
                    <td style={{ ...td, textAlign: 'left', color: Lt?.color || 'var(--muted)', fontSize: 13 }}>
                      {Lt ? `${Lt.icon} ${pct(S.after?.vb?.liftPct)}` : S?.days?.during ? L2(`from ${S.windows?.after?.from}`, `${S.windows?.after?.from} 起`) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 22px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
          {L2('Players = campaign / comparison group. Lift = extra turnover ÷ what they would have done without the campaign. Net value = extra GGR − reward cost. GGR swings a lot (players can win) — turnover lift is the steadier signal. Platform data starts 2026-06-01, so earlier campaigns can\'t be judged.',
            '玩家 = 活动 / 对照组。提升 = 额外流水 ÷ 没有活动时的预期。净价值 = 额外GGR − 奖励成本。GGR波动很大（玩家可能赢）— 流水提升更稳定。平台数据从 2026-06-01 开始，之前的活动无法判断。')}
        </div>
      </div>
    </div>
  )
}
