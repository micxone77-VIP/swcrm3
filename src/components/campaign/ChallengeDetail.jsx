// src/components/campaign/ChallengeDetail.jsx — detail / chase / payout page for a Challenge campaign
// (💝 Trust Credit 信任金 / 💰 Rebate Challenge 返水挑战). Progress is calculated automatically from
// vip_daily_snapshots (daily deposit + daily valid bet).
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { L } from '../../lib/campaignGuide'
import { fetchAll } from '../../lib/depositProfile'
import { parseManualUserIds } from '../../lib/campaignEnrollment'
import { defaultChallengeConfig, computeProgress, suggestForPlayer, periodDates, num, STATUS_STYLE, progressMessage, FLAG_LABEL } from '../../lib/challengeEngine'
import { CampaignInfoButton } from './CampaignGuide'
import { ChallengeRulesEditor, cleanChallengeConfig } from './ChallengeCreator'

const rm = v => 'RM ' + Math.round(num(v)).toLocaleString('en-MY')
const btn = { background: 'var(--accent)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 7, fontWeight: 700, cursor: 'pointer', fontSize: 12 }
const sec = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 7, fontWeight: 600, cursor: 'pointer', fontSize: 12 }
const input = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }
const card = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }

function Kpi({ label, value, sub, color }) {
  return <div style={card}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>{sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}</div>
}
function Pill({ color, children, onClick, title }) {
  return <span title={title} onClick={onClick} style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: `${color}22`, color, cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>{children}</span>
}

export default function ChallengeDetail({ campaign: initial, onClose, onChanged }) {
  const { lang } = useLanguage()
  const { profile } = useAuth()
  const T = (en, zh) => L(lang, en, zh)
  const [camp, setCamp] = useState(initial)
  const cfg = useMemo(() => ({ ...defaultChallengeConfig(camp.challenge_config?.mode || 'trust_credit'), ...(camp.challenge_config || {}) }), [camp])
  const trust = cfg.mode !== 'rebate'
  const dates = periodDates(camp.start_date, camp.end_date)

  const [players, setPlayers] = useState([])
  const [daily, setDaily] = useState({})    // username -> date -> row
  const [follow, setFollow] = useState({})  // username -> date -> row
  const [members, setMembers] = useState({})
  const [asOf, setAsOf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')

  const [hostF, setHostF] = useState('ALL')
  const [statF, setStatF] = useState('ALL')
  const [search, setSearch] = useState('')
  const [waLang, setWaLang] = useState(lang === 'zh' ? 'zh' : 'en')
  const [editRules, setEditRules] = useState(false)
  const [ruleDraft, setRuleDraft] = useState(cfg)
  const [addOpen, setAddOpen] = useState(false)
  const [addIds, setAddIds] = useState('')
  const [busy, setBusy] = useState(false)

  const flash = m => { setToast(m); setTimeout(() => setToast(''), 2200) }

  async function load() {
    setLoading(true); setErr('')
    try {
      const { data: last } = await supabase.from('vip_daily_snapshots').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1)
      const latest = last?.[0]?.snapshot_date || new Date().toISOString().slice(0, 10)
      setAsOf(latest)
      const ps = await fetchAll(() => supabase.from('campaign_players').select('*').eq('campaign_id', camp.id).order('username'))
      setPlayers(ps)
      const names = new Set(ps.map(p => p.username))
      const mem = await fetchAll(() => supabase.from('vip_members').select('id,username,full_name,tier,host_assigned,affiliate_login,phone,whatsapp,currency').order('username'))
      const mm = {}; mem.forEach(m => { if (names.has(m.username)) mm[m.username] = m }); setMembers(mm)

      const toMap = rows => {
        const out = {}
        rows.forEach(r => {
          if (!names.has(r.username)) return
          const ok = num(r.monthly_valid_bet) > 0
          ;(out[r.username] = out[r.username] || {})[r.snapshot_date] = {
            dep: ok ? num(r.total_deposit) : 0, wd: ok ? num(r.total_withdrawal) : 0, wl: ok ? num(r.win_loss) : 0, vb: Math.max(0, num(r.monthly_valid_bet)),
          }
        })
        return out
      }
      const sel = 'username,snapshot_date,total_deposit,total_withdrawal,win_loss,monthly_valid_bet'
      const rows = await fetchAll(() => supabase.from('vip_daily_snapshots').select(sel).gte('snapshot_date', camp.start_date).lte('snapshot_date', camp.end_date).order('snapshot_date').order('username'))
      setDaily(toMap(rows))
      if (latest > camp.end_date) {
        const fEnd = new Date(new Date(camp.end_date + 'T00:00:00Z').getTime() + num(cfg.followup_days || 30) * 86400000).toISOString().slice(0, 10)
        const frows = await fetchAll(() => supabase.from('vip_daily_snapshots').select(sel).gt('snapshot_date', camp.end_date).lte('snapshot_date', fEnd).order('snapshot_date').order('username'))
        setFollow(toMap(frows))
      } else setFollow({})
    } catch (e) { console.error('ChallengeDetail load', e); setErr(e.message || String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [camp.id])

  const rowsAll = useMemo(() => players.map(p => {
    const m = members[p.username] || {}
    const prog = computeProgress({ player: p, campaign: camp, cfg, dailyMap: daily[p.username] || {}, followMap: follow[p.username] || {}, asOf })
    return { ...p, m, prog }
  }), [players, members, daily, follow, camp, cfg, asOf])

  const hosts = useMemo(() => [...new Set(rowsAll.map(r => r.m.host_assigned).filter(Boolean))].sort(), [rowsAll])
  const rows = rowsAll.filter(r =>
    (hostF === 'ALL' || (hostF === '__none' ? !r.m.host_assigned : r.m.host_assigned === hostF)) &&
    (statF === 'ALL' || (statF === 'reached' ? r.prog.completed : statF === 'not' ? !r.prog.completed : statF === 'streak' ? r.prog.streakQualified : statF === 'credit_pending' ? (cfg.credit_enabled && r.ch_credit_status !== 'given') : statF === 'to_pay' ? ((r.prog.reward > 0 && r.payout_status !== 'paid') || (r.prog.streakBonus > 0 && r.streak_payout_status !== 'paid')) : true)) &&
    (!search || r.username.toLowerCase().includes(search.toLowerCase()) || (r.m.full_name || '').toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => b.prog.goalPct - a.prog.goalPct)

  const sum = useMemo(() => {
    const s = { n: rowsAll.length, creditGiven: 0, creditGivenN: 0, creditPlanned: 0, reached: 0, streak: 0, turnover: 0, deposit: 0, withdrawal: 0, reward: 0, streakBonus: 0, suggested: 0, follow: 0, cost: 0 }
    rowsAll.forEach(r => {
      if (cfg.credit_enabled) { s.creditPlanned += num(r.ch_credit); if (r.ch_credit_status === 'given') { s.creditGiven += num(r.ch_credit); s.creditGivenN++ } }
      if (r.prog.completed) { s.reached++; s.suggested += r.prog.suggestedReward }
      if (r.prog.streakQualified) s.streak++
      s.turnover += r.prog.turnover; s.deposit += r.prog.deposit; s.withdrawal += r.prog.withdrawal
      s.reward += r.prog.reward; s.streakBonus += r.prog.streakBonus; s.follow += r.prog.followDeposit; s.cost += r.prog.cost
    })
    return s
  }, [rowsAll, cfg])

  async function updatePlayer(id, patch, okMsg) {
    const { error } = await supabase.from('campaign_players').update(patch).eq('id', id)
    if (error) { flash(T('Save failed: ', '保存失败：') + error.message); return }
    setPlayers(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)))
    if (okMsg) flash(okMsg)
  }
  async function removePlayer(r) {
    if (!window.confirm(T(`Remove ${r.username} from this campaign?`, `确定将 ${r.username} 移出此活动？`))) return
    const { error } = await supabase.from('campaign_players').delete().eq('id', r.id)
    if (error) return flash(error.message)
    setPlayers(ps => ps.filter(p => p.id !== r.id))
  }
  async function saveStatus(status) {
    const { error } = await supabase.from('campaigns').update({ status }).eq('id', camp.id)
    if (error) return flash(error.message)
    setCamp(c => ({ ...c, status })); onChanged && onChanged()
  }
  async function saveRules() {
    const clean = cleanChallengeConfig(ruleDraft)
    const { error } = await supabase.from('campaigns').update({ challenge_config: clean }).eq('id', camp.id)
    if (error) return flash(error.message)
    setCamp(c => ({ ...c, challenge_config: clean })); setEditRules(false); flash(T('Rules saved', '规则已保存')); onChanged && onChanged()
  }
  async function deleteCampaign() {
    if (!window.confirm(T('Delete this campaign and all its players? This cannot be undone.', '确定删除此活动及所有玩家记录？此操作无法复原。'))) return
    const { error: e1 } = await supabase.from('campaign_players').delete().eq('campaign_id', camp.id)
    if (e1) return flash(e1.message)
    const { error: e2 } = await supabase.from('campaigns').delete().eq('id', camp.id)
    if (e2) return flash(e2.message)
    onChanged && onChanged(); onClose()
  }
  async function addPlayers() {
    const ids = parseManualUserIds(addIds)
    if (!ids.length) return
    setBusy(true)
    try {
      const lower = ids.map(x => x.toLowerCase())
      const mem = await fetchAll(() => supabase.from('vip_members').select('id,username,full_name,tier,phone,whatsapp,is_excluded').order('username'))
      const found = mem.filter(m => lower.includes(m.username.toLowerCase()) && !m.is_excluded)
      const st = await fetchAll(() => supabase.from('v_vip_recent_stats').select('*').order('username'))
      const sm = {}; st.forEach(r => { sm[r.username] = r })
      const now = new Date().toISOString()
      const recs = found.filter(m => !players.some(p => p.username === m.username)).map(m => {
        const sug = suggestForPlayer(sm[m.username], cfg, dates.length)
        return {
          campaign_id: camp.id, vip_id: m.id, username: m.username, tier: m.tier, player_name: m.full_name || null, whatsapp: m.whatsapp || m.phone || null,
          total_deposit: 0, campaign_period_deposit: 0, converted: false, payout_status: 'pending', streak_payout_status: 'pending', status: 'enrolled',
          enrollment_source: 'manual', added_at: now, enrolled_at: now,
          ch_credit: cfg.credit_enabled ? sug.credit : null, ch_credit_status: cfg.credit_enabled ? 'pending' : 'none',
          ch_target_turnover: sug.targetTurnover, ch_target_deposit: sug.targetDeposit,
          ch_baseline: { loss_30d: sug.loss30, avg_daily_turnover_30d: sug.avgDailyTurnover, flags: sug.flags, as_of: sm[m.username]?.data_as_of || null },
        }
      })
      if (recs.length) {
        const { error } = await supabase.from('campaign_players').upsert(recs, { onConflict: 'campaign_id,username' })
        if (error) throw error
      }
      const missing = lower.filter(id => !found.some(m => m.username.toLowerCase() === id))
      flash(T(`Added ${recs.length}`, `已加入 ${recs.length} 位`) + (missing.length ? T(` · not found: ${missing.join(', ')}`, ` · 找不到：${missing.join(', ')}`) : ''))
      setAddIds(''); setAddOpen(false); await load()
    } catch (e) { flash(e.message || String(e)) }
    setBusy(false)
  }

  function exportExcel() {
    const data = rowsAll.map(r => {
      const p = r.prog
      return {
        'VIP': r.username, 'Name': r.m.full_name || '', 'Tier': r.m.tier || r.tier || '', 'Host': r.m.host_assigned || '', 'Affiliate': r.m.affiliate_login || 'Direct',
        'Credit': cfg.credit_enabled ? num(r.ch_credit) : '', 'Credit Status': cfg.credit_enabled ? (r.ch_credit_status || 'pending') : '',
        'Turnover Target': p.targetTurnover, 'Turnover': Math.round(p.turnover), 'Turnover %': Math.round(p.toPct * 100),
        'Deposit Target': cfg.goal_metric !== 'turnover' ? p.targetDeposit : '', 'Deposit': Math.round(p.deposit), 'Withdrawal': Math.round(p.withdrawal),
        'Deposit Days (≥ min)': `${p.qualifiedDays}/${p.minDays}`, 'Status': STATUS_STYLE[p.status][lang === 'zh' ? 'zh' : 'en'],
        'Suggested Reward': p.completed ? p.suggestedReward : '', 'Reward': p.reward, 'Reward Payout': r.payout_status || 'pending',
        'Streak Bonus': p.streakBonus, 'Streak Payout': r.streak_payout_status || 'pending',
        'Total Cost': Math.round(p.cost), 'Net (Dep - WD - Cost)': Math.round(p.net), [`Deposit ${cfg.followup_days || 30}d after`]: Math.round(p.followDeposit),
        'Review Note': r.ch_review_note || '',
      }
    })
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!autofilter'] = { ref: ws['!ref'] }
    XLSX.utils.book_append_sheet(wb, ws, 'Players')
    XLSX.writeFile(wb, `${camp.campaign_code || 'challenge'}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const myName = profile?.full_name || ''
  const statusColor = { draft: '#8b949e', active: '#34d399', paused: '#fbbf24', ended: '#f87171' }[camp.status] || '#8b949e'
  const th = { textAlign: 'left', padding: '8px 8px', color: 'var(--muted)', fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }
  const td = { padding: '7px 8px', borderBottom: '1px solid var(--border)', fontSize: 12, verticalAlign: 'top' }
  const daysLeft = asOf ? Math.max(0, dates.filter(d => d > asOf).length) : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 1400, minHeight: '80vh' }}>
        {/* header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill color={trust ? '#f472b6' : '#22d3ee'}>{trust ? T('💝 Trust Credit Challenge', '💝 信任金挑战') : T('💰 Rebate Challenge', '💰 返水挑战')}</Pill>
              <CampaignInfoButton typeKey={trust ? 'challenge_trust' : 'challenge_rebate'} size={18} />
              <select value={camp.status} onChange={e => saveStatus(e.target.value)} style={{ ...input, color: statusColor, fontWeight: 700 }}>
                {['draft', 'active', 'paused', 'ended'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{camp.campaign_name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {camp.campaign_code} · {camp.start_date} → {camp.end_date} ({dates.length} {T('days', '天')})
              {asOf && <> · {T('Data up to', '数据截至')} <b style={{ color: 'var(--text)' }}>{asOf}</b>{daysLeft > 0 && <> · {T(`${daysLeft} day(s) left`, `剩余 ${daysLeft} 天`)}</>}</>}
            </div>
            <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text)' }}>
              {T('Goal', '目标')}: <b>{cfg.goal_metric === 'turnover' ? T('Turnover', '流水') : cfg.goal_metric === 'deposit' ? T('Deposit', '存款') : T('Deposit + Turnover', '存款 + 流水')}</b>
              {' · '}{T('Reward', '奖励')}: <b>{cfg.completion_type === 'review' ? T(`Review (suggest ${cfg.completion_pct}% of turnover)`, `审核（建议流水 ${cfg.completion_pct}%）`) : cfg.completion_type === 'rebate_pct' ? T(`${cfg.completion_pct}% rebate of turnover`, `流水 ${cfg.completion_pct}% 返水`) : cfg.completion_type === 'fixed' ? rm(cfg.completion_fixed) : T('None', '无')}</b>
              {num(cfg.completion_cap) > 0 && cfg.completion_type !== 'none' && <> ({T('cap', '上限')} {rm(cfg.completion_cap)})</>}
              {cfg.streak_enabled && <>{' · '}{T('Streak', '连续')}: <b>{T(`≥ ${rm(cfg.streak_min_daily_deposit)} on ${cfg.streak_min_days}/${dates.length} days → `, `${dates.length}天中${cfg.streak_min_days}天 ≥ ${rm(cfg.streak_min_daily_deposit)} → `)}{cfg.streak_bonus_type === 'pct' ? `${cfg.streak_bonus_pct}%` : rm(cfg.streak_bonus_fixed)}</b></>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={sec} onClick={() => { setRuleDraft(cfg); setEditRules(true) }}>⚙️ {T('Edit rules', '编辑规则')}</button>
            <button style={sec} onClick={() => setAddOpen(true)}>＋ {T('Add players', '加入玩家')}</button>
            <button style={sec} onClick={load}>↻ {T('Refresh', '刷新')}</button>
            <button style={btn} onClick={exportExcel}>⬇ {T('Export Excel', '导出Excel')}</button>
            <button style={{ ...sec, color: '#f87171' }} onClick={deleteCampaign}>{T('Delete', '删除')}</button>
            <button style={{ ...sec, fontSize: 16, padding: '4px 10px' }} onClick={onClose}>✕</button>
          </div>
        </div>

        {err && <div style={{ padding: 16, color: '#f87171' }}>{err}</div>}

        {/* KPIs */}
        <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Kpi label={T('Players', '玩家')} value={sum.n} />
          {cfg.credit_enabled && <Kpi label={T('Credit given', '已发信用额')} value={rm(sum.creditGiven)} sub={T(`${sum.creditGivenN}/${sum.n} players · planned ${rm(sum.creditPlanned)}`, `${sum.creditGivenN}/${sum.n} 位 · 计划 ${rm(sum.creditPlanned)}`)} color="#f472b6" />}
          <Kpi label={T('Target reached', '已达标')} value={`${sum.reached}/${sum.n}`} sub={sum.n ? `${Math.round(sum.reached / sum.n * 100)}%` : ''} color="#34d399" />
          {cfg.streak_enabled && <Kpi label={T('Streak qualified', '连续达标')} value={`${sum.streak}/${sum.n}`} color="#22d3ee" />}
          <Kpi label={T('Turnover', '流水')} value={rm(sum.turnover)} />
          <Kpi label={T('Deposit / Withdrawal', '存款 / 提款')} value={rm(sum.deposit)} sub={`${T('WD', '提款')} ${rm(sum.withdrawal)}`} />
          <Kpi label={T('Rewards (approved + streak)', '奖励（已批 + 连续）')} value={rm(sum.reward + sum.streakBonus)} sub={trust && cfg.completion_type === 'review' ? T(`Suggested for completers: ${rm(sum.suggested)}`, `完成者建议奖金：${rm(sum.suggested)}`) : ''} />
          <Kpi label={T('Net P&L', '净盈亏')} value={rm(sum.deposit - sum.withdrawal - sum.cost)} sub={T('Dep − WD − credit − rewards', '存款 − 提款 − 信用额 − 奖励')} color={sum.deposit - sum.withdrawal - sum.cost >= 0 ? '#34d399' : '#f87171'} />
          {asOf > camp.end_date && <Kpi label={T(`Deposits ${cfg.followup_days || 30}d after`, `结束后${cfg.followup_days || 30}天存款`)} value={rm(sum.follow)} sub={T('Did they come back?', '玩家是否回流？')} color="#a78bfa" />}
        </div>

        {/* filters */}
        <div style={{ padding: '0 20px 10px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={input} value={hostF} onChange={e => setHostF(e.target.value)}>
            <option value="ALL">{T('All hosts', '全部负责人')}</option><option value="__none">{T('(No host)', '（无负责人）')}</option>
            {hosts.map(h => <option key={h}>{h}</option>)}
          </select>
          <select style={input} value={statF} onChange={e => setStatF(e.target.value)}>
            <option value="ALL">{T('All players', '全部玩家')}</option>
            <option value="reached">{T('Target reached', '已达标')}</option>
            <option value="not">{T('Not reached yet', '未达标')}</option>
            {cfg.streak_enabled && <option value="streak">{T('Streak qualified', '连续达标')}</option>}
            {cfg.credit_enabled && <option value="credit_pending">{T('Credit not given yet', '信用额未发放')}</option>}
            <option value="to_pay">{T('Rewards to pay', '待派奖励')}</option>
          </select>
          <input style={{ ...input, width: 180 }} placeholder={T('Search VIP', '搜索VIP')} value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{rows.length} {T('shown', '位显示中')}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{T('WhatsApp language', 'WhatsApp 语言')}:</span>
          {[['en', 'EN'], ['zh', '中文']].map(([k, l]) => <button key={k} onClick={() => setWaLang(k)} style={{ ...sec, padding: '4px 10px', borderColor: waLang === k ? 'var(--accent)' : 'var(--border)', color: waLang === k ? 'var(--accent)' : 'var(--text)' }}>{l}</button>)}
        </div>

        {/* table */}
        <div style={{ overflow: 'auto', maxHeight: '62vh', borderTop: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>VIP</th>
              {cfg.credit_enabled && <th style={th}>{T('Credit', '信用额')}</th>}
              <th style={th}>{cfg.goal_metric === 'deposit' ? T('Deposit progress', '存款进度') : T('Turnover progress', '流水进度')}</th>
              {cfg.goal_metric === 'both' && <th style={th}>{T('Deposit progress', '存款进度')}</th>}
              <th style={th}>{T('Daily deposits', '每日存款')}</th>
              <th style={th}>{T('Status', '状态')}</th>
              {cfg.completion_type !== 'none' && <th style={th}>{T('Completion reward', '完成奖励')}</th>}
              {cfg.streak_enabled && <th style={th}>{T('Streak bonus', '连续奖励')}</th>}
              {asOf > camp.end_date && <th style={th}>{T('After campaign', '活动后')}</th>}
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--muted)' }}>{T('Loading…', '载入中…')}</td></tr>
                : rows.length === 0 ? <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: 30, color: 'var(--muted)' }}>{T('No players.', '没有玩家。')}</td></tr>
                : rows.map(r => {
                  const p = r.prog
                  const st = STATUS_STYLE[p.status]
                  const wa = (r.m.phone && r.m.phone.replace(/\D/g, '').length >= 10) ? r.m.phone : (r.whatsapp || r.m.whatsapp || '')
                  const waNum = String(wa || '').replace(/\D/g, '')
                  const msg = progressMessage({ lang: waLang, username: r.username, campaignName: camp.campaign_name, p, cfg, hostName: myName })
                  const flags = r.ch_baseline?.flags || []
                  const bar = (pct, color) => (
                    <div style={{ width: 150, height: 7, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
                      <div style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', background: color }} />
                    </div>
                  )
                  return (
                    <tr key={r.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.username}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.m.full_name} · {r.m.tier || r.tier} · {r.m.host_assigned || T('no host', '无负责人')}</div>
                        {flags.map(f => <div key={f} style={{ fontSize: 10, color: '#fbbf24' }}>⚠️ {FLAG_LABEL[f] ? FLAG_LABEL[f][lang === 'zh' ? 'zh' : 'en'] : f}</div>)}
                      </td>
                      {cfg.credit_enabled && <td style={td}>
                        <input type="number" defaultValue={r.ch_credit ?? ''} style={{ ...input, width: 90 }}
                          onBlur={e => { const v = e.target.value === '' ? null : num(e.target.value); if (v !== num(r.ch_credit)) updatePlayer(r.id, { ch_credit: v }, T('Saved', '已保存')) }} />
                        <div style={{ marginTop: 4 }}>
                          {r.ch_credit_status === 'given'
                            ? <Pill color="#34d399" title={T('Click to undo', '点击撤销')} onClick={() => updatePlayer(r.id, { ch_credit_status: 'pending' })}>✓ {T('Given', '已发放')}</Pill>
                            : <Pill color="#fbbf24" title={T('Click after giving the credit in BO', '在BO发放后点击')} onClick={() => updatePlayer(r.id, { ch_credit_status: 'given' }, T('Marked as given', '已标记发放'))}>{T('Mark given', '标记已发放')}</Pill>}
                        </div>
                      </td>}
                      <td style={td}>
                        {cfg.goal_metric === 'deposit'
                          ? <><div><b>{rm(p.deposit)}</b> / <input type="number" defaultValue={r.ch_target_deposit ?? p.targetDeposit} style={{ ...input, width: 100, padding: '2px 6px' }} onBlur={e => { const v = num(e.target.value); if (v !== num(r.ch_target_deposit)) updatePlayer(r.id, { ch_target_deposit: v }, T('Target saved', '目标已保存')) }} /></div>{bar(p.depPct, p.depPct >= 1 ? '#34d399' : 'var(--accent)')}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{Math.round(p.depPct * 100)}%</div></>
                          : <><div><b>{rm(p.turnover)}</b> / <input type="number" defaultValue={r.ch_target_turnover ?? p.targetTurnover} style={{ ...input, width: 110, padding: '2px 6px' }} onBlur={e => { const v = num(e.target.value); if (v !== num(r.ch_target_turnover)) updatePlayer(r.id, { ch_target_turnover: v }, T('Target saved', '目标已保存')) }} /></div>{bar(p.toPct, p.toPct >= 1 ? '#34d399' : 'var(--accent)')}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{Math.round(p.toPct * 100)}% · {T('need', '尚需')} {rm(Math.max(0, p.targetTurnover - p.turnover))}</div></>}
                      </td>
                      {cfg.goal_metric === 'both' && <td style={td}>
                        <div><b>{rm(p.deposit)}</b> / <input type="number" defaultValue={r.ch_target_deposit ?? p.targetDeposit} style={{ ...input, width: 100, padding: '2px 6px' }} onBlur={e => { const v = num(e.target.value); if (v !== num(r.ch_target_deposit)) updatePlayer(r.id, { ch_target_deposit: v }, T('Target saved', '目标已保存')) }} /></div>
                        {bar(p.depPct, p.depPct >= 1 ? '#34d399' : 'var(--accent)')}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{Math.round(p.depPct * 100)}%</div>
                      </td>}
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {p.dayList.map(d => (
                            <div key={d.date} title={`${d.date}: ${rm(d.dep)} · ${T('turnover', '流水')} ${rm(d.vb)}`}
                              style={{ width: 13, height: 13, borderRadius: 3, background: d.future ? 'transparent' : d.qualifies ? '#34d399' : d.dep > 0 ? '#fbbf24' : 'var(--surface2)', border: d.future ? '1px dashed var(--border)' : '1px solid var(--border)' }} />
                          ))}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{T(`${p.depositDays} deposit days · ${rm(p.deposit)}`, `${p.depositDays} 天有存款 · ${rm(p.deposit)}`)}</div>
                      </td>
                      <td style={td}><Pill color={st.color}>{st[lang === 'zh' ? 'zh' : 'en']}</Pill></td>
                      {cfg.completion_type !== 'none' && <td style={td}>
                        {!p.completed ? <span style={{ color: 'var(--muted)', fontSize: 11 }}>{T('Not reached', '未达标')}{p.suggestedReward > 0 && cfg.completion_type !== 'fixed' ? T(` (now ≈ ${rm(p.suggestedReward)})`, `（目前约 ${rm(p.suggestedReward)}）`) : ''}</span>
                          : cfg.completion_type === 'review' ? <>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{T('Suggested', '建议')}: <b style={{ color: 'var(--text)' }}>{rm(p.suggestedReward)}</b></div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                              <input type="number" placeholder={T('Approve', '批准金额')} defaultValue={r.ch_approved_bonus ?? ''} style={{ ...input, width: 90 }}
                                onBlur={e => { const v = e.target.value === '' ? null : num(e.target.value); if (v !== (r.ch_approved_bonus == null ? null : num(r.ch_approved_bonus))) updatePlayer(r.id, { ch_approved_bonus: v }, T('Bonus saved', '奖金已保存')) }} />
                              {r.ch_approved_bonus == null && <button style={{ ...sec, padding: '3px 8px' }} onClick={() => updatePlayer(r.id, { ch_approved_bonus: p.suggestedReward }, T('Suggested amount approved', '已批准建议金额'))}>{T('Use', '采用')}</button>}
                            </div>
                            <input placeholder={T('Review note', '审核备注')} defaultValue={r.ch_review_note || ''} style={{ ...input, width: 150, marginTop: 3 }}
                              onBlur={e => { if (e.target.value !== (r.ch_review_note || '')) updatePlayer(r.id, { ch_review_note: e.target.value }) }} />
                          </> : <div><b>{rm(p.reward)}</b></div>}
                        {p.completed && p.reward > 0 && <div style={{ marginTop: 4 }}>{r.payout_status === 'paid'
                          ? <Pill color="#34d399" onClick={() => updatePlayer(r.id, { payout_status: 'pending', payout_date: null })}>✓ {T('Paid', '已派')}</Pill>
                          : <Pill color="#fbbf24" onClick={() => updatePlayer(r.id, { payout_status: 'paid', payout_date: new Date().toISOString().slice(0, 10) }, T('Marked paid', '已标记派发'))}>{T('Mark paid', '标记已派')}</Pill>}</div>}
                      </td>}
                      {cfg.streak_enabled && <td style={td}>
                        <div style={{ fontWeight: 700, color: p.streakQualified ? '#34d399' : 'var(--text)' }}>{p.qualifiedDays}/{p.minDays} {T('days', '天')}</div>
                        {p.streakQualified ? <><div><b>{rm(p.streakBonus)}</b></div>
                          <div style={{ marginTop: 3 }}>{r.streak_payout_status === 'paid'
                            ? <Pill color="#34d399" onClick={() => updatePlayer(r.id, { streak_payout_status: 'pending', streak_payout_date: null })}>✓ {T('Paid', '已派')}</Pill>
                            : <Pill color="#fbbf24" onClick={() => updatePlayer(r.id, { streak_payout_status: 'paid', streak_payout_date: new Date().toISOString().slice(0, 10) }, T('Marked paid', '已标记派发'))}>{T('Mark paid', '标记已派')}</Pill>}</div></>
                          : <div style={{ fontSize: 10, color: p.streakPossible ? 'var(--muted)' : '#f87171' }}>{p.streakPossible ? T(`${p.minDays - p.qualifiedDays} more day(s) needed`, `还需 ${p.minDays - p.qualifiedDays} 天`) : T('No longer possible', '已无法达成')}</div>}
                      </td>}
                      {asOf > camp.end_date && <td style={td}><b>{rm(p.followDeposit)}</b><div style={{ fontSize: 10, color: 'var(--muted)' }}>{T(`${p.followDays} deposit days`, `${p.followDays} 天有存款`)}</div></td>}
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {waNum ? <a href={`https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" title={T('Send progress on WhatsApp', '用WhatsApp发送进度')}
                          style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 13, background: '#25D366', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>W</a> : null}
                        <button title={T('Copy progress message', '复制进度信息')} onClick={() => { navigator.clipboard.writeText(msg).then(() => flash(T('Message copied', '信息已复制'))).catch(() => {}) }} style={{ ...sec, padding: '3px 7px', marginLeft: 4 }}>📋</button>
                        <button title={T('Remove', '移除')} onClick={() => removePlayer(r)} style={{ ...sec, padding: '3px 7px', marginLeft: 4, color: '#f87171' }}>✕</button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 20px', fontSize: 11, color: 'var(--muted)' }}>
          {T('Turnover and deposits are read automatically from the daily platform data (days with valid bet only). Daily boxes: green = deposit ≥ streak minimum, yellow = smaller deposit, grey = none, dashed = future.',
             '流水与存款自动读取每日平台数据（只计算有有效投注的日子）。每日格子：绿色 = 存款 ≥ 连续奖励门槛，黄色 = 存款较少，灰色 = 无存款，虚线 = 未来日期。')}
        </div>
      </div>

      {/* edit rules modal */}
      {editRules && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && setEditRules(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 900 }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>⚙️ {T('Edit rules', '编辑规则')}</div>
            <ChallengeRulesEditor cfg={ruleDraft} setCfg={setRuleDraft} days={dates.length} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>{T('Rewards and streak are recalculated instantly for all players. Personal targets and credit amounts are not changed.', '所有玩家的奖励与连续奖励会立即重新计算。个人目标与信用额不会被更改。')}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button style={sec} onClick={() => setEditRules(false)}>{T('Cancel', '取消')}</button>
              <button style={btn} onClick={saveRules}>{T('Save rules', '保存规则')}</button>
            </div>
          </div>
        </div>
      )}

      {/* add players modal */}
      {addOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && setAddOpen(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 520 }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>＋ {T('Add players', '加入玩家')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{T('Paste user IDs. Credit and target are suggested from their last 30 days — edit them in the table afterwards.', '贴上用户ID。信用额与目标会按近30天数据建议，之后可在表格中修改。')}</div>
            <textarea value={addIds} onChange={e => setAddIds(e.target.value)} style={{ ...input, width: '100%', minHeight: 100, fontFamily: 'inherit' }} placeholder={T('One per line or comma-separated', '每行一个或用逗号分隔')} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button style={sec} onClick={() => setAddOpen(false)}>{T('Cancel', '取消')}</button>
              <button style={btn} disabled={busy} onClick={addPlayers}>{busy ? '…' : T('Add', '加入')}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#111f30', border: '1px solid var(--accent)', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 13, zIndex: 1400 }}>{toast}</div>}
    </div>
  )
}
