// AskData.jsx — chat interface for data questions, backed by /api/chat
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { callAI } from '../lib/aiApi'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'

const s = {
  page:  { padding:'24px 28px', minHeight:'100vh', color:'var(--text)', display:'flex', flexDirection:'column', height:'100vh' },
  title: { fontSize:22, fontWeight:700 },
  sub:   { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:20 },
  chatArea: { flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:14, paddingBottom:20 },
  bubbleUser: { alignSelf:'flex-end', maxWidth:'75%', background:'var(--accent)', color:'#fff', padding:'10px 14px', borderRadius:'12px 12px 2px 12px', fontSize:13, lineHeight:1.5 },
  bubbleAI:   { alignSelf:'flex-start', maxWidth:'80%', background:'var(--surface)', border:'1px solid var(--border)', padding:'10px 14px', borderRadius:'12px 12px 12px 2px', fontSize:13, lineHeight:1.6 },
  inputRow: { display:'flex', gap:10, borderTop:'1px solid var(--border)', paddingTop:16 },
  input: { flex:1, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px', color:'var(--text)', fontSize:13, outline:'none' },
  sendBtn: { background:'var(--accent)', color:'#fff', border:'none', borderRadius:10, padding:'0 20px', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const MAX_STORED_MESSAGES = 40

function storageKey(userId) { return `askdata_chat_${userId || 'anon'}` }

// Build a lookup of username → {id, full_name} and full_name words → id
// so we can find VIP mentions in AI text
function buildVipIndex(vips) {
  const byUsername = {}
  const byName = {}
  vips.forEach(v => {
    if (v.username) byUsername[v.username.toLowerCase()] = v
    if (v.full_name) {
      // index each word of length ≥4 from the full name
      const words = v.full_name.split(/\s+/).filter(w => w.length >= 4)
      words.forEach(w => { byName[w.toLowerCase()] = v })
      // also index the whole name
      byName[v.full_name.toLowerCase()] = v
    }
  })
  return { byUsername, byName }
}

// Render AI text with clickable VIP mentions.
// Strategy: find runs that match known usernames or full names and wrap them.
function RichText({ text, vipIndex, onVipClick }) {
  if (!vipIndex || !text) return <span style={{ whiteSpace:'pre-wrap' }}>{text}</span>

  // Build a list of [start, end, vip] spans by scanning for matches
  const { byUsername, byName } = vipIndex
  const lower = text.toLowerCase()
  const spans = []

  // Try to match full names first (longer matches win)
  const allKeys = [
    ...Object.entries(byName).map(([k,v]) => ({ k, v, priority:k.includes(' ') ? 0 : 1 })),
    ...Object.entries(byUsername).map(([k,v]) => ({ k, v, priority:2 })),
  ].sort((a,b) => a.priority - b.priority || b.k.length - a.k.length) // longer matches first

  const taken = new Set()
  for (const { k, v } of allKeys) {
    let idx = 0
    while (true) {
      const pos = lower.indexOf(k, idx)
      if (pos === -1) break
      const end = pos + k.length
      // make sure this range doesn't overlap an already-claimed span
      let overlap = false
      for (let i = pos; i < end; i++) { if (taken.has(i)) { overlap = true; break } }
      if (!overlap) {
        // ensure it's a word boundary (not inside another word)
        const before = pos === 0 ? ' ' : text[pos-1]
        const after  = end >= text.length ? ' ' : text[end]
        if (/\W/.test(before) && /\W/.test(after)) {
          spans.push({ start: pos, end, vip: v })
          for (let i = pos; i < end; i++) taken.add(i)
        }
      }
      idx = pos + 1
    }
  }

  if (spans.length === 0) return <span style={{ whiteSpace:'pre-wrap' }}>{text}</span>

  spans.sort((a, b) => a.start - b.start)
  const parts = []
  let cursor = 0
  spans.forEach(({ start, end, vip }) => {
    if (cursor < start) parts.push(<span key={cursor} style={{ whiteSpace:'pre-wrap' }}>{text.slice(cursor, start)}</span>)
    parts.push(
      <button key={start} onClick={() => onVipClick(vip)} style={{
        background:'var(--brand-dim,rgba(99,102,241,.15))', color:'var(--brand,#6366f1)',
        border:'1px solid var(--brand-dim,rgba(99,102,241,.25))', borderRadius:5,
        padding:'1px 7px', fontSize:12, fontWeight:600, cursor:'pointer',
        textDecoration:'none', whiteSpace:'nowrap',
      }}>↗ {text.slice(start, end)}</button>
    )
    cursor = end
  })
  if (cursor < text.length) parts.push(<span key={cursor} style={{ whiteSpace:'pre-wrap' }}>{text.slice(cursor)}</span>)
  return <>{parts}</>
}

// Extract up to 5 VIPs mentioned in the AI answer for action buttons
function extractMentionedVips(text, vipIndex) {
  if (!vipIndex || !text) return []
  const { byUsername, byName } = vipIndex
  const lower = text.toLowerCase()
  const found = new Map()
  const check = (map) => {
    Object.entries(map).forEach(([k, v]) => {
      if (lower.includes(k) && !found.has(v.id)) found.set(v.id, v)
    })
  }
  check(byName)
  check(byUsername)
  return [...found.values()].slice(0, 5)
}

// Action buttons shown below each AI answer
function ActionButtons({ text, vipIndex, navigate }) {
  const mentioned = extractMentionedVips(text, vipIndex)
  const [copied, setCopied] = useState(false)

  function copyText() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
      {/* VIP profile buttons */}
      {mentioned.map(v => (
        <button key={v.id} onClick={() => navigate(`/vips/${v.id}`)} style={{
          background:'var(--surface2,var(--surface))', border:'1px solid var(--border)',
          borderRadius:7, padding:'4px 10px', fontSize:11, fontWeight:600,
          color:'var(--text)', cursor:'pointer', display:'flex', alignItems:'center', gap:4,
        }}>👤 {v.full_name || v.username}</button>
      ))}

      {/* Copy answer */}
      <button onClick={copyText} style={{
        background:'var(--surface2,var(--surface))', border:'1px solid var(--border)',
        borderRadius:7, padding:'4px 10px', fontSize:11, color:'var(--muted)', cursor:'pointer',
      }}>{copied ? '✓ Copied' : '📋 Copy'}</button>

      {/* Contextual nav shortcuts */}
      {(text.toLowerCase().includes('at risk') || text.toLowerCase().includes('churn')) && (
        <button onClick={() => navigate('/at-risk')} style={{
          background:'var(--surface2,var(--surface))', border:'1px solid var(--border)',
          borderRadius:7, padding:'4px 10px', fontSize:11, color:'var(--muted)', cursor:'pointer',
        }}>⚠️ At-Risk page</button>
      )}
      {(text.toLowerCase().includes('contact') || text.toLowerCase().includes('reach')) && (
        <button onClick={() => navigate('/contact-log')} style={{
          background:'var(--surface2,var(--surface))', border:'1px solid var(--border)',
          borderRadius:7, padding:'4px 10px', fontSize:11, color:'var(--muted)', cursor:'pointer',
        }}>📞 Contact Log</button>
      )}
      {(text.toLowerCase().includes('deposit') || text.toLowerCase().includes('analytics')) && (
        <button onClick={() => navigate('/analytics')} style={{
          background:'var(--surface2,var(--surface))', border:'1px solid var(--border)',
          borderRadius:7, padding:'4px 10px', fontSize:11, color:'var(--muted)', cursor:'pointer',
        }}>📊 Analytics</button>
      )}
      {(text.toLowerCase().includes('birthday')) && (
        <button onClick={() => navigate('/birthdays')} style={{
          background:'var(--surface2,var(--surface))', border:'1px solid var(--border)',
          borderRadius:7, padding:'4px 10px', fontSize:11, color:'var(--muted)', cursor:'pointer',
        }}>🎂 Birthdays</button>
      )}
    </div>
  )
}

export default function AskData() {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const navigate = useNavigate()
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

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [vipIndex, setVipIndex] = useState(null)
  const bottomRef = useRef(null)

  // Fetch VIP index for username/name linking
  useEffect(() => {
    supabase
      .from('vip_members')
      .select('id,username,full_name')
      .eq('is_excluded', false)
      .limit(2000)
      .then(({ data }) => {
        if (data) setVipIndex(buildVipIndex(data))
      })
  }, [])

  // Load saved conversation
  useEffect(() => {
    if (!userId) return
    try {
      const saved = localStorage.getItem(storageKey(userId))
      if (saved) setMessages(JSON.parse(saved))
    } catch (e) { console.error('AskData: load error', e) }
  }, [userId])

  // Save on every change
  useEffect(() => {
    if (!userId || messages.length === 0) return
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
    } catch (e) { console.error('AskData: save error', e) }
  }, [messages, userId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  function clearConversation() {
    setMessages([])
    if (userId) localStorage.removeItem(storageKey(userId))
  }

  const send = useCallback(async (text) => {
    const question = (text ?? input).trim()
    if (!question || loading) return
    setInput('')
    const nextMessages = [...messages, { role: 'user', content: question }]
    setMessages(nextMessages)
    setLoading(true)
    try {
      const history = nextMessages.slice(0, -1).slice(-6).map(m => ({ role: m.role, content: m.content }))
      const result = await callAI('chat', { question, history, language: lang })
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer || 'No answer generated.' }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, lang])

  function handleVipClick(vip) { navigate(`/vips/${vip.id}`) }

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

        {messages.map((m, i) => (
          <div key={i}>
            {m.role === 'user' ? (
              <div style={s.bubbleUser}>{m.content}</div>
            ) : (
              <div>
                <div style={s.bubbleAI}>
                  <RichText text={m.content} vipIndex={vipIndex} onVipClick={handleVipClick} />
                </div>
                <ActionButtons text={m.content} vipIndex={vipIndex} navigate={navigate} />
              </div>
            )}
          </div>
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
