// TransferTracker.jsx — Track players transferred from other platforms
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam } from '../hooks/useUrlParam'
import { formatMoney } from '../lib/format'
import { CURRENCY_LIST_MAIN } from '../lib/constants'
import CopyBtn from '../components/CopyBtn'
import { useAuth } from '../hooks/useAuth'
import TransferApplications from '../components/transfer/TransferApplications'

const COST_TYPES = ['Cash Voucher', 'Bonus', 'Free Credit', 'Other']
const COST_TYPE_ZH = { 'Cash Voucher':'现金券', 'Bonus':'奖金', 'Free Credit':'免费积分', 'Other':'其他' }

const s = {
  page:    { padding: '28px 32px', maxWidth: 1400, margin: '0 auto' },
  hdr:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  title:   { fontSize: 22, fontWeight: 800, color: 'var(--text)' },
  sub:     { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  card:    { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 },
  cardHdr: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  stat:    { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' },
  btn:     (bg='var(--accent)', color='#fff') => ({ background: bg, color, border: 'none', padding: '8px 16px', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer' }),
  input:   { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 7, fontSize: 13, outline: 'none', width: '100%' },
  td:      { padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', verticalAlign: 'middle' },
  th:      { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
}

const fmtMoney = (n, currency = 'MYR') => formatMoney(n, currency)

function PnlBadge({ value, currency = 'MYR' }) {
  const { t } = useLanguage()
  if (value === null || value === undefined) return <span style={{ color: 'var(--muted)' }}>—</span>
  if (Math.abs(value) < 0.005) return <span style={{ color: 'var(--muted)', fontWeight: 700, fontSize: 12 }}>{fmtMoney(0, currency)}</span>
  const profit = value > 0
  return (
    <span style={{ fontWeight: 700, color: profit ? '#3fb950' : '#f85149', background: profit ? 'rgba(63,185,80,.12)' : 'rgba(248,81,73,.12)', padding: '3px 10px', borderRadius: 6, fontSize: 12 }}>
      {profit ? t('transferTracker.profitLabel') : t('transferTracker.lossLabel')}{fmtMoney(Math.abs(value), currency)}
    </span>
  )
}

// ── CSV Dropzone ──────────────────────────────────────────────────────────────
function CsvDropzone({ onFile, file }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef()
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.csv')) onFile(f)
  }, [onFile])
  return (
    <div style={{ border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '14px 16px', cursor: 'pointer', background: dragging ? 'rgba(99,102,241,.06)' : 'var(--bg)', transition: 'all .2s' }}
      onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} onClick={() => inputRef.current?.click()}>
      <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => onFile(e.target.files[0])} />
      {file ? (
        <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>📄 {file.name} ({(file.size/1024).toFixed(0)} KB)</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>{L2('Drop CSV or ','拖放 CSV 或 ')}<span style={{ color: 'var(--accent)' }}>{L2('click to browse','点击浏览')}</span></div>
      )}
    </div>
  )
}

export default function TransferTracker() {
  const navigate = useNavigate()
  const { t, lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const costTypeLabel = (c) => (lang === 'zh' ? (COST_TYPE_ZH[c] || c) : c)
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [players,   setPlayers]   = useState([])
  const [snapshots, setSnapshots] = useState({}) // {username: [snapshots]}
  const [costs,     setCosts]     = useState({})  // {username: [costs]}
  const [daily,     setDaily]     = useState({})  // {username: {dep, wd, wl, days, first, last, currency, months, inCrm}} from the daily report
  const [dataTo,    setDataTo]    = useState('')  // latest daily report date
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useUrlParam('tab', 'overview') // 'overview' | 'add' | 'import' | 'costs'
  const [currency,  setCurrency]  = useUrlParam('currency', 'MYR')
  const [selected,  setSelected]  = useState(null) // selected player for detail view

  // Add player form
  const [addForm, setAddForm] = useState({ username: '', source_platform: '', joined_date: '', notes: '' })
  const [addLoading, setAddLoading] = useState(false)

  // Import CSV
  const [csvFile,      setCsvFile]      = useState(null)
  const [csvPreview,   setCsvPreview]   = useState([])
  const [csvLoading,   setCsvLoading]   = useState(false)
  const [csvMsg,       setCsvMsg]       = useState('')
  const [snapshotDate, setSnapshotDate] = useState(new Date().toISOString().slice(0, 10))

  // Add cost form
  const [costForm, setCostForm] = useState({ username: '', cost_date: new Date().toISOString().slice(0,10), cost_type: 'Cash Voucher', amount: '', description: '' })
  const [costLoading, setCostLoading] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const { data: ps } = await supabase.from('transfer_players').select('*').order('created_at', { ascending: false })
    setPlayers(ps || [])

    if (ps && ps.length > 0) {
      const usernames = ps.map(p => p.username)

      const { data: snaps } = await supabase.from('transfer_snapshots').select('*')
        .in('username', usernames).order('snapshot_date', { ascending: false })
      const snapMap = {}
      ;(snaps||[]).forEach(s => { if (!snapMap[s.username]) snapMap[s.username] = []; snapMap[s.username].push(s) })
      setSnapshots(snapMap)

      const { data: cs } = await supabase.from('transfer_costs').select('*')
        .in('username', usernames).order('cost_date', { ascending: false })
      const costMap = {}
      ;(cs||[]).forEach(c => { if (!costMap[c.username]) costMap[c.username] = []; costMap[c.username].push(c) })
      setCosts(costMap)

      // Daily report data since each player joined (same daily CSV as the rest of the CRM, all tiers).
      // Only days with valid bet > 0 count (CRM rule: older deposit / withdrawal / W-L only trusted on bet days).
      const minStart = ps.map(startOf).sort()[0]
      const rows = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('vip_daily_snapshots_all')
          .select('username,snapshot_date,total_deposit,total_withdrawal,win_loss,monthly_valid_bet,currency')
          .in('username', usernames).gte('snapshot_date', minStart).gt('monthly_valid_bet', 0)
          .order('snapshot_date', { ascending: true }).range(from, from + 999)
        if (error) { console.error('transfer daily', error); break }
        rows.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      const { data: lastDay } = await supabase.from('vip_daily_snapshots_all').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1)
      const startBy = Object.fromEntries(ps.map(p => [p.username, startOf(p)]))
      const dMap = {}
      rows.forEach(r => {
        if (r.snapshot_date < startBy[r.username]) return
        const d = dMap[r.username] || (dMap[r.username] = { dep: 0, wd: 0, wl: 0, days: 0, first: r.snapshot_date, last: r.snapshot_date, currency: r.currency, months: {} })
        const dep = parseFloat(r.total_deposit) || 0, wd = parseFloat(r.total_withdrawal) || 0, wl = parseFloat(r.win_loss) || 0
        d.dep += dep; d.wd += wd; d.wl += wl; d.days++; d.last = r.snapshot_date; d.currency = r.currency || d.currency
        const m = r.snapshot_date.slice(0, 7)
        const mm = d.months[m] || (d.months[m] = { dep: 0, wd: 0, wl: 0, days: 0 })
        mm.dep += dep; mm.wd += wd; mm.wl += wl; mm.days++
      })
      // Currency for players with no play days yet
      const { data: mem } = await supabase.from('vip_members_all').select('username,currency').in('username', usernames)
      ;(mem || []).forEach(m => { if (!dMap[m.username]) dMap[m.username] = { dep: 0, wd: 0, wl: 0, days: 0, currency: m.currency, months: {}, inCrm: true }; else dMap[m.username].inCrm = true })
      setDaily(dMap)
      setDataTo(lastDay?.[0]?.snapshot_date || '')
    }
    setLoading(false)
  }

  // Start date = joined date (a date in the future is a typo → the day the player was added)
  function startOf(p) {
    const added = String(p.created_at || '').slice(0, 10)
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
    return p.joined_date && p.joined_date <= today ? p.joined_date : added
  }

  // ── Computed P&L per player ────────────────────────────────────────────────
  // Figures per player: daily report totals since joining; an old imported snapshot only when there is no daily data
  function figures(username) {
    const d = daily[username]
    if (d?.inCrm || d?.days) return { dep: d.dep, wd: d.wd, wl: d.wl, days: d.days, last: d.last, currency: d.currency || 'MYR', src: 'daily' }
    const sn = (snapshots[username] || [])[0]
    if (sn) return { dep: parseFloat(sn.total_deposit) || 0, wd: parseFloat(sn.total_withdrawal) || 0, wl: parseFloat(sn.win_loss) || 0, last: sn.snapshot_date, currency, src: 'csv' }
    return null
  }
  // Our P&L = what the player lost to us (win/loss is the player's: negative = player lost) minus our costs
  function calcPnl(username) {
    const f = figures(username)
    if (!f) return null
    const totalCost = (costs[username] || []).reduce((s, c) => s + (parseFloat(c.amount)||0), 0)
    return -f.wl - totalCost
  }

  // ── Add player ─────────────────────────────────────────────────────────────
  async function handleAddPlayer() {
    if (!addForm.username.trim() || !addForm.source_platform.trim()) return
    setAddLoading(true)
    const { error } = await supabase.from('transfer_players').insert({
      username: addForm.username.trim().toLowerCase(),
      source_platform: addForm.source_platform.trim(),
      joined_date: addForm.joined_date || null,
      notes: addForm.notes || null,
    })
    if (!error) {
      setAddForm({ username: '', source_platform: '', joined_date: '', notes: '' })
      await loadAll()
      setActiveTab('overview')
    }
    setAddLoading(false)
  }

  // ── Parse CSV preview ──────────────────────────────────────────────────────
  async function handleCsvFile(file) {
    setCsvFile(file)
    setCsvPreview([])
    const text = await file.text()
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''))
    const preview = lines.slice(1, 6).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g,''))
      const obj = {}
      headers.forEach((h, i) => obj[h] = vals[i] || '')
      return obj
    })
    setCsvPreview(preview)
  }

  async function handleCsvImport() {
    if (!csvFile) return
    setCsvLoading(true)
    setCsvMsg(L2('Reading CSV…','正在读取 CSV…'))
    const text = await csvFile.text()
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) { setCsvMsg(L2('No data found','未找到数据')); setCsvLoading(false); return }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase())
    const getCol  = (row, ...names) => {
      for (const n of names) {
        const i = headers.findIndex(h => h.includes(n.toLowerCase()))
        if (i >= 0) return row[i] || ''
      }
      return ''
    }

    let imported = 0, skipped = 0
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g,''))
      const username = getCol(vals, 'login', 'username', 'user').toLowerCase()
      if (!username) { skipped++; continue }

      // Check player exists
      const { data: exists } = await supabase.from('transfer_players').select('username').eq('username', username).single()
      if (!exists) { skipped++; continue }

      await supabase.from('transfer_snapshots').insert({
        username,
        snapshot_date:    snapshotDate,
        total_deposit:    parseFloat(getCol(vals, 'total deposit', 'deposit')) || 0,
        deposit_count:    parseInt(getCol(vals, 'deposit count', 'dep count'))  || 0,
        total_withdrawal: parseFloat(getCol(vals, 'total withdrawal', 'withdrawal', 'withdraw')) || 0,
        withdrawal_count: parseInt(getCol(vals, 'withdrawal count', 'with count')) || 0,
        win_loss:         parseFloat(getCol(vals, 'win', 'winloss', 'win loss', 'net')) || 0,
      })
      imported++
      if (i % 10 === 0) setCsvMsg(L2(`Importing… ${imported} done`, `导入中… 已完成 ${imported}`))
    }
    setCsvMsg(L2(`✅ Done — ${imported} imported, ${skipped} skipped (not in tracker)`, `✅ 完成 — 已导入 ${imported}，跳过 ${skipped}（不在追踪列表中）`))
    await loadAll()
    setCsvLoading(false)
    setCsvFile(null)
    setCsvPreview([])
  }

  // ── Add cost ───────────────────────────────────────────────────────────────
  async function handleAddCost() {
    if (!costForm.username || !costForm.amount) return
    setCostLoading(true)
    await supabase.from('transfer_costs').insert({
      username:    costForm.username,
      cost_date:   costForm.cost_date,
      cost_type:   costForm.cost_type,
      amount:      parseFloat(costForm.amount),
      description: costForm.description || null,
    })
    setCostForm(f => ({ ...f, amount: '', description: '' }))
    await loadAll()
    setCostLoading(false)
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalPlayers  = players.length
  // Summary counts only the players of the picked currency (MYR and SGD are never added together)
  const curPlayers    = players.filter(p => figures(p.username)?.currency === currency)
  const totalProfit   = curPlayers.reduce((s, p) => s + (calcPnl(p.username)||0), 0)
  const profitCount   = curPlayers.filter(p => (calcPnl(p.username)||0) > 0).length
  const lossCount     = curPlayers.filter(p => (calcPnl(p.username)||0) < 0).length

  if (loading) return <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>{L2('Loading…','载入中…')}</div>

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.hdr}>
        <div>
          <div style={s.title}>🔄 {L2('Transfer Player Tracker','转移玩家追踪')}</div>
          <div style={s.sub}>{L2('Track players transferred from other platforms · P&L analysis','追踪从其他平台转移的玩家 · 盈亏分析')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ ...s.input, width: 'auto', padding: '7px 10px', fontWeight: 700, color: 'var(--accent)' }}>
            {CURRENCY_LIST_MAIN.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {[...(isAdmin ? ['applications'] : []),'overview','add','import','costs'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              ...s.btn(activeTab===tab ? 'var(--accent)' : 'var(--surface2)', activeTab===tab ? '#fff' : 'var(--muted)'),
              border: '1px solid var(--border)',
            }}>
              {tab === 'applications' ? L2('📝 Applications','📝 转会申请') : tab === 'overview' ? L2('📋 Overview','📋 概览') : tab === 'add' ? L2('➕ Add Player','➕ 添加玩家') : tab === 'import' ? L2('📥 Import CSV','📥 导入 CSV') : L2('💰 Add Cost','💰 添加成本')}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: L2('Total Players','玩家总数'),    value: totalPlayers,  color: '#58a6ff' },
          { label: L2(`Net P&L (${currency} players: ${curPlayers.length})`,`净盈亏（${currency} 玩家：${curPlayers.length}）`),     value: <PnlBadge value={totalProfit} currency={currency} />, color: totalProfit >= 0 ? '#3fb950' : '#f85149' },
          { label: t('transferTracker.statProfitCount'),          value: profitCount,   color: '#3fb950' },
          { label: t('transferTracker.statLossCount'),          value: lossCount,     color: '#f85149' },
        ].map((st, i) => (
          <div key={i} style={s.stat}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>{st.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: st.color }}>{st.value}</div>
          </div>
        ))}
      </div>

      {/* ── Applications Tab (admin only) ── */}
      {activeTab === 'applications' && isAdmin && (
        <TransferApplications onAddToTracker={(app) => {
          setAddForm({ username: app.member_id || '', source_platform: app.platform_name, joined_date: '', notes: `Transfer application: ${app.full_name}` })
          setActiveTab('add')
        }} />
      )}

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div style={s.card}>
          <div style={s.cardHdr}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{t('transferTracker.playerListTitle')}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{totalPlayers} {L2('players','名玩家')}</span>
          </div>
          <div style={{ padding: '8px 20px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)', background: 'rgba(88,166,255,.04)' }}>
            {L2(`Automatic from the daily report (data up to ${dataTo || '—'}): totals from each player's start date, play days only (valid bet > 0). Net P&L = what the player lost to us − our costs (+ Cost). BO bonus and rebate are not taken off. Each player in their own currency.`,
              `自动取自每日报表（数据到 ${dataTo || '—'}）：从每位玩家的起算日累计，只算有投注的天数（有效投注 > 0）。净盈亏 = 玩家输给我们的 − 我们的成本（+ 成本）。BO 奖金和返水未扣除。每位玩家用自己的货币。`)}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {[ '#', L2('Username','用户名'), t('transferTracker.colSourcePlatform'), L2('Since','起算日'), L2('Deposit','存款'), L2('Withdrawal','提款'), L2('Player W/L','玩家输赢'), t('transferTracker.colOurCost'), t('transferTracker.colNetProfit'), L2('Play days / last','游戏天数 / 最后'), t('common.actions') ].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.length === 0 ? (
                  <tr><td colSpan={11} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 32 }}>{t('transferTracker.noPlayersYet')}</td></tr>
                ) : players.map((p, rowIdx) => {
                  const f          = figures(p.username)
                  const cur        = f?.currency || currency
                  const totalCost  = (costs[p.username]||[]).reduce((s,c) => s + (parseFloat(c.amount)||0), 0)
                  const pnl        = calcPnl(p.username)
                  const start      = startOf(p)
                  return (
                    <tr key={p.username} style={{ cursor: 'pointer' }} onClick={() => setSelected(selected?.username === p.username ? null : p)}>
                      <td style={{ ...s.td, color: 'var(--muted)', fontSize: 12, width: 36 }}>{rowIdx + 1}</td>
                      <td style={s.td}><span style={{ fontWeight: 700 }}>{p.username}<CopyBtn text={p.username} /></span></td>
                      <td style={s.td}><span style={{ background: 'rgba(88,166,255,.15)', color: '#58a6ff', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700 }}>{p.source_platform}</span></td>
                      <td style={s.td}><span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }} title={p.joined_date && p.joined_date !== start ? L2(`Joined date ${p.joined_date} is in the future, using the day added`, `加入日期 ${p.joined_date} 在未来，改用添加日期`) : undefined}>{start}{p.joined_date && p.joined_date !== start ? ' ⚠️' : ''}</span></td>
                      {!f ? (
                        <td colSpan={5} style={{ ...s.td, fontSize: 11, color: '#d29922' }}>{L2('Not found in the daily report (check the username in BO)', '每日报表里找不到（请在 BO 核对用户名）')}</td>
                      ) : <>
                        <td style={s.td}>{fmtMoney(f.dep, cur)}</td>
                        <td style={s.td}>{fmtMoney(f.wd, cur)}</td>
                        <td style={s.td}><span style={{ color: f.wl > 0 ? '#f85149' : '#3fb950' }}>{fmtMoney(f.wl, cur)}</span></td>
                        <td style={s.td}>{totalCost > 0 ? <span style={{ color: '#f59e0b' }}>{fmtMoney(totalCost, cur)}</span> : '—'}</td>
                        <td style={s.td}><PnlBadge value={pnl} currency={cur} /></td>
                      </>}
                      <td style={s.td}><span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{f?.src === 'csv' ? `CSV ${f.last}` : f ? (f.days ? `${f.days} ${L2('days', '天')} · ${f.last}` : L2('no play yet', '尚未游戏')) : '—'}</span></td>
                      <td style={{ ...s.td }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={async () => {
                            const { data } = await supabase.from('vip_members').select('id').eq('username', p.username).single()
                            if (data) navigate(`/vips/${data.id}`)
                            else alert(t('transferTracker.notInVipList'))
                          }} style={{ ...s.btn('var(--surface2)', 'var(--muted)'), border: '1px solid var(--border)', padding: '4px 10px', fontSize: 11 }}>{t('transferTracker.vipPageBtn')}</button>
                          <button onClick={() => { setCostForm(f => ({ ...f, username: p.username })); setActiveTab('costs') }}
                            style={{ ...s.btn('rgba(245,158,11,.15)', '#f59e0b'), border: '1px solid rgba(245,158,11,.3)', padding: '4px 10px', fontSize: 11 }}>{t('transferTracker.addCostBtn')}</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ borderTop: '1px solid var(--border)', padding: 20, background: 'var(--bg)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
                📊 {t('transferTracker.historyTitle', { username: selected.username })}
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>{t('transferTracker.fromPlatform', { platform: selected.source_platform })}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Snapshots history */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>📥 {t('transferTracker.depositWithdrawalHistory')}</div>
                  {Object.keys(daily[selected.username]?.months || {}).length > 0 ? (() => {
                    const dd = daily[selected.username], cur = dd.currency || currency
                    return <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--surface2)' }}>
                          {[L2('Month','月份'), L2('Play days','游戏天数'), t('common.deposit'), t('common.withdrawal'), L2('Player W/L','玩家输赢')].map(h => <th key={h} style={{ ...s.th, fontSize: 10 }}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(dd.months).sort((a, b) => b[0].localeCompare(a[0])).map(([m, v]) => (
                          <tr key={m}>
                            <td style={{ ...s.td, fontSize: 11 }}>{m}</td>
                            <td style={{ ...s.td, fontSize: 11 }}>{v.days}</td>
                            <td style={{ ...s.td, fontSize: 11 }}>{fmtMoney(v.dep, cur)}</td>
                            <td style={{ ...s.td, fontSize: 11 }}>{fmtMoney(v.wd, cur)}</td>
                            <td style={{ ...s.td, fontSize: 11, color: v.wl > 0 ? '#f85149' : '#3fb950' }}>{fmtMoney(v.wl, cur)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  })() : (snapshots[selected.username]||[]).length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>{daily[selected.username]?.inCrm ? L2(`No play days since ${startOf(selected)}.`, `自 ${startOf(selected)} 起没有游戏记录。`) : t('transferTracker.noSnapshotData')}</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--surface2)' }}>
                          {[t('common.date'), t('common.deposit'), t('common.withdrawal'), t('common.winLoss')].map(h => <th key={h} style={{ ...s.th, fontSize: 10 }}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(snapshots[selected.username]||[]).map(sn => (
                          <tr key={sn.id}>
                            <td style={{ ...s.td, fontSize: 11 }}>{sn.snapshot_date}</td>
                            <td style={{ ...s.td, fontSize: 11 }}>{fmtMoney(sn.total_deposit, currency)}</td>
                            <td style={{ ...s.td, fontSize: 11 }}>{fmtMoney(sn.total_withdrawal, currency)}</td>
                            <td style={{ ...s.td, fontSize: 11, color: (sn.win_loss||0) > 0 ? '#f85149' : '#3fb950' }}>{fmtMoney(sn.win_loss, currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {/* Costs history */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>💰 {t('transferTracker.bonusVoucherRecords')}</div>
                  {(costs[selected.username]||[]).length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>{t('transferTracker.noCostRecords')}</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--surface2)' }}>
                          {[t('common.date'), t('transferTracker.colType'), t('transferTracker.colAmount'), t('common.notes')].map(h => <th key={h} style={{ ...s.th, fontSize: 10 }}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(costs[selected.username]||[]).map(c => (
                          <tr key={c.id}>
                            <td style={{ ...s.td, fontSize: 11 }}>{c.cost_date}</td>
                            <td style={{ ...s.td, fontSize: 11 }}><span style={{ background: 'rgba(245,158,11,.15)', color: '#f59e0b', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{costTypeLabel(c.cost_type)}</span></td>
                            <td style={{ ...s.td, fontSize: 11, color: '#f85149', fontWeight: 700 }}>{fmtMoney(c.amount, currency)}</td>
                            <td style={{ ...s.td, fontSize: 11, color: 'var(--muted)' }}>{c.description || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Add Player Tab ── */}
      {activeTab === 'add' && (
        <div style={s.card}>
          <div style={s.cardHdr}><span style={{ fontSize: 14, fontWeight: 700 }}>{t('transferTracker.addTransferPlayerTitle')}</span></div>
          <div style={{ padding: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{L2('Username *','用户名 *')}</label>
                <input style={s.input} value={addForm.username} onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))} placeholder={L2('e.g. player123','例如 player123')} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.sourcePlatformRequired')}</label>
                <input style={s.input} value={addForm.source_platform} onChange={e => setAddForm(f => ({ ...f, source_platform: e.target.value }))} placeholder={L2('e.g. Platform A','例如 平台 A')} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.joinDate')}</label>
                <input type="date" style={s.input} value={addForm.joined_date} onChange={e => setAddForm(f => ({ ...f, joined_date: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('common.notes')}</label>
                <input style={s.input} value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} placeholder={L2('Optional notes','备注（可选）')} />
              </div>
            </div>
            <button onClick={handleAddPlayer} disabled={addLoading || !addForm.username || !addForm.source_platform}
              style={s.btn(addForm.username && addForm.source_platform ? 'var(--accent)' : 'var(--border)', '#fff')}>
              {addLoading ? t('common.saving') : t('transferTracker.addPlayerBtn')}
            </button>
          </div>
        </div>
      )}

      {/* ── Import CSV Tab ── */}
      {activeTab === 'import' && (
        <div style={s.card}>
          <div style={s.cardHdr}><span style={{ fontSize: 14, fontWeight: 700 }}>{t('transferTracker.csvImportSnapshotTitle')}</span></div>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, background: 'var(--surface2)', padding: '10px 14px', borderRadius: 7, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('transferTracker.csvFormatRequirement')}</div>
              <code style={{ fontSize: 11 }}>login/username, total deposit, deposit count, total withdrawal, withdrawal count, win loss</code>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end', marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.snapshotDate')}</label>
                <input type="date" style={s.input} value={snapshotDate} onChange={e => setSnapshotDate(e.target.value)} />
              </div>
            </div>
            <CsvDropzone onFile={handleCsvFile} file={csvFile} />
            {csvPreview.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>{t('transferTracker.previewFirst5')}</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface2)' }}>
                        {Object.keys(csvPreview[0]).map(h => <th key={h} style={s.th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.map((row, i) => (
                        <tr key={i}>{Object.values(row).map((v, j) => <td key={j} style={{ ...s.td, fontSize: 11 }}>{v||'—'}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {csvMsg && <div style={{ marginTop: 12, fontSize: 12, color: csvMsg.startsWith('✅') ? '#3fb950' : 'var(--accent)', fontWeight: 600 }}>{csvMsg}</div>}
            <div style={{ marginTop: 16 }}>
              <button onClick={handleCsvImport} disabled={!csvFile || csvLoading}
                style={s.btn(csvFile ? 'var(--accent)' : 'var(--border)', '#fff')}>
                {csvLoading ? t('common.saving') : t('transferTracker.startImportBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Cost Tab ── */}
      {activeTab === 'costs' && (
        <div style={s.card}>
          <div style={s.cardHdr}><span style={{ fontSize: 14, fontWeight: 700 }}>{t('transferTracker.addBonusCostTitle')}</span></div>
          <div style={{ padding: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.playerUsernameRequired')}</label>
                <select style={s.input} value={costForm.username} onChange={e => setCostForm(f => ({ ...f, username: e.target.value }))}>
                  <option value="">{t('transferTracker.selectPlayerPlaceholder')}</option>
                  {players.map(p => <option key={p.username} value={p.username}>{p.username} ({p.source_platform})</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.dateRequired')}</label>
                <input type="date" style={s.input} value={costForm.cost_date} onChange={e => setCostForm(f => ({ ...f, cost_date: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.typeRequired')}</label>
                <select style={s.input} value={costForm.cost_type} onChange={e => setCostForm(f => ({ ...f, cost_type: e.target.value }))}>
                  {COST_TYPES.map(ct => <option key={ct} value={ct}>{costTypeLabel(ct)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.amountRMRequired')}</label>
                <input type="number" style={s.input} value={costForm.amount} onChange={e => setCostForm(f => ({ ...f, amount: e.target.value }))} placeholder={L2('e.g. 888','例如 888')} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.descriptionLabel')}</label>
                <input style={s.input} value={costForm.description} onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))} placeholder={L2('e.g. Cash Voucher 888, Welcome Bonus','例如 现金券 888、欢迎奖金')} />
              </div>
            </div>
            <button onClick={handleAddCost} disabled={costLoading || !costForm.username || !costForm.amount}
              style={s.btn(costForm.username && costForm.amount ? '#f59e0b' : 'var(--border)', costForm.username && costForm.amount ? '#000' : 'var(--muted)')}>
              {costLoading ? t('common.saving') : t('transferTracker.addCostRecordBtn')}
            </button>
          </div>

          {/* Recent costs table */}
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <div style={{ padding: '12px 20px', fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{t('transferTracker.recentCostRecords')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {[t('transferTracker.colPlayer'), t('common.date'), t('transferTracker.colType'), t('transferTracker.colAmount'), t('transferTracker.descriptionLabel')].map(h => <th key={h} style={s.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.values(costs).flat().sort((a,b) => b.cost_date.localeCompare(a.cost_date)).slice(0,20).map(c => (
                  <tr key={c.id}>
                    <td style={s.td}><span style={{ fontWeight: 700 }}>{c.username}<CopyBtn text={c.username} /></span></td>
                    <td style={s.td}>{c.cost_date}</td>
                    <td style={s.td}><span style={{ background: 'rgba(245,158,11,.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700 }}>{costTypeLabel(c.cost_type)}</span></td>
                    <td style={{ ...s.td, color: '#f85149', fontWeight: 700 }}>{fmtMoney(c.amount, currency)}</td>
                    <td style={{ ...s.td, color: 'var(--muted)' }}>{c.description || '—'}</td>
                  </tr>
                ))}
                {Object.values(costs).flat().length === 0 && (
                  <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>{t('transferTracker.noCostRecords')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
