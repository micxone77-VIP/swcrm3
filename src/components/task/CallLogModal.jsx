// src/components/task/CallLogModal.jsx — one-click "log this call" for 📞 Call tasks (2026-10-23)
// Writes a Contact Log (channel Call) with the outcome + optional follow-up date, then completes the task.
// The contact trigger also closes the VIP's other open follow-up / call tasks.
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { insertContactLog, MoodPicker } from '../WaSenderModal'
import CopyBtn from '../CopyBtn'

const mytDateStr = (addDays = 0) => { const d = new Date(Date.now() + 8 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + addDays); return d.toISOString().slice(0, 10) }
const OUTCOMES = {
  answered:  { icon: '✅', en: 'Answered',             zh: '接了',         outcome: 'Replied',   followDays: 2 },
  no_answer: { icon: '📵', en: 'No answer',            zh: '没接',         outcome: 'Contacted', followDays: 1 },
  wrong:     { icon: '❌', en: 'Wrong / dead number',   zh: '号码错误 / 停用', outcome: 'Contacted', followDays: null },
}

export default function CallLogModal({ task, hostName, onClose, onDone }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [res, setRes] = useState('answered')
  const [note, setNote] = useState('')
  const [mood, setMood] = useState(null)
  const [follow, setFollow] = useState(mytDateStr(2))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function pick(k) { setRes(k); const d = OUTCOMES[k].followDays; setFollow(d == null ? '' : mytDateStr(d)) }

  async function save() {
    setBusy(true); setErr('')
    const o = OUTCOMES[res]
    const summary = `📞 Call — ${o.en.toLowerCase()}${note.trim() ? `: ${note.trim()}` : ''}`
    const ins = await insertContactLog({
      vip: { id: task.vip_id, username: task.vip_username, tier: task.vip_tier }, hostName, summary, channel: 'Call',
    })
    if (ins.error) { setBusy(false); setErr(ins.error); return }
    await supabase.from('contact_logs').update({ outcome: o.outcome, emotion_tag: res === 'answered' ? mood : null, follow_up_needed: !!follow, follow_up_date: follow || null }).eq('id', ins.id)
    await supabase.from('tasks').update({
      status: 'Completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      notes: `${task.notes ? task.notes + ' · ' : ''}Call logged: ${o.en.toLowerCase()}`,
    }).eq('id', task.id)
    setBusy(false)
    onDone && onDone()
  }

  const chip = on => ({ padding: '6px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: on ? '1.5px solid var(--brand, #FF6B00)' : '1px solid var(--border)', background: on ? 'rgba(255,107,0,.12)' : 'var(--surface2)', color: on ? 'var(--brand, #FF6B00)' : 'var(--text)', fontWeight: on ? 700 : 500 })
  const input = { width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: 460, maxWidth: '100%' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>📝 {L2('Log call', '记录通话')} — {task.vip_username}<CopyBtn text={task.vip_username} /></div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{L2('Saved to Contact Log (channel: Call) and this task is marked done.', '会存进联系记录（渠道：电话），这个任务会标记完成。')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {Object.entries(OUTCOMES).map(([k, o]) => <button key={k} style={chip(res === k)} onClick={() => pick(k)}>{o.icon} {L2(o.en, o.zh)}</button>)}
        </div>
        {res === 'answered' && <MoodPicker value={mood} onChange={setMood} />}
        <textarea rows={3} style={{ ...input, resize: 'vertical', marginBottom: 10 }} value={note} onChange={e => setNote(e.target.value)}
          placeholder={L2('What did they say? (no IC or bank numbers)', '他说了什么？（不要写 IC 或银行号码）')} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
          <span style={{ color: 'var(--muted)' }}>{L2('Follow up on', '下次跟进')}</span>
          <input type="date" value={follow} min={mytDateStr(0)} onChange={e => setFollow(e.target.value)} style={{ ...input, width: 'auto' }} />
          {follow && <button onClick={() => setFollow('')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>{L2('No follow-up', '不用跟进')}</button>}
        </div>
        {err && <div style={{ color: '#f85149', fontSize: 12, marginBottom: 10 }}>{L2('Save failed: ', '保存失败：')}{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>{L2('Cancel', '取消')}</button>
          <button disabled={busy} onClick={save} style={{ background: 'var(--brand, #FF6B00)', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>{busy ? L2('Saving…', '保存中…') : L2('Save', '保存')}</button>
        </div>
      </div>
    </div>
  )
}
