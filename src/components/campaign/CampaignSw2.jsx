// src/components/campaign/CampaignSw2.jsx — 🆕 sureWin 2.0 rewards for a MY campaign (2026-11-28).
// 1.0 and 2.0 are counted SEPARATELY: 1.0 deposits give the 1.0 reward (the normal tabs),
// 2.0 deposits in the campaign dates give their own 2.0 reward here, with the same reward levels.
// 1.0 15k + 2.0 15k is NOT 30k. A player who reaches a level on both gets both rewards.
// Data: sw2_daily (daily 2.0 files, matched to the 1.0 username). Paid marks: campaign_sw2_payouts.
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

export default function CampaignSw2({ campaign }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const { profile } = useAuth()
  const canPay = ['admin', 'host'].includes(profile?.role)
  const [players, setPlayers] = useState([])
  const [days, setDays] = useState([])
  const [logins, setLogins] = useState({})
  const [paid, setPaid] = useState({})
  const [fileDays, setFileDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [show, setShow] = useState('reached')
  const [busy, setBusy] = useState('')

  const daily = campaign.campaign_type === 'dual_tier' && campaign.settlement_frequency === 'daily'
  const tiers = campaign.reward_tiers || []

  useEffect(() => {
    let off = false
    ;(async () => {
      setLoading(true); setErr('')
      try {
        const { data: cp, error: e1 } = await supabase.from('campaign_players').select('username,player_name,tier,whatsapp').eq('campaign_id', campaign.id).limit(5000)
        if (e1) throw e1
        const names = [...new Set((cp || []).map(p => p.username))]
        const rows = [], mem = {}
        for (const ch of chunks(names)) {
          const { data, error } = await supabase.from('sw2_daily').select('username,v1_username,snapshot_date,total_deposit,valid_bet')
            .in('v1_username', ch).gte('snapshot_date', campaign.start_date).lte('snapshot_date', campaign.end_date).limit(5000)
          if (error) throw error
          rows.push(...(data || []))
          const { data: m } = await supabase.from('sw2_members').select('v1_username,login').in('v1_username', ch)
          for (const r of m || []) mem[r.v1_username] = r.login
        }
        const { data: pd } = await supabase.from('campaign_sw2_payouts').select('*').eq('campaign_id', campaign.id)
        const { data: fd } = await supabase.from('sw2_daily_days').select('snapshot_date').gte('snapshot_date', campaign.start_date).lte('snapshot_date', campaign.end_date)
        if (off) return
        setPlayers(cp || []); setDays(rows); setLogins(mem)
        setPaid(Object.fromEntries((pd || []).map(p => [p.username, p])))
        setFileDays((fd || []).map(d => d.snapshot_date).sort())
      } catch (e) { if (!off) setErr(e?.message || String(e)) }
      if (!off) setLoading(false)
    })()
    return () => { off = true }
  }, [campaign.id, campaign.start_date, campaign.end_date])

  const list = useMemo(() => {
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
  }, [players, days, logins, paid, campaign, daily])

  const joined = list.filter(r => r.login)
  const reached = list.filter(r => r.reward > 0)
  const totalReward = reached.reduce((s, r) => s + r.reward, 0)
  const paidList = list.filter(r => r.paid)
  const paidSum = paidList.reduce((s, r) => s + n(r.paid.reward), 0)
  const shown = show === 'reached' ? reached : show === 'joined' ? joined : show === 'notjoined' ? list.filter(r => !r.login) : list

  const levelName = i => (i < 0 ? '—' : campaign.campaign_type === 'dual_tier' && tiers[i] ? L2(`Level ${i + 1} (≥ ${formatMoney(n(tiers[i].depositThreshold), CUR)})`, `第 ${i + 1} 级（≥ ${formatMoney(n(tiers[i].depositThreshold), CUR)}）`) : L2('Reached', '达标'))

  const togglePaid = async r => {
    setBusy(r.username)
    if (r.paid) {
      if (!window.confirm(L2(`Remove the 2.0 paid mark for ${r.username}?`, `取消 ${r.username} 的 2.0 已派彩标记？`))) { setBusy(''); return }
      const { error } = await supabase.from('campaign_sw2_payouts').delete().eq('campaign_id', campaign.id).eq('username', r.username)
      if (error) alert(error.message)
      else setPaid(p => { const o = { ...p }; delete o[r.username]; return o })
    } else {
      const row = { campaign_id: campaign.id, username: r.username, sw2_login: r.login, deposit: r.dep, valid_bet: r.vb, reward: r.reward,
        paid_at: new Date().toISOString(), paid_by: profile?.id, paid_by_name: profile?.full_name || null }
      const { error } = await supabase.from('campaign_sw2_payouts').upsert(row, { onConflict: 'campaign_id,username' })
      if (error) alert(error.message)
      else setPaid(p => ({ ...p, [r.username]: row }))
    }
    setBusy('')
  }

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

  // which campaign days have a 2.0 daily file
  const allDays = []
  for (let t = new Date(campaign.start_date + 'T00:00:00Z'); t.toISOString().slice(0, 10) <= campaign.end_date; t = new Date(t.getTime() + 86400000)) allDays.push(t.toISOString().slice(0, 10))
  const missing = allDays.filter(d => !fileDays.includes(d))
  const box = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', minWidth: 150 }
  const opt = (k, label) => <button key={k} onClick={() => setShow(k)} style={{ ...btn, background: show === k ? 'var(--accent)' : 'var(--surface2)', color: show === k ? '#fff' : 'var(--text)' }}>{label}</button>

  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        🆕 <b>{L2('sureWin 2.0 rewards, counted separately from 1.0', 'sureWin 2.0 奖励，和 1.0 分开计算')}</b>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        {L2('Only 2.0 deposits in the campaign dates count here, with the same reward levels. 1.0 deposits give the 1.0 reward in the other tabs. 1.0 15k + 2.0 15k is not 30k. A player who reaches a level on both platforms gets both rewards.',
          '这里只算活动期间的 2.0 存款，奖励等级一样。1.0 存款在其他页签算 1.0 奖励。1.0 15k + 2.0 15k 不等于 30k。两边都达标的玩家两边奖励都有。')}
      </div>
      <div style={{ fontSize: 12, marginBottom: 12, color: missing.length ? '#d29922' : '#3fb950', fontWeight: 700 }}>
        {missing.length
          ? L2(`⚠ 2.0 daily file missing for: ${missing.map(d => d.slice(5)).join(', ')}. Upload it on the sureWin 2.0 page, otherwise those days count as 0.`, `⚠ 缺少 2.0 每日文件：${missing.map(d => d.slice(5)).join('、')}。请在 sureWin 2.0 页面上传，否则那几天算 0。`)
          : L2('✅ 2.0 daily files uploaded for every campaign day.', '✅ 活动每天的 2.0 每日文件都已上传。')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={box}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('Players in campaign', '活动玩家')}</div><div style={{ fontSize: 20, fontWeight: 800 }}>{list.length}</div></div>
        <div style={box}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('Joined 2.0', '已加入 2.0')}</div><div style={{ fontSize: 20, fontWeight: 800 }}>{joined.length}</div></div>
        <div style={box}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('2.0 deposit (campaign dates)', '2.0 存款（活动期间）')}</div><div style={{ fontSize: 20, fontWeight: 800 }}>{formatMoney(list.reduce((s, r) => s + r.dep, 0), CUR)}</div></div>
        <div style={box}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('Reached a 2.0 reward', '达到 2.0 奖励')}</div><div style={{ fontSize: 20, fontWeight: 800, color: '#3fb950' }}>{reached.length}</div><div style={{ fontSize: 11 }}>{formatMoney(totalReward, CUR)}</div></div>
        <div style={box}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('2.0 paid', '2.0 已派')}</div><div style={{ fontSize: 20, fontWeight: 800 }}>{paidList.length}</div><div style={{ fontSize: 11 }}>{formatMoney(paidSum, CUR)}</div></div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {opt('reached', L2(`🎁 Reached (${reached.length})`, `🎁 已达标（${reached.length}）`))}
        {opt('joined', L2(`🆕 Joined 2.0 (${joined.length})`, `🆕 已加入 2.0（${joined.length}）`))}
        {opt('notjoined', L2(`⏳ Not on 2.0 (${list.length - joined.length})`, `⏳ 没有 2.0（${list.length - joined.length}）`))}
        {opt('all', L2(`All (${list.length})`, `全部（${list.length}）`))}
        <button style={{ ...btn, marginLeft: 'auto' }} onClick={exportXlsx} disabled={!shown.length}>⬇ {L2('Download (.xlsx)', '下载 (.xlsx)')}</button>
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
            {!shown.length && <tr><td style={{ ...td, color: 'var(--muted)' }} colSpan={8}>{L2('No players here.', '没有玩家。')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
