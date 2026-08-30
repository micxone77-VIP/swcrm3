// AskData.jsx — chat interface for data questions, backed by /api/chat
// The model can only call the fixed set of read-only tools defined in
// functions/api/chat.js — there's no path from a typed question to a
// database write, no matter what's asked.
import { useState, useRef, useEffect } from 'react'
import { callAI } from '../lib/aiApi'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'


const s = {
  page:  { padding:'24px 28px', minHeight:'100vh', color:'var(--text)', display:'flex', flexDirection:'column', height:'100vh' },
  title: { fontSize:22, fontWeight:700 },
  sub:   { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:20 },
  chatArea: { flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:14, paddingBottom:20 },
  bubbleUser: { alignSelf:'flex-end', maxWidth:'75%', background:'var(--accent)', color:'#fff', padding:'10px 14px', borderRadius:'12px 12px 2px 12px', fontSize:13, lineHeight:1.5 },
  bubbleAI:   { alignSelf:'flex-start', maxWidth:'75%', background:'var(--surface)', border:'1px solid var(--border)', padding:'10px 14px', borderRadius:'12px 12px 12px 2px', fontSize:13, lineHeight:1.5, whiteSpace:'pre-wrap' },
  inputRow: { display:'flex', gap:10, borderTop:'1px solid var(--border)', paddingTop:16 },
  input: { flex:1, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px', color:'var(--text)', fontSize:13, outline:'none' },
  sendBtn: { background:'var(--accent)', color:'#fff', border:'none', borderRadius:10, padding:'0 20px', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const MAX_STORED_MESSAGES = 40 // keep storage bounded — old messages just age out

function storageKey(userId) {
  return `askdata_chat_${userId || 'anon'}`
}

export default function AskData() {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const userId = profile?.id

  const SUGGESTIONS = lang === 'zh' ? [
    '今天有哪些 VIP 需要联系？',
    '本月存款最高的5个 VIP 是谁？',
    '哪些 Diamond 会员已经超过14天没有活动？',
    '这个月的平台流水是多少？',
    '有哪些 VIP 可能会流失？',
  ] : [
    'Which VIPs need to be contacted today?',
    'Who are the top 5 VIPs by deposit this month?',
    'Which Diamond members have been inactive for 14+ days?',
    'What is the platform turnover this month?',
    'Which VIPs are at risk of churning?',
  ]
  const [messages, setMessages] = useState([]) // [{role:'user'|'assistant', content}]
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  // Load this user's saved conversation once we know who they are.
  useEffect(() => {
    if (!userId) return
    try {
      const saved = localStorage.getItem(storageKey(userId))
      if (saved) setMessages(JSON.parse(saved))
    } catch (e) {
      console.error('AskData: failed to load saved chat history', e)
    }
  }, [userId])

  // Save on every change, capped so this doesn't grow forever.
  useEffect(() => {
    if (!userId || messages.length === 0) return
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
    } catch (e) {
      console.error('AskData: failed to save chat history', e)
    }
  }, [messages, userId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  function clearConversation() {
    setMessages([])
    if (userId) localStorage.removeItem(storageKey(userId))
  }

  async function send(text) {
    const question = (text ?? input).trim()
    if (!question || loading) return
    setInput('')
    const nextMessages = [...messages, { role: 'user', content: question }]
    setMessages(nextMessages)
    setLoading(true)
    try {
      // Keep the history short and in the {role, content} shape the backend expects.
      const history = nextMessages.slice(0, -1).slice(-6).map(m => ({ role: m.role, content: m.content }))
      const result = await callAI('chat', { question, history, language: lang })
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer || 'No answer generated.' }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={s.title}>💬 Ask Your Data</div>
          <div style={s.sub}>Ask questions about VIPs, contacts, and churn risk — answers pull live from the CRM, never guessed.</div>
        </div>
        {messages.length > 0 && (
          <button onClick={clearConversation}
            style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 14px', fontSize:12, color:'var(--muted)', cursor:'pointer' }}>
            Clear conversation
          </button>
        )}
      </div>

      <div style={s.chatArea}>
        {messages.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:20 }}>
            <div style={{ fontSize:12, color:'var(--muted)', marginBottom:4 }}>Try asking:</div>
            {SUGGESTIONS.map(q => (
              <button key={q} onClick={() => send(q)}
                style={{ textAlign:'left', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--text)', cursor:'pointer' }}>
                {q}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={m.role === 'user' ? s.bubbleUser : s.bubbleAI}>{m.content}</div>
        ))}
        {loading && <div style={s.bubbleAI}>Thinking…</div>}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <input
          style={s.input}
          value={input}
          placeholder="Ask about VIPs, contacts, churn risk…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
        />
        <button style={s.sendBtn} onClick={() => send()} disabled={loading}>Send</button>
      </div>
    </div>
  )
}
