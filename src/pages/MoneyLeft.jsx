// src/pages/MoneyLeft.jsx — VIP Operations / 💰 Money Left (2026-11-23)
// Players who still have money in their sureWin wallet but stopped logging in.
// Data = BO "Member Statistic Report" (wallet balance export), uploaded on this page into public.player_wallet
// (one row per player + currency, the latest upload wins). Days are counted from the file date, not today,
// because the file only knows logins up to the day it was exported.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/depositProfile'
import { fetchMembersFor } from '../lib/allPlayers'
import { PageHeader, Card, KpiCard, Btn, LoadingState, ErrorState, EmptyState, TierBadge } from '../components/ui'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../hooks/useAuth'
import { WaButton } from '../components/WaSenderModal'
import CopyBtn from '../components/CopyBtn'

const CUR = { MY: 'MYR', SG: 'SGD' }
const TIER_ORDER = { BLACK: 0, 'DIAMOND-P': 1, DIAMOND: 1, PLATINUM: 2, GOLD: 3, SILVER: 4, BRONZE: 5 }
const DAY = 86400000
const toDay = d => new Date(d).toISOString().slice(0, 10)
const addDays = (ymd, n) => toDay(new Date(new Date(ymd + 'T00:00:00Z').getTime() + n * DAY))
const daysBetween = (from, to) => (from ? Math.floor((new Date(to + 'T00:00:00Z') - new Date(String(from).slice(0, 10) + 'T00:00:00Z')) / DAY) : null)
const normTier = g => String(g || '').toUpperCase().replace(/\.+$/, '').trim()
const isTest = r => /test/i.test(r.username || '') || /test/i.test(r.full_name || '')

// ── Upload: parse the BO export (CSV per tier or the combined Excel) ────────────────────────────
const clean = v => {
  if (v == null) return ''
  let s = typeof v === 'number' ? String(v) : String(v).trim()
  if (s.startsWith('="') && s.endsWith('"')) s = s.slice(2, -1)
  return s.trim()
}
const num = v => { const n = parseFloat(clean(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }
const ts = v => {
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ')
  const s = clean(v)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 19) : null
}
const COLS = {
  username: 'Member Login', member_id: 'Member ID', full_name: 'Member Name', member_group: 'Member Group', vip_grade: 'VIP Grade',
  affiliate: 'Affiliate', wallet: 'Wallet Balance', provider_wallet: 'Provider Wallet Balance', phone: 'Phone', email: 'Email',
  register_date: 'Register Date', deposit_count: 'No. of Deposit', total_deposit: 'Total Deposit', total_withdrawal: 'Total Withdrawal',
  first_deposit_at: 'First Deposit Date', last_deposit_at: 'Last Deposit Date', last_login_at: 'Last Login Date',
}
async function parseWalletFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', raw: true, cellDates: true, dense: true })
  const out = []
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true })
    if (!rows.length || !(COLS.username in rows[0])) continue
    for (const r of rows) {
      const username = clean(r[COLS.username])
      if (!username) continue
      out.push({
        username, member_id: clean(r[COLS.member_id]) || null, full_name: clean(r[COLS.full_name]) || null,
        member_group: normTier(clean(r[COLS.member_group])) || null, vip_grade: clean(r[COLS.vip_grade]) || null,
        affiliate: clean(r[COLS.affiliate]) || null, phone: clean(r[COLS.phone]) || null, email: clean(r[COLS.email]) || null,
        wallet: num(r[COLS.wallet]), provider_wallet: num(r[COLS.provider_wallet]),
        register_date: ts(r[COLS.register_date]), deposit_count: Math.round(num(r[COLS.deposit_count])),
        total_deposit: num(r[COLS.total_deposit]), total_withdrawal: num(r[COLS.total_withdrawal]),
        first_deposit_at: ts(r[COLS.first_deposit_at]), last_deposit_at: ts(r[COLS.last_deposit_at]), last_login_at: ts(r[COLS.last_login_at]),
      })
    }
  }
  return out
}

function UploadBox({ L2, onDone }) {
  const [platform, setPlatform] = useState('MY')
  const [date, setDate] = useState(toDay(Date.now() + 8 * 3600000))
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const run = async () => {
    if (!files.length) return
    setBusy(true); setMsg(L2('Reading the file(s)…', '正在读取文件…'))
    try {
      const byUser = new Map()
      for (const f of files) {
        setMsg(L2(`Reading ${f.name}… (a big Excel can take a minute)`, `正在读取 ${f.name}…（大文件可能需要一分钟）`))
        for (const r of await parseWalletFile(f)) byUser.set(r.username, r)
      }
      const all = [...byUser.values()]
      if (!all.length) throw new Error(L2('No "Member Login" column found. Use the BO Member Statistic Report export.', '找不到 "Member Login" 列，请使用后台 Member Statistic Report 导出文件。'))
      // keep players who ever deposited or still have money; skip empty sign-ups
      const keep = all.filter(r => r.deposit_count > 0 || r.wallet + r.provider_wallet > 0)
      const currency = CUR[platform]
      const rows = keep.map(r => ({ ...r, currency, snapshot_date: date, updated_at: new Date().toISOString() }))
      const SIZE = 1000
      for (let i = 0; i < rows.length; i += SIZE) {
        setMsg(L2(`Saving ${Math.min(i + SIZE, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}…`, `正在保存 ${Math.min(i + SIZE, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}…`))
        const { error } = await supabase.from('player_wallet').upsert(rows.slice(i, i + SIZE), { onConflict: 'username,currency' })
        if (error) throw error
      }
      setMsg(L2(`✅ Done: ${rows.length.toLocaleString()} players saved (${(all.length - rows.length).toLocaleString()} sign-ups with no deposit and no money skipped).`,
        `✅ 完成：已保存 ${rows.length.toLocaleString()} 位玩家（跳过 ${(all.length - rows.length).toLocaleString()} 位从未存款且无余额的注册）。`))
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
      <div style={{ fontWeight: 700, marginBottom: 6 }}>📥 {L2('Upload wallet balance file', '上传钱包余额文件')}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {L2('BO → Member Statistic Report export: the tier CSV files (you can pick several) or the combined Excel. Uploading again updates every player to the new numbers.',
          '后台 → Member Statistic Report 导出：各等级 CSV（可多选）或合并的 Excel。重新上传会把每位玩家更新为新数字。')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>{L2('Platform', '平台')}{' '}
          <select value={platform} onChange={e => setPlatform(e.target.value)} style={inp} disabled={busy}>
            <option value="MY">MY (MYR)</option><option value="SG">SG (SGD)</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>{L2('File date', '文件日期')}{' '}
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} disabled={busy} />
        </label>
        <input type="file" multiple accept=".csv,.xlsx,.xls" disabled={busy} onChange={e => setFiles([...e.target.files])} style={{ fontSize: 12 }} />
        <Btn variant="primary" onClick={run} disabled={busy || !files.length}>{busy ? L2('Uploading…', '上传中…') : L2('Upload', '上传')}</Btn>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 8 }}>{msg}</div>}
    </Card>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────────────────────
export default function MoneyLeft() {
  const navigate = useNavigate()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const { profile } = useAuth()
  const canUpload = ['admin', 'host'].includes(profile?.role)
  const [platform, setPlatform] = useState('MY')
  const [minBal, setMinBal] = useState(500)
  const [noLogin, setNoLogin] = useState(7)
  const [within, setWithin] = useState(90)
  const [tier, setTier] = useState('All')
  const [host, setHost] = useState('All')
  const [showOdd, setShowOdd] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [snap, setSnap] = useState(null)
  const [rows, setRows] = useState([])
  const [crm, setCrm] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const currency = CUR[platform]

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: last, error: e1 } = await supabase.from('player_wallet').select('snapshot_date').eq('currency', currency)
        .order('snapshot_date', { ascending: false }).limit(1)
      if (e1) throw e1
      const s = last?.[0]?.snapshot_date || null
      setSnap(s)
      if (!s) { setRows([]); setCrm({}); setLoading(false); return }
      const data = await fetchAll(() => {
        let q = supabase.from('player_wallet')
          .select('username,full_name,member_group,phone,wallet,provider_wallet,balance,deposit_count,total_deposit,total_withdrawal,last_deposit_at,last_login_at,affiliate')
          .eq('currency', currency).eq('snapshot_date', s).gte('balance', Number(minBal) || 0)
        if (noLogin > 0) q = q.lt('last_login_at', addDays(s, -(noLogin - 1)))
        if (within > 0) q = q.gte('last_login_at', addDays(s, -within))
        return q.order('balance', { ascending: false }).order('username')
      })
      setRows(data)
      const mem = await fetchMembersFor(data.map(r => r.username), 'id,username,tier,host_assigned,last_contacted,activity_status,days_inactive,phone,whatsapp,currency')
      const m = {}
      for (const x of mem) if (x.currency === currency || !x.currency) m[x.username] = x
      setCrm(m)
    } catch (e) { setError(e?.message || String(e)) }
    setLoading(false)
  }, [currency, minBal, noLogin, within])

  useEffect(() => { load() }, [load, reloadKey])

  const list = useMemo(() => rows
    .filter(r => !isTest(r))
    .filter(r => (showOdd ? r.deposit_count === 0 : r.deposit_count > 0))
    .map(r => ({ ...r, crm: crm[r.username] || null, tierNow: normTier(crm[r.username]?.tier || r.member_group) }))
    .filter(r => tier === 'All' || r.tierNow === tier || (tier === 'DIAMOND' && r.tierNow === 'DIAMOND-P'))
    .filter(r => host === 'All' || (host === '—' ? !r.crm?.host_assigned : r.crm?.host_assigned === host))
    .sort((a, b) => (TIER_ORDER[a.tierNow] ?? 9) - (TIER_ORDER[b.tierNow] ?? 9) || b.balance - a.balance),
  [rows, crm, tier, host, showOdd])

  const hosts = useMemo(() => [...new Set(rows.map(r => crm[r.username]?.host_assigned).filter(Boolean))].sort(), [rows, crm])
  const total = list.reduce((s, r) => s + Number(r.balance || 0), 0)
  const byTier = ['DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE'].map(t => {
    const g = list.filter(r => r.tierNow === t || (t === 'DIAMOND' && ['DIAMOND-P', 'BLACK'].includes(r.tierNow)))
    return { t, n: g.length, sum: g.reduce((s, r) => s + Number(r.balance || 0), 0) }
  })

  const exportXlsx = () => {
    const data = list.map(r => ({
      Tier: r.tierNow, Username: r.username, Name: r.full_name || '', Phone: r.crm?.whatsapp || r.crm?.phone || r.phone || '',
      [`Money left (${currency})`]: Number(r.balance), 'Main wallet': Number(r.wallet), 'Game wallet': Number(r.provider_wallet),
      'Last login': String(r.last_login_at || '').slice(0, 10), 'Days since login': daysBetween(r.last_login_at, snap),
      'Last deposit': String(r.last_deposit_at || '').slice(0, 10), 'No. of deposits': r.deposit_count,
      'Lifetime deposit': Number(r.total_deposit), 'Lifetime withdrawal': Number(r.total_withdrawal),
      'Lifetime net loss': Number(r.total_deposit) - Number(r.total_withdrawal),
      Host: r.crm?.host_assigned || '', 'Last contacted': String(r.crm?.last_contacted || '').slice(0, 10), 'In CRM': r.crm ? 'Yes' : 'No',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Money left')
    XLSX.writeFile(wb, `Money left ${platform} ${snap}.xlsx`)
  }

  const waText = r => {
    const me = profile?.full_name || 'Agent'
    const amt = formatMoney(r.balance, currency)
    return {
      en: `Hi bro *${r.username}*! 👋 I'm ${me} from sureWin VIP department.\n\nJust checking in, I saw you still have ${amt} sitting in your sureWin account 😄 long time no see you login leh, everything ok?\n\nIf you need any help or want me to check anything for you, just WhatsApp me ya 💎`,
      cn: `嗨 *${r.username}*！👋 我是sureWin VIP部门的${me}。\n\n来问候你一下，看到你的sureWin户口还有 ${amt} 😄 好久没看到你登录了，最近还好吗？\n\n有什么需要帮忙或想我帮你看看的，随时WhatsApp我哦 💎`,
    }
  }

  const sel = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 7, fontSize: 13 }
  const th = { padding: '9px 12px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' }

  return (
    <div style={{ padding: '24px 28px' }}>
      <PageHeader title={L2('💰 Money Left', '💰 余额未用')}
        subtitle={L2('Players who still have money in their wallet but stopped logging in. A friendly reason to call them back.',
          '钱包里还有余额但已不再登录的玩家，是联系他们回来的好理由。')} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={platform} onChange={e => setPlatform(e.target.value)} style={sel}>
          <option value="MY">MY (MYR)</option><option value="SG">SG (SGD)</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {snap ? L2(`📅 Wallet file date: ${snap} (days are counted from this date)`, `📅 钱包文件日期：${snap}（天数从这天算起）`) : L2('No wallet file uploaded yet for this platform.', '此平台还没有上传钱包文件。')}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canUpload && <Btn onClick={() => setShowUpload(s => !s)}>📥 {L2('Upload wallet file', '上传钱包文件')}</Btn>}
          <Btn onClick={exportXlsx} disabled={!list.length}>⬇ {L2('Download (.xlsx)', '下载 (.xlsx)')}</Btn>
        </div>
      </div>

      {canUpload && (showUpload || (!loading && !snap)) && <UploadBox L2={L2} onDone={() => { setShowUpload(false); setReloadKey(k => k + 1) }} />}

      {/* Filters */}
      <Card style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2(`Money at least (${currency})`, `余额至少 (${currency})`)}<br />
            <input type="number" value={minBal} min={0} step={100} onChange={e => setMinBal(e.target.value)} style={{ ...sel, width: 110 }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Not logged in for at least', '至少多久没登录')}<br />
            <select value={noLogin} onChange={e => setNoLogin(Number(e.target.value))} style={sel}>
              {[0, 3, 7, 14, 30].map(d => <option key={d} value={d}>{d === 0 ? L2('Any', '不限') : L2(`${d} days`, `${d} 天`)}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Last login within', '最后登录在')}<br />
            <select value={within} onChange={e => setWithin(Number(e.target.value))} style={sel}>
              {[30, 60, 90, 180, 365, 0].map(d => <option key={d} value={d}>{d === 0 ? L2('Any time', '不限') : d === 90 ? L2('3 months', '3 个月内') : L2(`${d} days`, `${d} 天内`)}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Tier', '等级')}<br />
            <select value={tier} onChange={e => setTier(e.target.value)} style={sel}>
              {['All', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE'].map(t => <option key={t} value={t}>{t === 'All' ? L2('All tiers', '全部等级') : t}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Host', '负责人')}<br />
            <select value={host} onChange={e => setHost(e.target.value)} style={sel}>
              <option value="All">{L2('All hosts', '全部负责人')}</option>
              <option value="—">{L2('No host', '无负责人')}</option>
              {hosts.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
            <input type="checkbox" checked={showOdd} onChange={e => setShowOdd(e.target.checked)} />
            {L2('Show accounts with 0 deposits instead (staff / promo?)', '改为显示 0 存款的户口（员工 / 推广？）')}
          </label>
        </div>
      </Card>

      {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            <KpiCard label={L2('Players', '玩家')} value={list.length.toLocaleString()} sub={formatMoney(total, currency)} color="var(--accent)" />
            {byTier.map(b => (
              <KpiCard key={b.t} label={b.t} value={b.n.toLocaleString()} sub={formatMoney(b.sum, currency)} onClick={() => setTier(tier === b.t ? 'All' : b.t)} />
            ))}
          </div>
          <Card>
            {!list.length ? (
              <EmptyState icon="💰" title={L2('No players match', '没有符合的玩家')} message={snap ? L2('Try a lower amount or a longer login period.', '试试降低金额或放宽登录时间。') : L2('Upload the BO wallet file first.', '请先上传后台钱包文件。')} />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    {['#', L2('Player', '玩家'), L2('Tier', '等级'), L2('Money left', '余额'), L2('Last login', '最后登录'), L2('Last deposit', '最后存款'),
                      L2('Lifetime net loss', '累计净输'), L2('Host', '负责人'), L2('Last contacted', '最后联系'), ''].map((h, i) => <th key={i} style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {list.map((r, i) => {
                      const dl = daysBetween(r.last_login_at, snap)
                      const dd = daysBetween(r.last_deposit_at, snap)
                      const phone = r.crm?.whatsapp || r.crm?.phone || r.phone || ''
                      const net = Number(r.total_deposit) - Number(r.total_withdrawal)
                      const vip = { id: r.crm?.id || null, username: r.username, tier: r.tierNow, phone, whatsapp: r.crm?.whatsapp || phone,
                        activity_status: r.crm?.activity_status, days_inactive: r.crm?.days_inactive }
                      return (
                        <tr key={r.username} onClick={() => r.crm && navigate(`/vips/${r.crm.id}`)} style={{ cursor: r.crm ? 'pointer' : 'default' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                          <td style={{ ...td, color: 'var(--muted)', fontSize: 12, width: 36 }}>{i + 1}</td>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{r.username}<CopyBtn text={r.username} /></div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.full_name || ''}</div>
                            {phone && <div style={{ fontSize: 11, color: 'var(--muted)' }}>📱 {phone}<CopyBtn text={phone} kind="phone" /></div>}
                            {!r.crm && <div style={{ fontSize: 10, color: 'var(--warning)' }}>{L2('Not in CRM yet', '尚未在CRM')}</div>}
                          </td>
                          <td style={td}><TierBadge tier={r.tierNow} /></td>
                          <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {formatMoney(r.balance, currency)}
                            {Number(r.provider_wallet) > 0 && <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{L2('in game: ', '游戏内：')}{formatMoney(r.provider_wallet, currency)}</div>}
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{String(r.last_login_at || '—').slice(0, 10)}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{dl != null ? L2(`${dl}d ago`, `${dl}天前`) : ''}</div></td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{String(r.last_deposit_at || '—').slice(0, 10)}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{dd != null ? L2(`${dd}d ago · ${r.deposit_count} deposits`, `${dd}天前 · 共${r.deposit_count}次`) : ''}</div></td>
                          <td style={{ ...td, whiteSpace: 'nowrap', color: net > 0 ? 'var(--danger)' : 'var(--success)' }}>{formatMoney(net, currency)}</td>
                          <td style={{ ...td, color: 'var(--muted)' }}>{r.crm?.host_assigned || '—'}</td>
                          <td style={{ ...td, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.crm?.last_contacted ? String(r.crm.last_contacted).slice(0, 10) : L2('Never', '从未')}</td>
                          <td style={td} onClick={e => e.stopPropagation()}>
                            {phone && (
                              <WaButton vip={vip} templates={waText(r)} logLabel="Money left in wallet" onLogged={() => setReloadKey(k => k + 1)}
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
        </>
      )}
    </div>
  )
}
