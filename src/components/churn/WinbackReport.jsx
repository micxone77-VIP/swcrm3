// 🎁 Win-back tab on Churn Urgency: every win-back bonus with its automatic result, totals per currency,
// breakdown by stage / host / bonus size, and players who keep taking the bonus without depositing.
// MYR and SGD are never added together: every total is per currency.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { formatMoney } from '../../lib/format'
import { fetchMembersFor } from '../../lib/allPlayers'
import CopyBtn from '../CopyBtn'
import { AMOUNT_BANDS, BONUS_TYPES, RESULT_INFO, loadWinbackResults, ngrAfter, num, summarize } from '../../lib/winback'

const th = { padding:'9px 12px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }
const td = { padding:'9px 12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle', fontSize:13 }
const sel = { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:8, fontSize:13, outline:'none' }
const btnSm = { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer' }
const card = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px', minWidth:150, flex:'1 1 150px' }
const pctTxt = v => v == null ? '—' : `${v}%`

function Badge({ r, L2 }) {
  const i = RESULT_INFO[r] || RESULT_INFO.waiting
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:700, background:i.bg, color:i.color, whiteSpace:'nowrap' }}>{i.icon} {L2(i.en, i.zh)}</span>
}

export default function WinbackReport({ market = 'ALL', reloadKey = 0 }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const isAdmin = profile?.role === 'admin'
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [names, setNames] = useState({})
  const [monthF, setMonthF] = useState('ALL')
  const [stageF, setStageF] = useState('ALL')
  const [hostF, setHostF] = useState('ALL')
  const [resultF, setResultF] = useState('ALL')

  async function load() {
    setError('')
    try {
      const data = await loadWinbackResults()
      setRows(data)
      const m = await fetchMembersFor(data.map(r => r.username), 'username,full_name').catch(() => [])
      setNames(Object.fromEntries(m.map(x => [x.username, x.full_name])))
    } catch (e) { setError(e.message || String(e)); setRows([]) }
  }
  useEffect(() => { load() }, [reloadKey])

  async function remove(r) {
    if (!window.confirm(L2(`Delete the win-back bonus for ${r.username} on ${r.given_on}?`, `删除 ${r.username} 在 ${r.given_on} 的召回奖金记录？`))) return
    const { error: e } = await supabase.from('winback_bonuses').delete().eq('id', r.id)
    if (e) { alert(e.message); return }
    load()
  }

  if (rows === null) return <div style={{ padding:30, color:'var(--muted)' }}>{L2('Loading…', '载入中…')}</div>

  const mktOf = c => { const u = String(c || 'MYR').toUpperCase(); return u === 'SGD' ? 'SG' : u.startsWith('KH') ? 'KH' : 'MY' }
  const inMkt = rows.filter(r => market === 'ALL' || mktOf(r.currency) === market)
  const months = [...new Set(inMkt.map(r => String(r.given_on).slice(0, 7)))].sort().reverse()
  const hosts = [...new Set(inMkt.map(r => r.host_name).filter(Boolean))].sort()
  const shown = inMkt.filter(r => (monthF === 'ALL' || String(r.given_on).startsWith(monthF)) && (stageF === 'ALL' || r.stage === stageF) && (hostF === 'ALL' || r.host_name === hostF) && (resultF === 'ALL' || r.result === resultF))
  const curs = [...new Set(shown.map(r => r.currency || 'MYR'))].sort()
  const dataThrough = rows[0]?.data_through

  // Players who took a win-back bonus 2+ times and never deposited from it (all months)
  const repeat = Object.values(inMkt.reduce((m, r) => {
    const x = m[r.username] || (m[r.username] = { username: r.username, currency: r.currency, tier: r.tier, host: r.host_name, times: 0, bonusOnly: 0, deposited: 0, cost: 0, last: r.given_on })
    x.times++; x.cost += num(r.amount); if (r.result === 'bonus_only') x.bonusOnly++; if (r.result === 'deposited') x.deposited++; if (r.given_on > x.last) x.last = r.given_on
    return m
  }, {})).filter(x => x.bonusOnly >= 2).sort((a, b) => b.bonusOnly - a.bonusOnly || b.cost - a.cost)

  const groupTable = (title, keyOf, labelOf, order) => {
    const groups = {}
    shown.forEach(r => { const k = keyOf(r); if (k == null) return; const g = `${k}|${r.currency || 'MYR'}`; (groups[g] = groups[g] || []).push(r) })
    const keys = Object.keys(groups).sort((a, b) => {
      const [ka, ca] = a.split('|'), [kb, cb] = b.split('|')
      return ca.localeCompare(cb) || (order ? order.indexOf(ka) - order.indexOf(kb) : ka.localeCompare(kb))
    })
    if (!keys.length) return null
    return (
      <div style={{ marginTop:18 }}>
        <div style={{ fontWeight:700, fontSize:14, marginBottom:8 }}>{title}</div>
        <div style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>{[L2('Group', '分组'), L2('Currency', '货币'), L2('Bonuses', '次数'), L2('Bonus cost', '奖金成本'), L2('Came back', '回归率'), L2('Stayed active', '持续活跃'), L2('Bonus only', '只玩奖金'), L2('No response', '没反应'), L2('Waiting', '等待中'), L2('Deposit after', '之后存款'), L2('NGR after', '之后NGR'), L2('Return per 1', '每1元回报')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{keys.map(g => {
            const [k, c] = g.split('|'); const t = summarize(groups[g])
            return <tr key={g}>
              <td style={{ ...td, fontWeight:700 }}>{labelOf(k)}</td><td style={td}>{c}</td><td style={td}>{t.count}</td>
              <td style={td}>{formatMoney(t.cost, c)}</td>
              <td style={{ ...td, color:RESULT_INFO.deposited.color, fontWeight:700 }}>{pctTxt(t.pctDeposited)} <span style={{ color:'var(--muted)', fontWeight:400, fontSize:11 }}>({t.deposited}/{t.finished})</span></td>
              <td style={td}>{t.stayed}{t.pctStayed != null ? <span style={{ color:'var(--muted)', fontSize:11 }}> ({t.pctStayed}%)</span> : null}</td>
              <td style={{ ...td, color:RESULT_INFO.bonus_only.color }}>{pctTxt(t.pctBonusOnly)}</td>
              <td style={{ ...td, color:RESULT_INFO.no_response.color }}>{pctTxt(t.pctNoResponse)}</td>
              <td style={td}>{t.waiting}</td>
              <td style={td}>{formatMoney(t.depositAfter, c)}</td>
              <td style={{ ...td, color:t.ngr >= 0 ? '#3fb950' : '#f85149' }}>{formatMoney(t.ngr, c)}</td>
              <td style={{ ...td, fontWeight:700, color:t.returnPer1 == null ? 'var(--muted)' : t.returnPer1 >= 1 ? '#3fb950' : '#f85149' }}>{t.returnPer1 == null ? '—' : t.returnPer1.toFixed(2)}</td>
            </tr>
          })}</tbody>
        </table></div>
      </div>
    )
  }

  return (
    <div style={{ padding:'12px 14px' }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
        <select style={sel} value={monthF} onChange={e => setMonthF(e.target.value)}><option value="ALL">{L2('All months', '全部月份')}</option>{months.map(m => <option key={m} value={m}>{m}</option>)}</select>
        <select style={sel} value={stageF} onChange={e => setStageF(e.target.value)}><option value="ALL">{L2('Churn + Dormant', '流失 + 休眠')}</option><option value="Churn">{L2('Churn (7–14 days)', '流失（7–14天）')}</option><option value="Dormant">{L2('Dormant (15+ days)', '休眠（15天以上）')}</option></select>
        <select style={sel} value={hostF} onChange={e => setHostF(e.target.value)}><option value="ALL">{L2('All hosts', '全部负责人')}</option>{hosts.map(h => <option key={h} value={h}>{h}</option>)}</select>
        <select style={sel} value={resultF} onChange={e => setResultF(e.target.value)}><option value="ALL">{L2('All results', '全部结果')}</option>{Object.entries(RESULT_INFO).map(([k, v]) => <option key={k} value={k}>{v.icon} {L2(v.en, v.zh)}</option>)}</select>
        <span style={{ marginLeft:'auto', fontSize:12, color:'var(--muted)' }}>{L2('Daily data up to', '每日数据截至')} {dataThrough || '—'}</span>
      </div>

      <div style={{ fontSize:12, color:'var(--muted)', marginBottom:12, lineHeight:1.5 }}>
        {L2(`Came back = real deposit (deposit and valid bet) within ${rows[0]?.window_days ?? 7} days of the bonus. Stayed active = 2+ deposit days within ${rows[0]?.retain_days ?? 30} days. NGR after = player loss − bonuses − rebate in those ${rows[0]?.retain_days ?? 30} days. Return per 1 = NGR after ÷ bonus cost (above 1.00 = the bonus paid for itself).`,
            `回归 = 发放后 ${rows[0]?.window_days ?? 7} 天内真实存款（有存款且有有效投注）。持续活跃 = ${rows[0]?.retain_days ?? 30} 天内存款 2 天以上。之后NGR = 这 ${rows[0]?.retain_days ?? 30} 天的玩家输额 − 奖金 − 返水。每1元回报 = 之后NGR ÷ 奖金成本（超过 1.00 = 奖金已回本）。`)}
      </div>

      {error && <div style={{ color:'#f85149', marginBottom:10 }}>{L2('Could not load: ', '载入失败：')}{error}</div>}
      {!shown.length && !error && <div style={{ padding:30, textAlign:'center', color:'var(--muted)' }}>{inMkt.length ? L2('No bonuses match these filters.', '没有符合筛选的记录。') : L2('No win-back bonuses yet. Use the 🎁 Bonus button on the No Deposit, Churn, Dormant or Priority tabs.', '还没有召回奖金记录。请在 未存款 / 流失 / 休眠 / 优先 分页点 🎁 奖金。')}</div>}

      {curs.map(c => {
        const t = summarize(shown.filter(r => (r.currency || 'MYR') === c))
        return (
          <div key={c} style={{ marginBottom:14 }}>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:6 }}>{c}</div>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <div style={card}><div style={{ fontSize:11, color:'var(--muted)' }}>🎁 {L2('Bonuses given', '已发放')}</div><div style={{ fontSize:22, fontWeight:800 }}>{t.count}</div><div style={{ fontSize:11, color:'var(--muted)' }}>{t.players} {L2('players', '位玩家')} · {formatMoney(t.cost, c)}</div></div>
              <div style={card}><div style={{ fontSize:11, color:'var(--muted)' }}>✅ {L2('Came back & deposited', '回归并存款')}</div><div style={{ fontSize:22, fontWeight:800, color:RESULT_INFO.deposited.color }}>{pctTxt(t.pctDeposited)}</div><div style={{ fontSize:11, color:'var(--muted)' }}>{t.deposited} / {t.finished} {L2('finished', '已有结果')}{t.avgDaysToDep != null ? L2(` · avg ${t.avgDaysToDep} days`, ` · 平均 ${t.avgDaysToDep} 天`) : ''}</div></div>
              <div style={card}><div style={{ fontSize:11, color:'var(--muted)' }}>🔁 {L2('Stayed active', '持续活跃')}</div><div style={{ fontSize:22, fontWeight:800 }}>{t.stayed}</div><div style={{ fontSize:11, color:'var(--muted)' }}>{t.pctStayed != null ? L2(`${t.pctStayed}% of those who came back`, `回归者中 ${t.pctStayed}%`) : '—'}</div></div>
              <div style={card}><div style={{ fontSize:11, color:'var(--muted)' }}>⚠️ {L2('Bonus only', '只玩奖金')}</div><div style={{ fontSize:22, fontWeight:800, color:RESULT_INFO.bonus_only.color }}>{pctTxt(t.pctBonusOnly)}</div><div style={{ fontSize:11, color:'var(--muted)' }}>{t.bonus_only} {L2('players', '位')} · ❌ {t.no_response} {L2('no response', '没反应')} · ⏳ {t.waiting}</div></div>
              <div style={card}><div style={{ fontSize:11, color:'var(--muted)' }}>💰 {L2('Deposit after bonus', '奖金后存款')}</div><div style={{ fontSize:22, fontWeight:800 }}>{formatMoney(t.depositAfter, c)}</div><div style={{ fontSize:11, color:'var(--muted)' }}>{L2('first 7 days', '前7天')} {formatMoney(t.depositWindow, c)}</div></div>
              <div style={card}><div style={{ fontSize:11, color:'var(--muted)' }}>📈 {L2('NGR after · return per 1', '之后NGR · 每1元回报')}</div><div style={{ fontSize:22, fontWeight:800, color:t.ngr >= 0 ? '#3fb950' : '#f85149' }}>{formatMoney(t.ngr, c)}</div><div style={{ fontSize:11, color:'var(--muted)' }}>{t.returnPer1 == null ? '—' : L2(`${t.returnPer1.toFixed(2)} per 1 of bonus`, `每1元奖金回报 ${t.returnPer1.toFixed(2)}`)}</div></div>
            </div>
            {t.notSeen > 0 && <div style={{ fontSize:11, color:'#d29922', marginTop:6 }}>⚠️ {L2(`${t.notSeen} direct-credit bonus(es) not seen in the daily import yet: check they were really credited.`, `有 ${t.notSeen} 笔直接入账奖金在每日数据中还没看到：请确认是否已入账。`)}</div>}
          </div>
        )
      })}

      {groupTable(L2('By stage', '按阶段'), r => r.stage, k => k === 'Dormant' ? L2('💤 Dormant (15+ days)', '💤 休眠（15天以上）') : L2('🔥 Churn (7–14 days)', '🔥 流失（7–14天）'), ['Churn', 'Dormant'])}
      {groupTable(L2('By bonus size', '按奖金金额'), r => (AMOUNT_BANDS.find(([, lo, hi]) => num(r.amount) >= lo && num(r.amount) <= hi) || AMOUNT_BANDS[0])[0], k => k, AMOUNT_BANDS.map(b => b[0]))}
      {groupTable(L2('By host', '按负责人'), r => r.host_name || '—', k => k)}

      {repeat.length > 0 && (
        <div style={{ marginTop:18 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:4, color:RESULT_INFO.bonus_only.color }}>⚠️ {L2('Took the bonus 2+ times without depositing', '领奖金2次以上但没存款')}</div>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>{L2('Consider stopping win-back bonuses for these players.', '建议停止给这些玩家召回奖金。')}</div>
          <div style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{[L2('Player', '玩家'), L2('Tier', '等级'), L2('Host', '负责人'), L2('Bonuses', '次数'), L2('Bonus only', '只玩奖金'), L2('Deposited', '有存款'), L2('Total bonus', '奖金总额'), L2('Last bonus', '最近一次')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{repeat.map(x => <tr key={x.username}>
              <td style={td}><b>{x.username}</b><CopyBtn text={x.username} />{names[x.username] && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{names[x.username]}</div>}</td>
              <td style={td}>{x.tier || '—'}</td><td style={td}>{x.host || '—'}</td><td style={td}>{x.times}</td>
              <td style={{ ...td, color:RESULT_INFO.bonus_only.color, fontWeight:700 }}>{x.bonusOnly}</td><td style={td}>{x.deposited}</td>
              <td style={td}>{formatMoney(x.cost, x.currency)}</td><td style={td}>{x.last}</td>
            </tr>)}</tbody>
          </table></div>
        </div>
      )}

      {shown.length > 0 && (
        <div style={{ marginTop:18 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:8 }}>{L2('Every bonus', '全部记录')} ({shown.length})</div>
          <div style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['#', L2('Date', '日期'), L2('Player', '玩家'), L2('Tier', '等级'), L2('Stage', '阶段'), L2('Host', '负责人'), L2('Bonus', '奖金'), L2('Credited?', '已入账？'), L2('Result', '结果'), L2('First deposit', '首次存款'), L2('Deposit 7d', '7天存款'), L2('Deposit 30d', '30天存款'), L2('NGR 30d', '30天NGR'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{shown.map((r, i) => {
              const seen = num(r.bonus_seen) > 0
              return <tr key={r.id}>
                <td style={{ ...td, color:'var(--muted)', fontSize:12 }}>{i + 1}</td>
                <td style={{ ...td, whiteSpace:'nowrap' }}>{r.given_on}</td>
                <td style={td}><button style={{ background:'none', border:0, padding:0, cursor:r.vip_id ? 'pointer' : 'default', color:'var(--text)', fontWeight:700 }} onClick={() => r.vip_id && navigate(`/vips/${r.vip_id}`)}>{r.username}</button><CopyBtn text={r.username} />{names[r.username] && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{names[r.username]}</div>}</td>
                <td style={td}>{r.tier || '—'}</td>
                <td style={{ ...td, whiteSpace:'nowrap' }}>{r.stage === 'Dormant' ? L2('💤 Dormant', '💤 休眠') : L2('🔥 Churn', '🔥 流失')} <span style={{ color:'var(--muted)', fontSize:11 }}>{r.days_inactive ?? '?'}{L2('d', '天')}</span></td>
                <td style={td}>{r.host_name || '—'}</td>
                <td style={{ ...td, whiteSpace:'nowrap' }}><b>{formatMoney(r.amount, r.currency)}</b><div style={{ fontSize:11, color:'var(--muted)' }}>{L2(BONUS_TYPES[r.bonus_type]?.en, BONUS_TYPES[r.bonus_type]?.zh)}</div>{r.notes && <div style={{ fontSize:11, color:'var(--muted)', maxWidth:180 }}>{r.notes}</div>}</td>
                <td style={{ ...td, fontSize:12 }}>{seen ? <span style={{ color:'#3fb950' }}>✓ {formatMoney(r.bonus_seen, r.currency)}</span> : r.data_through > r.given_on ? <span style={{ color:'#d29922' }}>{L2('Not seen', '未看到')}</span> : <span style={{ color:'var(--muted)' }}>—</span>}</td>
                <td style={td}><Badge r={r.result} L2={L2} />{r.result === 'waiting' && <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{L2('until', '至')} {r.window_end}{num(r.bet_window) > 0 ? L2(' · playing', ' · 有投注') : ''}</div>}{r.stayed_active && <div style={{ fontSize:11, color:'#3fb950', marginTop:2 }}>🔁 {L2('Stayed active', '持续活跃')}</div>}</td>
                <td style={{ ...td, whiteSpace:'nowrap', fontSize:12 }}>{r.first_deposit_date ? <>{r.first_deposit_date}<div style={{ color:'var(--muted)', fontSize:11 }}>{L2(`after ${r.days_to_deposit} days`, `${r.days_to_deposit} 天后`)}</div></> : '—'}</td>
                <td style={td}>{num(r.deposit_window) ? formatMoney(r.deposit_window, r.currency) : '—'}</td>
                <td style={td}>{num(r.deposit_retain) ? formatMoney(r.deposit_retain, r.currency) : '—'}</td>
                <td style={{ ...td, color:ngrAfter(r) >= 0 ? '#3fb950' : '#f85149' }}>{formatMoney(ngrAfter(r), r.currency)}</td>
                <td style={td}>{isAdmin && <button style={{ ...btnSm, color:'#f85149' }} title={L2('Delete this record', '删除此记录')} onClick={() => remove(r)}>✕</button>}</td>
              </tr>
            })}</tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}
