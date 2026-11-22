// 📧 Send an email to one or more players from the CRM (2026-11-10).
// Goes out through the send-email edge function (surewinworld.com mail server). Each sent email is
// saved in email_logs and in the Contact Log (channel Email). Unsubscribed players are skipped.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../hooks/useAuth'

const box = { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'22px 26px', width:620, maxWidth:'94vw', maxHeight:'90vh', overflowY:'auto' }
const input = { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 10px', borderRadius:7, fontSize:13, outline:'none', width:'100%', boxSizing:'border-box', fontFamily:'inherit' }
const lbl = { fontSize:12, color:'var(--muted)', margin:'10px 0 4px' }
const btnSm = { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'7px 14px', borderRadius:7, fontSize:12, cursor:'pointer' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Player-facing text: casual "bro" peer tone, opens with who we are, brand written sureWin
// {whatsapp} = the WhatsApp number picked in the box; in the email it becomes a green "WhatsApp" button (wa.me link)
const TEMPLATES = {
  checkin: {
    en: ['Hey {name}, long time no see!', "Hi {name},\n\nI'm {agent} from sureWin VIP department. Been a while since we saw you around, bro, just checking in. Everything ok?\n\nIf there's anything we can do for you, just reply to this email or WhatsApp me anytime.\n\nCheers,\n{agent}\nsureWin VIP department\n{whatsapp}"],
    zh: ['{name}，好久不见！', '{name} 你好，\n\n我是 sureWin VIP 部门的 {agent}。好一阵子没见到你了，来问候一下，一切都好吗？\n\n有什么需要帮忙的，直接回复这封邮件或 WhatsApp 我就可以。\n\n{agent}\nsureWin VIP 部门\n{whatsapp}'],
  },
  offer: {
    en: ['{name}, something special for you', "Hi {name},\n\nI'm {agent} from sureWin VIP department. Got something special for you this week, bro: [write the offer here].\n\nReply to this email or WhatsApp me and I'll set it up for you.\n\nCheers,\n{agent}\nsureWin VIP department\n{whatsapp}"],
    zh: ['{name}，给你的专属优惠', '{name} 你好，\n\n我是 sureWin VIP 部门的 {agent}。这周有个专属优惠给你：[在这里写优惠内容]。\n\n回复这封邮件或 WhatsApp 我，我帮你安排。\n\n{agent}\nsureWin VIP 部门\n{whatsapp}'],
  },
  blank: { en: ['', "Hi {name},\n\nI'm {agent} from sureWin VIP department. \n\nCheers,\n{agent}\n{whatsapp}"], zh: ['', '{name} 你好，\n\n我是 sureWin VIP 部门的 {agent}。\n\n{agent}\n{whatsapp}'] },
}
const MAIN_WA = '601155715603' // VIP department line (also the default on the signature card)
const waDigits = v => String(v || '').replace(/\D/g, '')
// Same display format as the email: +60 11-1236 5940 / +65 9123 4567
const fmtWa =v => {
  const d = waDigits(v)
  if (d.startsWith('60') && d.length >= 10) { const a = d.slice(2, 4), r = d.slice(4); return `+60 ${a}-${r.slice(0, r.length - 4)} ${r.slice(-4)}` }
  if (d.startsWith('65') && d.length === 10) return `+65 ${d.slice(2, 6)} ${d.slice(6)}`
  return d ? `+${d}` : ''
}

// preset    = { subject, body } to start with (e.g. the campaign message from the WhatsApp popup)
// perPlayer = { username: { subject?, body } }: every player gets their own message (campaign bulk email);
//             the template / message box is hidden then, only the subject can be changed
// onSent(results) is called after a real send (not a test); onBatch(results) after every batch of 5
// 💾 Saved templates (email_templates table, 2026-11-16): everyone sees them, the writer or an admin can change / delete
// onSchedule({ subject, body, wa_number, per_hour }) (Email a List, 2026-11-22): shows ⏰ Auto-send, the server then sends every hour
export default function EmailModal({ players, onClose, onSent, onBatch, preset, perPlayer, title, onSchedule }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  // players: CRM players { username, email, full_name } or list rows from the Email a List page
  // { lead: { email, name, username? }, email, full_name } (sent to the list's email, username only when matched)
  const list = (players || []).filter(p => p?.username || p?.lead?.email)
  const keyOf = p => p.lead ? (p.lead.username || p.lead.email) : p.username
  const withEmail = list.filter(p => EMAIL_RE.test(String(p.email || '').trim()))
  const noEmail = list.filter(p => !EMAIL_RE.test(String(p.email || '').trim()))
  const [tpl, setTpl] = useState(preset || perPlayer ? 'custom' : 'checkin')
  const [tl, setTl] = useState('en')
  const [subject, setSubject] = useState(preset?.subject ?? (perPlayer ? '' : TEMPLATES.checkin.en[0]))
  const [body, setBody] = useState(preset?.body ?? (perPlayer ? '' : TEMPLATES.checkin.en[1]))
  const own = perPlayer || null
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState(null)
  const [err, setErr] = useState('')
  const [perHour, setPerHour] = useState(100)
  // 📱 WhatsApp number shown in this email (message end + signature card): my active numbers, the VIP main line, or typed in
  const { profile } = useAuth()
  const myName = profile?.full_name || profile?.username || ''
  const [myNums, setMyNums] = useState([])
  const [waSel, setWaSel] = useState(MAIN_WA)
  const [waOther, setWaOther] = useState('')
  useEffect(() => {
    if (!myName) return
    let off = false
    supabase.from('wa_numbers').select('id,codename,number').eq('host', myName).eq('status', 'Active').order('codename')
      .then(({ data }) => { if (!off && data) setMyNums(data.filter(n => waDigits(n.number))) })
    return () => { off = true }
  }, [myName])
  const [saved, setSaved] = useState([])
  const loadSaved = () => supabase.from('email_templates').select('id,name,subject,body,created_by,created_by_name').order('name').then(({ data }) => setSaved(data || []))
  useEffect(() => { if (!perPlayer) loadSaved() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = tpl.startsWith('saved:') ? saved.find(t => 'saved:' + t.id === tpl) : null
  const canEdit = t => t && (t.created_by === profile?.id || profile?.role === 'admin')
  async function saveTemplate() {
    if (!subject.trim() || !body.trim()) { setErr(L2('Write the subject and message first.', '请先写主题和内容。')); return }
    if (canEdit(cur) && window.confirm(L2(`Update the saved template "${cur.name}" with this subject and message?
(Cancel = save as a new template)`, `用现在的主题和内容更新模板「${cur.name}」？
（取消 = 另存为新模板）`))) {
      const { error } = await supabase.from('email_templates').update({ subject, body, updated_at: new Date().toISOString() }).eq('id', cur.id)
      if (error) { setErr(error.message); return }
      setProgress(L2(`💾 Template "${cur.name}" updated.`, `💾 模板「${cur.name}」已更新。`)); loadSaved(); return
    }
    const name = (window.prompt(L2('Name for this template (e.g. Gold Bar invite EN):', '模板名称（例如：金条活动邀请 中文）：'), '') || '').trim()
    if (!name) return
    const { data, error } = await supabase.from('email_templates').insert({ name, subject, body, created_by: profile?.id, created_by_name: myName }).select('id').single()
    if (error) { setErr(error.message); return }
    setErr(''); setProgress(L2(`💾 Saved as template "${name}".`, `💾 已保存为模板「${name}」。`)); setTpl('saved:' + data.id); loadSaved()
  }
  async function deleteTemplate() {
    if (!canEdit(cur) || !window.confirm(L2(`Delete the template "${cur.name}"? This cannot be undone.`, `删除模板「${cur.name}」？删除后无法恢复。`))) return
    const { error } = await supabase.from('email_templates').delete().eq('id', cur.id)
    if (error) { setErr(error.message); return }
    setTpl('custom'); setProgress(L2('🗑 Template deleted.', '🗑 模板已删除。')); loadSaved()
  }
  const waNumber = waSel === 'other' ? waDigits(waOther) : waDigits(waSel)
  const waOk = waNumber.length >= 8 && waNumber.length <= 15

  const pick =(k, l) => { setTpl(k); setTl(l); setSubject(TEMPLATES[k][l][0]); setBody(TEMPLATES[k][l][1]) }
  const first = withEmail[0] || list[0]
  const niceName = s => s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, c => c.toUpperCase()) : s
  const firstName = first?.lead ? niceName(String(first.lead.name || first.lead.email.split('@')[0])) : String(first?.full_name || first?.username || '').split(/\s+/)[0]
  const preview = t => t.replaceAll('{name}', firstName).replaceAll('{username}', first?.username || '').replaceAll('{agent}', myName.split(/\s+/)[0] || L2('(your name)', '（你的名字）')).replaceAll('{whatsapp}', `[WhatsApp ${fmtWa(waNumber)}]`)

  async function call(batch, test) {
    if (!waOk) throw new Error(L2('Pick or type a valid WhatsApp number first.', '请先选择或输入正确的 WhatsApp 号码。'))
    const recipients = batch.filter(p => !p.lead).map(p => p.username)
    const leads = batch.filter(p => p.lead).map(p => p.lead)
    const messages = own ? Object.fromEntries(recipients.filter(u => own[u]).map(u => [u, own[u]])) : undefined
    const { data, error } = await supabase.functions.invoke('send-email', { body: { recipients, ...(leads.length ? { leads } : {}), subject, body: own ? '' : body, wa_number: waNumber, ...(messages ? { messages } : {}), ...(test ? { test_to: test } : {}) } })
    if (error) {
      let msg = error.message
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* keep message */ }
      throw new Error(msg)
    }
    return data
  }

  // Test: one or more own addresses, separated by comma / space / semicolon (max 5)
  async function sendTest() {
    const addrs = [...new Set(testTo.split(/[\s,;]+/).map(a => a.trim()).filter(Boolean))]
    if (!addrs.length || addrs.some(a => !EMAIL_RE.test(a))) { setErr(L2('Type your own email address(es) for the test, separated by commas.', '请输入你自己的邮箱来测试，多个用逗号分开。')); return }
    if (addrs.length > 5) { setErr(L2('Max 5 test addresses at once.', '测试最多一次 5 个邮箱。')); return }
    if (!subject.trim() || (!own && !body.trim())) { setErr(L2('Subject and message are required.', '主题和内容不能为空。')); return }
    setBusy(true); setErr(''); setProgress('')
    const ok = [], bad = []
    for (const a of addrs) {
      try {
        const r = (await call([first], a))?.results?.[0]
        if (r?.status === 'sent') ok.push(a); else bad.push(`${a}: ${r?.reason || L2('unknown', '未知')}`)
      } catch (e) { bad.push(`${a}: ${e.message}`) }
    }
    if (ok.length) setProgress(L2(`✅ Test sent to ${ok.join(', ')} (filled in with ${keyOf(first)}'s details). Check the inbox and the spam folder.`, `✅ 测试已发送到 ${ok.join('、')}（用 ${keyOf(first)} 的资料填写）。请查看收件箱和垃圾邮件。`))
    if (bad.length) setErr(L2('Test not sent: ', '测试未发送：') + bad.join(' · '))
    setBusy(false)
  }

  async function sendAll() {
    if (!withEmail.length) return
    if (!subject.trim() || (!own && !body.trim())) { setErr(L2('Subject and message are required.', '主题和内容不能为空。')); return }
    if (!window.confirm(L2(`Send this email to ${withEmail.length} player(s)? This cannot be undone.`, `确定发送给 ${withEmail.length} 位玩家？发送后无法撤回。`))) return
    setBusy(true); setErr(''); const all = []
    try {
      const names = withEmail
      const N = 5
      for (let i = 0; i < names.length; i += N) {
        setProgress(L2(`Sending ${Math.min(i + N, names.length)} / ${names.length}…`, `发送中 ${Math.min(i + N, names.length)} / ${names.length}…`))
        const d = await call(names.slice(i, i + N))
        all.push(...(d?.results || []))
        onBatch?.(d?.results || [])
        if ((d?.room_left ?? 1) <= 0 && i + N < names.length) {
          names.slice(i + N).forEach(p => all.push({ username: keyOf(p), email: p.email, status: 'skipped', reason: L2(`hourly limit (${d.hourly_limit}) reached, try again in an hour`, `已达每小时上限（${d.hourly_limit}），一小时后再试`) }))
          break
        }
      }
    } catch (e) {
      setErr(e.message)
      const done = new Set(all.map(r => r.username))
      withEmail.filter(p => !done.has(keyOf(p))).forEach(p => all.push({ username: keyOf(p), email: p.email, status: 'failed', reason: L2(`not sent (stopped: ${e.message}). Check the Contact Log before sending again.`, `未发送（中断：${e.message}）。再发之前请先查看联系记录。`) }))
    }
    setResults(all); setProgress(''); setBusy(false)
    if (all.some(r => r.status === 'sent')) onSent?.(all)
  }

  async function schedule() {
    if (!subject.trim() || !body.trim()) { setErr(L2('Subject and message are required.', '主题和内容不能为空。')); return }
    if (!waOk) { setErr(L2('Pick or type a valid WhatsApp number first.', '请先选择或输入正确的 WhatsApp 号码。')); return }
    const n = Math.min(100, Math.max(1, Math.round(Number(perHour) || 100)))
    if (!window.confirm(L2(`Start auto-send to ${withEmail.length} people, ${n} per hour (about ${Math.ceil(withEmail.length / n)} hour(s))? The server sends by itself, you can close this page. You can pause or stop it any time.`, `开始自动发送给 ${withEmail.length} 人，每小时 ${n} 封（约 ${Math.ceil(withEmail.length / n)} 小时）？服务器会自己发送，可以关闭这个页面。随时可以暂停或停止。`))) return
    setBusy(true); setErr('')
    try { await onSchedule({ subject, body, wa_number: waNumber, per_hour: n }); onClose() }
    catch (e) { setErr(e.message); setBusy(false) }
  }

  const count = s => (results || []).filter(r => r.status === s).length

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={busy ? undefined : onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:700, marginBottom:4 }}>📧 {title || L2('Send email', '发送邮件')}</div>
        <div style={{ fontSize:13, color:'var(--muted)', marginBottom:8 }}>
          {list.length === 1 ? <><b style={{ color:'var(--text)' }}>{keyOf(list[0])}</b> · {list[0].email || L2('no email saved', '没有邮箱')}</> : L2(`${withEmail.length} of ${list.length} selected players have an email`, `已选 ${list.length} 位，其中 ${withEmail.length} 位有邮箱`)}
        </div>
        {noEmail.length > 0 && list.length > 1 && <div style={{ fontSize:11, color:'#d29922', marginBottom:8 }}>{L2('No email (will be skipped): ', '没有邮箱（将跳过）：')}{noEmail.slice(0, 15).map(keyOf).join(', ')}{noEmail.length > 15 ? ` +${noEmail.length - 15}` : ''}</div>}

        {results ? (
          <div>
            <div style={{ display:'flex', gap:14, fontSize:13, margin:'10px 0' }}>
              <span style={{ color:'#3fb950', fontWeight:700 }}>✅ {count('sent')} {L2('sent', '已发送')}</span>
              <span style={{ color:'#d29922', fontWeight:700 }}>⏭ {count('skipped')} {L2('skipped', '跳过')}</span>
              <span style={{ color:'#f85149', fontWeight:700 }}>❌ {count('failed')} {L2('failed', '失败')}</span>
            </div>
            {results.filter(r => r.status !== 'sent').length > 0 && (
              <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8, padding:'6px 10px', fontSize:12 }}>
                {results.filter(r => r.status !== 'sent').map((r, i) => <div key={i}><b>{r.username}</b>: {r.reason}</div>)}
              </div>
            )}
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:8 }}>{L2('Sent emails are saved in the Contact Log (channel Email). Replies go to the VIP mailbox in webmail.', '已发送的邮件会记录在联系记录（渠道：Email）。玩家回复会进入 webmail 的 VIP 邮箱。')}</div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}><button style={btnSm} onClick={onClose}>{L2('Close', '关闭')}</button></div>
          </div>
        ) : (
          <>
            {!own && <><div style={lbl}>{L2('Template', '模板')}</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {[['checkin', L2('👋 Check-in', '👋 问候')], ['offer', L2('🎁 Offer', '🎁 优惠')], ['blank', L2('✏️ Blank', '✏️ 空白')]].map(([k, t]) => ['en', 'zh'].map(l => (
                <button key={k + l} type="button" onClick={() => pick(k, l)} style={{ ...btnSm, padding:'5px 10px', fontWeight:700, background:tpl === k && tl === l ? 'var(--accent)' : 'var(--surface2)', color:tpl === k && tl === l ? '#fff' : 'var(--text)' }}>{t} {l === 'en' ? 'EN' : '中文'}</button>
              )))}
            </div>
            <div style={{ ...lbl, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>💾 {L2('Saved templates', '已保存的模板')}</span>
              <span style={{ display:'flex', gap:6 }}>
                <button type="button" style={{ ...btnSm, padding:'3px 10px' }} onClick={saveTemplate}>💾 {L2('Save as template', '保存为模板')}</button>
                {canEdit(cur) && <button type="button" style={{ ...btnSm, padding:'3px 10px', color:'#f85149' }} onClick={deleteTemplate}>🗑 {L2('Delete', '删除')}</button>}
              </span>
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {saved.length ? saved.map(t => (
                <button key={t.id} type="button" title={t.created_by_name ? L2(`by ${t.created_by_name}`, `${t.created_by_name} 建立`) : ''} onClick={() => { setTpl('saved:' + t.id); setSubject(t.subject); setBody(t.body) }} style={{ ...btnSm, padding:'5px 10px', fontWeight:700, background:tpl === 'saved:' + t.id ? 'var(--accent)' : 'var(--surface2)', color:tpl === 'saved:' + t.id ? '#fff' : 'var(--text)' }}>{t.name}</button>
              )) : <span style={{ fontSize:11, color:'var(--muted)' }}>{L2('None yet. Write the subject and message below, then press 💾 Save as template.', '还没有。在下面写好主题和内容，再按 💾 保存为模板。')}</span>}
            </div></>}
            <div style={lbl}>📱 {L2('WhatsApp number in this email (message end + signature)', '邮件里的 WhatsApp 号码（结尾 + 签名卡）')}</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <select style={{ ...input, width:'auto', flex:'1 1 240px' }} value={waSel} onChange={e => setWaSel(e.target.value)}>
                {myNums.map(n => <option key={n.id} value={waDigits(n.number)}>{n.codename ? `${n.codename} · ` : ''}{fmtWa(n.number)}</option>)}
                <option value={MAIN_WA}>{L2('VIP main line', 'VIP 主号')} · {fmtWa(MAIN_WA)}</option>
                <option value="other">{L2('Other number… (type it)', '其他号码…（自己输入）')}</option>
              </select>
              {waSel === 'other' && <input style={{ ...input, flex:'1 1 180px' }} placeholder="60123456789" value={waOther} onChange={e => setWaOther(e.target.value)} />}
            </div>
            {!waOk && <div style={{ fontSize:11, color:'#f85149', marginTop:4 }}>{L2('Type the full number with country code, e.g. 60123456789', '请输入完整号码（含国家代码），例如 60123456789')}</div>}
            <div style={lbl}>{L2('Subject', '主题')}</div>
            <input style={input} value={subject} onChange={e => setSubject(e.target.value)} />
            {own ? (
              <div style={{ fontSize:12, color:'var(--muted)', background:'var(--surface2)', borderRadius:8, padding:'8px 12px', marginTop:10 }}>
                {L2('Each player gets their own campaign message (the same text as the WhatsApp message, with their own numbers). The sureWin signature card and the WhatsApp button are added at the end.', '每位玩家收到自己的活动讯息（和 WhatsApp 讯息一样，带各自的数字）。结尾会加上 sureWin 签名卡和 WhatsApp 按钮。')}
              </div>
            ) : <>
            <div style={lbl}>{L2('Message', '内容')} <span style={{ fontSize:11 }}>{L2('· {name} = player first name, {agent} = your name, {username}, {whatsapp} = WhatsApp button', '· {name} = 玩家名字，{agent} = 你的名字，{username} = 用户名，{whatsapp} = WhatsApp 按钮')}</span></div>
            <textarea rows={9} style={{ ...input, resize:'vertical' }} value={body} onChange={e => setBody(e.target.value)} />
            </>}
            {first && <details style={{ marginTop:8, fontSize:12 }}><summary style={{ cursor:'pointer', color:'var(--muted)' }}>{L2(`Preview for ${keyOf(first)}`, `预览（${keyOf(first)}）`)}</summary>
              <div style={{ background:'var(--surface2)', borderRadius:8, padding:'10px 12px', marginTop:6, whiteSpace:'pre-wrap', lineHeight:1.5 }}><b>{preview(subject)}</b>{'\n\n'}{preview(own ? (own[first.username]?.body || L2('(no message for this player)', '（这位玩家没有讯息）')) : body)}{'\n\n'}<span style={{ color:'var(--muted)', fontSize:11 }}>{L2(`-- + sureWin signature card (your name, WhatsApp ${fmtWa(waNumber)}, email, Telegram) · Unsubscribe`, `-- + sureWin 签名卡（你的名字、WhatsApp ${fmtWa(waNumber)}、邮箱、Telegram）· 取消订阅`)}</span></div>
            </details>}

            <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:12, flexWrap:'wrap' }}>
              <input style={{ ...input, width:240, flex:'1 1 200px' }} placeholder={L2('Your email(s) for a test, comma between', '测试邮箱（多个用逗号分开）')} value={testTo} onChange={e => setTestTo(e.target.value)} />
              <button style={btnSm} disabled={busy || !first} onClick={sendTest}>🧪 {L2('Send test to me', '发测试给我')}</button>
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>{L2('A test goes only to the address(es) typed here (up to 5, comma between), marked [TEST], and is not saved in the Contact Log. Unsubscribed players are skipped automatically. Max 100 emails per hour (crm_rules).', '测试只发到这里输入的邮箱（最多 5 个，用逗号分开，标题有 [TEST]），不记录到联系记录。已取消订阅的玩家会自动跳过。每小时最多 100 封（crm_rules）。')}</div>

            {err && <div style={{ color:'#f85149', fontSize:12, marginTop:10 }}>{err}</div>}
            {progress && <div style={{ color:'var(--muted)', fontSize:12, marginTop:10 }}>{progress}</div>}
            {onSchedule && !own && (
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:14, padding:'10px 12px', border:'1px dashed var(--border)', borderRadius:8, fontSize:12 }}>
                <span style={{ fontWeight:700 }}>⏰ {L2('Auto-send', '自动发送')}</span>
                <input type="number" min="1" max="100" style={{ ...input, width:70, padding:'5px 8px' }} value={perHour} onChange={e => setPerHour(e.target.value)} />
                <span style={{ color:'var(--muted)' }}>{L2('per hour (max 100), the server keeps going until the list is done', '封 / 小时（最多 100），服务器会一直发到名单完成')}</span>
                <button style={{ ...btnSm, marginLeft:'auto', background:'#8957e5', color:'#fff', border:'none', fontWeight:700 }} disabled={busy || !withEmail.length} onClick={schedule}>⏰ {L2(`Auto-send to ${withEmail.length}`, `自动发送给 ${withEmail.length} 人`)}</button>
              </div>
            )}
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:14 }}>
              <button style={btnSm} disabled={busy} onClick={onClose}>{L2('Cancel', '取消')}</button>
              <button style={{ background:'#2f81f7', color:'#fff', border:'none', padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor:busy || !withEmail.length ? 'default' : 'pointer', opacity:busy || !withEmail.length ? .5 : 1 }} disabled={busy || !withEmail.length} onClick={sendAll}>
                {busy ? L2('Sending…', '发送中…') : L2(`📧 Send to ${withEmail.length}`, `📧 发送给 ${withEmail.length} 位`)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
