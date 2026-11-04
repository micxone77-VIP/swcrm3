// MonthlyKpiBoard — the 4 monthly VIP KPIs at the top of the KPI page (definitions in lib/monthlyKpi.js)
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatMoney } from '../lib/format'
import { loadKpiRules, loadNgrKpi, loadRecovered, loadRetention, loadUpgrades } from '../lib/monthlyKpi'
import { useLanguage } from '../contexts/LanguageContext'
import CopyBtn from './CopyBtn'

const WEIGHT = { retention: 20, ngr: 20, recovered: 30, upgrades: 30 }
const GOOD = '#3fb950', BAD = '#f85149', WARN = '#d29922'
const card = { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, marginBottom:16, overflow:'hidden' }
const row = { padding:'16px 20px', borderBottom:'1px solid var(--border)' }
const chip = on => ({ padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, background:on?GOOD:'transparent', color:on?'#fff':'var(--muted)', border:on?'none':'1px solid var(--border)' })
const linkBtn = { background:'none', border:0, padding:0, color:'var(--accent)', cursor:'pointer', fontSize:12, fontWeight:600 }
const th = { padding:'6px 10px', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }
const td = { padding:'6px 10px', borderBottom:'1px solid var(--border)', fontSize:12, whiteSpace:'nowrap' }

const scoreOf = (actual, target) => (target ? Math.min(1, actual / target) : null)

function PlayerList({ heads, rows, render, navigate }) {
  return <div style={{ overflowX:'auto', marginTop:10, maxHeight:320, overflowY:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}>
    <thead><tr>{heads.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
    <tbody>{rows.map(r => <tr key={r.username + (r.to || '')}>
      <td style={td}><span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>{r.id ? <button style={{ background:'none', border:0, padding:0, cursor:'pointer', color:'var(--text)', fontWeight:700, fontSize:12 }} onClick={() => navigate(`/vips/${r.id}`)}>{r.username}</button> : <strong>{r.username}</strong>}<CopyBtn text={r.username} /></span></td>
      {render(r).map((c, i) => <td key={i} style={td}>{c}</td>)}
    </tr>)}</tbody>
  </table></div>
}

export default function MonthlyKpiBoard({ month }) {
  const navigate = useNavigate()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [state, setState] = useState({})
  const [rules, setRules] = useState(null)
  const [open, setOpen] = useState(null)
  const [reload, setReload] = useState(0)

  // One at a time: these reads are heavy and each has an 8s limit
  useEffect(() => {
    let live = true
    setState({}); setOpen(null)
    const run = async () => {
      let r = rules
      try { r = await loadKpiRules(); if (live) setRules(r) } catch (e) { console.error('KPI rules error', e); r = r || { churnDays: 7, targets: { retention: 85, recovered: null, upgrades: 4, ngr: {} } }; if (live) setRules(r) }
      const steps = [['retention', () => loadRetention(month)], ['recovered', () => loadRecovered(month, r.churnDays)], ['upgrades', () => loadUpgrades(month)], ['ngr', () => loadNgrKpi(month)]]
      for (const [k, f] of steps) {
        if (!live) return
        try { const data = await f(); if (live) setState(s => ({ ...s, [k]: { data } })) }
        catch (e) { console.error(`KPI ${k} error`, e); if (live) setState(s => ({ ...s, [k]: { error: true } })) }
      }
    }
    run()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, reload])

  const targets = rules?.targets || {}
  const thisMonth = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
  const unfinished = month >= thisMonth
  const ret = state.retention?.data, rec = state.recovered?.data, upg = state.upgrades?.data, ngr = state.ngr?.data

  // Only ① and ③ count for now, and only once they have a target. Scaled to 100.
  const scored = [
    state.retention ? { rate: scoreOf(ret?.pct ?? 0, targets.retention), weight: WEIGHT.retention } : null,
    state.recovered ? { rate: scoreOf(rec?.count ?? 0, targets.recovered), weight: WEIGHT.recovered } : null,
  ].filter(v => v && v.rate !== null)
  const total = scored.length ? Math.round(scored.reduce((a, v) => a + v.rate * v.weight, 0) / scored.reduce((a, v) => a + v.weight, 0) * 1000) / 10 : null

  const value = (s, render) => (!s ? <span style={{ color:'var(--muted)', fontSize:14 }}>{L2('Loading…','载入中…')}</span>
    : s.error ? <span style={{ color:BAD, fontSize:13 }}>{L2('Could not load.','无法载入。')} <button style={linkBtn} onClick={() => setReload(n => n + 1)}>{L2('Try again','重试')}</button></span>
    : s.data === null ? <span style={{ color:'var(--muted)', fontSize:14 }}>{L2('No data for this month','本月没有数据')}</span>
    : render(s.data))
  const status = (actual, target) => (target == null ? <span style={{ color:WARN }}>{L2('Target not set','未设目标')}</span>
    : actual >= target ? <span style={{ color:GOOD }}>✅ {L2('Met','达标')}</span> : <span style={{ color:BAD }}>❌ {L2('Missed','未达')}</span>)
  const big = { fontSize:24, fontWeight:800, color:'var(--text)' }
  const small = { fontSize:12, color:'var(--muted)', marginTop:4, lineHeight:1.5 }

  const Item = ({ n, title, weight, on, how, val, foot, listKey, listLabel, list }) => <div style={row}>
    <div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
      <div style={{ flex:'1 1 320px', minWidth:0 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontSize:15, fontWeight:700, color:'var(--text)' }}>{n} {title}</span>
          <span style={{ fontSize:12, color:'var(--accent)', fontWeight:700 }}>[{weight}%]</span>
          <span style={chip(on)}>{on ? L2('Scored','计分') : L2('Not scored yet','未定/不计分')}</span>
        </div>
        <div style={small}>{how}</div>
        {foot && <div style={small}>{foot}</div>}
        {listKey && <button style={{ ...linkBtn, marginTop:6 }} onClick={() => setOpen(open === listKey ? null : listKey)}>{open === listKey ? L2('Hide players','隐藏玩家') : listLabel}</button>}
      </div>
      <div style={{ textAlign:'right' }}>{val}</div>
    </div>
    {listKey && open === listKey && list}
  </div>

  const money = (n, c) => formatMoney(n, c)
  const ngrPart = c => { const t = targets.ngr?.[c.currency]; return t == null ? '' : ` · ${L2('target','目标')} ${money(t, c.currency)}` }

  return <div style={card}>
    <div style={{ padding:'14px 20px', borderBottom:'2px solid var(--accent)', display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'center' }}>
      <div>
        <div style={{ fontSize:14, fontWeight:800, color:'var(--accent)' }}>{L2(`VIP Monthly KPI · ${month}`,`VIP 月度 KPI · ${month}`)}</div>
        <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{L2('Platinum, Diamond and Black only. Calculated automatically from CRM data.','只计 Platinum、Diamond 和 Black。由 CRM 数据自动计算。')}{unfinished ? ' ' + L2('Month not finished, numbers will still move.','本月未结束，数字还会变动。') : ''}</div>
      </div>
      <div style={{ textAlign:'right' }}>
        <div style={{ fontSize:11, color:'var(--muted)' }}>{L2('Score','得分')}</div>
        <div style={{ fontSize:24, fontWeight:800, color: total == null ? 'var(--muted)' : total >= 85 ? GOOD : total >= 60 ? WARN : BAD }}>{total == null ? '—' : total}<span style={{ fontSize:12, color:'var(--muted)', fontWeight:600 }}> / 100</span></div>
        {rules && targets.recovered == null && <div style={{ fontSize:11, color:WARN }}>{L2('Only ① counted: ③ needs a target','只计 ①：③ 需要目标')}</div>}
      </div>
    </div>

    <Item n="①" title={L2('VIP monthly retention','VIP 月留存率')} weight={WEIGHT.retention} on
      how={L2('Platinum, Diamond and Black who deposited last month and deposited again this month.','上月有存款的 Platinum、Diamond 和 Black 玩家，本月再次存款。')}
      val={value(state.retention, d => <><div style={big}>{d.pct}%</div><div style={small}>{d.kept} / {d.base} · {L2('target','目标')} {targets.retention}% · {status(d.pct, targets.retention)}</div><div style={small}>{d.byCur.map(c => `${c.currency} ${c.kept}/${c.base}`).join(' · ')}</div></>)}
      listKey={ret?.lost?.length ? 'lost' : null} listLabel={L2(`See ${ret?.lost?.length || 0} who did not deposit again`,`查看 ${ret?.lost?.length || 0} 位未再存款的玩家`)}
      list={ret && <PlayerList navigate={navigate} heads={[L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Deposit last month','上月存款')]} rows={ret.lost} render={r => [r.tier, r.host || '—', money(r.lastDeposit, r.currency)]} />} />

    <Item n="②" title={L2('VIP monthly NGR total','VIP 月 NGR 总额')} weight={WEIGHT.ngr} on={false}
      how={L2('Player loss − bonus − rebate − offline spending. MYR and SGD are kept separate.','玩家输额 − 奖励 − 返水 − 线下开支。MYR 和 SGD 分开计算。')}
      foot={ngr && !ngr.providerWhole ? L2('From the daily import: no full-month provider report yet, so some bets may be missing.','来自每日导入：尚无整月供应商报告，可能缺少部分投注。') : null}
      val={value(state.ngr, d => <>{d.byCur.map(c => <div key={c.currency} style={{ marginBottom:4 }}><div style={{ ...big, color: c.ngr < 0 ? BAD : GOOD }}>{money(c.ngr, c.currency)}</div><div style={small}>{c.currency} · {c.players} {L2('players','位玩家')}{ngrPart(c)}</div></div>)}<button style={linkBtn} onClick={() => navigate(`/player-ngr?month=${month}`)}>{L2('Open Player NGR','打开玩家 NGR')}</button></>)} />

    <Item n="③" title={L2('Churned VIPs recovered','流失 VIP 挽回数')} weight={WEIGHT.recovered} on
      how={L2(`No deposit for ${rules?.churnDays ?? 7}+ days, deposited again this month, and a host contacted them in the 14 days before.`,`${rules?.churnDays ?? 7} 天以上未存款，本月再次存款，且负责人在此前 14 天内联系过。`)}
      foot={rec ? L2(`${rec.cameBack} came back in total. Those without contact are not counted.`,`共 ${rec.cameBack} 位回来，没有联系记录的不计入。`) : null}
      val={value(state.recovered, d => <><div style={big}>{d.count}</div><div style={small}>{status(d.count, targets.recovered)}{targets.recovered != null ? ` · ${L2('target','目标')} ${targets.recovered}` : ''}</div><div style={small}>{d.byCur.map(c => `${c.currency} ${c.count}`).join(' · ')}</div></>)}
      listKey={rec?.players?.length ? 'recovered' : null} listLabel={L2(`See ${rec?.players?.length || 0} recovered players`,`查看 ${rec?.players?.length || 0} 位挽回玩家`)}
      list={rec && <PlayerList navigate={navigate} heads={[L2('Player','玩家'),L2('Tier','等级'),L2('Host','负责人'),L2('Days away','离开天数'),L2('Contacted','联系日期'),L2('Deposited','存款日期')]} rows={rec.players} render={r => [r.tier, r.host || '—', r.gap == null ? `${rules?.churnDays ?? 7}+` : r.gap, r.contactedOn, r.backOn]} />} />

    <Item n="④" title={L2('Newly upgraded VIPs','新晋升 VIP 数')} weight={WEIGHT.upgrades} on={false}
      how={L2('Tier moved up, counted in the month of the betting that earned it (recorded the month after).','等级上升，计入达成投注的月份（下个月才记录）。')}
      foot={unfinished ? L2('Upgrades for this month appear after it ends.','本月的升级要到月底后才出现。') : null}
      val={value(state.upgrades, d => <><div style={big}>{d.vipToVip.length}</div><div style={small}>{L2('VIP to VIP','VIP 升 VIP')} · {L2('target','目标')} {targets.upgrades} · {status(d.vipToVip.length, targets.upgrades)}</div><div style={small}>{L2(`+ ${d.newToVip.length} new into VIP`,`+ ${d.newToVip.length} 位新进 VIP`)}</div></>)}
      listKey={upg && upg.vipToVip.length + upg.newToVip.length ? 'upgrades' : null} listLabel={L2(`See ${upg ? upg.vipToVip.length + upg.newToVip.length : 0} upgraded players`,`查看 ${upg ? upg.vipToVip.length + upg.newToVip.length : 0} 位升级玩家`)}
      list={upg && <PlayerList navigate={navigate} heads={[L2('Player','玩家'),L2('Host','负责人'),L2('From','从'),L2('To','到'),L2('Recorded','记录日期')]} rows={[...upg.vipToVip, ...upg.newToVip]} render={r => [r.host || '—', r.from, r.to, r.recordedOn]} />} />
  </div>
}
