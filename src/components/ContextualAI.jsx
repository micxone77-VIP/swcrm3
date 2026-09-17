// ContextualAI.jsx — floating mini-chat panel (bottom-right)
// Page-aware: auto-prepends context about current page to every question
import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { callAI } from '../lib/aiApi'
import { useLanguage } from '../contexts/LanguageContext'

const PAGE_CONTEXT = {
  '/':            'I am on the Today / Command Center page.',
  '/vips':        'I am viewing the All VIPs list.',
  '/at-risk':     'I am on the At-Risk VIPs page.',
  '/ask':         'I am on the Ask Data / AI chat page.',
  '/contact-log': 'I am on the Contact Log page.',
  '/analytics':   'I am on the Analytics page.',
  '/tasks':       'I am on the My Tasks page.',
  '/birthdays':   'I am on the Birthdays page.',
  '/campaigns':   'I am on the Campaigns page.',
}

function getPageCtx(pathname) {
  // exact match first, then prefix match for /vips/:id
  if (PAGE_CONTEXT[pathname]) return PAGE_CONTEXT[pathname]
  if (pathname.startsWith('/vips/')) return 'I am viewing a VIP profile page.'
  return ''
}

const SUGGESTIONS_BY_PAGE = {
  '/':        ['Who needs contact today?', 'Any at-risk VIPs I should call?', 'Who has a birthday this week?'],
  '/vips':    ['Which VIPs haven\'t deposited in 14 days?', 'Show me Diamond members at risk', 'Who has the highest deposit this month?'],
  '/at-risk': ['Which at-risk VIPs are Diamond or Platinum?', 'Who has the highest churn risk?'],
  '/tasks':   ['What tasks are overdue?', 'How many open tasks do I have?'],
  '/birthdays': ['Who has a birthday this week?', 'Which birthday VIPs are high value?'],
}

export default function ContextualAI() {
  const { pathname } = useLocation()
  const { lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, open])

  const pageCtx = getPageCtx(pathname)
  const suggestions = SUGGESTIONS_BY_PAGE[pathname] ||
    SUGGESTIONS_BY_PAGE[Object.keys(SUGGESTIONS_BY_PAGE).find(k => pathname.startsWith(k) && k !== '/') || '/']
    || SUGGESTIONS_BY_PAGE['/']

  async function send(text) {
    const raw = (text ?? input).trim()
    if (!raw || loading) return
    setInput('')
    // Prepend page context so the AI knows where the user is
    const question = pageCtx ? `[Context: ${pageCtx}] ${raw}` : raw
    const displayQ = raw  // show the clean version in the bubble
    const nextMessages = [...messages, { role: 'user', content: displayQ }]
    setMessages(nextMessages)
    setLoading(true)
    try {
      const history = nextMessages.slice(0, -1).slice(-4).map(m => ({ role: m.role, content: m.content }))
      const result = await callAI('chat', { question, history, language: lang })
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer || 'No answer.' }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  function clear() { setMessages([]) }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Ask AI"
        style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 9000,
          width: 52, height: 52, borderRadius: '50%',
          background: open ? 'var(--brand)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(99,102,241,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, transition: 'transform .15s, background .2s',
          transform: open ? 'rotate(45deg) scale(1.1)' : 'scale(1)',
        }}
      >
        {open ? '✕' : '✨'}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 92, right: 28, zIndex: 8999,
          width: 360, maxHeight: 520,
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,.35)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--surface)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>✨</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Quick AI</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pageCtx || 'Ask anything'}</div>
              </div>
            </div>
            {messages.length > 0 && (
              <button onClick={clear} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: 'var(--muted)', padding: '3px 8px',
                borderRadius: 6, border: '1px solid var(--border)',
              }}>Clear</button>
            )}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Quick questions:</div>
                {(suggestions || []).map(q => (
                  <button key={q} onClick={() => send(q)} style={{
                    textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text)',
                    cursor: 'pointer', lineHeight: 1.4,
                  }}>{q}</button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--surface)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                padding: '8px 12px', borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div style={{
                alignSelf: 'flex-start', background: 'var(--surface)',
                border: '1px solid var(--border)', padding: '8px 12px',
                borderRadius: '10px 10px 10px 2px', fontSize: 12, color: 'var(--muted)',
              }}>Thinking…</div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ borderTop: '1px solid var(--border)', display: 'flex', gap: 8, padding: '10px 12px', background: 'var(--surface)' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Ask a quick question…"
              style={{
                flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 12px', color: 'var(--text)',
                fontSize: 12, outline: 'none',
              }}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              style={{
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '0 14px', fontSize: 12, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .6 : 1,
              }}
            >→</button>
          </div>
        </div>
      )}
    </>
  )
}
