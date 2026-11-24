// src/pages/Surewin2.jsx — VIP Operations / 🆕 sureWin 2.0 (2026-11-24)
// sureWin 1.0 is under maintenance; MY players were invited to the new sureWin 2.0 (MY only, same username, new register).
// Data = 2.0 BO "Realtime All Member Detail" export, uploaded on this page into public.sw2_members (latest upload wins).
// Each 2.0 account is matched to the 1.0 CRM player by username (lower case), or by phone when the username is new.
// Groups: not joined yet / joined, no deposit / deposited / got a 2.0 bonus / new on 2.0 (not a 1.0 CRM player).
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/depositProfile'
import { PageHeader, Card, KpiCard, Btn, LoadingState, ErrorState, EmptyState, TierBadge, StatusBadge } from '../components/ui'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../hooks/useAuth'
import { WaButton } from '../components/WaSenderModal'
import CopyBtn from '../components/CopyBtn'

const CUR = 'MYR'
const DAY = 86400000
const TIER_ORDER = { BLACK: 0, 'DIAMOND-P': 1, DIAMOND: 1, PLATINUM: 2, GOLD: 3, SILVER: 4, BRONZE: 5 }
const SCOPES = {
  GOLDPLUS: ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD'],
  DIAMOND: ['BLACK', 'DIAMOND-P', 'DIAMOND'], PLATINUM: ['PLATINUM'], GOLD: ['GOLD'], SILVER: ['SILVER'], BRONZE: ['BRONZE'],
  ALL: null,
}
const myToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const daysAgo = (d, base) => (d ? Math.floor((new Date(base + 'T00:00:00Z') - new Date(String(d).slice(0, 10) + 'T00:00:00Z')) / DAY) : null)
const n = v => Number(v || 0)
const cost = r => n(r.total_bonus) + n(r.total_promo)

// ── Upload: parse the 2.0 BO export ─────────────────────────────────────────────────────────────
const clean = v => {
  if (v == null) return ''
  let s = String(v).trim()
  if (s.startsWith('="') && s.endsWith('"')) s = s.slice(2, -1)
  return s.trim()
}
const num = v => { const x = parseFloat(clean(v).replace(/,/g, '')); return Number.isFinite(x) ? x : 0 }
const ts = v => {
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ')
  const s = clean(v)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 19) : null
}
// MY phone → comparable digits (drop +60 / 60 / leading 0)
const phoneKey = p => {
  let d = String(p || '').replace(/\D/g, '')
  if (d.startsWith('60')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  return d.length >= 8 ? d : ''
}
const C = {
  login: 'Login', group: 'Member Group', tag: 'Member Tag', active: 'Last Active Date', status: 'Account Status', aff: 'Affiliate Login',
  phone: 'Phone Number', name: 'Kyc FullName', lastDep: 'Last Deposit Date', lastDepAmt: 'Last Deposit Amount',
  depN: 'Deposit - Dep', dep: 'Deposit - Total Deposit', wdN: 'Withdrawal - Wd', wd: 'Withdrawal - Total Withdrawal',
  betN: 'Bets - Bet', bet: 'Bets - Bet Amount', vb: 'Bets - Valid Bet Amount', pwl: 'Bets - Player Win/Loss',
  promoN: 'Expenses/Cost - Promotion Count', promo: 'Expenses/Cost - Total Promo Amount',
  bonusN: 'Expenses/Cost - Bonus Count', bonus: 'Expenses/Cost - Total Bonus Amount', rebate: 'Expenses/Cost - Rebate', twl: 'Total Win/Loss',
}
async function parseSw2File(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true, cellDates: true, dense: true })
  const out = []
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true })
    if (!rows.length || !(C.login in rows[0])) continue
    for (const r of rows) {
      const login = clean(r[C.login])
      if (!login) continue
      const group = clean(r[C.group])
      out.push({
        username: login.toLowerCase(), login, member_group: group || null, account_status: clean(r[C.status]) || null,
        phone: clean(r[C.phone]) || null, affiliate: clean(r[C.aff]) || null, full_name: clean(r[C.name]) || null,
        last_active_at: ts(r[C.active]), last_deposit_at: ts(r[C.lastDep]), last_deposit_amount: num(r[C.lastDepAmt]),
        deposit_count: Math.round(num(r[C.depN])), total_deposit: num(r[C.dep]),
        withdrawal_count: Math.round(num(r[C.wdN])), total_withdrawal: Math.abs(num(r[C.wd])),
        bet_count: Math.round(num(r[C.betN])), bet_amount: num(r[C.bet]), valid_bet: num(r[C.vb]), player_win_loss: num(r[C.pwl]),
        promo_count: Math.round(num(r[C.promoN])), total_promo: num(r[C.promo]),
        bonus_count: Math.round(num(r[C.bonusN])), total_bonus: num(r[C.bonus]), rebate: num(r[C.rebate]), total_win_loss: num(r[C.twl]),
        is_test: /test/i.test(group) || /test/i.test(clean(r[C.tag])),
      })
    }
  }
  return out
}
// Export time: from the file name (…-20261124043800 = UTC) or else the latest activity in the file
function exportTime(fileName, rows) {
  const m = String(fileName).match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
  if (m) {
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    return new Date(utc + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
  }
  return rows.reduce((mx, r) => [r.last_active_at, r.last_deposit_at, mx].filter(Boolean).sort().pop(), null)
    || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
}

// Match 2.0 accounts to 1.0 CRM players (MYR): same username (lower case) first, then a unique phone match
async function matchToCrm(rows) {
  const crm = await fetchAll(() => supabase.from('vip_members_all').select('username,phone,whatsapp').eq('currency', CUR).order('username'))
  const byName = new Map(), byPhone = new Map()
  for (const c of crm) {
    if (!byName.has(c.username.toLowerCase())) byName.set(c.username.toLowerCase(), c.username)
    for (const p of new Set([phoneKey(c.phone), phoneKey(c.whatsapp)])) {
      if (!p) continue
      if (!byPhone.has(p)) byPhone.set(p, new Set())
      byPhone.get(p).add(c.username)
    }
  }
  const claimed = new Set()
  for (const r of rows) {
    const v1 = byName.get(r.username)
    r.v1_username = v1 || null; r.match_type = v1 ? 'username' : null
    if (v1) claimed.add(v1)
  }
  for (const r of rows) {
    if (r.v1_username || r.is_test) continue
    const cands = [...(byPhone.get(phoneKey(r.phone)) || [])].filter(u => !claimed.has(u))
    if (cands.length === 1) { r.v1_username = cands[0]; r.match_type = 'phone'; claimed.add(cands[0]) }
  }
}
const DAILY_COLS = ['deposit_count', 'total_deposit', 'withdrawal_count', 'total_withdrawal', 'bet_count', 'bet_amount', 'valid_bet', 'player_win_loss',
  'promo_count', 'total_promo', 'bonus_count', 'total_bonus', 'rebate', 'total_win_loss']

function UploadBox({ L2, onDone }) {
  const [kind, setKind] = useState('daily')
  const [date, setDate] = useState(() => new Date(Date.now() + 8 * 3600000 - DAY).toISOString().slice(0, 10))
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const saveChunks = async (table, payload, onConflict) => {
    for (let i = 0; i < payload.length; i += 500) {
      setMsg(L2(`Saving ${Math.min(i + 500, payload.length)} / ${payload.length}…`, `正在保存 ${Math.min(i + 500, payload.length)} / ${payload.length}…`))
      const { error } = await supabase.from(table).upsert(payload.slice(i, i + 500), { onConflict })
      if (error) throw error
    }
  }
  const run = async () => {
    if (!files.length) return
    setBusy(true)
    try {
      const file = files[0]
      setMsg(L2(`Reading ${file.name}…`, `正在读取 ${file.name}…`))
      const rows = await parseSw2File(file)
      if (!rows.length) throw new Error(L2('No "Login" column found. Use the 2.0 BO Realtime All Member Detail export.', '找不到 "Login" 列，请使用 2.0 后台 Realtime All Member Detail 导出文件。'))
      setMsg(L2('Matching with sureWin 1.0 players in the CRM…', '正在与 CRM 里的 sureWin 1.0 玩家配对…'))
      await matchToCrm(rows)
      const now = new Date().toISOString()
      let done
      if (kind === 'daily') {
        // one day's own figures: replace that day completely (players missing from the file = nothing that day)
        const payload = rows.filter(r => !r.is_test).map(r => {
          const o = { username: r.username, snapshot_date: date, v1_username: r.v1_username, member_group: r.member_group, updated_at: now }
          for (const k of DAILY_COLS) o[k] = r[k]
          return o
        })
        const { error: de } = await supabase.from('sw2_daily').delete().eq('snapshot_date', date)
        if (de) throw de
        await saveChunks('sw2_daily', payload, 'username,snapshot_date')
        const dep = payload.filter(r => r.total_deposit > 0)
        const depSum = formatMoney(dep.reduce((s, r) => s + r.total_deposit, 0), CUR)
        done = L2(`✅ Done: ${date} saved, ${payload.length} players (${dep.length} deposited, ${depSum}).`,
          `✅ 完成：已保存 ${date}，${payload.length} 位玩家（${dep.length} 位存款，${depSum}）。`)
      } else {
        const snapshot_at = exportTime(file.name, rows)
        await saveChunks('sw2_members', rows.map(r => ({ ...r, snapshot_at, updated_at: now })), 'username')
        const byU = rows.filter(r => r.match_type === 'username').length, byP = rows.filter(r => r.match_type === 'phone').length
        done = L2(`✅ Done: ${rows.length} players saved (file time ${snapshot_at}). ${byU} matched by username, ${byP} by phone, ${rows.length - byU - byP} new on 2.0.`,
          `✅ 完成：已保存 ${rows.length} 位玩家（文件时间 ${snapshot_at}）。用户名配对 ${byU}，电话配对 ${byP}，2.0 新玩家 ${rows.length - byU - byP}。`)
      }
      setMsg(L2('Updating player status (1.0 + 2.0 deposits)…', '正在更新玩家状态（1.0 + 2.0 存款）…'))
      await supabase.rpc('refresh_days_inactive')
      setMsg(done)
      setFiles([])
      onDone && onDone()
    } catch (e) {
      setMsg('❌ ' + (e?.message || String(e)))
    }
    setBusy(false)
  }
  const inp = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 7, fontSize: 13 }
  return (
    <Card style={{ marginBottom: 16, padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>📥 {L2('Upload sureWin 2.0 file', '上传 sureWin 2.0 文件')}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {L2('2.0 BO → Realtime All Member Detail export (.xlsx). "One day" = the export filtered to one date (daily figures for VIP360). "All-time totals" = the export since 2.0 opened (who joined, phone, bonus totals). Uploading the same day again replaces it.',
          '2.0 后台 → Realtime All Member Detail 导出（.xlsx）。"单日" = 筛选某一天的导出（VIP360 每日数字）。"全部累计" = 2.0 开业至今的导出（谁加入、电话、奖金总额）。同一天重新上传会覆盖。')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>{L2('File type', '文件类型')}{' '}
          <select value={kind} onChange={e => setKind(e.target.value)} style={inp} disabled={busy}>
            <option value="daily">{L2('One day', '单日')}</option>
            <option value="total">{L2('All-time totals', '全部累计')}</option>
          </select>
        </label>
        {kind === 'daily' && <label style={{ fontSize: 12 }}>{L2('Date of the figures', '数字的日期')}{' '}
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} disabled={busy} />
        </label>}
        <input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={e => setFiles([...e.target.files])} style={{ fontSize: 12 }} />
        <Btn variant="primary" onClick={run} disabled={busy || !files.length || (kind === 'daily' && !date)}>{busy ? L2('Uploading…', '上传中…') : L2('Upload', '上传')}</Btn>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 8 }}>{msg}</div>}
    </Card>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────────────────────
export default function Surewin2() {
  const navigate = useNavigate()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const { profile } = useAuth()
  const canUpload = ['admin', 'host'].includes(profile?.role)
  const [scope, setScope] = useState('GOLDPLUS')
  const [group, setGroup] = useState('not')
  const [host, setHost] = useState('All')
  const [search, setSearch] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [sw2, setSw2] = useState([])
  const [crm, setCrm] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const s2 = await fetchAll(() => supabase.from('sw2_members').select('*').order('username'))
      const tiers = SCOPES[scope]
      const mem = await fetchAll(() => {
        let q = supabase.from('vip_members_all')
          .select('id,username,full_name,tier,phone,whatsapp,host_assigned,last_contacted,activity_status,days_inactive,last_deposit_date,currency')
          .eq('currency', CUR).eq('is_excluded', false)
        if (tiers) q = q.in('tier', tiers)
        return q.order('username')
      })
      setSw2(s2); setCrm(mem)
    } catch (e) { setError(e?.message || String(e)) }
    setLoading(false)
  }, [scope])
  useEffect(() => { load() }, [load, reloadKey])

  const snapAt = useMemo(() => sw2.reduce((m, r) => (r.snapshot_at > (m || '') ? r.snapshot_at : m), null), [sw2])
  const base = snapAt ? String(snapAt).slice(0, 10) : myToday()

  // one row per CRM player in scope (+ their 2.0 account), and one per 2.0-only account
  const all = useMemo(() => {
    const byV1 = new Map(sw2.filter(r => r.v1_username).map(r => [r.v1_username, r]))
    const rows = crm.map(m => ({ key: m.username, crm: m, s2: byV1.get(m.username) || null, tier: m.tier }))
    const extra = sw2.filter(r => !r.v1_username && !r.is_test)
      .map(r => ({ key: '2.0:' + r.username, crm: null, s2: r, tier: String(r.member_group || '').toUpperCase().trim() }))
    return { rows, extra }
  }, [sw2, crm])

  const inHost = r => host === 'All' || (host === '—' ? !r.crm?.host_assigned : r.crm?.host_assigned === host)
  const q = search.trim().toLowerCase()
  const inSearch = r => !q || r.key.toLowerCase().includes(q) || (r.s2?.username || '').includes(q) || (r.crm?.full_name || '').toLowerCase().includes(q)
  const base1 = all.rows.filter(inHost)
  const groups = {
    not: base1.filter(r => !r.s2),
    nodep: base1.filter(r => r.s2 && n(r.s2.total_deposit) <= 0),
    dep: base1.filter(r => r.s2 && n(r.s2.total_deposit) > 0),
    bonus: [...base1.filter(r => r.s2 && cost(r.s2) > 0), ...(scope === 'ALL' && host === 'All' ? all.extra.filter(r => cost(r.s2) > 0) : [])],
    new: host === 'All' || host === '—' ? all.extra : [],
  }
  const joined = base1.filter(r => r.s2)
  const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0)
  const list = (groups[group] || []).filter(inSearch).sort((a, b) => {
    if (group === 'not') return String(b.crm?.last_deposit_date || '').localeCompare(String(a.crm?.last_deposit_date || '')) || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9)
    if (group === 'bonus') return cost(b.s2) - cost(a.s2)
    return (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || n(b.s2?.total_deposit) - n(a.s2?.total_deposit)
  })
  const hosts = useMemo(() => [...new Set(crm.map(m => m.host_assigned).filter(Boolean))].sort(), [crm])

  const GROUPS = [
    { k: 'not', icon: '⏳', en: 'Not joined yet', zh: '还没加入', n: groups.not.length, sub: L2('call them', '需联系') },
    { k: 'nodep', icon: '🟡', en: 'Joined, no deposit', zh: '已加入未存款', n: groups.nodep.length, sub: L2('push first deposit', '推动首存') },
    { k: 'dep', icon: '✅', en: 'Joined + deposited', zh: '已加入已存款', n: groups.dep.length, sub: formatMoney(sum(groups.dep, r => n(r.s2.total_deposit)), CUR) },
    { k: 'bonus', icon: '🎁', en: 'Got 2.0 bonus', zh: '已领 2.0 奖金', n: groups.bonus.length, sub: formatMoney(sum(groups.bonus, r => cost(r.s2)), CUR) },
    { k: 'new', icon: '🆕', en: 'New on 2.0 only', zh: '2.0 新玩家', n: groups.new.length, sub: L2('not a 1.0 CRM player', '非 1.0 CRM 玩家') },
  ]

  const me = profile?.full_name || 'Agent'
  const waText = r => {
    const u = r.s2?.login || r.key
    if (!r.s2) return {
      en: `Hi bro *${u}*! 👋 I'm ${me} from sureWin VIP department.\n\nsureWin 1.0 is under maintenance now, so we opened *sureWin 2.0* for you guys to keep playing 😄 Just register there with the *same username* (${u}) and you're good to go.\n\nWhatsApp me if you need the link or any help ya, I settle for you 💎`,
      cn: `嗨 *${u}*！👋 我是sureWin VIP部门的${me}。\n\nsureWin 1.0 现在在维护，所以我们开了 *sureWin 2.0* 给大家继续玩 😄 你只要用 *同一个用户名*（${u}）注册就可以了。\n\n需要链接或任何帮忙，直接WhatsApp我哦，我帮你搞定 💎`,
    }
    if (n(r.s2.total_deposit) <= 0) return {
      en: `Hi bro *${u}*! 👋 I'm ${me} from sureWin VIP department.\n\nSaw you already registered on sureWin 2.0, thanks bro 🙏 Everything ok there? If you need help with your first deposit or want me to check what promo you can take, just WhatsApp me ya 💎`,
      cn: `嗨 *${u}*！👋 我是sureWin VIP部门的${me}。\n\n看到你已经在 sureWin 2.0 注册了，谢谢你 🙏 用得还顺吗？第一次存款需要帮忙，或想我帮你看看有什么优惠，直接WhatsApp我哦 💎`,
    }
    return {
      en: `Hi bro *${u}*! 👋 I'm ${me} from sureWin VIP department.\n\nThanks for coming over to sureWin 2.0 bro 🙏 Just checking in, everything running smooth? Anything you need, WhatsApp me ya 💎`,
      cn: `嗨 *${u}*！👋 我是sureWin VIP部门的${me}。\n\n谢谢你来 sureWin 2.0 🙏 来问候一下，玩得顺不顺？有什么需要直接WhatsApp我哦 💎`,
    }
  }

  const exportXlsx = () => {
    const data = list.map(r => ({
      Group: L2(GROUPS.find(g => g.k === group).en, GROUPS.find(g => g.k === group).zh),
      'Tier (1.0)': r.crm?.tier || '', '1.0 username': r.crm?.username || '', '2.0 username': r.s2?.login || '',
      'Matched by': r.s2?.match_type || '', Name: r.crm?.full_name || r.s2?.full_name || '',
      'Phone (CRM)': r.crm?.whatsapp || r.crm?.phone || '', 'Phone (2.0)': r.s2?.phone || '',
      Host: r.crm?.host_assigned || '', '1.0 last deposit': r.crm?.last_deposit_date || '', '1.0 status': r.crm?.activity_status || '',
      '2.0 group': r.s2?.member_group || '', '2.0 last active': String(r.s2?.last_active_at || '').slice(0, 16),
      '2.0 deposits': n(r.s2?.deposit_count), '2.0 total deposit (RM)': n(r.s2?.total_deposit), '2.0 withdrawal (RM)': n(r.s2?.total_withdrawal),
      '2.0 last deposit': String(r.s2?.last_deposit_at || '').slice(0, 16), '2.0 valid bet (RM)': n(r.s2?.valid_bet),
      '2.0 bonus (RM)': n(r.s2?.total_bonus), '2.0 promo (RM)': n(r.s2?.total_promo), '2.0 player win/loss after bonus (RM)': n(r.s2?.total_win_loss),
      'Last contacted': String(r.crm?.last_contacted || '').slice(0, 10),
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'sureWin 2.0')
    XLSX.writeFile(wb, `sureWin 2.0 ${GROUPS.find(g => g.k === group).en} ${base}.xlsx`)
  }

  const sel = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 7, fontSize: 13 }
  const th = { padding: '9px 12px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' }
  const sub = { fontSize: 11, color: 'var(--muted)' }

  return (
    <div style={{ padding: '24px 28px' }}>
      <PageHeader title={L2('🆕 sureWin 2.0', '🆕 sureWin 2.0')}
        subtitle={L2('MY players moving from sureWin 1.0 to 2.0: who joined, who deposited, who got a bonus, who still needs a call.',
          'MY 玩家从 sureWin 1.0 转到 2.0：谁加入了、谁存款了、谁领了奖金、谁还需要联系。')} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {snapAt ? L2(`📅 2.0 file: ${String(snapAt).slice(0, 16)} (MY time)`, `📅 2.0 文件：${String(snapAt).slice(0, 16)}（马来西亚时间）`) : L2('No 2.0 file uploaded yet.', '还没有上传 2.0 文件。')}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canUpload && <Btn onClick={() => setShowUpload(s => !s)}>📥 {L2('Upload 2.0 file', '上传 2.0 文件')}</Btn>}
          <Btn onClick={exportXlsx} disabled={!list.length}>⬇ {L2('Download (.xlsx)', '下载 (.xlsx)')}</Btn>
        </div>
      </div>

      {canUpload && (showUpload || (!loading && !snapAt)) && <UploadBox L2={L2} onDone={() => { setShowUpload(false); setReloadKey(k => k + 1) }} />}

      <Card style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('1.0 tier', '1.0 等级')}<br />
            <select value={scope} onChange={e => setScope(e.target.value)} style={sel}>
              <option value="GOLDPLUS">{L2('Gold and above', 'Gold 及以上')}</option>
              {['DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE'].map(t => <option key={t} value={t}>{t}</option>)}
              <option value="ALL">{L2('All tiers', '全部等级')}</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Host', '负责人')}<br />
            <select value={host} onChange={e => setHost(e.target.value)} style={sel}>
              <option value="All">{L2('All hosts', '全部负责人')}</option>
              <option value="—">{L2('No host', '无负责人')}</option>
              {hosts.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Search', '搜索')}<br />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L2('username / name', '用户名 / 名字')} style={{ ...sel, width: 180 }} />
          </label>
          {!loading && (
            <div style={{ fontSize: 12, color: 'var(--muted)', paddingBottom: 8 }}>
              {L2(`${joined.length} of ${base1.length} players joined 2.0 (${base1.length ? Math.round(joined.length * 100 / base1.length) : 0}%)`,
                `${base1.length} 位玩家中 ${joined.length} 位已加入 2.0（${base1.length ? Math.round(joined.length * 100 / base1.length) : 0}%）`)}
            </div>
          )}
        </div>
      </Card>

      {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
            {GROUPS.map(g => (
              <div key={g.k} style={{ outline: group === g.k ? '2px solid var(--accent)' : 'none', borderRadius: 12 }}>
                <KpiCard icon={g.icon} label={L2(g.en, g.zh)} value={g.n.toLocaleString()} sub={g.sub} onClick={() => setGroup(g.k)}
                  color={group === g.k ? 'var(--accent)' : undefined} />
              </div>
            ))}
          </div>
          <Card>
            {!list.length ? (
              <EmptyState icon="🆕" title={L2('No players in this group', '这个组没有玩家')}
                message={snapAt ? L2('Try another tier or host.', '试试其他等级或负责人。') : L2('Upload the 2.0 member file first.', '请先上传 2.0 会员文件。')} />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    {['#', L2('Player', '玩家'), L2('Tier', '等级'), L2('1.0 last deposit', '1.0 最后存款'),
                      ...(group === 'not' ? [] : [L2('2.0 deposit', '2.0 存款'), L2('2.0 bonus / promo', '2.0 奖金 / 优惠'), L2('2.0 last active', '2.0 最后活跃')]),
                      L2('Host', '负责人'), L2('Last contacted', '最后联系'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {list.map((r, i) => {
                      const s2 = r.s2
                      const crmPhone = r.crm?.whatsapp || r.crm?.phone || ''
                      const phone = s2?.phone || crmPhone
                      const phoneChanged = s2?.phone && crmPhone && phoneKey(s2.phone) !== phoneKey(crmPhone)
                      const dd = daysAgo(r.crm?.last_deposit_date, base)
                      const da = daysAgo(s2?.last_active_at, base)
                      const vip = { id: r.crm?.id || null, username: r.crm?.username || s2?.login, tier: r.tier, phone, whatsapp: phone,
                        activity_status: r.crm?.activity_status, days_inactive: r.crm?.days_inactive }
                      return (
                        <tr key={r.key} onClick={() => r.crm && navigate(`/vips/${r.crm.id}`)} style={{ cursor: r.crm ? 'pointer' : 'default' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                          <td style={{ ...td, color: 'var(--muted)', fontSize: 12, width: 36 }}>{i + 1}</td>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{r.crm?.username || s2?.login}<CopyBtn text={r.crm?.username || s2?.login} /></div>
                            {s2 && r.crm && s2.username !== r.crm.username.toLowerCase() && (
                              <div style={sub}>2.0: {s2.login}<CopyBtn text={s2.login} /> <span style={{ color: 'var(--warning)' }}>{L2('(matched by phone)', '（电话配对）')}</span></div>
                            )}
                            {r.crm?.full_name && <div style={sub}>{r.crm.full_name}</div>}
                            {phone && <div style={sub}>📱 {phone}<CopyBtn text={phone} kind="phone" />
                              {phoneChanged && <span style={{ color: 'var(--warning)' }}> {L2('new on 2.0', '2.0 新号码')}</span>}</div>}
                            {phoneChanged && <div style={sub}>{L2('1.0 phone', '1.0 电话')}: {crmPhone}<CopyBtn text={crmPhone} kind="phone" /></div>}
                          </td>
                          <td style={td}>
                            {r.tier ? <TierBadge tier={r.tier} /> : '—'}
                            {s2?.member_group && r.crm && String(s2.member_group).toUpperCase() !== r.tier && <div style={sub}>2.0: {s2.member_group}</div>}
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            {r.crm ? <>{r.crm.last_deposit_date || '—'}<div style={sub}>{dd != null ? L2(`${dd}d ago`, `${dd}天前`) : ''}</div>
                              {r.crm.activity_status && <StatusBadge status={r.crm.activity_status} />}</> : <span style={sub}>{L2('not a 1.0 CRM player', '非 1.0 CRM 玩家')}</span>}
                          </td>
                          {group !== 'not' && <>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>
                              <b>{formatMoney(s2.total_deposit, CUR)}</b>
                              <div style={sub}>{L2(`${s2.deposit_count} deposits`, `共 ${s2.deposit_count} 次`)}{s2.last_deposit_at ? ` · ${String(s2.last_deposit_at).slice(0, 10)}` : ''}</div>
                              {n(s2.total_withdrawal) > 0 && <div style={sub}>{L2('withdrew', '提款')} {formatMoney(s2.total_withdrawal, CUR)}</div>}
                            </td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>
                              {cost(s2) > 0 ? <b>{formatMoney(cost(s2), CUR)}</b> : '—'}
                              {cost(s2) > 0 && <div style={sub}>{L2(`bonus ${formatMoney(s2.total_bonus, CUR)} · promo ${formatMoney(s2.total_promo, CUR)}`, `奖金 ${formatMoney(s2.total_bonus, CUR)} · 优惠 ${formatMoney(s2.total_promo, CUR)}`)}</div>}
                            </td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{String(s2.last_active_at || '—').slice(0, 10)}<div style={sub}>{da != null ? L2(`${da}d ago`, `${da}天前`) : ''}</div></td>
                          </>}
                          <td style={{ ...td, color: 'var(--muted)' }}>{r.crm?.host_assigned || '—'}</td>
                          <td style={{ ...td, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.crm?.last_contacted ? String(r.crm.last_contacted).slice(0, 10) : L2('Never', '从未')}</td>
                          <td style={td} onClick={e => e.stopPropagation()}>
                            {phone && (
                              <WaButton vip={vip} templates={waText(r)} topic="sw2" logLabel={`sureWin 2.0: ${GROUPS.find(g => g.k === group).en}`} onLogged={() => setReloadKey(k => k + 1)}
                                title={L2('Send WhatsApp', '发送WhatsApp')}
                                style={{ width: 28, height: 28, borderRadius: 14, background: '#25D366', color: '#fff', fontSize: 13, fontWeight: 700 }}>W</WaButton>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            {L2('Bonus / promo = 2.0 BO expenses (bonus incl. rebate, plus promo amount). Test accounts are left out of "New on 2.0".',
              '奖金 / 优惠 = 2.0 后台费用（奖金含回扣，加优惠金额）。测试户口不计入 "2.0 新玩家"。')}
          </div>
        </>
      )}
    </div>
  )
}
