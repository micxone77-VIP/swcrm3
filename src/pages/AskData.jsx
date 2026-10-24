// AskData.jsx — chat interface for data questions, backed by /api/chat
// The model can only call the fixed set of read-only tools defined in
// functions/api/chat.js (find_players, player_detail, alerts, campaigns, …)
// — there's no path from a typed question to a database write.
// Each answer shows which tools it used and the data date.
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
  bubbleAI:  { alignSelf:'flex-start', maxWidth:'92%', background:'var(--surface)', border:'1px solid var(--border)', padding:'12px 16px', borderRadius:'12px 12px 12px 2px', fontSize:13, lineHeight:1.7 },
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

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const trimmed = line.trim()

    // | table | rows |  (consecutive lines; the |---| line is skipped)
    if (trimmed.startsWith('|')) {
      const rows = []
      while (li < lines.length && lines[li].trim().startsWith('|')) {
        const cells = lines[li].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        li++
      }
      li--
      const [head, ...body] = rows
      elements.push(
        <div key={key++} style={{ overflowX: 'auto', margin: '6px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{head.map((c, i) => (
              <th key={i} style={{ textAlign: 'left', padding: '5px 10px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{inlineBold(c, onVipClick, usernameSet)}</th>
            ))}</tr></thead>
            <tbody>{body.map((r, ri) => (
              <tr key={ri}>{r.map((c, i) => (
                <td key={i} style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{inlineBold(c, onVipClick, usernameSet)}</td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>
      )
      continue
    }
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

// Tool names from functions/api/chat.js → what the user sees under an answer
const TOOL_LABELS = {
  find_players:      ['Find players', '查找玩家'],
  summarize_players: ['Player totals', '玩家统计'],
  player_detail:     ['Player profile', '玩家档案'],
  player_history:    ['Daily / monthly history', '每日/每月记录'],
  alerts:            ['Alerts', '预警'],
  daily_brief:       ['Daily brief', '每日简报'],
  campaigns:         ['Campaign list', '活动列表'],
  campaign_detail:   ['Campaign results', '活动效果'],
  team_kpi:          ['Team KPI', '团队 KPI'],
  contacts_tasks:    ['Contacts & tasks', '联系记录和任务'],
  money_and_games:   ['Bonus, expenses & games', '红利、开销和游戏'],
  rules:             ['CRM rules', 'CRM 规则'],
  birthdays:         ['Birthdays', '生日'],
  tier_changes:      ['Tier changes', '等级变动'],
}

// "🔎 Looked up: Find players · Player profile (qqq163) · data up to 2026-10-23"
function StepsLine({ steps, dataDate }) {
  const { lang } = useLanguage()
  if (!steps?.length && !dataDate) return null
  const label = s => {
    const l = TOOL_LABELS[s.tool]
    const name = l ? (lang === 'zh' ? l[1] : l[0]) : s.tool
    const who = s.args?.username || s.args?.name || (s.args?.usernames?.length === 1 ? s.args.usernames[0] : '')
    return who ? `${name} (${who})` : name
  }
  const uniq = [...new Set((steps || []).map(label))]
  return (
    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
      {uniq.length > 0 && <>🔎 {lang === 'zh' ? '查了：' : 'Looked up: '}{uniq.join(' · ')}</>}
      {dataDate && <>{uniq.length > 0 ? ' · ' : ''}{lang === 'zh' ? `资料截至 ${dataDate}` : `data up to ${dataDate}`}</>}
    </div>
  )
}

// ── AI message bubble with inline clickable usernames + chips + copy
function AIBubble({ content, steps, dataDate, onVipClick }) {
  const { lang } = useLanguage()
  const [copied, setCopied] = useState(false)
  const usernames = extractUsernames(content)
  const usernameSet = new Set(usernames)

  function copy() {
    navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) })
  }

  return (
    <div style={s.bubbleAI}>
      <div>{renderMarkdown(content, onVipClick, usernameSet)}</div>
      <StepsLine steps={steps} dataDate={dataDate} />

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
          {copied ? (lang === 'zh' ? '✓ 已复制' : '✓ Copied') : (lang === 'zh' ? '📋 复制' : '📋 Copy')}
        </button>
      </div>
    </div>
  )
}

export default function AskData() {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const navigate = useNavigate()
  const userId = profile?.id

  const SUGGESTIONS = lang === 'zh' ? [
    '今天我应该先联系哪 10 个 VIP？为什么？',
    '高价值（V4/V5）里有谁开始流失？给我一个召回计划。',
    'VIP Power Play 活动有效吗？MYR 和 SGD 分开看，下一个活动应该怎么做？',
    '这个月各个 VIP 经理的 KPI 怎么样？谁需要帮忙？',
    '有哪些 Silver 玩家最近存款很多，可能可以升级成 VIP？',
    '这个月红利和礼物花了多少？哪些玩家拿最多？',
  ] : [
    'Which 10 VIPs should I contact first today, and why?',
    'Which high-value (V4/V5) VIPs are starting to churn? Give me a recall plan.',
    'Did the VIP Power Play campaign work? MYR and SGD separately — what should the next campaign be?',
    'How is each VIP manager doing on KPI this month? Who needs help?',
    'Which Silver players deposited a lot recently and could become VIPs?',
    'How much did we spend on bonuses and gifts this month, and who received the most?',
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

  // VIP360 looks the player up by username in vip_members_all (Silver/Bronze too)
  function handleVipClick(username) {
    navigate(`/vip360?player=${encodeURIComponent(username)}`)
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
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer || L2('No answer generated.','未生成回答。'), steps: result.steps, dataDate: result.data_date }])
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
          <div style={s.title}>💬 {L2('Ask Your Data','数据问答')}</div>
          <div style={s.sub}>{L2('Ask anything about all players (Bronze to Black), status, alerts, campaigns and their results, team KPI, contacts, tasks, bonuses and games. The AI looks the data up itself, shows what it checked, and suggests next steps. Player names are clickable.','可以问所有玩家（Bronze 到 Black）、状态、预警、活动和活动效果、团队 KPI、联系记录、任务、红利和游戏。AI 会自己去查资料，显示查了什么，并给出下一步建议。玩家名字可以点开。')}</div>
        </div>
        {messages.length > 0 && (
          <button onClick={clearConversation}
            style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 14px', fontSize:12, color:'var(--muted)', cursor:'pointer' }}>
            {L2('Clear conversation','清除对话')}
          </button>
        )}
      </div>

      <div style={s.chatArea}>
        {messages.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:20 }}>
            <div style={{ fontSize:12, color:'var(--muted)', marginBottom:4 }}>{L2('Try asking:','试着问：')}</div>
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
            : <AIBubble key={i} content={m.content} steps={m.steps} dataDate={m.dataDate} onVipClick={handleVipClick} />
        )}

        {loading && (
          <div style={s.bubbleAI}>
            <span style={{ color:'var(--muted)', fontSize:13 }}>{L2('Thinking…','思考中…')}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <input
          style={s.input}
          value={input}
          placeholder={L2('Ask about your VIPs, campaigns, contacts, churn risk…','询问你的 VIP、活动、联系记录、流失风险…')}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
        />
        <button style={s.sendBtn} onClick={() => send()} disabled={loading}>{L2('Send','发送')}</button>
      </div>
    </div>
  )
}
