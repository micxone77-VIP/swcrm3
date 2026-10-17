// src/components/vip/VipBonusSpending.jsx — VIP360 › Dept Spending: BO bonuses credited to this VIP
// Paste rows copied from BO (Bonus transactions) → preview → save. Same transaction ID is never saved twice.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../hooks/useAuth'
import { BONUS_CATS, parseBonusPaste, money2 } from '../../lib/vipBonus'

export default function VipBonusSpending({ username, vipId, currency = 'MYR', onTotals }) {
  const { lang } = useLanguage()
  const { profile } = useAuth()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const canEdit = profile?.role === 'admin' || profile?.role === 'host'
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [catF, setCatF] = useState('ALL')
  const [monthF, setMonthF] = useState('ALL')
  const [delId, setDelId] = useState(null)

  const load = useCallback(async () => {
    if (!username) return
    const { data, error } = await supabase.from('vip_bonus_txns').select('*').eq('username', username).order('txn_at', { ascending: false })
    if (error) { setMsg(error.message); setRows([]); return }
    setRows(data || [])
  }, [username])
  useEffect(() => { load() }, [load])

  const totals = useMemo(() => {
    const t = {}
    ;(rows || []).forEach(r => { const c = r.currency || 'MYR'; t[c] = (t[c] || 0) + Number(r.amount || 0) })
    return t
  }, [rows])
  useEffect(() => { onTotals && onTotals(totals, (rows || []).length) }, [totals, rows, onTotals])

  function doPreview() {
    const { rows: parsed, bad } = parseBonusPaste(text)
    const have = new Set((rows || []).map(r => r.txn_id))
    const seen = new Set()
    const list = parsed.map(p => {
      let status = 'new'
      if (String(p.username).toLowerCase() !== String(username).toLowerCase()) status = 'other_user'
      else if (!/bonus/i.test(p.type || '')) status = 'not_bonus'
      else if (have.has(p.txn_id) || seen.has(p.txn_id)) status = 'dup'
      seen.add(p.txn_id)
      return { ...p, status }
    })
    setPreview({ list, bad })
  }

  async function save() {
    const toSave = (preview?.list || []).filter(p => p.status === 'new')
    if (!toSave.length) return
    setBusy(true); setMsg('')
    const payload = toSave.map(({ status, type, ...p }) => ({ ...p, username, vip_id: vipId || null, currency, source: 'bo_paste', created_by: profile?.id || null }))
    const { error } = await supabase.from('vip_bonus_txns').upsert(payload, { onConflict: 'txn_id', ignoreDuplicates: true })
    setBusy(false)
    if (error) { setMsg(L2(`Save failed: ${error.message}`, `保存失败：${error.message}`)); return }
    setMsg(L2(`✅ Saved ${payload.length} bonus record(s)`, `✅ 已保存 ${payload.length} 条奖励记录`))
    setText(''); setPreview(null); setOpen(false)
    load()
  }

  async function setCat(r, category) {
    const { error } = await supabase.from('vip_bonus_txns').update({ category }).eq('txn_id', r.txn_id)
    if (error) return window.alert(error.message)
    setRows(rs => rs.map(x => (x.txn_id === r.txn_id ? { ...x, category } : x)))
  }
  async function del(r) {
    if (delId !== r.txn_id) { setDelId(r.txn_id); setTimeout(() => setDelId(d => (d === r.txn_id ? null : d)), 4000); return }
    const { error } = await supabase.from('vip_bonus_txns').delete().eq('txn_id', r.txn_id)
    if (error) return window.alert(L2(`Delete failed: ${error.message}`, `删除失败：${error.message}`))
    setDelId(null); setRows(rs => rs.filter(x => x.txn_id !== r.txn_id))
  }

  const months = [...new Set((rows || []).map(r => r.month))].sort().reverse()
  const shown = (rows || []).filter(r => (catF === 'ALL' || r.category === catF) && (monthF === 'ALL' || r.month === monthF))
  const byCat = {}
  ;(rows || []).filter(r => monthF === 'ALL' || r.month === monthF).forEach(r => {
    const k = r.category || 'Other'; byCat[k] = byCat[k] || { n: 0, amt: 0 }; byCat[k].n++; byCat[k].amt += Number(r.amount || 0)
  })
  const byMonth = {}
  ;(rows || []).forEach(r => { byMonth[r.month] = (byMonth[r.month] || 0) + Number(r.amount || 0) })
  const shownTotal = shown.reduce((s, r) => s + Number(r.amount || 0), 0)

  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }
  const chip = (on, color = 'var(--accent)') => ({ padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? color : 'var(--border)'}`, background: on ? color + '22' : 'var(--surface2)', color: on ? color : 'var(--text)' })
  const btn = { padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }
  const ST = {
    new: ['#3fb950', L2('New', '新')], dup: ['#8b949e', L2('Already saved', '已存在')],
    other_user: ['#f85149', L2('Other VIP — skipped', '其他VIP — 跳过')], not_bonus: ['#d29922', L2('Not a bonus — skipped', '非奖励 — 跳过')],
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.5px', textTransform: 'uppercase' }}>
          🎁 {L2('Bonuses credited (from BO)', '已派发奖励（BO）')} ({(rows || []).length})
        </div>
        {canEdit && <button style={{ ...btn, borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => { setOpen(o => !o); setPreview(null); setMsg('') }}>📋 {L2('Paste BO bonuses', '粘贴BO奖励记录')}</button>}
      </div>

      {msg && <div style={{ fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      {open && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16, background: 'var(--surface)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {L2('In BO, open this player\'s transactions, filter Type = Bonus, select the rows and copy (Ctrl+C), then paste here. Pasting the same rows again is safe — duplicates are skipped by transaction ID.',
              '在BO打开此玩家的交易记录，筛选类型 = Bonus，选中行复制（Ctrl+C）后粘贴到这里。重复粘贴也没关系——相同交易ID会自动跳过。')}
          </div>
          <textarea value={text} onChange={e => { setText(e.target.value); setPreview(null) }} rows={7} placeholder="5963445898	2026-10-13 01:31:06	2026-10-13 01:31:06	Bonus	AngPow (100 Game Credit)	mralien23	100.00	0	18.73	118.73"
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btn} disabled={!text.trim()} onClick={doPreview}>🔍 {L2('Preview', '预览')}</button>
            {preview && <button style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }} disabled={busy || !preview.list.some(p => p.status === 'new')} onClick={save}>
              💾 {busy ? L2('Saving…', '保存中…') : L2(`Save ${preview.list.filter(p => p.status === 'new').length} new`, `保存 ${preview.list.filter(p => p.status === 'new').length} 条新记录`)}
            </button>}
            {preview && <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {L2(`${preview.list.length} row(s) read`, `读取 ${preview.list.length} 行`)}{preview.bad.length ? L2(` · ⚠️ could not read txn ${preview.bad.join(', ')}`, ` · ⚠️ 无法读取交易 ${preview.bad.join(', ')}`) : ''}
            </span>}
          </div>
          {preview && preview.list.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {preview.list.map(p => (
                    <tr key={p.txn_id + p.username}>
                      <td style={{ ...td, padding: '6px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{p.txn_at.slice(0, 16).replace('T', ' ')}</td>
                      <td style={{ ...td, padding: '6px 10px' }}>{BONUS_CATS[p.category]?.icon} {p.bonus_name}</td>
                      <td style={{ ...td, padding: '6px 10px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>{money2(p.amount, currency)}</td>
                      <td style={{ ...td, padding: '6px 10px', color: 'var(--muted)' }}>{p.username}</td>
                      <td style={{ ...td, padding: '6px 10px' }}><span style={{ fontSize: 11, fontWeight: 700, color: ST[p.status][0] }}>{ST[p.status][1]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.entries(byCat).sort((a, b) => b[1].amt - a[1].amt).map(([k, v]) => {
              const c = BONUS_CATS[k] || BONUS_CATS.Other
              return (
                <div key={k} onClick={() => setCatF(f => (f === k ? 'ALL' : k))} style={{ cursor: 'pointer', padding: '10px 14px', borderRadius: 10, minWidth: 130, border: `1px solid ${catF === k ? c.color : 'var(--border)'}`, background: catF === k ? c.color + '1a' : 'var(--surface2)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.icon} {L2(k, c.zh)} · {v.n}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: c.color }}>{money2(v.amt, currency)}</div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Month:', '月份：')}</span>
            {['ALL', ...months].map(m => (
              <button key={m} style={chip(monthF === m)} onClick={() => setMonthF(m)}>
                {m === 'ALL' ? L2('All', '全部') : m}{m !== 'ALL' && <span style={{ fontWeight: 500, color: 'var(--muted)' }}> · {money2(byMonth[m], currency)}</span>}
              </button>
            ))}
            {catF !== 'ALL' && <button style={chip(true, BONUS_CATS[catF]?.color)} onClick={() => setCatF('ALL')}>✕ {L2(catF, BONUS_CATS[catF]?.zh)}</button>}
            <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700 }}>{L2('Shown total', '显示合计')}: {money2(shownTotal, currency)}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                {[['Date / time', '日期时间'], ['Category', '类别'], ['Bonus', '奖励'], ['Amount', '金额'], ['BO Txn ID', 'BO交易ID'], ['', '']].map(([h, z], i) => (
                  <th key={i} style={{ padding: '9px 12px', textAlign: h === 'Amount' ? 'right' : 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{L2(h, z)}</th>
                ))}
              </tr></thead>
              <tbody>
                {shown.map(r => {
                  const c = BONUS_CATS[r.category] || BONUS_CATS.Other
                  return (
                    <tr key={r.txn_id}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>{new Date(r.txn_at).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={td}>
                        {canEdit ? (
                          <select value={r.category} onChange={e => setCat(r, e.target.value)} title={L2('Change category', '更改类别')}
                            style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${c.color}66`, background: c.color + '22', color: c.color }}>
                            {Object.entries(BONUS_CATS).map(([k, v]) => <option key={k} value={k}>{v.icon} {L2(k, v.zh)}</option>)}
                          </select>
                        ) : <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: c.color + '22', color: c.color }}>{c.icon} {L2(r.category, c.zh)}</span>}
                      </td>
                      <td style={{ ...td, fontSize: 12 }} title={r.description}>{r.bonus_name}{r.locked_amount ? <span style={{ color: 'var(--muted)' }}> · 🔒 {money2(r.locked_amount, r.currency)}</span> : null}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{money2(r.amount, r.currency)}</td>
                      <td style={{ ...td, fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{r.txn_id}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {canEdit && <button onClick={() => del(r)} title={L2('Delete', '删除')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${delId === r.txn_id ? '#f85149' : 'var(--border)'}`, background: delId === r.txn_id ? '#f85149' : 'transparent', color: delId === r.txn_id ? '#fff' : 'var(--muted)' }}>{delId === r.txn_id ? L2('Confirm?', '确认？') : '🗑'}</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {rows && !rows.length && !open && (
        <div style={{ fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>{L2('No BO bonuses saved yet — use "Paste BO bonuses".', '尚未保存BO奖励记录 — 请使用「粘贴BO奖励记录」。')}</div>
      )}
    </div>
  )
}
