// TransferTracker.jsx — Track players transferred from other platforms
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam } from '../hooks/useUrlParam'
import { formatMoney } from '../lib/format'
import { CURRENCY_LIST_MAIN } from '../lib/constants'

const COST_TYPES = ['Cash Voucher', 'Bonus', 'Free Credit', 'Other']

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
  const profit = value > 0
  return (
    <span style={{ fontWeight: 700, color: profit ? '#3fb950' : '#f85149', background: profit ? 'rgba(63,185,80,.12)' : 'rgba(248,81,73,.12)', padding: '3px 10px', borderRadius: 6, fontSize: 12 }}>
      {profit ? t('transferTracker.profitLabel') : t('transferTracker.lossLabel')}{fmtMoney(Math.abs(value), currency)}
    </span>
  )
}

// ── CSV Dropzone ──────────────────────────────────────────────────────────────
function CsvDropzone({ onFile, file }) {
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
        <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>Drop CSV or <span style={{ color: 'var(--accent)' }}>click to browse</span></div>
      )}
    </div>
  )
}

export default function TransferTracker() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [players,   setPlayers]   = useState([])
  const [snapshots, setSnapshots] = useState({}) // {username: [snapshots]}
  const [costs,     setCosts]     = useState({})  // {username: [costs]}
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
    }
    setLoading(false)
  }

  // ── Computed P&L per player ────────────────────────────────────────────────
  function calcPnl(username) {
    const latestSnap = (snapshots[username] || [])[0]
    const totalCost  = (costs[username] || []).reduce((s, c) => s + (parseFloat(c.amount)||0), 0)
    if (!latestSnap) return null
    // Platform profit = withdrawal - deposit - win_loss_for_player - our_costs
    // win_loss: positive = player won (our loss), negative = player lost (our gain)
    const netDeposit = (latestSnap.total_deposit||0) - (latestSnap.total_withdrawal||0)
    const platformPnl = netDeposit + (latestSnap.win_loss||0) - totalCost
    return platformPnl
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
    setCsvMsg('Reading CSV…')
    const text = await csvFile.text()
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) { setCsvMsg('No data found'); setCsvLoading(false); return }

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
      if (i % 10 === 0) setCsvMsg(`Importing… ${imported} done`)
    }
    setCsvMsg(`✅ Done — ${imported} imported, ${skipped} skipped (not in tracker)`)
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
  const totalProfit   = players.reduce((s, p) => s + (calcPnl(p.username)||0), 0)
  const profitCount   = players.filter(p => (calcPnl(p.username)||0) > 0).length
  const lossCount     = players.filter(p => (calcPnl(p.username)||0) < 0).length

  if (loading) return <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Loading…</div>

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.hdr}>
        <div>
          <div style={s.title}>🔄 Transfer Player Tracker</div>
          <div style={s.sub}>Track players transferred from other platforms · P&amp;L analysis</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ ...s.input, width: 'auto', padding: '7px 10px', fontWeight: 700, color: 'var(--accent)' }}>
            {CURRENCY_LIST_MAIN.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {['overview','add','import','costs'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              ...s.btn(activeTab===tab ? 'var(--accent)' : 'var(--surface2)', activeTab===tab ? '#fff' : 'var(--muted)'),
              border: '1px solid var(--border)',
            }}>
              {tab === 'overview' ? '📋 Overview' : tab === 'add' ? '➕ Add Player' : tab === 'import' ? '📥 Import CSV' : '💰 Add Cost'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Players',    value: totalPlayers,  color: '#58a6ff' },
          { label: 'Net P&L (All)',     value: <PnlBadge value={totalProfit} currency={currency} />, color: totalProfit >= 0 ? '#3fb950' : '#f85149' },
          { label: t('transferTracker.statProfitCount'),          value: profitCount,   color: '#3fb950' },
          { label: t('transferTracker.statLossCount'),          value: lossCount,     color: '#f85149' },
        ].map((st, i) => (
          <div key={i} style={s.stat}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>{st.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: st.color }}>{st.value}</div>
          </div>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div style={s.card}>
          <div style={s.cardHdr}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{t('transferTracker.playerListTitle')}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{totalPlayers} players</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {[ 'Username', t('transferTracker.colSourcePlatform'), t('transferTracker.colLatestDeposit'), t('transferTracker.colLatestWithdrawal'), t('common.winLoss'), t('transferTracker.colOurCost'), t('transferTracker.colNetProfit'), t('transferTracker.colLastSnapshot'), t('common.actions') ].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 32 }}>{t('transferTracker.noPlayersYet')}</td></tr>
                ) : players.map(p => {
                  const latestSnap = (snapshots[p.username]||[])[0]
                  const totalCost  = (costs[p.username]||[]).reduce((s,c) => s + (parseFloat(c.amount)||0), 0)
                  const pnl        = calcPnl(p.username)
                  return (
                    <tr key={p.username} style={{ cursor: 'pointer' }} onClick={() => setSelected(selected?.username === p.username ? null : p)}>
                      <td style={s.td}><span style={{ fontWeight: 700 }}>{p.username}</span></td>
                      <td style={s.td}><span style={{ background: 'rgba(88,166,255,.15)', color: '#58a6ff', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700 }}>{p.source_platform}</span></td>
                      <td style={s.td}>{latestSnap ? fmtMoney(latestSnap.total_deposit, currency) : '—'}</td>
                      <td style={s.td}>{latestSnap ? fmtMoney(latestSnap.total_withdrawal, currency) : '—'}</td>
                      <td style={s.td}>{latestSnap ? <span style={{ color: (latestSnap.win_loss||0) > 0 ? '#f85149' : '#3fb950' }}>{fmtMoney(latestSnap.win_loss, currency)}</span> : '—'}</td>
                      <td style={s.td}>{totalCost > 0 ? <span style={{ color: '#f59e0b' }}>{fmtMoney(totalCost, currency)}</span> : '—'}</td>
                      <td style={s.td}><PnlBadge value={pnl} currency={currency} /></td>
                      <td style={s.td}><span style={{ fontSize: 11, color: 'var(--muted)' }}>{latestSnap?.snapshot_date || '—'}</span></td>
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
                  {(snapshots[selected.username]||[]).length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>{t('transferTracker.noSnapshotData')}</div>
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
                            <td style={{ ...s.td, fontSize: 11 }}><span style={{ background: 'rgba(245,158,11,.15)', color: '#f59e0b', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{c.cost_type}</span></td>
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
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Username *</label>
                <input style={s.input} value={addForm.username} onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))} placeholder="e.g. player123" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.sourcePlatformRequired')}</label>
                <input style={s.input} value={addForm.source_platform} onChange={e => setAddForm(f => ({ ...f, source_platform: e.target.value }))} placeholder="e.g. Platform A" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.joinDate')}</label>
                <input type="date" style={s.input} value={addForm.joined_date} onChange={e => setAddForm(f => ({ ...f, joined_date: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('common.notes')}</label>
                <input style={s.input} value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
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
                  {COST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.amountRMRequired')}</label>
                <input type="number" style={s.input} value={costForm.amount} onChange={e => setCostForm(f => ({ ...f, amount: e.target.value }))} placeholder="e.g. 888" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('transferTracker.descriptionLabel')}</label>
                <input style={s.input} value={costForm.description} onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Cash Voucher 888, Welcome Bonus" />
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
                    <td style={s.td}><span style={{ fontWeight: 700 }}>{c.username}</span></td>
                    <td style={s.td}>{c.cost_date}</td>
                    <td style={s.td}><span style={{ background: 'rgba(245,158,11,.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700 }}>{c.cost_type}</span></td>
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
