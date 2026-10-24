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
import { supabase } from '../lib/supabase'
import { fillWa, tierList, STAGE_INFO } from '../lib/campaignWaTemplates'

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
  ask_sql:                ['Custom query', '自定义查询'],
  propose_tasks:          ['Prepared tasks', '准备任务'],
  propose_campaign_draft: ['Prepared draft campaign', '准备草稿活动'],
  propose_add_players:    ['Prepared players to add', '准备加玩家'],
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

// ── Confirm card for something the AI proposed (tasks / draft campaign / add players).
// Nothing happens until Confirm; then the DB function ai_apply_action re-checks it, does it and logs it.
const cardTh = { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', whiteSpace: 'nowrap' }
const cardTd = { padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

// The draft's WhatsApp texts per stage × EN / MY / 中文 (normal kinds shown filled with sample values)
const DAILY_STAGE_LABEL = { intro: '📣 Intro', won: '🎉 Won yesterday', streak: '🔥 1 day to streak', near: '😬 Almost', idle: '💤 Not active', care: '💙 Big loss — care', ended: '🏁 Ended' }
function WaPreview({ wa, campaign, levels }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [stage, setStage] = useState(wa.stages[0])
  const [l, setL] = useState(lang === 'zh' ? 'zh' : 'en')
  const raw = wa.texts?.[stage]?.[l]
  const cur = campaign?.platform === 'SG' ? 'SGD ' : 'RM'
  const text = !raw ? null : wa.daily ? raw : fillWa(raw, { username: 'haur2972', agent: 'Marcus', campaign: campaign?.campaign_name, start: campaign?.start_date, end: campaign?.end_date,
    days_left: 3, cur, gap: '12,000', next_reward: `${cur}900`, reward: `${cur}900`, turnover: campaign?.turnover_multiplier ? `${cur}${900 * campaign.turnover_multiplier}` : '',
    tier_list: tierList(campaign, levels, l), streak: (campaign?.streak_days || 3) - 1, streak_n: campaign?.streak_days || 3, streak_pct: campaign?.streak_bonus_pct ?? 1 })
  const chip = on => ({ padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--surface2)', color: on ? '#fff' : 'var(--muted)' })
  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>💬 {L2('WhatsApp messages (every stage, EN / MY / 中文)', 'WhatsApp 讯息（每个阶段，EN / MY / 中文）')}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        {wa.stages.map(st => {
          const info = STAGE_INFO[st]
          const label = wa.daily ? DAILY_STAGE_LABEL[st] : `${info.icon} ${lang === 'zh' ? info.zh : info.en}`
          return <button key={st} onClick={() => setStage(st)} style={chip(stage === st)}>{label}</button>
        })}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {['en', 'my', 'zh'].map(x => <button key={x} onClick={() => setL(x)} style={chip(l === x)}>{x === 'en' ? 'EN' : x === 'my' ? 'MY' : '中文'}</button>)}
        </span>
      </div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(37,211,102,.06)', border: '1px solid rgba(37,211,102,.2)' }}>
        {text || <span style={{ color: 'var(--muted)' }}>{L2('(built-in text will be used)', '（使用内置讯息）')}</span>}
      </div>
    </div>
  )
}

function ActionCard({ action, question, onChange }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const navigate = useNavigate()
  const { kind, payload: p, state = 'pending', result, error } = action

  async function confirm() {
    onChange({ state: 'running' })
    const { data, error: e } = await supabase.rpc('ai_apply_action', { p_kind: kind, p_payload: p, p_question: question || null })
    if (e) onChange({ state: 'error', error: e.message })
    else onChange({ state: 'done', result: data?.result })
  }

  let title, body, link
  if (kind === 'create_tasks') {
    title = `📋 ${L2(`Create ${p.tasks.length} task(s)`, `建立 ${p.tasks.length} 个任务`)}`
    link = { to: '/tasks', label: L2('Open My Tasks', '打开 My Tasks') }
    body = (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{[L2('Player', '玩家'), L2('Type', '类型'), L2('Due', '日期'), L2('Priority', '优先'), L2('Assigned to', '负责人'), L2('Note', '备注')].map(h => <th key={h} style={cardTh}>{h}</th>)}</tr></thead>
          <tbody>{p.tasks.map((t, i) => (
            <tr key={i}>
              <td style={{ ...cardTd, fontWeight: 600 }}>{t.username} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{t.tier}</span></td>
              <td style={cardTd}>{t.task_type}</td><td style={cardTd}>{t.due_date}</td><td style={cardTd}>{t.priority}</td>
              <td style={cardTd}>{t.assigned_to || '—'}</td>
              <td style={{ ...cardTd, whiteSpace: 'normal', minWidth: 180 }}>{t.notes || t.title}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    )
  } else if (kind === 'create_campaign_draft' && p.display) {
    // Full draft (src/lib/aiCampaignDraft.js): every setting of its kind + estimated cost
    const d = p.display
    const money = v => (v == null ? '—' : `${d.currency} ${Math.round(Number(v)).toLocaleString('en-US')}`)
    title = `🎯 ${L2('Create a DRAFT campaign', '建立草稿活动')}: ${d.name}`
    link = { to: '/campaigns', label: L2('Open Campaigns', '打开 Campaigns') }
    const rows = [
      [L2('Kind', '类型'), lang === 'zh' ? d.kind_zh : d.kind_en],
      [L2('Platform', '平台'), `${d.platform} (${d.currency})`],
      [L2('Dates', '日期'), `${d.start_date} → ${d.end_date} (${d.days} ${L2('days', '天')})`],
      [L2('Players', '玩家'), d.audience === 'all_in_tiers'
        ? L2(`All ${d.tiers.join(', ')} on ${d.platform} — ${d.player_count} now (new ones join automatically)`, `${d.platform} 全部 ${d.tiers.join('、')} — 目前 ${d.player_count} 位（之后符合的会自动加入）`)
        : `${d.player_count}: ${d.sample.join(', ')}${d.player_count > d.sample.length ? ' …' : ''}`],
      ...d.rows.map(r => [lang === 'zh' ? r[1] : r[0], r[2]]),
      [L2('Paid as', '发放'), `${d.reward_delivery === 'wcash' ? 'WCash' : 'Credit'}${d.turnover_multiplier ? ` · ×${d.turnover_multiplier} ${L2('turnover', '流水')}` : ''}`],
      [L2('Budget', '预算'), money(d.budget)],
      [L2('Offer (players read)', '优惠说明'), d.offer || '—'],
      [L2('Why', '原因'), d.why || '—'],
    ]
    const e = d.estimate
    body = (
      <div>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}><tbody>
          {rows.map(([k, v]) => <tr key={k}><td style={{ ...cardTd, color: 'var(--muted)', verticalAlign: 'top' }}>{k}</td><td style={{ ...cardTd, whiteSpace: 'normal' }}>{v}</td></tr>)}
        </tbody></table>
        {d.tier_table && (
          <table style={{ borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
            <thead><tr>{d.tier_table.cols.map(c => <th key={c} style={cardTh}>{c}</th>)}</tr></thead>
            <tbody>{d.tier_table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={cardTd}>{c}</td>)}</tr>)}</tbody>
          </table>
        )}
        {e && (
          <div style={{ marginTop: 8, fontSize: 12, padding: '6px 8px', borderRadius: 6, background: 'var(--surface2)' }}>
            💰 {L2(`Estimated cost if these players repeat their last ${e.lookback_days} days (${e.data_from} → ${e.data_to}):`, `如果这些玩家重复最近 ${e.lookback_days} 天（${e.data_from} → ${e.data_to}）的表现，预计成本：`)}{' '}
            <b>{money(e.est_payout)}</b> {L2(`to ${e.est_winners} player(s)`, `，${e.est_winners} 位玩家`)}{e.note ? ` · ${e.note}` : ''}
          </div>
        )}
        {[...(d.warnings || []), ...(d.unknown?.length ? [L2(`Not found: ${d.unknown.join(', ')}`, `找不到：${d.unknown.join(', ')}`)] : [])].map(w => (
          <div key={w} style={{ fontSize: 11, color: '#d29922', marginTop: 4 }}>⚠️ {w}</div>
        ))}
        {d.wa && <WaPreview wa={d.wa} campaign={p.campaign} levels={p.levels} />}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{L2('It is saved as a DRAFT. Launch it yourself on the Campaigns page after a final look.', '会存成草稿。最后检查后，由你在 Campaigns 页面启动。')}</div>
      </div>
    )
  } else if (kind === 'create_campaign_draft') {
    title = `🎯 ${L2('Create a DRAFT campaign', '建立草稿活动')}: ${p.campaign_name}`
    link = { to: '/campaigns', label: L2('Open Campaigns', '打开 Campaigns') }
    const rows = [
      [L2('Type', '类型'), p.campaign_type], [L2('Platform', '平台'), p.platform],
      [L2('Dates', '日期'), [p.start_date, p.end_date].filter(Boolean).join(' → ') || '—'],
      [L2('Target tiers', '目标等级'), (p.target_tier || []).join(', ') || '—'],
      [L2('Offer', '优惠'), p.offer_desc || '—'],
      [L2('Budget', '预算'), p.budget_rm != null ? Number(p.budget_rm).toLocaleString() : '—'],
      [L2('Deposit target', '存款门槛'), p.deposit_target != null ? Number(p.deposit_target).toLocaleString() : '—'],
      [L2('Reward', '奖励'), p.reward_pct != null ? `${p.reward_pct}%` : p.reward_fixed != null ? Number(p.reward_fixed).toLocaleString() : '—'],
      [L2('Why', '原因'), p.notes || '—'],
      [L2('Players', '玩家'), (p.usernames || []).length ? `${p.usernames.length}: ${p.usernames.slice(0, 20).join(', ')}${p.usernames.length > 20 ? ' …' : ''}` : '—'],
    ]
    body = (
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}><tbody>
        {rows.map(([k, v]) => <tr key={k}><td style={{ ...cardTd, color: 'var(--muted)' }}>{k}</td><td style={{ ...cardTd, whiteSpace: 'normal' }}>{v}</td></tr>)}
      </tbody></table>
    )
  } else if (kind === 'add_players_to_campaign') {
    title = `➕ ${L2(`Add ${p.usernames.length} player(s) to`, `加 ${p.usernames.length} 个玩家到`)} ${p.campaign_name}`
    link = { to: '/campaigns', label: L2('Open Campaigns', '打开 Campaigns') }
    body = <div style={{ fontSize: 12 }}>{p.usernames.join(', ')}</div>
  } else return null

  let done = null
  if (state === 'done' && result) {
    if (kind === 'create_tasks') done = L2(`Created ${result.created} task(s)`, `已建立 ${result.created} 个任务`) +
      (result.skipped?.length ? L2(` · skipped ${result.skipped.length}: `, ` · 跳过 ${result.skipped.length} 个：`) + result.skipped.map(s => `${s.username} (${s.reason})`).join(', ') : '')
    else if (kind === 'create_campaign_draft') done = L2(`Draft created: ${result.campaign_code}`, `草稿已建立：${result.campaign_code}`) +
      (result.players_enrolled != null ? L2(` · ${result.players_enrolled} player(s) enrolled`, ` · 已加入 ${result.players_enrolled} 位玩家`) : '') +
      (result.levels ? L2(` · ${result.levels} level(s)`, ` · ${result.levels} 个级别`) : '') +
      (result.players ? L2(` · ${result.players.added} player(s) added`, ` · 已加 ${result.players.added} 个玩家`) : '')
    else done = L2(`Added ${result.added}`, `已加 ${result.added} 个`) +
      (result.already_in ? L2(` · ${result.already_in} already in`, ` · ${result.already_in} 个原本就在`) : '') +
      (result.not_found?.length ? L2(` · not found: `, ` · 找不到：`) + result.not_found.join(', ') : '')
  }

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--brand)', borderRadius: 10, padding: '10px 12px', background: 'var(--brand-dim)' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{title}</div>
      {body}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        {(state === 'pending' || state === 'error') && <>
          <button onClick={confirm} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✅ {L2('Confirm', '确认执行')}</button>
          <button onClick={() => onChange({ state: 'cancelled' })} style={{ background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>{L2('Cancel', '取消')}</button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('Nothing is changed until you click Confirm.', '按确认之前不会有任何改动。')}</span>
        </>}
        {state === 'running' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Working…', '执行中…')}</span>}
        {state === 'cancelled' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Cancelled — nothing was changed.', '已取消，没有任何改动。')}</span>}
        {state === 'done' && <>
          <span style={{ fontSize: 12, color: 'var(--success, #3fb950)', fontWeight: 600 }}>✅ {done}</span>
          {link && <button onClick={() => navigate(link.to)} style={{ background: 'none', border: 'none', color: 'var(--brand)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>{link.label}</button>}
        </>}
      </div>
      {state === 'error' && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>⚠️ {error}</div>}
    </div>
  )
}

// ── AI message bubble with inline clickable usernames + chips + copy
function AIBubble({ content, steps, dataDate, actions, question, onActionChange, onVipClick }) {
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
      {(actions || []).map(a => (
        <ActionCard key={a.id} action={a} question={question} onChange={patch => onActionChange(a.id, patch)} />
      ))}
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

  // Confirm-card state lives on the message so it survives a reload (chat is kept in localStorage)
  function updateAction(msgIndex, actionId, patch) {
    setMessages(prev => prev.map((m, i) => (i !== msgIndex ? m : {
      ...m, actions: (m.actions || []).map(a => (a.id === actionId ? { ...a, ...patch } : a)),
    })))
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
      // Tell the AI what happened to its earlier proposals (confirmed / cancelled / still waiting)
      const cardNote = m => (m.actions || []).map(a => `\n[card ${a.kind}: ${a.state || 'pending'}${a.result ? ' ' + JSON.stringify(a.result).slice(0, 200) : ''}]`).join('')
      const history = nextMessages.slice(0, -1).slice(-6).map(m => ({ role: m.role, content: m.content + cardNote(m) }))
      const result = await callAI('chat', {
        question,
        history,
        language: lang,
        hostName:  profile?.full_name,
        hostEmail: profile?.email,
      })
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer || L2('No answer generated.','未生成回答。'), steps: result.steps, dataDate: result.data_date, actions: result.actions || [] }])
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
            : <AIBubble key={i} content={m.content} steps={m.steps} dataDate={m.dataDate} actions={m.actions}
                question={messages[i - 1]?.content} onActionChange={(id, patch) => updateAction(i, id, patch)} onVipClick={handleVipClick} />
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
