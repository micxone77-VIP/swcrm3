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
import CampaignImpact from './CampaignImpact'

const fmt = v => Math.round(num(v)).toLocaleString('en-MY')
const sym = c => (c === 'SGD' ? 'SGD ' : c === 'KHUSD' ? 'USD ' : 'RM ')
const btn = { background: 'var(--accent)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 14 }
const sec = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }
const input = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 7, fontSize: 14, boxSizing: 'border-box' }
const card = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }
const th = { textAlign: 'left', padding: '10px 12px', color: 'var(--muted)', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }
const td = { padding: '10px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 14 }

function Kpi({ label, value, sub, color }) {
  return <div style={card}><div style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</div><div style={{ fontSize: 28, fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>{sub && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div>}</div>
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
  const [roiMkt, setRoiMkt] = useState('MYR')   // Summary market: MYR (MY) / SGD (SG) / KHUSD (KH) — never mixed
  const [base, setBase] = useState({})   // username -> { vb, dep, wd, wl, days } for the same number of days BEFORE the campaign
  const [asOf, setAsOf] = useState(null)
  const [wlCfg, setWlCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState('follow')
  const [hostF, setHostF] = useState(null)
  const [platF, setPlatF] = useState('ALL')   // platform: ALL / MYR (MY) / SGD (SG) / KHUSD (KH)
  const [groupF, setGroupF] = useState('ALL')
  const [search, setSearch] = useState('')
  const [waLang, setWaLang] = useState(lang === 'zh' ? 'zh' : 'en')
  const [msgType, setMsgType] = useState('auto')   // global: 'auto' = by group, or force one type for everyone
  const [rowType, setRowType] = useState({})       // per-player override { playerId: type }
  const [unsentOnly, setUnsentOnly] = useState(false)
  const [payDay, setPayDay] = useState(null)
  const [draft, setDraft] = useState(cfg)
  const [addIds, setAddIds] = useState('')
  const [openP, setOpenP] = useState(null)          // player detail panel (row object)
  const [sel, setSel] = useState(new Set())          // selected player ids (grid tab) for bulk remove
  const [bulkOpen, setBulkOpen] = useState(false)
  const [allVips, setAllVips] = useState(null)
  const [bulkTiers, setBulkTiers] = useState([])
  const [bulkHosts, setBulkHosts] = useState([])
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
      const rows = await fetchAll(() => supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit,total_withdrawal,win_loss,monthly_valid_bet')
        .gte('snapshot_date', camp.start_date).lte('snapshot_date', camp.end_date).order('snapshot_date').order('username'))
      const out = {}
      rows.forEach(r => {
        if (!names.has(r.username)) return
        const ok = num(r.monthly_valid_bet) > 0
        ;(out[r.username] = out[r.username] || {})[r.snapshot_date] = { vb: Math.max(0, num(r.monthly_valid_bet)), dep: ok ? num(r.total_deposit) : 0, wd: ok ? num(r.total_withdrawal) : 0, wl: ok ? num(r.win_loss) : 0 }
      })
      setDaily(out)
      // baseline: same number of days right before the campaign (for uplift / ROI comparison)
      const nDays = Math.round((new Date(camp.end_date) - new Date(camp.start_date)) / 86400000) + 1
      const bStart = new Date(new Date(camp.start_date + 'T00:00:00Z').getTime() - nDays * 86400000).toISOString().slice(0, 10)
      const bEnd = new Date(new Date(camp.start_date + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10)
      const brows = await fetchAll(() => supabase.from('vip_daily_snapshots').select('username,snapshot_date,total_deposit,total_withdrawal,win_loss,monthly_valid_bet')
        .gte('snapshot_date', bStart).lte('snapshot_date', bEnd).order('snapshot_date').order('username'))
      const b = {}
      brows.forEach(r => {
        if (!names.has(r.username) || num(r.monthly_valid_bet) <= 0) return
        const x = (b[r.username] = b[r.username] || { vb: 0, dep: 0, wd: 0, wl: 0, days: 0 })
        x.vb += num(r.monthly_valid_bet); x.dep += num(r.total_deposit); x.wd += num(r.total_withdrawal); x.wl += num(r.win_loss); x.days++
      })
      setBase({ map: b, from: bStart, to: bEnd })
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
  const platOf = r => String(r.m.currency || 'MYR').toUpperCase()
  const platOk = r => platF === 'ALL' || platOf(r) === platF
  const PLAT_LABEL = { MYR: '🇲🇾 MY', SGD: '🇸🇬 SG', KHUSD: '🇰🇭 KH' }
  const platforms = ['MYR', 'SGD', 'KHUSD'].filter(c => rowsAll.some(r => platOf(r) === c))
  const scoped = rowsAll.filter(platOk).filter(r => !hostF || hostF === 'ALL' || (hostF === '__none' ? !r.m.host_assigned : (r.m.host_assigned || '') === hostF))
    .filter(r => !search || r.username.toLowerCase().includes(search.toLowerCase()) || (r.m.full_name || '').toLowerCase().includes(search.toLowerCase()))
  const groupCounts = {}; scoped.forEach(r => { groupCounts[r.group] = (groupCounts[r.group] || 0) + 1 })
  const ORDER = ['streak', 'near', 'won', 'idle', 'care']
  // "sent today" tracking (local Malaysia date) — stored in campaign_players.ch_sent + written to Contact Log
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
  const sentOf = r => (r.ch_sent || {})[todayKey] || null
  const sentCount = {}; scoped.forEach(r => { if (sentOf(r)) sentCount[r.group] = (sentCount[r.group] || 0) + 1 })
  const sentTotal = scoped.filter(r => sentOf(r)).length
  const followRows = scoped.filter(r => groupF === 'ALL' || r.group === groupF).filter(r => !unsentOnly || !sentOf(r))
    .sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || num(b.prog.last?.vb) - num(a.prog.last?.vb))

  const MSG_TYPES = ['intro', 'won', 'streak', 'near', 'idle', 'care']
  const MSG_LABEL = k => (k === 'intro' ? T('📣 Campaign intro', '📣 活动介绍') : `${GROUPS[k].icon} ${lang === 'zh' ? GROUPS[k].zh : GROUPS[k].en}`)
  const typeFor = r => {
    const t0 = rowType[r.id] && rowType[r.id] !== 'auto' ? rowType[r.id] : msgType
    return t0 !== 'auto' ? t0 : (started ? r.group : 'intro')
  }
  const msgFor = (r, group) => fillMessage({ group, lang: waLang, cfg, campaign: camp, prog: r.prog, username: r.username, agent: myName, summary, currency: r.m.currency })
  const typeName = k => (k === 'intro' ? 'Campaign intro 活动介绍' : `${GROUPS[k]?.en || k} ${GROUPS[k]?.zh || ''}`)
  // Mark as sent today + write a Contact Log entry (so VIP360 / Churn Urgency / KPI count it)
  async function markSent(r, group, via) {
    if (sentOf(r)) return
    const nowD = new Date(), nowIso = nowD.toISOString()
    const text = msgFor(r, group)
    const { data: log, error } = await supabase.from('contact_logs').insert({
      username: r.username, vip_id: r.m.id || r.vip_id || null, tier: r.m.tier || r.tier || null,
      channel: 'WhatsApp', direction: 'outbound', outcome: 'Contacted',
      notes: `${camp.campaign_name} · ${typeName(group)}${via === 'manual' ? ' (marked manually)' : ''}`,
      message_summary: text.slice(0, 500), host_name: myName || null, host_id: profile?.id || null,
      logged_at: nowIso, log_month: nowIso.slice(0, 7), log_week: String(Math.ceil(nowD.getDate() / 7)),
    }).select('id').single()
    if (error) { flash(T('Contact Log failed: ', 'Contact Log 记录失败：') + error.message); return }
    const sent = { ...(r.ch_sent || {}), [todayKey]: { type: group, at: nowIso, by: myName, via, log_id: log?.id || null } }
    const { error: e2 } = await supabase.from('campaign_players').update({ ch_sent: sent }).eq('id', r.id)
    if (e2) return flash(e2.message)
    setPlayers(ps => ps.map(p => (p.id === r.id ? { ...p, ch_sent: sent } : p)))
  }
  async function unmarkSent(r) {
    const cur = sentOf(r); if (!cur) return
    if (!window.confirm(T(`Undo "sent" for ${r.username}? The Contact Log entry will be removed.`, `撤销 ${r.username} 的"已发送"？对应的 Contact Log 记录会被删除。`))) return
    if (cur.log_id) await supabase.from('contact_logs').delete().eq('id', cur.log_id)
    const sent = { ...(r.ch_sent || {}) }; delete sent[todayKey]
    const { error } = await supabase.from('campaign_players').update({ ch_sent: sent }).eq('id', r.id)
    if (error) return flash(error.message)
    setPlayers(ps => ps.map(p => (p.id === r.id ? { ...p, ch_sent: sent } : p)))
  }
  function openWa(r, group) {
    if (sentOf(r) && !window.confirm(T(`Already sent to ${r.username} today. Send again?`, `今天已发给 ${r.username}，确定再发？`))) return
    const num_ = String(r.m.whatsapp || r.m.phone || r.whatsapp || '').replace(/\D/g, '')
    const text = msgFor(r, group)
    if (!num_) { navigator.clipboard.writeText(text); flash(T('No phone — message copied', '没有电话 — 已复制信息')) }
    else window.open(`https://wa.me/${num_}?text=${encodeURIComponent(text)}`, '_blank')
    markSent(r, group, num_ ? 'wa' : 'copy')
  }
  function copyMsg(r, group) {
    navigator.clipboard.writeText(msgFor(r, group))
    flash(sentOf(r) ? T('Copied (already marked sent today)', '已复制（今天已标记发送）') : T('Copied — marked as sent ✅', '已复制 — 已标记为已发送 ✅'))
    markSent(r, group, 'copy')
  }
  async function markShownSent() {
    const todo = followRows.filter(r => !sentOf(r))
    if (!todo.length) return
    if (!window.confirm(T(`Mark ${todo.length} players shown as sent (e.g. after a broadcast)? Each gets a Contact Log entry.`, `将显示中的 ${todo.length} 位玩家标记为已发送（例如已用广播发出）？每位都会记录到 Contact Log。`))) return
    for (const r of todo) await markSent(r, typeFor(r), 'manual')
    flash(T('Done', '完成'))
  }

  // ── payout (per settled day) ──
  const pastDays = rowsAll[0]?.prog.days.filter(d => !d.future).map(d => d.date) || []
  const allMode = payDay === 'ALL'
  const settle = allMode ? null : (payDay || pastDays[pastDays.length - 1] || null)
  const hostOk = r => platOk(r) && (!hostF || hostF === 'ALL' || (hostF === '__none' ? !r.m.host_assigned : r.m.host_assigned === hostF))
  const payRowsFor = day => rowsAll.map(r => ({ r, d: r.prog.days.find(x => x.date === day) })).filter(x => x.d && (x.d.reward > 0 || x.d.streakBonus > 0))
  const payRows = settle ? rowsAll.map(r => ({ r, d: r.prog.days.find(x => x.date === settle) })).filter(x => x.d && (x.d.reward > 0 || x.d.streakBonus > 0) && hostOk(x.r))
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
  // Text payout list (same style as other campaigns) — copy & paste to BO / group chat
  function payoutText(day = settle) {
    const scopedPay = payRowsFor(day).filter(({ r }) => hostOk(r))
    const label = cfg.reward_label || 'Credit'
    const cur = r => (String(r.m.currency || 'MYR').toUpperCase() === 'SGD' ? 'SGD' : String(r.m.currency || 'MYR').toUpperCase() === 'KHUSD' ? 'USD' : 'RM')
    const tierLines = scopedPay.filter(x => x.d.reward > 0).sort((a, b) => b.d.reward - a.d.reward)
      .map(({ r, d }) => ({ r, t: `${r.username} - ${cur(r)} ${fmt(d.reward)} ${label}` }))
    const streakLines = scopedPay.filter(x => x.d.streakBonus > 0).sort((a, b) => b.d.streakBonus - a.d.streakBonus)
      .map(({ r, d }) => ({ r, t: `${r.username} - ${cur(r)} ${fmt(d.streakBonus)} ${label}` }))
    const out = [camp.campaign_name.toUpperCase(), day]
    const pl = [...new Set(scopedPay.map(({ r }) => platOf(r)))].sort((a, b) => ['MYR', 'SGD', 'KHUSD'].indexOf(a) - ['MYR', 'SGD', 'KHUSD'].indexOf(b))
    const multi = pl.length > 1
    pl.forEach(c => {
      const inP = l => l.r && platOf(l.r) === c
      const tl = tierLines.filter(inP).map(l => l.t), sl = streakLines.filter(inP).map(l => l.t)
      out.push('')
      if (multi) out.push(`${PLAT_LABEL[c] || c}`)
      out.push(...tl)
      if (sl.length) out.push('', `🔥 ${cfg.streak_days}-DAY STREAK BONUS (${cfg.streak_pct}%)`, ...sl)
    })
    if (num(cfg.turnover_multiplier) > 0) out.push('', `x${num(cfg.turnover_multiplier)} turnover`)
    return out.join('\n')
  }
  // 📜 history across all settled days
  const history = pastDays.map(day => {
    const rows = payRowsFor(day).filter(({ r }) => hostOk(r))
    const h = { day, qualified: 0, streakN: 0, amt: {}, paid: {}, pend: {}, itemsPaid: 0, items: 0 }
    rows.forEach(({ r, d }) => {
      const c = String(r.m.currency || 'MYR').toUpperCase()
      const p = (r.ch_paid || {})[day] || {}
      const add = (o, v) => { o[c] = (o[c] || 0) + v }
      if (d.reward > 0) { h.qualified++; h.items++; add(h.amt, d.reward); if (p.c) { h.itemsPaid++; add(h.paid, d.reward) } else add(h.pend, d.reward) }
      if (d.streakBonus > 0) { h.streakN++; h.items++; add(h.amt, d.streakBonus); if (p.s) { h.itemsPaid++; add(h.paid, d.streakBonus) } else add(h.pend, d.streakBonus) }
    })
    return h
  })
  const histTotal = history.reduce((t, h) => {
    ;['amt', 'paid', 'pend'].forEach(k => Object.entries(h[k]).forEach(([c, v]) => { t[k][c] = (t[k][c] || 0) + v }))
    t.qualified += h.qualified; t.streakN += h.streakN; t.items += h.items; t.itemsPaid += h.itemsPaid
    return t
  }, { amt: {}, paid: {}, pend: {}, qualified: 0, streakN: 0, items: 0, itemsPaid: 0 })
  const curAmt = o => Object.keys(o).length ? Object.entries(o).map(([c, v]) => `${sym(c)}${fmt(v)}`).join(' · ') : '—'
  function copyAllDays() {
    const txt = pastDays.filter(d => payRowsFor(d).some(({ r }) => hostOk(r))).map(d => payoutText(d)).join('\n\n────────\n\n')
    if (!txt) return
    navigator.clipboard.writeText(txt); flash(T('All days copied', '已复制全部日期'))
  }

  function copyPayout() {
    if (!payRows.length) return
    navigator.clipboard.writeText(payoutText()); flash(T('Payout list copied', '已复制派发名单'))
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

  async function removeSelected() {
    const ids = [...sel]
    if (!ids.length) return
    if (!window.confirm(T(`Remove ${ids.length} selected players from this campaign?`, `确定将已选的 ${ids.length} 位玩家移出此活动？`))) return
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('campaign_players').delete().in('id', ids.slice(i, i + 200))
      if (error) return flash(error.message)
    }
    setPlayers(ps => ps.filter(p => !sel.has(p.id))); setSel(new Set()); flash(T(`Removed ${ids.length}`, `已移出 ${ids.length} 位`))
  }
  async function openBulk() {
    setBulkOpen(o => !o)
    if (!allVips) setAllVips(await fetchAll(() => supabase.from('vip_members').select('id,username,full_name,tier,host_assigned,phone,whatsapp,is_excluded').order('username')).catch(() => []))
  }
  const inCamp = new Set(players.map(p => p.username))
  const bulkMatches = (allVips || []).filter(m => !m.is_excluded && !inCamp.has(m.username)
    && (!bulkTiers.length || bulkTiers.includes(String(m.tier || '').toUpperCase()))
    && (!bulkHosts.length || bulkHosts.includes(m.host_assigned || '__none')))
  async function addBulk() {
    if (!bulkMatches.length) return
    if (!window.confirm(T(`Add ${bulkMatches.length} players?`, `确定加入 ${bulkMatches.length} 位玩家？`))) return
    const now = new Date().toISOString()
    const rows = bulkMatches.map(m => ({
      campaign_id: camp.id, vip_id: m.id, username: m.username, tier: m.tier, player_name: m.full_name || null, whatsapp: m.whatsapp || m.phone || null,
      total_deposit: 0, campaign_period_deposit: 0, converted: false, payout_status: 'pending', streak_payout_status: 'pending', status: 'enrolled',
      enrollment_source: 'bulk', added_at: now, enrolled_at: now, ch_credit_status: 'none',
    }))
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('campaign_players').upsert(rows.slice(i, i + 200), { onConflict: 'campaign_id,username' })
      if (error) return flash(error.message)
    }
    flash(T(`Added ${rows.length}`, `已加入 ${rows.length} 位`)); setBulkOpen(false); load()
  }
  const toggleArr = (arr, set, v) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])
  const allHosts = [...new Set((allVips || []).map(m => m.host_assigned).filter(Boolean))].sort()

  // ── 📊 Summary / ROI ──
  // Each market is its own platform → separate figures in its own currency (no FX mixing)
  const curOf = r => String(r.m.currency || 'MYR').toUpperCase()
  const markets = ['MYR', 'SGD', 'KHUSD'].filter(c => rowsAll.some(r => curOf(r) === c))
  const mkt = markets.includes(roiMkt) ? roiMkt : (markets[0] || 'MYR')
  const fx = () => 1
  const roi = (() => {
    const rowsM = rowsAll.filter(r => curOf(r) === mkt)
    const passedDays = rowsAll[0]?.prog.days.filter(d => !d.future).length || 0
    const o = { players: rowsM.length, active: 0, qualifiedPlayers: 0, credit: 0, streak: 0, vb: 0, dep: 0, wd: 0, ggr: 0, bVb: 0, bDep: 0, bGgr: 0, bActive: 0, passedDays,
      byDay: {}, byTier: {}, byHost: {}, rewardRows: 0, paid: 0, pending: 0, streakList: [], streakPaid: 0, streakPending: 0, streakPlayers: new Set() }
    const tiersS = sortedTiers(cfg)
    rowsM.forEach(r => {
      const f = fx()
      let act = false, q = false
      const h = r.m.host_assigned || T('(No host)', '（无负责人）')
      const H = (o.byHost[h] = o.byHost[h] || { players: 0, qualified: 0, cost: 0, vb: 0, dep: 0, ggr: 0 })
      H.players++
      r.prog.days.filter(d => !d.future).forEach(d => {
        const dd = daily[r.username]?.[d.date] || {}
        const ggr = -num(dd.wl) * f, cost = (d.reward + d.streakBonus) * f
        if (d.vb > 0) act = true
        if (d.qualifies) { q = true; o.byTier[d.tier] = (o.byTier[d.tier] || 0) + 1 }
        const pd = (r.ch_paid || {})[d.date] || {}
        if (d.reward > 0) { o.rewardRows++; if (pd.c) o.paid += d.reward * f; else o.pending += d.reward * f }
        if (d.streakBonus > 0) {
          o.streakPlayers.add(r.username)
          if (pd.s) { o.paid += d.streakBonus * f; o.streakPaid += d.streakBonus * f } else { o.pending += d.streakBonus * f; o.streakPending += d.streakBonus * f }
          o.streakList.push({ username: r.username, date: d.date, bonus: d.streakBonus * f, base: d.streakBase * f, paid: !!pd.s, n: o.streakList.filter(x => x.username === r.username).length + 1 })
        }
        o.credit += d.reward * f; o.streak += d.streakBonus * f; o.vb += d.vb * f; o.dep += d.dep * f; o.wd += num(dd.wd) * f; o.ggr += ggr
        H.cost += cost; H.vb += d.vb * f; H.dep += d.dep * f; H.ggr += ggr
        const D = (o.byDay[d.date] = o.byDay[d.date] || { active: 0, qualified: 0, credit: 0, streak: 0, vb: 0, dep: 0, ggr: 0 })
        if (d.vb > 0) D.active++
        if (d.qualifies) D.qualified++
        D.credit += d.reward * f; D.streak += d.streakBonus * f; D.vb += d.vb * f; D.dep += d.dep * f; D.ggr += ggr
      })
      if (act) o.active++
      if (q) { o.qualifiedPlayers++; H.qualified++ }
      const bb = base.map?.[r.username]
      if (bb) {
        // scale baseline to the same number of days that have passed in the campaign
        const nAll = rowsAll[0]?.prog.days.length || 1, k = passedDays / nAll
        o.bVb += bb.vb * f * k; o.bDep += bb.dep * f * k; o.bGgr += -bb.wl * f * k; if (bb.days > 0) o.bActive++
      }
    })
    o.cost = o.credit + o.streak
    o.netDep = o.dep - o.wd
    o.netPL = o.dep - o.wd - o.cost
    o.plRoi = o.cost > 0 ? o.netPL / o.cost : null
    o.roi = o.cost > 0 ? (o.ggr - o.cost) / o.cost : null
    o.costPctTo = o.vb > 0 ? o.cost / o.vb : null
    o.upVb = o.vb - o.bVb; o.upGgr = o.ggr - o.bGgr
    o.incRoi = o.cost > 0 ? (o.upGgr - o.cost) / o.cost : null
    o.tiersS = tiersS
    return o
  })()
  const pct = v => (v == null ? '—' : (v * 100).toFixed(1) + '%')
  const rmS = v => (v < 0 ? '-' : '') + sym(mkt) + fmt(Math.abs(v))

  const copyName = u => { navigator.clipboard.writeText(u); flash(T(`Copied ${u}`, `已复制 ${u}`)) }
  const nameCell = (r, sub) => (
    <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <b onClick={() => setOpenP(r)} title={T('View daily deposit / withdrawal / turnover', '查看每日存款 / 提款 / 流水')} style={{ cursor: 'pointer', color: 'var(--accent)' }}>{r.username}</b>
        <button onClick={e => { e.stopPropagation(); copyName(r.username) }} title={T('Copy username', '复制用户名')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>⎘</button>
      </span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span>
    </span>
  )
  // per-player totals for the whole period (settled days)
  const totalsOf = r => {
    const t = { dep: 0, wd: 0, vb: 0, wl: 0 }
    r.prog.days.filter(d => !d.future).forEach(d => { const x = daily[r.username]?.[d.date] || {}; t.dep += num(x.dep); t.wd += num(x.wd); t.vb += num(x.vb); t.wl += num(x.wl) })
    return t
  }

  const tiers = sortedTiers(cfg)
  const dates = rowsAll[0]?.prog.days.map(d => d.date) || []
  const tabBtn = k => ({ ...sec, background: tab === k ? 'var(--accent)' : 'var(--surface2)', color: tab === k ? '#fff' : 'var(--text)', fontWeight: 700 })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 1200, overflow: 'auto', padding: '16px' }}>
      <div style={{ width: '100%', maxWidth: 'none', minHeight: 'calc(100vh - 32px)', margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 26px', boxSizing: 'border-box' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 34 }}>⚡</div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{camp.campaign_name}</div>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>
              {T('Daily Milestone', '每日流水里程碑')} · {camp.start_date} → {camp.end_date} · {players.length} {T('players', '位玩家')} · {camp.status}
            </div>
            <div style={{ fontSize: 15, marginTop: 6 }}>
              {tiers.map(t => <span key={t.turnover} style={{ marginRight: 10 }}>{fmt(t.turnover)} → <b>{fmt(t.reward)}</b></span>)}
              {cfg.streak_enabled && <span style={{ color: '#f97316' }}>🔥 {cfg.streak_days}{T('-day streak', '天连续')} = {cfg.streak_pct}% {T('of deposits', '存款')} ({cfg.streak_style === 'rolling' ? T('rolling', '滚动') : T('every block', '每轮')}{num(cfg.streak_cap) > 0 ? `, cap ${fmt(cfg.streak_cap)}` : ''})</span>}
            </div>
          </div>
          <button style={sec} onClick={load}>{T('🔄 Refresh', '🔄 刷新')}</button>
          <button style={sec} onClick={onClose}>✕ {T('Close', '关闭')}</button>
        </div>

        {/* data date banner */}
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(88,166,255,.10)', border: '1px solid rgba(88,166,255,.3)', fontSize: 14 }}>
          📅 {T('Data up to', '数据截至')} <b>{asOf || '—'}</b> {T('(yesterday). Each day is settled the next day: today you pay yesterday\'s rewards and send today\'s follow-up.', '（昨天）。每天隔天结算：今天派发昨天的奖励，并发送今天的跟进信息。')}
          {!started && <span style={{ color: '#fbbf24' }}> {T('Campaign has not started yet — use the 📣 Intro message to announce it.', '活动尚未开始 — 可用 📣 活动介绍 信息先通知玩家。')}</span>}
        </div>

        {err && <div style={{ color: '#f87171', marginTop: 10 }}>{err}</div>}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{T('Loading…', '载入中…')}</div> : <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginTop: 14 }}>
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
            <button style={tabBtn('summary')} onClick={() => setTab('summary')}>📊 {T('Summary & ROI', '总结与ROI')}</button>
            <button style={tabBtn('impact')} onClick={() => setTab('impact')}>📈 {T('Impact (before / after)', '成效（活动前 / 后）')}</button>
            <button style={tabBtn('rules')} onClick={() => { setDraft(cfg); setTab('rules') }}>⚙️ {T('Rules & messages', '规则与话术')}</button>
          </div>

          {/* shared filters */}
          {tab !== 'rules' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {platforms.length > 1 && <>
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>{T('Platform:', '平台：')}</span>
                {['ALL', ...platforms].map(c => <button key={c} style={{ ...sec, padding: '6px 12px', fontWeight: 700, background: platF === c ? 'var(--accent)' : 'var(--surface2)', color: platF === c ? '#fff' : 'var(--text)' }} onClick={() => { setPlatF(c); if (c !== 'ALL') setRoiMkt(c) }}>{c === 'ALL' ? T('All', '全部') : PLAT_LABEL[c] || c} · {c === 'ALL' ? rowsAll.length : rowsAll.filter(r => platOf(r) === c).length}</button>)}
                <span style={{ width: 14 }} />
              </>}
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>{T('Host:', '负责人：')}</span>
              {['ALL', ...hosts, '__none'].map(h => <button key={h} style={{ ...sec, padding: '6px 12px', background: hostF === h ? 'var(--accent)' : 'var(--surface2)', color: hostF === h ? '#fff' : 'var(--text)' }} onClick={() => setHostF(h)}>{h === 'ALL' ? T('All', '全部') : h === '__none' ? T('(No host)', '（无负责人）') : h}{h === myName ? T(' (me)', '（我）') : ''}</button>)}
              <input style={{ ...input, marginLeft: 8, width: 170 }} placeholder={T('Search VIP…', '搜索VIP…')} value={search} onChange={e => setSearch(e.target.value)} />
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{T('Message type', '信息类型')}</span>
              <select value={msgType} onChange={e => { setMsgType(e.target.value); setRowType({}) }} style={{ ...input, padding: '4px 6px' }}>
                <option value="auto">{T('Auto — by group', '自动 — 按分组')}</option>
                {MSG_TYPES.map(k => <option key={k} value={k}>{MSG_LABEL(k)}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T('WhatsApp language', 'WhatsApp 语言')}</span>
              {['zh', 'en'].map(l => <button key={l} style={{ ...sec, padding: '6px 12px', background: waLang === l ? 'var(--accent)' : 'var(--surface2)', color: waLang === l ? '#fff' : 'var(--text)' }} onClick={() => setWaLang(l)}>{l === 'zh' ? '中文' : 'EN'}</button>)}
            </div>
          )}

          {/* ── 📣 follow-up ── */}
          {tab === 'follow' && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <button style={{ ...sec, background: groupF === 'ALL' ? 'var(--accent)' : 'var(--surface2)', color: groupF === 'ALL' ? '#fff' : 'var(--text)' }} onClick={() => setGroupF('ALL')}>{T('All', '全部')} ({sentTotal}/{scoped.length} {T('sent', '已发')})</button>
                {ORDER.map(g => (
                  <button key={g} style={{ ...sec, borderColor: GROUPS[g].color, background: groupF === g ? GROUPS[g].color : 'var(--surface2)', color: groupF === g ? '#fff' : 'var(--text)' }} onClick={() => setGroupF(g)}>
                    {GROUPS[g].icon} {lang === 'zh' ? GROUPS[g].zh : GROUPS[g].en} ({sentCount[g] || 0}/{groupCounts[g] || 0})
                  </button>
                ))}
                <span style={{ width: 8 }} />
                <button style={{ ...sec, background: unsentOnly ? '#f85149' : 'var(--surface2)', color: unsentOnly ? '#fff' : 'var(--text)' }} onClick={() => setUnsentOnly(v => !v)}>⏳ {T('Not sent yet only', '只看未发送')}</button>
                <button style={sec} onClick={markShownSent} title={T('For messages sent outside the CRM (broadcast / own phone)', '用于在CRM以外发送的信息（广播 / 自己的手机）')}>✅ {T('Mark shown as sent', '显示中的标记为已发')}</button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
                {T('Group is based on yesterday. 🔥 = qualified and one more day unlocks the streak bonus · 😬 = played ≥ ', '分组依据昨天的结果。🔥 = 已达标，再1天就拿连续奖励 · 😬 = 流水 ≥ 第一档的 ')}{cfg.near_pct}%{T(' of the first tier but missed · 💙 = big loss yesterday: send care, don\'t push.', ' 但没达标 · 💙 = 昨天大输：只关怀，不催。')}
              </div>
              <div style={{ maxHeight: 'calc(100vh - 430px)', minHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['#', 'VIP', T('Host', '负责人'), T('Phone', '电话'), T('Group', '分组'), T(`Turnover ${asOf || ''}`, `${asOf || ''} 流水`), T('Reward', '奖励'), T('Missed by / next', '差多少 / 下一档'), T('Streak', '连续'), T('Total so far', '累计'), T('Sent today', '今天已发'), T('Message', '信息')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {followRows.map((r, i) => {
                      const l = r.prog.last || {}
                      const g = GROUPS[r.group]
                      const c = sym(r.m.currency)
                      return (
                        <tr key={r.id} style={{ opacity: sentOf(r) ? 0.6 : 1 }}>
                          <td style={{ ...td, color: 'var(--muted)' }}>{i + 1}</td>
                          <td style={td}>{nameCell(r, `${r.m.full_name || ''} · ${r.m.tier || r.tier}${r.m.currency && r.m.currency !== 'MYR' ? ` · ${r.m.currency}` : ''}`)}</td>
                          <td style={td}>{r.m.host_assigned || '—'}</td>
                          <td style={td}>{(() => { const ph = String(r.m.whatsapp || r.m.phone || r.whatsapp || '').replace(/\D/g, ''); return ph
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ fontVariantNumeric: 'tabular-nums' }}>{ph}</span><button onClick={() => { navigator.clipboard.writeText(ph); flash(T(`Copied ${ph}`, `已复制 ${ph}`)) }} title={T('Copy phone', '复制电话')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>⎘</button></span>
                            : <span style={{ color: 'var(--muted)' }}>—</span> })()}</td>
                          <td style={td}><span style={{ fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: g.color + '22', color: g.color }}>{g.icon} {lang === 'zh' ? g.zh : g.en}</span></td>
                          <td style={{ ...td, textAlign: 'right' }}>{l.vb ? c + fmt(l.vb) : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: l.reward ? '#3fb950' : 'var(--muted)' }}>{l.reward ? fmt(l.reward) : '—'}{l.streakBonus ? <div style={{ fontSize: 12, color: '#f97316' }}>🔥 +{fmt(l.streakBonus)}</div> : null}</td>
                          <td style={{ ...td, fontSize: 13 }}>
                            {!l.qualifies && tiers[0] ? <span style={{ color: '#fbbf24' }}>{T('needs', '差')} {c}{fmt(Math.max(0, tiers[0].turnover - num(l.vb)))} → {fmt(tiers[0].reward)}</span>
                              : l.nextTurnover ? <span>{T('next', '下一档')} {c}{fmt(l.nextTurnover)} → {fmt(l.nextReward)}</span> : <span style={{ color: '#3fb950' }}>{T('top tier', '最高档')}</span>}
                          </td>
                          <td style={td}>{r.prog.curRun > 0 ? '🔥'.repeat(Math.min(r.prog.curRun, 5)) + ` ${r.prog.curRun}` : '—'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmt(r.prog.cost)}</td>
                          <td style={td}>
                            {sentOf(r)
                              ? <span onClick={() => unmarkSent(r)} title={T('Click to undo', '点击撤销')} style={{ cursor: 'pointer', color: '#3fb950', fontWeight: 700, fontSize: 13 }}>✅ {new Date(sentOf(r).at).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}<div style={{ fontWeight: 400, color: 'var(--muted)' }}>{sentOf(r).by} · {sentOf(r).via === 'wa' ? 'WA' : sentOf(r).via === 'copy' ? T('copied', '复制') : T('manual', '手动')}</div></span>
                              : <button style={{ ...sec, padding: '5px 10px', fontSize: 13 }} onClick={() => markSent(r, typeFor(r), 'manual')} title={T('Sent outside the CRM? Mark it here', '在CRM以外发送了？在这里标记')}>⏳ {T('Mark sent', '标记已发')}</button>}
                          </td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <select value={rowType[r.id] || 'auto'} onChange={e => setRowType(m0 => ({ ...m0, [r.id]: e.target.value }))} style={{ ...input, padding: '5px 6px', fontSize: 13 }} title={T('Message type for this player', '这位玩家的信息类型')}>
                                <option value="auto">{T('Auto', '自动')} ({started ? (lang === 'zh' ? GROUPS[r.group].zh : GROUPS[r.group].en) : T('Intro', '活动介绍')})</option>
                                {MSG_TYPES.map(k => <option key={k} value={k}>{MSG_LABEL(k)}</option>)}
                              </select>
                              <button style={{ ...sec, padding: '6px 12px', background: '#25D366', color: '#fff', border: 'none' }} onClick={() => openWa(r, typeFor(r))} title={msgFor(r, typeFor(r))}>💬 WA</button>
                              <button style={{ ...sec, padding: '6px 12px' }} onClick={() => copyMsg(r, typeFor(r))} title={T('Copy message', '复制信息')}>⎘</button>
                              <button style={{ ...sec, padding: '6px 10px', color: '#f85149' }} onClick={() => removePlayer(r)} title={T('Remove from campaign', '移出活动')}>🗑</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {!followRows.length && <tr><td colSpan={12} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>{T('No players in this group.', '此分组没有玩家。')}</td></tr>}
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
                {pastDays.length > 0 && <button style={{ ...sec, padding: '6px 12px', fontWeight: 700, background: allMode ? 'var(--accent)' : 'var(--surface2)', color: allMode ? '#fff' : 'var(--text)' }} onClick={() => setPayDay('ALL')}>📜 {T('All days', '全部日期')}</button>}
                {pastDays.map(d => <button key={d} style={{ ...sec, padding: '6px 12px', background: settle === d ? 'var(--accent)' : 'var(--surface2)', color: settle === d ? '#fff' : 'var(--text)' }} onClick={() => setPayDay(d)}>{d.slice(5)}</button>)}
                {!pastDays.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T('No settled day yet.', '还没有结算日。')}</span>}
                <span style={{ marginLeft: 'auto' }} />
                {payRows.length > 0 && <><button style={{ ...sec, borderColor: 'var(--accent)' }} onClick={copyPayout} title={T('Copy the payout list as text', '复制派发名单文字')}>📋 {T('Copy payout list', '复制派发名单')}</button><button style={sec} onClick={exportPay}>⬇ {T('Export for BO', '导出给BO')}</button><button style={btn} onClick={markAllPaid}>✅ {T('Mark all paid', '全部标记已派发')}</button></>}
              </div>
              {allMode ? (<>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T('Payout history — every settled day of this campaign. Click a day to open its list.', '派发记录 — 本活动每个结算日。点日期打开当天名单。')}</span>
                  <button style={{ ...sec, marginLeft: 'auto', borderColor: 'var(--accent)' }} onClick={copyAllDays}>📋 {T('Copy all days', '复制全部日期')}</button>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{[T('Settled day', '结算日'), T('Pay on', '派发日'), T('Qualified', '达标'), T('Streak bonuses', '连续奖励'), T('Total', '合计'), T('Paid', '已派'), T('Pending', '待派'), T('Status', '状态'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {[...history].reverse().map(h => {
                        const payOn = new Date(new Date(h.day + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
                        const pending = h.items - h.itemsPaid
                        return (
                          <tr key={h.day}>
                            <td style={{ ...td, fontWeight: 800 }}>{h.day}</td>
                            <td style={{ ...td, color: 'var(--muted)' }}>{payOn}</td>
                            <td style={{ ...td, color: '#3fb950', fontWeight: 700 }}>{h.qualified}</td>
                            <td style={{ ...td, color: '#f97316', fontWeight: 700 }}>{h.streakN || '—'}</td>
                            <td style={{ ...td, fontWeight: 700 }}>{curAmt(h.amt)}</td>
                            <td style={{ ...td, color: '#3fb950' }}>{curAmt(h.paid)}</td>
                            <td style={{ ...td, color: pending ? '#f85149' : 'var(--muted)' }}>{curAmt(h.pend)}</td>
                            <td style={td}>{!h.items ? <span style={{ color: 'var(--muted)' }}>{T('Nobody qualified', '无人达标')}</span>
                              : pending ? <span style={{ fontWeight: 700, color: '#f85149' }}>⏳ {pending} {T('pending', '待派')}</span>
                              : <span style={{ fontWeight: 700, color: '#3fb950' }}>✅ {T('All paid', '全部已派')}</span>}</td>
                            <td style={td}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button style={{ ...sec, padding: '5px 10px' }} onClick={() => setPayDay(h.day)}>{T('Open', '打开')}</button>
                                {h.items > 0 && <button style={{ ...sec, padding: '5px 10px' }} onClick={() => { navigator.clipboard.writeText(payoutText(h.day)); flash(T('Copied', '已复制')) }}>📋</button>}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                      {!history.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>{T('No settled day yet.', '还没有结算日。')}</td></tr>}
                      {history.length > 0 && (
                        <tr style={{ background: 'var(--surface2)' }}>
                          <td style={{ ...td, fontWeight: 800 }} colSpan={2}>{T('Campaign total', '活动合计')}</td>
                          <td style={{ ...td, fontWeight: 800, color: '#3fb950' }}>{histTotal.qualified}</td>
                          <td style={{ ...td, fontWeight: 800, color: '#f97316' }}>{histTotal.streakN}</td>
                          <td style={{ ...td, fontWeight: 800 }}>{curAmt(histTotal.amt)}</td>
                          <td style={{ ...td, fontWeight: 800, color: '#3fb950' }}>{curAmt(histTotal.paid)}</td>
                          <td style={{ ...td, fontWeight: 800, color: histTotal.items - histTotal.itemsPaid ? '#f85149' : 'var(--muted)' }}>{curAmt(histTotal.pend)}</td>
                          <td style={{ ...td, fontWeight: 800 }}>{histTotal.itemsPaid}/{histTotal.items} {T('paid', '已派')}</td>
                          <td style={td}></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{T('Amounts are per currency (RM / SGD), not mixed. Follows the Host filter above.', '金额按币种分开（RM / SGD），不混算。跟随上方负责人筛选。')}</div>
              </>) : (<>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{T(`Rewards earned on ${settle || '—'} — pay on the next day. Streak bonus = ${cfg.streak_pct}% of deposits on the ${cfg.streak_days} streak days.`, `${settle || '—'} 的奖励 — 隔天派发。连续奖励 = ${cfg.streak_days} 天连续达标日存款的 ${cfg.streak_pct}%。`)}</div>
              {payRows.length > 0 && (
                <details style={{ marginBottom: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>{T('Preview payout text', '预览派发名单文字')}</summary>
                  <pre style={{ ...card, whiteSpace: 'pre-wrap', fontSize: 14, marginTop: 6, fontFamily: 'inherit' }}>{payoutText()}</pre>
                </details>
              )}
              <div style={{ maxHeight: 'calc(100vh - 430px)', minHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['#', 'VIP', T('Host', '负责人'), T('Turnover', '流水'), T('Tier reward', '阶梯奖励'), T('Paid', '已派'), T('Streak bonus', '连续奖励'), T('Paid', '已派'), T('Total', '合计')].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {payRows.filter(({ r }) => hostOk(r)).map(({ r, d }, i) => {
                      const p = (r.ch_paid || {})[settle] || {}
                      return (
                        <tr key={r.id}>
                          <td style={{ ...td, color: 'var(--muted)' }}>{i + 1}</td>
                          <td style={td}>{nameCell(r, `${r.m.full_name || ''}${r.m.currency && r.m.currency !== 'MYR' ? ` · ${r.m.currency}` : ''}`)}</td>
                          <td style={td}>{r.m.host_assigned || '—'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{sym(r.m.currency)}{fmt(d.vb)}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#3fb950' }}>{d.reward ? fmt(d.reward) : '—'}</td>
                          <td style={td}>{d.reward > 0 && <input type="checkbox" checked={!!p.c} onChange={e => markPaid(r, 'c', e.target.checked)} />}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#f97316' }}>{d.streakBonus ? fmt(d.streakBonus) : '—'}{d.streakBonus ? <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{cfg.streak_pct}% × {fmt(d.streakBase)}</div> : null}</td>
                          <td style={td}>{d.streakBonus > 0 && <input type="checkbox" checked={!!p.s} onChange={e => markPaid(r, 's', e.target.checked)} />}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{fmt(d.reward + d.streakBonus)}</td>
                        </tr>
                      )
                    })}
                    {!payRows.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>{T('Nobody qualified on this day.', '这一天没有人达标。')}</td></tr>}
                  </tbody>
                </table>
              </div>
              </>)}
            </div>
          )}

          {/* ── 📅 grid ── */}
          {tab === 'grid' && (<>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12 }}>{T('Showing', '显示')} <b>{scoped.length}</b> / {players.length} · {T('selected', '已选')} <b style={{ color: '#f85149' }}>{sel.size}</b></span>
              <button style={sec} onClick={() => setSel(new Set(scoped.map(r => r.id)))}>{T('Select all shown', '全选显示中的')}</button>
              <button style={sec} onClick={() => setSel(new Set())}>{T('Clear', '清除')}</button>
              <button style={{ ...sec, background: sel.size ? '#f85149' : 'var(--surface2)', color: sel.size ? '#fff' : 'var(--muted)' }} disabled={!sel.size} onClick={removeSelected}>🗑 {T(`Remove selected (${sel.size})`, `移出已选（${sel.size}）`)}</button>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T('Tip: use the Host buttons above to show e.g. only Jennifer\'s players → Select all shown → Remove.', '提示：先用上面的负责人按钮只显示某位负责人的玩家 → 全选显示中的 → 移出。')}</span>
              <button style={{ ...btn, marginLeft: 'auto' }} onClick={openBulk}>➕ {T('Bulk add by host / tier', '按负责人 / 等级批量加入')}</button>
            </div>
            {bulkOpen && (
              <div style={{ ...card, marginTop: 8 }}>
                {!allVips ? T('Loading…', '载入中…') : <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T('Tier:', '等级：')}</span>
                    {['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER'].map(t0 => <button key={t0} style={{ ...sec, padding: '3px 9px', background: bulkTiers.includes(t0) ? 'var(--accent)' : 'var(--surface2)', color: bulkTiers.includes(t0) ? '#fff' : 'var(--text)' }} onClick={() => toggleArr(bulkTiers, setBulkTiers, t0)}>{t0}</button>)}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, color: 'var(--muted)' }}>{T('Host:', '负责人：')}</span>
                    {[...allHosts, '__none'].map(h => <button key={h} style={{ ...sec, padding: '3px 9px', background: bulkHosts.includes(h) ? 'var(--accent)' : 'var(--surface2)', color: bulkHosts.includes(h) ? '#fff' : 'var(--text)' }} onClick={() => toggleArr(bulkHosts, setBulkHosts, h)}>{h === '__none' ? T('(No host)', '（无负责人）') : h}</button>)}
                  </div>
                  <button style={btn} disabled={!bulkMatches.length} onClick={addBulk}>{T(`Add ${bulkMatches.length} matching players (not yet in campaign)`, `加入 ${bulkMatches.length} 位符合的玩家（尚未在活动中）`)}</button>
                  <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 8 }}>{T('Empty = any. Excluded players are skipped.', '不选 = 全部。已排除的玩家会跳过。')}</span>
                </>}
              </div>
            )}
            <div style={{ marginTop: 10, maxHeight: 'calc(100vh - 430px)', minHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}><input type="checkbox" checked={scoped.length > 0 && scoped.every(r => sel.has(r.id))} onChange={e => setSel(e.target.checked ? new Set([...sel, ...scoped.map(r => r.id)]) : new Set([...sel].filter(id => !scoped.some(r => r.id === id))))} title={T('Select all shown', '全选显示中的')} /></th><th style={th}>#</th><th style={th}>VIP</th>{dates.map(d => <th key={d} style={{ ...th, textAlign: 'center' }}>{d.slice(5)}</th>)}<th style={th}>{T('Deposit', '存款')}</th><th style={th}>{T('Withdrawal', '提款')}</th><th style={th}>{T('Turnover', '流水')}</th><th style={th}>{T('Tier total', '阶梯合计')}</th><th style={th}>{T('Streak', '连续')}</th><th style={th}></th></tr></thead>
                <tbody>
                  {[...scoped].sort((a, b) => b.prog.cost - a.prog.cost).map((r, i) => (
                    <tr key={r.id} style={{ background: sel.has(r.id) ? 'rgba(248,81,73,.08)' : 'transparent' }}>
                      <td style={td}><input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel(s0 => { const n = new Set(s0); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })} /></td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{i + 1}</td>
                      <td style={td}>{nameCell(r, `${r.m.host_assigned || T('(no host)', '（无负责人）')} · ${r.m.tier || r.tier}`)}</td>
                      {r.prog.days.map(d => (
                        <td key={d.date} title={`${T('Turnover', '流水')} ${fmt(d.vb)} · ${T('Deposit', '存款')} ${fmt(d.dep)}`} style={{ ...td, textAlign: 'center', background: d.future ? 'transparent' : d.qualifies ? 'rgba(63,185,80,.12)' : d.vb > 0 ? 'rgba(251,191,36,.08)' : 'transparent' }}>
                          {d.future ? <span style={{ color: 'var(--muted)' }}>·</span> : d.qualifies ? <b style={{ color: '#3fb950' }}>{fmt(d.reward)}</b> : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{d.vb ? fmt(d.vb / 1000) + 'k' : '—'}</span>}
                          {d.streakBonus > 0 && <div style={{ fontSize: 12, color: '#f97316' }}>🔥{fmt(d.streakBonus)}</div>}
                        </td>
                      ))}
                      {(() => { const t = totalsOf(r); return <>
                        <td style={{ ...td, textAlign: 'right' }}>{fmt(t.dep)}</td>
                        <td style={{ ...td, textAlign: 'right', color: t.wd > 0 ? '#f85149' : 'var(--muted)' }}>{fmt(t.wd)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmt(t.vb)}</td>
                      </> })()}
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(r.prog.credit)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#f97316', fontWeight: 700 }}>{fmt(r.prog.streak)}</td>
                      <td style={td}><button style={{ ...sec, padding: '2px 6px', fontSize: 13 }} onClick={() => removePlayer(r)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: 10, display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--border)' }}>
                <input style={{ ...input, flex: 1 }} placeholder={T('Add players: usernames, comma or one per line', '加入玩家：用户名，逗号或每行一个')} value={addIds} onChange={e => setAddIds(e.target.value)} />
                <button style={btn} onClick={addPlayers}>+ {T('Add', '加入')}</button>
              </div>
            </div>
          </>)}

          {/* ── 📈 impact: before / during / after vs comparison group ── */}
          {tab === 'impact' && (
            <div style={{ marginTop: 12 }}>
              <CampaignImpact campaign={camp} big defaultCur={platF !== 'ALL' ? platF : roiMkt}
                costByCur={rowsAll.reduce((o, r) => { const c = curOf(r); o[c] = (o[c] || 0) + (Number(r.prog?.cost) || 0); return o }, {})} />
            </div>
          )}

          {/* ── 📊 summary & ROI ── */}
          {tab === 'summary' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 700 }}>{T('Platform:', '平台：')}</span>
                {markets.map(c => {
                  const n = rowsAll.filter(r => curOf(r) === c).length
                  const lbl = c === 'SGD' ? '🇸🇬 SG (SGD)' : c === 'KHUSD' ? '🇰🇭 KH (USD)' : '🇲🇾 MY (RM)'
                  return <button key={c} style={{ ...sec, background: mkt === c ? 'var(--accent)' : 'var(--surface2)', color: mkt === c ? '#fff' : 'var(--text)', fontWeight: 700 }} onClick={() => setRoiMkt(c)}>{lbl} · {n} {T('players', '位玩家')}</button>
                })}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                {T(`${mkt === 'SGD' ? 'SG' : mkt === 'KHUSD' ? 'KH' : 'MY'} platform only, in ${mkt === 'MYR' ? 'RM' : mkt}. Based on ${roi.passedDays} settled day(s) up to ${asOf || '—'}. GGR = player net loss (house win). Baseline = the same players in the ${rowsAll[0]?.prog.days.length || 0} days before the campaign (${base.from || '—'} → ${base.to || '—'}), scaled to the days passed.`,
                   `仅 ${mkt === 'SGD' ? 'SG' : mkt === 'KHUSD' ? 'KH' : 'MY'} 平台，以 ${mkt === 'MYR' ? 'RM' : mkt} 计。基于截至 ${asOf || '—'} 的 ${roi.passedDays} 个结算日。GGR = 玩家净输（平台赢）。对比基准 = 同一批玩家在活动前 ${rowsAll[0]?.prog.days.length || 0} 天（${base.from || '—'} → ${base.to || '—'}）的表现，按已过天数换算。`)}
              </div>
              <div style={{ fontWeight: 800, fontSize: 16, margin: '4px 0 8px' }}>📋 {T(`Campaign summary — ${camp.start_date} → ${camp.end_date}`, `活动总结 — ${camp.start_date} → ${camp.end_date}`)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }}>
                <Kpi label={T('Players', '玩家')} value={roi.players} sub={`${T('active', '有投注')} ${roi.active}`} />
                <Kpi label={T('Qualified', '达标玩家')} value={roi.qualifiedPlayers} color="#3fb950" sub={roi.players ? pct(roi.qualifiedPlayers / roi.players) + T(' success rate', ' 成功率') : ''} />
                <Kpi label={T('Reward rows', '奖励笔数')} value={roi.rewardRows} sub={T('player-days that hit a tier', '达标的人·天')} />
                <Kpi label={T('Total reward', '总奖励')} value={rmS(roi.cost)} color="var(--accent)" sub={`${T('tier', '阶梯')} ${rmS(roi.credit)} + ${T('streak', '连续')} ${rmS(roi.streak)}`} />
                <Kpi label={T('Paid', '已派发')} value={rmS(roi.paid)} color="#3fb950" />
                <Kpi label={T('Pending', '待派发')} value={rmS(roi.pending)} color={roi.pending > 0 ? '#f85149' : undefined} />
              </div>

              <div style={{ fontWeight: 800, fontSize: 16, margin: '18px 0 8px' }}>💼 {T('Campaign P&L — real platform data', '活动盈亏 — 平台真实数据')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }}>
                <Kpi label={T('Real deposit', '真实存款')} value={rmS(roi.dep)} color="#3fb950" />
                <Kpi label={T('Real withdrawal', '真实提款')} value={rmS(roi.wd)} color="#f85149" />
                <Kpi label={T('Real valid bet', '真实有效投注')} value={rmS(roi.vb)} sub={`${T('cost', '成本')} ${pct(roi.costPctTo)} ${T('of turnover', '占流水')}`} />
                <Kpi label={T('Reward cost', '奖励成本')} value={rmS(roi.cost)} color="var(--accent)" />
                <Kpi label={T('Net P&L', '净盈亏')} value={rmS(roi.netPL)} color={roi.netPL >= 0 ? '#3fb950' : '#f85149'} sub={T('deposit − withdrawal − cost', '存款 − 提款 − 成本')} />
                <Kpi label="ROI" value={pct(roi.plRoi)} color={roi.plRoi == null ? 'var(--muted)' : roi.plRoi >= 0 ? '#3fb950' : '#f85149'} sub={T('Net P&L ÷ reward cost', '净盈亏 ÷ 奖励成本')} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14, marginTop: 14 }}>
                <Kpi label={T('GGR (house win)', 'GGR（平台赢）')} value={rmS(roi.ggr)} color={roi.ggr >= 0 ? '#3fb950' : '#f85149'} sub={T('player net loss in the period', '期间玩家净输')} />
                <Kpi label={T('GGR ROI', 'GGR ROI')} value={pct(roi.roi)} color={roi.roi == null ? 'var(--muted)' : roi.roi >= 0 ? '#3fb950' : '#f85149'} sub={T('(GGR − cost) ÷ cost', '（GGR − 成本）÷ 成本')} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 14px' }}>{T('Net P&L and ROI use the same formula as the other campaigns (deposit − withdrawal − reward cost). GGR ROI uses the actual house win.', '净盈亏与 ROI 和其他活动用同一公式（存款 − 提款 − 奖励成本）。GGR ROI 用平台实际赢的金额。')}</div>

              <div style={{ ...card, marginTop: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>📈 {T('vs. before the campaign (same players, same number of days)', '与活动前对比（同一批玩家、相同天数）')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
                  <Kpi label={T('Turnover uplift', '流水增长')} value={rmS(roi.upVb)} color={roi.upVb >= 0 ? '#3fb950' : '#f85149'} sub={`${T('before', '活动前')} ${rmS(roi.bVb)} → ${T('now', '活动中')} ${rmS(roi.vb)} (${roi.bVb > 0 ? (roi.upVb >= 0 ? '+' : '') + pct(roi.upVb / roi.bVb) : '—'})`} />
                  <Kpi label={T('GGR uplift', 'GGR 增长')} value={rmS(roi.upGgr)} color={roi.upGgr >= 0 ? '#3fb950' : '#f85149'} sub={`${T('before', '活动前')} ${rmS(roi.bGgr)} → ${T('now', '活动中')} ${rmS(roi.ggr)}`} />
                  <Kpi label={T('Incremental ROI', '增量 ROI')} value={pct(roi.incRoi)} color={roi.incRoi == null ? 'var(--muted)' : roi.incRoi >= 0 ? '#3fb950' : '#f85149'} sub={T('(GGR uplift − cost) ÷ cost', '（GGR增长 − 成本）÷ 成本')} />
                  <Kpi label={T('Active players', '活跃玩家')} value={`${roi.active}`} sub={`${T('before', '活动前')} ${roi.bActive}`} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{T('GGR swings a lot day to day (players can win). Turnover uplift is the steadier signal; judge ROI after the campaign ends.', 'GGR 每天波动很大（玩家可能赢）。流水增长是更稳定的指标，ROI 建议在活动结束后再判断。')}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 14, marginTop: 14 }}>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
                  <div style={{ fontWeight: 800, fontSize: 15, padding: '10px 12px' }}>📅 {T('By day', '按天')}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{[T('Day', '日期'), T('Active', '有投注'), T('Qualified', '达标'), T('Tier credit', '阶梯奖励'), T('Streak', '连续'), T('Turnover', '流水'), T('Deposit', '存款'), 'GGR', T('Cost % TO', '成本/流水')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {Object.keys(roi.byDay).sort().map(d => { const x = roi.byDay[d]; const c0 = x.credit + x.streak; return (
                        <tr key={d}>
                          <td style={{ ...td, fontWeight: 700 }}>{d}</td><td style={td}>{x.active}</td><td style={{ ...td, color: '#3fb950', fontWeight: 700 }}>{x.qualified}</td>
                          <td style={td}>{rmS(x.credit)}</td><td style={{ ...td, color: '#f97316' }}>{rmS(x.streak)}</td><td style={td}>{rmS(x.vb)}</td><td style={td}>{rmS(x.dep)}</td>
                          <td style={{ ...td, color: x.ggr >= 0 ? '#3fb950' : '#f85149' }}>{rmS(x.ggr)}</td><td style={td}>{x.vb > 0 ? pct(c0 / x.vb) : '—'}</td>
                        </tr>) })}
                      {!Object.keys(roi.byDay).length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>{T('No settled day yet.', '还没有结算日。')}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
                  <div style={{ fontWeight: 800, fontSize: 15, padding: '10px 12px' }}>🎯 {T('Tier hits (player-days)', '各档达成次数（人·天）')}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{[T('Tier', '档位'), T('Hits', '次数'), T('Cost', '成本')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {roi.tiersS.map((t0, i) => <tr key={i}><td style={td}>{fmt(t0.turnover)} → {fmt(t0.reward)}</td><td style={{ ...td, fontWeight: 700 }}>{roi.byTier[i] || 0}</td><td style={td}>{fmt((roi.byTier[i] || 0) * t0.reward)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto', marginTop: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 15, padding: '10px 12px' }}>👤 {T('By host', '按负责人')}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{[T('Host', '负责人'), T('Players', '玩家'), T('Qualified', '达标'), T('Cost', '成本'), T('Turnover', '流水'), T('Deposit', '存款'), 'GGR', 'ROI'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {Object.entries(roi.byHost).sort((a, b) => b[1].vb - a[1].vb).map(([h, x]) => (
                      <tr key={h}><td style={{ ...td, fontWeight: 700 }}>{h}</td><td style={td}>{x.players}</td><td style={td}>{x.qualified}</td><td style={td}>{rmS(x.cost)}</td><td style={td}>{rmS(x.vb)}</td><td style={td}>{rmS(x.dep)}</td>
                        <td style={{ ...td, color: x.ggr >= 0 ? '#3fb950' : '#f85149' }}>{rmS(x.ggr)}</td><td style={td}>{x.cost > 0 ? pct((x.ggr - x.cost) / x.cost) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {cfg.streak_enabled && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, margin: '4px 0 8px' }}>🔥 {T('Streak bonus summary', '连续奖励总结')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }}>
                    <Kpi label={T('Streak days target', '连续天数要求')} value={cfg.streak_days} sub={`${cfg.streak_pct}% ${T('of deposits', '存款')} · ${cfg.streak_style === 'rolling' ? T('rolling', '滚动') : T('every N days', '每N天一轮')}`} />
                    <Kpi label={T('Players with streak', '拿到连续奖励的玩家')} value={roi.streakPlayers.size} />
                    <Kpi label={T('Total bonuses', '连续奖励次数')} value={roi.streakList.length} />
                    <Kpi label={T('Paid amount', '已派金额')} value={rmS(roi.streakPaid)} color="#3fb950" />
                    <Kpi label={T('Pending amount', '待派金额')} value={rmS(roi.streakPending)} color={roi.streakPending > 0 ? '#f85149' : undefined} />
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto', marginTop: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['#', T('Player', '玩家'), T('Streak #', '第几次'), T('Earned on', '达成日'), T('Deposit base', '存款基数'), T('Bonus amount', '奖励金额'), T('Status', '状态')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {roi.streakList.sort((x, y) => x.date.localeCompare(y.date) || y.bonus - x.bonus).map((x, i) => (
                          <tr key={x.username + x.date}>
                            <td style={{ ...td, color: 'var(--muted)' }}>{i + 1}</td>
                            <td style={{ ...td, fontWeight: 700 }}>{x.username}</td>
                            <td style={{ ...td, color: '#f97316' }}>🔥 #{x.n}</td>
                            <td style={td}>{x.date}</td>
                            <td style={td}>{rmS(x.base)}</td>
                            <td style={{ ...td, fontWeight: 700, color: '#3fb950' }}>{rmS(x.bonus)}</td>
                            <td style={td}><span style={{ fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: x.paid ? 'rgba(63,185,80,.15)' : 'rgba(248,81,73,.15)', color: x.paid ? '#3fb950' : '#f85149' }}>{x.paid ? T('✓ Paid', '✓ 已派') : T('Pending', '待派')}</span></td>
                          </tr>
                        ))}
                        {!roi.streakList.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 20 }}>{T('No streak bonus yet.', '暂时没有连续奖励。')}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{T(`Total streak bonus cost: ${rmS(roi.streak)} (${roi.streakList.filter(x => x.paid).length} paid · ${roi.streakList.filter(x => !x.paid).length} pending). Mark paid in 💰 Payout.`, `连续奖励总成本：${rmS(roi.streak)}（${roi.streakList.filter(x => x.paid).length} 已派 · ${roi.streakList.filter(x => !x.paid).length} 待派）。在 💰 派发 标记已派。`)}</div>
                </div>
              )}
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
        {openP && (() => {
          const r = rowsAll.find(x => x.id === openP.id) || openP
          const c = sym(r.m.currency)
          const t = totalsOf(r)
          return (
            <div onClick={e => e.target === e.currentTarget && setOpenP(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1250, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 30, overflow: 'auto' }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, width: '100%', maxWidth: 1100 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{r.username}</div>
                  <button style={{ ...sec, padding: '4px 10px' }} onClick={() => copyName(r.username)}>⎘</button>
                  <div style={{ fontSize: 14, color: 'var(--muted)' }}>{r.m.full_name || ''} · {r.m.tier || r.tier} · {r.m.host_assigned || T('(no host)', '（无负责人）')} · {r.m.currency || 'MYR'}{(r.m.whatsapp || r.m.phone) ? ` · 📞 ${String(r.m.whatsapp || r.m.phone).replace(/\D/g, '')}` : ''}</div>
                  {(r.m.whatsapp || r.m.phone) && <button style={{ ...sec, padding: '4px 10px' }} onClick={() => { const ph = String(r.m.whatsapp || r.m.phone).replace(/\D/g, ''); navigator.clipboard.writeText(ph); flash(T(`Copied ${ph}`, `已复制 ${ph}`)) }}>📞 ⎘</button>}
                  <button style={{ ...sec, marginLeft: 'auto' }} onClick={() => setOpenP(null)}>✕ {T('Close', '关闭')}</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginTop: 14 }}>
                  <Kpi label={T('Deposit (period)', '存款（期间）')} value={c + fmt(t.dep)} />
                  <Kpi label={T('Withdrawal (period)', '提款（期间）')} value={c + fmt(t.wd)} color={t.wd > 0 ? '#f85149' : undefined} />
                  <Kpi label={T('Net deposit', '净存款')} value={c + fmt(t.dep - t.wd)} />
                  <Kpi label={T('Turnover (period)', '流水（期间）')} value={c + fmt(t.vb)} />
                  <Kpi label={T('Player win/loss', '玩家输赢')} value={(t.wl < 0 ? '-' : '+') + c + fmt(Math.abs(t.wl))} color={t.wl < 0 ? '#f85149' : '#3fb950'} />
                  <Kpi label={T('Rewards earned', '已得奖励')} value={fmt(r.prog.cost)} sub={`${T('tier', '阶梯')} ${fmt(r.prog.credit)} + ${T('streak', '连续')} ${fmt(r.prog.streak)}`} color="var(--accent)" />
                </div>
                <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{[T('Day', '日期'), T('Deposit', '存款'), T('Withdrawal', '提款'), T('Turnover', '流水'), T('Win/Loss', '输赢'), T('Tier reward', '阶梯奖励'), T('Streak', '连续'), T('Streak bonus', '连续奖励')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {r.prog.days.map(d => { const x = daily[r.username]?.[d.date] || {}; return (
                        <tr key={d.date} style={{ opacity: d.future ? 0.4 : 1 }}>
                          <td style={{ ...td, fontWeight: 700 }}>{d.date}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{d.future ? '—' : c + fmt(x.dep)}</td>
                          <td style={{ ...td, textAlign: 'right', color: num(x.wd) > 0 ? '#f85149' : undefined }}>{d.future ? '—' : c + fmt(x.wd)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{d.future ? '—' : c + fmt(x.vb)}</td>
                          <td style={{ ...td, textAlign: 'right', color: num(x.wl) < 0 ? '#f85149' : num(x.wl) > 0 ? '#3fb950' : undefined }}>{d.future ? '—' : (num(x.wl) < 0 ? '-' : '+') + c + fmt(Math.abs(num(x.wl)))}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: d.reward ? '#3fb950' : 'var(--muted)' }}>{d.future ? T('upcoming', '未到') : d.reward ? fmt(d.reward) : (d.vb > 0 && tiers[0] ? T(`needs ${fmt(tiers[0].turnover - d.vb)} more`, `差 ${fmt(tiers[0].turnover - d.vb)}`) : '—')}</td>
                          <td style={td}>{d.run > 0 ? '🔥'.repeat(Math.min(d.run, 5)) : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#f97316', fontWeight: 700 }}>{d.streakBonus ? fmt(d.streakBonus) : '—'}</td>
                        </tr>) })}
                      <tr style={{ background: 'var(--surface2)' }}>
                        <td style={{ ...td, fontWeight: 800 }}>{T('Total', '合计')}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{c + fmt(t.dep)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{c + fmt(t.wd)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{c + fmt(t.vb)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{(t.wl < 0 ? '-' : '+') + c + fmt(Math.abs(t.wl))}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#3fb950' }}>{fmt(r.prog.credit)}</td>
                        <td style={td}></td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#f97316' }}>{fmt(r.prog.streak)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
                  <span>{T(`Data up to ${asOf || '—'}. Win/loss is from the player's side (minus = player lost).`, `数据截至 ${asOf || '—'}。输赢以玩家角度计（负数 = 玩家输）。`)}</span>
                  <button style={{ ...sec, color: '#f85149' }} onClick={async () => { await removePlayer(r); setOpenP(null) }}>🗑 {T('Remove from campaign', '移出活动')}</button>
                </div>
              </div>
            </div>
          )
        })()}
        {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--surface)', border: '1px solid var(--accent)', padding: '10px 14px', borderRadius: 8, zIndex: 1300, fontSize: 13 }}>{toast}</div>}
      </div>
    </div>
  )
}
