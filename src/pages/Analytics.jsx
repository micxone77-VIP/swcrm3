// Analytics.jsx — VIP活跃度 + Top10充值排行 + Top10常问问题
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, MONTHS } from '../lib/constants'
import { formatMoney, currentYearMonth as currentYM, prevYearMonth as prevYM, fmtMonthLabel as fmtMonth } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamBool } from '../hooks/useUrlParam'

// ── Helpers ───────────────────────────────────────────────────────────────────
// fmt() is defined inside the component so it can use the selected currency state

// 活跃度分计算 (0-100)
function calcActivityScore(daysInactive, monthlyValidBet) {
  const di   = parseFloat(daysInactive) || 0
  const mvb  = parseFloat(monthlyValidBet) || 0
  // Days inactive score (0-50): 0 days = 50, 30 days = 25, 60+ days = 0
  const diScore  = Math.max(0, 50 - (di / 60 * 50))
  // Valid bet score (0-50): RM 2M+ = 50, RM 0 = 0
  const mvbScore = Math.min(50, (mvb / 2000000) * 50)
  return Math.round(diScore + mvbScore)
}

function scoreColor(score) {
  if (score >= 70) return '#3fb950'
  if (score >= 40) return '#d29922'
  return '#f85149'
}
function scoreLabel(score, t) {
  if (score >= 70) return `🟢 ${t('common.active')}`
  if (score >= 40) return `🟡 ${t('common.normal')}`
  return `🔴 ${t('common.dormant')}`
}

// These are stored as literal values in contact_issue_tags.issue_tag (and matched
// against keywordMap below for auto-detection) — they're categorical DATA, not just
// display text, so they intentionally stay in Chinese regardless of the language
// toggle. Translating them would silently break matching against existing tagged
// history and the auto-keyword detection. Only the surrounding UI chrome (buttons,
// headers, etc.) is translated.
const ISSUE_TAGS = [
  '出款问题', '入款问题', '活动查询', '账号问题', '优惠查询',
  '技术问题', '游戏问题', '升级查询', '礼品兑换', '其他',
]

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page:    { padding:'24px 28px', minHeight:'100vh', color:'var(--text)' },
  title:   { fontSize:22, fontWeight:700 },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:24 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, marginBottom:16 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 },
  cardBdy: { padding:'18px 20px' },
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:      { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  sel:     { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'6px 10px', borderRadius:7, fontSize:12, outline:'none' },
  tag:     (c) => ({ display:'inline-block', padding:'2px 9px', borderRadius:6, fontSize:11, fontWeight:600, background:c+'22', color:c }),
  badge:   (tier) => ({ display:'inline-block', padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:700, background:TIER_BG[tier]||'var(--surface2)', color:TIER_COLOR[tier]||'var(--text)' }),
  bar:     (pct, color) => ({ height:8, borderRadius:4, width:`${Math.min(100,pct)}%`, background:color, transition:'width .4s', minWidth: pct>0?4:0 }),
  barWrap: { height:8, background:'var(--surface2)', borderRadius:4, overflow:'hidden', flex:1, minWidth:60 },
  rankNum: (n) => ({ width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, flexShrink:0,
    background: n===1?'#ffd700':n===2?'#C0C0C0':n===3?'#cd7f32':'var(--surface2)',
    color: n<=3?'#000':'var(--muted)' }),
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Analytics() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const myName = profile?.full_name || 'VIP Team'
  const [month,     setMonth]     = useUrlParam('month', currentYM())
  const [tab,       setTab]       = useUrlParam('tab', 'leaderboard') // leaderboard | activity | issues | decline
  const [platform,  setPlatform]  = useUrlParam('platform', 'ALL') // ALL | MY | SG
  const [currency,  setCurrency]  = useUrlParam('currency', 'MYR') // MYR | SGD | KHUSD
  const [loading,   setLoading]   = useState(true)

  // fmt uses selected currency so leaderboard amounts match the chosen region
  const fmt = (n) => formatMoney(n, currency)

  // Leaderboard data
  const [top10Dep,  setTop10Dep]  = useState([])

  // Deposit Decline data
  const [declineList, setDeclineList] = useState([])
  const [declineTierF, setDeclineTierF] = useUrlParam('declineTier', 'ALL')
  const [declineThreshold, setDeclineThreshold] = useUrlParam('declineThreshold', '30')
  const [declineMinLastMonth, setDeclineMinLastMonth] = useUrlParam('declineMin', '300')

  // Activity data
  const [activity,  setActivity]  = useState([])
  const [actSearch,    setActSearch]    = useUrlParam('actSearch', '')
  const [actTier,      setActTier]      = useUrlParam('actTier', 'ALL')
  const [actPlatform,  setActPlatform]  = useUrlParam('actPlatform', 'ALL')

  // Issues data
  const [issues,       setIssues]       = useState([])
  const [logs,         setLogs]         = useState([])
  const [taggedLogIds, setTaggedLogIds] = useState(new Set())
  const [showTagged,   setShowTagged]   = useUrlParamBool('showTagged', false)
  const [tagModal,     setTagModal]     = useState(null)
  const [selectedTag,  setSelectedTag]  = useState('')
  const [savingTag,    setSavingTag]    = useState(false)
  const [customTags,   setCustomTags]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('swcrm_custom_tags') || '[]') } catch { return [] }
  })
  const [customInput,  setCustomInput]  = useState('')
  const [manageModal,  setManageModal]  = useState(false)
  const [manageInput,  setManageInput]  = useState('')

  const allTags = [...ISSUE_TAGS, ...customTags]

  const saveCustomTags = (tags) => {
    setCustomTags(tags)
    localStorage.setItem('swcrm_custom_tags', JSON.stringify(tags))
  }
  const addCustomTag = (name) => {
    const t = name.trim()
    if (!t || allTags.includes(t)) return
    saveCustomTags([...customTags, t])
  }
  const removeCustomTag = (name) => {
    saveCustomTags(customTags.filter(t => t !== name))
  }

  const prev = prevYM(month)

  useEffect(() => { loadAll() }, [month])
  useEffect(() => { loadDecline() }, [month, declineTierF, declineThreshold, declineMinLastMonth, platform])

  async function loadDecline() {
    const [y, mo] = month.split('-').map(Number)
    const [py, pmo] = prev.split('-').map(Number)
    const daysInPrevMonth = new Date(py, pmo, 0).getDate()
    const now = new Date()
    const isCurrentMonth = month === currentYM()
    // Days "elapsed" this month — if viewing a past completed month, that's
    // the whole month; if viewing the current month, it's however far we are.
    const daysElapsed = isCurrentMonth ? now.getDate() : new Date(y, mo, 0).getDate()
    const prorationFactor = daysElapsed / daysInPrevMonth

    const [{ data: curTotals }, { data: prevTotals }] = await Promise.all([
      supabase.from('vip_monthly_totals').select('username, tier, currency, total_deposit').eq('snapshot_month', month),
      supabase.from('vip_monthly_totals').select('username, total_deposit').eq('snapshot_month', prev),
    ])
    if (!prevTotals || prevTotals.length === 0) { setDeclineList([]); return }

    const { data: extras } = await supabase.from('vip_members')
      .select('username, is_excluded, whatsapp, phone, host_assigned')
    const extraMap = {}
    ;(extras || []).forEach(e => { extraMap[e.username] = e })

    const curMap = {}
    ;(curTotals || []).forEach(t => { curMap[t.username] = t })

    const minLastMonth = parseFloat(declineMinLastMonth) || 0
    const thresholdPct = parseFloat(declineThreshold) || 0

    const rows = prevTotals
      .map(p => {
        const lastMonthDep = parseFloat(p.total_deposit) || 0
        const cur = curMap[p.username]
        const thisMonthDep = cur ? parseFloat(cur.total_deposit) || 0 : 0
        const expected = lastMonthDep * prorationFactor
        const declinePct = expected > 0 ? Math.round((thisMonthDep - expected) / expected * 100) : null
        const extra = extraMap[p.username] || {}
        return {
          username: p.username,
          tier: cur?.tier || null,
          currency: cur?.currency || 'MYR',
          lastMonthDep, thisMonthDep, expected, declinePct,
          whatsapp: extra.whatsapp, phone: extra.phone, hostAssigned: extra.host_assigned,
          isExcluded: extra.is_excluded,
        }
      })
      .filter(r => !r.isExcluded)
      .filter(r => r.lastMonthDep >= minLastMonth)
      .filter(r => r.declinePct !== null && r.declinePct <= -thresholdPct)
      .filter(r => declineTierF === 'ALL' || r.tier === declineTierF)
      .filter(r => platform === 'ALL' || (platform === 'MY' && r.currency === 'MYR') || (platform === 'SG' && r.currency === 'SGD'))
      .sort((a, b) => a.declinePct - b.declinePct) // most negative (biggest drop) first

    setDeclineList(rows)
  }

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadLeaderboard(), loadActivity(), loadIssues()])
    setLoading(false)
  }

  // ── Top 10 充值排行 (15天内活跃) ──────────────────────────────────────────
  async function loadLeaderboard() {
    const { data: totals } = await supabase
      .from('vip_monthly_totals')
      .select('username, tier, total_deposit, monthly_valid_bet, currency')
      .eq('snapshot_month', month)
      .order('total_deposit', { ascending: false })
      .limit(50) // pull extra since we'll filter by days_inactive client-side

    if (!totals || totals.length === 0) { setTop10Dep([]); return }

    const usernames = totals.map(t => t.username)
    const { data: extras } = await supabase
      .from('vip_members')
      .select('username, days_inactive, host_assigned, region, is_excluded')
      .in('username', usernames)
    const extraMap = {}
    ;(extras || []).forEach(e => { extraMap[e.username] = e })

    const merged = totals
      .map(t => ({ ...t, ...extraMap[t.username] }))
      .filter(v => !v.is_excluded && (v.days_inactive ?? 999) <= 15)
      .sort((a, b) => (b.total_deposit||0) - (a.total_deposit||0))
      .slice(0, 10)

    setTop10Dep(merged)
  }

  // ── 活跃度对比 (本月 vs 上月) ─────────────────────────────────────────────
  async function loadActivity() {
    const [{ data: currTotals }, { data: prevTotals }, { data: allMembers }] = await Promise.all([
      supabase.from('vip_monthly_totals').select('username, tier, monthly_valid_bet, currency').eq('snapshot_month', month).in('tier', ['DIAMOND','PLATINUM','GOLD','BLACK']),
      supabase.from('vip_monthly_totals').select('username, monthly_valid_bet').eq('snapshot_month', prev),
      // Fetch unrestricted by current tier — a player's historical tier for the selected month
      // may differ from their tier today, so scoping this by current tier could wrongly
      // exclude someone who was DIAMOND/PLATINUM/GOLD back then but isn't anymore (or vice versa).
      supabase.from('vip_members').select('username, days_inactive, host_assigned, region, is_excluded'),
    ])
    const prevMap = {}
    ;(prevTotals||[]).forEach(v => { prevMap[v.username] = v })
    const extraMap = {}
    const excludedSet = new Set()
    ;(allMembers||[]).forEach(e => {
      extraMap[e.username] = e
      if (e.is_excluded) excludedSet.add(e.username)
    })

    const withScores = (currTotals||[])
      .filter(v => !excludedSet.has(v.username)) // exclude flagged accounts regardless of their tier
      .map(v => {
        const extra     = extraMap[v.username] || {}
        const score     = calcActivityScore(extra.days_inactive, v.monthly_valid_bet)
        const prevRec   = prevMap[v.username]
        const prevScore = prevRec ? calcActivityScore(extra.days_inactive, prevRec.monthly_valid_bet) : null
        const change    = prevScore !== null ? score - prevScore : null
        // extra spread FIRST, v spread SECOND — so v.tier (this month's real historical tier
        // from vip_monthly_totals) always wins. Previously this was reversed, so extra.tier
        // (today's current tier) silently overwrote the correct historical value.
        return { ...extra, ...v, score, prevScore, change }
      }).sort((a,b) => b.score - a.score)

    setActivity(withScores)
  }

  // ── Top 10 常问问题 ────────────────────────────────────────────────────────
  async function loadIssues() {
    // Load tagged issues
    const { data: tagged } = await supabase
      .from('contact_issue_tags')
      .select('log_id, issue_tag, username, created_at')
      .gte('created_at', `${month}-01`)

    // Count by tag
    const counts = {}
    ;(tagged||[]).forEach(t => {
      counts[t.issue_tag] = (counts[t.issue_tag]||0) + 1
    })

    // Auto-extract from contact logs notes
    const { data: logData } = await supabase
      .from('contact_logs')
      .select('id, username, notes, tier, host_name, logged_at')
      .eq('log_month', month)
      .order('logged_at', { ascending: false })
      .limit(200)
    setLogs(logData || [])

    // Track which log IDs have already been tagged — merge with existing to avoid losing just-tagged IDs
    const taggedIds = new Set((tagged||[]).map(t => t.log_id).filter(Boolean))
    setTaggedLogIds(prev => {
      const merged = new Set([...prev, ...taggedIds])
      return merged
    })

    // Auto-keyword detection from notes
    const keywordMap = {
      '出款问题':  ['withdraw','出款','提款','withdrawal','wd'],
      '入款问题':  ['deposit','入款','充值','dep','存款'],
      '活动查询':  ['campaign','活动','promotion','promo','bonus'],
      '账号问题':  ['account','账号','login','密码','password','block'],
      '优惠查询':  ['rebate','返水','cashback','优惠','reward'],
      '技术问题':  ['technical','bug','error','lag','crash','技术'],
      '游戏问题':  ['game','游戏','slot','fish','live'],
      '升级查询':  ['upgrade','升级','tier','tier up'],
      '礼品兑换':  ['gift','礼品','gold bar','voucher','red packet','angpow','ang pao'],
    }
    const autoCounts = { ...counts }
    ;(logData||[]).forEach(log => {
      if (!log.notes) return
      const notes = log.notes.toLowerCase()
      Object.entries(keywordMap).forEach(([tag, keywords]) => {
        if (keywords.some(kw => notes.includes(kw))) {
          autoCounts[tag] = (autoCounts[tag]||0) + 1
        }
      })
    })

    const sorted = Object.entries(autoCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 10)
    setIssues(sorted)
  }

  // ── Save issue tag ─────────────────────────────────────────────────────────
  async function saveTag() {
    if (!selectedTag || !tagModal) return
    setSavingTag(true)
    const logId = tagModal.id
    const { error } = await supabase.from('contact_issue_tags').insert({
      log_id:    logId,
      username:  tagModal.username,
      issue_tag: selectedTag,
    })
    setSavingTag(false)
    // Close modal immediately
    setTagModal(null)
    setSelectedTag('')
    setCustomInput('')
    if (!error) {
      // Immediately move to tagged section in UI
      setTaggedLogIds(prev => new Set([...prev, logId]))
      // Then reload in background to sync Top 10 counts
      await loadIssues()
    }
  }

  // ── Filtered activity ──────────────────────────────────────────────────────
  const filteredActivity = activity.filter(v => {
    if (actTier !== 'ALL' && v.tier !== actTier) return false
    if (actSearch && !v.username.toLowerCase().includes(actSearch.toLowerCase())) return false
    if (actPlatform === 'MY') { if (v.region === 'Singapore' || v.currency === 'SGD') return false }
    if (actPlatform === 'SG') { if (v.region !== 'Singapore' && v.currency !== 'SGD') return false }
    return true
  })

  const maxDep = top10Dep[0]?.total_deposit || 1

  return (
    <div style={s.page}>
      <div style={s.title}>📊 {t('analytics.pageTitle')}</div>
      <div style={s.sub}>{t('analytics.pageSubtitle')}</div>

      {/* Month selector */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <span style={{ fontSize:13, color:'var(--muted)' }}>{t('analytics.dataMonth')}</span>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{ ...s.sel, fontSize:13 }} />
        <span style={{ fontSize:12, color:'var(--muted)' }}>{t('analytics.vsLastMonth', { month: fmtMonth(prev) })}</span>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'1px solid var(--border)', paddingBottom:0 }}>
        {[
          ['leaderboard', t('analytics.tabLeaderboard')],
          ['activity',    t('analytics.tabActivity')],
          ['issues',      t('analytics.tabIssues')],
          ['decline',     '📉 ' + t('analytics.tabDecline')],
        ].map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)} style={{
            padding:'9px 20px', borderRadius:'8px 8px 0 0',
            border:'1px solid var(--border)', borderBottom: tab===id?'1px solid var(--surface)':'1px solid var(--border)',
            background: tab===id?'var(--surface)':'transparent',
            color: tab===id?'var(--text)':'var(--muted)',
            fontWeight: tab===id?700:400, fontSize:13, cursor:'pointer', marginBottom:-1,
          }}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>{t('common.loading')}</div>
      ) : (
        <>
          {/* ── TOP 10 充值排行 ── */}
          {tab === 'leaderboard' && (
            <div style={s.card}>
              <div style={s.cardHdr}>
                <div>
                  <div style={{ fontSize:15, fontWeight:700 }}>{t('analytics.leaderboardTitle')}</div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                    {t('analytics.leaderboardSubtitle', { month: fmtMonth(month) })}
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  {/* Currency selector — changes fmt() display and filters VIPs to matching currency */}
                  <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    {[['MYR','🇲🇾 MYR'],['SGD','🇸🇬 SGD'],['KHUSD','🇰🇭 KHUSD']].map(([v,l]) => (
                      <button key={v} onClick={()=>setCurrency(v)} style={{ background:currency===v?'var(--accent)':'transparent', color:currency===v?'#fff':'var(--muted)', border:'none', padding:'5px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>{l}</button>
                    ))}
                  </div>
                  <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    {[['ALL',t('common.all')],['MY','🇲🇾 MY'],['SG','🇸🇬 SG']].map(([v,l]) => (
                      <button key={v} onClick={()=>setPlatform(v)} style={{ background:platform===v?'var(--accent)':'transparent', color:platform===v?'#fff':'var(--muted)', border:'none', padding:'5px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              {(() => {
                const lb = top10Dep.filter(v => {
                  // Currency filter: when a specific currency is selected, show only matching VIPs
                  if (currency === 'MYR' && v.currency && v.currency !== 'MYR') return false
                  if (currency === 'SGD' && v.currency !== 'SGD') return false
                  if (currency === 'KHUSD' && v.currency !== 'KHUSD') return false
                  if (platform === 'MY') return !v.region || v.region === 'Malaysia' || v.currency === 'MYR'
                  if (platform === 'SG') return v.region === 'Singapore' || v.currency === 'SGD'
                  return true
                }).slice(0, 10)
                const maxD = lb[0]?.total_deposit || 1
                if (lb.length === 0) return (
                  <div style={{ padding:40, textAlign:'center', color:'var(--muted)' }}>
                    {t('analytics.noActiveLeaderboardData')}<br />
                    <span style={{ fontSize:12 }}>{t('analytics.ensureCsvUploaded', { month: fmtMonth(month) })}</span>
                  </div>
                )
                return (
                  <div style={{ padding:'8px 0' }}>
                    {lb.map((v, i) => (
                      <div key={v.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 20px',
                        borderBottom: i<lb.length-1?'1px solid var(--border)':'none',
                        background: i===0?'rgba(255,215,0,.04)':i===1?'rgba(192,192,192,.04)':i===2?'rgba(205,127,50,.04)':'transparent' }}>
                        <div style={s.rankNum(i+1)}>{i+1}</div>
                        <div style={{ minWidth:130 }}>
                          <div style={{ fontWeight:700, fontSize:14 }}>{v.username}</div>
                          <div style={{ display:'flex', gap:6, marginTop:3, flexWrap:'wrap' }}>
                            <span style={s.badge(v.tier)}>{v.tier}</span>
                            <span style={{ fontSize:11, color:'var(--muted)' }}>{v.host_assigned||'—'}</span>
                            {(v.region==='Singapore'||v.currency==='SGD') && <span style={{ fontSize:10, fontWeight:700, color:'#f59e0b', background:'rgba(245,158,11,.15)', padding:'1px 6px', borderRadius:4 }}>🇸🇬 SG</span>}
                            {(!v.region||v.region==='Malaysia'||v.currency==='MYR') && v.currency!=='SGD' && v.region!=='Singapore' && <span style={{ fontSize:10, fontWeight:700, color:'#3fb950', background:'rgba(63,185,80,.15)', padding:'1px 6px', borderRadius:4 }}>🇲🇾 MY</span>}
                          </div>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                            <div style={s.barWrap}>
                              <div style={s.bar((v.total_deposit/maxD)*100, i===0?'#ffd700':i===1?'#C0C0C0':i===2?'#cd7f32':'var(--accent)')} />
                            </div>
                          </div>
                          <div style={{ display:'flex', gap:16, fontSize:12 }}>
                            <span>{t('analytics.totalDepositColon')} <strong style={{ color:'#3fb950' }}>{formatMoney(v.total_deposit, v.currency)}</strong></span>
                            <span>{t('analytics.monthlyTurnoverColon')} <strong style={{ color:'var(--accent)' }}>{formatMoney(v.monthly_valid_bet, v.currency)}</strong></span>
                            <span style={{ color:(v.days_inactive||0)<0?'#8b949e':(v.days_inactive||0)<=7?'#3fb950':'#d29922' }}>
                              {(v.days_inactive||0)<0?t('analytics.dateError'):v.days_inactive===0?t('analytics.activeToday'):t('analytics.activeDaysAgo',{n:v.days_inactive})}
                            </span>
                          </div>
                        </div>
                        {i===0 && <span style={{ fontSize:24 }}>🥇</span>}
                        {i===1 && <span style={{ fontSize:24 }}>🥈</span>}
                        {i===2 && <span style={{ fontSize:24 }}>🥉</span>}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

                    {/* ── VIP 活跃度 ── */}
          {tab === 'activity' && (
            <div style={s.card}>
              <div style={s.cardHdr}>
                <div>
                  <div style={{ fontSize:15, fontWeight:700 }}>{t('analytics.activityTitle')}</div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                    {t('analytics.activitySubtitle', { month: fmtMonth(month), prev: fmtMonth(prev) })}
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    {[['ALL',t('common.all')],['MY','🇲🇾 MY'],['SG','🇸🇬 SG']].map(([v,l]) => (
                      <button key={v} onClick={()=>setActPlatform(v)} style={{ background:actPlatform===v?'var(--accent)':'transparent', color:actPlatform===v?'#fff':'var(--muted)', border:'none', padding:'5px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>{l}</button>
                    ))}
                  </div>
                  <input style={{ ...s.sel, width:140 }} placeholder={t('analytics.searchUsername')} value={actSearch} onChange={e=>setActSearch(e.target.value)} />
                  <select style={s.sel} value={actTier} onChange={e=>setActTier(e.target.value)}>
                    <option value="ALL">{t('analytics.allTiers')}</option>
                    {['DIAMOND','PLATINUM','GOLD','BLACK'].map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Summary stats */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10, padding:'14px 20px', borderBottom:'1px solid var(--border)' }}>
                {[
                  { label:t('analytics.statActive'),   val: activity.filter(v=>v.score>=70).length,  color:'#3fb950' },
                  { label:t('analytics.statNormal'),  val: activity.filter(v=>v.score>=40&&v.score<70).length, color:'#d29922' },
                  { label:t('analytics.statDormant'),    val: activity.filter(v=>v.score<40).length,   color:'#f85149' },
                  { label:t('analytics.statUpThisMonth'),        val: activity.filter(v=>v.change!==null&&v.change>0).length, color:'#3fb950' },
                  { label:t('analytics.statDownThisMonth'),        val: activity.filter(v=>v.change!==null&&v.change<0).length, color:'#f85149' },
                ].map((st,i) => (
                  <div key={i} style={{ textAlign:'center' }}>
                    <div style={{ fontSize:22, fontWeight:800, color:st.color }}>{st.val}</div>
                    <div style={{ fontSize:11, color:'var(--muted)' }}>{st.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ overflowX:'auto' }}>
                <table style={s.tbl}>
                  <thead><tr>
                    <th style={s.th}>{t('common.username')}</th>
                    <th style={s.th}>{t('common.tier')}</th>
                    <th style={s.th}>{t('analytics.colActivityScore', { month: fmtMonth(month) })}</th>
                    <th style={s.th}>{t('tierAnalytics.vs')} {fmtMonth(prev)}</th>
                    <th style={s.th}>{t('analytics.colChange')}</th>
                    <th style={s.th}>{t('common.status')}</th>
                    <th style={s.th}>{t('common.daysInactive')}</th>
                    <th style={s.th}>{t('analytics.colMonthlyTurnover')}</th>
                    <th style={s.th}>{t('common.host')}</th>
                  </tr></thead>
                  <tbody>
                    {filteredActivity.length === 0 ? (
                      <tr><td colSpan={9} style={{ ...s.td, textAlign:'center', padding:32, color:'var(--muted)' }}>{t('analytics.noMatchingVips')}</td></tr>
                    ) : filteredActivity.slice(0, 100).map((v,i) => (
                      <tr key={v.username}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <td style={{ ...s.td, fontWeight:600 }}>{v.username}</td>
                        <td style={s.td}><span style={s.badge(v.tier)}>{v.tier}</span></td>
                        <td style={s.td}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={s.barWrap}><div style={s.bar(v.score, scoreColor(v.score))} /></div>
                            <span style={{ fontWeight:700, color:scoreColor(v.score), minWidth:28 }}>{v.score}</span>
                          </div>
                        </td>
                        <td style={{ ...s.td, color:'var(--muted)', fontSize:12 }}>
                          {v.prevScore !== null ? v.prevScore : '—'}
                        </td>
                        <td style={s.td}>
                          {v.change === null ? <span style={{ color:'var(--muted)', fontSize:12 }}>{t('analytics.new')}</span>
                          : v.change > 0 ? <span style={{ color:'#3fb950', fontWeight:700 }}>▲ +{v.change}</span>
                          : v.change < 0 ? <span style={{ color:'#f85149', fontWeight:700 }}>▼ {v.change}</span>
                          : <span style={{ color:'var(--muted)' }}>{t('analytics.flat')}</span>}
                        </td>
                        <td style={s.td}><span style={s.tag(scoreColor(v.score))}>{scoreLabel(v.score, t)}</span></td>
                        <td style={{ ...s.td, color: (v.days_inactive||0)<0?'#8b949e':(v.days_inactive||0)>=60?'#f85149':(v.days_inactive||0)>=30?'#d29922':'#3fb950', fontWeight:600 }}>
                          {v.days_inactive !== null ? (v.days_inactive<0?t('analytics.dateError'):v.days_inactive===0?t('common.today'):t('analytics.daysAgo',{n:v.days_inactive})) : '—'}
                        </td>
                        <td style={{ ...s.td, fontSize:12 }}>{formatMoney(v.monthly_valid_bet, v.currency)}</td>
                        <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{v.host_assigned||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredActivity.length > 100 && (
                  <div style={{ padding:'10px 20px', fontSize:12, color:'var(--muted)', textAlign:'center' }}>
                    {t('analytics.showingTop100', { total: filteredActivity.length })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TOP 10 常问问题 ── */}
          {tab === 'issues' && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                {/* Left: Top 10 chart */}
                <div style={s.card}>
                  <div style={s.cardHdr}>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700 }}>{t('analytics.issuesTitle')}</div>
                      <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{t('analytics.issuesSubtitle', { month: fmtMonth(month) })}</div>
                    </div>
                  </div>
                  <div style={{ padding:'8px 0' }}>
                    {issues.length === 0 ? (
                      <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>{t('analytics.noIssueData')}</div>
                    ) : issues.map((iss, i) => {
                      const maxCount = issues[0]?.count || 1
                      return (
                        <div key={iss.tag} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 20px',
                          borderBottom: i<issues.length-1?'1px solid var(--border)':'none' }}>
                          <div style={s.rankNum(i+1)}>{i+1}</div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>{iss.tag}</div>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <div style={s.barWrap}>
                                <div style={s.bar((iss.count/maxCount)*100, 'var(--accent)')} />
                              </div>
                              <span style={{ fontSize:12, fontWeight:700, color:'var(--accent)', minWidth:30 }}>{iss.count}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Right: Tag logs manually */}
                <div style={s.card}>
                  <div style={s.cardHdr}>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700 }}>{t('analytics.manualTagTitle')}</div>
                      <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{t('analytics.manualTagSubtitle')}</div>
                    </div>
                    <div style={{ fontSize:11, color:'var(--muted)' }}>
                      {t('analytics.pending')} <span style={{ color:'var(--accent)', fontWeight:700 }}>{logs.filter(l => !taggedLogIds.has(l.id)).length}</span>
                      {' · '}{t('analytics.completed')} <span style={{ color:'#3fb950', fontWeight:700 }}>{taggedLogIds.size}</span>
                    </div>
                  </div>
                  <div style={{ maxHeight:520, overflowY:'auto' }}>
                    {logs.length === 0 ? (
                      <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>{t('analytics.noContactLogsThisMonth')}</div>
                    ) : (
                      <>
                        {/* ── 未标记 ── */}
                        {logs.filter(l => !taggedLogIds.has(l.id)).length === 0 ? (
                          <div style={{ padding:'16px 20px', fontSize:12, color:'#3fb950', textAlign:'center' }}>
                            {t('analytics.allTaggedDone')}
                          </div>
                        ) : (
                          logs.filter(l => !taggedLogIds.has(l.id)).slice(0, 50).map(log => (
                            <div key={log.id} style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', gap:10 }}>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:12, fontWeight:700 }}>{log.username} <span style={{ color:'var(--muted)', fontWeight:400 }}>· {log.tier||'—'}</span></div>
                                <div style={{ fontSize:11, color:'var(--muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:220 }}>{log.notes||'—'}</div>
                              </div>
                              <button
                                onClick={() => { setTagModal(log); setSelectedTag('') }}
                                style={{ background:'var(--accent)', color:'#fff', border:'none', padding:'3px 10px', borderRadius:5, fontSize:11, fontWeight:600, cursor:'pointer', flexShrink:0 }}>
                                {t('analytics.tagButton')}
                              </button>
                            </div>
                          ))
                        )}

                        {/* ── 已标记折叠区 ── */}
                        {taggedLogIds.size > 0 && (
                          <div>
                            <button
                              onClick={() => setShowTagged(v => !v)}
                              style={{ width:'100%', padding:'10px 16px', background:'var(--surface2)', border:'none', borderTop:'1px solid var(--border)', color:'var(--muted)', fontSize:12, cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ color:'#3fb950', fontWeight:700 }}>{t('analytics.taggedCount', { n: taggedLogIds.size })}</span>
                              <span style={{ marginLeft:'auto' }}>{showTagged ? t('analytics.collapse') : t('analytics.expand')}</span>
                            </button>
                            {showTagged && logs.filter(l => taggedLogIds.has(l.id)).map(log => (
                              <div key={log.id} style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', gap:10, opacity:0.5 }}>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:12, fontWeight:700 }}>
                                    <span style={{ color:'#3fb950', marginRight:4 }}>✓</span>
                                    {log.username} <span style={{ color:'var(--muted)', fontWeight:400 }}>· {log.tier||'—'}</span>
                                  </div>
                                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:220 }}>{log.notes||'—'}</div>
                                </div>
                                <span style={{ fontSize:11, color:'#3fb950', flexShrink:0, fontWeight:600 }}>{t('analytics.taggedLabel')}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Tag modal */}
              {tagModal && (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
                  onClick={() => setTagModal(null)}>
                  <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'24px 28px', width:440, maxWidth:'90vw' }}
                    onClick={e=>e.stopPropagation()}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                      <div style={{ fontSize:15, fontWeight:700 }}>{t('analytics.tagModalTitle')}</div>
                      <button onClick={() => { setTagModal(null); setManageModal(true) }}
                        style={{ background:'none', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:6, fontSize:11, cursor:'pointer' }}>
                        {t('analytics.manageTagsButton')}
                      </button>
                    </div>
                    <div style={{ fontSize:12, color:'var(--muted)', marginBottom:16 }}>
                      {tagModal.username} · <span style={{ fontStyle:'italic' }}>{tagModal.notes?.slice(0,60)}...</span>
                    </div>

                    {/* Preset tags */}
                    <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:6 }}>{t('analytics.presetTags')}</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14 }}>
                      {ISSUE_TAGS.map(tag => (
                        <div key={tag} onClick={() => setSelectedTag(tag)}
                          style={{ padding:'6px 14px', borderRadius:20, cursor:'pointer', fontSize:12, fontWeight:600,
                            border:`2px solid ${selectedTag===tag?'var(--accent)':'var(--border)'}`,
                            background: selectedTag===tag?'rgba(99,102,241,.15)':'var(--surface2)',
                            color: selectedTag===tag?'var(--accent)':'var(--muted)',
                            transition:'all .15s' }}>
                          {tag}
                        </div>
                      ))}
                    </div>

                    {/* Custom tags */}
                    {customTags.length > 0 && (
                      <>
                        <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:6 }}>{t('analytics.customTagsLabel')}</div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14 }}>
                          {customTags.map(tag => (
                            <div key={tag} onClick={() => setSelectedTag(tag)}
                              style={{ padding:'6px 14px', borderRadius:20, cursor:'pointer', fontSize:12, fontWeight:600,
                                border:`2px solid ${selectedTag===tag?'#3fb950':'var(--border)'}`,
                                background: selectedTag===tag?'rgba(63,185,80,.15)':'var(--surface2)',
                                color: selectedTag===tag?'#3fb950':'var(--muted)',
                                transition:'all .15s' }}>
                              {tag}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Quick add custom tag */}
                    <div style={{ display:'flex', gap:6, marginBottom:18, borderTop:'1px solid var(--border)', paddingTop:12 }}>
                      <input
                        value={customInput} onChange={e => setCustomInput(e.target.value)}
                        onKeyDown={e => { if(e.key==='Enter' && customInput.trim()) { addCustomTag(customInput); setSelectedTag(customInput.trim()); setCustomInput('') }}}
                        placeholder={t('analytics.addCustomTagPlaceholder')}
                        style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'6px 10px', borderRadius:7, fontSize:12, outline:'none' }} />
                      <button
                        onClick={() => { if(customInput.trim()){ addCustomTag(customInput); setSelectedTag(customInput.trim()); setCustomInput('') }}}
                        style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'6px 12px', borderRadius:7, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                        {t('analytics.addAndSelect')}
                      </button>
                    </div>

                    <div style={{ display:'flex', gap:8 }}>
                      <button
                        style={{ background: selectedTag?'var(--accent)':'var(--border)', color: selectedTag?'#fff':'var(--muted)', border:'none', padding:'8px 20px', borderRadius:7, fontWeight:700, fontSize:13, cursor: selectedTag?'pointer':'not-allowed' }}
                        onClick={saveTag} disabled={!selectedTag||savingTag}>
                        {savingTag?t('common.saving'):t('analytics.confirmTag')}
                      </button>
                      <button style={{ background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'8px 16px', borderRadius:7, fontSize:13, cursor:'pointer' }}
                        onClick={() => setTagModal(null)}>{t('common.cancel')}</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Manage tags modal */}
              {manageModal && (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
                  onClick={() => setManageModal(false)}>
                  <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'24px 28px', width:420, maxWidth:'90vw' }}
                    onClick={e=>e.stopPropagation()}>
                    <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{t('analytics.manageTagsTitle')}</div>
                    <div style={{ fontSize:12, color:'var(--muted)', marginBottom:16 }}>{t('analytics.manageTagsSubtitle')}</div>

                    {/* Preset tags (read-only) */}
                    <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:8 }}>{t('analytics.presetTagsBuiltIn')}</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:16 }}>
                      {ISSUE_TAGS.map(tag => (
                        <span key={tag} style={{ padding:'4px 12px', borderRadius:16, fontSize:11, fontWeight:600, background:'var(--surface2)', color:'var(--muted)', border:'1px solid var(--border)' }}>{tag}</span>
                      ))}
                    </div>

                    {/* Custom tags (deletable) */}
                    <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:8 }}>{t('analytics.customTagsLabel')}</div>
                    {customTags.length === 0 ? (
                      <div style={{ fontSize:12, color:'var(--muted)', marginBottom:12, fontStyle:'italic' }}>{t('analytics.noCustomTags')}</div>
                    ) : (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
                        {customTags.map(tag => (
                          <div key={tag} style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:16, fontSize:11, fontWeight:600, background:'rgba(63,185,80,.12)', color:'#3fb950', border:'1px solid rgba(63,185,80,.3)' }}>
                            {tag}
                            <span onClick={() => removeCustomTag(tag)}
                              style={{ cursor:'pointer', color:'#f85149', fontWeight:800, fontSize:13, lineHeight:1, marginLeft:2 }}>×</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add new */}
                    <div style={{ display:'flex', gap:6, marginBottom:20, borderTop:'1px solid var(--border)', paddingTop:12 }}>
                      <input
                        value={manageInput} onChange={e => setManageInput(e.target.value)}
                        onKeyDown={e => { if(e.key==='Enter' && manageInput.trim()){ addCustomTag(manageInput); setManageInput('') }}}
                        placeholder={t('analytics.newTagNamePlaceholder')}
                        style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'6px 10px', borderRadius:7, fontSize:12, outline:'none' }} />
                      <button
                        onClick={() => { if(manageInput.trim()){ addCustomTag(manageInput); setManageInput('') }}}
                        style={{ background:'#3fb950', color:'#000', border:'none', padding:'6px 14px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                        {t('analytics.addButton')}
                      </button>
                    </div>

                    <button style={{ background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'8px 20px', borderRadius:7, fontSize:13, cursor:'pointer' }}
                      onClick={() => setManageModal(false)}>{t('common.close')}</button>
                  </div>
                </div>
              )}
            </>
          )}

              {tab === 'decline' && (
                <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'0 8px 8px 8px', overflow:'hidden' }}>
                  <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
                    <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                      {[['ALL',t('common.all')],['DIAMOND','DIAMOND'],['PLATINUM','PLATINUM']].map(([v,l]) => (
                        <button key={v} onClick={()=>setDeclineTierF(v)} style={{ background:declineTierF===v?'var(--accent)':'transparent', color:declineTierF===v?'#fff':'var(--muted)', border:'none', padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>{l}</button>
                      ))}
                    </div>
                    <select value={['ALL','DIAMOND','PLATINUM'].includes(declineTierF) ? '' : declineTierF} onChange={e => e.target.value && setDeclineTierF(e.target.value)}
                      style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:12, color:'var(--text)' }}>
                      <option value="">{t('analytics.moreTiers')}</option>
                      {['GOLD','SILVER','BRONZE','BLACK'].map(tierOpt => <option key={tierOpt} value={tierOpt}>{tierOpt}</option>)}
                    </select>
                    <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                      {[['ALL',t('common.all')],['MY','🇲🇾 MY'],['SG','🇸🇬 SG']].map(([v,l]) => (
                        <button key={v} onClick={()=>setPlatform(v)} style={{ background:platform===v?'var(--accent)':'transparent', color:platform===v?'#fff':'var(--muted)', border:'none', padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>{l}</button>
                      ))}
                    </div>
                    <select value={declineThreshold} onChange={e => setDeclineThreshold(e.target.value)}
                      style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:12, color:'var(--text)' }}>
                      {['20','30','50','70','90'].map(v => <option key={v} value={v}>{t('analytics.declineDropMoreThan', { pct: v })}</option>)}
                    </select>
                    <select value={declineMinLastMonth} onChange={e => setDeclineMinLastMonth(e.target.value)}
                      style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:12, color:'var(--text)' }}>
                      {['0','300','1000','5000'].map(v => <option key={v} value={v}>{t('analytics.declineMinLastMonth', { amt: v })}</option>)}
                    </select>
                    <span style={{ fontSize:12, color:'var(--muted)', marginLeft:'auto' }}>{t('analytics.declineCount', { n: declineList.length })}</span>
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                      <thead>
                        <tr style={{ borderBottom:'1px solid var(--border)' }}>
                          <th style={{ textAlign:'left', padding:'10px 16px', color:'var(--muted)', fontWeight:600 }}>{t('common.username')}</th>
                          <th style={{ textAlign:'left', padding:'10px 16px', color:'var(--muted)', fontWeight:600 }}>{t('common.tier')}</th>
                          <th style={{ textAlign:'right', padding:'10px 16px', color:'var(--muted)', fontWeight:600 }}>{t('analytics.declineLastMonth')}</th>
                          <th style={{ textAlign:'right', padding:'10px 16px', color:'var(--muted)', fontWeight:600 }}>{t('analytics.declineThisMonth')}</th>
                          <th style={{ textAlign:'right', padding:'10px 16px', color:'var(--muted)', fontWeight:600 }}>{t('analytics.declineExpected')}</th>
                          <th style={{ textAlign:'right', padding:'10px 16px', color:'var(--muted)', fontWeight:600 }}>{t('analytics.declinePct')}</th>
                          <th style={{ textAlign:'center', padding:'10px 16px', color:'var(--muted)', fontWeight:600 }}>{t('common.contact')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {declineList.length === 0 ? (
                          <tr><td colSpan={7} style={{ textAlign:'center', padding:32, color:'var(--muted)' }}>{t('analytics.declineNone')}</td></tr>
                        ) : declineList.map(r => {
                          // Prefer 'phone' — it's kept clean by the CSV import fix (strips
                          // Excel artifacts, normalizes to digits-only). 'whatsapp' is a
                          // separate, older field that import never touches, so it can hold
                          // stale or manually-mistyped values — only fall back to it, and
                          // only trust a number that's actually long enough to be real
                          // (a genuine MY/SG mobile number is at least 10 digits).
                          const rawNumber = (r.phone && r.phone.replace(/\D/g,'').length >= 10) ? r.phone
                            : (r.whatsapp && r.whatsapp.replace(/\D/g,'').length >= 10) ? r.whatsapp
                            : ''
                          const waNumber = rawNumber.replace(/\D/g, '')
                          const greeting = encodeURIComponent(`Hi ${r.username}, this is ${myName} from the VIP department.`)
                          return (
                            <tr key={r.username} style={{ borderBottom:'1px solid var(--border)' }}
                              onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                              <td style={{ padding:'10px 16px', fontWeight:700 }}>{r.username}</td>
                              <td style={{ padding:'10px 16px' }}>
                                {r.tier && <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10, background:TIER_BG[r.tier]||'transparent', color:TIER_COLOR[r.tier]||'var(--text)' }}>{r.tier}</span>}
                              </td>
                              <td style={{ padding:'10px 16px', textAlign:'right', fontWeight:600 }}>{formatMoney(r.lastMonthDep, r.currency)}</td>
                              <td style={{ padding:'10px 16px', textAlign:'right', fontWeight:600, color: r.thisMonthDep === 0 ? 'var(--muted)' : '#3fb950' }}>{formatMoney(r.thisMonthDep, r.currency)}</td>
                              <td style={{ padding:'10px 16px', textAlign:'right', color:'var(--muted)' }}>{formatMoney(r.expected, r.currency)}</td>
                              <td style={{ padding:'10px 16px', textAlign:'right', fontWeight:700, color:'#f85149' }}>{r.declinePct}%</td>
                              <td style={{ padding:'10px 16px', textAlign:'center' }}>
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
                </div>
              )}

        </>
      )}
    </div>
  )
}
