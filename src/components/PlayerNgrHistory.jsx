// PlayerNgrHistory — VIP360 › Financial: this player's NGR month by month (formula in lib/playerNgr.js)
import { useEffect, useState } from 'react'
import { formatMoney } from '../lib/format'
import { fetchPlayerNgr } from '../lib/playerNgr'
import { useLanguage } from '../contexts/LanguageContext'

const th = { padding:'7px 10px', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'right', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }
const td = { padding:'8px 10px', borderBottom:'1px solid var(--border)', fontVariantNumeric:'tabular-nums', textAlign:'right', whiteSpace:'nowrap' }

export default function PlayerNgrHistory({ username, currency }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    setRows(null); setError(false)
    fetchPlayerNgr(username, currency || 'MYR').catch(() => fetchPlayerNgr(username, currency || 'MYR'))
      .then(r => { if (live) setRows(r) })
      .catch(e => { console.error('PlayerNgrHistory load error', e); if (live) setError(true) })
    return () => { live = false }
  }, [username, currency])

  const cur = currency || 'MYR'
  return <div style={{ marginBottom:20 }}>
    <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{L2('Personal NGR','个人 NGR')}</div>
    <div style={{ fontSize:12, color:'var(--muted)', margin:'2px 0 8px' }}>{L2('Player loss − bonus − rebate − offline spending. Campaign rewards not deducted.','玩家输额 − 奖励 − 返水 − 线下开支。活动奖励未扣除。')}</div>
    {error ? <div style={{ fontSize:13, color:'var(--muted)' }}>{L2('Could not load NGR.','无法载入 NGR。')}</div>
      : !rows ? <div style={{ fontSize:13, color:'var(--muted)' }}>{L2('Loading…','载入中…')}</div>
      : !rows.length ? <div style={{ fontSize:13, color:'var(--muted)' }}>{L2('No NGR data yet.','暂无 NGR 数据。')}</div>
      : <div style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead><tr>
          <th style={{ ...th, textAlign:'left' }}>{L2('Month','月份')}</th>
          <th style={th}>{L2('Player Win/Loss','玩家输赢')}</th>
          <th style={th}>{L2('Bonus','奖励')}</th>
          <th style={th}>{L2('Rebate','返水')}</th>
          <th style={th}>{L2('Offline Spend','线下开支')}</th>
          <th style={th}>{L2('NGR','NGR')}</th>
        </tr></thead>
        <tbody>{rows.map(r => <tr key={r.month}>
          <td style={{ ...td, textAlign:'left' }}>{r.month}{r.source === 'provider' && <span title={L2('From the back office provider report','来自后台供应商报告')} style={{ marginLeft:6, fontSize:10, color:'var(--muted)' }}>{L2('BO','后台')}</span>}</td>
          <td style={td}>{formatMoney(r.win_loss, cur)}</td>
          <td style={td}>{formatMoney(r.bonus - r.cancelled, cur)}</td>
          <td style={td}>{formatMoney(r.rebate, cur)}</td>
          <td style={td}>{r.offline > 0 ? formatMoney(r.offline, cur) : '—'}</td>
          <td style={{ ...td, fontWeight:800, color: r.ngr < 0 ? '#f85149' : r.ngr > 0 ? '#3fb950' : 'var(--muted)' }}>{formatMoney(r.ngr, cur)}</td>
        </tr>)}</tbody>
      </table></div>}
  </div>
}
