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

export default function EmailModal({ players, onClose, onSent }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const list = (players || []).filter(p => p?.username)
  const withEmail = list.filter(p => EMAIL_RE.test(String(p.email || '').trim()))
  const noEmail = list.filter(p => !EMAIL_RE.test(String(p.email || '').trim()))
  const [tpl, setTpl] = useState('checkin')
  const [tl, setTl] = useState('en')
  const [subject, setSubject] = useState(TEMPLATES.checkin.en[0])
  const [body, setBody] = useState(TEMPLATES.checkin.en[1])
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState(null)
  const [err, setErr] = useState('')
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
  const waNumber = waSel === 'other' ? waDigits(waOther) : waDigits(waSel)
  const waOk = waNumber.length >= 8 && waNumber.length <= 15

  const pick =(k, l) => { setTpl(k); setTl(l); setSubject(TEMPLATES[k][l][0]); setBody(TEMPLATES[k][l][1]) }
  const first = withEmail[0] || list[0]
  const preview = t => t.replaceAll('{name}', String(first?.full_name || first?.username || '').split(/\s+/)[0]).replaceAll('{username}', first?.username || '').replaceAll('{agent}', myName.split(/\s+/)[0] || L2('(your name)', '（你的名字）')).replaceAll('{whatsapp}', `[WhatsApp ${fmtWa(waNumber)}]`)

  async function call(recipients, test) {
    if (!waOk) throw new Error(L2('Pick or type a valid WhatsApp number first.', '请先选择或输入正确的 WhatsApp 号码。'))
    const { data, error } = await supabase.functions.invoke('send-email', { body: { recipients, subject, body, wa_number: waNumber, ...(test ? { test_to: test } : {}) } })
    if (error) {
      let msg = error.message
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* keep message */ }
      throw new Error(msg)
    }
    return data
  }

  async function sendTest() {
    if (!EMAIL_RE.test(testTo.trim())) { setErr(L2('Type your own email address for the test.', '请输入你自己的邮箱来测试。')); return }
    if (!subject.trim() || !body.trim()) { setErr(L2('Subject and message are required.', '主题和内容不能为空。')); return }
    setBusy(true); setErr(''); setProgress('')
    try {
      const d = await call([first.username], testTo.trim())
      const r = d?.results?.[0]
      setProgress(r?.status === 'sent' ? L2(`✅ Test sent to ${testTo.trim()} (filled in with ${first.username}'s details). Check the inbox and the spam folder.`, `✅ 测试已发送到 ${testTo.trim()}（用 ${first.username} 的资料填写）。请查看收件箱和垃圾邮件。`) : L2(`Test not sent: ${r?.reason || 'unknown'}`, `测试未发送：${r?.reason || '未知'}`))
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function sendAll() {
    if (!withEmail.length) return
    if (!subject.trim() || !body.trim()) { setErr(L2('Subject and message are required.', '主题和内容不能为空。')); return }
    if (!window.confirm(L2(`Send this email to ${withEmail.length} player(s)? This cannot be undone.`, `确定发送给 ${withEmail.length} 位玩家？发送后无法撤回。`))) return
    setBusy(true); setErr(''); const all = []
    try {
      const names = withEmail.map(p => p.username)
      for (let i = 0; i < names.length; i += 20) {
        setProgress(L2(`Sending ${Math.min(i + 20, names.length)} / ${names.length}…`, `发送中 ${Math.min(i + 20, names.length)} / ${names.length}…`))
        const d = await call(names.slice(i, i + 20))
        all.push(...(d?.results || []))
        if ((d?.room_left ?? 1) <= 0 && i + 20 < names.length) {
          names.slice(i + 20).forEach(u => all.push({ username: u, status: 'skipped', reason: L2(`hourly limit (${d.hourly_limit}) reached, try again in an hour`, `已达每小时上限（${d.hourly_limit}），一小时后再试`) }))
          break
        }
      }
    } catch (e) { setErr(e.message) }
    setResults(all); setProgress(''); setBusy(false)
    if (all.some(r => r.status === 'sent')) onSent?.()
  }

  const count = s => (results || []).filter(r => r.status === s).length

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={busy ? undefined : onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:700, marginBottom:4 }}>📧 {L2('Send email', '发送邮件')}</div>
        <div style={{ fontSize:13, color:'var(--muted)', marginBottom:8 }}>
          {list.length === 1 ? <><b style={{ color:'var(--text)' }}>{list[0].username}</b> · {list[0].email || L2('no email saved', '没有邮箱')}</> : L2(`${withEmail.length} of ${list.length} selected players have an email`, `已选 ${list.length} 位，其中 ${withEmail.length} 位有邮箱`)}
        </div>
        {noEmail.length > 0 && list.length > 1 && <div style={{ fontSize:11, color:'#d29922', marginBottom:8 }}>{L2('No email (will be skipped): ', '没有邮箱（将跳过）：')}{noEmail.slice(0, 15).map(p => p.username).join(', ')}{noEmail.length > 15 ? ` +${noEmail.length - 15}` : ''}</div>}

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
            <div style={lbl}>{L2('Template', '模板')}</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {[['checkin', L2('👋 Check-in', '👋 问候')], ['offer', L2('🎁 Offer', '🎁 优惠')], ['blank', L2('✏️ Blank', '✏️ 空白')]].map(([k, t]) => ['en', 'zh'].map(l => (
                <button key={k + l} type="button" onClick={() => pick(k, l)} style={{ ...btnSm, padding:'5px 10px', fontWeight:700, background:tpl === k && tl === l ? 'var(--accent)' : 'var(--surface2)', color:tpl === k && tl === l ? '#fff' : 'var(--text)' }}>{t} {l === 'en' ? 'EN' : '中文'}</button>
              )))}
            </div>
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
            <div style={lbl}>{L2('Message', '内容')} <span style={{ fontSize:11 }}>{L2('· {name} = player first name, {agent} = your name, {username}, {whatsapp} = WhatsApp button', '· {name} = 玩家名字，{agent} = 你的名字，{username} = 用户名，{whatsapp} = WhatsApp 按钮')}</span></div>
            <textarea rows={9} style={{ ...input, resize:'vertical' }} value={body} onChange={e => setBody(e.target.value)} />
            {first && <details style={{ marginTop:8, fontSize:12 }}><summary style={{ cursor:'pointer', color:'var(--muted)' }}>{L2(`Preview for ${first.username}`, `预览（${first.username}）`)}</summary>
              <div style={{ background:'var(--surface2)', borderRadius:8, padding:'10px 12px', marginTop:6, whiteSpace:'pre-wrap', lineHeight:1.5 }}><b>{preview(subject)}</b>{'\n\n'}{preview(body)}{'\n\n'}<span style={{ color:'var(--muted)', fontSize:11 }}>{L2(`-- + sureWin signature card (your name, WhatsApp ${fmtWa(waNumber)}, email, Telegram) · Unsubscribe`, `-- + sureWin 签名卡（你的名字、WhatsApp ${fmtWa(waNumber)}、邮箱、Telegram）· 取消订阅`)}</span></div>
            </details>}

            <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:12, flexWrap:'wrap' }}>
              <input style={{ ...input, width:240, flex:'1 1 200px' }} type="email" placeholder={L2('Your email for a test', '你的邮箱（测试用）')} value={testTo} onChange={e => setTestTo(e.target.value)} />
              <button style={btnSm} disabled={busy || !first} onClick={sendTest}>🧪 {L2('Send test to me', '发测试给我')}</button>
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>{L2('A test goes only to your address, marked [TEST], and is not saved in the Contact Log. Unsubscribed players are skipped automatically. Max 100 emails per hour (crm_rules).', '测试只发到你的邮箱（标题有 [TEST]），不记录到联系记录。已取消订阅的玩家会自动跳过。每小时最多 100 封（crm_rules）。')}</div>

            {err && <div style={{ color:'#f85149', fontSize:12, marginTop:10 }}>{err}</div>}
            {progress && <div style={{ color:'var(--muted)', fontSize:12, marginTop:10 }}>{progress}</div>}
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
