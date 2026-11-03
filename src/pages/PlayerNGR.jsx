// PlayerNGR — personal NGR per player per month (formula + sources in lib/playerNgr.js)
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { formatMoney } from '../lib/format'
import { fetchMonthNgr, fetchNgrMonths } from '../lib/playerNgr'
import { ListCount } from '../components/ui'
import CopyBtn from '../components/CopyBtn'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamBool } from '../hooks/useUrlParam'

const TIER_ORDER = ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE']
const TIER_ZH = { BLACK:'黑金', 'DIAMOND-P':'钻石P', DIAMOND:'钻石', PLATINUM:'白金', GOLD:'黄金', SILVER:'白银', BRONZE:'青铜' }
const MARKETS = [['ALL', 'All', '全部', null], ['MY', 'MY', 'MY', 'MYR'], ['SG', 'SG', 'SG', 'SGD'], ['KH', 'KH', 'KH', 'KHUSD']]
const GOOD = '#3fb950', BAD = '#f85149'

const SORT = {
  username: { get:r=>r.username.toLowerCase(), first:'asc' },
  tier: { get:r=>TIER_ORDER.indexOf(r.tier), first:'asc' },
  host: { get:r=>String(r.host||'').toLowerCase(), first:'asc' },
  bet: { get:r=>r.bet, first:'desc' },
  win_loss: { get:r=>r.win_loss, first:'asc' },
  bonus: { get:r=>r.bonus-r.cancelled, first:'desc' },
  rebate: { get:r=>r.rebate, first:'desc' },
  offline: { get:r=>r.offline, first:'desc' },
  ngr: { get:r=>r.ngr, first:'desc' },
}

const s = {
  page: { padding:'28px 32px' },
  title: { fontSize:26, fontWeight:800, color:'var(--text)' },
  sub: { fontSize:14, color:'var(--muted)', marginTop:4 },
  card: { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' },
  stat: { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 18px', minWidth:230, flex:'1 1 230px' },
  tbl: { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th: { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td: { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  num: { fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap', textAlign:'right' },
  btnSm: { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer' },
  sel: { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:8, fontSize:13, outline:'none' },
}

export default function PlayerNGR() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const myName = profile?.full_name || ''
  const [monthF, setMonthF] = useUrlParam('month', '')
  const [mktF, setMktF] = useUrlParam('mkt', 'ALL')
  const [tierF, setTierF] = useUrlParam('tier', 'ALL')
  const [hostF, setHostF] = useUrlParam('host', 'ALL')
  const [search, setSearch] = useUrlParam('q', '')
  const [sortF, setSortF] = useUrlParam('sort', 'ngr:desc')
  const [mineOnly, setMineOnly] = useUrlParamBool('mine', false)
  const [months, setMonths] = useState([])
  const [latest, setLatest] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  // A month still running is not a fair default, so open on the last finished one
  const month = monthF || months[1] || months[0] || ''

  useEffect(() => {
    let live = true
    fetchNgrMonths()
      .then(r => { if (live) { setMonths(r.months); setLatest(r.latest); if (!r.months.length) setLoading(false) } })
      .catch(e => { console.error('PlayerNGR months error', e); if (live) { setError(true); setLoading(false) } })
    return () => { live = false }
  }, [reload])

  useEffect(() => {
    if (!month) return undefined
    let live = true
    setLoading(true); setError(false)
    // The Gold+ views can take 3-6s (limit 8s), so try once more before giving up
    fetchMonthNgr(month).catch(() => fetchMonthNgr(month))
      .then(r => { if (live) setData(r) })
      .catch(e => { console.error('PlayerNGR load error', e); if (live) { setError(true); setData(null) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [month, reload])

  const allRows = useMemo(() => data?.rows || [], [data])
  const hosts = useMemo(() => [...new Set(allRows.filter(r => r.host).map(r => r.host))].sort(), [allRows])
  const tiers = useMemo(() => TIER_ORDER.filter(x => allRows.some(r => r.tier === x)), [allRows])
  const cur = MARKETS.find(m => m[0] === mktF)?.[3] || null
  const q = search.trim().toLowerCase()
  const rows = allRows.filter(r => (!cur || r.currency === cur) && (tierF === 'ALL' || r.tier === tierF) && (hostF === 'ALL' || r.host === hostF) && (!mineOnly || r.host === myName) && (!q || r.username.toLowerCase().includes(q)))
  const [sortKey, sortDir] = sortF.split(':')
  if (SORT[sortKey]) { const get = SORT[sortKey].get, dir = sortDir === 'desc' ? -1 : 1; rows.sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * dir }) }
  const clickSort = k => setSortF(`${k}:${sortKey === k ? (sortDir === 'desc' ? 'asc' : 'desc') : SORT[k].first}`)

  // Totals per currency: MYR and SGD are never added together
  const totals = Object.values(rows.reduce((m, r) => {
    const t = m[r.currency] || (m[r.currency] = { currency: r.currency, ngr: 0, before: 0, offline: 0, plus: 0, minus: 0 })
    t.ngr += r.ngr; t.before += r.ngr_before_spend; t.offline += r.offline
    if (r.ngr > 0) t.plus++; else if (r.ngr < 0) t.minus++
    return m
  }, {})).sort((a, b) => a.currency.localeCompare(b.currency))
  const gapCount = rows.filter(r => r.gap).length
  const isPartial = latest && month === latest.slice(0, 7)
  const ngrColor = n => (n < 0 ? BAD : n > 0 ? GOOD : 'var(--muted)')

  const heads = [['#'], [L2('Player','玩家'),'username'], [L2('Tier','等级'),'tier'], [L2('Host','负责人'),'host'], [L2('Valid Bet','有效投注'),'bet',1], [L2('Player Win/Loss','玩家输赢'),'win_loss',1], [L2('Bonus','奖励'),'bonus',1], [L2('Rebate','返水'),'rebate',1], [L2('Offline Spend','线下开支'),'offline',1], [L2('NGR','NGR'),'ngr',1], ['']]

  return <div style={s.page}>
    <div style={s.title}>{L2('Player NGR','玩家 NGR')}</div>
    <div style={s.sub}>{L2('NGR = player loss − bonus − rebate − offline spending','NGR = 玩家输额 − 奖励 − 返水 − 线下开支')}</div>

    <div style={{display:'flex',gap:12,flexWrap:'wrap',margin:'18px 0'}}>
      {totals.map(t => <div key={t.currency} style={s.stat}>
        <div style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase'}}>{L2('Total NGR','NGR 总计')} ({t.currency})</div>
        <div style={{fontSize:26,fontWeight:800,color:ngrColor(t.ngr),marginTop:4}}>{formatMoney(t.ngr,t.currency)}</div>
        <div style={{fontSize:12,color:'var(--muted)',marginTop:4}}>{L2('Before offline','线下开支前')} {formatMoney(t.before,t.currency)} − {L2('offline','线下')} {formatMoney(t.offline,t.currency)}</div>
        <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}><span style={{color:GOOD}}>{t.plus} {L2('positive','正数')}</span> · <span style={{color:BAD}}>{t.minus} {L2('negative','负数')}</span></div>
      </div>)}
    </div>

    <div style={s.card}>
      <div style={{display:'flex',gap:8,padding:12,borderBottom:'1px solid var(--border)',alignItems:'center',flexWrap:'wrap'}}>
        <select aria-label={L2('Month','月份')} style={s.sel} value={month} onChange={e=>setMonthF(e.target.value)}>{months.map(m=><option key={m} value={m}>{m}</option>)}</select>
        <select aria-label={L2('Tier','等级')} style={s.sel} value={tierF} onChange={e=>setTierF(e.target.value)}><option value="ALL">{L2('All Tiers','全部等级')}</option>{tiers.map(x=><option key={x} value={x}>{L2(x,TIER_ZH[x]||x)}</option>)}</select>
        <select aria-label={L2('Host','负责人')} style={s.sel} value={hostF} onChange={e=>setHostF(e.target.value)}><option value="ALL">{L2('All hosts','全部负责人')}</option>{hosts.map(h=><option key={h} value={h}>{h}</option>)}</select>
        <input aria-label={L2('Search player','搜索玩家')} placeholder={L2('Search player','搜索玩家')} style={{...s.sel,width:170}} value={search} onChange={e=>setSearch(e.target.value)}/>
        <label style={{display:'flex',gap:6,fontSize:12,alignItems:'center',color:'var(--text)',cursor:'pointer'}}><input type="checkbox" checked={mineOnly} onChange={e=>setMineOnly(e.target.checked)}/>{L2('Mine only','仅我的')}</label>
        <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
          <span style={{fontSize:12,color:'var(--muted)',fontWeight:600}}>{L2('Market:','市场：')}</span>
          {MARKETS.map(([k,en,zh])=><button key={k} style={{...s.btnSm,background:mktF===k?'var(--accent)':'var(--surface2)',color:mktF===k?'#fff':'var(--text)'}} onClick={()=>setMktF(k)}>{L2(en,zh)}</button>)}
        </div>
      </div>

      <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontSize:12,color:'var(--muted)',lineHeight:1.6}}>
        {data&&(data.providerWhole
          ? L2(`${month}: figures from the back office provider report (full month).`,`${month}：数据来自后台供应商报告（整月）。`)
          : L2(`${month}: figures from the daily import${isPartial?`, up to ${latest}, month not finished`:''}. No full-month provider report, so some bets may be missing.`,`${month}：数据来自每日导入${isPartial?`，截至 ${latest}，本月未结束`:''}。没有整月供应商报告，可能缺少部分投注。`))}
        {' '}{L2('Online expenses, campaign rewards and company fees are not deducted.','线上开支、活动奖励和公司费用未扣除。')}
        {gapCount>0&&<span style={{color:'#d29922'}}> {L2(`⚠ ${gapCount} player(s): the daily import shows a different win/loss.`,`⚠ ${gapCount} 位玩家：每日导入的输赢不同。`)}</span>}
      </div>

      {error ? <div style={{padding:30,color:'var(--text)'}}>{L2('Could not load NGR.','无法载入 NGR。')} <button style={s.btnSm} onClick={()=>setReload(n=>n+1)}>{L2('Try again','重试')}</button></div>
        : loading ? <div style={{padding:30,color:'var(--text)'}}>{L2('Loading…','载入中…')}</div>
        : <>
          <ListCount total={rows.length} label="VIPs" labelZh="位VIP" />
          <div style={{overflowX:'auto'}}><table style={s.tbl}>
            <thead><tr>{heads.map(([h,k,right],i)=>{const on=k&&sortKey===k;return<th key={i} style={{...s.th,...(right?{textAlign:'right'}:{}),...(k?{cursor:'pointer',userSelect:'none'}:{}),...(on?{color:'var(--accent)'}:{})}} title={k?L2('Click to sort, click again to reverse','点击排序，再点一次反向'):undefined} onClick={k?()=>clickSort(k):undefined}>{h}{k&&<span style={{marginLeft:4,opacity:on?1:.4}}>{on?(sortDir==='desc'?'▼':'▲'):'↕'}</span>}</th>})}</tr></thead>
            <tbody>{rows.map((r,i)=><tr key={r.username}>
              <td style={{...s.td,color:'var(--muted)',fontSize:12,width:36}}>{i+1}</td>
              <td style={s.td}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><button style={{background:'none',border:0,padding:0,cursor:'pointer',color:'var(--text)',fontWeight:700}} onClick={()=>navigate(`/vips/${r.id}`)}>{r.username}</button><CopyBtn text={r.username} /></span></td>
              <td style={s.td}>{L2(r.tier,TIER_ZH[r.tier]||r.tier)}</td>
              <td style={s.td}>{r.host||'—'}</td>
              <td style={{...s.td,...s.num}}>{formatMoney(r.bet,r.currency)}</td>
              <td style={{...s.td,...s.num}} title={r.gap?L2(`Daily import: ${formatMoney(r.dailyWinLoss,r.currency)}`,`每日导入：${formatMoney(r.dailyWinLoss,r.currency)}`):undefined}>{formatMoney(r.win_loss,r.currency)}{r.gap&&<span style={{color:'#d29922',marginLeft:4}}>⚠</span>}</td>
              <td style={{...s.td,...s.num}}>{formatMoney(r.bonus-r.cancelled,r.currency)}</td>
              <td style={{...s.td,...s.num}}>{formatMoney(r.rebate,r.currency)}</td>
              <td style={{...s.td,...s.num}}>{r.offline>0?formatMoney(r.offline,r.currency):'—'}{r.spendOtherCurrency&&<span title={L2('Has spending in another currency, not deducted','有其他货币的开支，未扣除')} style={{color:'#d29922',marginLeft:4}}>⚠</span>}</td>
              <td style={{...s.td,...s.num,fontWeight:800,color:ngrColor(r.ngr)}}>{formatMoney(r.ngr,r.currency)}</td>
              <td style={s.td}><button style={s.btnSm} onClick={()=>navigate(`/vips/${r.id}`)}>{L2('Open','打开')}</button></td>
            </tr>)}{!rows.length&&<tr><td colSpan={heads.length} style={{...s.td,textAlign:'center',color:'var(--muted)'}}>{L2('No players match these filters.','没有符合筛选条件的玩家。')}</td></tr>}</tbody>
          </table></div>
        </>}
    </div>
  </div>
}
