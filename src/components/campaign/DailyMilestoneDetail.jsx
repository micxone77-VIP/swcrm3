// src/components/campaign/DailyMilestoneDetail.jsx — detail page for a ⚡ Daily Milestone campaign
// (daily turnover tiers → Credit paid next day + N-day streak bonus). Data is T-1 (yesterday).
// Tabs: 📣 Today's follow-up · 💰 Payout (per settled day) · 📅 Daily grid · ⚙️ Rules & messages
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { L } from '../../lib/campaignGuide'
import { fetchAll } from '../../lib/depositProfile'
import { parseManualUserIds } from '../../lib/campaignEnrollment'
import { num } from '../../lib/challengeEngine'
import { loadWinLossSettings } from '../../lib/bigWinLoss'
import { defaultDailyConfig, computeDaily, GROUPS, fillMessage, sortedTiers } from '../../lib/dailyMilestone'
import { DailyRulesEditor, cleanDailyConfig } from './DailyRulesEditor'

const fmt = v => Math.round(num(v)).toLocaleString('en-MY')
const sym = c => (c === 'SGD' ? 'SGD ' : c === 'KHUSD' ? 'USD ' : 'RM ')
const btn = { background: 'var(--accent)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 7, fontWeight: 700, cursor: 'pointer', fontSize: 12 }
const sec = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 7, fontWeight: 600, cursor: 'pointer', fontSize: 12 }
const input = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }
const card = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }
const th = { textAlign: 'left', padding: '7px 8px', color: 'var(--muted)', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }
const td = { padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 12 }

function Kpi({ label, value, sub, color }) {
  return <div style={card}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>{sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}</div>
}

export default function DailyMilestoneDetail({ campaign: initial, onClose, onChanged }) {
  const { lang } = useLanguage()
  const { profile } = useAuth()
  const T = (en, zh) => L(lang, en, zh)
  const myName = profile?.full_name || ''
  const [camp, setCamp] = useState(initial)
  const cfg = useMemo(() => ({ ...defaultDailyConfig(), ...(camp.challenge_config || {}) }), [camp])

  const [players, setPlayers] = useState([])
  const [members, setMembers] = useState({})
  const [daily, setDaily] = useState({})
  const [asOf, setAsOf] = useState(null)
  const [wlCfg, setWlCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState('follow')
  const [hostF, setHostF] = useState(null)
  const [groupF, setGroupF] = useState('ALL')
  const [search, setSearch] = useState('')
  const [waLang, setWaLang] = useState(lang === 'zh' ? 'zh' : 'en')
  const [payDay, setPayDay] = useState(null)
  const [draft, setDraft] = useState(cfg)
  const [addIds, setAddIds] = useState('')
  const flash = m => { setToast(m); setTimeout(() => setToast(''), 2200) }

  async function load() {
    setLoading(true); setErr('')
    try {
      const { data: last } = await supabase.from('vip_daily_snapshots').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1)
      const latest = last?.[0]?.snapshot_date || null
      setAsOf(latest)
      const ps = await fetchAll(() => supabase.from('campaign_players').select('*').eq('campaign_id', camp.id).order('username'))
      setPlayers(ps)
      const names = new Set(ps.map(p => p.username))
      const mem = await fetchAll(() => supabase.from('vip_members').select('id,username,full_name,tier,host_assigned,affiliate_login,phone,whatsapp,currency').order('username'))
      const mm = {}; mem.forEach(m => { if (names.has(m.username)) mm[m.username] = m }); setMembers(mm)
      const rows = await fetchAll(() => supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit,win_loss,monthly_valid_bet')
        .gte('snapshot_date', camp.start_date).lte('snapshot_date', camp.end_date).order('snapshot_date').order('username'))
      const out = {}
      rows.forEach(r => {
        if (!names.has(r.username)) return
        const ok = num(r.monthly_valid_bet) > 0
        ;(out[r.username] = out[r.username] || {})[r.snapshot_date] = { vb: Math.max(0, num(r.monthly_valid_bet)), dep: ok ? num(r.total_deposit) : 0, wl: ok ? num(r.win_loss) : 0 }
      })
      setDaily(out)
      setWlCfg(await loadWinLossSettings().catch(() => null))
      const hosts = new Set(Object.values(mm).map(m => m.host_assigned).filter(Boolean))
      setHostF(h => h ?? (hosts.has(myName) ? myName : 'ALL'))
    } catch (e) { console.error('DailyMilestoneDetail load', e); setErr(e.message || String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [camp.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const started = asOf && asOf >= camp.start_date
  const rowsAll = useMemo(() => players.map(p => {
    const m = members[p.username] || {}
    const prog = computeDaily({ campaign: camp, cfg, dailyMap: daily[p.username] || {}, asOf })
    let group = prog.group
    // big loss yesterday → care only (don't push)
    if (wlCfg && prog.last) {
      const th = wlCfg.tiers?.[String(m.tier || p.tier || '').toUpperCase()]
      const fx = num(wlCfg.fx_to_myr?.[String(m.currency || 'MYR').toUpperCase()] || 1) || 1
      if (th && num(th.loss) > 0 && prog.last.wl * fx <= -num(th.loss)) group = 'care'
    }
    return { ...p, m, prog, group }
  }), [players, members, daily, camp, cfg, asOf, wlCfg])

  const summary = useMemo(() => {
    const s = { asOf, winners: 0, topReward: 0, credit: 0, streak: 0, turnover: 0, deposit: 0, yCredit: 0, yStreak: 0, byGroup: {} }
    rowsAll.forEach(r => {
      const l = r.prog.last
      if (l && l.reward > 0) { s.winners++; s.topReward = Math.max(s.topReward, l.reward) }
      if (l) { s.yCredit += l.reward; s.yStreak += l.streakBonus }
      s.credit += r.prog.credit; s.streak += r.prog.streak; s.turnover += r.prog.turnover; s.deposit += r.prog.deposit
      s.byGroup[r.group] = (s.byGroup[r.group] || 0) + 1
    })
    return s
  }, [rowsAll, asOf])

  const hosts = useMemo(() => [...new Set(rowsAll.map(r => r.m.host_assigned).filter(Boolean))].sort(), [rowsAll])
  const scoped = rowsAll.filter(r => !hostF || hostF === 'ALL' || (r.m.host_assigned || '') === hostF)
    .filter(r => !search || r.username.toLowerCase().includes(search.toLowerCase()) || (r.m.full_name || '').toLowerCase().includes(search.toLowerCase()))
  const groupCounts = {}; scoped.forEach(r => { groupCounts[r.group] = (groupCounts[r.group] || 0) + 1 })
  const ORDER = ['streak', 'near', 'won', 'idle', 'care']
  const followRows = scoped.filter(r => groupF === 'ALL' || r.group === groupF)
    .sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || num(b.prog.last?.vb) - num(a.prog.last?.vb))

  const msgFor = (r, group) => fillMessage({ group, lang: waLang, cfg, campaign: camp, prog: r.prog, username: r.username, agent: myName, summary, currency: r.m.currency })
  function openWa(r, group) {
    const num_ = String(r.m.whatsapp || r.m.phone || r.whatsapp || '').replace(/\D/g, '')
    const text = msgFor(r, group)
    if (!num_) { navigator.clipboard.writeText(text); return flash(T('No phone — message copied', '没有电话 — 已复制信息')) }
    window.open(`https://wa.me/${num_}?text=${encodeURIComponent(text)}`, '_blank')
  }
  function copyMsg(r, group) { navigator.clipboard.writeText(msgFor(r, group)); flash(T('Copied', '已复制')) }

  // ── payout (per settled day) ──
  const pastDays = rowsAll[0]?.prog.days.filter(d => !d.future).map(d => d.date) || []
  const settle = payDay || pastDays[pastDays.length - 1] || null
  const payRows = settle ? rowsAll.map(r => ({ r, d: r.prog.days.find(x => x.date === settle) })).filter(x => x.d && (x.d.reward > 0 || x.d.streakBonus > 0))
    .sort((a, b) => (b.d.reward + b.d.streakBonus) - (a.d.reward + a.d.streakBonus)) : []
  async function markPaid(r, key, val) {
    const paid = { ...(r.ch_paid || {}) }
    paid[settle] = { ...(paid[settle] || {}), [key]: val, at: new Date().toISOString(), by: myName }
    const { error } = await supabase.from('campaign_players').update({ ch_paid: paid }).eq('id', r.id)
    if (error) return flash(error.message)
    setPlayers(ps => ps.map(p => (p.id === r.id ? { ...p, ch_paid: paid } : p)))
  }
  async function markAllPaid() {
    for (const { r, d } of payRows) {
      const cur = (r.ch_paid || {})[settle] || {}
      if ((d.reward > 0 && !cur.c) || (d.streakBonus > 0 && !cur.s)) {
        const paid = { ...(r.ch_paid || {}), [settle]: { ...cur, c: d.reward > 0 ? true : cur.c, s: d.streakBonus > 0 ? true : cur.s, at: new Date().toISOString(), by: myName } }
        const { error } = await supabase.from('campaign_players').update({ ch_paid: paid }).eq('id', r.id)
        if (error) return flash(error.message)
        r.ch_paid = paid
      }
    }
    setPlayers(ps => [...ps]); flash(T('All marked paid', '已全部标记派发'))
  }
  function exportPay() {
    const data = payRows.map(({ r, d }, i) => ({
      '#': i + 1, Username: r.username, Name: r.m.full_name || '', Tier: r.m.tier || r.tier || '', Currency: r.m.currency || 'MYR', Host: r.m.host_assigned || '',
      'Settled day': settle, Turnover: Math.round(d.vb), Deposit: Math.round(d.dep), 'Tier reward (Credit)': d.reward,
      [`Streak bonus (${cfg.streak_pct}% of ${cfg.streak_days}-day deposit)`]: d.streakBonus, 'Streak base deposit': Math.round(d.streakBase), Total: d.reward + d.streakBonus,
      'Credit paid': (r.ch_paid?.[settle]?.c) ? 'Y' : '', 'Streak paid': (r.ch_paid?.[settle]?.s) ? 'Y' : '',
    }))
    const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Payout')
    XLSX.writeFile(wb, `${camp.campaign_code || 'campaign'}_payout_${settle}.xlsx`)
  }

  async function saveRules() {
    const clean = cleanDailyConfig(draft)
    const { error } = await supabase.from('campaigns').update({ challenge_config: clean }).eq('id', camp.id)
    if (error) return flash(error.message)
    setCamp(c => ({ ...c, challenge_config: clean })); onChanged && onChanged(); flash(T('Saved', '已保存'))
  }
  async function addPlayers() {
    const ids = parseManualUserIds(addIds).map(x => x.toLowerCase())
    if (!ids.length) return
    const all = await fetchAll(() => supabase.from('vip_members').select('id,username,full_name,tier,phone,whatsapp').order('username'))
    const found = all.filter(m => ids.includes(m.username.toLowerCase()) && !players.some(p => p.username === m.username))
    if (!found.length) return flash(T('No new players found', '没有可加入的新玩家'))
    const now = new Date().toISOString()
    const { error } = await supabase.from('campaign_players').upsert(found.map(m => ({
      campaign_id: camp.id, vip_id: m.id, username: m.username, tier: m.tier, player_name: m.full_name || null, whatsapp: m.whatsapp || m.phone || null,
      total_deposit: 0, campaign_period_deposit: 0, converted: false, payout_status: 'pending', streak_payout_status: 'pending', status: 'enrolled',
      enrollment_source: 'manual', added_at: now, enrolled_at: now, ch_credit_status: 'none',
    })), { onConflict: 'campaign_id,username' })
    if (error) return flash(error.message)
    setAddIds(''); flash(T(`Added ${found.length}`, `已加入 ${found.length} 位`)); load()
  }
  async function removePlayer(r) {
    if (!window.confirm(T(`Remove ${r.username}?`, `确定移出 ${r.username}？`))) return
    const { error } = await supabase.from('campaign_players').delete().eq('id', r.id)
    if (error) return flash(error.message)
    setPlayers(ps => ps.filter(p => p.id !== r.id))
  }

  const tiers = sortedTiers(cfg)
  const dates = rowsAll[0]?.prog.days.map(d => d.date) || []
  const tabBtn = k => ({ ...sec, background: tab === k ? 'var(--accent)' : 'var(--surface2)', color: tab === k ? '#fff' : 'var(--text)', fontWeight: 700 })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 1200, overflow: 'auto', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 26 }}>⚡</div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{camp.campaign_name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {T('Daily Milestone', '每日流水里程碑')} · {camp.start_date} → {camp.end_date} · {players.length} {T('players', '位玩家')} · {camp.status}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {tiers.map(t => <span key={t.turnover} style={{ marginRight: 10 }}>{fmt(t.turnover)} → <b>{fmt(t.reward)}</b></span>)}
              {cfg.streak_enabled && <span style={{ color: '#f97316' }}>🔥 {cfg.streak_days}{T('-day streak', '天连续')} = {cfg.streak_pct}% {T('of deposits', '存款')} ({cfg.streak_style === 'rolling' ? T('rolling', '滚动') : T('every block', '每轮')}{num(cfg.streak_cap) > 0 ? `, cap ${fmt(cfg.streak_cap)}` : ''})</span>}
            </div>
          </div>
          <button style={sec} onClick={load}>{T('🔄 Refresh', '🔄 刷新')}</button>
          <button style={sec} onClick={onClose}>✕ {T('Close', '关闭')}</button>
        </div>

        {/* data date banner */}
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(88,166,255,.10)', border: '1px solid rgba(88,166,255,.3)', fontSize: 12 }}>
          📅 {T('Data up to', '数据截至')} <b>{asOf || '—'}</b> {T('(yesterday). Each day is settled the next day: today you pay yesterday\'s rewards and send today\'s follow-up.', '（昨天）。每天隔天结算：今天派发昨天的奖励，并发送今天的跟进信息。')}
          {!started && <span style={{ color: '#fbbf24' }}> {T('Campaign has not started yet — use the 📣 Intro message to announce it.', '活动尚未开始 — 可用 📣 活动介绍 信息先通知玩家。')}</span>}
        </div>

        {err && <div style={{ color: '#f87171', marginTop: 10 }}>{err}</div>}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{T('Loading…', '载入中…')}</div> : <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 12 }}>
            <Kpi label={T(`Qualified on ${asOf || '—'}`, `${asOf || '—'} 达标人数`)} value={`${summary.winners} / ${players.length}`} color="#3fb950" sub={T(`top reward ${fmt(summary.topReward)}`, `最高 ${fmt(summary.topReward)}`)} />
            <Kpi label={T('To pay today', '今天要派发')} value={fmt(summary.yCredit + summary.yStreak)} color="var(--accent)" sub={`${T('tier', '阶梯')} ${fmt(summary.yCredit)} + ${T('streak', '连续')} ${fmt(summary.yStreak)}`} />
            <Kpi label={T('Total cost so far', '至今总成本')} value={fmt(summary.credit + summary.streak)} sub={`${T('tier', '阶梯')} ${fmt(summary.credit)} + ${T('streak', '连续')} ${fmt(summary.streak)}`} />
            <Kpi label={T('Turnover so far', '至今流水')} value={fmt(summary.turnover)} sub={summary.turnover > 0 ? `${T('cost', '成本')} ${((summary.credit + summary.streak) / summary.turnover * 100).toFixed(2)}%` : ''} />
            <Kpi label={T('Deposits so far', '至今存款')} value={fmt(summary.deposit)} />
          </div>

          {/* tabs */}
          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            <button style={tabBtn('follow')} onClick={() => setTab('follow')}>📣 {T("Today's follow-up", '今日跟进')}</button>
            <button style={tabBtn('pay')} onClick={() => setTab('pay')}>💰 {T('Payout', '派发')}</button>
            <button style={tabBtn('grid')} onClick={() => setTab('grid')}>📅 {T('Daily grid', '每日明细')}</button>
            <button style={tabBtn('rules')} onClick={() => { setDraft(cfg); setTab('rules') }}>⚙️ {T('Rules & messages', '规则与话术')}</button>
          </div>

          {/* shared filters */}
          {tab !== 'rules' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T('Host:', '负责人：')}</span>
              {['ALL', ...hosts].map(h => <button key={h} style={{ ...sec, padding: '4px 10px', background: hostF === h ? 'var(--accent)' : 'var(--surface2)', color: hostF === h ? '#fff' : 'var(--text)' }} onClick={() => setHostF(h)}>{h === 'ALL' ? T('All', '全部') : h}{h === myName ? T(' (me)', '（我）') : ''}</button>)}
              <input style={{ ...input, marginLeft: 8, width: 170 }} placeholder={T('Search VIP…', '搜索VIP…')} value={search} onChange={e => setSearch(e.target.value)} />
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{T('WhatsApp language', 'WhatsApp 语言')}</span>
              {['zh', 'en'].map(l => <button key={l} style={{ ...sec, padding: '4px 10px', background: waLang === l ? 'var(--accent)' : 'var(--surface2)', color: waLang === l ? '#fff' : 'var(--text)' }} onClick={() => setWaLang(l)}>{l === 'zh' ? '中文' : 'EN'}</button>)}
            </div>
          )}

          {/* ── 📣 follow-up ── */}
          {tab === 'follow' && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <button style={{ ...sec, background: groupF === 'ALL' ? 'var(--accent)' : 'var(--surface2)', color: groupF === 'ALL' ? '#fff' : 'var(--text)' }} onClick={() => setGroupF('ALL')}>{T('All', '全部')} ({scoped.length})</button>
                {ORDER.map(g => (
                  <button key={g} style={{ ...sec, borderColor: GROUPS[g].color, background: groupF === g ? GROUPS[g].color : 'var(--surface2)', color: groupF === g ? '#fff' : 'var(--text)' }} onClick={() => setGroupF(g)}>
                    {GROUPS[g].icon} {lang === 'zh' ? GROUPS[g].zh : GROUPS[g].en} ({groupCounts[g] || 0})
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                {T('Group is based on yesterday. 🔥 = qualified and one more day unlocks the streak bonus · 😬 = played ≥ ', '分组依据昨天的结果。🔥 = 已达标，再1天就拿连续奖励 · 😬 = 流水 ≥ 第一档的 ')}{cfg.near_pct}%{T(' of the first tier but missed · 💙 = big loss yesterday: send care, don\'t push.', ' 但没达标 · 💙 = 昨天大输：只关怀，不催。')}
              </div>
              <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['#', 'VIP', T('Host', '负责人'), T('Group', '分组'), T(`Turnover ${asOf || ''}`, `${asOf || ''} 流水`), T('Reward', '奖励'), T('Missed by / next', '差多少 / 下一档'), T('Streak', '连续'), T('Total so far', '累计'), T('Message', '信息')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {followRows.map((r, i) => {
                      const l = r.prog.last || {}
                      const g = GROUPS[r.group]
                      const c = sym(r.m.currency)
                      return (
                        <tr key={r.id}>
                          <td style={{ ...td, color: 'var(--muted)' }}>{i + 1}</td>
                          <td style={td}><b>{r.username}</b><div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.m.full_name || ''} · {r.m.tier || r.tier}{r.m.currency && r.m.currency !== 'MYR' ? ` · ${r.m.currency}` : ''}</div></td>
                          <td style={td}>{r.m.host_assigned || '—'}</td>
                          <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: g.color + '22', color: g.color }}>{g.icon} {lang === 'zh' ? g.zh : g.en}</span></td>
                          <td style={{ ...td, textAlign: 'right' }}>{l.vb ? c + fmt(l.vb) : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: l.reward ? '#3fb950' : 'var(--muted)' }}>{l.reward ? fmt(l.reward) : '—'}{l.streakBonus ? <div style={{ fontSize: 10, color: '#f97316' }}>🔥 +{fmt(l.streakBonus)}</div> : null}</td>
                          <td style={{ ...td, fontSize: 11 }}>
                            {!l.qualifies && tiers[0] ? <span style={{ color: '#fbbf24' }}>{T('needs', '差')} {c}{fmt(Math.max(0, tiers[0].turnover - num(l.vb)))} → {fmt(tiers[0].reward)}</span>
                              : l.nextTurnover ? <span>{T('next', '下一档')} {c}{fmt(l.nextTurnover)} → {fmt(l.nextReward)}</span> : <span style={{ color: '#3fb950' }}>{T('top tier', '最高档')}</span>}
                          </td>
                          <td style={td}>{r.prog.curRun > 0 ? '🔥'.repeat(Math.min(r.prog.curRun, 5)) + ` ${r.prog.curRun}` : '—'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmt(r.prog.cost)}</td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button style={{ ...sec, padding: '3px 8px', background: '#25D366', color: '#fff', border: 'none' }} onClick={() => openWa(r, started ? r.group : 'intro')} title={msgFor(r, started ? r.group : 'intro')}>💬 WA</button>
                              <button style={{ ...sec, padding: '3px 8px' }} onClick={() => copyMsg(r, started ? r.group : 'intro')}>⎘</button>
                              <button style={{ ...sec, padding: '3px 8px' }} title={T('Campaign intro message', '活动介绍信息')} onClick={() => openWa(r, 'intro')}>📣</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {!followRows.length && <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>{T('No players in this group.', '此分组没有玩家。')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── 💰 payout ── */}
          {tab === 'pay' && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T('Settled day:', '结算日：')}</span>
                {pastDays.map(d => <button key={d} style={{ ...sec, padding: '4px 10px', background: settle === d ? 'var(--accent)' : 'var(--surface2)', color: settle === d ? '#fff' : 'var(--text)' }} onClick={() => setPayDay(d)}>{d.slice(5)}</button>)}
                {!pastDays.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T('No settled day yet.', '还没有结算日。')}</span>}
                <span style={{ marginLeft: 'auto' }} />
                {payRows.length > 0 && <><button style={sec} onClick={exportPay}>⬇ {T('Export for BO', '导出给BO')}</button><button style={btn} onClick={markAllPaid}>✅ {T('Mark all paid', '全部标记已派发')}</button></>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{T(`Rewards earned on ${settle || '—'} — pay on the next day. Streak bonus = ${cfg.streak_pct}% of deposits on the ${cfg.streak_days} streak days.`, `${settle || '—'} 的奖励 — 隔天派发。连续奖励 = ${cfg.streak_days} 天连续达标日存款的 ${cfg.streak_pct}%。`)}</div>
              <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['#', 'VIP', T('Host', '负责人'), T('Turnover', '流水'), T('Tier reward', '阶梯奖励'), T('Paid', '已派'), T('Streak bonus', '连续奖励'), T('Paid', '已派'), T('Total', '合计')].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {payRows.filter(({ r }) => !hostF || hostF === 'ALL' || r.m.host_assigned === hostF).map(({ r, d }, i) => {
                      const p = (r.ch_paid || {})[settle] || {}
                      return (
                        <tr key={r.id}>
                          <td style={{ ...td, color: 'var(--muted)' }}>{i + 1}</td>
                          <td style={td}><b>{r.username}</b><div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.m.full_name || ''}{r.m.currency && r.m.currency !== 'MYR' ? ` · ${r.m.currency}` : ''}</div></td>
                          <td style={td}>{r.m.host_assigned || '—'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{sym(r.m.currency)}{fmt(d.vb)}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#3fb950' }}>{d.reward ? fmt(d.reward) : '—'}</td>
                          <td style={td}>{d.reward > 0 && <input type="checkbox" checked={!!p.c} onChange={e => markPaid(r, 'c', e.target.checked)} />}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#f97316' }}>{d.streakBonus ? fmt(d.streakBonus) : '—'}{d.streakBonus ? <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{cfg.streak_pct}% × {fmt(d.streakBase)}</div> : null}</td>
                          <td style={td}>{d.streakBonus > 0 && <input type="checkbox" checked={!!p.s} onChange={e => markPaid(r, 's', e.target.checked)} />}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{fmt(d.reward + d.streakBonus)}</td>
                        </tr>
                      )
                    })}
                    {!payRows.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>{T('Nobody qualified on this day.', '这一天没有人达标。')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── 📅 grid ── */}
          {tab === 'grid' && (
            <div style={{ marginTop: 10, maxHeight: 560, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>#</th><th style={th}>VIP</th>{dates.map(d => <th key={d} style={{ ...th, textAlign: 'center' }}>{d.slice(5)}</th>)}<th style={th}>{T('Tier total', '阶梯合计')}</th><th style={th}>{T('Streak', '连续')}</th><th style={th}></th></tr></thead>
                <tbody>
                  {[...scoped].sort((a, b) => b.prog.cost - a.prog.cost).map((r, i) => (
                    <tr key={r.id}>
                      <td style={{ ...td, color: 'var(--muted)' }}>{i + 1}</td>
                      <td style={td}><b>{r.username}</b><div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.m.host_assigned || ''}</div></td>
                      {r.prog.days.map(d => (
                        <td key={d.date} title={`${T('Turnover', '流水')} ${fmt(d.vb)} · ${T('Deposit', '存款')} ${fmt(d.dep)}`} style={{ ...td, textAlign: 'center', background: d.future ? 'transparent' : d.qualifies ? 'rgba(63,185,80,.12)' : d.vb > 0 ? 'rgba(251,191,36,.08)' : 'transparent' }}>
                          {d.future ? <span style={{ color: 'var(--muted)' }}>·</span> : d.qualifies ? <b style={{ color: '#3fb950' }}>{fmt(d.reward)}</b> : <span style={{ fontSize: 10, color: 'var(--muted)' }}>{d.vb ? fmt(d.vb / 1000) + 'k' : '—'}</span>}
                          {d.streakBonus > 0 && <div style={{ fontSize: 10, color: '#f97316' }}>🔥{fmt(d.streakBonus)}</div>}
                        </td>
                      ))}
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(r.prog.credit)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#f97316', fontWeight: 700 }}>{fmt(r.prog.streak)}</td>
                      <td style={td}><button style={{ ...sec, padding: '2px 6px', fontSize: 11 }} onClick={() => removePlayer(r)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: 10, display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--border)' }}>
                <input style={{ ...input, flex: 1 }} placeholder={T('Add players: usernames, comma or one per line', '加入玩家：用户名，逗号或每行一个')} value={addIds} onChange={e => setAddIds(e.target.value)} />
                <button style={btn} onClick={addPlayers}>+ {T('Add', '加入')}</button>
              </div>
            </div>
          )}

          {/* ── ⚙️ rules & messages ── */}
          {tab === 'rules' && (
            <div style={{ marginTop: 12 }}>
              <DailyRulesEditor cfg={draft} setCfg={setDraft} withTemplates />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button style={sec} onClick={() => setDraft(cfg)}>{T('Reset', '重置')}</button>
                <button style={btn} onClick={saveRules}>{T('Save rules & messages', '保存规则与话术')}</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T('Campaign status:', '活动状态：')}</span>
                {['draft', 'active', 'paused', 'ended'].map(s => <button key={s} style={{ ...sec, background: camp.status === s ? 'var(--accent)' : 'var(--surface2)', color: camp.status === s ? '#fff' : 'var(--text)' }}
                  onClick={async () => { const { error } = await supabase.from('campaigns').update({ status: s }).eq('id', camp.id); if (error) return flash(error.message); setCamp(c => ({ ...c, status: s })); onChanged && onChanged() }}>{s}</button>)}
              </div>
            </div>
          )}
        </>}
        {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--surface)', border: '1px solid var(--accent)', padding: '10px 14px', borderRadius: 8, zIndex: 1300, fontSize: 13 }}>{toast}</div>}
      </div>
    </div>
  )
}
