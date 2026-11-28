// src/components/campaign/CampaignSw2.jsx — 🆕 sureWin 2.0 rewards for a MY campaign (2026-11-28).
// 1.0 and 2.0 are counted SEPARATELY: 1.0 deposits give the 1.0 reward (the normal tabs),
// 2.0 deposits in the campaign dates give their own 2.0 reward, with the same reward levels.
// 1.0 15k + 2.0 15k is NOT 30k. A player who reaches a level on both gets both rewards.
// Data: sw2_daily (daily 2.0 files, matched to the 1.0 username). Paid marks: campaign_sw2_payouts.
// useSw2Campaign loads it once for the whole campaign popup; Sw2Stats / Sw2Mini show it next to the 1.0 numbers.
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../hooks/useAuth'
import { formatMoney } from '../../lib/format'
import { calcDualTierReward, calcReward } from '../../lib/campaignRewardCalc'
import CopyBtn from '../CopyBtn'

const CUR = 'MYR'
const n = v => Number(v || 0)
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const btn = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const chunks = (a, k = 150) => { const o = []; for (let i = 0; i < a.length; i += k) o.push(a.slice(i, i + k)); return o }
const useL2 = () => { const { lang } = useLanguage(); return (en, zh) => (lang === 'zh' ? zh : en) }
const Tag2 = () => <span style={{ fontSize: 9, fontWeight: 800, padding: '0 4px', borderRadius: 3, background: '#7c3aed', color: '#fff', marginRight: 4 }}>2.0</span>

// reward for one deposit / turnover amount, same rules as the 1.0 campaign
function rewardFor(c, dep, vb) {
  const type = c.campaign_type || 'gold_bar'
  if (type === 'dual_tier') {
    const r = calcDualTierReward(dep, vb, c.reward_tiers || [])
    return { reward: r.creditAmount + r.wcashAmount, level: r.tierIndex }
  }
  const target = n(c.deposit_target) || 50000
  if (type === 'tiered_reward') { const r = calcReward(type, dep, 0, 0, 0, c.reward_cap, c.reward_tiers || []); return { reward: r, level: r > 0 ? 0 : -1 } }
  if (dep < target) return { reward: 0, level: -1 }
  return { reward: calcReward(type, dep, c.reward_pct || 6, c.reward_fixed || 3000, c.gold_bar_value || 3400, c.reward_cap, c.reward_tiers || []), level: 0 }
}

// Shared 2.0 data for one campaign. Pass null to switch it off (non-MY campaigns).
export function useSw2Campaign(campaign) {
  const { profile } = useAuth()
  const [players, setPlayers] = useState([])
  const [days, setDays] = useState([])
  const [logins, setLogins] = useState({})
  const [paid, setPaid] = useState({})
  const [fileDays, setFileDays] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [reload, setReload] = useState(0)
  const on = !!campaign
  const cid = campaign?.id, cs = campaign?.start_date, ce = campaign?.end_date

  useEffect(() => {
    let off = false
    if (!cid || !cs || !ce) { setPlayers([]); setDays([]); setPaid({}); setLoading(false); return }
    ;(async () => {
      setLoading(true); setErr('')
      try {
        const { data: cp, error: e1 } = await supabase.from('campaign_players').select('username,player_name,tier,whatsapp').eq('campaign_id', cid).limit(5000)
        if (e1) throw e1
        const names = [...new Set((cp || []).map(p => p.username))]
        const rows = [], mem = {}
        for (const ch of chunks(names)) {
          const { data, error } = await supabase.from('sw2_daily').select('username,v1_username,snapshot_date,total_deposit,valid_bet')
            .in('v1_username', ch).gte('snapshot_date', cs).lte('snapshot_date', ce).limit(5000)
          if (error) throw error
          rows.push(...(data || []))
          const { data: m } = await supabase.from('sw2_members').select('v1_username,login').in('v1_username', ch)
          for (const r of m || []) mem[r.v1_username] = r.login
        }
        const { data: pd } = await supabase.from('campaign_sw2_payouts').select('*').eq('campaign_id', cid)
        const { data: fd } = await supabase.from('sw2_daily_days').select('snapshot_date').gte('snapshot_date', cs).lte('snapshot_date', ce)
        if (off) return
        setPlayers(cp || []); setDays(rows); setLogins(mem)
        setPaid(Object.fromEntries((pd || []).map(p => [p.username, p])))
        setFileDays((fd || []).map(d => d.snapshot_date).sort())
      } catch (e) { if (!off) setErr(e?.message || String(e)) }
      if (!off) setLoading(false)
    })()
    return () => { off = true }
  }, [cid, cs, ce, reload])

  const list = useMemo(() => {
    if (!campaign) return []
    const daily = campaign.campaign_type === 'dual_tier' && campaign.settlement_frequency === 'daily'
    const by = {}
    for (const r of days) (by[r.v1_username] ||= []).push(r)
    return players.map(p => {
      const ds = by[p.username] || []
      const dep = ds.reduce((s, r) => s + n(r.total_deposit), 0)
      const vb = ds.reduce((s, r) => s + n(r.valid_bet), 0)
      let reward = 0, level = -1
      if (daily) {
        // daily settlement: each day on its own
        for (const r of ds) { const x = rewardFor(campaign, n(r.total_deposit), n(r.valid_bet)); reward += x.reward; level = Math.max(level, x.level) }
      } else ({ reward, level } = rewardFor(campaign, dep, vb))
      return { ...p, login: logins[p.username] || null, dep, vb, reward, level, paid: paid[p.username] || null }
    }).sort((a, b) => b.reward - a.reward || b.dep - a.dep)
  }, [players, days, logins, paid, campaign])

  const byUser = useMemo(() => Object.fromEntries(list.map(r => [r.username, r])), [list])
  const joined = list.filter(r => r.login)
  const reached = list.filter(r => r.reward > 0)
  const totalReward = reached.reduce((s, r) => s + r.reward, 0)
  const totalDep = list.reduce((s, r) => s + r.dep, 0)
  const totalTo = list.reduce((s, r) => s + r.vb, 0)
  const paidList = list.filter(r => r.paid)
  const paidSum = paidList.reduce((s, r) => s + n(r.paid.reward), 0)
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const allDays = []
  if (on && cs && ce) for (let t = new Date(cs + 'T00:00:00Z'); t.toISOString().slice(0, 10) <= ce; t = new Date(t.getTime() + 86400000)) allDays.push(t.toISOString().slice(0, 10))
  const missing = allDays.filter(d => d < today && !fileDays.includes(d))

  const togglePaid = async (r, L2) => {
    setBusy(r.username)
    if (r.paid) {
      if (!window.confirm(L2(`Remove the 2.0 paid mark for ${r.username}?`, `取消 ${r.username} 的 2.0 已派彩标记？`))) { setBusy(''); return }
      const { error } = await supabase.from('campaign_sw2_payouts').delete().eq('campaign_id', cid).eq('username', r.username)
      if (error) alert(error.message)
      else setPaid(p => { const o = { ...p }; delete o[r.username]; return o })
    } else {
      const row = { campaign_id: cid, username: r.username, sw2_login: r.login, deposit: r.dep, valid_bet: r.vb, reward: r.reward,
        paid_at: new Date().toISOString(), paid_by: profile?.id, paid_by_name: profile?.full_name || null }
      const { error } = await supabase.from('campaign_sw2_payouts').upsert(row, { onConflict: 'campaign_id,username' })
      if (error) alert(error.message)
      else setPaid(p => ({ ...p, [r.username]: row }))
    }
    setBusy('')
  }

  return { on, loading, err, list, byUser, joined, reached, totalReward, totalDep, totalTo, paidList, paidSum, missing, busy, togglePaid,
    tiers: campaign?.reward_tiers || [], refresh: () => setReload(k => k + 1) }
}

// small "2.0" line under the 1.0 numbers. kind: 'dep' | 'depto' (deposit + turnover) | 'to' | 'reward'
export function Sw2Mini({ sw2, username, kind = 'dep' }) {
  const L2 = useL2()
  if (!sw2?.on || sw2.loading) return null
  const r = sw2.byUser[username]
  if (!r) return null
  const st = { fontSize: 10, marginTop: 4, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }
  if (!r.login) return <div style={st}><Tag2 />{L2('not joined', '未加入')}</div>
  if (kind === 'reward') return <div style={st}><Tag2 />{r.reward > 0
    ? <span style={{ color: '#a78bfa', fontWeight: 800 }}>{formatMoney(r.reward, CUR)}{r.paid ? L2(' ✅ paid', ' ✅ 已派') : L2(' pending', ' 待派')}</span>
    : '—'}</div>
  if (kind === 'prio') {
    // 2.0 progress, same idea as the 1.0 badge: achieved / close (70%+) / behind, toward the first level not reached yet
    const tiers = sw2.tiers || []
    const next = tiers.find(x => r.dep < n(x.depositThreshold))
    const first = n(tiers[0]?.depositThreshold)
    const pct = r.reward > 0 ? 100 : first ? Math.round(Math.min(1, r.dep / first) * 100) : 0
    const col = r.reward > 0 ? '#3fb950' : pct >= 70 ? '#d29922' : '#f85149'
    return <div style={{ ...st, color: col, fontWeight: 800 }}><Tag2 />{r.reward > 0
      ? (next ? L2(`✅ achieved · ${formatMoney(n(next.depositThreshold) - r.dep, CUR)} to next`, `✅ 已达标 · 差 ${formatMoney(n(next.depositThreshold) - r.dep, CUR)} 到下一级`) : L2('✅ achieved (top)', '✅ 已达标（最高）'))
      : !first ? "—" : `${pct >= 70 ? L2('⚡ close', '⚡ 接近') : L2('🔴 behind', '🔴 落后')} ${pct}%`}</div>
  }
  if (kind === 'to') return <div style={st}><Tag2 /><span style={{ color: 'var(--text)' }}>{formatMoney(r.vb, CUR)}</span></div>
  return <div style={st}><Tag2 /><span style={{ color: 'var(--text)' }}>{formatMoney(r.dep, CUR)}</span>{kind === 'depto' && <> · {formatMoney(r.vb, CUR)} {L2('TO', '流水')}</>}</div>
}

// 2.0 numbers in one row (top of the campaign popup, Summary tab)
export function Sw2Stats({ sw2, big }) {
  const L2 = useL2()
  if (!sw2?.on) return null
  if (sw2.loading) return <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('Loading sureWin 2.0…', '正在加载 sureWin 2.0…')}</div>
  if (sw2.err) return <div style={{ fontSize: 11, color: '#f85149' }}>2.0: {sw2.err}</div>
  const items = [
    [L2('Joined 2.0', '已加入 2.0'), `${sw2.joined.length}/${sw2.list.length}`, 'var(--text)'],
    [L2('Achieved', '达标'), sw2.reached.length, '#3fb950'],
    [L2('Total Dep', '总存款'), formatMoney(sw2.totalDep, CUR), '#3fb950'],
    [L2('Turnover', '流水'), formatMoney(sw2.totalTo, CUR), 'var(--accent)'],
    [L2('Total Reward', '总奖励'), formatMoney(sw2.totalReward, CUR), '#a78bfa'],
    [L2('Paid Out', '已派'), formatMoney(sw2.paidSum, CUR), '#3fb950'],
    [L2('Pending Pay', '待派'), formatMoney(Math.max(0, sw2.totalReward - sw2.paidSum), CUR), '#f85149'],
  ]
  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: big ? 12 : 11, fontWeight: 800, padding: '2px 8px', borderRadius: 5, background: '#7c3aed', color: '#fff' }}>🆕 sureWin 2.0</span>
      {items.map(([l, v, c]) => <div key={l}><div style={{ fontSize: big ? 18 : 15, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 10, color: 'var(--muted)' }}>{l}</div></div>)}
      {sw2.missing.length > 0 && <span style={{ fontSize: 11, color: '#d29922', fontWeight: 700 }}>{L2(`⚠ 2.0 daily file missing: ${sw2.missing.map(d => d.slice(5)).join(', ')} (counts as 0)`, `⚠ 缺少 2.0 每日文件：${sw2.missing.map(d => d.slice(5)).join('、')}（算 0）`)}</span>}
    </div>
  )
}

// 🆕 2.0 tab; with compact = only players who reached a 2.0 reward (inside the Payout tab)
export default function CampaignSw2({ campaign, sw2, compact }) {
  const L2 = useL2()
  const { profile } = useAuth()
  const canPay = ['admin', 'host'].includes(profile?.role)
  const [show, setShow] = useState('reached')
  if (!sw2?.on) return null
  const { loading, err, list, joined, reached, missing, busy, tiers } = sw2
  const togglePaid = r => sw2.togglePaid(r, L2)
  const shown = compact || show === 'reached' ? reached : show === 'joined' ? joined : show === 'notjoined' ? list.filter(r => !r.login) : list

  const levelName = i => (i < 0 ? '—' : campaign.campaign_type === 'dual_tier' && tiers[i] ? L2(`Level ${i + 1} (≥ ${formatMoney(n(tiers[i].depositThreshold), CUR)})`, `第 ${i + 1} 级（≥ ${formatMoney(n(tiers[i].depositThreshold), CUR)}）`) : L2('Reached', '达标'))

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(shown.map(r => ({
      [L2('1.0 username', '1.0 用户名')]: r.username, [L2('2.0 login', '2.0 账号')]: r.login || '', [L2('Name', '名字')]: r.player_name || '', Tier: r.tier,
      [L2('2.0 deposit', '2.0 存款')]: Math.round(r.dep), [L2('2.0 turnover', '2.0 流水')]: Math.round(r.vb), [L2('2.0 level', '2.0 等级')]: levelName(r.level),
      [L2('2.0 reward', '2.0 奖励')]: r.reward, [L2('Paid', '已派')]: r.paid ? String(r.paid.paid_at).slice(0, 10) : '',
    })))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '2.0')
    XLSX.writeFile(wb, `${campaign.campaign_code || 'campaign'}_sureWin2.0.xlsx`)
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--muted)' }}>{L2('Loading 2.0 data…', '正在加载 2.0 数据…')}</div>
  if (err) return <div style={{ padding: 24, color: '#f85149' }}>{err}</div>

  const opt = (k, label) => <button key={k} onClick={() => setShow(k)} style={{ ...btn, background: show === k ? 'var(--accent)' : 'var(--surface2)', color: show === k ? '#fff' : 'var(--text)' }}>{label}</button>

  return (
    <div style={{ padding: compact ? '16px 0 0' : '16px 24px' }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        🆕 <b>{compact ? L2(`sureWin 2.0 payout (${reached.length} rewards)`, `sureWin 2.0 派彩（${reached.length} 份奖励）`) : L2('sureWin 2.0 rewards, counted separately from 1.0', 'sureWin 2.0 奖励，和 1.0 分开计算')}</b>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        {L2('Only 2.0 deposits in the campaign dates count, with the same reward levels. 1.0 deposits give the 1.0 reward. 1.0 15k + 2.0 15k is not 30k. A player who reaches a level on both platforms gets both rewards.',
          '只算活动期间的 2.0 存款，奖励等级一样。1.0 存款算 1.0 奖励。1.0 15k + 2.0 15k 不等于 30k。两边都达标的玩家两边奖励都有。')}
      </div>
      {!compact && <div style={{ marginBottom: 14 }}><Sw2Stats sw2={sw2} big /></div>}
      {compact && missing.length > 0 && <div style={{ fontSize: 12, marginBottom: 10, color: '#d29922', fontWeight: 700 }}>{L2(`⚠ 2.0 daily file missing: ${missing.map(d => d.slice(5)).join(', ')}. Upload it on the sureWin 2.0 page, otherwise those days count as 0.`, `⚠ 缺少 2.0 每日文件：${missing.map(d => d.slice(5)).join('、')}。请在 sureWin 2.0 页面上传，否则那几天算 0。`)}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {!compact && <>
          {opt('reached', L2(`🎁 Reached (${reached.length})`, `🎁 已达标（${reached.length}）`))}
          {opt('joined', L2(`🆕 Joined 2.0 (${joined.length})`, `🆕 已加入 2.0（${joined.length}）`))}
          {opt('notjoined', L2(`⏳ Not on 2.0 (${list.length - joined.length})`, `⏳ 没有 2.0（${list.length - joined.length}）`))}
          {opt('all', L2(`All (${list.length})`, `全部（${list.length}）`))}
        </>}
        <button style={{ ...btn, marginLeft: 'auto' }} onClick={exportXlsx} disabled={!shown.length}>⬇ {L2('Download 2.0 (.xlsx)', '下载 2.0 (.xlsx)')}</button>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>{L2('Player (1.0)', '玩家（1.0）')}</th><th style={th}>{L2('2.0 login', '2.0 账号')}</th><th style={th}>{L2('Tier', '等级')}</th>
            <th style={th}>{L2('2.0 deposit', '2.0 存款')}</th><th style={th}>{L2('2.0 turnover', '2.0 流水')}</th><th style={th}>{L2('2.0 level', '2.0 等级')}</th>
            <th style={th}>{L2('2.0 reward', '2.0 奖励')}</th><th style={th}>{L2('2.0 payout', '2.0 派彩')}</th>
          </tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.username}>
                <td style={td}><b>{r.username}</b> <CopyBtn text={r.username} />{r.player_name && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.player_name}</div>}</td>
                <td style={td}>{r.login ? <>{r.login} <CopyBtn text={r.login} /></> : <span style={{ color: 'var(--muted)' }}>{L2('not joined', '未加入')}</span>}</td>
                <td style={td}>{r.tier}</td>
                <td style={td}>{formatMoney(r.dep, CUR)}</td>
                <td style={td}>{formatMoney(r.vb, CUR)}</td>
                <td style={td}>{levelName(r.level)}</td>
                <td style={{ ...td, fontWeight: 800, color: r.reward > 0 ? '#3fb950' : 'var(--muted)' }}>{r.reward > 0 ? formatMoney(r.reward, CUR) : '—'}</td>
                <td style={td}>
                  {r.paid
                    ? <span style={{ color: '#3fb950', fontWeight: 700 }}>✅ {formatMoney(n(r.paid.reward), CUR)} · {String(r.paid.paid_at).slice(0, 10)}{r.paid.paid_by_name ? ` · ${r.paid.paid_by_name}` : ''}
                        {canPay && <button style={{ ...btn, padding: '2px 8px', marginLeft: 6 }} disabled={busy === r.username} onClick={() => togglePaid(r)}>↩</button>}</span>
                    : r.reward > 0 && canPay
                      ? <button style={{ ...btn, background: '#238636', color: '#fff', border: 'none' }} disabled={busy === r.username} onClick={() => togglePaid(r)}>{L2('Mark 2.0 paid', '标记 2.0 已派')}</button>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  {r.paid && Math.round(n(r.paid.reward)) !== Math.round(r.reward) && <div style={{ fontSize: 11, color: '#d29922' }}>{L2(`⚠ now ${formatMoney(r.reward, CUR)} (new 2.0 data)`, `⚠ 现在是 ${formatMoney(r.reward, CUR)}（2.0 数据更新）`)}</div>}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td style={{ ...td, color: 'var(--muted)' }} colSpan={8}>{compact ? L2('No player reached a 2.0 reward yet.', '还没有玩家达到 2.0 奖励。') : L2('No players here.', '没有玩家。')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
