// ContactLog v5 - stats from logs state, no separate query
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, CURRENCY_LIST, CURRENCY_SYMBOL, CURRENCY_REGION, REGION_LABEL } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { useUrlParam, useUrlParamNumber } from '../hooks/useUrlParam'
import { callAI } from '../lib/aiApi'
import { useLanguage } from '../contexts/LanguageContext'
import * as XLSX from 'xlsx'

const CONTACT_TYPES    = ['WhatsApp','Call','In-person','Other']
const CONTACT_OUTCOMES = ['Contacted','No Reply','Replied','Deposited','Reactivated']
const TIERS             = ['ALL','BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
const PAGE_SIZE        = 50

const OUTCOME_COLOR = {
  Contacted:'#3fb950', Replied:'#58a6ff', Deposited:'#ffd700',
  'No Reply':'#d29922', Reactivated:'#b9f2ff',
}
const TYPE_COLOR = {
  WhatsApp:'#3fb950', Call:'#58a6ff', 'In-person':'#b9f2ff', Other:'#8b949e',
}

// Display-only labels for stored English values
const OUTCOME_ZH = { Contacted:'已联系', 'No Reply':'未回复', Replied:'已回复', Deposited:'已存款', Reactivated:'已召回' }
const CHANNEL_ZH = { WhatsApp:'WhatsApp', Call:'电话', 'In-person':'面对面', Other:'其他' }
const TIER_ZH = { ALL:'全部', BLACK:'黑金', DIAMOND:'钻石', PLATINUM:'白金', GOLD:'黄金', SILVER:'白银', BRONZE:'青铜' }

function timeAgo(dateStr, lang = 'en') {
  if (!dateStr) return '-'
  const zh = lang === 'zh'
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60)      return zh ? '刚刚' : 'just now'
  if (diff < 3600)    return Math.floor(diff/60) + (zh ? '分钟前' : 'm ago')
  if (diff < 86400)   return Math.floor(diff/3600) + (zh ? '小时前' : 'h ago')
  if (diff < 86400*7) return Math.floor(diff/86400) + (zh ? '天前' : 'd ago')
  return new Date(dateStr).toLocaleDateString(zh ? 'zh-CN' : 'en-MY', { day:'numeric', month:'short', year:'numeric' })
}

const s = {
  page:    { padding:'24px 28px', minHeight:'100vh' },
  title:   { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' },
  input:   { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none' },
  sel:     { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none' },
  btn:     { background:'var(--accent)', color:'#fff', border:'none', padding:'9px 20px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm:   { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'7px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  toggle:  { display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' },
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:      { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  tag:     { display:'inline-block', padding:'2px 9px', borderRadius:6, fontSize:11, fontWeight:600 },
  badge:   { display:'inline-block', padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:700 },
  pgBtn:   { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'6px 13px', borderRadius:7, fontSize:13, minWidth:36, cursor:'pointer' },
  formGrid:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 20px' },
  flbl:    { fontSize:11, color:'var(--muted)', marginBottom:4 },
  finput:  { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box' },
  fsel:    { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none' },
  fta:     { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, resize:'vertical', outline:'none', boxSizing:'border-box', fontFamily:'inherit' },
}

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 18px', minWidth:120 }}>
      <div style={{ fontSize:24, fontWeight:800, color: color || 'var(--text)' }}>{value}</div>
      <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{label}</div>
      {sub && <div style={{ fontSize:11, color: color || 'var(--muted)', marginTop:2 }}>{sub}</div>}
    </div>
  )
}

function BenefitsTab({ onBack }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  })
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [tierF, setTierF] = useState('ALL')

  useEffect(() => { loadBenefits() }, [month])

  function prevMonthOf(m) {
    const [y, mo] = m.split('-').map(Number)
    return mo === 1 ? `${y-1}-12` : `${y}-${String(mo-1).padStart(2,'0')}`
  }
  function monthEndOf(m) {
    const [y, mo] = m.split('-').map(Number)
    return new Date(y, mo, 0).toISOString().slice(0,10)
  }

  async function loadBenefits() {
    setLoading(true)
    const prevMonth = prevMonthOf(month)
    const monthStart = `${month}-01`
    const monthEnd = monthEndOf(month)

    const [{ data: bonusEvents }, { data: giftEvents }] = await Promise.all([
      supabase.from('contact_logs')
        .select('username, tier, bonus_offered, bonus_type, logged_at, vip_members!inner(currency)')
        .eq('log_month', month).not('bonus_offered', 'is', null).gt('bonus_offered', 0),
      supabase.from('gift_logs')
        .select('username, gift_type, gift_cost, bonus_given, service_cost, contact_date')
        .gte('contact_date', monthStart).lte('contact_date', monthEnd),
    ])

    const rawEvents = [
      ...(bonusEvents||[]).map(e => ({
        username: e.username, tier: e.tier, currency: e.vip_members?.currency || 'MYR',
        type: 'Host Bonus', detail: e.bonus_type || '', amount: parseFloat(e.bonus_offered) || 0, date: e.logged_at,
      })),
      ...(giftEvents||[]).map(e => ({
        username: e.username, tier: '', currency: '',
        type: 'Birthday Gift', detail: e.gift_type || '',
        amount: (parseFloat(e.gift_cost)||0) + (parseFloat(e.bonus_given)||0) + (parseFloat(e.service_cost)||0),
        date: e.contact_date,
      })),
    ]

    if (rawEvents.length === 0) { setEvents([]); setLoading(false); return }

    const uniqueUsernames = [...new Set(rawEvents.map(e => e.username))]
    const [{ data: curTotals }, { data: prevTotals }] = await Promise.all([
      supabase.from('vip_monthly_totals').select('username, tier, currency, total_deposit').eq('snapshot_month', month).in('username', uniqueUsernames.slice(0,200)),
      supabase.from('vip_monthly_totals').select('username, total_deposit').eq('snapshot_month', prevMonth).in('username', uniqueUsernames.slice(0,200)),
    ])
    const curTDMap = {}, prevTDMap = {}, tierMap = {}, currencyMap = {}
    ;(curTotals||[]).forEach(v => { curTDMap[v.username] = parseFloat(v.total_deposit)||0; tierMap[v.username] = v.tier; currencyMap[v.username] = v.currency })
    ;(prevTotals||[]).forEach(v => { prevTDMap[v.username] = parseFloat(v.total_deposit)||0 })

    const enriched = rawEvents.map(e => {
      const tdBefore = prevTDMap[e.username]
      const tdAfter  = curTDMap[e.username]
      return {
        ...e,
        tier: e.tier || tierMap[e.username] || '',
        currency: e.currency || currencyMap[e.username] || 'MYR',
        tdBefore, tdAfter,
        tdChange: (tdBefore !== undefined && tdAfter !== undefined) ? (tdAfter - tdBefore) : null,
      }
    }).sort((a,b) => new Date(b.date) - new Date(a.date))

    setEvents(enriched)
    setLoading(false)
  }

  const filtered = tierF === 'ALL' ? events : events.filter(e => e.tier === tierF)
  const totalAmount = filtered.reduce((s,e) => s + e.amount, 0)
  const positiveCount = filtered.filter(e => e.tdChange !== null && e.tdChange > 0).length

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>{L2('🎁 VIP Benefits', '🎁 VIP福利')}</div>
          <div style={s.sub}>{L2('Bonuses and gifts given to specific VIPs, with their deposit change after', '发给特定VIP的奖金和礼物，以及之后的存款变化')}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={s.input} />
          <button style={{ ...s.btn, background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)' }} onClick={onBack}>{L2('← Back to Log', '← 返回记录')}</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        <StatCard label={L2('Benefit Events', '福利次数')} value={filtered.length} color="var(--accent)" />
        <StatCard label={L2('Total Given (mixed currencies — see rows)', '发放总额（混合货币 — 见各行）')} value={filtered.length ? formatMoney(totalAmount, 'MYR') + '*' : '—'} color="#ffd700" />
        <StatCard label={L2('Deposit Increased After', '之后存款增加')} value={positiveCount}
          sub={filtered.length ? Math.round(positiveCount/filtered.length*100)+'%' : '-'} color="#3fb950" />
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={s.sel}>
          {['ALL','BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(tOpt => <option key={tOpt} value={tOpt}>{L2(tOpt, TIER_ZH[tOpt])}</option>)}
        </select>
      </div>
      <div style={{ fontSize:11, color:'var(--muted)', marginTop:-14, marginBottom:16 }}>
        {L2('* "Total Given" mixes currencies if this VIP list spans regions — check each row\'s own currency for the real amount.', '*「发放总额」在VIP跨地区时会混合货币 — 实际金额请看每行自己的货币。')}
      </div>

      <div style={s.card}>
        <div style={{ overflowX:'auto' }}>
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>VIP</th>
                <th style={s.th}>{L2('Tier', '等级')}</th>
                <th style={s.th}>{L2('Type', '类型')}</th>
                <th style={s.th}>{L2('Detail', '详情')}</th>
                <th style={s.th}>{L2('Amount', '金额')}</th>
                <th style={s.th}>{L2('Date', '日期')}</th>
                <th style={s.th}>{L2('TD Before', '之前总存款')}</th>
                <th style={s.th}>{L2('TD After', '之后总存款')}</th>
                <th style={s.th}>{L2('TD Change', '总存款变化')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:40 }}>{L2('Loading...', '载入中…')}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:40 }}>{L2('No bonuses or gifts recorded this month.', '本月没有记录奖金或礼物。')}</td></tr>
              ) : filtered.map((e, i) => (
                <tr key={i}
                  onMouseEnter={ev => ev.currentTarget.style.background='var(--surface2)'}
                  onMouseLeave={ev => ev.currentTarget.style.background='transparent'}>
                  <td style={{ ...s.td, fontWeight:700 }}>{e.username}</td>
                  <td style={s.td}>
                    {e.tier && <span style={{ ...s.badge, background:TIER_BG[e.tier]||'transparent', color:TIER_COLOR[e.tier]||'var(--text)' }}>{L2(e.tier, TIER_ZH[e.tier] || e.tier)}</span>}
                  </td>
                  <td style={{ ...s.td, fontSize:12 }}>{L2(e.type, e.type === 'Host Bonus' ? '负责人奖金' : e.type === 'Birthday Gift' ? '生日礼物' : e.type)}</td>
                  <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{e.detail || '—'}</td>
                  <td style={{ ...s.td, fontWeight:700, color:'#ffd700' }}>{formatMoney(e.amount, e.currency)}</td>
                  <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{e.date ? new Date(e.date).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY',{day:'numeric',month:'short'}) : '—'}</td>
                  <td style={{ ...s.td, fontSize:12 }}>{e.tdBefore !== undefined ? formatMoney(e.tdBefore, e.currency) : L2('N/A', '无')}</td>
                  <td style={{ ...s.td, fontSize:12 }}>{e.tdAfter !== undefined ? formatMoney(e.tdAfter, e.currency) : L2('N/A', '无')}</td>
                  <td style={{ ...s.td, fontWeight:700, color: e.tdChange === null ? 'var(--muted)' : e.tdChange > 0 ? '#3fb950' : e.tdChange < 0 ? '#f85149' : 'var(--muted)' }}>
                    {e.tdChange === null ? L2('N/A', '无') : (e.tdChange >= 0 ? '+' : '') + formatMoney(e.tdChange, e.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function AwaitingReplyTab({ onBack, myName, viewMode }) {
  const { t, lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])

  useEffect(() => { load() }, [viewMode])

  async function load() {
    setLoading(true)
    try {
      // Pull recent logs (90 days is plenty — anything older and the "latest
      // log per VIP" logic below would already have picked up a newer one if
      // it existed) and find, per VIP, only their single most recent entry.
      const since = new Date(); since.setDate(since.getDate() - 90)
      let q = supabase.from('contact_logs')
        .select('id, username, tier, host_name, outcome, notes, logged_at')
        .gte('logged_at', since.toISOString())
        .order('logged_at', { ascending: false })
      if (viewMode === 'mine' && myName) q = q.eq('host_name', myName)
      const { data, error } = await q
      if (error) { console.error(error); setRows([]); return }

      const latestByUser = {}
      ;(data || []).forEach(log => {
        if (!latestByUser[log.username]) latestByUser[log.username] = log // first seen = most recent, since sorted desc
      })

      const now = new Date()
      const stuck = Object.values(latestByUser)
        .filter(log => log.outcome === 'Contacted')
        .map(log => ({ ...log, daysSince: Math.floor((now - new Date(log.logged_at)) / (1000*60*60*24)) }))
        .filter(log => log.daysSince >= 1)
        .sort((a,b) => b.daysSince - a.daysSince)

      // Pull phone/whatsapp for the follow-up button.
      const usernames = stuck.map(r => r.username)
      let extraMap = {}
      if (usernames.length > 0 && usernames.length <= 200) {
        const { data: extras } = await supabase.from('vip_members').select('username, whatsapp, phone').in('username', usernames)
        ;(extras || []).forEach(e => { extraMap[e.username] = e })
      }
      setRows(stuck.map(r => ({ ...r, ...extraMap[r.username] })))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={s.title}>{L2('⏳ Awaiting Reply', '⏳ 等待回复')}</div>
          <div style={s.sub}>{L2('VIPs where the last thing logged was "Contacted" — 1+ days ago, no follow-up recorded since', '最后一条记录为「已联系」的VIP — 已超过1天，之后没有跟进记录')}</div>
        </div>
        <button style={{ ...s.btn, background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)' }} onClick={onBack}>← {t('common.back')}</button>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, color:'#3fb950' }}>{L2('✓ Nothing waiting on a reply right now.', '✓ 目前没有等待回复的VIP。')}</div>
      ) : (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--border)' }}>
                <th style={{ ...s.th }}>VIP</th>
                <th style={{ ...s.th }}>{L2('Tier', '等级')}</th>
                <th style={{ ...s.th }}>{L2('Contacted By', '联系人')}</th>
                <th style={{ ...s.th }}>{L2('Days Waiting', '等待天数')}</th>
                <th style={{ ...s.th }}>{L2('Note', '备注')}</th>
                <th style={{ ...s.th }}>{L2('Follow Up', '跟进')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const rawNumber = (r.phone && r.phone.replace(/\D/g,'').length >= 10) ? r.phone
                  : (r.whatsapp && r.whatsapp.replace(/\D/g,'').length >= 10) ? r.whatsapp : ''
                const waNumber = rawNumber.replace(/\D/g,'')
                const greeting = encodeURIComponent(`Hi ${r.username}, just following up — wanted to check if you saw my earlier message. This is ${r.host_name || myName || 'the VIP team'}.`)
                return (
                  <tr key={r.username} style={{ borderBottom:'1px solid var(--border)' }}>
                    <td style={{ ...s.td, fontWeight:700 }}>{r.username}</td>
                    <td style={s.td}>{r.tier && <span style={{ ...s.badge, background:TIER_BG[r.tier]||'transparent', color:TIER_COLOR[r.tier]||'var(--text)' }}>{L2(r.tier, TIER_ZH[r.tier] || r.tier)}</span>}</td>
                    <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{r.host_name || '—'}</td>
                    <td style={{ ...s.td, fontWeight:700, color: r.daysSince >= 3 ? '#f85149' : '#d29922' }}>{L2(`${r.daysSince}d`, `${r.daysSince}天`)}</td>
                    <td style={{ ...s.td, fontSize:12, color:'var(--muted)', maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.notes || '—'}</td>
                    <td style={s.td}>
                      {waNumber ? (
                        <a href={`https://wa.me/${waNumber}?text=${greeting}`} target="_blank" rel="noopener noreferrer"
                          style={{ display:'inline-flex', width:26, height:26, borderRadius:13, background:'#25D366', color:'#fff', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, textDecoration:'none' }}>W</a>
                      ) : <span style={{ color:'var(--muted)' }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function ContactLog() {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const navigate    = useNavigate()
  const [pageTab, setPageTab] = useUrlParam('view', 'log') // 'log' | 'benefits' | 'awaiting'

  const [viewMode, setViewMode] = useUrlParam('mode', 'all')
  const [search,   setSearch]   = useUrlParam('search', '')
  const [hostF,    setHostF]    = useUrlParam('host', 'ALL')
  const [tierF,    setTierF]    = useUrlParam('tier', 'ALL')
  const [dateFrom, setDateFrom] = useUrlParam('from', '')
  const [dateTo,   setDateTo]   = useUrlParam('to', '')
  const [logs,     setLogs]     = useState([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  // MYR and SGD bonus amounts must never be summed together — this toggle
  // picks ONE currency for the "Total Bonus Given" stat card. Individual rows
  // in the table below still show every log with each VIP's own currency
  // symbol (see loadLogs' vip_members join), only the summed stat is scoped.
  const [bonusCurrency, setBonusCurrency] = useUrlParam('cur', 'MYR')

  // Compute today/positive-outcome stats from the currently loaded page.
  useEffect(() => {
    const today = new Date().toISOString().slice(0,10)
    const todayCount    = logs.filter(l => l.logged_at?.slice(0,10) === today).length
    const positiveCount = logs.filter(l => ['Contacted','Replied','Deposited','Reactivated'].includes(l.outcome)).length
    setStats(prev => ({ ...prev, today: todayCount, positive: positiveCount }))
  }, [logs])
  // Total Bonus Given must reflect every matching log across all pages, in one
  // currency at a time — not just the 50 rows on the current page.
  useEffect(() => { loadBonusTotal() }, [viewMode, hostF, tierF, dateFrom, dateTo, search, bonusCurrency, profile])
  const [page,     setPage]     = useUrlParamNumber('page', 0)
  const [hosts,    setHosts]    = useState([])
  const [stats,    setStats]    = useState({ total:0, today:0, positive:0, bonusTotal:0 })
  const [waNumbers, setWaNumbers]     = useState([])
  const [allWaNumbers, setAllWaNumbers] = useState([])
  useEffect(() => {
    if (!profile) return
    const myName = profile.full_name || profile.username || (profile.email ? profile.email.split('@')[0] : '')
    // Load my numbers for the new-log form
    if (myName) {
      supabase.from('wa_numbers').select('id,codename,number,telco').eq('host', myName).eq('status','Active')
        .then(({ data }) => setWaNumbers(data || []))
    }
    // Load ALL numbers for the edit dropdown (admin may need any number)
    supabase.from('wa_numbers').select('id,codename,number,telco,host').eq('status','Active').order('host').order('codename')
      .then(({ data }) => setAllWaNumbers(data || []))
  }, [profile])

  const [showForm, setShowForm]     = useState(false)
  const [notePopup, setNotePopup]   = useState(null) // { username, notes }
  const [copyMsg, setCopyMsg]       = useState('')
  const [exporting, setExporting]   = useState(false)

  // ── Copy helpers ───────────────────────────────────────────────────────────
  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // fallback for older browsers / non-https
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta)
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopyMsg(label || L2('Copied ✓', '已复制 ✓')); setTimeout(() => setCopyMsg(''), 1800)
  }
  function fmtLogTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleString('en-GB', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false })
  }
  // All logs for one VIP (oldest first) as one text block
  async function copyVipHistory(username) {
    const { data, error } = await supabase.from('contact_logs')
      .select('logged_at, host_name, channel, outcome, notes, bonus_offered, bonus_type')
      .eq('username', username).order('logged_at', { ascending: true }).range(0, 999)
    if (error) { setCopyMsg(L2('Copy failed', '复制失败')); return }
    const text = [`=== ${username} — contact history (${(data||[]).length} logs) ===`, '',
      ...(data||[]).map(l => `[${fmtLogTime(l.logged_at)}] ${l.host_name || ''} · ${l.channel || ''} · ${l.outcome || ''}${l.bonus_offered ? ` · Bonus ${l.bonus_offered}${l.bonus_type ? ' ' + l.bonus_type : ''}` : ''}\n${l.notes || '(no note)'}\n`)
    ].join('\n')
    copyText(text, L2(`Copied ${(data||[]).length} logs ✓`, `已复制 ${(data||[]).length} 条记录 ✓`))
  }

  // ── Export all logs matching current filters (host / tier / date / search) ──
  async function exportLogs() {
    setExporting(true)
    try {
      const all = []
      for (let from = 0; ; from += 1000) {
        let q = supabase.from('contact_logs')
          .select('logged_at, username, tier, host_name, channel, direction, outcome, notes, vip_response, bonus_offered, bonus_type, follow_up_needed, follow_up_date, wa_number_used, vip_members(tier, full_name, currency)')
        if (viewMode === 'mine' && profile) {
          const me = profile.full_name || profile.username || (profile.email ? profile.email.split('@')[0] : null)
          if (me) q = q.eq('host_name', me)
        }
        if (hostF !== 'ALL') q = q.eq('host_name', hostF)
        if (tierF !== 'ALL') q = q.eq('vip_members.tier', tierF).not('vip_members', 'is', null)
        if (search.trim())   q = q.ilike('username', `%${search}%`)
        if (dateFrom)        q = q.gte('logged_at', dateFrom)
        if (dateTo)          q = q.lte('logged_at', dateTo + 'T23:59:59')
        q = q.order('logged_at', { ascending: true }).range(from, from + 999)
        const { data, error } = await q
        if (error) throw error
        all.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      if (all.length === 0) { alert(L2('No logs match the current filters.', '没有符合当前筛选的记录。')); setExporting(false); return }

      // Sheet 1: one row per log
      const rows = all.map(l => ({
        'Date/Time': fmtLogTime(l.logged_at),
        'Host': l.host_name || '',
        'VIP': l.username,
        'Full Name': l.vip_members?.full_name || '',
        'Tier': l.vip_members?.tier || l.tier || '',
        'Channel': l.channel || '',
        'Outcome': l.outcome || '',
        'Note / Conversation': l.notes || '',
        'VIP Response': l.vip_response || '',
        'Bonus': l.bonus_offered || '',
        'Bonus Type': l.bonus_type || '',
        'Currency': l.vip_members?.currency || '',
        'Follow Up': l.follow_up_needed ? (l.follow_up_date || 'Yes') : '',
        'WA Number': l.wa_number_used || '',
      }))
      // Sheet 2: one row per VIP, full conversation in time order
      const byVip = {}
      all.forEach(l => {
        const k = l.username
        if (!byVip[k]) byVip[k] = { vip: k, name: l.vip_members?.full_name || '', tier: l.vip_members?.tier || l.tier || '', hosts: new Set(), logs: [] }
        if (l.host_name) byVip[k].hosts.add(l.host_name)
        byVip[k].logs.push(`[${fmtLogTime(l.logged_at)}] ${l.host_name || ''} (${l.outcome || ''})\n${l.notes || ''}`)
      })
      const vipRows = Object.values(byVip).sort((a, b) => b.logs.length - a.logs.length).map(v => ({
        'VIP': v.vip, 'Full Name': v.name, 'Tier': v.tier, 'Host(s)': [...v.hosts].join(', '),
        'Logs': v.logs.length,
        'Full Conversation': v.logs.join('\n\n').slice(0, 32000), // Excel cell limit
      }))

      const wb = XLSX.utils.book_new()
      const ws1 = XLSX.utils.json_to_sheet(rows)
      ws1['!cols'] = [{ wch:17 }, { wch:12 }, { wch:16 }, { wch:22 }, { wch:10 }, { wch:10 }, { wch:12 }, { wch:70 }, { wch:30 }, { wch:8 }, { wch:12 }, { wch:8 }, { wch:12 }, { wch:12 }]
      ws1['!autofilter'] = { ref: ws1['!ref'] }
      const ws2 = XLSX.utils.json_to_sheet(vipRows)
      ws2['!cols'] = [{ wch:16 }, { wch:22 }, { wch:10 }, { wch:18 }, { wch:6 }, { wch:100 }]
      ws2['!autofilter'] = { ref: ws2['!ref'] }
      XLSX.utils.book_append_sheet(wb, ws1, 'Contact Logs')
      XLSX.utils.book_append_sheet(wb, ws2, 'By VIP')

      const hostPart = viewMode === 'mine' ? 'Me' : hostF === 'ALL' ? 'AllHosts' : hostF.replace(/[^\w]+/g, '_')
      const datePart = `${dateFrom || 'start'}_to_${dateTo || new Date().toISOString().slice(0,10)}`
      XLSX.writeFile(wb, `ContactLog_${hostPart}_${datePart}.xlsx`)
    } catch (e) {
      console.error('Contact log export error', e)
      alert(L2('Export failed: ', '导出失败：') + (e.message || e))
    }
    setExporting(false)
  }
  const [editingLogId, setEditingLogId]       = useState(null)
  const [editingNote, setEditingNote]         = useState('')
  const [editingOutcome, setEditingOutcome]   = useState('Contacted')
  const [editingWaNumber, setEditingWaNumber] = useState('')
  const [vipSearch,    setVipSearch]   = useState('')
  const [vipResults,   setVipResults]  = useState([])
  const [selectedVip,  setSelectedVip] = useState(null)
  const [manualMode,   setManualMode]   = useState(false)
  const [manualUsername, setManualUsername] = useState('')
  const [manualTier,   setManualTier]   = useState('GOLD')
  const [submitting,   setSubmitting]  = useState(false)
  const [logForm, setLogForm] = useState({
    contact_type:'WhatsApp', outcome:'Contacted',
    bonus_offered:'', bonus_type:'', notes:'', wa_number_used:'',
  })
  const vipSearchRef = useRef(null)

  // Page reset happens as its own effect, not chained inside each filter's
  // change handler — chaining two different URL-param setters in one handler
  // causes the second one to silently discard the first (see useUrlParam.js).
  useEffect(() => { setPage(0) }, [viewMode, hostF, tierF, dateFrom, dateTo, search])
  useEffect(() => { loadLogs() }, [viewMode, hostF, tierF, dateFrom, dateTo, search, page])
  useEffect(() => { setPage(0); loadLogs() }, [search])
  useEffect(() => { loadHosts() }, [viewMode, profile])

  async function loadHosts() {
    const { data } = await supabase.from('profiles').select('full_name, id').order('full_name')
    if (data) setHosts(data)
  }

  // Stats computed from logs useEffect

    async function loadLogs() {
    setLoading(true)
    let q = supabase
      .from('contact_logs')
      .select('*, vip_members(tier, full_name, currency)', { count:'exact' })
    if (viewMode === 'mine' && profile) {
      const myName = profile.full_name || profile.username || (profile.email ? profile.email.split('@')[0] : null)
      if (myName) q = q.eq('host_name', myName)
    }
    if (hostF !== 'ALL') q = q.eq('host_name', hostF)
    if (tierF !== 'ALL') q = q.eq('vip_members.tier', tierF).not('vip_members', 'is', null)
    if (search.trim())   q = q.ilike('username', `%${search}%`)
    if (dateFrom)        q = q.gte('logged_at', dateFrom)
    if (dateTo)          q = q.lte('logged_at', dateTo + 'T23:59:59')
    q = q.order('logged_at', { ascending: false })
    q = q.range(page * PAGE_SIZE, (page+1) * PAGE_SIZE - 1)
    const { data, count, error } = await q
    if (!error) { setLogs(data||[]); setTotal(count||0); setStats(prev => ({ ...prev, total: count||0 })) }
    setLoading(false)
  }

  // Sums bonus_offered across EVERY log matching the current filters (not just
  // the current page), scoped to one currency at a time via bonusCurrency.
  async function loadBonusTotal() {
    let q = supabase
      .from('contact_logs')
      .select('bonus_offered, vip_members!inner(currency)')
      .not('bonus_offered', 'is', null)
      .gt('bonus_offered', 0)
      .eq('vip_members.currency', bonusCurrency)
    if (viewMode === 'mine' && profile) {
      const myName = profile.full_name || profile.username || (profile.email ? profile.email.split('@')[0] : null)
      if (myName) q = q.eq('host_name', myName)
    }
    if (hostF !== 'ALL') q = q.eq('host_name', hostF)
    if (tierF !== 'ALL') q = q.eq('vip_members.tier', tierF)
    if (search.trim())   q = q.ilike('username', `%${search}%`)
    if (dateFrom)        q = q.gte('logged_at', dateFrom)
    if (dateTo)          q = q.lte('logged_at', dateTo + 'T23:59:59')
    const { data, error } = await q
    if (error) { console.error('loadBonusTotal error', error); return }
    const bonusTotal = (data || []).reduce((sum, l) => sum + (parseFloat(l.bonus_offered) || 0), 0)
    setStats(prev => ({ ...prev, bonusTotal }))
  }

  useEffect(() => {
    if (!vipSearch.trim()) { setVipResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('vip_members')
        .select('id, username, full_name, tier')
        .or(`username.ilike.%${vipSearch}%,full_name.ilike.%${vipSearch}%`)
        .eq('is_excluded', false)
        .limit(8)
      setVipResults(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [vipSearch])

  async function submitLog() {
    const username = manualMode ? manualUsername.trim() : selectedVip?.username
    const tier     = manualMode ? manualTier : selectedVip?.tier
    const vipId    = manualMode ? null : selectedVip?.id
    if (!username || !logForm.notes.trim()) return
    setSubmitting(true)
    const myName = profile?.full_name || profile?.username || (profile?.email ? profile.email.split('@')[0] : 'Host')
    const { data: inserted, error: insertError } = await supabase.from('contact_logs').insert({
      vip_id:          vipId,
      username:        username,
      tier:            tier,
      host_name:       myName,
      host_id:         profile?.id || null,
      channel:         logForm.contact_type,
      outcome:         logForm.outcome,
      bonus_offered:   parseFloat(logForm.bonus_offered) || 0,
      bonus_type:      logForm.bonus_type || null,
      notes:           logForm.notes,
      message_summary: logForm.notes,
      direction:       'outbound',
      logged_at:       new Date().toISOString(),
      log_month:       new Date().toISOString().slice(0,7),
      log_week:        String(Math.ceil(new Date().getDate()/7)),
      wa_number_used:  logForm.wa_number_used || null,
    }).select('id').single()
    if (insertError) { console.error(insertError); alert(L2('Error: ', '错误：') + insertError.message) }
    else if (inserted?.id && logForm.notes.trim()) {
      // Auto-classify into the same 10 issue tags Analytics already uses —
      // fire-and-forget: if this fails, the log itself is already saved fine,
      // it just won't have an auto-tag (same as before this feature existed).
      callAI('tag-issue', { notes: logForm.notes })
        .then(res => {
          if (res.tag) {
            return supabase.from('contact_issue_tags').insert({
              log_id: inserted.id, username, issue_tag: res.tag,
            })
          }
        })
        .catch(e => console.error('Auto-tag failed (log was still saved):', e))
    }
    // Sync last_contacted on vip_members (fire-and-forget, log already saved)
    if (vipId) {
      const _now = new Date().toISOString()
      supabase.from('vip_members').update({ last_contacted: _now, last_contact_date: _now.slice(0,10) }).eq('id', vipId).then(() => {})
    }
    setLogForm({ contact_type:'WhatsApp', outcome:'Contacted', bonus_offered:'', bonus_type:'', notes:'', wa_number_used:'' })
    setSelectedVip(null); setVipSearch(''); setVipResults([])
    setManualMode(false); setManualUsername(''); setManualTier('GOLD')
    setShowForm(false); setSubmitting(false)
    loadLogs()
  }

  async function deleteLog(logId) {
    if (!window.confirm(L2('Delete this contact log?', '确定删除这条联系记录？'))) return
    await supabase.from('contact_logs').delete().eq('id', logId)
    loadLogs()
  }

  async function saveEdit(logId) {
    await supabase.from('contact_logs').update({ notes: editingNote, message_summary: editingNote, outcome: editingOutcome, wa_number_used: editingWaNumber || null }).eq('id', logId)
    setEditingLogId(null)
    loadLogs()
  }

  function resetFilters() {
    setSearch(''); setHostF('ALL'); setTierF('ALL'); setDateFrom(''); setDateTo(''); setPage(0)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const myName = profile?.full_name || profile?.username || ''

  if (pageTab === 'benefits') {
    return <BenefitsTab onBack={() => setPageTab('log')} />
  }
  if (pageTab === 'awaiting') {
    return <AwaitingReplyTab onBack={() => setPageTab('log')} myName={myName} viewMode={viewMode} />
  }

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>{L2('Contact Log', '联系记录')}</div>
          <div style={s.sub}>{L2('All host-VIP interactions in one place', '所有负责人与VIP的互动汇总')}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={s.toggle}>
            {['mine','all'].map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)}
                style={{ background:viewMode===mode?'var(--accent)':'transparent', color:viewMode===mode?'#fff':'var(--muted)', border:'none', padding:'8px 18px', fontSize:13, fontWeight:600, cursor:'pointer', transition:'all .15s' }}>
                {mode === 'mine' ? L2('My Logs', '我的记录') : L2('All Logs', '全部记录')}
              </button>
            ))}
          </div>
          <button style={{ ...s.btn, background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)' }} onClick={() => setPageTab('benefits')}>{L2('🎁 Bonus & Gifts', '🎁 奖金与礼物')}</button>
          <button
            onClick={() => setPageTab(pageTab === 'awaiting' ? 'log' : 'awaiting')}
            style={{
              ...s.btn,
              background: pageTab === 'awaiting' ? 'var(--amber, #f59e0b)' : 'var(--surface2)',
              color: pageTab === 'awaiting' ? '#fff' : 'var(--text)',
              border: `1px solid ${pageTab === 'awaiting' ? 'var(--amber, #f59e0b)' : 'var(--border)'}`,
            }}
          >{pageTab === 'awaiting' ? L2('⏳ Awaiting Reply ✕', '⏳ 等待回复 ✕') : L2('⏳ Awaiting Reply', '⏳ 等待回复')}</button>
          <button style={s.btn} onClick={() => setShowForm(true)}>{L2('+ Log Contact', '+ 记录联系')}</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        <StatCard label={viewMode==='mine'?L2('My Total Logs', '我的记录总数'):L2('Total Logs', '记录总数')} value={stats.total} color="var(--accent)" />
        <StatCard label={L2('Today', '今天')} value={stats.today} color="#3fb950" />
        <StatCard label={L2('Positive Outcomes', '正面结果')} value={stats.positive}
          sub={stats.total ? Math.round(stats.positive/stats.total*100)+'%' : '-'} color="#3fb950" />
        <StatCard label={L2(`Total Bonus Given (${CURRENCY_SYMBOL[bonusCurrency]})`, `发放奖金总额 (${CURRENCY_SYMBOL[bonusCurrency]})`)} value={formatMoney(stats.bonusTotal, bonusCurrency)} color="#ffd700" />
        <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', alignSelf:'center' }}>
          {CURRENCY_LIST.map(c => (
            <button key={c} onClick={() => setBonusCurrency(c)} style={{ background: bonusCurrency===c?'var(--accent)':'transparent', color: bonusCurrency===c?'#fff':'var(--muted)', border:'none', padding:'6px 12px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
              {REGION_LABEL[CURRENCY_REGION[c]]}
            </button>
          ))}
        </div>
      </div>

      {showForm && (
        <div style={{ ...s.card, marginBottom:16, border:'1px solid var(--accent)' }}>
          <div style={s.cardHdr}>{L2('Log New Contact', '记录新联系')}</div>
          <div style={{ padding:'18px 20px' }}>
            <div style={{ marginBottom:14, position:'relative' }}>
              <div style={s.flbl}>{L2('Search VIP *', '搜索VIP *')}</div>
              {manualMode ? (
                <div style={{ background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', borderRadius:8, padding:'10px 14px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span style={{ fontSize:11, color:'#f59e0b', fontWeight:700 }}>{L2('✏️ MANUAL', '✏️ 手动')}</span>
                  <input style={{ ...s.finput, flex:1, minWidth:120 }} value={manualUsername}
                    onChange={e => setManualUsername(e.target.value)} placeholder={L2('Username...', '用户名…')} autoFocus />
                  <select style={{ ...s.fsel, width:130 }} value={manualTier} onChange={e => setManualTier(e.target.value)}>
                    {['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(t => (
                      <option key={t} value={t}>{L2(t, TIER_ZH[t])}</option>
                    ))}
                  </select>
                  <button onClick={() => { setManualMode(false); setManualUsername(''); setManualTier('GOLD') }}
                    style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:16 }}>×</button>
                </div>
              ) : selectedVip ? (
                <div style={{ display:'flex', alignItems:'center', gap:10, background:'var(--surface2)', border:'1px solid var(--accent)', borderRadius:8, padding:'8px 12px' }}>
                  <span style={{ ...s.badge, background:TIER_BG[selectedVip.tier], color:TIER_COLOR[selectedVip.tier] }}>{L2(selectedVip.tier, TIER_ZH[selectedVip.tier] || selectedVip.tier)}</span>
                  <span style={{ fontWeight:700, color:'var(--text)' }}>{selectedVip.username}</span>
                  <span style={{ color:'var(--muted)', fontSize:12 }}>{selectedVip.full_name}</span>
                  <button onClick={() => { setSelectedVip(null); setVipSearch('') }}
                    style={{ marginLeft:'auto', background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:16 }}>x</button>
                </div>
              ) : (
                <>
                  <input ref={vipSearchRef} style={{ ...s.finput, marginTop:4 }}
                    value={vipSearch} onChange={e => setVipSearch(e.target.value)}
                    placeholder={L2('Type username or name...', '输入用户名或姓名…')} autoFocus />
                  {vipResults.length > 0 && (
                    <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, zIndex:100, boxShadow:'0 8px 24px rgba(0,0,0,.4)', marginTop:2 }}>
                      {vipResults.map(v => (
                        <div key={v.id} onClick={() => { setSelectedVip(v); setVipSearch(''); setVipResults([]) }}
                          style={{ padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                          onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                          <span style={{ ...s.badge, background:TIER_BG[v.tier], color:TIER_COLOR[v.tier] }}>{L2(v.tier, TIER_ZH[v.tier] || v.tier)}</span>
                          <span style={{ fontWeight:700 }}>{v.username}</span>
                          <span style={{ color:'var(--muted)', fontSize:12 }}>{v.full_name}</span>
                        </div>
                      ))}
                      <div onClick={() => { setManualMode(true); setManualUsername(vipSearch); setVipSearch(''); setVipResults([]) }}
                        style={{ padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:8, color:'#f59e0b', fontSize:12, fontWeight:600 }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        {L2(`✏️ Not in list? Log manually with "${vipSearch}"`, `✏️ 不在列表中？以「${vipSearch}」手动记录`)}
                      </div>
                    </div>
                  )}
                  {vipSearch.trim().length >= 2 && vipResults.length === 0 && (
                    <div style={{ marginTop:6, fontSize:12 }}>
                      <span style={{ color:'var(--muted)' }}>{L2('No results found. ', '找不到结果。')}</span>
                      <span style={{ color:'#f59e0b', cursor:'pointer', fontWeight:600 }}
                        onClick={() => { setManualMode(true); setManualUsername(vipSearch); setVipSearch(''); setVipResults([]) }}>
                        {L2(`✏️ Log manually with "${vipSearch}"`, `✏️ 以「${vipSearch}」手动记录`)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{ ...s.formGrid, marginBottom:12 }}>
              <div>
                <div style={s.flbl}>{L2('Contact Type', '联系方式')}</div>
                <select style={{ ...s.fsel, marginTop:4 }} value={logForm.contact_type}
                  onChange={e => setLogForm({...logForm, contact_type:e.target.value})}>
                  {CONTACT_TYPES.map(t => <option key={t} value={t}>{L2(t, CHANNEL_ZH[t])}</option>)}
                </select>
              </div>
              <div>
                <div style={s.flbl}>{L2('Outcome', '结果')}</div>
                <select style={{ ...s.fsel, marginTop:4 }} value={logForm.outcome}
                  onChange={e => setLogForm({...logForm, outcome:e.target.value})}>
                  {CONTACT_OUTCOMES.map(o => <option key={o} value={o}>{L2(o, OUTCOME_ZH[o])}</option>)}
                </select>
              </div>
              <div>
                <div style={s.flbl}>{L2('Bonus Offered (RM)', '提供奖金 (RM)')}</div>
                <input type="number" style={{ ...s.finput, marginTop:4 }} value={logForm.bonus_offered}
                  onChange={e => setLogForm({...logForm, bonus_offered:e.target.value})} placeholder="0" />
                <div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>
                  {L2('💡 Bonus recorded here automatically appears in Budget Strategy → Bonus Log', '💡 此处记录的奖金会自动出现在 预算策略 → 奖金记录')}
                </div>
              </div>
              <div>
                <div style={s.flbl}>{L2('Bonus Type', '奖金类型')}</div>
                <input style={{ ...s.finput, marginTop:4 }} value={logForm.bonus_type}
                  onChange={e => setLogForm({...logForm, bonus_type:e.target.value})}
                  placeholder={L2('e.g. Reload, Birthday, Cashback', '例如：充值、生日、返水')} />
              </div>
            </div>
            {logForm.contact_type === 'WhatsApp' && waNumbers.length > 0 && (
              <div style={{ marginBottom:12 }}>
                <div style={s.flbl}>{L2('📱 Send as (WA number)', '📱 发送号码 (WA)')}</div>
                <select style={{ ...s.fsel, marginTop:4 }} value={logForm.wa_number_used}
                  onChange={e => setLogForm({...logForm, wa_number_used:e.target.value})}>
                  <option value="">{L2('— Not specified —', '— 未指定 —')}</option>
                  {waNumbers.map(n => <option key={n.id} value={n.codename}>{n.codename} — {n.number}{n.telco?' ('+n.telco+')':''}</option>)}
                </select>
              </div>
            )}
            <div style={{ marginBottom:14 }}>
              <div style={s.flbl}>{L2('Notes *', '备注 *')}</div>
              <textarea style={{ ...s.fta, marginTop:4 }} rows={3}
                value={logForm.notes} onChange={e => setLogForm({...logForm, notes:e.target.value})}
                placeholder={L2('What happened? VIP response, mood, promises made...', '发生了什么？VIP回应、情绪、做出的承诺…')} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button style={{ ...s.btn, opacity:((!selectedVip&&!manualUsername.trim())||!logForm.notes.trim())?0.5:1 }}
                onClick={submitLog} disabled={submitting||(!selectedVip&&!manualUsername.trim())||!logForm.notes.trim()}>
                {submitting ? L2('Saving...', '保存中…') : L2('Save Log', '保存记录')}
              </button>
              <button style={s.btnSm} onClick={() => { setShowForm(false); setSelectedVip(null); setVipSearch('') }}>{L2('Cancel', '取消')}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ ...s.card, padding:'14px 18px', marginBottom:14 }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <input style={{ ...s.input, width:200 }} placeholder={L2('Search VIP username...', '搜索VIP用户名…')}
            value={search} onChange={e => setSearch(e.target.value)} />
          <select style={s.sel} value={tierF} onChange={e => setTierF(e.target.value)}>
            {TIERS.map(t => <option key={t} value={t}>{L2(t, TIER_ZH[t])}</option>)}
          </select>
          {viewMode === 'all' && (
            <select style={{ ...s.sel, minWidth:140 }} value={hostF} onChange={e => setHostF(e.target.value)}>
              <option value="ALL">{L2('All Hosts', '全部负责人')}</option>
              {hosts.map(h => { const name = h.full_name || 'Unknown'; return <option key={h.id || name} value={name}>{h.full_name || L2('Unknown', '未知')}</option> })}
            </select>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'var(--muted)' }}>{L2('From', '从')}</span>
            <input type="date" style={s.input} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span style={{ fontSize:12, color:'var(--muted)' }}>{L2('To', '至')}</span>
            <input type="date" style={s.input} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {(search||hostF!=='ALL'||tierF!=='ALL'||dateFrom||dateTo) && (
            <button style={s.btnSm} onClick={resetFilters}>{L2('Clear', '清除')}</button>
          )}
          <div style={{ marginLeft:'auto', fontSize:12, color:'var(--muted)' }}>
            {loading ? L2('Loading...', '载入中…') : L2(`${total} logs · page ${page+1}/${Math.max(1,totalPages)}`, `${total} 条记录 · 第 ${page+1}/${Math.max(1,totalPages)} 页`)}
          </div>
          <button onClick={exportLogs} disabled={exporting || total === 0}
            title={L2('Export every log matching the current Host / Tier / Date / Search filters', '导出符合当前负责人/等级/日期/搜索筛选的所有记录')}
            style={{ background:'var(--brand, #FF6B00)', color:'#fff', border:'none', borderRadius:6, padding:'7px 14px', fontSize:12, fontWeight:700, cursor: exporting ? 'wait' : 'pointer', opacity: (exporting || total === 0) ? 0.6 : 1 }}>
            {exporting ? L2('Exporting…', '导出中…') : L2(`⬇ Export ${total} logs`, `⬇ 导出 ${total} 条记录`)}
          </button>
        </div>
      </div>

      <div style={{ ...s.card, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={s.tbl}>
            <thead>
              <tr>
                <th style={s.th}>#</th>
                <th style={s.th}>VIP</th>
                <th style={s.th}>{L2('Tier', '等级')}</th>
                <th style={s.th}>{L2('Type', '方式')}</th>
                <th style={s.th}>{L2('Outcome', '结果')}</th>
                <th style={s.th}>{L2('WA #', 'WA号码')}</th>
                <th style={s.th}>{L2('Bonus', '奖金')}</th>
                <th style={s.th}>{L2('Notes', '备注')}</th>
                <th style={s.th}>{L2('Host', '负责人')}</th>
                <th style={s.th}>{L2('When', '时间')}</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ ...s.td, textAlign:'center', padding:'40px', color:'var(--muted)' }}>{L2('Loading...', '载入中…')}</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={10} style={{ ...s.td, textAlign:'center', padding:'40px', color:'var(--muted)' }}>
                  {L2('No contact logs found.', '找不到联系记录。')}{' '}
                  {!showForm && <span style={{ color:'var(--accent)', cursor:'pointer' }} onClick={() => setShowForm(true)}>{L2('Log one now', '立即记录一条')}</span>}
                </td></tr>
              ) : logs.map((log, i) => {
                const tier = log.vip_members?.tier || log.tier
                const isEditingThis = editingLogId === log.id
                return (
                  <tr key={log.id} style={{ cursor:'pointer', borderLeft: log.host_name===myName ? '3px solid var(--accent)' : '3px solid transparent', background: log.host_name===myName ? 'rgba(99,102,241,0.04)' : 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}
                    onClick={() => !isEditingThis && navigate(`/vips/${log.vip_id}`)}>
                    <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{page*PAGE_SIZE+i+1}</td>
                    <td style={{ ...s.td, fontWeight:700 }} onClick={e => e.stopPropagation()}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                        <span style={{ cursor:'pointer' }} onClick={() => navigate(`/vips/${log.vip_id}`)}>{log.username}</span>
                        <button
                          title={L2('Copy username', '复制用户名')}
                          onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(log.username) }}
                          style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:12, padding:'0 2px', lineHeight:1, opacity:.6 }}
                          onMouseEnter={e => e.currentTarget.style.opacity=1}
                          onMouseLeave={e => e.currentTarget.style.opacity=.6}
                        >⎘</button>
                      </span>
                    </td>
                    <td style={s.td}>
                      {tier ? <span style={{ ...s.badge, background:TIER_BG[tier]||'transparent', color:TIER_COLOR[tier]||'var(--text)' }}>{L2(tier, TIER_ZH[tier] || tier)}</span>
                             : <span style={{ color:'var(--muted)' }}>-</span>}
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.tag, background:`${TYPE_COLOR[log.channel]||'#8b949e'}22`, color:TYPE_COLOR[log.channel]||'#8b949e' }}>
                        {L2(log.channel || '-', CHANNEL_ZH[log.channel] || log.channel || '-')}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.tag, background:`${OUTCOME_COLOR[log.outcome]||'#8b949e'}22`, color:OUTCOME_COLOR[log.outcome]||'#8b949e' }}>
                        {L2(log.outcome || '-', OUTCOME_ZH[log.outcome] || log.outcome || '-')}
                      </span>
                    </td>
                    <td style={{ ...s.td, fontSize:11, color: log.wa_number_used ? '#25d366' : 'var(--muted)', fontWeight: log.wa_number_used ? 600 : 400 }}>
                      {log.wa_number_used || '—'}
                    </td>
                    <td style={{ ...s.td, fontSize:12, color: log.bonus_offered > 0 ? '#ffd700' : 'var(--muted)' }}>
                      {log.bonus_offered > 0 ? formatMoney(log.bonus_offered, log.vip_members?.currency) : '-'}
                    </td>
                    <td style={{ ...s.td, maxWidth:300, fontSize:12, color:'var(--text)' }} onClick={e => e.stopPropagation()}>
                      {isEditingThis ? (
                        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                          <div style={{ display:'flex', gap:5, alignItems:'center', flexWrap:'wrap' }}>
                            <select value={editingOutcome} onChange={e => setEditingOutcome(e.target.value)}
                              style={{ background:'var(--surface2)', border:'1px solid var(--border)', color: OUTCOME_COLOR[editingOutcome]||'var(--text)', padding:'4px 8px', borderRadius:6, fontSize:12, outline:'none', fontWeight:700, minWidth:110 }}>
                              {CONTACT_OUTCOMES.map(o => <option key={o} value={o}>{L2(o, OUTCOME_ZH[o])}</option>)}
                            </select>
                            <select value={editingWaNumber} onChange={e => setEditingWaNumber(e.target.value)}
                              style={{ background:'var(--surface2)', border:'1px solid rgba(37,211,102,.4)', color: editingWaNumber ? '#25d366' : 'var(--muted)', padding:'4px 8px', borderRadius:6, fontSize:12, outline:'none', minWidth:140 }}>
                              <option value="">{L2('📱 WA # (none)', '📱 WA号码（无）')}</option>
                              {allWaNumbers.map(n => <option key={n.id} value={n.codename}>{n.codename} — {n.number}{n.telco?' ('+n.telco+')':''}</option>)}
                            </select>
                            <input autoFocus style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'4px 8px', borderRadius:6, fontSize:12, outline:'none', minWidth:0 }}
                              value={editingNote} onChange={e => setEditingNote(e.target.value)}
                              onKeyDown={e => { if(e.key==='Enter') saveEdit(log.id); if(e.key==='Escape') setEditingLogId(null) }}
                              placeholder={L2('Notes...', '备注…')} />
                          </div>
                          <div style={{ display:'flex', gap:5 }}>
                            <button onClick={() => saveEdit(log.id)} style={{ background:'var(--accent)', color:'#fff', border:'none', padding:'3px 12px', borderRadius:5, fontSize:11, cursor:'pointer', fontWeight:700 }}>{L2('Save', '保存')}</button>
                            <button onClick={() => setEditingLogId(null)} style={{ background:'none', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>{L2('✕ Cancel', '✕ 取消')}</button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor: log.notes ? 'pointer' : 'default' }}
                          title={log.notes ? L2('Click to expand', '点击展开') : undefined}
                          onClick={log.notes ? () => setNotePopup({ username: log.username, notes: log.notes }) : undefined}
                        >{log.notes || '-'}</div>
                      )}
                    </td>
                    <td style={{ ...s.td, fontSize:12, color:log.host_name===myName?'var(--accent)':'var(--muted)', fontWeight:log.host_name===myName?600:400 }}>
                      {log.host_name===myName ? L2('Me', '我') : log.host_name}
                    </td>
                    <td style={{ ...s.td, fontSize:11, color:'var(--muted)', whiteSpace:'nowrap' }}>{timeAgo(log.logged_at, lang)}</td>
                    <td style={{ ...s.td, fontSize:11 }} onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4 }}>
                        <button onClick={() => { setEditingLogId(log.id); setEditingNote(log.notes||''); setEditingOutcome(log.outcome||'Contacted'); setEditingWaNumber(log.wa_number_used||'') }}
                          style={{ background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.4)', color:'#a5b4fc', padding:'2px 8px', borderRadius:5, fontSize:11, cursor:'pointer', fontWeight:600 }}>{L2('✏ Edit', '✏ 编辑')}</button>
                        <button onClick={() => deleteLog(log.id)}
                          style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>{L2('Del', '删除')}</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', borderTop:'1px solid var(--border)' }}>
            <button style={s.pgBtn} disabled={page===0} onClick={()=>setPage(0)}>«</button>
            <button style={s.pgBtn} disabled={page===0} onClick={()=>setPage(p=>p-1)}>‹</button>
            {Array.from({ length:Math.min(5,totalPages) }, (_,i) => {
              const pg = Math.min(Math.max(page-2,0)+i, totalPages-1)
              return <button key={pg} style={{ ...s.pgBtn, background:pg===page?'var(--accent)':'var(--surface)', color:pg===page?'#fff':'var(--text)' }} onClick={()=>setPage(pg)}>{pg+1}</button>
            })}
            <button style={s.pgBtn} disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}>›</button>
            <button style={s.pgBtn} disabled={page>=totalPages-1} onClick={()=>setPage(totalPages-1)}>»</button>
            <span style={{ fontSize:12, color:'var(--muted)', marginLeft:8 }}>{page*PAGE_SIZE+1}-{Math.min((page+1)*PAGE_SIZE,total)} {L2('of', '/')} {total}</span>
          </div>
        )}
      </div>

      {/* Notes popup modal */}
      {notePopup && (
        <div
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={() => setNotePopup(null)}
        >
          <div
            style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'24px 28px', maxWidth:560, width:'100%', boxShadow:'0 16px 48px rgba(0,0,0,.5)', position:'relative' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--accent)' }}>{notePopup.username} — {L2('Note', '备注')}</div>
              <button onClick={() => setNotePopup(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:18, cursor:'pointer', lineHeight:1 }}>✕</button>
            </div>
            <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.6, whiteSpace:'pre-wrap', wordBreak:'break-word', maxHeight:'60vh', overflowY:'auto' }}>{notePopup.notes}</div>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:18, paddingTop:14, borderTop:'1px solid var(--border)', flexWrap:'wrap' }}>
              <button onClick={() => copyText(notePopup.notes, L2('Note copied ✓', '备注已复制 ✓'))}
                style={{ background:'var(--brand, #FF6B00)', color:'#fff', border:'none', borderRadius:6, padding:'7px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                {L2('📋 Copy this note', '📋 复制此备注')}
              </button>
              <button onClick={() => copyVipHistory(notePopup.username)}
                style={{ background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, padding:'7px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                {L2(`📋 Copy all notes for ${notePopup.username}`, `📋 复制 ${notePopup.username} 的全部备注`)}
              </button>
              {copyMsg && <span style={{ fontSize:12, color:'#34d399', fontWeight:600 }}>{copyMsg}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
