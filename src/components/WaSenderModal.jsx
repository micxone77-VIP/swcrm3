// src/components/WaSenderModal.jsx — shared WhatsApp popup (fix 4, 2026-10-21)
// Every WA button uses this: bro-tone EN/中文 template, Copy / Open WhatsApp auto-log one contact,
// Undo, then "Replied / No reply yet" + next follow-up date. Shows Unreachable (3 no-replies).
// ContactFollowUp and ContactHistory are also used by popups that build their own message (Upgrades, Churn).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../hooks/useAuth'
import ProfileCard from './vip/ProfileCard'
import CopyBtn from './CopyBtn'

const MYT_MS = 8 * 3600 * 1000
const mytNow = () => new Date(Date.now() + MYT_MS)
const mytDateStr = (addDays = 0) => { const d = mytNow(); d.setUTCDate(d.getUTCDate() + addDays); return d.toISOString().slice(0, 10) }
const fmtDay = (ts, lang) => new Date(ts).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' })
const UNREACHABLE_DEFAULT = 3

// Insert one outbound contact log; returns { id } or { error }
export async function insertContactLog({ vip, hostName, summary, channel = 'WhatsApp', topic = null, waNumberUsed = null }) {
  const { data: { user } } = await supabase.auth.getUser()
  const myt = mytNow()
  const { data, error } = await supabase.from('contact_logs').insert({
    vip_id:          vip.vip_id || vip.id || null,
    username:        vip.username,
    tier:            vip.tier || null,
    channel,
    outcome:         'Contacted',
    direction:       'outbound',
    topic,
    notes:           summary,
    message_summary: summary,
    wa_number_used:  waNumberUsed || null,
    host_name:       hostName || 'Host',
    host_id:         user?.id || null,
    logged_at:       new Date().toISOString(),
    log_month:       myt.toISOString().slice(0, 7),
    log_week:        String(Math.ceil(myt.getUTCDate() / 7)),
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: data.id }
}

export async function deleteContactLog(id) {
  const { data, error } = await supabase.from('contact_logs').delete().eq('id', id).select('id')
  if (error || !data?.length) return error?.message || 'not allowed to delete'
  return null
}

// Last contacts for one VIP: attempts since last reply → Unreachable
export function useContactHistory(username, refreshKey = 0) {
  const [info, setInfo] = useState(undefined)
  useEffect(() => {
    if (!username) return
    let off = false
    Promise.all([
      supabase.from('contact_logs').select('id, logged_at, outcome, host_name, channel').eq('username', username)
        .order('logged_at', { ascending: false }).limit(20),
      supabase.from('crm_rules').select('value').eq('rule_key', 'unreachable_attempts').maybeSingle(),
    ]).then(([logs, rule]) => {
      if (off) return
      const rows = logs.data || []
      const limit = Number(rule.data?.value) || UNREACHABLE_DEFAULT
      let attempts = 0
      for (const r of rows) { if (r.outcome === 'Replied' || r.outcome === 'Reactivated' || r.outcome === 'Deposited') break; if (r.outcome === 'Contacted' || r.outcome === 'No Reply') attempts++ }
      setInfo({ last: rows[0] || null, attempts, limit, unreachable: attempts >= limit })
    })
    return () => { off = true }
  }, [username, refreshKey])
  return info
}

// "Last contact … · Unreachable" line; lets the host mark the previous message as replied
export function ContactHistory({ username, excludeLogId, refreshKey = 0, onChanged }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [tick, setTick] = useState(0)
  const info = useContactHistory(username, refreshKey + tick)
  const [busy, setBusy] = useState(false)
  if (info === undefined) return <div style={st.histBox}><span style={{ color: 'var(--muted)' }}>{L2('Checking contact history…', '查询联系记录…')}</span></div>
  const prev = info.last && info.last.id !== excludeLogId ? info.last : null
  async function markReplied() {
    setBusy(true)
    await supabase.from('contact_logs').update({ outcome: 'Replied' }).eq('id', prev.id)
    setBusy(false); setTick(t => t + 1); onChanged && onChanged()
  }
  return (
    <div style={{ ...st.histBox, ...(info.unreachable ? st.histWarn : null) }}>
      {prev
        ? <>🕒 {L2('Last contact', '上次联系')} <strong>{fmtDay(prev.logged_at, lang)}</strong>
            <span style={{ color: 'var(--muted)' }}>{prev.host_name ? ` · ${prev.host_name}` : ''} · {prev.outcome === 'Replied' ? L2('replied', '已回复') : L2('no reply yet', '未回复')}</span>
            {prev.outcome === 'Contacted' && <button disabled={busy} onClick={markReplied} style={st.linkBtn}>{L2('They replied', '已回复了')}</button>}</>
        : <span style={{ color: 'var(--muted)' }}>🕒 {L2('No earlier contact', '之前没有联系记录')}</span>}
      {info.unreachable && <div style={{ marginTop: 4, color: '#f85149', fontWeight: 700 }}>
        ⚠️ {L2(`Unreachable: ${info.attempts} messages with no reply. Try a call or another channel.`, `联系不上：${info.attempts} 次未回复，请改打电话或换渠道。`)}
      </div>}
    </div>
  )
}

// Player's mood in the reply → contact_logs.emotion_tag (sentiment score on the KPI board). Shared with the call log.
export const MOODS = [
  { v: 'positive', icon: '😊', en: 'Happy', zh: '开心' },
  { v: 'neutral', icon: '😐', en: 'Neutral', zh: '一般' },
  { v: 'dissatisfied', icon: '😠', en: 'Unhappy', zh: '不满' },
]
export function MoodPicker({ value, onChange }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const chip = on => ({ ...st.chip, ...(on ? st.chipOn : null) })
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ color: 'var(--muted)' }}>{L2('Mood?', '情绪？')}</span>
      {MOODS.map(m => <button key={m.v} type="button" style={chip(value === m.v)} onClick={() => onChange(value === m.v ? null : m.v)}>{m.icon} {L2(m.en, m.zh)}</button>)}
    </div>
  )
}

// After a contact is logged: Replied / No reply yet + next follow-up date (saved on that log)
export function ContactFollowUp({ logId, unreachable = false, onUndo, onSaved }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [outcome, setOutcome] = useState('none')        // 'replied' | 'none'
  const [mood, setMood] = useState(null)                // emotion_tag after a reply: positive | neutral | dissatisfied
  const [date, setDate] = useState(mytDateStr(unreachable ? 3 : 1))
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  function pick(o) { setOutcome(o); setSaved(false); setDate(mytDateStr(o === 'replied' ? 2 : (unreachable ? 3 : 1))) }
  async function save() {
    setBusy(true); setErr('')
    const { error } = await supabase.from('contact_logs')
      .update({ outcome: outcome === 'replied' ? 'Replied' : 'Contacted', emotion_tag: outcome === 'replied' ? mood : null, follow_up_needed: !!date, follow_up_date: date || null }).eq('id', logId)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSaved(true); onSaved && onSaved()
  }
  const chip = on => ({ ...st.chip, ...(on ? st.chipOn : null) })
  return (
    <div style={st.followBox}>
      <div style={{ color: '#3fb950', fontWeight: 700, marginBottom: 8 }}>
        ✅ {L2('Logged to Contact Log', '已记录到联系记录')}
        {onUndo && <button onClick={onUndo} style={st.linkBtn}>{L2('Undo', '撤销')}</button>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: 'var(--muted)' }}>{L2('Reply?', '回复？')}</span>
        <button style={chip(outcome === 'replied')} onClick={() => pick('replied')}>💬 {L2('Replied', '已回复')}</button>
        <button style={chip(outcome === 'none')} onClick={() => pick('none')}>🔕 {L2('No reply yet', '还没回复')}</button>
      </div>
      {outcome === 'replied' && <MoodPicker value={mood} onChange={m => { setMood(m); setSaved(false) }} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)' }}>{L2('Follow up on', '下次跟进')}</span>
        <input type="date" value={date} min={mytDateStr(0)} onChange={e => { setDate(e.target.value); setSaved(false) }} style={st.dateInput} />
        <button style={st.saveBtn} disabled={busy} onClick={save}>{busy ? L2('Saving…', '保存中…') : saved ? L2('✅ Saved', '✅ 已保存') : L2('Save', '保存')}</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{L2('On that day the VIP shows up in the host\'s My Tasks.', '到那天该VIP会出现在负责人的我的任务中。')}</div>
      {err && <div style={{ color: '#f85149', marginTop: 6 }}>{L2('Save failed: ', '保存失败：')}{err}</div>}
    </div>
  )
}

function defaultTemplates(vip, agentName, purpose) {
  const u = vip.username
  const days = vip.days_since_deposit ?? vip.days_inactive ?? null
  const kind = purpose || (vip.activity_status === 'Resting' ? 'resting'
    : ['At Risk', 'Churn', 'Dormant', 'Unknown'].includes(vip.activity_status) ? 'reactivate' : 'general')
  const intro = `Hi bro *${u}*! 👋 I'm ${agentName} from sureWin VIP department.`
  const introCn = `嗨 *${u}*！👋 我是sureWin VIP部门的${agentName}。`
  const T = {
    reactivate: [
      `${intro}\n\nLong time no see you around${days ? ` (${days} days liao)` : ''} 😅 everything ok ah?\n\nIf got anything I can help, or you want me check any promo for you, just tell me ya. Waiting for you to come back play bro 💎`,
      `${introCn}\n\n${days ? `已经${days}天` : '好久'}没看到你啦 😅 最近还好吗？\n\n有什么需要帮忙的，或者想我帮你看看有什么优惠，随时跟我说哦。等你回来玩 💎`],
    decline: [
      `${intro}\n\nSee you less active lately, just want to check on you 😊 all good?\n\nGot some VIP offers I can arrange for you — want me share with you? Anything just WhatsApp me ya 💎`,
      `${introCn}\n\n看你最近比较少玩，来关心一下你 😊 一切都好吗？\n\n我这边有一些VIP优惠可以帮你安排，要不要我跟你分享？有什么随时WhatsApp我哦 💎`],
    resting: [
      `${intro}\n\nSee you still playing, nice bro 😎 all smooth?\n\nIf you want top up got any promo, or need anything, just tell me ya 💎`,
      `${introCn}\n\n看到你还在玩，不错哦 😎 一切顺利吗？\n\n想充值的话我帮你看看有什么优惠，有什么需要随时跟我说 💎`],
    general: [
      `${intro}\n\nJust checking in with you 😊 everything ok?\n\nAnything I can help, just WhatsApp me ya 💎`,
      `${introCn}\n\n来问候你一下 😊 最近还好吗？\n\n有什么需要帮忙的随时WhatsApp我哦 💎`],
  }
  const [en, cn] = T[kind] || T.general
  return { en, cn, kind }
}

const KIND_LABEL = {
  reactivate: ['♻️ Win-back message', '♻️ 召回信息'], decline: ['📉 Check-in (activity dropping)', '📉 关怀信息（活跃下降）'],
  resting: ['😴 Resting check-in', '😴 休息中问候'], general: ['👋 Check-in', '👋 问候'], custom: ['💬 Message', '💬 信息'],
}

// vip: { id|vip_id, username, tier, phone, whatsapp, activity_status, days_inactive|days_since_deposit }
// templates: optional { en, cn } to use instead of the built-in bro-tone text
// purpose: optional 'reactivate' | 'decline' | 'resting' | 'general'
// topic / logLabel: stored on the contact log (e.g. topic 'campaign', logLabel 'Big win/loss care')
export default function WaSenderModal({ vip, waNumbers, myName, onClose, onLogged, templates, purpose, topic = null, logLabel }) {
  const { lang: uiLang } = useLanguage()
  const L2 = (en, zh) => (uiLang === 'zh' ? zh : en)
  const agentName = myName || 'Agent'
  const [numbers, setNumbers] = useState(waNumbers || [])
  const [sender, setSender] = useState(waNumbers?.[0]?.codename || '')
  const [lang, setLang] = useState(uiLang === 'zh' ? 'cn' : 'en')
  const built = defaultTemplates(vip, agentName, purpose)
  const kind = templates ? 'custom' : built.kind
  const [texts, setTexts] = useState({ en: templates?.en ?? built.en, cn: templates?.cn ?? built.cn, ...(templates?.my ? { my: templates.my } : {}) })
  const [copied, setCopied] = useState(false)
  const [logId, setLogId] = useState(null)
  const [logBusy, setLogBusy] = useState(false)
  const [logErr, setLogErr] = useState('')
  const [histKey, setHistKey] = useState(0)
  const hist = useContactHistory(vip.username, histKey)

  useEffect(() => {
    if (waNumbers) { setNumbers(waNumbers); setSender(s => s || waNumbers[0]?.codename || ''); return }
    let off = false
    supabase.from('wa_numbers').select('id,codename,number,telco').eq('host', myName || '').eq('status', 'Active')
      .then(({ data }) => { if (!off && data) { setNumbers(data); setSender(s => s || data[0]?.codename || '') } })
    return () => { off = true }
  }, [waNumbers, myName])

  const rawWa = (vip.whatsapp || vip.phone || '').replace(/[\s\-()]/g, '')
  const waNumber = (rawWa.startsWith('+') ? rawWa.slice(1) : rawWa).replace(/\D/g, '')
  const message = texts[lang] || ''

  async function logSend(via) {
    if (logId || logBusy) return
    setLogBusy(true); setLogErr('')
    const label = logLabel || KIND_LABEL[kind][0].replace(/^\S+\s/, '')
    const summary = `💬 ${label} sent (${via === 'wa' ? 'WhatsApp button' : 'copied, manual WhatsApp'}, ${lang === 'cn' ? '中文' : lang === 'my' ? 'MY' : 'EN'})`
    const res = await insertContactLog({ vip, hostName: agentName, summary, topic, waNumberUsed: sender })
    setLogBusy(false)
    if (res.error) { setLogErr(res.error); return }
    setLogId(res.id); setHistKey(k => k + 1)
    onLogged && onLogged()
  }
  async function undo() {
    const e = await deleteContactLog(logId)
    if (e) { setLogErr(e); return }
    setLogId(null); setHistKey(k => k + 1)
    onLogged && onLogged()
  }
  function copy() { navigator.clipboard.writeText(message).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); logSend('copy') }) }
  function openWA() { window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`, '_blank'); logSend('wa') }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>💬 WhatsApp — {vip.username}<CopyBtn text={vip.username} /></div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {[vip.tier, vip.activity_status, (vip.whatsapp || vip.phone) ? `📱 ${vip.whatsapp || vip.phone}` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <ContactHistory username={vip.username} excludeLogId={logId} refreshKey={histKey} onChanged={() => { setHistKey(k => k + 1); onLogged && onLogged() }} />
        <div style={{ marginTop: 8 }}><ProfileCard username={vip.username} compact /></div>

        <div style={{ display: 'flex', gap: 6, margin: '10px 0', alignItems: 'center' }}>
          {[['en', 'EN'], ...(texts.my != null ? [['my', 'MY']] : []), ['cn', '中文']].map(([k, label]) => (
            <button key={k} onClick={() => { setLang(k); setCopied(false) }} style={{ ...st.chip, ...(lang === k ? st.chipOn : null) }}>{label}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{L2(...KIND_LABEL[kind])}</span>
        </div>
        <textarea value={message} onChange={e => setTexts(t => ({ ...t, [lang]: e.target.value }))} rows={7} style={st.textarea} />
        <div style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 10px' }}>{L2('You can edit the text before sending.', '发送前可以修改内容。')}</div>

        {numbers.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{L2('📱 Send as (codename)', '📱 发送号码（代号）')}</div>
            <select value={sender} onChange={e => setSender(e.target.value)} style={st.select}>
              {numbers.map(n => <option key={n.id} value={n.codename}>{n.codename} — {n.number}{n.telco ? ' (' + n.telco + ')' : ''}</option>)}
            </select>
          </div>
        )}
        {!waNumber && <div style={{ fontSize: 12, color: '#d29922', marginBottom: 10 }}>⚠️ {L2('No phone/WhatsApp on file for this VIP.', '此VIP没有登记电话/WhatsApp。')}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={st.btnGhost}>{L2('Close', '关闭')}</button>
          <button onClick={copy} style={{ ...st.btn, background: '#6366f1' }}>{copied ? L2('✅ Copied!', '✅ 已复制！') : L2('📋 Copy', '📋 复制')}</button>
          <button onClick={openWA} disabled={!waNumber} style={{ ...st.btn, background: '#25D366', opacity: waNumber ? 1 : 0.5, cursor: waNumber ? 'pointer' : 'not-allowed' }}>{L2('💬 Open WhatsApp', '💬 打开WhatsApp')}</button>
        </div>

        <div style={{ marginTop: 12, fontSize: 12 }}>
          {logBusy ? <span style={{ color: 'var(--muted)' }}>{L2('Logging…', '记录中…')}</span>
            : logId ? <ContactFollowUp logId={logId} unreachable={hist?.unreachable} onUndo={undo} onSaved={() => onLogged && onLogged()} />
            : logErr ? <span style={{ color: '#f85149' }}>{L2('Log failed: ', '记录失败：')}{logErr}</span>
            : <span style={{ color: 'var(--muted)' }}>{L2('Copy or WhatsApp will auto-log this to Contact Log', '复制或打开WhatsApp会自动记录到联系记录')}</span>}
        </div>
      </div>
    </div>
  )
}

// Drop-in replacement for a plain wa.me link: a button that opens the shared popup
export function WaButton({ vip, myName, purpose, templates, topic, logLabel, onLogged, style, title, children }) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" title={title} onClick={e => { e.stopPropagation(); setOpen(true) }} style={{ border: 'none', cursor: 'pointer', ...style }}>{children}</button>
      {open && <WaSenderModal vip={vip} myName={myName || profile?.full_name || ''} purpose={purpose} templates={templates} topic={topic}
        logLabel={logLabel} onLogged={onLogged} onClose={() => setOpen(false)} />}
    </>
  )
}

const st = {
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box:       { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: 520, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,.5)' },
  histBox:   { fontSize: 12, padding: '7px 10px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)' },
  histWarn:  { border: '1px solid rgba(248,81,73,.5)', background: 'rgba(248,81,73,.08)' },
  followBox: { padding: '10px 12px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)' },
  linkBtn:   { marginLeft: 8, background: 'none', border: 'none', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, padding: 0 },
  chip:      { padding: '4px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' },
  chipOn:    { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff', fontWeight: 700 },
  textarea:  { width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', color: 'var(--text)', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical' },
  select:    { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 8, fontSize: 13 },
  dateInput: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 8px', borderRadius: 6, fontSize: 12 },
  saveBtn:   { background: 'var(--accent)', border: 'none', color: '#fff', padding: '5px 14px', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  btn:       { border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnGhost:  { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
}
