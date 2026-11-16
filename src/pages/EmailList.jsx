// 📧 Email a List (2026-11-16): load a Google Sheet (shared "Anyone with the link") or a CSV / Excel file,
// check every row (bad / duplicate / unsubscribed / emailed recently, matched to a CRM player or new),
// then send through the normal email box (send-email edge function, "leads").
// Rows that match a CRM player also go into that player's Contact Log; new people only into email_logs.
// 2026-11-16: pick rows (next 100 not sent), and after each batch the CRM marks the Google Sheet
// (CRM Email / Emailed at / Emailed by) through the sheet-mark edge function + Marcus's Apps Script.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../hooks/useAuth'
import { SHEET_SCRIPT } from '../lib/sheetScript'
import CopyBtn from '../components/CopyBtn'
import EmailModal from '../components/EmailModal'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHUNK = 150
const card = { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 18px', marginBottom:14 }
const input = { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 10px', borderRadius:7, fontSize:13, outline:'none', boxSizing:'border-box', fontFamily:'inherit' }
const btn = { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'8px 14px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer' }
const th = { textAlign:'left', padding:'8px 10px', fontSize:11, color:'var(--muted)', fontWeight:700, borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }
const td = { padding:'7px 10px', fontSize:12, borderBottom:'1px solid var(--border)', verticalAlign:'top' }

const STATUS = {
  ready:  { en:'Ready', zh:'可发送', color:'#2f81f7' },
  bad:    { en:'No / bad email', zh:'没有或错误邮箱', color:'#8b949e' },
  dup:    { en:'Duplicate email', zh:'重复邮箱', color:'#8b949e' },
  unsub:  { en:'Unsubscribed', zh:'已取消订阅', color:'#d29922' },
  recent: { en:'Emailed recently', zh:'最近已发过', color:'#d29922' },
  sent:   { en:'Sent ✅', zh:'已发送 ✅', color:'#3fb950' },
  failed: { en:'Failed', zh:'失败', color:'#f85149' },
  skipped:{ en:'Not sent', zh:'未发送', color:'#d29922' },
}
const NOT_USER = new Set(['not', 'registered', 'invalid', 'number', 'none', 'n/a', 'na', '-', 'yes', 'no'])

const chunks = (a, n = CHUNK) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out }
const waDigits = v => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '6' + d; return d.length >= 10 && d.length <= 15 ? d : '' }

// Google Sheet link -> CSV download links (normal export first, the gviz one as a fallback)
function sheetCsvUrls(link) {
  const id = String(link).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1]
  if (!id) return null
  const gid = String(link).match(/[#&?]gid=(\d+)/)?.[1] || '0'
  return { id, gid, urls: [`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`] }
}
const mytNow = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')

// ⚙ Sheet marking setup (admin): copy the Google script, paste the Web app link, test it
function SheetSetup({ L2, sheet }) {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState(null)
  const [url, setUrl] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('sheet_hook_settings').select('script_url,token,updated_by,updated_at').eq('id', true).maybeSingle()
      .then(({ data }) => { setCfg(data || null); setUrl(data?.script_url || '') })
  }, [])
  if (!cfg) return null
  const ok = !!cfg.script_url
  async function copyScript() {
    try { await navigator.clipboard.writeText(SHEET_SCRIPT.replace('__TOKEN__', cfg.token)); setMsg(L2('✅ Script copied. Paste it in Apps Script (step 2).', '✅ 脚本已复制。请贴到 Apps Script（第 2 步）。')) }
    catch { setMsg(L2('Could not copy. Allow clipboard access and try again.', '无法复制，请允许剪贴板权限后再试。')) }
  }
  async function save() {
    const u = url.trim()
    if (u && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(u)) { setMsg(L2('The link should look like https://script.google.com/macros/s/…/exec', '链接应该像 https://script.google.com/macros/s/…/exec')); return }
    setBusy(true)
    const { error } = await supabase.from('sheet_hook_settings').update({ script_url: u || null, updated_at: new Date().toISOString() }).eq('id', true)
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setCfg(c => ({ ...c, script_url: u || null })); setMsg(L2('✅ Saved. Press Test.', '✅ 已保存，请按测试。'))
  }
  async function test() {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.functions.invoke('sheet-mark', { body: { action: 'ping', ...(sheet ? { sheetId: sheet.id, gid: sheet.gid } : {}) } })
    setBusy(false)
    if (error || !data?.ok) { setMsg('❌ ' + (data?.error === 'not_set_up' ? L2('Save the Web app link first.', '请先保存 Web app 链接。') : (data?.error || error?.message))); return }
    setMsg(data.tab ? L2(`✅ Working. The CRM can write to "${data.sheet}" → tab "${data.tab}".`, `✅ 正常。CRM 可以写入「${data.sheet}」→ 分页「${data.tab}」。`) : L2(`✅ Working (Google account ${data.account}). Load a sheet and press Test again to check that sheet.`, `✅ 正常（Google 账号 ${data.account}）。读取表格后再按测试，可检查那个表格。`))
  }
  const step = { fontSize:12, lineHeight:1.6, margin:'2px 0' }
  return (
    <div style={{ ...card, padding:'10px 18px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ fontSize:13, fontWeight:700 }}>⚙ {L2('Sheet marking setup (admin)', '表格标记设置（管理员）')} · <span style={{ color: ok ? '#3fb950' : '#d29922' }}>{ok ? L2('On: sent rows are marked in the Google Sheet', '已开启：已发送的行会标记在 Google Sheet') : L2('Off: not set up yet', '未开启：还没设置')}</span></div>
        <span style={{ fontSize:12, color:'var(--muted)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ marginTop:10 }}>
        <div style={step}>1. <button style={{ ...btn, padding:'4px 10px' }} onClick={copyScript}>📋 {L2('Copy the script', '复制脚本')}</button></div>
        <div style={step}>2. {L2('Open any Google Sheet with your Google account → Extensions → Apps Script. Delete what is there, paste, press 💾 Save.', '用你的 Google 账号打开任何一个 Google Sheet → 扩展程序 → Apps Script。删除原有内容，贴上，按 💾 保存。')}</div>
        <div style={step}>3. {L2('Deploy → New deployment → ⚙ Select type: Web app. Execute as: Me. Who has access: Anyone. Press Deploy and allow access (Advanced → Go to … if Google warns).', '部署 → 新建部署 → ⚙ 选择类型：Web 应用。执行身份：我。谁可以访问：任何人。按部署并允许权限（如果 Google 警告：高级 → 前往…）。')}</div>
        <div style={step}>4. {L2('Copy the Web app link (ends with /exec), paste it here, Save, then Test.', '复制 Web 应用链接（结尾是 /exec），贴在这里，保存，然后测试。')}</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
          <input style={{ ...input, flex:'1 1 420px' }} placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={e => setUrl(e.target.value)} />
          <button style={btn} disabled={busy} onClick={save}>💾 {L2('Save', '保存')}</button>
          <button style={btn} disabled={busy || !ok} onClick={test}>🧪 {L2('Test', '测试')}</button>
        </div>
        <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>{L2('The script runs as your Google account, so it can mark any sheet you can edit. It only writes 3 columns at the end: CRM Email · Emailed at · Emailed by. The script has its own password, so only this CRM can use the link.', '脚本以你的 Google 账号运行，所以你能编辑的表格都能标记。它只会在最后写 3 列：CRM Email · Emailed at · Emailed by。脚本有自己的密码，只有这个 CRM 能用这个链接。')}</div>
        {msg && <div style={{ fontSize:12, marginTop:6 }}>{msg}</div>}
      </div>}
    </div>
  )
}

// Guess which column holds what, from the header names
function guessCols(head) {
  const h = head.map(x => String(x || '').trim().toLowerCase())
  const find = (...tests) => { for (const t of tests) { const i = h.findIndex(t); if (i >= 0) return i } return -1 }
  return {
    email: find(x => /^e-?mail( address)?$/.test(x), x => x.includes('mail') && !x.includes('check') && !x.includes('status')),
    name: find(x => /^(full ?)?name$/.test(x), x => x.includes('name') && !x.includes('user')),
    phone: find(x => /phone|mobile|whatsapp|contact no|tel/.test(x)),
    username: find(x => /username|user name|login|member id|account id/.test(x)),
  }
}

// 📜 Sent history: every email the CRM sent (email_logs), newest first. Tests are left out.
// Admin / read-only see all; a host sees their own (RLS on email_logs).
function SentHistory({ L2 }) {
  const [days, setDays] = useState(30)
  const [listOnly, setListOnly] = useState(false)
  const [q, setQ] = useState('')
  const [logs, setLogs] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)

  async function load() {
    setBusy(true); setErr('')
    try {
      const since = new Date(Date.now() - Number(days) * 86400000).toISOString()
      const all = []
      for (let from = 0; from < 5000; from += 1000) {
        let qy = supabase.from('email_logs').select('id,created_at,to_email,username,subject,body,sender_name,reason').eq('status', 'sent').gte('created_at', since)
        qy = listOnly ? qy.eq('reason', 'list') : qy.or('reason.is.null,reason.neq.test')
        const { data, error } = await qy.order('created_at', { ascending:false }).range(from, from + 999)
        if (error) throw error
        all.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      setLogs(all)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  useEffect(() => { load() }, [days, listOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const myt = t => new Date(new Date(t).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
  const s = q.trim().toLowerCase()
  const shown = (logs || []).filter(l => !s || [l.to_email, l.username, l.subject, l.sender_name].some(v => String(v || '').toLowerCase().includes(s)))

  function exportHistory() {
    const data = shown.map(l => ({ 'Sent (MYT)': myt(l.created_at), Email: l.to_email, 'CRM username': l.username || '', From: l.reason === 'list' ? 'List' : 'CRM', Subject: l.subject, 'Sent by': l.sender_name || '' }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Sent emails')
    XLSX.writeFile(wb, `sent_emails_${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div style={card}>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:10 }}>
        <select style={input} value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map(d => <option key={d} value={d}>{L2(`Last ${d} days`, `最近 ${d} 天`)}</option>)}
        </select>
        <label style={{ fontSize:12, display:'flex', gap:6, alignItems:'center', cursor:'pointer' }}><input type="checkbox" checked={listOnly} onChange={e => setListOnly(e.target.checked)} />{L2('Only emails sent from a list', '只看名单发送的邮件')}</label>
        <input style={{ ...input, flex:'1 1 220px' }} placeholder={L2('Search email, username, subject, sender…', '搜索邮箱、用户名、主题、发送人…')} value={q} onChange={e => setQ(e.target.value)} />
        <button style={btn} disabled={busy} onClick={load}>🔄 {L2('Refresh', '刷新')}</button>
        <button style={btn} disabled={!shown.length} onClick={exportHistory}>⬇ {L2('Download (.xlsx)', '下载 (.xlsx)')}</button>
      </div>
      {err && <div style={{ fontSize:13, color:'#f85149', marginBottom:8 }}>{err}</div>}
      {busy ? <div style={{ fontSize:13, color:'var(--muted)' }}>⏳ {L2('Loading…', '加载中…')}</div> : (
        <>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>{L2(`${shown.length} email(s) sent. Click a row to read the message.`, `已发送 ${shown.length} 封。点一行可以看内容。`)}</div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                <th style={th}>{L2('Sent (MYT)', '发送时间')}</th><th style={th}>{L2('Email', '邮箱')}</th><th style={th}>{L2('CRM player', 'CRM 玩家')}</th>
                <th style={th}>{L2('Subject', '主题')}</th><th style={th}>{L2('Sent by', '发送人')}</th>
              </tr></thead>
              <tbody>
                {shown.slice(0, 1000).map(l => (
                  <Fragment key={l.id}>
                    <tr onClick={() => setOpen(open === l.id ? null : l.id)} style={{ cursor:'pointer', background: open === l.id ? 'var(--surface2)' : undefined }}>
                      <td style={{ ...td, whiteSpace:'nowrap', color:'var(--muted)' }}>{myt(l.created_at)}</td>
                      <td style={td}>{l.to_email}<CopyBtn text={l.to_email} /></td>
                      <td style={td}>{l.username ? <><b>{l.username}</b><CopyBtn text={l.username} /></> : <span style={{ color:'var(--muted)' }}>🆕 {L2('Not in CRM', '不在 CRM')}</span>}</td>
                      <td style={td}>{l.subject}{l.reason === 'list' && <span style={{ marginLeft:6, fontSize:10, color:'#2f81f7', fontWeight:700 }}>{L2('LIST', '名单')}</span>}</td>
                      <td style={td}>{l.sender_name || '—'}</td>
                    </tr>
                    {open === l.id && <tr><td colSpan={5} style={{ ...td, whiteSpace:'pre-wrap', background:'var(--surface2)', lineHeight:1.5 }}>{l.body || L2('(no message saved)', '（没有保存内容）')}</td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {shown.length > 1000 && <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>{L2(`Showing the first 1,000 of ${shown.length}. Download to see all.`, `只显示前 1,000 行（共 ${shown.length}）。下载可看全部。`)}</div>}
            {!shown.length && <div style={{ fontSize:13, color:'var(--muted)', padding:'10px 0' }}>{L2('No emails sent in this period.', '这段时间没有发送邮件。')}</div>}
          </div>
        </>
      )}
    </div>
  )
}

export default function EmailList() {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [link, setLink] = useState('')
  const [source, setSource] = useState('')
  const [table, setTable] = useState(null) // { head: [], rows: [[...]] }
  const [cols, setCols] = useState({ email:-1, name:-1, phone:-1, username:-1 })
  const [recentDays, setRecentDays] = useState(7)
  const [rows, setRows] = useState([]) // checked rows
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('all')
  const [emailOpen, setEmailOpen] = useState(false)
  const [view, setView] = useState('send')
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [sheet, setSheet] = useState(null) // { id, gid } when loaded from a Google Sheet (for marking)
  const [picked, setPicked] = useState(() => new Set()) // row lines ticked for sending
  const [pickN, setPickN] = useState(100)
  const [markMsg, setMarkMsg] = useState('')
  const markQueue = useRef(Promise.resolve())
  const markCount = useRef({ ok: 0, bad: 0 })

  function applyTable(aoa, name, sh = null) {
    const all = (aoa || []).map(r => (r || []).map(v => (v == null ? '' : String(v).trim())))
    const headAt = all.findIndex(r => r.filter(Boolean).length >= 2)
    if (headAt < 0) { setErr(L2('The file looks empty.', '文件好像是空的。')); return }
    const head = all[headAt]
    const body = all.slice(headAt + 1).map((r, i) => ({ line: headAt + i + 2, cells: r })).filter(r => r.cells.some(Boolean))
    setTable({ head, rows: body, headRow: headAt + 1 }); setCols(guessCols(head)); setRows([]); setSource(name); setFilter('all')
    setSheet(sh); setPicked(new Set()); setMarkMsg('')
  }

  async function loadSheet() {
    setErr('')
    const info = sheetCsvUrls(link)
    if (!info) { setErr(L2('That does not look like a Google Sheet link (it should contain /spreadsheets/d/…).', '这不像 Google Sheet 链接（应包含 /spreadsheets/d/…）。')); return }
    setBusy(L2('Loading the sheet…', '正在读取表格…'))
    let text = ''
    for (const u of info.urls) {
      try {
        const r = await fetch(u)
        const t = await r.text()
        if (r.ok && !/^\s*</.test(t)) { text = t; break }
      } catch { /* try the next link */ }
    }
    setBusy('')
    if (!text) { setErr(L2('Could not read the sheet. In Google Sheets: Share → General access → "Anyone with the link" (Viewer), then try again. Or download it as CSV and upload the file.', '无法读取表格。请在 Google Sheets：共享 → 一般访问权限 → “知道链接的任何人”（查看者），然后再试。或下载为 CSV 再上传。')); return }
    const wb = XLSX.read(text, { type:'string', raw:true })
    applyTable(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:true, defval:'', blankrows:true }), 'Google Sheet', { id: info.id, gid: info.gid })
  }

  async function loadFile(file) {
    if (!file) return
    setErr('')
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type:'array', raw:true })
      applyTable(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:true, defval:'' }), file.name)
    } catch (e) { setErr(L2('Could not read the file: ', '无法读取文件：') + e.message) }
  }

  // Check every row against the CRM: player match (BO username, then email), unsubscribes, recent emails
  async function checkRows() {
    if (!table) return
    if (cols.email < 0) { setErr(L2('Pick the Email column first.', '请先选择邮箱列。')); return }
    setErr(''); setBusy(L2('Checking the list against the CRM…', '正在和 CRM 核对名单…'))
    try {
      // Columns the CRM wrote on an earlier send (CRM Email / Emailed at)
      const hIdx = n => table.head.findIndex(h => String(h).trim().toLowerCase() === n)
      const cMark = hIdx('crm email'), cAt = hIdx('emailed at')
      const base = table.rows.map(r => {
        const cell = i => (i >= 0 ? r.cells[i] || '' : '')
        const email = cell(cols.email).replace(/\s+/g, '')
        const users = [...new Set(cell(cols.username).split(/[\s/,;|]+/).map(s => s.trim()).filter(s => s.length >= 3 && !NOT_USER.has(s.toLowerCase())))]
        return { line: r.line, name: cell(cols.name), email, emailKey: email.toLowerCase(), phone: cell(cols.phone), users, marked: /^sent/i.test(cell(cMark)) ? cell(cAt) || '✓' : '' }
      })
      // CRM players by username (exact, plus lowercase), then by email
      const allUsers = [...new Set(base.flatMap(r => r.users.flatMap(u => [u, u.toLowerCase()])))]
      const byUser = {}
      for (const c of chunks(allUsers)) {
        const { data, error } = await supabase.from('vip_members_all').select('id,username,full_name,email,tier,currency').in('username', c)
        if (error) throw error
        for (const m of data || []) { byUser[m.username] = m; byUser[m.username.toLowerCase()] = m }
      }
      const allEmails = [...new Set(base.filter(r => EMAIL_RE.test(r.email)).flatMap(r => [r.email, r.emailKey]))]
      const byEmail = {}
      for (const c of chunks(allEmails)) {
        const { data, error } = await supabase.from('vip_members_all').select('id,username,full_name,email,tier,currency').in('email', c)
        if (error) throw error
        for (const m of data || []) if (m.email) byEmail[m.email.trim().toLowerCase()] ||= m
      }
      const keys = [...new Set(base.map(r => r.emailKey).filter(e => EMAIL_RE.test(e)))]
      const unsub = new Set(), recent = {}
      const since = new Date(Date.now() - Math.max(0, Number(recentDays) || 0) * 86400000).toISOString()
      for (const c of chunks(keys)) {
        const { data: u } = await supabase.from('email_unsubscribes').select('email').in('email', c)
        for (const x of u || []) unsub.add(String(x.email).toLowerCase())
        if (Number(recentDays) > 0) {
          const { data: l, error } = await supabase.from('email_logs').select('to_email,subject,created_at,reason').eq('status', 'sent').gte('created_at', since).in('to_email', c)
          if (error) throw error
          for (const x of l || []) if (x.reason !== 'test') { const k = String(x.to_email).toLowerCase(); if (!recent[k] || recent[k].created_at < x.created_at) recent[k] = x }
        }
      }
      const seen = new Set()
      setRows(base.map(r => {
        const hits = r.users.map(u => byUser[u] || byUser[u.toLowerCase()]).filter(Boolean)
        const member = hits[0] || byEmail[r.emailKey] || null
        let status = 'ready', note = ''
        if (!EMAIL_RE.test(r.email)) status = 'bad'
        else if (r.marked) { status = 'sent'; note = L2(`marked in the sheet · ${r.marked}`, `表格已标记 · ${r.marked}`) }
        else if (seen.has(r.emailKey)) status = 'dup'
        else if (unsub.has(r.emailKey)) status = 'unsub'
        else if (recent[r.emailKey]) { status = 'recent'; note = `${new Date(recent[r.emailKey].created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })} · ${recent[r.emailKey].subject || ''}` }
        if (EMAIL_RE.test(r.email)) seen.add(r.emailKey)
        const multi = new Set(hits.map(h => h.username)).size > 1 ? L2(`${new Set(hits.map(h => h.username)).size} accounts, using ${member.username}`, `${new Set(hits.map(h => h.username)).size} 个账号，使用 ${member.username}`) : ''
        return { ...r, member, status, note, multi }
      }))
      setPicked(new Set())
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  // ☑ tick the next N ready rows (top to bottom) that are not sent yet
  function pickNext() {
    const n = Math.max(1, Number(pickN) || 100)
    setPicked(new Set(rows.filter(r => r.status === 'ready').slice(0, n).map(r => r.line)))
    setFilter('ready')
  }
  const togglePick = line => setPicked(p => { const s = new Set(p); if (s.has(line)) s.delete(line); else s.add(line); return s })

  // ✍ After each batch: write CRM Email / Emailed at / Emailed by on those rows of the Google Sheet (in order, in the background)
  function markSheet(results) {
    if (!sheet) return
    const lineOf = {}
    for (const r of rows) if (r.status === 'ready' && !lineOf[r.emailKey]) lineOf[r.emailKey] = r.line
    const by = profile?.full_name || profile?.username || ''
    const at = mytNow()
    const marks = (results || []).filter(x => x.email && (x.status === 'sent' || x.status === 'failed') && lineOf[String(x.email).toLowerCase()])
      .map(x => ({ row: lineOf[String(x.email).toLowerCase()], email: String(x.email).toLowerCase(), status: x.status === 'sent' ? 'Sent' : `Failed: ${x.reason || ''}`.slice(0, 120), at, by }))
    if (!marks.length) return
    markQueue.current = markQueue.current.then(async () => {
      const { data, error } = await supabase.functions.invoke('sheet-mark', { body: { action: 'mark', sheetId: sheet.id, gid: sheet.gid, headRow: table?.headRow || 1, emailCol: cols.email + 1, marks } })
      if (error || !data?.ok) {
        markCount.current.bad += marks.length
        setMarkMsg('⚠ ' + (data?.error === 'not_set_up' ? L2('Sheet marking is not set up yet (⚙ setup above), so the sheet was not marked. The emails were sent.', '表格标记还没设置（上方 ⚙ 设置），所以表格没有标记。邮件已发送。') : L2(`Could not mark the sheet: ${data?.error || error?.message}. The emails were sent.`, `无法标记表格：${data?.error || error?.message}。邮件已发送。`)))
      } else {
        markCount.current.ok += data.marked || 0
        setMarkMsg(L2(`✍ ${markCount.current.ok} row(s) marked in the Google Sheet.`, `✍ Google Sheet 已标记 ${markCount.current.ok} 行。`))
      }
    })
  }

  const counts = useMemo(() => {
    const c = { all: rows.length, crm: rows.filter(r => r.member).length, new: rows.filter(r => !r.member).length }
    for (const k of Object.keys(STATUS)) c[k] = rows.filter(r => r.status === k).length
    return c
  }, [rows])
  const shown = rows.filter(r => filter === 'all' ? true : filter === 'crm' ? r.member : filter === 'new' ? !r.member : r.status === filter)
  const ready = rows.filter(r => r.status === 'ready')
  const pickedReady = ready.filter(r => picked.has(r.line))
  const toSend = pickedReady.length ? pickedReady : ready

  function onSent(results) {
    setPicked(new Set())
    const byKey = {}
    for (const r of results || []) if (r.email) byKey[String(r.email).toLowerCase()] = r
    setRows(rs => rs.map(r => {
      const x = r.status === 'ready' ? byKey[r.emailKey] : null
      return x ? { ...r, status: x.status === 'sent' ? 'sent' : x.status === 'failed' ? 'failed' : 'skipped', note: x.reason || '' } : r
    }))
  }

  function exportResults() {
    const data = rows.map(r => ({ Row: r.line, Name: r.name, Email: r.email, Phone: r.phone, 'CRM username': r.member?.username || '', Tier: r.member?.tier || '', Status: STATUS[r.status]?.en || r.status, Note: [r.multi, r.note].filter(Boolean).join(' · ') }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Email list')
    XLSX.writeFile(wb, `email_list_results_${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}.xlsx`)
  }

  const colPick = (key, label) => (
    <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:11, color:'var(--muted)', fontWeight:700 }}>{label}
      <select style={{ ...input, minWidth:170 }} value={cols[key]} onChange={e => setCols(c => ({ ...c, [key]: Number(e.target.value) }))}>
        <option value={-1}>{L2('— none —', '— 无 —')}</option>
        {table.head.map((h, i) => <option key={i} value={i}>{h || `${L2('Column', '列')} ${i + 1}`}</option>)}
      </select>
    </label>
  )
  const chip = (key, label) => (
    <button key={key} type="button" onClick={() => setFilter(key)} style={{ ...btn, padding:'5px 11px', borderRadius:20, background: filter === key ? 'var(--accent)' : 'var(--surface2)', color: filter === key ? '#fff' : 'var(--text)' }}>{label} ({counts[key] || 0})</button>
  )

  return (
    <div style={{ padding:'24px 28px', maxWidth:1400 }}>
      <div style={{ fontSize:22, fontWeight:800, marginBottom:4 }}>📧 {L2('Email a List', '名单群发邮件')}</div>
      <div style={{ fontSize:13, color:'var(--muted)', marginBottom:12 }}>{L2('Send an email to a list from a Google Sheet or a CSV / Excel file, also to people not in the CRM yet. Rows that match a CRM player also go into their Contact Log.', '从 Google Sheet 或 CSV / Excel 名单发送邮件，包括还不在 CRM 的人。对得上 CRM 玩家的，也会记录到该玩家的联系记录。')}</div>
      <div style={{ display:'flex', gap:6, marginBottom:14 }}>
        {[['send', L2('📧 Send', '📧 发送')], ['history', L2('📜 Sent history', '📜 发送记录')]].map(([k, t]) => (
          <button key={k} type="button" onClick={() => setView(k)} style={{ ...btn, background: view === k ? 'var(--accent)' : 'var(--surface2)', color: view === k ? '#fff' : 'var(--text)' }}>{t}</button>
        ))}
      </div>
      {view === 'history' ? <SentHistory L2={L2} /> : <>
      {isAdmin && <SheetSetup L2={L2} sheet={sheet} />}

      <div style={card}>
        <div style={{ fontWeight:700, marginBottom:8 }}>1. {L2('Load the list', '读取名单')}</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <input style={{ ...input, flex:'1 1 420px' }} placeholder={L2('Paste the Google Sheet link (open the right tab first, so the link has its gid)', '粘贴 Google Sheet 链接（先打开正确的分页，让链接带上 gid）')} value={link} onChange={e => setLink(e.target.value)} />
          <button style={{ ...btn, background:'#2f81f7', color:'#fff', border:'none' }} disabled={!!busy || !link.trim()} onClick={loadSheet}>🔗 {L2('Load sheet', '读取表格')}</button>
          <span style={{ fontSize:12, color:'var(--muted)' }}>{L2('or', '或')}</span>
          <label style={{ ...btn, display:'inline-block' }}>📁 {L2('Upload CSV / Excel', '上传 CSV / Excel')}<input type="file" accept=".csv,.xlsx,.xls" style={{ display:'none' }} onChange={e => { loadFile(e.target.files?.[0]); e.target.value = '' }} /></label>
        </div>
        <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>{L2('The sheet must be shared as "Anyone with the link" (Viewer is enough). After sending, the CRM marks each row in 3 columns at the end (CRM Email · Emailed at · Emailed by), when sheet marking is set up. Rows already marked "Sent" are skipped next time.', '表格需要共享为“知道链接的任何人”（查看者即可）。设置了表格标记后，发送后 CRM 会在最后 3 列标记每一行（CRM Email · Emailed at · Emailed by）。已标记“Sent”的行下次会自动跳过。')}</div>
        {table && <div style={{ fontSize:12, marginTop:8 }}>✅ {source}: <b>{table.rows.length}</b> {L2('rows', '行')}</div>}
      </div>

      {table && (
        <div style={card}>
          <div style={{ fontWeight:700, marginBottom:8 }}>2. {L2('Check the columns, then check the list', '确认列，然后核对名单')}</div>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
            {colPick('email', L2('Email *', '邮箱 *'))}
            {colPick('name', L2('Name ({name} in the email)', '名字（邮件里的 {name}）'))}
            {colPick('phone', L2('Phone', '电话'))}
            {colPick('username', L2('BO username (to match CRM players)', 'BO 用户名（对应 CRM 玩家）'))}
            <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:11, color:'var(--muted)', fontWeight:700 }}>{L2('Skip if emailed in the last … days', '最近 … 天发过的跳过')}
              <input type="number" min="0" style={{ ...input, width:110 }} value={recentDays} onChange={e => setRecentDays(e.target.value)} />
            </label>
            <button style={{ ...btn, background:'#2f81f7', color:'#fff', border:'none' }} disabled={!!busy} onClick={checkRows}>🔍 {L2('Check list', '核对名单')}</button>
          </div>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>{L2('"Skip if emailed" lets you send a big list over a few hours (max 100 emails per hour): press Check list again later and the ones already sent are skipped. 0 = do not skip.', '“最近发过的跳过”可以分几个小时发完大名单（每小时最多 100 封）：之后再按一次“核对名单”，已发过的会自动跳过。0 = 不跳过。')}</div>
        </div>
      )}

      {busy && <div style={{ fontSize:13, color:'var(--muted)', marginBottom:10 }}>⏳ {busy}</div>}
      {err && <div style={{ fontSize:13, color:'#f85149', marginBottom:10 }}>{err}</div>}

      {rows.length > 0 && (
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10, marginBottom:10 }}>
            <div style={{ fontWeight:700 }}>3. {L2('Send', '发送')}</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button style={btn} onClick={exportResults}>⬇ {L2('Download results (.xlsx)', '下载结果 (.xlsx)')}</button>
              <button style={{ ...btn, background:'#2f81f7', color:'#fff', border:'none', opacity: toSend.length ? 1 : .5 }} disabled={!toSend.length} onClick={() => { markCount.current = { ok: 0, bad: 0 }; setMarkMsg(''); setEmailOpen(true) }}>📧 {pickedReady.length ? L2(`Email ${pickedReady.length} ticked`, `发送给已勾选的 ${pickedReady.length} 位`) : L2(`Email all ${ready.length} ready`, `发送给全部 ${ready.length} 位`)}</button>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:10, fontSize:12 }}>
            <button style={btn} disabled={!ready.length} onClick={pickNext}>☑ {L2('Tick the next', '勾选接下来')}</button>
            <input type="number" min="1" style={{ ...input, width:80, padding:'6px 8px' }} value={pickN} onChange={e => setPickN(e.target.value)} />
            <span style={{ color:'var(--muted)' }}>{L2('ready rows (top to bottom)', '行可发送的（从上到下）')}</span>
            {picked.size > 0 && <button style={btn} onClick={() => setPicked(new Set())}>✖ {L2(`Clear ${picked.size} ticked`, `取消勾选 ${picked.size} 行`)}</button>}
            <span style={{ color:'var(--muted)' }}>{L2('Or tick rows yourself. Nothing ticked = send to all ready.', '也可以自己勾选。没有勾选 = 发给全部可发送的。')}</span>
          </div>
          {markMsg && <div style={{ fontSize:12, marginBottom:8, color: markMsg.startsWith('⚠') ? '#d29922' : '#3fb950' }}>{markMsg}</div>}
          {!sheet && <div style={{ fontSize:11, color:'var(--muted)', marginBottom:8 }}>{L2('Loaded from a file: the results are not written back anywhere. Use ⬇ Download results to keep them.', '从文件读取：结果不会写回文件。请用 ⬇ 下载结果保存。')}</div>}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
            {chip('all', L2('All', '全部'))}
            {chip('ready', L2('Ready', '可发送'))}
            {chip('crm', L2('In CRM', '在 CRM'))}
            {chip('new', L2('Not in CRM', '不在 CRM'))}
            {['bad', 'dup', 'unsub', 'recent', 'sent', 'failed', 'skipped'].filter(k => counts[k]).map(k => chip(k, L2(STATUS[k].en, STATUS[k].zh)))}
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                <th style={{ ...th, width:28 }}></th>
                <th style={th}>{L2('Row', '行')}</th><th style={th}>{L2('Name', '名字')}</th><th style={th}>{L2('Email', '邮箱')}</th>
                <th style={th}>{L2('Phone', '电话')}</th><th style={th}>{L2('CRM player', 'CRM 玩家')}</th><th style={th}>{L2('Status', '状态')}</th>
              </tr></thead>
              <tbody>
                {shown.slice(0, 1000).map(r => {
                  const st = STATUS[r.status] || STATUS.ready
                  const wa = waDigits(r.phone)
                  return (
                    <tr key={r.line} style={{ background: picked.has(r.line) ? 'rgba(47,129,247,0.08)' : undefined }}>
                      <td style={td}>{r.status === 'ready' && <input type="checkbox" checked={picked.has(r.line)} onChange={() => togglePick(r.line)} style={{ cursor:'pointer' }} />}</td>
                      <td style={{ ...td, color:'var(--muted)' }}>{r.line}</td>
                      <td style={td}>{r.name || '—'}</td>
                      <td style={td}>{r.email || <span style={{ color:'var(--muted)' }}>—</span>}</td>
                      <td style={{ ...td, whiteSpace:'nowrap' }}>{r.phone ? <>{r.phone}<CopyBtn text={r.phone} kind="phone" />{wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" style={{ marginLeft:6, fontSize:11, color:'#3fb950', fontWeight:700, textDecoration:'none' }}>💬 WA</a>}</> : '—'}</td>
                      <td style={td}>{r.member
                        ? <><b>{r.member.username}</b><CopyBtn text={r.member.username} /> <span style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>{r.member.tier}</span>{r.multi && <div style={{ fontSize:10, color:'#d29922' }}>{r.multi}</div>}</>
                        : <span style={{ color:'var(--muted)' }}>🆕 {L2('Not in CRM', '不在 CRM')}</span>}</td>
                      <td style={td}><span style={{ fontSize:11, fontWeight:700, color:st.color }}>{L2(st.en, st.zh)}</span>{r.note && <div style={{ fontSize:10, color:'var(--muted)', maxWidth:280 }}>{r.note}</div>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {shown.length > 1000 && <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>{L2(`Showing the first 1,000 of ${shown.length}. Download the results to see all.`, `只显示前 1,000 行（共 ${shown.length}）。下载结果可看全部。`)}</div>}
          </div>
        </div>
      )}
      </>}

      {emailOpen && (
        <EmailModal
          title={L2(`Email ${toSend.length} people from ${source}`, `发送邮件给 ${source} 的 ${toSend.length} 人`)}
          onBatch={markSheet}
          players={toSend.map(r => ({ lead: { email: r.email, name: r.name, username: r.member?.username || '' }, email: r.email, full_name: r.name, username: r.member?.username || '' }))}
          onSent={onSent}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </div>
  )
}
