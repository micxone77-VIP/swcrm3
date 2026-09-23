// AskData.jsx — chat interface for data questions, backed by /api/chat
// The model can only call the fixed set of read-only tools defined in
// functions/api/chat.js — there's no path from a typed question to a
// database write, no matter what's asked.
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { callAI } from '../lib/aiApi'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'

const s = {
  page:      { padding:'24px 28px', minHeight:'100vh', color:'var(--text)', display:'flex', flexDirection:'column', height:'100vh' },
  title:     { fontSize:22, fontWeight:700 },
  sub:       { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:20 },
  chatArea:  { flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:14, paddingBottom:20 },
  bubbleUser:{ alignSelf:'flex-end', maxWidth:'75%', background:'var(--accent)', color:'#fff', padding:'10px 14px', borderRadius:'12px 12px 2px 12px', fontSize:13, lineHeight:1.6 },
  bubbleAI:  { alignSelf:'flex-start', maxWidth:'80%', background:'var(--surface)', border:'1px solid var(--border)', padding:'12px 16px', borderRadius:'12px 12px 12px 2px', fontSize:13, lineHeight:1.7 },
  inputRow:  { display:'flex', gap:10, borderTop:'1px solid var(--border)', paddingTop:16 },
  input:     { flex:1, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px', color:'var(--text)', fontSize:13, outline:'none' },
  sendBtn:   { background:'var(--accent)', color:'#fff', border:'none', borderRadius:10, padding:'0 20px', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const MAX_STORED_MESSAGES = 40

function storageKey(userId) { return `askdata_chat_${userId || 'anon'}` }

// ── Simple markdown renderer: bold, headers, numbered/bullet lists
function renderMarkdown(text, onVipClick, usernameSet) {
  const lines = text.split('\n')
  const elements = []
  let key = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { elements.push(<div key={key++} style={{ height: 6 }} />); continue }

    // ### Header
    if (trimmed.startsWith('### ')) {
      elements.push(
        <div key={key++} style={{ fontWeight: 700, fontSize: 13, color: 'var(--brand)', marginTop: 10, marginBottom: 2 }}>
          {inlineBold(trimmed.slice(4), onVipClick, usernameSet)}
        </div>
      )
      continue
    }
    // ## Header
    if (trimmed.startsWith('## ')) {
      elements.push(
        <div key={key++} style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginTop: 10, marginBottom: 2 }}>
          {inlineBold(trimmed.slice(3), onVipClick, usernameSet)}
        </div>
      )
      continue
    }
    // Numbered list  1. ...
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
    if (numMatch) {
      elements.push(
        <div key={key++} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
          <span style={{ color: 'var(--brand)', fontWeight: 700, minWidth: 20, flexShrink: 0 }}>{numMatch[1]}.</span>
          <span>{inlineBold(numMatch[2], onVipClick, usernameSet)}</span>
        </div>
      )
      continue
    }
    // Bullet  - ...  or  • ...
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      elements.push(
        <div key={key++} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
          <span style={{ color: 'var(--brand)', flexShrink: 0 }}>•</span>
          <span>{inlineBold(trimmed.slice(2), onVipClick, usernameSet)}</span>
        </div>
      )
      continue
    }
    // Plain line
    elements.push(<div key={key++} style={{ marginBottom: 1 }}>{inlineBold(trimmed, onVipClick, usernameSet)}</div>)
  }
  return elements
}

// Render **bold** inline — usernames become clickable buttons
function inlineBold(text, onVipClick, usernameSet) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) => {
    if (i % 2 !== 1) return part
    const isUsername = usernameSet && usernameSet.has(part)
    if (isUsername && onVipClick) {
      return (
        <button key={i} onClick={() => onVipClick(part)}
          style={{ background: 'none', border: 'none', color: 'var(--brand)', fontWeight: 700,
                   cursor: 'pointer', padding: 0, fontSize: 'inherit', textDecoration: 'underline',
                   textDecorationStyle: 'dotted', lineHeight: 'inherit' }}>
          {part}
        </button>
      )
    }
    return <strong key={i} style={{ color: 'var(--text)', fontWeight: 700 }}>{part}</strong>
  })
}

// Extract usernames wrapped in ** from AI response
function extractUsernames(text) {
  const matches = [...text.matchAll(/\*\*([a-zA-Z0-9_@.\-]+)\*\*/g)]
  const seen = new Set()
  const out = []
  for (const m of matches) {
    const u = m[1]
    // Skip section headers and keywords
    if (['GOLD','PLATINUM','DIAMOND','TOP','VIP','MY','ALL','LOW','MEDIUM','HIGH','MAX'].includes(u.toUpperCase())) continue
    if (!seen.has(u)) { seen.add(u); out.push(u) }
  }
  return out
}

// ── AI message bubble with inline clickable usernames + chips + copy
function AIBubble({ content, onVipClick }) {
  const [copied, setCopied] = useState(false)
  const usernames = extractUsernames(content)
  const usernameSet = new Set(usernames)

  function copy() {
    navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) })
  }

  return (
    <div style={s.bubbleAI}>
      <div>{renderMarkdown(content, onVipClick, usernameSet)}</div>

      {/* Clickable VIP username chips (quick access row) */}
      {usernames.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:10 }}>
          {usernames.map(u => (
            <button key={u} onClick={() => onVipClick(u)}
              style={{ background:'var(--brand-dim)', border:'1px solid var(--brand)', borderRadius:20,
                       padding:'3px 10px', fontSize:11, fontWeight:600, color:'var(--brand)', cursor:'pointer' }}>
              👤 {u}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display:'flex', gap:8, marginTop:10 }}>
        <button onClick={copy}
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6,
                   padding:'4px 12px', fontSize:11, color:'var(--muted)', cursor:'pointer' }}>
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
    </div>
  )
}

export default function AskData() {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const navigate = useNavigate()
  const userId = profile?.id

  const SUGGESTIONS = lang === 'zh' ? [
    '我的金牌玩家最近表现如何？前10名是谁？',
    '哪些钻石会员超过14天没来？',
    '平台本月流水总额是多少？',
    '有哪些 VIP 可能会流失？',
    '我的铂金玩家谁快升级了？',
  ] : [
    'How is my gold tier recently? Who is top 10?',
    'Which Diamond members have been inactive for 14+ days?',
    'What is the platform turnover this month?',
    'Which VIPs are at risk of churning?',
    'Which of my Platinum players are close to upgrading?',
  ]

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!userId) return
    try {
      const saved = localStorage.getItem(storageKey(userId))
      if (saved) setMessages(JSON.parse(saved))
    } catch (e) { console.error('AskData: failed to load saved chat history', e) }
  }, [userId])

  useEffect(() => {
    if (!userId || messages.length === 0) return
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
    } catch (e) { console.error('AskData: failed to save chat history', e) }
  }, [messages, userId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  function clearConversation() {
    setMessages([])
    if (userId) localStorage.removeItem(storageKey(userId))
  }

  function handleVipClick(username) {
    // Navigate to VIP360 — try to find by username
    navigate(`/vips?search=${encodeURIComponent(username)}`)
  }

  async function send(text) {
    const question = (text ?? input).trim()
    if (!question || loading) return
    setInput('')
    const nextMessages = [...messages, { role: 'user', content: question }]
    setMessages(nextMessages)
    setLoading(true)
    try {
      const history = nextMessages.slice(0, -1).slice(-6).map(m => ({ role: m.role, content: m.content }))
      const result = await callAI('chat', {
        question,
        history,
        language: lang,
        hostName:  profile?.full_name,
        hostEmail: profile?.email,
      })
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
          <div style={s.sub}>Ask questions about VIPs, contacts, and churn risk — answers pull live from the CRM, never guessed. VIP names are clickable.</div>
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

        {messages.map((m, i) =>
          m.role === 'user'
            ? <div key={i} style={s.bubbleUser}>{m.content}</div>
            : <AIBubble key={i} content={m.content} onVipClick={handleVipClick} />
        )}

        {loading && (
          <div style={s.bubbleAI}>
            <span style={{ color:'var(--muted)', fontSize:13 }}>Thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <input
          style={s.input}
          value={input}
          placeholder="Ask about your VIPs, contacts, churn risk…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
        />
        <button style={s.sendBtn} onClick={() => send()} disabled={loading}>Send</button>
      </div>
    </div>
  )
}
