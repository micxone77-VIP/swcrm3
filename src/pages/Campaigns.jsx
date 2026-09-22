// Campaigns v2 — 3 campaign types: Gold Bar, % Reward, Fixed Amount
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useUrlParam } from '../hooks/useUrlParam'
import { callAI } from '../lib/aiApi'
import { useLanguage } from '../contexts/LanguageContext'
import { buildCampaignUpdate, buildLevelUpsert, normalizeCampaignForEdit, normalizeLevel, validateCampaignEditor } from '../lib/campaignEditor'
import { buildMultiLevelPlayerMetrics, buildPayoutRows, buildCampaignSummary, calculateCampaignROI } from '../lib/campaignMetrics'

// ── Constants ─────────────────────────────────────────────────────────────────
const TIERS = ['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
const TIER_COLOR = { DIAMOND:'#b9f2ff', PLATINUM:'#C0C0C0', GOLD:'#ffd700', SILVER:'#a8a8a8', BRONZE:'#cd7f32' }
const TIER_BG    = { DIAMOND:'rgba(185,242,255,.12)', PLATINUM:'rgba(192,192,192,.12)', GOLD:'rgba(255,215,0,.12)', SILVER:'rgba(168,168,168,.1)', BRONZE:'rgba(205,127,50,.1)' }

const CAMPAIGN_TYPES = {
  gold_bar:     { label:'🥇 Gold Bar',       color:'#ffd700', desc:'Deposit threshold → receive physical gold bar or gift' },
  pct_reward:   { label:'💰 % Reward',        color:'#3fb950', desc:'Deposit amount × % = cashback (credit/cash)' },
  fixed_reward:  { label:'🎁 Fixed Reward',    color:'#b9f2ff', desc:'Deposit reaches threshold → fixed reward amount' },
  tiered_reward: { label:'📊 Tiered % Reward',  color:'#f0883e', desc:'Different % reward at each deposit tier — more deposit = higher %' },
  dual_tier:     { label:'🎯 Deposit + Turnover Tiers', color:'#c9a961', desc:'Must reach BOTH deposit AND turnover at a tier → get that tier\'s Credit + WCash' },
  leaderboard:   { label:'[TOP] Leaderboard',    color:'#a78bfa', desc:'Top N players by monthly valid bet - each rank gets different cash voucher' },
}

function getCampaignTypeInfo(campaignOrForm) {
  const type = campaignOrForm?.campaign_type || 'gold_bar'
  const multi = Boolean(campaignOrForm?.is_multi_level)
  if (type === 'fixed_reward' && multi) {
    return { label:'🎁 Tiered Deposit Reward', color:'#b9f2ff', desc:'Different fixed Credit reward at each deposit level' }
  }
  return CAMPAIGN_TYPES[type] || CAMPAIGN_TYPES.gold_bar
}

const REWARD_DELIVERY = {
  credit:   { label:'💳 Credit',      color:'#3fb950' },
  cash:     { label:'💵 Cash',        color:'#f59e0b' },
  gold_bar: { label:'🥇 Gold Bar',    color:'#ffd700' },
  gift:     { label:'🎁 Physical Gift',color:'#b9f2ff' },
  voucher:  { label:'🎫 Voucher',     color:'#8b5cf6' },
}

const STATUS_COLOR = { draft:'#8b949e', upcoming:'#58a6ff', active:'#3fb950', paused:'#d29922', ended:'#f85149' }
const STATUS_BG    = { draft:'rgba(139,148,158,.15)', upcoming:'rgba(88,166,255,.15)', active:'rgba(63,185,80,.15)', paused:'rgba(210,153,34,.15)', ended:'rgba(248,81,73,.15)' }
const PLATFORMS    = ['MY','SG','KH','BOTH']

const CURRENCY_PREFIX = { MYR: 'RM', SGD: 'S$', KHUSD: 'USD' }
const campaignCurrency = (platform) => ({ MY: 'MYR', SG: 'SGD', KH: 'KHUSD', BOTH: 'MYR' }[platform] || 'MYR')

function rmFmt(n, currency) {
  if (!n && n!==0) return '—'
  const num = parseFloat(n)||0
  const prefix = CURRENCY_PREFIX[currency] || 'RM'
  if (num>=1000000) return prefix+' '+(num/1000000).toFixed(2)+'M'
  if (num>=1000)    return prefix+' '+(num/1000).toFixed(1)+'K'
  return prefix+' '+Math.round(num).toLocaleString('en-MY')
}

// Rewards are financial commitments and must never be abbreviated (e.g. RM1,388,
// not RM1.4K). Keep rmFmt for deposits/turnover where compact K/M notation is useful.
function rewardFmt(n, currency) {
  if (!n && n!==0) return '—'
  const num = parseFloat(n)||0
  const prefix = CURRENCY_PREFIX[currency] || 'RM'
  return prefix+' '+num.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
// Streak/percentage bonuses — always show 2 decimal places (e.g. RM 496.50)
function bonusFmt(n, currency) {
  if (!n && n!==0) return '—'
  const num = parseFloat(n)||0
  const prefix = CURRENCY_PREFIX[currency] || 'RM'
  return prefix+' '+num.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page:     { padding:'24px 28px', minHeight:'100vh', color:'var(--text)' },
  title:    { fontSize:22, fontWeight:700 },
  sub:      { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:     { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  btn:      { background:'var(--accent)', color:'#fff', border:'none', padding:'8px 20px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm:    { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  btnG:     { background:'#3fb950', color:'#fff', border:'none', padding:'6px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' },
  btnR:     { background:'rgba(248,81,73,.15)', color:'#f85149', border:'1px solid rgba(248,81,73,.3)', padding:'6px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' },
  badge:    { display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  tag:      (c,bg) => ({ display:'inline-block', padding:'3px 10px', borderRadius:6, fontSize:11, fontWeight:600, background:bg||c+'22', color:c }),
  tbl:      { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:       { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:       { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  overlay:  { position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  modal:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, width:'100%', maxWidth:1200, maxHeight:'92vh', overflowY:'auto' },
  mhdr:     { padding:'18px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 },
  g2:       { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 16px', marginBottom:12 },
  frow:     { marginBottom:10 },
  flbl:     { fontSize:11, color:'var(--muted)', marginBottom:4, fontWeight:600 },
  finput:   { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 11px', borderRadius:7, fontSize:13, outline:'none', boxSizing:'border-box' },
  fsel:     { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 11px', borderRadius:7, fontSize:13, outline:'none' },
  fta:      { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 11px', borderRadius:7, fontSize:13, resize:'vertical', outline:'none', boxSizing:'border-box', fontFamily:'inherit' },
  smInput:  { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'5px 8px', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' },
  editInput:{ background:'transparent', border:'1px solid transparent', color:'var(--text)', padding:'3px 6px', borderRadius:5, fontSize:12, outline:'none', width:'100%', boxSizing:'border-box' },
}

// ── Progress helper ───────────────────────────────────────────────────────────
function getProgress(deposit, target) {
  const pct = target ? Math.min(100, Math.round((deposit/target)*100)) : 0
  const color = pct>=100?'#3fb950':pct>=70?'#f0883e':'#f85149'
  const label = pct>=100?'✅ ACHIEVED':pct>=70?'⚡ CLOSE':'🔴 BEHIND'
  const bg    = pct>=100?'rgba(63,185,80,.15)':pct>=70?'rgba(240,136,62,.15)':'rgba(248,81,73,.1)'
  return { pct, color, label, bg }
}

// ── Reward calculator ─────────────────────────────────────────────────────────
function calcTieredReward(deposit, tiers) {
  // tiers: [{min, max, pct}] sorted by min ascending
  // % applies to FULL deposit amount at the highest qualifying tier
  if (!tiers || tiers.length === 0) return 0
  const dep = parseFloat(deposit) || 0
  const sorted = [...tiers].sort((a,b) => parseFloat(a.min)-parseFloat(b.min))
  let reward = 0
  for (const t of sorted) {
    const min = parseFloat(t.min) || 0
    const max = t.max ? parseFloat(t.max) : Infinity
    const pct = parseFloat(t.pct) || 0
    if (dep >= min && dep <= max) {
      reward = dep * pct / 100
      break
    }
    // If deposit exceeds all tiers, use the last tier
    if (dep > max) {
      const nextTier = sorted.find(tt => parseFloat(tt.min) > max)
      if (!nextTier) reward = dep * pct / 100
    }
  }
  return reward
}

function calcDualTierReward(deposit, validBet, tiers) {
  if (!tiers || tiers.length === 0) return { creditAmount: 0, wcashAmount: 0, tierIndex: -1 }
  const dep = parseFloat(deposit) || 0
  const vb = parseFloat(validBet) || 0
  // Both conditions must be met simultaneously — find the highest tier where
  // deposit AND turnover both clear their threshold. Tiers assumed ascending.
  let best = null
  let bestIndex = -1
  tiers.forEach((tier, i) => {
    const depReq = parseFloat(tier.depositThreshold) || 0
    const vbReq = parseFloat(tier.turnoverThreshold) || 0
    if (dep >= depReq && vb >= vbReq) { best = tier; bestIndex = i }
  })
  if (!best) return { creditAmount: 0, wcashAmount: 0, tierIndex: -1 }
  return { creditAmount: parseFloat(best.creditAmount) || 0, wcashAmount: parseFloat(best.wcashAmount) || 0, tierIndex: bestIndex }
}

function calcLevelFixedReward(deposit, levels) {
  const dep = parseFloat(deposit) || 0
  const sorted = [...(levels || [])].sort((a,b) => (parseFloat(a.deposit_threshold)||0) - (parseFloat(b.deposit_threshold)||0))
  let reward = 0
  for (const level of sorted) {
    if (dep >= (parseFloat(level.deposit_threshold)||0)) reward = parseFloat(level.reward_amount)||0
    else break
  }
  return reward
}

// For dual_tier + daily + is_multi_level campaigns: returns the highest campaign_level
// the deposit qualifies for, and that level's credit reward.
function calcLevelTierForDeposit(dep, levels) {
  const deposit = parseFloat(dep) || 0
  const sorted = [...(levels || [])].sort((a, b) => Number(b.deposit_threshold) - Number(a.deposit_threshold))
  const bestLevel = sorted.find(l => deposit >= (Number(l.deposit_threshold) || 0))
  if (!bestLevel) return { levelOrder: null, creditReward: 0 }
  return { levelOrder: bestLevel.level_order ?? null, creditReward: Number(bestLevel.reward_amount) || 0 }
}

// WhatsApp notification helpers
// Substitutes {username} {campaign} {agent} {reward} {turnover} in a custom template
function applyPayoutTemplate(tpl, username, campaignName, rewardFormatted, agent, turnoverRequired) {
  return tpl
    .replace(/\{username\}/g, username || '')
    .replace(/\{campaign\}/g, campaignName || '')
    .replace(/\{agent\}/g, agent || '')
    .replace(/\{reward\}/g, rewardFormatted || '')
    .replace(/\{turnover\}/g, turnoverRequired || '')
}

// agent = host_assigned name; turnoverRequired = reward × multiplier (null if no requirement)
const WA_MSGS = {
  en: (u, c, r, agent, turnoverRequired) => {
    const intro = agent ? `Hi ${u}! 🎉 I'm ${agent} from SureWin VIP Team.` : `Hi ${u}! 🎉`
    const body = `\nYour "${c}" reward of ${r} Credit has been credited to your account. Please check your balance!`
    const turnover = turnoverRequired ? `\n\n⚠️ Please note: A ${turnoverRequired} turnover is required before you can make a withdrawal.` : ''
    return intro + body + turnover
  },
  my: (u, c, r, agent, turnoverRequired) => {
    const intro = agent ? `Hi ${u}! 🎉 Saya ${agent} dari Pasukan SureWin VIP.` : `Hi ${u}! 🎉`
    const body = `\nHadiah kempen "${c}" sebanyak ${r} Kredit telah dikreditkan ke akaun anda. Sila semak baki anda!`
    const turnover = turnoverRequired ? `\n\n⚠️ Harap maklum: Turnover sebanyak ${turnoverRequired} diperlukan sebelum pengeluaran boleh dibuat.` : ''
    return intro + body + turnover
  },
  cn: (u, c, r, agent, turnoverRequired) => {
    const intro = agent ? `你好 ${u}！🎉我是SureWin VIP部门的${agent}` : `你好 ${u}！🎉`
    const body = `\n你的"${c}"奖励 ${r} 积分已成功存入你的账户，请查看余额！`
    const turnover = turnoverRequired ? `\n\n⚠️ 温馨提示：领取奖励后需完成 ${turnoverRequired} 的流水要求，方可申请提款。` : ''
    return intro + body + turnover
  },
}
function buildWaMsgText(username, campaignName, rewardFormatted, lang, agent, turnoverRequired, campaign) {
  // Use campaign's custom payout template if set for this language
  const templateKey = { en: 'payout_template_en', my: 'payout_template_my', cn: 'payout_template_cn' }[lang]
  const customTpl = campaign && templateKey ? campaign[templateKey] : null
  if (customTpl && customTpl.trim()) {
    return applyPayoutTemplate(customTpl, username, campaignName, rewardFormatted, agent, turnoverRequired)
  }
  const fn = WA_MSGS[lang]
  if (fn) return fn(username, campaignName, rewardFormatted, agent, turnoverRequired)
  return Object.values(WA_MSGS).map(f => f(username, campaignName, rewardFormatted, agent, turnoverRequired)).join('\n\n')
}
function buildWaMsg(username, campaignName, rewardFormatted, lang, agent, turnoverRequired, campaign) {
  return encodeURIComponent(buildWaMsgText(username, campaignName, rewardFormatted, lang, agent, turnoverRequired, campaign))
}
function waHref(phone, encodedMsg) {
  if (!phone) return null
  const clean = String(phone).replace(/\D/g, '')
  if (!clean) return null
  const intl = clean.startsWith('60') ? clean : clean.startsWith('0') ? '6' + clean : '60' + clean
  return `https://wa.me/${intl}?text=${encodedMsg}`
}

function calcReward(type, deposit, rewardPct, rewardFixed, goldBarValue, rewardCap, rewardTiers, rewardLevels = [], isMultiLevel = false) {
  let reward = 0
  if (type === 'pct_reward') reward = (parseFloat(deposit)||0) * (parseFloat(rewardPct)||0) / 100
  else if (type === 'fixed_reward') reward = isMultiLevel ? calcLevelFixedReward(deposit, rewardLevels) : (parseFloat(rewardFixed)||0)
  else if (type === 'gold_bar') reward = parseFloat(goldBarValue)||0
  else if (type === 'tiered_reward') reward = calcTieredReward(deposit, rewardTiers||[])
  if (rewardCap && parseFloat(rewardCap) > 0) reward = Math.min(reward, parseFloat(rewardCap))
  return reward
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Campaigns() {
  const { profile } = useAuth()
  const { lang, t } = useLanguage()
  const navigate    = useNavigate()

  const [campaigns,  setCampaigns]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [filterStat, setFilterStat] = useUrlParam('status', 'ALL')
  const [filterType, setFilterType] = useUrlParam('type', 'ALL')
  const [filterMonth, setFilterMonth] = useUrlParam('month', 'ALL')
  const [monthOptions, setMonthOptions] = useState([])
  const [modal,      setModal]      = useState(null) // null | 'create' | 'detail'
  const [selected,   setSelected]   = useState(null)
  const [players,    setPlayers]    = useState([])
  const [campaignPlayerLevels, setCampaignPlayerLevels] = useState([])
  const [campaignRewards, setCampaignRewards] = useState([])
  const [activeTab,  setActiveTab]  = useState('chase')
  const [chaseFilter, setChaseFilter] = useState('')
  const [hostFilter, setHostFilter] = useState('all')
  const [chaseSort, setChaseSort] = useState('deposit')
  const [chaseSortDir, setChaseSortDir] = useState('desc')
  const [payoutSearch, setPayoutSearch] = useState('')
  const [payoutSort, setPayoutSort] = useState('deposit')
  const [payoutSortDir, setPayoutSortDir] = useState('desc')
  const [payoutHostFilter, setPayoutHostFilter] = useState('all')
  const [inactiveHostFilter, setInactiveHostFilter] = useState('all')
  const [waLang, setWaLang] = useState('en')
  const [copiedId, setCopiedId] = useState(null)
  const [entryDate, setEntryDate] = useState('')
  const [dailyEntries, setDailyEntries] = useState({}) // player_id -> {turnover_amount, tier_achieved, credit_reward, wcash_reward}
  const [dailyLoading, setDailyLoading] = useState(false)
  const [summaryData, setSummaryData] = useState(null)
  const [realFinancials, setRealFinancials] = useState(null) // real deposit/withdrawal/turnover from actual platform data, all campaign types
  const [realFinancialsLoading, setRealFinancialsLoading] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState({ text:'', ok:true })
  const [editingCamp,  setEditingCamp]  = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState(null)
  const [analyzing,  setAnalyzing]  = useState(false)
  const [editCampForm, setEditCampForm] = useState({})
  const [campaignLevelsEdit, setCampaignLevelsEdit] = useState([])
  const [campaignLevels, setCampaignLevels] = useState([])
  const [levelsLoading, setLevelsLoading] = useState(false)
  const [streakBonuses, setStreakBonuses] = useState({})   // map: campaign_player_id → [...rows]
  const [streakBonusesLoading, setStreakBonusesLoading] = useState(false)
  const [contacts, setContacts] = useState({})             // map: campaign_player_id → [...rows]
  const [contactLog, setContactLog] = useState(null)       // player_id of open log popup, or null
  const [waPopup, setWaPopup] = useState(null)  // { rawNumber, message } — editable before opening WA
  const [waCopied, setWaCopied] = useState(false)
  // All daily entries for streak/inactive tabs — loaded on demand
  const [allDailyEntries, setAllDailyEntries] = useState([])  // full flat list for campaign
  const [allDailyEntriesLoading, setAllDailyEntriesLoading] = useState(false)

  // VIP search
  const [vipSearch,   setVipSearch]   = useState('')
  const [vipResults,  setVipResults]  = useState([])

  // Create form
  const blankForm = {
    campaign_type: 'pct_reward',
    reward_tiers: [{min:'10000',max:'29999',pct:'1.5'},{min:'30000',max:'49999',pct:'3'},{min:'50000',max:'',pct:'6'}],
    campaign_name: '', campaign_code: '',
    platform: 'MY',
    start_date: '', end_date: '',
    target_tier: [],
    deposit_target: 50000,
    reward_pct: 6,
    reward_cap: '',
    has_cap: false,
    reward_delivery: 'credit',
    reward_fixed: 3000,
    gold_bar_value: 3400,
    offer_desc: '', notes: '',
    budget_rm: '',
    status: 'draft',
    min_valid_bet: 3000000,
    min_deposit_lb: 50000,
    top_n: 3,
    rank_rewards: [{rank:1,amount:12000},{rank:2,amount:12000},{rank:3,amount:12000}],
    settlement_frequency: 'total',
  }
  const [form, setForm] = useState(blankForm)
  const [rewardTiersEdit, setRewardTiersEdit] = useState([])
  const [rankRewardsEdit, setRankRewardsEdit] = useState([])

  // ── Load campaigns ──────────────────────────────────────────────────────────
  useEffect(() => { loadCampaigns() }, [filterStat, filterType, filterMonth])
  useEffect(() => { loadMonthOptions() }, [])

  // Month dropdown options are built from ALL campaigns' date ranges, independent of
  // the current Type/Status filters, so switching those filters never hides month choices.
  async function loadMonthOptions() {
    const { data } = await supabase.from('campaigns').select('start_date, end_date')
    const monthSet = new Set()
    ;(data || []).forEach(c => {
      if (!c.start_date) return
      const start = new Date(c.start_date)
      const end = c.end_date ? new Date(c.end_date) : start
      let cur = new Date(start.getFullYear(), start.getMonth(), 1)
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
      while (cur <= endMonth) {
        monthSet.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
        cur.setMonth(cur.getMonth() + 1)
      }
    })
    setMonthOptions([...monthSet].sort().reverse())
  }

  async function loadCampaigns() {
    setLoading(true)
    let q = supabase.from('campaigns').select('*').order('created_at', { ascending:false })
    if (filterStat !== 'ALL') q = q.eq('status', filterStat)
    const { data } = await q
    let list = data || []
    if (filterType !== 'ALL') list = list.filter(c => (c.campaign_type||'gold_bar') === filterType)
    if (filterMonth !== 'ALL') {
      // A campaign belongs to the selected month if its date range overlaps that month at all
      // (so a campaign spanning e.g. 28 Jun - 3 Jul shows under both June and July).
      const [fy, fm] = filterMonth.split('-').map(Number)
      const monthStart = new Date(fy, fm - 1, 1)
      const monthEnd   = new Date(fy, fm, 0)
      list = list.filter(c => {
        if (!c.start_date) return false
        const cStart = new Date(c.start_date)
        const cEnd = c.end_date ? new Date(c.end_date) : cStart
        return cStart <= monthEnd && cEnd >= monthStart
      })
    }
    setCampaigns(list)
    setLoading(false)
  }

  // ── Load players for selected campaign ─────────────────────────────────────
  useEffect(() => {
    if (selected?.id) {
      loadPlayers(selected.id)
      loadCampaignLevels(selected.id)
      if (selected.streak_enabled) loadStreakBonuses(selected.id)
      else setStreakBonuses({})
      loadContacts(selected.id)
    } else {
      setCampaignLevels([])
      setStreakBonuses({})
      setContacts({})
    }
  }, [selected?.id])

  async function loadPlayers(campId) {
    // Campaign players are the root dataset. Dependent player-level and reward
    // rows are scoped by those player IDs so another campaign can never leak
    // into Chase, Payout, All Players, or Summary calculations.
    const playersRes = await supabase
      .from('campaign_players')
      .select('*')
      .eq('campaign_id', campId)
      .order('added_at', { ascending:false })

    if (playersRes.error) {
      console.error('loadPlayers error', playersRes.error)
      setPlayers([])
      setCampaignPlayerLevels([])
      setCampaignRewards([])
      return
    }

    const campaignPlayers = playersRes.data || []

    // Enrich each player with host_assigned from vip_members (best-effort; never blocks load)
    const usernames = [...new Set(campaignPlayers.map(p => p.username).filter(Boolean))]
    let hostMap = {}
    if (usernames.length > 0) {
      const { data: hostRows } = await supabase
        .from('vip_members')
        .select('username, host_assigned')
        .in('username', usernames)
      ;(hostRows || []).forEach(r => { if (r.host_assigned) hostMap[r.username] = r.host_assigned })
    }
    const enriched = campaignPlayers.map(p => ({ ...p, host_assigned: hostMap[p.username] || null }))

    setPlayers(enriched)
    if (enriched.length === 0) {
      setCampaignPlayerLevels([])
      setCampaignRewards([])
      return
    }

    const playerIds = enriched.map(p => p.id)
    const [levelsRes, rewardsRes] = await Promise.all([
      supabase.from('campaign_player_levels')
        .select('id,campaign_player_id,campaign_level_id,status,unlocked_at,updated_at')
        .in('campaign_player_id', playerIds),
      supabase.from('campaign_rewards')
        .select('id,campaign_player_id,campaign_level_id,reward_amount,status,approved_at,paid_at,notes,created_at,updated_at')
        .in('campaign_player_id', playerIds),
    ])

    if (levelsRes.error) { console.error('load campaign player levels error', levelsRes.error); setCampaignPlayerLevels([]) }
    else setCampaignPlayerLevels(levelsRes.data || [])
    if (rewardsRes.error) { console.error('load campaign rewards error', rewardsRes.error); setCampaignRewards([]) }
    else setCampaignRewards(rewardsRes.data || [])
  }

  async function loadCampaignLevels(campId) {
    const { data, error } = await supabase
      .from('campaign_levels')
      .select('*')
      .eq('campaign_id', campId)
      .order('level_order', { ascending:true })
    if (error) { console.error('loadCampaignLevels error:', error); setCampaignLevels([]); return }
    setCampaignLevels(data || [])
  }

  // ── VIP search ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!vipSearch.trim()) { setVipResults([]); return }
    const t = setTimeout(async () => {
      const [{ data: vips }, { data: pots }] = await Promise.all([
        supabase.from('vip_members').select('id,username,full_name,tier,phone,whatsapp').or(`username.ilike.%${vipSearch}%,full_name.ilike.%${vipSearch}%`).eq('is_excluded',false).limit(5),
        supabase.from('potential_players').select('id,username,tier,monthly_valid_bet').ilike('username',`%${vipSearch}%`).eq('is_graduated',false).limit(3),
      ])
      setVipResults([
        ...(vips||[]).map(v=>({...v, source:'vip'})),
        ...(pots||[]).map(p=>({...p, source:'potential'})),
      ])
    }, 250)
    return () => clearTimeout(t)
  }, [vipSearch])

  // ── Create campaign ─────────────────────────────────────────────────────────
  async function createCampaign() {
    if (!form.campaign_name.trim()) { setMsg({ text:'Campaign name required.', ok:false }); return }
    const code = form.campaign_code.trim() || form.campaign_name.trim().toUpperCase().replace(/\s+/g,'-').slice(0,20)
    setSaving(true)
    const { data, error } = await supabase.from('campaigns').insert({
      campaign_type:  form.campaign_type,
      campaign_code:  code,
      campaign_name:  form.campaign_name.trim(),
      platform:       form.platform,
      start_date:     form.start_date||null,
      end_date:       form.end_date||null,
      target_tier:    form.target_tier.length>0 ? form.target_tier : null,
      offer_desc:     form.offer_desc||null,
      budget_rm:      form.budget_rm ? parseFloat(form.budget_rm) : null,
      deposit_target: form.campaign_type==='leaderboard' || form.campaign_type==='dual_tier' ? null : (parseFloat(form.deposit_target)||50000),
      reward_pct:     parseFloat(form.reward_pct)||null,
      reward_cap:     form.has_cap && form.reward_cap ? parseFloat(form.reward_cap)||null : null,
      reward_tiers:   (form.campaign_type==='tiered_reward' || form.campaign_type==='dual_tier') ? form.reward_tiers : null,
      settlement_frequency: form.campaign_type==='dual_tier' ? (form.settlement_frequency || 'total') : null,
      reward_delivery: form.reward_delivery||'credit',
      reward_fixed:   parseFloat(form.reward_fixed)||null,
      gold_bar_value: parseFloat(form.gold_bar_value)||null,
      min_valid_bet:  form.campaign_type==='leaderboard' ? parseFloat(form.min_valid_bet)||3000000 : null,
      min_deposit_lb: form.campaign_type==='leaderboard' ? parseFloat(form.min_deposit_lb)||0 : null,
      top_n:          form.campaign_type==='leaderboard' ? parseInt(form.top_n)||3 : null,
      rank_rewards:   form.campaign_type==='leaderboard' ? form.rank_rewards : null,
      status:         form.status,
      notes:          form.notes||null,
      turnover_multiplier: form.turnover_multiplier ? parseFloat(form.turnover_multiplier) : null,
      payout_template_en: form.payout_template_en||null,
      payout_template_my: form.payout_template_my||null,
      payout_template_cn: form.payout_template_cn||null,
      created_by:     profile?.id||null,
      created_at:     new Date().toISOString(),
    }).select().single()
    setSaving(false)
    if (error) { setMsg({ text:'Error: '+error.message, ok:false }); return }
    setMsg({ text:'', ok:true })
    setModal(null)
    await loadCampaigns()
    setSelected(data)
    setPlayers([])
    setModal('detail')
  }

  // ── Add VIP to campaign ─────────────────────────────────────────────────────
  async function addVIP(v) {
    if (!selected) return
    const exists = players.find(p => p.username === v.username)
    if (exists) { setVipSearch(''); setVipResults([]); return }
    const { data: inserted, error } = await supabase.from('campaign_players').insert({
      campaign_id: selected.id,
      vip_id:        v.source==='vip' ? v.id : null,
      username:      v.username,
      tier:          v.tier,
      whatsapp:      v.whatsapp||v.phone||null,
      total_deposit: 0,
      campaign_period_deposit: 0,
      converted:     false,
      payout_status: 'pending',
      added_at:      new Date().toISOString(),
    }).select('id').single()
    if (error) { alert('Add failed: ' + error.message); console.error(error) }
    else {
      // Create the player's campaign-level rows immediately so the Player Portal
      // has a single authoritative level state from the moment of enrollment.
      if (inserted?.id && selected?.is_multi_level) {
        const { error: syncError } = await supabase.rpc('sync_manual_campaign_player_progress', {
          p_campaign_player_id: inserted.id,
          p_campaign_period_deposit: 0,
        })
        if (syncError) console.error('Initial campaign progress sync failed:', syncError)
      }
      await loadPlayers(selected.id); setVipSearch(''); setVipResults([])
    }
  }

  // ── Update player ───────────────────────────────────────────────────────────
  async function updatePlayer(pid, updates) {
    const { error } = await supabase.from('campaign_players').update(updates).eq('id', pid)
    if (error) { alert('Update failed: ' + error.message); console.error(error); return }

    // Manual CRM deposit entry is a campaign-period value for reward campaigns.
    // Keep Supabase campaign_period_deposit + player-level unlock state + reward
    // rows in sync immediately; do not wait for the hourly snapshot refresh.
    if (Object.prototype.hasOwnProperty.call(updates, 'total_deposit')) {
      const { error: syncError } = await supabase.rpc('sync_manual_campaign_player_progress', {
        p_campaign_player_id: pid,
        p_campaign_period_deposit: Number(updates.total_deposit) || 0,
      })
      if (syncError) {
        alert('Deposit saved, but campaign progress sync failed: ' + syncError.message)
        console.error('sync_manual_campaign_player_progress failed:', syncError)
      }
    }

    // Keep the Player Portal reward row synchronized with the CRM payout status.
    // The CRM leaderboard table updates campaign_players.payout_status, while
    // the Player Portal reads campaign_rewards.status. Both must represent the
    // same payout state or the two screens can disagree.
    if (Object.prototype.hasOwnProperty.call(updates, 'payout_status') && ['paid','pending'].includes(updates.payout_status)) {
      const rewardPatch = updates.payout_status === 'paid'
        ? { status:'paid', paid_at: updates.payout_date || new Date().toISOString() }
        : { status:'pending', paid_at:null }
      const { error: rewardSyncError } = await supabase
        .from('campaign_rewards')
        .update(rewardPatch)
        .eq('campaign_player_id', pid)
      if (rewardSyncError) {
        alert('CRM payout saved, but Player Portal reward sync failed: ' + rewardSyncError.message)
        console.error('campaign_rewards payout sync failed:', rewardSyncError)
      }
    }

    await loadPlayers(selected.id)
  }

  async function toggleCampaignReward(rewardId, makePaid) {
    if (!rewardId) return
    const patch = makePaid ? { status:'paid', paid_at:new Date().toISOString() } : { status:'pending', paid_at:null }
    const { error } = await supabase.from('campaign_rewards').update(patch).eq('id', rewardId)
    if (error) { alert('Reward update failed: ' + error.message); console.error(error); return }
    await loadPlayers(selected.id)
  }

  // ── Remove player ───────────────────────────────────────────────────────────
  async function removePlayer(pid) {
    if (!window.confirm('Remove this player from the campaign?')) return
    await supabase.from('campaign_players').delete().eq('id', pid)
    await loadPlayers(selected.id)
  }

  // ── Campaign status ─────────────────────────────────────────────────────────
  async function setCampStatus(id, status) {
    await supabase.from('campaigns').update({ status }).eq('id', id)
    setSelected(prev => prev ? { ...prev, status } : prev)
    await loadCampaigns()
  }

  async function openCampaignEditor() {
    if (!selected?.id) return
    setLevelsLoading(true)
    const [campaignRes, levelsRes] = await Promise.all([
      supabase.from('campaigns').select('*').eq('id', selected.id).single(),
      supabase.from('campaign_levels').select('*').eq('campaign_id', selected.id).order('level_order', { ascending:true }),
    ])
    if (campaignRes.error) {
      alert('Could not load campaign: ' + campaignRes.error.message)
      setLevelsLoading(false)
      return
    }
    const fresh = campaignRes.data
    setSelected(fresh)
    setEditCampForm(normalizeCampaignForEdit(fresh))
    setCampaignLevelsEdit((levelsRes.data || []).map(level => normalizeLevel(level, 0, fresh.reward_delivery || 'credit')))
    setEditingCamp(true)
    setLevelsLoading(false)
  }

  async function editCampaign() {
    const validation = validateCampaignEditor(editCampForm, editCampForm.is_multi_level ? campaignLevelsEdit : [])
    if (validation.length) {
      alert(validation.join('\n'))
      return
    }
    setSaving(true)
    try {
      // Check dependent portal rows before allowing levels to be removed/disabled.
      // This prevents a campaign edit from breaking existing player reward links.
      const existingLevelRes = await supabase.from('campaign_levels').select('id').eq('campaign_id', selected.id)
      if (existingLevelRes.error) throw existingLevelRes.error
      const existingLevelIds = (existingLevelRes.data || []).map(r => r.id)
      if (existingLevelIds.length) {
        const currentIds = campaignLevelsEdit.filter(l => l.id).map(l => l.id)
        const removingIds = editCampForm.is_multi_level ? existingLevelIds.filter(id => !currentIds.includes(id)) : existingLevelIds
        if (removingIds.length) {
          const { count: playerLevelCount, error: plcError } = await supabase.from('campaign_player_levels').select('id', { count:'exact', head:true }).in('campaign_level_id', removingIds)
          if (plcError) throw plcError
          const { count: rewardCount, error: rewardError } = await supabase.from('campaign_rewards').select('id', { count:'exact', head:true }).in('campaign_level_id', removingIds)
          if (rewardError) throw rewardError
          if ((playerLevelCount || 0) > 0 || (rewardCount || 0) > 0) {
            throw new Error('One or more levels are already used by player progress/rewards. They cannot be deleted or disabled.')
          }
        }
      }

      const update = buildCampaignUpdate(editCampForm)
      const { error } = await supabase.from('campaigns').update(update).eq('id', selected.id)
      if (error) throw error

      if (editCampForm.is_multi_level) {
        const existingIds = campaignLevelsEdit.filter(l => l.id).map(l => l.id)
        const currentRes = await supabase.from('campaign_levels').select('id').eq('campaign_id', selected.id)
        if (currentRes.error) throw currentRes.error
        const idsToDelete = (currentRes.data || []).map(r => r.id).filter(id => !existingIds.includes(id))
        if (idsToDelete.length) {
          const { error: deleteError } = await supabase.from('campaign_levels').delete().in('id', idsToDelete)
          if (deleteError) throw deleteError
        }
        const levelRows = campaignLevelsEdit.map((level, index) => buildLevelUpsert({ ...level, campaign_id: selected.id }, index, editCampForm.reward_delivery || 'credit'))
        const { error: levelError } = await supabase.from('campaign_levels').upsert(levelRows, { onConflict:'id' })
        if (levelError) throw levelError
      } else {
        // Do not leave stale portal levels attached when a campaign is switched
        // back to single-level mode. Only delete when the campaign has no
        // dependent player-level/reward rows.
        if (existingLevelIds.length) {
          const { error: deleteError } = await supabase.from('campaign_levels').delete().eq('campaign_id', selected.id)
          if (deleteError) throw deleteError
        }
      }

      const freshRes = await supabase.from('campaigns').select('*').eq('id', selected.id).single()
      if (freshRes.error) throw freshRes.error
      setSelected(freshRes.data)
      setEditCampForm(normalizeCampaignForEdit(freshRes.data))
      const savedLevelsRes = await supabase.from('campaign_levels').select('*').eq('campaign_id', selected.id).order('level_order', { ascending:true })
      setCampaignLevels(savedLevelsRes.data || [])
      setEditingCamp(false)
      setCampaignLevelsEdit([])
      await loadCampaigns()
      setMsg({ text:'Campaign saved successfully.', ok:true })
    } catch (error) {
      alert('Save failed: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteCampaign() {
    if (!window.confirm(`Delete "${selected.campaign_name}"? This will also remove all player records.`)) return
    // Delete child rows in dependency order before removing the campaign itself.
    // daily_turnover_entries references both campaign_id AND player_id (→ campaign_players),
    // so it must be removed first; then campaign_players; then campaign_levels; finally campaigns.
    await supabase.from('daily_turnover_entries').delete().eq('campaign_id', selected.id)
    // campaign_rewards and campaign_player_levels both FK → campaign_players, so delete them first
    const { data: cpRows } = await supabase.from('campaign_players').select('id').eq('campaign_id', selected.id)
    const cpIds = (cpRows || []).map(r => r.id)
    if (cpIds.length) {
      await supabase.from('campaign_rewards').delete().in('campaign_player_id', cpIds)
      await supabase.from('campaign_player_levels').delete().in('campaign_player_id', cpIds)
    }
    await supabase.from('campaign_players').delete().eq('campaign_id', selected.id)
    await supabase.from('campaign_levels').delete().eq('campaign_id', selected.id)
    const { error } = await supabase.from('campaigns').delete().eq('id', selected.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    closeModal()
    await loadCampaigns()
  }

  function closeModal() { setModal(null); setSelected(null); setPlayers([]); setCampaignPlayerLevels([]); setCampaignRewards([]); setVipSearch(''); setVipResults([]); setEditingCamp(false); setAiAnalysis(null); setDailyEntries({}); setEntryDate(''); setStreakBonuses({}); setStreakBonusesLoading(false); setContacts({}); setContactLog(null); setInactiveHostFilter('all') }

  async function loadDailyEntries(campaignId, date) {
    setDailyLoading(true)
    const { data, error } = await supabase.from('daily_turnover_entries')
      .select('player_id, deposit_amount, turnover_amount, tier_achieved, credit_reward, wcash_reward, payout_status, payout_date')
      .eq('campaign_id', campaignId).eq('entry_date', date)
    if (error) { console.error('loadDailyEntries error', error); setDailyEntries({}); setDailyLoading(false); return }
    const map = {}
    ;(data || []).forEach(e => { map[e.player_id] = e })
    setDailyEntries(map)
    setDailyLoading(false)
  }

  // Updates payout_status on the daily_turnover_entries row for the current date.
  // This is the per-date payout toggle for daily-mode campaigns.
  async function updateDailyPayout(playerId, newStatus) {
    const newDate = newStatus === 'paid' ? new Date().toISOString() : null
    const { error } = await supabase.from('daily_turnover_entries')
      .update({ payout_status: newStatus, payout_date: newDate })
      .eq('campaign_id', selected.id)
      .eq('player_id', playerId)
      .eq('entry_date', entryDate)
    if (error) { console.error('updateDailyPayout error', error); return }
    setDailyEntries(prev => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), payout_status: newStatus, payout_date: newDate }
    }))
  }

  // Upserts a player's turnover for the currently-selected date only — every
  // other date's row for this player is untouched. This IS the "doesn't carry
  // over to the next day" behavior: each date is its own independent record.
  async function saveDailyEntry(playerId, depositAmount, turnoverAmount) {
    let tier_achieved_val = null, credit_reward_val = 0, wcash_reward_val = 0
    if (selected?.is_multi_level && campaignLevels?.length > 0) {
      // Multi-level daily: qualify by deposit against campaign_levels thresholds
      const { levelOrder, creditReward } = calcLevelTierForDeposit(depositAmount, campaignLevels)
      tier_achieved_val = levelOrder
      credit_reward_val = creditReward
    } else {
      // Standard dual-tier: both deposit AND turnover must meet tier thresholds
      const dualReward = calcDualTierReward(depositAmount, turnoverAmount, rewardTiers)
      tier_achieved_val = dualReward.tierIndex >= 0 ? dualReward.tierIndex : null
      credit_reward_val = dualReward.creditAmount
      wcash_reward_val = dualReward.wcashAmount
    }
    const payload = {
      campaign_id: selected.id, player_id: playerId, entry_date: entryDate,
      deposit_amount: depositAmount,
      turnover_amount: turnoverAmount,
      tier_achieved: tier_achieved_val,
      credit_reward: credit_reward_val, wcash_reward: wcash_reward_val,
      entered_by: profile?.full_name || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('daily_turnover_entries')
      .upsert(payload, { onConflict: 'campaign_id,player_id,entry_date' })
    if (error) { alert('Save failed: ' + error.message); console.error(error); return }
    setDailyEntries(prev => ({ ...prev, [playerId]: payload }))
    if (selected?.streak_enabled) await checkAndAwardStreak(playerId, entryDate)
  }

  async function loadStreakBonuses(campaignId) {
    setStreakBonusesLoading(true)
    const { data, error } = await supabase
      .from('campaign_streak_bonuses')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('campaign_player_id').order('streak_number', { ascending: true })
    if (error) { console.error('loadStreakBonuses error', error); setStreakBonuses({}); setStreakBonusesLoading(false); return }
    const map = {}
    for (const r of (data || [])) {
      if (!map[r.campaign_player_id]) map[r.campaign_player_id] = []
      map[r.campaign_player_id].push(r)
    }
    setStreakBonuses(map)
    setStreakBonusesLoading(false)
  }

  // ── Contact log ─────────────────────────────────────────────────────────────
  async function loadContacts(campId) {
    const { data, error } = await supabase
      .from('campaign_player_contacts')
      .select('*')
      .eq('campaign_id', campId)
      .order('contacted_at', { ascending: false })
    if (error) { console.error('loadContacts error', error); return }
    const map = {}
    for (const r of (data || [])) {
      if (!map[r.campaign_player_id]) map[r.campaign_player_id] = []
      map[r.campaign_player_id].push(r)
    }
    setContacts(map)
  }

  async function logContact(playerId, type, note = '') {
    const { error } = await supabase.from('campaign_player_contacts').insert({
      campaign_id: selected.id,
      campaign_player_id: playerId,
      contacted_at: new Date().toISOString(),
      contact_type: type,
      host: profile?.email || null,
      notes: note || null,
    })
    if (error) { console.error('logContact error', error); return }
    setContactLog(null)
    await loadContacts(selected.id)
  }

  // Load ALL daily entries for the campaign (used by Streak + Inactive tabs)
  async function loadAllDailyEntries(campaignId) {
    setAllDailyEntriesLoading(true)
    const { data, error } = await supabase
      .from('daily_turnover_entries')
      .select('player_id, entry_date, deposit_amount, credit_reward')
      .eq('campaign_id', campaignId)
      .order('entry_date', { ascending: true })
    if (error) { console.error('loadAllDailyEntries error', error); setAllDailyEntries([]); setAllDailyEntriesLoading(false); return }
    setAllDailyEntries(data || [])
    setAllDailyEntriesLoading(false)
  }

  // Retroactively fixes tier_achieved + credit_reward for ALL daily_turnover_entries of this campaign.
  // Needed for is_multi_level daily campaigns where entries were saved with the wrong calc.
  async function recalcDailyRewards() {
    if (!selected?.is_multi_level || !campaignLevels?.length) return
    setDailyLoading(true)
    const { data, error } = await supabase.from('daily_turnover_entries')
      .select('id, player_id, deposit_amount, entry_date')
      .eq('campaign_id', selected.id)
    if (error) { alert('Load failed: ' + error.message); setDailyLoading(false); return }
    const rows = data || []
    if (!rows.length) { alert('No entries to recalculate.'); setDailyLoading(false); return }
    // Use individual .update() calls — never .upsert() here, which would try to INSERT
    // a new row when the id doesn't match, triggering the campaign_id not-null constraint.
    const now = new Date().toISOString()
    for (const row of rows) {
      const { levelOrder, creditReward } = calcLevelTierForDeposit(row.deposit_amount, campaignLevels)
      const { error: upErr } = await supabase.from('daily_turnover_entries')
        .update({ tier_achieved: levelOrder, credit_reward: creditReward, wcash_reward: 0, updated_at: now })
        .eq('id', row.id)
      if (upErr) { alert('Recalc failed: ' + upErr.message); setDailyLoading(false); return }
    }
    await loadDailyEntries(selected.id, entryDate)
    await loadCampaignSummary(selected.id)
    // Award streak bonuses for any newly-eligible players
    if (selected?.streak_enabled) {
      const today = new Date().toISOString().slice(0, 10)
      for (const p of players) {
        await checkAndAwardStreak(p.id, today)
      }
    }
    alert(`✅ Recalculated rewards for ${rows.length} entries.`)
    setDailyLoading(false)
  }

  async function checkAndAwardStreak(playerId, afterEntryDate) {
    if (!selected?.streak_enabled || !isDailyMode) return
    // Minimum qualifying deposit = lowest level threshold, or deposit_target as fallback
    const sortedLvls = [...campaignLevels].sort((a, b) => (parseFloat(a.deposit_threshold) || 0) - (parseFloat(b.deposit_threshold) || 0))
    const minThreshold = sortedLvls.length > 0
      ? (parseFloat(sortedLvls[0].deposit_threshold) || 0)
      : (parseFloat(selected?.deposit_target) || 5000)

    // Fetch all entries for this player sorted by date
    const { data: allEntries, error: entriesErr } = await supabase
      .from('daily_turnover_entries')
      .select('entry_date, deposit_amount')
      .eq('campaign_id', selected.id)
      .eq('player_id', playerId)
      .order('entry_date', { ascending: true })
    if (entriesErr || !allEntries?.length) return

    // Keep only qualifying days (deposit >= minThreshold)
    const qualifyingDates = allEntries
      .filter(e => (parseFloat(e.deposit_amount) || 0) >= minThreshold)
      .map(e => e.entry_date)   // 'YYYY-MM-DD' strings, sorted ASC
    if (!qualifyingDates.length) return

    // Split into consecutive runs (no gaps allowed between calendar days)
    const runs = []
    let cur = [qualifyingDates[0]]
    for (let i = 1; i < qualifyingDates.length; i++) {
      const prev = new Date(qualifyingDates[i - 1] + 'T00:00:00Z')
      const next = new Date(qualifyingDates[i] + 'T00:00:00Z')
      if (Math.round((next - prev) / 86400000) === 1) { cur.push(qualifyingDates[i]) }
      else { runs.push(cur); cur = [qualifyingDates[i]] }
    }
    runs.push(cur)

    // Find the run that contains or most-recently ends before afterEntryDate
    const activeRun = runs.find(r => r.includes(afterEntryDate))
      || runs.filter(r => r[r.length - 1] <= afterEntryDate).pop()
    if (!activeRun) return

    const streakDays = selected.streak_days || 3
    const totalComplete = Math.floor(activeRun.length / streakDays)
    if (totalComplete === 0) return

    // Check what's already been awarded (fetch id + bonus_amount + status too for update logic)
    const { data: existing, error: existingErr } = await supabase
      .from('campaign_streak_bonuses')
      .select('id, streak_number, bonus_amount, payout_status')
      .eq('campaign_id', selected.id)
      .eq('campaign_player_id', playerId)
    if (existingErr) { console.error('streak bonus fetch error', existingErr); return }
    const awardedMap = {}
    for (const r of (existing || [])) awardedMap[r.streak_number] = r

    // Award missing streaks; update bonus_amount on pending records if cap changed
    for (let sn = 1; sn <= totalComplete; sn++) {
      const startIdx = (sn - 1) * streakDays
      const periodDates = activeRun.slice(startIdx, startIdx + streakDays)
      const periodStart = periodDates[0]
      const periodEnd = periodDates[periodDates.length - 1]
      const periodDeposit = allEntries
        .filter(e => periodDates.includes(e.entry_date))
        .reduce((s, e) => s + (parseFloat(e.deposit_amount) || 0), 0)

      // Calculate bonus
      let bonusAmount = 0
      if ((selected.streak_bonus_type || 'pct') === 'pct') {
        bonusAmount = periodDeposit * (parseFloat(selected.streak_bonus_pct) || 0) / 100
      } else {
        bonusAmount = parseFloat(selected.streak_bonus_fixed) || 0
      }
      // Per-player cap override takes priority over campaign-level cap
      const playerRec = players.find(pl => pl.id === playerId)
      const playerCap = parseFloat(playerRec?.streak_bonus_cap_override) || 0
      const campaignCap = parseFloat(selected.streak_bonus_cap) || 0
      const effectiveCap = playerCap > 0 ? playerCap : campaignCap
      if (effectiveCap > 0) bonusAmount = Math.min(bonusAmount, effectiveCap)
      bonusAmount = Math.round(bonusAmount * 100) / 100

      // Payout date = period_end + 1 day
      const endDt = new Date(periodEnd + 'T00:00:00Z')
      endDt.setUTCDate(endDt.getUTCDate() + 1)
      const payoutDate = endDt.toISOString().slice(0, 10)

      const existingRec = awardedMap[sn]
      if (existingRec) {
        // Already awarded — update bonus_amount only if it changed AND status is still pending
        if (existingRec.payout_status === 'pending' && existingRec.bonus_amount !== bonusAmount) {
          const { error: upErr } = await supabase.from('campaign_streak_bonuses')
            .update({ bonus_amount: bonusAmount })
            .eq('id', existingRec.id)
          if (upErr) console.error('streak bonus update error', upErr)
        }
        continue
      }

      const { error: insertErr } = await supabase.from('campaign_streak_bonuses').insert({
        campaign_id: selected.id,
        campaign_player_id: playerId,
        streak_number: sn,
        period_start: periodStart,
        period_end: periodEnd,
        period_deposit: periodDeposit,
        bonus_amount: bonusAmount,
        payout_status: 'pending',
        payout_date: payoutDate,
      })
      if (insertErr) console.error('streak bonus insert error', insertErr)
    }

    await loadStreakBonuses(selected.id)
  }

  // ── Import from VIP snapshot data ───────────────────────────────────────────
  // Reads vip_daily_snapshots for the campaign date range (or selected date in
  // daily mode) and bulk-writes deposit + turnover for every campaign player
  // whose snapshot data exists. Players with no snapshot row are left unchanged.
  async function importFromVipData() {
    if (!selected || !players.length) return
    const startDate = isDailyMode ? entryDate : selected.start_date
    const endDate   = isDailyMode ? entryDate : selected.end_date
    if (!startDate || !endDate) { alert('Campaign dates are not set.'); return }

    const confirmed = window.confirm(
      isDailyMode
        ? `Import real deposit + turnover from VIP snapshot for ${entryDate}?\nThis will overwrite all values entered for that date.`
        : `Import real deposit + turnover from VIP snapshots (${fmtDate(startDate)} → ${fmtDate(endDate)})?\nThis will overwrite existing values for players found in the snapshot data.`
    )
    if (!confirmed) return

    setDailyLoading(true)
    const usernameSet = new Set(players.map(p => p.username))
    let all = [], from = 0
    const PAGE = 1000
    while (true) {
      const { data, error } = await supabase.from('vip_daily_snapshots')
        .select('username, snapshot_date, total_deposit, monthly_valid_bet')
        .gte('snapshot_date', startDate).lte('snapshot_date', endDate)
        .range(from, from + PAGE - 1)
      if (error) { alert('Failed to load snapshot data: ' + error.message); setDailyLoading(false); return }
      all = all.concat((data || []).filter(r => usernameSet.has(r.username)))
      if (!data || data.length < PAGE) break
      from += PAGE
    }

    // Aggregate per player: sum deposit + turnover across all days in range
    // Only count rows with genuine activity (monthly_valid_bet > 0)
    const activeRows = all.filter(r => (parseFloat(r.monthly_valid_bet) || 0) > 0)
    const byUsername = {}
    activeRows.forEach(r => {
      if (!byUsername[r.username]) byUsername[r.username] = { deposit: 0, validBet: 0 }
      byUsername[r.username].deposit  += parseFloat(r.total_deposit)    || 0
      byUsername[r.username].validBet += parseFloat(r.monthly_valid_bet) || 0
    })

    const playersByUsername = Object.fromEntries(players.map(p => [p.username, p]))
    const matched = Object.keys(byUsername).filter(u => playersByUsername[u])

    if (!matched.length) {
      alert('No matching players found in the snapshot data for this date range.')
      setDailyLoading(false)
      return
    }

    if (isDailyMode) {
      // Daily mode: upsert into daily_turnover_entries for selected date
      const upserts = matched.map(username => {
        const p = playersByUsername[username]
        const snap = byUsername[username]
        const dep = Math.round(snap.deposit)
        const to  = Math.round(snap.validBet)
        let tier_achieved_val = null, credit_reward_val = 0, wcash_reward_val = 0
        if (selected?.is_multi_level && campaignLevels?.length > 0) {
          const { levelOrder, creditReward } = calcLevelTierForDeposit(dep, campaignLevels)
          tier_achieved_val = levelOrder
          credit_reward_val = creditReward
        } else {
          const dualReward = calcDualTierReward(dep, to, rewardTiers)
          tier_achieved_val = dualReward.tierIndex >= 0 ? dualReward.tierIndex : null
          credit_reward_val = dualReward.creditAmount
          wcash_reward_val = dualReward.wcashAmount
        }
        return {
          campaign_id: selected.id,
          player_id: p.id,
          entry_date: entryDate,
          deposit_amount: dep,
          turnover_amount: to,
          tier_achieved: tier_achieved_val,
          credit_reward: credit_reward_val,
          wcash_reward: wcash_reward_val,
          entered_by: (profile?.full_name || 'Import') + ' (auto)',
          updated_at: new Date().toISOString(),
        }
      })
      const BATCH = 50
      for (let i = 0; i < upserts.length; i += BATCH) {
        const { error } = await supabase.from('daily_turnover_entries')
          .upsert(upserts.slice(i, i + BATCH), { onConflict: 'campaign_id,player_id,entry_date' })
        if (error) { alert('Batch upsert failed: ' + error.message); setDailyLoading(false); return }
      }
      await loadDailyEntries(selected.id, entryDate)
    } else {
      // Non-daily: update campaign_players.total_deposit + valid_bet one by one
      // (uses existing updatePlayer path so sync_manual_campaign_player_progress fires)
      for (const username of matched) {
        const p = playersByUsername[username]
        const snap = byUsername[username]
        const dep = Math.round(snap.deposit)
        const to  = Math.round(snap.validBet)
        const qualified = campType === 'dual_tier'
          ? calcDualTierReward(dep, to, rewardTiers).tierIndex >= 0
          : dep >= depTarget
        await supabase.from('campaign_players')
          .update({ total_deposit: dep, valid_bet: to, converted: qualified })
          .eq('id', p.id)
        // Sync campaign_period_deposit for all campaign types (including dual_tier)
        await supabase.rpc('sync_manual_campaign_player_progress', {
          p_campaign_player_id: p.id,
          p_campaign_period_deposit: dep,
        }).catch(e => console.error('progress sync failed for', username, e))
      }
      await loadPlayers(selected.id)
    }

    setDailyLoading(false)
    setMsg({ text: `✅ Imported data for ${matched.length} / ${players.length} players from VIP snapshots.`, ok: true })
    // Also refresh real financials
    loadRealFinancials(selected.start_date, selected.end_date, players)
  }

  async function runCampaignAnalysis() {
    if (!selected) return
    setAnalyzing(true)
    try {
      const totalPlayers = players.length
      const achievedCount = achieved.length
      const playersPayload = players.slice(0, 100).map(p => {
        let reward = 0, qualified = false, deposit = playerDeposit(p)
        if (campType === 'dual_tier' && isDailyMode) {
          const dailyTotal = summaryData?.playerRows?.find(r => r.username === p.username)
          reward = dailyTotal ? dailyTotal.credit + dailyTotal.wcash : 0
          qualified = !!dailyTotal && (dailyTotal.credit > 0 || dailyTotal.wcash > 0)
          deposit = realFinancials?.byPlayer?.[p.username]?.deposit ?? 0
        } else if (campType === 'dual_tier') {
          const r = calcDualTierReward(playerDeposit(p), p.valid_bet, rewardTiers)
          reward = r.creditAmount + r.wcashAmount
          qualified = r.tierIndex >= 0
        } else if (campType === 'leaderboard') {
          qualified = leaderboardQualified(p)
        } else {
          qualified = playerDeposit(p) >= depTarget
          reward = qualified ? calcReward(campType, playerDeposit(p), rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level) : 0
        }
        return { username: p.username, tier: p.tier, deposit, reward, qualified, paid: p.payout_status === 'paid' }
      })

      const result = await callAI('campaign-analysis', {
        campaignName: selected.campaign_name,
        campaignType: campType,
        startDate: selected.start_date,
        endDate: selected.end_date,
        budget: selected.budget_rm,
        currency: selected.platform === 'SG' ? 'SGD' : 'MYR',
        stats: {
          totalPlayers,
          achieved: achievedCount,
          successRate: totalPlayers > 0 ? Math.round(achievedCount / totalPlayers * 100) : 0,
          totalDeposit: (campType === 'dual_tier' && isDailyMode) ? Math.round(realFinancials?.deposit || 0) : totalDep,
          totalReward: totalReward,
        },
        players: playersPayload,
        language: lang,
      })
      setAiAnalysis(result.analysis)
    } catch (e) {
      alert('Could not generate analysis: ' + e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  function toggleTier(tier) { setForm(f => ({ ...f, target_tier: f.target_tier.includes(tier) ? f.target_tier.filter(t=>t!==tier) : [...f.target_tier, tier] })) }

  // ── Derived stats for detail modal ─────────────────────────────────────────
  const campType    = selected?.campaign_type || 'gold_bar'
  const campCurrency = campaignCurrency(selected?.platform)
  const depTarget   = selected?.deposit_target || 50000
  const rewardPct      = selected?.reward_pct || 6
  const rewardFixed    = selected?.reward_fixed || 3000
  const goldVal         = selected?.gold_bar_value || 3400
  const rewardCap       = selected?.reward_cap || null
  const rewardTiers     = selected?.reward_tiers || []
  const rewardDelivery  = selected?.reward_delivery || (campType==='gold_bar'?'gold_bar':'credit')
  const deliveryInfo    = REWARD_DELIVERY[rewardDelivery] || REWARD_DELIVERY.credit
  const typeInfo    = getCampaignTypeInfo(selected)
  const myName = profile?.full_name || 'the VIP team'
  const isDailyMode = campType === 'dual_tier' && selected?.settlement_frequency === 'daily'

  // Leaderboard settings used by the detail modal, WhatsApp helper, and ranking
  // calculations. Keep these derived from the selected campaign so every view
  // uses the same source of truth.
  const rankRewards = Array.isArray(selected?.rank_rewards) ? selected.rank_rewards : []
  const minBetTarget = parseFloat(selected?.min_valid_bet) || 0
  const minDepLb = parseFloat(selected?.min_deposit_lb) || 0
  const topN = Math.max(0, parseInt(selected?.top_n) || rankRewards.length || 0)

  // Campaign-period deposit is the authoritative qualification value whenever
  // the campaign explicitly requires a period deposit. Fall back to total_deposit
  // for legacy/non-period campaigns.
  const playerDeposit = (p) => selected?.requires_period_deposit === false
    ? (parseFloat(p?.total_deposit) || 0)
    : (parseFloat(p?.campaign_period_deposit) || 0)

  useEffect(() => {
    if (isDailyMode && selected?.id && entryDate) loadDailyEntries(selected.id, entryDate)
  }, [isDailyMode, selected?.id, entryDate])

  // Load all daily entries when switching to streak or inactive tab
  useEffect(() => {
    if (isDailyMode && selected?.id && (activeTab === 'streak' || activeTab === 'inactive')) {
      loadAllDailyEntries(selected.id)
    }
  }, [isDailyMode, selected?.id, activeTab])

  useEffect(() => {
    if (isDailyMode && selected?.id) loadCampaignSummary(selected.id)
  }, [isDailyMode, activeTab, selected?.id])

  useEffect(() => {
    if (selected?.start_date && selected?.end_date && players.length > 0) {
      loadRealFinancials(selected.start_date, selected.end_date, players)
    }
  }, [selected?.id, selected?.start_date, selected?.end_date, players.length])

  async function loadCampaignSummary(campaignId) {
    setSummaryLoading(true)
    const { data, error } = await supabase.from('daily_turnover_entries')
      .select('player_id, entry_date, deposit_amount, turnover_amount')
      .eq('campaign_id', campaignId)
      .order('entry_date', { ascending: true })
    if (error) { console.error('loadCampaignSummary error', error); setSummaryData(null); setSummaryLoading(false); return }

    // Always recompute credit/wcash fresh from deposit_amount + turnover_amount
    // against the campaign's CURRENT tier settings — never trust the stored
    // credit_reward/wcash_reward columns. For is_multi_level campaigns, use
    // campaign_levels thresholds (deposit only). For standard dual_tier, both
    // deposit and turnover must meet the tier thresholds.
    const isMultiLevelDaily = selected?.is_multi_level && campaignLevels?.length > 0
    const entries = (data || [])
      .filter(e => isMultiLevelDaily
        ? (parseFloat(e.deposit_amount) || 0) > 0
        : (parseFloat(e.turnover_amount) || 0) > 0)
      .map(e => {
        const dep = parseFloat(e.deposit_amount) || 0
        if (isMultiLevelDaily) {
          const { levelOrder, creditReward } = calcLevelTierForDeposit(dep, campaignLevels)
          return { ...e, tier_achieved: levelOrder, credit_reward: creditReward, wcash_reward: 0 }
        }
        const r = calcDualTierReward(dep, e.turnover_amount, rewardTiers)
        return { ...e, tier_achieved: r.tierIndex >= 0 ? r.tierIndex : null, credit_reward: r.creditAmount, wcash_reward: r.wcashAmount }
      })

    const qualifyingEntries = entries.filter(e => (e.credit_reward || 0) > 0).length
    const uniqueParticipants = new Set(entries.filter(e => (e.credit_reward || 0) > 0).map(e => e.player_id)).size
    const totalCredit = entries.reduce((s, e) => s + e.credit_reward, 0)
    const totalWcash = entries.reduce((s, e) => s + e.wcash_reward, 0)

    // Per-level player counts for is_multi_level daily campaigns
    const levelPlayerCounts = {}
    if (isMultiLevelDaily) {
      const sortedLevels = [...campaignLevels].sort((a, b) => Number(a.deposit_threshold) - Number(b.deposit_threshold))
      sortedLevels.forEach(level => { levelPlayerCounts[level.id] = new Set() })
      entries.forEach(e => {
        sortedLevels.forEach(level => {
          if ((parseFloat(e.deposit_amount) || 0) >= (Number(level.deposit_threshold) || 0)) {
            levelPlayerCounts[level.id].add(e.player_id)
          }
        })
      })
      sortedLevels.forEach(level => { levelPlayerCounts[level.id] = levelPlayerCounts[level.id].size })
    }

    const tierHitCounts = {}
    ;(rewardTiers || []).forEach((t, i) => { tierHitCounts[i] = 0 })
    entries.forEach(e => { if (e.tier_achieved !== null) tierHitCounts[e.tier_achieved] = (tierHitCounts[e.tier_achieved] || 0) + 1 })

    const playerMap = {}
    players.forEach(p => { playerMap[p.id] = p })

    // Deposit totals from ALL raw entries (not just qualifying ones)
    const depositByPlayer = {}
    ;(data || []).forEach(e => {
      if (!depositByPlayer[e.player_id]) depositByPlayer[e.player_id] = 0
      depositByPlayer[e.player_id] += parseFloat(e.deposit_amount) || 0
    })

    const byPlayer = {}
    entries.forEach(e => {
      if (!byPlayer[e.player_id]) byPlayer[e.player_id] = { credit: 0, wcash: 0, days: 0 }
      byPlayer[e.player_id].credit += e.credit_reward
      byPlayer[e.player_id].wcash += e.wcash_reward
      byPlayer[e.player_id].days += 1
    })
    const playerRows = Object.entries(byPlayer).map(([playerId, v]) => ({
      username: playerMap[playerId]?.username || playerId, tier: playerMap[playerId]?.tier,
      credit: v.credit, wcash: v.wcash, days: v.days,
      paid: playerMap[playerId]?.payout_status === 'paid',
    })).sort((a, b) => (b.credit + b.wcash) - (a.credit + a.wcash))

    // Paid vs pending, kept as separate Credit/WCash totals throughout —
    // Credit and WCash are different reward types and must never be added
    // together into one blended figure.
    const paidCredit = playerRows.filter(r => r.paid).reduce((s, r) => s + r.credit, 0)
    const paidWcash = playerRows.filter(r => r.paid).reduce((s, r) => s + r.wcash, 0)
    const pendingCredit = playerRows.filter(r => !r.paid).reduce((s, r) => s + r.credit, 0)
    const pendingWcash = playerRows.filter(r => !r.paid).reduce((s, r) => s + r.wcash, 0)

    setSummaryData({ uniqueParticipants, qualifyingEntries, totalCredit, totalWcash, tierHitCounts, playerRows, totalEntryDays: new Set(entries.map(e => e.entry_date)).size, paidCredit, paidWcash, pendingCredit, pendingWcash, levelPlayerCounts, depositByPlayer })
    setSummaryLoading(false)
  }

  // Real deposit/withdrawal/turnover for the campaign period, pulled from
  // actual platform data (vip_daily_snapshots) — not the manually-entered
  // campaign_players/daily_turnover_entries numbers, which exist purely to
  // judge reward qualification. This is "what genuinely happened" for
  // evaluating whether the campaign was profitable, and applies to every
  // campaign type, not just Daily Turnover.
  async function loadRealFinancials(startDate, endDate, playerList) {
    if (!startDate || !endDate || !playerList?.length) { setRealFinancials(null); return }
    setRealFinancialsLoading(true)
    const usernameSet = new Set(playerList.map(p => p.username))
    // Filtered by date range only (campaigns run days-to-weeks, so this stays
    // small) then joined client-side — avoids .in('username', largeArray),
    // which silently fails past a certain array size on this project.
    let all = [], from = 0
    const PAGE = 1000
    while (true) {
      const { data, error } = await supabase.from('vip_daily_snapshots')
        .select('username, snapshot_date, total_deposit, total_withdrawal, monthly_valid_bet')
        .gte('snapshot_date', startDate).lte('snapshot_date', endDate)
        .range(from, from + PAGE - 1)
      if (error) { console.error('loadRealFinancials error', error); break }
      all = all.concat((data || []).filter(r => usernameSet.has(r.username)))
      if (!data || data.length < PAGE) break
      from += PAGE
    }
    // Only trust deposit/withdrawal on days with genuine activity — the
    // platform's raw export carries stale non-zero values on inactive days,
    // only monthly_valid_bet reliably zeroes out. Same rule used everywhere
    // else in this project.
    const activeRows = all.filter(r => (parseFloat(r.monthly_valid_bet) || 0) > 0)
    const byPlayer = {}
    activeRows.forEach(r => {
      if (!byPlayer[r.username]) byPlayer[r.username] = { deposit: 0, withdrawal: 0, validBet: 0 }
      byPlayer[r.username].deposit += parseFloat(r.total_deposit) || 0
      byPlayer[r.username].withdrawal += parseFloat(r.total_withdrawal) || 0
      byPlayer[r.username].validBet += parseFloat(r.monthly_valid_bet) || 0
    })
    const totals = Object.values(byPlayer).reduce((s, v) => ({
      deposit: s.deposit + v.deposit, withdrawal: s.withdrawal + v.withdrawal, validBet: s.validBet + v.validBet,
    }), { deposit: 0, withdrawal: 0, validBet: 0 })
    setRealFinancials({ byPlayer, ...totals })
    setRealFinancialsLoading(false)
  }

  // Builds a progress-aware WhatsApp message: tells the player exactly how
  // Builds the pre-filled WhatsApp message body for a player.
  // If the campaign has a whatsapp_template set, that template takes priority
  // (with {username}, {campaign}, {agent}, {gap} substituted).
  // Otherwise falls back to the progress-aware smart message.
  function buildCampaignWaMessage(p, extra) {
    const rawNumber = (p.whatsapp || '').replace(/\D/g, '')
    if (!rawNumber || rawNumber.length < 10) return null
    const campName = selected?.campaign_name || 'this campaign'
    let body

    // ── Calculate gap once (used by both EN and ZH templates) ─────────────────
    let gapStr = ''
    if (campType === 'dual_tier') {
      const nextTier = (rewardTiers||[]).find(t => playerDeposit(p) < (parseFloat(t.depositThreshold)||0) || (parseFloat(p.valid_bet)||0) < (parseFloat(t.turnoverThreshold)||0))
      if (nextTier) {
        const dg = Math.max(0, (parseFloat(nextTier.depositThreshold)||0) - playerDeposit(p))
        gapStr = `RM${dg.toLocaleString()}`
      }
    } else if (campType !== 'leaderboard') {
      const dep = playerDeposit(p)
      if (dep < depTarget) gapStr = `RM${(depTarget - dep).toLocaleString()}`
    }
    const fillTemplate = (tpl) => tpl
      .replace(/\{username\}/g, p.username || '')
      .replace(/\{campaign\}/g, campName)
      .replace(/\{agent\}/g, myName)
      .replace(/\{gap\}/g, gapStr)

    // ── Campaign-level custom template (overrides smart message) ──────────────
    if (selected?.whatsapp_template || selected?.whatsapp_template_zh) {
      const enBody = selected?.whatsapp_template ? fillTemplate(selected.whatsapp_template) : null
      const zhBody = selected?.whatsapp_template_zh ? fillTemplate(selected.whatsapp_template_zh) : null
      // Default: ZH if available, else EN
      body = zhBody || enBody
      return { rawNumber, body, enBody, zhBody }
    }

    // ── Smart progress-aware message ──────────────────────────────────────────
    if (selected?.is_multi_level && campType === 'fixed_reward') {
      const metric = multiMetricsByPlayer[p.id]
      const dep = playerDeposit(p)
      if (metric?.allCompleted) {
        body = `Hi ${p.username}, great news — you've unlocked all levels of ${campName}! Your total unlocked reward is RM${(metric.qualifiedRewardTotal||0).toLocaleString()}. This is ${myName}.`
      } else if (metric?.completedCount > 0 && metric?.nextLevel) {
        const gap = Math.max(0, Number(metric.nextLevel.deposit_threshold) - dep)
        body = `Hi ${p.username}, you've unlocked ${metric.completedCount} level${metric.completedCount>1?'s':''} in ${campName}. You need RM${gap.toLocaleString()} more deposit to unlock ${metric.nextLevel.level_name} and RM${Number(metric.nextLevel.reward_amount||0).toLocaleString()} Credit. This is ${myName}.`
      } else if (metric?.nextLevel) {
        const gap = Math.max(0, Number(metric.nextLevel.deposit_threshold) - dep)
        body = `Hi ${p.username}, you're on your way in ${campName}! You need RM${gap.toLocaleString()} more deposit to unlock ${metric.nextLevel.level_name} and RM${Number(metric.nextLevel.reward_amount||0).toLocaleString()} Credit. This is ${myName}.`
      } else {
        body = `Hi ${p.username}, checking in on ${campName} — let us know if you need anything. This is ${myName}.`
      }
    } else if (campType === 'dual_tier') {
      const result = calcDualTierReward(playerDeposit(p), p.valid_bet, rewardTiers)
      if (result.tierIndex >= 0) {
        body = `Hi ${p.username}, great news — you've completed ${campName}! You've qualified for RM${result.creditAmount} Credit + RM${result.wcashAmount} WCash. This is ${myName}, let us know if you have questions.`
      } else {
        const nextTier = (rewardTiers||[]).find(tier => playerDeposit(p) < (parseFloat(tier.depositThreshold)||0) || (parseFloat(p.valid_bet)||0) < (parseFloat(tier.turnoverThreshold)||0))
        if (nextTier) {
          const depGap = Math.max(0, (parseFloat(nextTier.depositThreshold)||0) - playerDeposit(p))
          const vbGap = Math.max(0, (parseFloat(nextTier.turnoverThreshold)||0) - (parseFloat(p.valid_bet)||0))
          body = `Hi ${p.username}, you're on your way in ${campName}! You need RM${depGap.toLocaleString()} more deposit and RM${vbGap.toLocaleString()} more turnover to earn RM${nextTier.creditAmount} Credit + RM${nextTier.wcashAmount} WCash. This is ${myName}.`
        } else {
          body = `Hi ${p.username}, checking in on ${campName} — let us know if you need anything. This is ${myName}.`
        }
      }
    } else if (campType === 'leaderboard') {
      const vb = extra?.vb ?? (parseFloat(p.valid_bet) || 0)
      const inTop = extra?.inTop
      const reward = extra?.reward || 0
      const gap = extra?.gap
      if (inTop) {
        body = `Hi ${p.username}, great news — you're currently in the Top ${topN} for ${campName}! If this holds, you'll receive RM${reward}. This is ${myName}.`
      } else if (gap != null) {
        body = `Hi ${p.username}, you're close in ${campName}! You need RM${Math.round(gap).toLocaleString()} more valid bet to reach the Top ${topN}. This is ${myName}.`
      } else {
        body = `Hi ${p.username}, checking in on ${campName} — let us know if you need anything. This is ${myName}.`
      }
    } else {
      const dep = playerDeposit(p)
      const qualified = dep >= depTarget
      if (qualified) {
        const reward = calcReward(campType, dep, rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level)
        body = `Hi ${p.username}, great news — you've completed ${campName}! You'll receive RM${reward.toLocaleString()}. This is ${myName}, let us know if you have questions.`
      } else {
        const gap = depTarget - dep
        body = `Hi ${p.username}, you're close to completing ${campName}! You need RM${gap.toLocaleString()} more in deposits to qualify. This is ${myName}.`
      }
    }
    return { rawNumber, body }
  }
  function CampaignWaButton({ p, extra }) {
    const result = buildCampaignWaMessage(p, extra)
    if (!result) return <span style={{ color:'var(--muted)' }}>—</span>
    return (
      <button onClick={e=>{e.stopPropagation();setWaPopup({ rawNumber: result.rawNumber, message: result.body, enBody: result.enBody||null, zhBody: result.zhBody||null })}}
        style={{ display:'inline-flex', width:26, height:26, borderRadius:13, background:'#25D366', color:'#fff', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, border:'none', cursor:'pointer' }}>W</button>
    )
  }

  const totalDep    = players.reduce((s,p)=>s+playerDeposit(p),0)

  const multiMetricsByPlayer = Object.fromEntries(players.map(p => [p.id, buildMultiLevelPlayerMetrics(p, campaignLevels, campaignPlayerLevels)]))
  const multiPayoutRows = buildPayoutRows(players, campaignLevels, campaignPlayerLevels, campaignRewards, selected?.payout_mode || 'all')
  const multiSummary = buildCampaignSummary(players, campaignLevels, campaignPlayerLevels, campaignRewards)

  // ── Leaderboard-specific ranking/qualification
  const leaderboardMetric = ['turnover','deposit','turnover_deposit'].includes(selected?.leaderboard_metric)
    ? selected.leaderboard_metric : 'turnover'
  const leaderboardRankingValue = (p) => leaderboardMetric === 'deposit'
    ? playerDeposit(p) : (parseFloat(p.valid_bet) || 0)
  const leaderboardQualified = (p) => {
    const vb = parseFloat(p.valid_bet) || 0
    const dep = playerDeposit(p)
    if (leaderboardMetric === 'deposit') return dep >= minDepLb
    if (leaderboardMetric === 'turnover_deposit') return vb >= minBetTarget && dep >= minDepLb
    return vb >= minBetTarget
  }
  const lbRanked = campType === 'leaderboard'
    ? [...players].sort((a,b) => leaderboardRankingValue(b) - leaderboardRankingValue(a) || String(a.username||'').localeCompare(String(b.username||''))).map((p,i) => {
        const qualified = leaderboardQualified(p)
        const rank = i + 1
        const inTop = rank <= topN
        const reward = inTop && qualified ? (parseFloat(rankRewards[rank-1]?.amount)||0) : 0
        return { ...p, _vb:parseFloat(p.valid_bet)||0, _deposit:playerDeposit(p), _rankingValue:leaderboardRankingValue(p), _posRank:rank, _rank:rank, _inTop:inTop && qualified, _reward:reward, _qualified:qualified }
      }) : []
  const cutoffValue = campType==='leaderboard' && lbRanked[topN-1] ? lbRanked[topN-1]._rankingValue : null

  const achieved = campType === 'leaderboard' ? lbRanked.filter(p=>p._qualified)
    : campType === 'dual_tier' && isDailyMode ? players.filter(p=>summaryData?.playerRows?.some(r=>r.username===p.username && (r.credit>0 || r.wcash>0)))
    : campType === 'dual_tier' ? players.filter(p=>calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers).tierIndex>=0)
    : selected?.is_multi_level ? players.filter(p=>multiMetricsByPlayer[p.id]?.completedCount>0)
    : players.filter(p=>playerDeposit(p)>=depTarget)

  const dailyAchieved = isDailyMode ? players.filter(p=>dailyEntries[p.id]?.tier_achieved!==null && dailyEntries[p.id]?.tier_achieved!==undefined) : []
  const nearTarget = campType === 'leaderboard' ? lbRanked.filter(p=>{
      if (p._qualified) return false
      if (leaderboardMetric === 'turnover_deposit') return Math.min(minBetTarget?p._vb/minBetTarget:0, minDepLb?p._deposit/minDepLb:0) >= 0.7
      const target = leaderboardMetric === 'deposit' ? minDepLb : minBetTarget
      return target > 0 && p._rankingValue/target >= 0.7
    })
    : campType === 'dual_tier' ? []
    : selected?.is_multi_level ? players.filter(p=>{const m=multiMetricsByPlayer[p.id],n=m?.nextLevel,dep=playerDeposit(p);return n&&Number(n.deposit_threshold)>0&&dep/Number(n.deposit_threshold)>=0.7&&dep<Number(n.deposit_threshold)})
    : players.filter(p=>{const pct=depTarget?playerDeposit(p)/depTarget:0;return pct>=0.7&&pct<1})
  const inProgress = campType === 'leaderboard' ? lbRanked.filter(p=>!p._qualified && !nearTarget.includes(p))
    : campType === 'dual_tier' ? players.filter(p=>calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers).tierIndex<0)
    : selected?.is_multi_level ? players.filter(p=>{const m=multiMetricsByPlayer[p.id],n=m?.nextLevel;return !m?.allCompleted&&(!n||playerDeposit(p)<Number(n.deposit_threshold)*0.7)})
    : players.filter(p=>{const pct=depTarget?playerDeposit(p)/depTarget:0;return pct<0.7})

  const totalReward = campType === 'leaderboard' ? rankRewards.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)
    : campType === 'dual_tier' && isDailyMode ? (summaryData ? summaryData.totalCredit + summaryData.totalWcash : 0)
    : campType === 'dual_tier' ? achieved.reduce((s,p)=>{const r=calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers);return s+r.creditAmount+r.wcashAmount},0)
    : selected?.is_multi_level ? multiPayoutRows.reduce((s,r)=>s+r.rewardAmount,0)
    : achieved.reduce((s,p)=>s+calcReward(campType,playerDeposit(p),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level),0)
  const paidOut = campType === 'leaderboard' ? lbRanked.filter(p=>p._inTop&&p.payout_status==='paid').reduce((s,p)=>s+p._reward,0)
    : campType === 'dual_tier' && isDailyMode ? (summaryData ? summaryData.paidCredit + summaryData.paidWcash : 0)
    : campType === 'dual_tier' ? players.filter(p=>p.payout_status==='paid').reduce((s,p)=>{const r=calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers);return s+r.creditAmount+r.wcashAmount},0)
    : selected?.is_multi_level ? multiPayoutRows.filter(r=>r.status==='paid').reduce((s,r)=>s+r.rewardAmount,0)
    : players.filter(p=>p.payout_status==='paid').reduce((s,p)=>s+calcReward(campType,playerDeposit(p),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level),0)
  const pendingPay = Math.max(0,totalReward-paidOut)
  const chaseList = campType==='leaderboard' ? lbRanked : [...players].sort((a,b)=>playerDeposit(b)-playerDeposit(a))
  const chaseHosts = ['all', ...Array.from(new Set(chaseList.map(p => p.host_assigned).filter(Boolean))).sort()]
  const filteredChaseList = (() => {
    const filtered = chaseList.filter(p => {
      const matchesHost = hostFilter === 'all' || p.host_assigned === hostFilter
      const matchesSearch = !chaseFilter.trim() || (p.username||'').toLowerCase().includes(chaseFilter.toLowerCase()) || (p.full_name||'').toLowerCase().includes(chaseFilter.toLowerCase())
      return matchesHost && matchesSearch
    })
    const sm = chaseSortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (chaseSort === 'name') return sm * (a.username||'').localeCompare(b.username||'')
      if (chaseSort === 'reward') {
        const rA = isDailyMode ? (dailyEntries[a.id]?.credit_reward || 0) : calcLevelTierForDeposit(playerDeposit(a), campaignLevels).creditReward
        const rB = isDailyMode ? (dailyEntries[b.id]?.credit_reward || 0) : calcLevelTierForDeposit(playerDeposit(b), campaignLevels).creditReward
        return sm * (rA - rB)
      }
      return sm * (playerDeposit(a) - playerDeposit(b))
    })
  })()
  const filteredPayoutList = (() => {
    const base = isDailyMode ? dailyAchieved : achieved
    const hostFiltered = payoutHostFilter === 'all' ? base : base.filter(p => p.host_assigned === payoutHostFilter)
    const srch = payoutSearch.trim().toLowerCase()
    const filtered = srch ? hostFiltered.filter(p => (p.username||'').toLowerCase().includes(srch) || (p.full_name||'').toLowerCase().includes(srch)) : hostFiltered
    const sm = payoutSortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (payoutSort === 'name') return sm * (a.username||'').localeCompare(b.username||'')
      if (payoutSort === 'reward') {
        const rA = isDailyMode ? (dailyEntries[a.id]?.credit_reward || 0) : calcReward(campType, playerDeposit(a), rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level)
        const rB = isDailyMode ? (dailyEntries[b.id]?.credit_reward || 0) : calcReward(campType, playerDeposit(b), rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level)
        return sm * (rA - rB)
      }
      const dA = isDailyMode ? (parseFloat(dailyEntries[a.id]?.deposit_amount) || 0) : playerDeposit(a)
      const dB = isDailyMode ? (parseFloat(dailyEntries[b.id]?.deposit_amount) || 0) : playerDeposit(b)
      return sm * (dA - dB)
    })
  })()
  function copyUsername(id, username) {
    navigator.clipboard.writeText(username).catch(()=>{})
    setCopiedId(id)
    setTimeout(() => setCopiedId(c => c === id ? null : c), 1500)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>📢 {t('campaigns.title')}</div>
          <div style={s.sub}>{t('campaigns.subtitle')}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <select style={{ ...s.smInput, padding:'7px 12px' }} value={filterType} onChange={e=>setFilterType(e.target.value)}>
            <option value="ALL">All Types</option>
            {Object.entries(CAMPAIGN_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </select>
          <select style={{ ...s.smInput, padding:'7px 12px' }} value={filterStat} onChange={e=>setFilterStat(e.target.value)}>
            <option value="ALL">All Status</option>
            {['draft','active','paused','ended'].map(s=><option key={s}>{s}</option>)}
          </select>
          <select style={{ ...s.smInput, padding:'7px 12px' }} value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}>
            <option value="ALL">All Months</option>
            {monthOptions.map(mo=><option key={mo} value={mo}>{mo}</option>)}
          </select>
          <button style={s.btn} onClick={()=>{ setForm(blankForm); setMsg({text:'',ok:true}); setModal('create') }}>＋ {t('campaigns.newCampaign')}</button>
        </div>
      </div>

      {/* Campaign cards */}
      {loading ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Loading...</div>
      ) : campaigns.length === 0 ? (
        <div style={{ ...s.card, padding:40, textAlign:'center', color:'var(--muted)' }}>
          No campaigns yet. <span style={{ color:'var(--accent)', cursor:'pointer' }} onClick={()=>{ setForm(blankForm); setModal('create') }}>Create one →</span>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:12 }}>
          {campaigns.map(camp => {
            const ct = camp.campaign_type || 'gold_bar'
            const ti = getCampaignTypeInfo(camp)
            return (
              <div key={camp.id} style={{ ...s.card, cursor:'pointer', transition:'border-color .15s' }}
                onClick={async () => {
                  setSelected(camp); setActiveTab('chase'); setModal('detail'); setChaseFilter(''); setHostFilter('all')
                  const today = new Date().toISOString().slice(0,10)
                  const inRange = camp.start_date && camp.end_date && today >= camp.start_date && today <= camp.end_date
                  setEntryDate(inRange ? today : (camp.start_date || today))
                }}
                onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
                onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
                <div style={{ padding:'14px 16px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                    <span style={{ ...s.tag(ti.color), fontSize:11 }}>{ti.label}</span>
                    <span style={{ ...s.tag(STATUS_COLOR[camp.status], STATUS_BG[camp.status]), fontSize:11 }}>{camp.status}</span>
                    {camp.platform && <span style={{ ...s.tag('#8b949e'), fontSize:11 }}>{camp.platform}</span>}
                  </div>
                  <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{camp.campaign_name}</div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>
                    {camp.campaign_code} · {fmtDate(camp.start_date)} → {fmtDate(camp.end_date)}
                  </div>
                  <div style={{ display:'flex', gap:16, fontSize:12 }}>
                    {ct==='leaderboard'
                      ? <span style={{ color:'var(--muted)' }}>Min Turnover: <strong style={{ color:'var(--text)' }}>{rmFmt(camp.min_valid_bet, campaignCurrency(camp.platform))}</strong></span>
                      : <span style={{ color:'var(--muted)' }}>Min: <strong style={{ color:'var(--text)' }}>{rmFmt(camp.deposit_target, campaignCurrency(camp.platform))}</strong></span>}
                    {ct==='pct_reward'   && <span style={{ color:'#3fb950' }}>Reward: <strong>{camp.reward_pct||6}%{camp.reward_cap?` (max ${rmFmt(camp.reward_cap, campaignCurrency(camp.platform))})`:''}</strong></span>}
                    {ct==='fixed_reward' && camp.is_multi_level && <span style={{ color:'#b9f2ff' }}>Levels: <strong>{camp.max_levels || 0}</strong> · Credit</span>}
                     {ct==='fixed_reward' && !camp.is_multi_level && <span style={{ color:'#b9f2ff' }}>Reward: <strong>{rmFmt(camp.reward_fixed, campaignCurrency(camp.platform))}</strong></span>}
                    {ct==='tiered_reward' && <span style={{ color:'#f0883e' }}>Tiers: <strong>{camp.reward_tiers?.length||0} levels</strong></span>}
                    {ct==='gold_bar'     && <span style={{ color:'#ffd700' }}>Gold Bar: <strong>{rmFmt(camp.gold_bar_value, campaignCurrency(camp.platform))}</strong></span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── CREATE MODAL ── */}
      {modal === 'create' && (
        <div style={s.overlay} onClick={e=>e.target===e.currentTarget&&closeModal()}>
          <div style={s.modal}>
            <div style={s.mhdr}>
              <div style={{ fontSize:16, fontWeight:700 }}>📣 {t('campaigns.newCampaign')}</div>
              <button onClick={closeModal} style={{ background:'none',border:'none',color:'var(--muted)',fontSize:20,cursor:'pointer' }}>×</button>
            </div>
            <div style={{ padding:'20px 24px' }}>

              {/* Campaign Type Picker */}
              <div style={s.frow}>
                <div style={s.flbl}>{t('campaigns.campaignType')} *</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
                  {Object.entries(CAMPAIGN_TYPES).map(([k,v]) => (
                    <div key={k} onClick={()=>setForm(f=>({...f,campaign_type:k,
                        reward_tiers: k==='dual_tier'
                          ? [{depositThreshold:'10000',turnoverThreshold:'50000',creditAmount:'200',wcashAmount:'200'}]
                          : k==='tiered_reward'
                          ? [{min:'10000',max:'29999',pct:'1.5'},{min:'30000',max:'49999',pct:'3'},{min:'50000',max:'',pct:'6'}]
                          : f.reward_tiers}))}
                      style={{ flex:1, minWidth:140, padding:'12px 14px', borderRadius:10, cursor:'pointer',
                        border:`2px solid ${form.campaign_type===k?v.color:'var(--border)'}`,
                        background: form.campaign_type===k?v.color+'11':'var(--surface2)',
                        transition:'all .15s' }}>
                      <div style={{ fontSize:14, fontWeight:700, color:form.campaign_type===k?v.color:'var(--text)' }}>{v.label}</div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{v.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={s.g2}>
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.campaignName')} *</div><input style={s.finput} value={form.campaign_name} onChange={e=>setForm({...form,campaign_name:e.target.value})} placeholder="e.g. June Deposit Reward" /></div>
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.campaignCode')}</div><input style={s.finput} value={form.campaign_code} onChange={e=>setForm({...form,campaign_code:e.target.value.toUpperCase()})} placeholder="e.g. DEP-REWARD-JUN26" /></div>
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.platform')}</div>
                  <select style={s.fsel} value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>
                    {PLATFORMS.map(p=><option key={p}>{p}</option>)}
                  </select>
                </div>
                <div style={s.frow}><div style={s.flbl}>{t('common.status')}</div>
                  <select style={s.fsel} value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>
                    {['draft','upcoming','active','paused','ended'].map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.startDate')}</div><input type="date" style={s.finput} value={form.start_date} onChange={e=>setForm({...form,start_date:e.target.value})} /></div>
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.endDate')}</div><input type="date" style={s.finput} value={form.end_date} onChange={e=>setForm({...form,end_date:e.target.value})} /></div>
                {form.campaign_type !== 'leaderboard' && (
                  <div style={s.frow}><div style={s.flbl}>{t('campaigns.minDepositTarget')}</div><input type="number" style={s.finput} value={form.deposit_target} onChange={e=>setForm({...form,deposit_target:e.target.value})} /></div>
                )}
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.budget')}</div><input type="number" style={s.finput} value={form.budget_rm} onChange={e=>setForm({...form,budget_rm:e.target.value})} /></div>

                {/* Type-specific reward fields */}
                {form.campaign_type === 'pct_reward' && (
                  <div style={s.frow}>
                    <div style={s.flbl}>Reward % (e.g. 6 = 6%)</div>
                    <input type="number" style={s.finput} value={form.reward_pct} onChange={e=>setForm({...form,reward_pct:e.target.value})} placeholder="6" />
                    <div style={{ fontSize:11, color:'#3fb950', marginTop:4 }}>
                      e.g. RM 50,000 × {form.reward_pct||6}% = {rmFmt((parseFloat(form.deposit_target)||50000)*(parseFloat(form.reward_pct)||6)/100)} reward
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:8 }}>
                      <label style={{ fontSize:12, color:'var(--muted)', display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                        <input type="checkbox" checked={form.has_cap} onChange={e=>setForm({...form,has_cap:e.target.checked,reward_cap:''})} />
                        Max reward cap?
                      </label>
                      {form.has_cap && (
                        <div style={{ flex:1 }}>
                          <input type="number" style={{ ...s.finput }} value={form.reward_cap} onChange={e=>setForm({...form,reward_cap:e.target.value})} placeholder="e.g. 5000 (max payout)" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {form.campaign_type === 'fixed_reward' && (
                  <div style={s.frow}>
                    <div style={s.flbl}>Fixed Reward Amount (RM)</div>
                    <input type="number" style={s.finput} value={form.reward_fixed} onChange={e=>setForm({...form,reward_fixed:e.target.value})} placeholder="3000" />
                  </div>
                )}
                {form.campaign_type === 'gold_bar' && (
                  <div style={s.frow}>
                    <div style={s.flbl}>Gold Bar Value (RM)</div>
                    <input type="number" style={s.finput} value={form.gold_bar_value} onChange={e=>setForm({...form,gold_bar_value:e.target.value})} placeholder="3400" />
                  </div>
                )}
              </div>


              </div>

              {/* Tiered Reward Builder */}
              {form.campaign_type === 'tiered_reward' && (
                <div style={{ ...s.frow, gridColumn:'1/-1' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={s.flbl}>REWARD TIERS (deposit range → reward %)</div>
                    <button type="button" style={{ ...s.btnSm, fontSize:11 }}
                      onClick={()=>setForm(f=>({...f,reward_tiers:[...f.reward_tiers,{min:'',max:'',pct:''}]}))}>
                      + Add Tier
                    </button>
                  </div>
                  <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:0, padding:'6px 12px', background:'var(--surface2)', fontSize:11, color:'var(--muted)', fontWeight:700 }}>
                      <span>MIN DEPOSIT (RM)</span><span>MAX DEPOSIT (RM)</span><span>REWARD %</span><span></span>
                    </div>
                    {form.reward_tiers.map((tier, i) => (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:8, padding:'8px 12px', borderTop:'1px solid var(--border)', alignItems:'center' }}>
                        <input type="number" style={s.smInput} value={tier.min} placeholder="e.g. 10000"
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],min:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <input type="number" style={s.smInput} value={tier.max} placeholder="blank = no limit"
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],max:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <input type="number" style={{ ...s.smInput, width:70 }} value={tier.pct} placeholder="e.g. 6"
                            onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],pct:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                          <span style={{ fontSize:12, color:'var(--muted)' }}>%</span>
                          {tier.min && tier.pct && (
                            <span style={{ fontSize:11, color:'#3fb950' }}>
                              e.g. {rmFmt(parseFloat(tier.min))} × {tier.pct}% = {rmFmt(parseFloat(tier.min)*parseFloat(tier.pct)/100)}
                            </span>
                          )}
                        </div>
                        <button type="button" onClick={()=>{ const t=form.reward_tiers.filter((_,j)=>j!==i); setForm(f=>({...f,reward_tiers:t})) }}
                          style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:12, cursor:'pointer' }}>✕</button>
                      </div>
                    ))}
                    {form.reward_tiers.length === 0 && (
                      <div style={{ padding:'12px', fontSize:12, color:'var(--muted)', textAlign:'center' }}>No tiers yet — click "+ Add Tier"</div>
                    )}
                  </div>
                </div>
              )}

              {/* Dual Tier (Deposit + Turnover) Builder */}
              {form.campaign_type === 'dual_tier' && (
                <div style={{ ...s.frow, gridColumn:'1/-1' }}>
                  <div style={{ marginBottom:14 }}>
                    <div style={s.flbl}>Settlement Frequency</div>
                    <div style={{ display:'flex', gap:16, marginTop:6 }}>
                      {[['total','Total — accumulates across the whole campaign period'],['daily','Daily — each day settles independently, does not carry over']].map(([v,label]) => (
                        <label key={v} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer' }}>
                          <input type="radio" checked={(form.settlement_frequency||'total')===v} onChange={()=>setForm(f=>({...f,settlement_frequency:v}))} />
                          {label}
                        </label>
                      ))}
                    </div>
                    {form.settlement_frequency==='daily' && (
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>
                        Daily settlement uses a separate day-by-day entry screen on the campaign detail page, once this campaign is created.
                      </div>
                    )}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={s.flbl}>TIERS — must reach turnover to earn that tier's reward{form.settlement_frequency!=='daily' && ' (and deposit, if set)'}</div>
                    <button type="button" style={{ ...s.btnSm, fontSize:11 }}
                      onClick={()=>setForm(f=>({...f,reward_tiers:[...f.reward_tiers,{depositThreshold:'',turnoverThreshold:'',creditAmount:'',wcashAmount:''}]}))}>
                      + Add Tier
                    </button>
                  </div>
                  <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:0, padding:'6px 12px', background:'var(--surface2)', fontSize:11, color:'var(--muted)', fontWeight:700 }}>
                      <span>DEPOSIT ≥ (RM) — optional</span><span>TURNOVER ≥ (RM)</span><span>CREDIT (RM)</span><span>WCASH (RM)</span><span></span>
                    </div>
                    {form.reward_tiers.map((tier, i) => (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:8, padding:'8px 12px', borderTop:'1px solid var(--border)', alignItems:'center' }}>
                        <input type="number" style={s.smInput} value={tier.depositThreshold||''} placeholder="leave blank to skip"
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],depositThreshold:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <input type="number" style={s.smInput} value={tier.turnoverThreshold||''} placeholder="e.g. 100000"
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],turnoverThreshold:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <input type="number" style={s.smInput} value={tier.creditAmount||''} placeholder="e.g. 200"
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],creditAmount:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <input type="number" style={s.smInput} value={tier.wcashAmount||''} placeholder="e.g. 200"
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],wcashAmount:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <button type="button" onClick={()=>{ const t=form.reward_tiers.filter((_,j)=>j!==i); setForm(f=>({...f,reward_tiers:t})) }}
                          style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:12, cursor:'pointer' }}>✕</button>
                      </div>
                    ))}
                    {form.reward_tiers.length === 0 && (
                      <div style={{ padding:'12px', fontSize:12, color:'var(--muted)', textAlign:'center' }}>No tiers yet — click "+ Add Tier"</div>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>
                    A player only earns the HIGHEST tier where all set conditions are met simultaneously — not each tier added up. Leave Deposit blank on every tier for a turnover-only campaign.
                  </div>
                </div>
              )}

              {form.campaign_type === 'leaderboard' && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                    <div>
                      <div style={s.flbl}>Min Valid Bet (RM) *</div>
                      <input type="number" style={s.finput} value={form.min_valid_bet}
                        onChange={e => setForm(f => ({ ...f, min_valid_bet: e.target.value }))} placeholder="e.g. 3000000" />
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>Monthly valid bet required to qualify</div>
                    </div>
                    <div>
                      <div style={s.flbl}>Min Deposit (RM) - optional</div>
                      <input type="number" style={s.finput} value={form.min_deposit_lb||''}
                        onChange={e => setForm(f => ({ ...f, min_deposit_lb: e.target.value }))} placeholder="e.g. 50000" />
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>Qualify if deposit OR valid bet met</div>
                    </div>
                    <div>
                      <div style={s.flbl}>Top N (slots) *</div>
                      <input type="number" style={s.finput} value={form.top_n} min={1} max={20}
                        onChange={e => {
                          const n = parseInt(e.target.value)||1
                          const rewards = Array.from({length:n}, (_,i) => form.rank_rewards[i] || {rank:i+1, amount:12000})
                          setForm(f => ({ ...f, top_n: n, rank_rewards: rewards }))
                        }} />
                    </div>
                  </div>
                  <div style={s.flbl}>Reward per Rank (RM)</div>
                  <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'80px 1fr 1fr', padding:'6px 12px', background:'var(--surface2)', fontSize:11, color:'var(--muted)', fontWeight:700 }}>
                      <span>Rank</span><span>Amount (RM)</span><span>Description</span>
                    </div>
                    {form.rank_rewards.map((r, i) => (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'80px 1fr 1fr', gap:8, padding:'8px 12px', borderTop:'1px solid var(--border)', alignItems:'center' }}>
                        <span style={{ fontWeight:700, color:'#a78bfa', fontSize:13 }}>
                          {i===0?'#1 Top 1':i===1?'#2 Top 2':i===2?'#3 Top 3':'#'+(i+1)+' Top '+(i+1)}
                        </span>
                        <input type="number" style={s.smInput} value={r.amount} placeholder="e.g. 12000"
                          onChange={e => { const rw=[...form.rank_rewards]; rw[i]={...rw[i],amount:parseFloat(e.target.value)||0}; setForm(f=>({...f,rank_rewards:rw})) }} />
                        <input style={s.smInput} value={r.desc||''} placeholder="e.g. Cash Voucher 12K"
                          onChange={e => { const rw=[...form.rank_rewards]; rw[i]={...rw[i],desc:e.target.value}; setForm(f=>({...f,rank_rewards:rw})) }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:8, fontSize:12, color:'#a78bfa', fontWeight:600 }}>
                    Total reward cost: RM {(form.rank_rewards.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)).toLocaleString('en-MY')}
                  </div>
                </div>
              )}

              <div style={s.g2}>
              <div style={s.frow}>
                <div style={s.flbl}>Reward Delivery Method</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
                  {Object.entries(REWARD_DELIVERY).map(([k,v]) => (
                    <div key={k} onClick={()=>setForm(f=>({...f,reward_delivery:k}))}
                      style={{ padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600,
                        border:`2px solid ${form.reward_delivery===k?v.color:'var(--border)'}`,
                        background: form.reward_delivery===k?v.color+'22':'var(--surface2)',
                        color: form.reward_delivery===k?v.color:'var(--muted)',
                        transition:'all .15s' }}>
                      {v.label}
                    </div>
                  ))}
                </div>
              </div>

              <div style={s.frow}>
                <div style={s.flbl}>Target Tiers</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
                  {TIERS.map(tier => { const active=form.target_tier.includes(tier); return (
                    <div key={tier} onClick={()=>toggleTier(tier)} style={{ ...s.badge, cursor:'pointer', background:active?TIER_BG[tier]:'var(--surface2)', color:active?TIER_COLOR[tier]:'var(--muted)', border:`1px solid ${active?TIER_COLOR[tier]:'var(--border)'}`, padding:'5px 14px' }}>{tier}</div>
                  )})}
                </div>
              </div>
              <div style={s.frow}><div style={s.flbl}>Offer Description</div><textarea style={s.fta} rows={2} value={form.offer_desc} onChange={e=>setForm({...form,offer_desc:e.target.value})} placeholder="What's being offered?" /></div>
              <div style={s.frow}><div style={s.flbl}>Turnover Multiplier <span style={{ fontWeight:400, color:'var(--muted)', fontSize:10 }}>(WA message — e.g. 3 means reward × 3 required before withdrawal)</span></div><input type="number" min="1" step="0.5" style={s.finput} value={form.turnover_multiplier??''} onChange={e=>setForm({...form,turnover_multiplier:e.target.value})} placeholder="e.g. 3 (leave blank = no requirement)" /></div>
              <div style={s.frow}><div style={s.flbl}>Notes</div><textarea style={s.fta} rows={2} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></div>
              {msg.text && <div style={{ color:msg.ok?'#3fb950':'#f85149', fontSize:12, marginBottom:10 }}>{msg.text}</div>}
              <div style={{ display:'flex', gap:8 }}>
                <button style={{ ...s.btn, opacity:saving?.5:1 }} onClick={createCampaign} disabled={saving}>{saving?t('campaigns.creating'):'✅ '+t('campaigns.createCampaign')}</button>
                <button style={s.btnSm} onClick={closeModal}>{t('common.cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DETAIL MODAL ── */}
      {modal === 'detail' && selected && (
        <div style={s.overlay} onClick={e=>e.target===e.currentTarget&&closeModal()}>
          <div style={s.modal}>
            <div style={s.mhdr}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontSize:18, fontWeight:700 }}>{selected.campaign_name}</span>
                  <span style={{ ...s.tag(typeInfo.color), fontSize:11 }}>{typeInfo.label}</span>
                  <span style={{ ...s.tag(STATUS_COLOR[selected.status], STATUS_BG[selected.status]), fontSize:11 }}>{selected.status}</span>
                  {selected.platform && <span style={{ ...s.tag('#8b949e'), fontSize:11 }}>{selected.platform}</span>}
                </div>
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>
                  {selected.campaign_code} · {campType==='leaderboard' ? `Min Valid Bet: ${rmFmt(selected.min_valid_bet, campCurrency)}` : campType==='dual_tier' ? `${(rewardTiers||[]).length} tier${(rewardTiers||[]).length===1?'':'s'}${selected.settlement_frequency==='daily' ? ' · Daily settlement' : ''}` : `Min Deposit: ${rmFmt(depTarget, campCurrency)}`} · {fmtDate(selected.start_date)} → {fmtDate(selected.end_date)}
                  {campType==='pct_reward'   && ` · ${rewardPct}% ${deliveryInfo.label}${rewardCap?' (max '+rmFmt(rewardCap, campCurrency)+')':''}`}
                  {campType==='fixed_reward' && ` · ${rmFmt(rewardFixed, campCurrency)} fixed ${deliveryInfo.label}`}
                  {campType==='gold_bar'     && ` · Gold Bar ${rmFmt(goldVal, campCurrency)}`}
                   {campType==='fixed_reward' && selected?.is_multi_level && ` · ${campaignLevels.length} Credit levels`}
                  {campType==='tiered_reward' && ` · ${rewardTiers.length} reward tiers`}
                </div>
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                {selected.status==='draft' && (() => {
                  const today = new Date().toISOString().slice(0,10)
                  const isFuture = selected.start_date && selected.start_date > today
                  return <button style={s.btnG} onClick={()=>setCampStatus(selected.id, isFuture ? 'upcoming' : 'active')}>▶ {isFuture ? 'Publish Upcoming' : t('campaigns.activate')}</button>
                })()}
                {selected.status==='upcoming' && <><button style={{ ...s.btnG, background:'#3fb950', borderColor:'#3fb950' }} onClick={()=>setCampStatus(selected.id,'active')}>🚀 Launch Now</button><button style={s.btnSm} onClick={()=>setCampStatus(selected.id,'draft')}>↩ Back to Draft</button></>}
                {selected.status==='active' && <><button style={s.btnSm} onClick={()=>setCampStatus(selected.id,'paused')}>⏸ {t('campaigns.pause')}</button><button style={s.btnR} onClick={()=>setCampStatus(selected.id,'ended')}>⏹ {t('campaigns.end')}</button></>}
                {selected.status==='paused' && <button style={s.btnG} onClick={()=>setCampStatus(selected.id,'active')}>▶ {t('campaigns.resume')}</button>}
                {players.length > 0 && (
                  <button style={{ ...s.btnSm, color:'#a78bfa', borderColor:'#a78bfa' }} disabled={analyzing} onClick={runCampaignAnalysis}>
                    {analyzing ? '⏳ Analyzing…' : '🤖 Analyze'}
                  </button>
                )}
                <button style={{ ...s.btnSm, color:'var(--accent)', borderColor:'var(--accent)' }} onClick={openCampaignEditor} disabled={levelsLoading}>✏️ {levelsLoading ? 'Loading…' : 'Edit'}</button>
                <button style={s.btnR} onClick={deleteCampaign}>🗑 Delete</button>
                <button onClick={closeModal} style={{ background:'none',border:'none',color:'var(--muted)',fontSize:22,cursor:'pointer' }}>×</button>
              </div>
            </div>

            {aiAnalysis && (
              <div style={{ margin:'12px 24px', background:'rgba(167,139,250,.08)', border:'1px solid rgba(167,139,250,.3)', borderRadius:10, padding:'14px 18px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:'#a78bfa', textTransform:'uppercase', letterSpacing:'.5px' }}>🤖 AI Campaign Analysis</span>
                  <button onClick={()=>setAiAnalysis(null)} style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:16 }}>×</button>
                </div>
                <div style={{ fontSize:13, lineHeight:1.7, color:'var(--text)', whiteSpace:'pre-wrap' }}>{aiAnalysis}</div>
              </div>
            )}

            {/* Tiered Reward Reference */}
            {campType === 'tiered_reward' && rewardTiers.length > 0 && !editingCamp && (
              <div style={{ padding:'8px 24px', borderBottom:'1px solid var(--border)', background:'rgba(240,136,62,.05)' }}>
                <span style={{ fontSize:11, color:'#f0883e', fontWeight:700, marginRight:16 }}>📊 REWARD TIERS:</span>
                {[...rewardTiers].sort((a,b)=>parseFloat(a.min)-parseFloat(b.min)).map((tier,i)=>(
                  <span key={i} style={{ fontSize:11, color:'var(--muted)', marginRight:16 }}>
                    {rmFmt(tier.min, campCurrency)}–{tier.max?rmFmt(tier.max, campCurrency):'∞'} → <strong style={{ color:'#f0883e' }}>{tier.pct}%</strong>
                  </span>
                ))}
              </div>
            )}

            {/* Edit Campaign Form */}
            {editingCamp && (
              <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--border)', background:'rgba(99,102,241,.06)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:14 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:800, color:'var(--accent)' }}>✏️ CAMPAIGN EDITOR</div>
                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>Edit the campaign configuration stored in Supabase.</div>
                  </div>
                  <span style={{ ...s.tag('#8b949e'), fontSize:10 }}>{editCampForm.campaign_code || 'NEW CODE'}</span>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'10px 14px', marginBottom:16 }}>
                  <div><div style={s.flbl}>Campaign Name *</div><input style={s.finput} value={editCampForm.campaign_name||''} onChange={e=>setEditCampForm(f=>({...f,campaign_name:e.target.value}))} /></div>
                  <div><div style={s.flbl}>Campaign Code *</div><input style={s.finput} value={editCampForm.campaign_code||''} onChange={e=>setEditCampForm(f=>({...f,campaign_code:e.target.value.toUpperCase()}))} /></div>
                  <div><div style={s.flbl}>Campaign Type</div><select style={s.fsel} value={editCampForm.campaign_type||'gold_bar'} onChange={e=>setEditCampForm(f=>({...f,campaign_type:e.target.value}))}>{Object.entries(CAMPAIGN_TYPES).map(([k,v])=><option key={k} value={k}>{k==='fixed_reward' && editCampForm.is_multi_level ? 'Tiered Deposit Reward' : v.label.replace(/^[^ ]+ /,'')}</option>)}</select></div>
                  <div><div style={s.flbl}>Campaign Category (Optional)</div><select style={s.fsel} value={editCampForm.campaign_category||'standard'} onChange={e=>setEditCampForm(f=>({...f,campaign_category:e.target.value}))}><option value="standard">Standard</option><option value="deposit_milestone">Deposit Milestone</option><option value="leaderboard">Leaderboard</option><option value="vip_exclusive">VIP Exclusive</option></select></div>
                  <div><div style={s.flbl}>Platform</div><select style={s.fsel} value={editCampForm.platform||'MY'} onChange={e=>setEditCampForm(f=>({...f,platform:e.target.value}))}>{PLATFORMS.map(p=><option key={p} value={p}>{p}</option>)}</select></div>
                  <div><div style={s.flbl}>Status</div><select style={s.fsel} value={editCampForm.status||'draft'} onChange={e=>setEditCampForm(f=>({...f,status:e.target.value}))}>{['draft','upcoming','active','paused','ended'].map(v=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></div>
                  <div><div style={s.flbl}>Festival / Occasion</div><input style={s.finput} value={editCampForm.festival||''} onChange={e=>setEditCampForm(f=>({...f,festival:e.target.value}))} placeholder="e.g. Merdeka 2026" /></div>
                  <div><div style={s.flbl}>Budget (RM)</div><input type="number" min="0" style={s.finput} value={editCampForm.budget_rm??''} onChange={e=>setEditCampForm(f=>({...f,budget_rm:e.target.value}))} /></div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', marginBottom:10, letterSpacing:'.5px' }}>CAMPAIGN PERIOD & QUALIFICATION</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'10px 14px' }}>
                    <div><div style={s.flbl}>Start Date</div><input type="date" style={s.finput} value={editCampForm.start_date||''} onChange={e=>setEditCampForm(f=>({...f,start_date:e.target.value}))} /></div>
                    <div><div style={s.flbl}>End Date</div><input type="date" style={s.finput} value={editCampForm.end_date||''} onChange={e=>setEditCampForm(f=>({...f,end_date:e.target.value}))} /></div>
                    {editCampForm.campaign_type!=='leaderboard' && editCampForm.campaign_type!=='dual_tier' && <div><div style={s.flbl}>Deposit Target</div><input type="number" min="0" style={s.finput} value={editCampForm.deposit_target??''} onChange={e=>setEditCampForm(f=>({...f,deposit_target:e.target.value}))} /></div>}
                    {editCampForm.campaign_type==='leaderboard' && <><div><div style={s.flbl}>Minimum Valid Bet</div><input type="number" min="0" style={s.finput} value={editCampForm.min_valid_bet??''} onChange={e=>setEditCampForm(f=>({...f,min_valid_bet:e.target.value}))} /></div><div><div style={s.flbl}>Minimum Deposit</div><input type="number" min="0" style={s.finput} value={editCampForm.min_deposit_lb??''} onChange={e=>setEditCampForm(f=>({...f,min_deposit_lb:e.target.value}))} /></div></>}
                    <div><div style={s.flbl}>Settlement Frequency</div><select style={s.fsel} value={editCampForm.settlement_frequency||'total'} onChange={e=>setEditCampForm(f=>({...f,settlement_frequency:e.target.value}))}><option value="total">Total</option><option value="daily">Daily</option></select></div>
                    <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text)', paddingTop:18, cursor:'pointer' }}><input type="checkbox" checked={editCampForm.requires_period_deposit!==false} onChange={e=>setEditCampForm(f=>({...f,requires_period_deposit:e.target.checked}))} /> Requires period deposit</label>
                  </div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', marginBottom:10, letterSpacing:'.5px' }}>TARGET VIP TIERS</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {TIERS.map(tier=>{ const active=(editCampForm.target_tier||[]).includes(tier); return <button type="button" key={tier} onClick={()=>setEditCampForm(f=>({...f,target_tier:active?(f.target_tier||[]).filter(x=>x!==tier):[...(f.target_tier||[]),tier]}))} style={{ ...s.badge, padding:'6px 14px', cursor:'pointer', background:active?TIER_BG[tier]:'var(--surface2)', color:active?TIER_COLOR[tier]:'var(--muted)', border:`1px solid ${active?TIER_COLOR[tier]:'var(--border)'}` }}>{tier}</button> })}
                  </div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', marginBottom:10, letterSpacing:'.5px' }}>REWARD CONFIGURATION</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'10px 14px' }}>
                    <div><div style={s.flbl}>Reward Delivery</div><select style={s.fsel} value={editCampForm.reward_delivery||'credit'} onChange={e=>setEditCampForm(f=>({...f,reward_delivery:e.target.value}))}>{Object.entries(REWARD_DELIVERY).map(([k,v])=><option key={k} value={k}>{v.label.replace(/^[^ ]+ /,'')}</option>)}</select></div>
                    {editCampForm.campaign_type==='pct_reward' && <><div><div style={s.flbl}>Reward %</div><input type="number" min="0" step="0.01" style={s.finput} value={editCampForm.reward_pct??''} onChange={e=>setEditCampForm(f=>({...f,reward_pct:e.target.value}))} /></div><div><div style={s.flbl}>Reward Cap</div><input type="number" min="0" style={s.finput} value={editCampForm.reward_cap??''} onChange={e=>setEditCampForm(f=>({...f,reward_cap:e.target.value}))} placeholder="No cap" /></div></>}
                    {editCampForm.campaign_type==='fixed_reward' && !editCampForm.is_multi_level && <div><div style={s.flbl}>Fixed Reward</div><input type="number" min="0" style={s.finput} value={editCampForm.reward_fixed??''} onChange={e=>setEditCampForm(f=>({...f,reward_fixed:e.target.value}))} /></div>}
                    {editCampForm.campaign_type==='gold_bar' && <div><div style={s.flbl}>Gold Bar Value</div><input type="number" min="0" style={s.finput} value={editCampForm.gold_bar_value??''} onChange={e=>setEditCampForm(f=>({...f,gold_bar_value:e.target.value}))} /></div>}
                  </div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <div><div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', letterSpacing:'.5px' }}>MULTI-LEVEL CAMPAIGN</div><div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>Uses <code>campaign_levels</code> — the same source used by the Player Portal.</div></div>
                    <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, cursor:'pointer' }}><input type="checkbox" checked={Boolean(editCampForm.is_multi_level)} onChange={e=>setEditCampForm(f=>({...f,is_multi_level:e.target.checked,max_levels:e.target.checked?Math.max(1,campaignLevelsEdit.length):1}))} /> Enable levels</label>
                  </div>
                  {editCampForm.is_multi_level && <>
                    <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
                      <div style={{ fontSize:10, color:'var(--muted)', fontWeight:800, marginBottom:8 }}>PAYOUT MODE</div>
                      <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
                        <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer' }}>
                          <input type="radio" name="edit_payout_mode" value="all" checked={(editCampForm.payout_mode||'all')==='all'} onChange={()=>setEditCampForm(f=>({...f,payout_mode:'all'}))} />
                          <span><strong>Pay all unlocked levels</strong> — each level earns its own reward</span>
                        </label>
                        <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer' }}>
                          <input type="radio" name="edit_payout_mode" value="highest_only" checked={editCampForm.payout_mode==='highest_only'} onChange={()=>setEditCampForm(f=>({...f,payout_mode:'highest_only'}))} />
                          <span><strong>Pay highest level only</strong> — one reward per player (the biggest)</span>
                        </label>
                      </div>
                    </div>
                    <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}><button type="button" style={{ ...s.btnSm, fontSize:11 }} onClick={()=>setCampaignLevelsEdit(prev=>[...prev,{...normalizeLevel({},prev.length),level_order:prev.length+1}])}>+ Add Level</button></div>
                    <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:9, overflow:'hidden' }}>
                      <div style={{ display:'grid', gridTemplateColumns:'46px 100px 1.2fr 110px 110px 110px 1.2fr 32px', gap:6, padding:'7px 10px', background:'var(--surface2)', fontSize:10, color:'var(--muted)', fontWeight:800 }}><span>#</span><span>CODE</span><span>LEVEL NAME</span><span>DEPOSIT</span><span>REWARD</span><span>MAX %</span><span>DESCRIPTION</span><span></span></div>
                      {campaignLevelsEdit.map((level,i)=><div key={level.id||`new-${i}`} style={{ display:'grid', gridTemplateColumns:'46px 100px 1.2fr 110px 110px 110px 1.2fr 32px', gap:6, padding:'8px 10px', borderTop:'1px solid var(--border)', alignItems:'center' }}>
                        <input type="number" min="1" style={s.finput} value={level.level_order} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],level_order:e.target.value};setCampaignLevelsEdit(a)}} />
                        <input style={s.finput} value={level.level_code||''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],level_code:e.target.value.toUpperCase()};setCampaignLevelsEdit(a)}} placeholder="CODE31" />
                        <input style={s.finput} value={level.level_name||''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],level_name:e.target.value};setCampaignLevelsEdit(a)}} placeholder="Level 1" />
                        <input type="number" min="0" style={s.finput} value={level.deposit_threshold??''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],deposit_threshold:e.target.value};setCampaignLevelsEdit(a)}} />
                        <input type="number" min="0" style={s.finput} value={level.reward_amount??''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],reward_amount:e.target.value};setCampaignLevelsEdit(a)}} />
                        <input type="number" min="0.01" max="100" step="0.01" style={s.finput} value={Number(level.max_reward_pct??0.05)*100} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],max_reward_pct:(Number(e.target.value)||0)/100};setCampaignLevelsEdit(a)}} />
                        <input style={s.finput} value={level.description||''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],description:e.target.value};setCampaignLevelsEdit(a)}} placeholder="Deposit RM31,000 within campaign period" />
                        <button type="button" onClick={()=>setCampaignLevelsEdit(prev=>prev.filter((_,j)=>j!==i))} style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'5px 7px', borderRadius:5, cursor:'pointer' }}>×</button>
                      </div>)}
                      {!campaignLevelsEdit.length && <div style={{ padding:14, textAlign:'center', fontSize:12, color:'var(--muted)' }}>No levels yet.</div>}
                    </div>
                    {campaignLevelsEdit.some(l=>Number(l.deposit_threshold)>0 && Number(l.reward_amount)>Number(l.deposit_threshold)*Number(l.max_reward_pct||0)) && <div style={{ marginTop:8, padding:'8px 10px', borderRadius:7, background:'rgba(248,81,73,.1)', color:'#f85149', fontSize:11 }}>⚠️ One or more levels exceed their configured reward cap.</div>}
                  </>}
                </div>

                {/* ── STREAK BONUS CONFIG (daily mode only) ── */}
                {editCampForm.campaign_type === 'dual_tier' && editCampForm.settlement_frequency === 'daily' && (
                  <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', letterSpacing:'.5px' }}>🔥 STREAK BONUS</div>
                        <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>Extra reward when players complete consecutive qualifying days.</div>
                      </div>
                      <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, cursor:'pointer' }}>
                        <input type="checkbox" checked={Boolean(editCampForm.streak_enabled)} onChange={e=>setEditCampForm(f=>({...f,streak_enabled:e.target.checked}))} />
                        Enable streak
                      </label>
                    </div>
                    {editCampForm.streak_enabled && (
                      <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'12px 14px' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'10px 14px', marginBottom:10 }}>
                          <div>
                            <div style={s.flbl}>Streak Length (days)</div>
                            <input type="number" min="2" max="30" style={s.finput} value={editCampForm.streak_days||3} onChange={e=>setEditCampForm(f=>({...f,streak_days:e.target.value}))} />
                            <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>Consecutive qualifying days per bonus</div>
                          </div>
                          <div>
                            <div style={s.flbl}>Bonus Mode</div>
                            <select style={s.fsel} value={editCampForm.streak_bonus_type||'pct'} onChange={e=>setEditCampForm(f=>({...f,streak_bonus_type:e.target.value}))}>
                              <option value="pct">% of Period Deposit</option>
                              <option value="fixed">Fixed Amount</option>
                            </select>
                          </div>
                          {(editCampForm.streak_bonus_type||'pct')==='pct' ? (
                            <div>
                              <div style={s.flbl}>Bonus %</div>
                              <input type="number" min="0" step="0.01" style={s.finput} value={editCampForm.streak_bonus_pct??1} onChange={e=>setEditCampForm(f=>({...f,streak_bonus_pct:e.target.value}))} placeholder="e.g. 1" />
                              <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>% of total deposit in those {editCampForm.streak_days||3} days</div>
                            </div>
                          ) : (
                            <div>
                              <div style={s.flbl}>Fixed Bonus (RM)</div>
                              <input type="number" min="0" style={s.finput} value={editCampForm.streak_bonus_fixed??0} onChange={e=>setEditCampForm(f=>({...f,streak_bonus_fixed:e.target.value}))} placeholder="e.g. 100" />
                            </div>
                          )}
                          <div>
                            <div style={s.flbl}>Max Cap (RM)</div>
                            <input type="number" min="0" style={s.finput} value={editCampForm.streak_bonus_cap??0} onChange={e=>setEditCampForm(f=>({...f,streak_bonus_cap:e.target.value}))} placeholder="0 = no cap" />
                            <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>0 = no cap</div>
                          </div>
                        </div>
                        <div style={{ fontSize:11, color:'var(--muted)', padding:'8px 10px', background:'rgba(88,166,255,.06)', borderRadius:6 }}>
                          <strong>How it works:</strong> Player qualifies for streak when they deposit ≥ Level 1 threshold on a given day. Every {editCampForm.streak_days||3} consecutive qualifying days earns one bonus, paid the next day. Streak resets if any day is missed.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {editCampForm.campaign_type==='leaderboard' && <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}><div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
  <div>
    <div style={s.flbl}>Leaderboard Metric</div>
    <select style={s.fsel} value={editCampForm.leaderboard_metric||'turnover'} onChange={e=>setEditCampForm(f=>({...f,leaderboard_metric:e.target.value}))}>
      <option value="turnover">Turnover Race</option>
      <option value="deposit">Deposit Race</option>
      <option value="turnover_deposit">Turnover + Deposit Race</option>
    </select>
  </div>
</div>

                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}><div style={s.flbl}>LEADERBOARD REWARDS</div><div><span style={{ fontSize:11, color:'var(--muted)', marginRight:8 }}>Top N</span><input type="number" min="1" max="50" style={{ ...s.smInput, width:65 }} value={editCampForm.top_n||3} onChange={e=>{const n=Math.max(1,Math.min(50,parseInt(e.target.value)||1));const rw=Array.from({length:n},(_,i)=>(editCampForm.rank_rewards||[])[i]||{rank:i+1,amount:0,desc:''});setEditCampForm(f=>({...f,top_n:n,rank_rewards:rw}))}} /></div></div>
                  {(editCampForm.rank_rewards||[]).map((r,i)=><div key={i} style={{ display:'grid', gridTemplateColumns:'70px 160px 1fr', gap:8, marginBottom:6 }}><div style={{ padding:'8px 10px', color:'#a78bfa', fontWeight:700, fontSize:12 }}>#{i+1}</div><input type="number" min="0" style={s.finput} value={r.amount??''} placeholder="Amount" onChange={e=>{const rw=[...(editCampForm.rank_rewards||[])];rw[i]={...rw[i],amount:e.target.value};setEditCampForm(f=>({...f,rank_rewards:rw}))}} /><input style={s.finput} value={r.desc||''} placeholder="Reward description" onChange={e=>{const rw=[...(editCampForm.rank_rewards||[])];rw[i]={...rw[i],desc:e.target.value};setEditCampForm(f=>({...f,rank_rewards:rw}))}} /></div>)}
                </div>}

                {(editCampForm.campaign_type==='tiered_reward' || editCampForm.campaign_type==='dual_tier') && <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}><div><div style={s.flbl}>JSON REWARD TIERS</div><div style={{ fontSize:10, color:'var(--muted)' }}>Used by the existing tiered/dual-tier engine. Separate from campaign_levels.</div></div><button type="button" style={{ ...s.btnSm, fontSize:11 }} onClick={()=>setEditCampForm(f=>({...f,reward_tiers:[...(f.reward_tiers||[]), editCampForm.campaign_type==='dual_tier'?{depositThreshold:'',turnoverThreshold:'',creditAmount:'',wcashAmount:''}:{min:'',max:'',pct:''}]}))}>+ Add Tier</button></div>
                  {editCampForm.campaign_type==='dual_tier' && <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 32px', gap:6, marginBottom:4 }}><div style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>MIN DEPOSIT (RM)</div><div style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>MIN TURNOVER (RM)</div><div style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>CREDIT (RM)</div><div style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>WCASH (RM)</div><div/></div>}
                  {(editCampForm.reward_tiers||[]).map((tier,i)=> editCampForm.campaign_type==='dual_tier' ? <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 32px', gap:6, marginBottom:6 }}><input type="number" style={s.finput} value={tier.depositThreshold||''} placeholder="e.g. 9000" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],depositThreshold:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.turnoverThreshold||''} placeholder="e.g. 99000" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],turnoverThreshold:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.creditAmount||''} placeholder="e.g. 900" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],creditAmount:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.wcashAmount||''} placeholder="e.g. 0" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],wcashAmount:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><button type="button" onClick={()=>setEditCampForm(f=>({...f,reward_tiers:(f.reward_tiers||[]).filter((_,j)=>j!==i)}))} style={{ ...s.btnR, padding:'4px 7px' }}>×</button></div> : <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 90px 32px', gap:6, marginBottom:6 }}><input type="number" style={s.finput} value={tier.min||''} placeholder="Min deposit" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],min:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.max||''} placeholder="Max" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],max:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.pct||''} placeholder="%" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],pct:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><button type="button" onClick={()=>setEditCampForm(f=>({...f,reward_tiers:(f.reward_tiers||[]).filter((_,j)=>j!==i)}))} style={{ ...s.btnR, padding:'4px 7px' }}>×</button></div>)}
                </div>}

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={s.flbl}>PLAYER CONTENT</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:8 }}>
                    <textarea style={s.fta} rows={3} value={editCampForm.offer_desc||''} onChange={e=>setEditCampForm(f=>({...f,offer_desc:e.target.value}))} placeholder="Write player-facing How to Join, Rules & Regulations, eligibility, deposit rules, reward conditions, and payout terms. Use line breaks for sections." />
                    <textarea style={s.fta} rows={3} value={editCampForm.notes||''} onChange={e=>setEditCampForm(f=>({...f,notes:e.target.value}))} placeholder="Internal notes" />
                  </div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={s.flbl}>Turnover Multiplier <span style={{ fontWeight:400, color:'var(--muted)', fontSize:10 }}>(WA payout message — e.g. 3 means reward × 3 required before withdrawal)</span></div>
                  <input type="number" min="1" step="0.5" style={{ ...s.finput, width:180, marginTop:4 }} value={editCampForm.turnover_multiplier??''} onChange={e=>setEditCampForm(f=>({...f,turnover_multiplier:e.target.value}))} placeholder="e.g. 3 (leave blank = no requirement)" />
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', marginBottom:6, letterSpacing:'.5px' }}>💬 WHATSAPP MESSAGE TEMPLATE</div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:8 }}>Optional — overrides the auto-generated message. Variables: <code>{'{username}'}</code> <code>{'{campaign}'}</code> <code>{'{agent}'}</code> <code>{'{gap}'}</code></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4, fontWeight:600 }}>🇬🇧 English</div>
                      <textarea style={{ ...s.fta, width:'100%' }} rows={6} value={editCampForm.whatsapp_template||''} onChange={e=>setEditCampForm(f=>({...f,whatsapp_template:e.target.value}))} placeholder={"e.g. Hi {username}, checking in on {campaign}! You need {gap} more to qualify. - {agent}"} />
                    </div>
                    <div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4, fontWeight:600 }}>🇨🇳 中文</div>
                      <textarea style={{ ...s.fta, width:'100%' }} rows={6} value={editCampForm.whatsapp_template_zh||''} onChange={e=>setEditCampForm(f=>({...f,whatsapp_template_zh:e.target.value}))} placeholder={"e.g. 您好 {username}，我是SureWin VIP 部门的 {agent}。\n\n您参与了 {campaign} 活动，还需 {gap} 即可达标！"} />
                    </div>
                  </div>
                </div>

                {/* ── PAYOUT WA MESSAGE TEMPLATES ── */}
                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'#25d366', marginBottom:4, letterSpacing:'.5px' }}>📲 PAYOUT NOTIFICATION MESSAGE</div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:10 }}>
                    Edit the message sent when a player qualifies for payout. Leave blank to use the default. Variables: <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{username}'}</code> <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{campaign}'}</code> <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{agent}'}</code> <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{reward}'}</code> <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{turnover}'}</code>
                  </div>
                  {[
                    ['en', '🇬🇧 English', 'payout_template_en', `Hi {username}! 🎉 I'm {agent} from SureWin VIP Team.\nYour "{campaign}" reward of {reward} Credit has been credited to your account. Please check your balance!\n\n⚠️ A {turnover} turnover is required before withdrawal.`],
                    ['my', '🇲🇾 Malay', 'payout_template_my', `Hi {username}! 🎉 Saya {agent} dari Pasukan SureWin VIP.\nHadiah kempen "{campaign}" sebanyak {reward} Kredit telah dikreditkan ke akaun anda. Sila semak baki anda!\n\n⚠️ Turnover sebanyak {turnover} diperlukan sebelum pengeluaran boleh dibuat.`],
                    ['cn', '🇨🇳 中文', 'payout_template_cn', `你好 {username}！🎉我是SureWin VIP部门的{agent}\n你的"{campaign}"奖励 {reward} 积分已成功存入你的账户，请查看余额！\n\n⚠️ 温馨提示：领取奖励后需完成 {turnover} 的流水要求，方可申请提款。`],
                  ].map(([lang, label, field, placeholder]) => {
                    const tpl = editCampForm[field] ?? ''
                    const sampleAgent = 'Marcus'
                    const sampleReward = 'RM 800'
                    const sampleTurnover = editCampForm.turnover_multiplier ? `RM ${800 * Number(editCampForm.turnover_multiplier)}` : 'RM 2400'
                    const preview = applyPayoutTemplate(
                      tpl || placeholder,
                      'haur2972', editCampForm.campaign_name || selected?.campaign_name || 'Campaign',
                      sampleReward, sampleAgent, sampleTurnover
                    )
                    return (
                      <div key={lang} style={{ marginBottom:16 }}>
                        <div style={{ fontSize:11, color:'var(--muted)', fontWeight:700, marginBottom:6 }}>{label}</div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                          <textarea
                            style={{ ...s.fta, width:'100%', fontFamily:'monospace', fontSize:12 }}
                            rows={5}
                            value={tpl !== '' ? tpl : placeholder}
                            onChange={e=>setEditCampForm(f=>({...f,[field]:e.target.value}))}
                          />
                          <div style={{ background:'rgba(37,211,102,.06)', border:'1px solid rgba(37,211,102,.2)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--text)', whiteSpace:'pre-wrap', lineHeight:1.6 }}>
                            <div style={{ fontSize:10, color:'#25d366', fontWeight:700, marginBottom:6 }}>👁 Preview</div>
                            {preview}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <button style={s.btnG} onClick={editCampaign} disabled={saving}>{saving?'Saving…':'💾 Save Campaign'}</button>
                  <button style={s.btnSm} onClick={()=>{setEditingCamp(false);setCampaignLevelsEdit([])}} disabled={saving}>Cancel</button>
                  <span style={{ fontSize:10, color:'var(--muted)', marginLeft:4 }}>Changes are saved to the existing campaign; player records are not recreated.</span>
                </div>
              </div>
            )}

            {/* Stats bar */}
            <div style={{ padding:'12px 24px', borderBottom:'1px solid var(--border)', background:'var(--surface2)', display:'flex', gap:20, flexWrap:'wrap' }}>
              {[
                [t('campaigns.players'), players.length,       'var(--accent)'],
                [t('campaigns.achieved'),    achieved.length,       '#3fb950'],
                [t('campaigns.nearTarget'), nearTarget.length,     '#f0883e'],
                [t('campaigns.totalDep'),   rmFmt(totalDep, campCurrency),       '#3fb950'],
                [t('campaigns.totalReward'),`${rewardFmt(totalReward, campCurrency)} ${deliveryInfo.label}`, typeInfo.color],
                [t('campaigns.paidOut'),    rewardFmt(paidOut, campCurrency),    '#3fb950'],
                [t('campaigns.pendingPay'), rewardFmt(pendingPay, campCurrency), '#f85149'],
                [t('campaigns.successRate'),players.length?(isDailyMode||!selected?.is_multi_level?Math.round(achieved.length/players.length*100):multiSummary.successRate)+'%':'0%', '#3fb950'],
              ].map(([l,v,c])=>( <div key={l}><div style={{ fontSize:16, fontWeight:800, color:c }}>{v}</div><div style={{ fontSize:10, color:'var(--muted)' }}>{l}</div></div> ))}
            </div>

            {/* Add VIP */}
            <div style={{ padding:'10px 24px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>➕ ADD PLAYER TO CAMPAIGN</div>
              <div style={{ position:'relative' }}>
                <input style={s.finput} value={vipSearch} onChange={e=>setVipSearch(e.target.value)} placeholder="Search username or name..." />
                {vipResults.length > 0 && (
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, zIndex:100, boxShadow:'0 8px 24px rgba(0,0,0,.5)', marginTop:2 }}>
                    {vipResults.map((v,idx)=>(
                      <div key={v.username+idx} onClick={()=>addVIP(v)}
                        style={{ padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid var(--border)' }}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <span style={{ ...s.badge, background:TIER_BG[v.tier]||'transparent', color:TIER_COLOR[v.tier]||'var(--muted)' }}>{v.tier}</span>
                        {v.source==='potential' && <span style={{ ...s.badge, background:'rgba(99,102,241,.15)', color:'#818cf8', fontSize:9, padding:'1px 6px' }}>POTENTIAL</span>}
                        <span style={{ fontWeight:700 }}>{v.username}</span>
                        <span style={{ color:'var(--muted)', fontSize:12 }}>{v.full_name||''}</span>
                        <span style={{ marginLeft:'auto', color:'#3fb950', fontSize:12 }}>+ Add</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 24px' }}>
              {[
                ['chase',    `🏃 Chase List (${players.length})`],
                ['payout',   `💰 Payout (${isDailyMode ? dailyAchieved.length : selected?.is_multi_level ? multiPayoutRows.length : achieved.length} rewards)`],
                ...(isDailyMode ? [['streak', `🔥 Streak${selected?.streak_enabled ? '' : ' (off)'}`]] : []),
                ...(isDailyMode ? [['inactive', `😴 Inactive`]] : []),
                ['register', '📋 All Players'],
                ...(campType==='leaderboard' ? [['leaderboard','[TOP] Leaderboard']] : []),
                ['summary', '📊 Summary'],
              ].map(([id,label])=>(
                <button key={id} onClick={()=>setActiveTab(id)} style={{ background:'none', border:'none', cursor:'pointer', padding:'10px 16px', fontSize:13, fontWeight:600, color:activeTab===id?'var(--accent)':'var(--muted)', borderBottom:activeTab===id?'2px solid var(--accent)':'2px solid transparent', transition:'color .15s' }}>{label}</button>
              ))}
            </div>

            {/* ── CHASE LIST ── */}
            {activeTab === 'chase' && (
              <div style={{ overflowX:'auto' }}>
                <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(88,166,255,.04)', borderBottom:'1px solid var(--border)' }}>
                  Click deposit field to update · reward auto-calculated based on campaign type
                </div>
                {/* Chase list host filter */}
                {chaseHosts.length > 1 && (
                  <div style={{ padding:'6px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                    <span style={{ fontSize:11, color:'var(--muted)', marginRight:2 }}>Host:</span>
                    {chaseHosts.map(h => (
                      <button key={h} onClick={() => setHostFilter(h)} style={{
                        padding:'3px 12px', borderRadius:16, fontSize:12, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                        background: hostFilter === h ? 'var(--accent)' : 'var(--surface2)',
                        color: hostFilter === h ? '#fff' : 'var(--muted)',
                      }}>{h === 'all' ? `All (${chaseList.length})` : `${h} (${chaseList.filter(p=>p.host_assigned===h).length})`}</button>
                    ))}
                  </div>
                )}
                {/* Chase list search + sort filter */}
                <div style={{ padding:'8px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <input
                    value={chaseFilter}
                    onChange={e => setChaseFilter(e.target.value)}
                    placeholder={`🔍 Filter ${filteredChaseList.length} players by username…`}
                    style={{ ...s.smInput, width:240, fontSize:12 }}
                  />
                  {chaseFilter && (
                    <button onClick={() => setChaseFilter('')} style={{ fontSize:11, color:'var(--muted)', background:'none', border:'none', cursor:'pointer', padding:'2px 6px' }}>✕ Clear</button>
                  )}
                  {chaseFilter && <span style={{ fontSize:11, color:'var(--muted)' }}>{filteredChaseList.length} match{filteredChaseList.length !== 1 ? 'es' : ''}</span>}
                  <span style={{ fontSize:11, color:'var(--muted)', marginLeft:4 }}>Sort:</span>
                  {[['deposit','Deposit'],['reward','Reward'],['name','Name']].map(([key,lbl])=>(
                    <button key={key} onClick={()=>{ if(chaseSort===key){setChaseSortDir(d=>d==='asc'?'desc':'asc')}else{setChaseSort(key);setChaseSortDir('desc')} }}
                      style={{ padding:'3px 10px', borderRadius:14, fontSize:11, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                        background: chaseSort===key ? 'var(--accent)' : 'var(--surface2)', color: chaseSort===key ? '#fff' : 'var(--muted)' }}>
                      {lbl} {chaseSort===key ? (chaseSortDir==='asc' ? '↑' : '↓') : ''}
                    </button>
                  ))}
                  <span style={{ fontSize:11, color:'var(--muted)', marginLeft:4 }}>WA:</span>
                  {[['en','EN'],['my','MY'],['cn','中文']].map(([key,lbl])=>(
                    <button key={key} onClick={()=>setWaLang(key)}
                      style={{ padding:'3px 10px', borderRadius:14, fontSize:11, fontWeight:700, border:'1px solid var(--border)', cursor:'pointer',
                        background: waLang===key ? '#25d366' : 'var(--surface2)', color: waLang===key ? '#fff' : 'var(--muted)' }}>
                      {lbl}
                    </button>
                  ))}
                  <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
                    {campType !== 'leaderboard' && (
                      <button
                        onClick={importFromVipData}
                        disabled={dailyLoading || realFinancialsLoading}
                        title="Auto-fill deposit and turnover from VIP daily snapshot data for the campaign date range"
                        style={{ background:'rgba(88,166,255,.12)', border:'1px solid rgba(88,166,255,.3)', color:'#58a6ff', padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', opacity: (dailyLoading||realFinancialsLoading) ? 0.5 : 1 }}
                      >
                        {dailyLoading ? '⏳ Importing…' : '⬇ Import from VIP Data'}
                      </button>
                    )}
                  </div>
                </div>
                {isDailyMode && (
                  <div style={{ padding:'12px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'#c9a961' }}>📅 Entry Date:</span>
                    <input type="date" value={entryDate} min={selected.start_date||undefined} max={selected.end_date||undefined}
                      onChange={e=>setEntryDate(e.target.value)}
                      style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:12, color:'var(--text)' }} />
                    <span style={{ fontSize:11, color:'var(--muted)' }}>Each day settles independently — entering turnover for this date does not affect any other date's record.</span>
                    {dailyLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>Loading…</span>}
                    {selected?.is_multi_level && campaignLevels?.length > 0 && (
                      <button onClick={recalcDailyRewards} disabled={dailyLoading}
                        style={{ marginLeft:'auto', background:'rgba(201,169,97,.12)', border:'1px solid rgba(201,169,97,.3)', color:'#c9a961', padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}
                        title="Recalculate tier_achieved and credit_reward for ALL entries of this campaign using campaign level thresholds">
                        🔄 Recalculate All Rewards
                      </button>
                    )}
                  </div>
                )}
                <table style={s.tbl}>
                  {campType === 'leaderboard' ? (
                    <>
                    <thead><tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>Player</th>
                      <th style={s.th}>Host</th>
                      <th style={s.th}>WhatsApp</th>
                      <th style={s.th}>Valid Bet (RM)</th>
                      <th style={s.th}>Deposit (RM)</th>
                      <th style={s.th}>Progress (Min Bet)</th>
                      <th style={s.th}>Gap to Rank #{topN}</th>
                      <th style={s.th}>Reward</th>
                      <th style={s.th}>Contact</th>
                      <th style={s.th}>Priority</th>
                      <th style={s.th}>✕</th>
                    </tr></thead>
                    <tbody>
                      {filteredChaseList.length === 0
                        ? <tr><td colSpan={12} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>{chaseList.length === 0 ? 'Add players above to start tracking.' : 'No players match the search.'}</td></tr>
                        : filteredChaseList.map((p,i) => {
                            const rankingTarget = leaderboardMetric === 'deposit' ? minDepLb : minBetTarget
                            const pr = getProgress(p._rankingValue||0, rankingTarget)
                            const inTopByPosition = i < topN && p._qualified
                            const gap = cutoffValue!=null ? Math.max(0, cutoffValue - (p._rankingValue||0)) : null
                            return (
                              <tr key={p.id} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                                <td style={{ ...s.td, fontWeight:700 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                                    <span style={{ cursor:'pointer' }} onClick={()=>{if(p.vip_id){closeModal();navigate(`/vips/${p.vip_id}`)}}}>{p.username}</span>
                                    {p.tier && <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)', fontSize:10 }}>{p.tier}</span>}
                                    <button title="Copy username" onClick={()=>copyUsername(p.id, p.username)} style={{ marginLeft:2, background:'none', border:'none', cursor:'pointer', fontSize:11, color: copiedId===p.id ? '#3fb950' : 'var(--muted)', padding:'1px 4px', borderRadius:4 }}>{copiedId===p.id ? '✓' : '⎘'}</button>
                                  </div>
                                </td>
                                <td style={{ ...s.td, fontSize:12, color: p.host_assigned ? 'var(--text)' : 'var(--muted)' }}>{p.host_assigned || '—'}</td>
                                <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>
                                  <input defaultValue={p.whatsapp||''} onBlur={e=>{if(e.target.value!==(p.whatsapp||''))updatePlayer(p.id,{whatsapp:e.target.value})}} style={{ ...s.editInput, width:120 }} placeholder="—" />
                                </td>
                                <td style={s.td}>
                                  <input type="number" defaultValue={p._vb||''}
                                    onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==(p._vb||0)) updatePlayer(p.id,{valid_bet:v}) }}
                                    style={{ ...s.smInput, width:110 }} />
                                </td>
                                <td style={s.td}>
                                  <input type="number" defaultValue={playerDeposit(p)||''}
                                    onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==playerDeposit(p)) updatePlayer(p.id,{total_deposit:v}) }}
                                    style={{ ...s.smInput, width:110 }} />
                                </td>
                                <td style={{ ...s.td, minWidth:140 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                    <div style={{ flex:1, height:6, background:'var(--surface2)', borderRadius:3, overflow:'hidden' }}>
                                      <div style={{ width:pr.pct+'%', height:'100%', background:pr.color, borderRadius:3 }} />
                                    </div>
                                    <span style={{ fontSize:11, color:pr.color, fontWeight:700, minWidth:36 }}>{pr.pct}%</span>
                                  </div>
                                </td>
                                <td style={{ ...s.td, fontSize:12 }}>
                                  {inTopByPosition
                                    ? <span style={{ color:'#3fb950', fontWeight:700 }}>🏆 In Top {topN}</span>
                                    : gap!=null
                                      ? <span style={{ color:'#f85149' }}>short {rmFmt(gap, campCurrency)}<br/><span style={{ color:'var(--muted)', fontSize:10 }}>vs {chaseList[topN-1]?.username}</span></span>
                                      : <span style={{ color:'var(--muted)' }}>—</span>}
                                </td>
                                <td style={{ ...s.td, color: p._inTop ? '#a78bfa' : 'var(--muted)', fontWeight: p._inTop ? 700 : 400, fontSize:12 }}>
                                  {p._inTop ? rewardFmt(p._reward, campCurrency) : '—'}
                                </td>
                                <td style={s.td}><CampaignWaButton p={p} extra={{ vb: p._vb, inTop: p._inTop, reward: p._reward, gap }} /></td>
                                <td style={s.td}><span style={{ ...s.tag(pr.color, pr.bg), fontSize:10 }}>{pr.label}</span></td>
                                <td style={s.td} onClick={e=>e.stopPropagation()}>
                                  <button onClick={()=>removePlayer(p.id)} style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>✕</button>
                                </td>
                              </tr>
                            )
                          })
                      }
                    </tbody>
                    </>
                  ) : (
                    <>
                    <thead><tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>Player</th>
                      <th style={s.th}>Host</th>
                      <th style={s.th}>WhatsApp</th>
                      <th style={s.th}>{campType==='dual_tier' ? 'Deposit / Turnover (RM)' : 'Campaign Deposit (RM)'}</th>
                      <th style={s.th}>Progress</th>
                      <th style={s.th}>Reward</th>
                      <th style={s.th}>Last Contact</th>
                      <th style={s.th}>Priority</th>
                      <th style={s.th}>✕</th>
                    </tr></thead>
                    <tbody>
                      {chaseList.length === 0
                        ? <tr><td colSpan={10} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>Add players above to start tracking.</td></tr>
                        : filteredChaseList.length === 0
                        ? <tr><td colSpan={10} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>No players match the search.</td></tr>
                        : filteredChaseList.map((p,i) => {
                            const multi = selected?.is_multi_level && campaignLevels.length > 0
                            const multiMetric = multi ? multiMetricsByPlayer[p.id] : null
                            const dailyEntry = dailyEntries[p.id]
                            const dualReward = campType==='dual_tier'
                              ? (isDailyMode ? calcDualTierReward(dailyEntry?.deposit_amount||0, dailyEntry?.turnover_amount||0, rewardTiers) : calcDualTierReward(playerDeposit(p), p.valid_bet, rewardTiers))
                              : null
                            let pr
                            if (multi) {
                              // Use daily deposit in daily-settlement mode, total otherwise
                              const dep = isDailyMode ? (dailyEntry?.deposit_amount || 0) : playerDeposit(p)
                              const sortedLvls = [...campaignLevels].sort((a,b) => (parseFloat(a.deposit_threshold)||0) - (parseFloat(b.deposit_threshold)||0))
                              const nextLvl = sortedLvls.find(l => dep < (parseFloat(l.deposit_threshold)||0))
                              const allDone = sortedLvls.length > 0 && dep >= (parseFloat(sortedLvls[sortedLvls.length-1]?.deposit_threshold)||0)
                              if (allDone) pr = { pct:100, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:'✅ ALL LEVELS' }
                              else if (nextLvl) pr = getProgress(dep, parseFloat(nextLvl.deposit_threshold)||0)
                              else pr = { pct:0, color:'#8b949e', bg:'rgba(139,148,158,.15)', label:'IN PROGRESS' }
                            } else if (isDailyMode && campType==='dual_tier') {
                              const currentDeposit = dailyEntry?.deposit_amount || 0
                              const currentTurnover = dailyEntry?.turnover_amount || 0
                              if (dualReward.tierIndex >= 0) {
                                // At least one tier reached — show which one explicitly, and progress
                                // toward the NEXT tier so achieving tier 1 or 2 doesn't look like "behind".
                                const nextTier = rewardTiers[dualReward.tierIndex + 1]
                                if (nextTier) {
                                  const nextDepThreshold = parseFloat(nextTier.depositThreshold) || 0
                                  const nextTOThreshold = parseFloat(nextTier.turnoverThreshold) || 0
                                  const depPct = nextDepThreshold > 0 ? Math.min(100, Math.round(currentDeposit / nextDepThreshold * 100)) : 100
                                  const toPct  = nextTOThreshold  > 0 ? Math.min(100, Math.round(currentTurnover / nextTOThreshold * 100)) : 100
                                  const pct = Math.min(depPct, toPct)
                                  pr = { pct, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:`✅ Tier ${dualReward.tierIndex+1} Achieved` }
                                } else {
                                  pr = { pct:100, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:`✅ Tier ${dualReward.tierIndex+1} (Highest)` }
                                }
                              } else {
                                // Not yet qualified — progress = worst of deposit% vs turnover% toward first tier
                                const firstDepThreshold = parseFloat(rewardTiers[0]?.depositThreshold) || 0
                                const firstTOThreshold  = parseFloat(rewardTiers[0]?.turnoverThreshold) || 0
                                const depPct = firstDepThreshold > 0 ? Math.min(100, Math.round(currentDeposit / firstDepThreshold * 100)) : 100
                                const toPct  = firstTOThreshold  > 0 ? Math.min(100, Math.round(currentTurnover / firstTOThreshold * 100)) : 100
                                const pct = Math.min(depPct, toPct)
                                const color = pct >= 100 ? '#f0883e' : pct >= 70 ? '#f0883e' : '#f85149' // never green until both pass
                                pr = { pct, color, bg: color+'18', label: pct >= 70 ? '⚡ CLOSE' : '🔴 BEHIND' }
                              }
                            } else {
                              pr = getProgress(playerDeposit(p), depTarget)
                            }
                            const reward = multi
                              ? (isDailyMode ? (dailyEntry?.credit_reward || 0) : (multiMetric?.qualifiedRewardTotal || 0))
                              : campType==='dual_tier' ? (dualReward.creditAmount + dualReward.wcashAmount) : calcReward(campType, playerDeposit(p), rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level)
                            const qualified = multi
                              ? (isDailyMode ? (dailyEntry?.credit_reward || 0) > 0 : (multiMetric?.completedCount > 0))
                              : campType==='dual_tier' ? dualReward.tierIndex >= 0 : playerDeposit(p) >= depTarget
                            const playerStreaks = streakBonuses[p.id] || []
                            const pendingStreaks = playerStreaks.filter(sb => sb.payout_status !== 'paid')
                            const paidStreaks = playerStreaks.filter(sb => sb.payout_status === 'paid')
                            return (
                              <tr key={p.id} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                                <td style={{ ...s.td, fontWeight:700 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                                    <span style={{ cursor:'pointer' }} onClick={()=>{if(p.vip_id){closeModal();navigate(`/vips/${p.vip_id}`)}}}>
                                      {p.username}
                                    </span>
                                    {p.tier && <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)', fontSize:10 }}>{p.tier}</span>}
                                    <button title="Copy username" onClick={()=>copyUsername(p.id, p.username)} style={{ marginLeft:2, background:'none', border:'none', cursor:'pointer', fontSize:11, color: copiedId===p.id ? '#3fb950' : 'var(--muted)', padding:'1px 4px', borderRadius:4 }}>
                                      {copiedId===p.id ? '✓' : '⎘'}
                                    </button>
                                  </div>
                                  {selected?.streak_enabled && (
                                    <div style={{ marginTop:4, display:'flex', gap:4, flexWrap:'wrap' }}>
                                      {playerStreaks.length === 0
                                        ? <span style={{ fontSize:10, background:'rgba(255,165,0,.1)', color:'#f59e0b', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥 Streak ON</span>
                                        : <>
                                            {paidStreaks.length > 0 && <span style={{ fontSize:10, background:'rgba(63,185,80,.15)', color:'#3fb950', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥×{paidStreaks.length} paid</span>}
                                            {pendingStreaks.map(sb => <span key={sb.streak_number} style={{ fontSize:10, background:'rgba(245,158,11,.15)', color:'#f59e0b', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥#{sb.streak_number} {bonusFmt(sb.bonus_amount, campCurrency)}</span>)}
                                          </>
                                      }
                                    </div>
                                  )}
                                </td>
                                <td style={{ ...s.td, fontSize:12, color: p.host_assigned ? 'var(--text)' : 'var(--muted)' }}>{p.host_assigned || '—'}</td>
                                <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>
                                  <input defaultValue={p.whatsapp||''} onBlur={e=>{if(e.target.value!==(p.whatsapp||''))updatePlayer(p.id,{whatsapp:e.target.value})}} style={{ ...s.editInput, width:120 }} placeholder="—" />
                                </td>
                                <td style={s.td}>
                                  {isDailyMode ? (
                                    <>
                                      <input type="number" key={`${p.id}-${entryDate}-dep`} defaultValue={dailyEntry?.deposit_amount || ''}
                                        onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==(dailyEntry?.deposit_amount||0)) saveDailyEntry(p.id, v, dailyEntry?.turnover_amount||0) }}
                                        style={{ ...s.smInput, width:110, display:'block', marginBottom:4 }} placeholder="Deposit" disabled={dailyLoading} />
                                      <input type="number" key={`${p.id}-${entryDate}-to`} defaultValue={dailyEntry?.turnover_amount || ''}
                                        onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==(dailyEntry?.turnover_amount||0)) saveDailyEntry(p.id, dailyEntry?.deposit_amount||0, v) }}
                                        style={{ ...s.smInput, width:110 }} placeholder="Turnover" disabled={dailyLoading} />
                                    </>
                                  ) : <>
                                    <input type="number" defaultValue={playerDeposit(p)||''}
                                      onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==playerDeposit(p)) updatePlayer(p.id,{total_deposit:v, converted: campType==='dual_tier' ? calcDualTierReward(v,p.valid_bet,rewardTiers).tierIndex>=0 : v>=depTarget}) }}
                                      style={{ ...s.smInput, width:110 }} placeholder={campType==='dual_tier' ? 'Deposit' : undefined} />
                                    {campType==='dual_tier' && (
                                      <input type="number" defaultValue={p.valid_bet||''}
                                        onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==(p.valid_bet||0)) updatePlayer(p.id,{valid_bet:v, converted: calcDualTierReward(playerDeposit(p),v,rewardTiers).tierIndex>=0}) }}
                                        style={{ ...s.smInput, width:110, marginTop:4 }} placeholder="Turnover" />
                                    )}
                                  </>}
                                </td>
                                <td style={{ ...s.td, minWidth:140 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                    <div style={{ flex:1, height:6, background:'var(--surface2)', borderRadius:3, overflow:'hidden' }}>
                                      <div style={{ width:pr.pct+'%', height:'100%', background:pr.color, borderRadius:3 }} />
                                    </div>
                                    <span style={{ fontSize:11, color:pr.color, fontWeight:700, minWidth:36 }}>{pr.pct}%</span>
                                  </div>
                                  {multi && <div style={{ fontSize:10, color:'var(--muted)', marginTop:4 }}>
                                    {isDailyMode
                                      ? (() => {
                                          const dep = dailyEntry?.deposit_amount || 0
                                          const sortedLvls = [...campaignLevels].sort((a,b)=>(parseFloat(a.deposit_threshold)||0)-(parseFloat(b.deposit_threshold)||0))
                                          const nextLvl = sortedLvls.find(l => dep < (parseFloat(l.deposit_threshold)||0))
                                          return nextLvl ? `Next: ${nextLvl.level_name || ('Level '+nextLvl.level_order)} · ${rmFmt(Math.max(0, Number(nextLvl.deposit_threshold)-dep), campCurrency)} more` : dep > 0 ? 'All levels unlocked today' : '—'
                                        })()
                                      : (multiMetric?.allCompleted ? 'All campaign levels unlocked' : multiMetric?.nextLevel ? `Next: ${multiMetric.nextLevel.level_name} · ${rmFmt(Math.max(0, Number(multiMetric.nextLevel.deposit_threshold)-playerDeposit(p)), campCurrency)} more` : '—')
                                    }
                                  </div>}
                                </td>
                                <td style={{ ...s.td, color: qualified ? typeInfo.color : 'var(--muted)', fontWeight: qualified ? 700 : 400, fontSize:12 }}>
                                  {multi ? (
                                    isDailyMode ? (
                                      <span>
                                        {reward > 0 ? rmFmt(reward, campCurrency) : '—'} today
                                        <br />
                                        <span style={{ fontSize:10, color:'var(--muted)' }}>
                                          {(() => {
                                            if (dailyEntry?.tier_achieved == null) return 'No level yet'
                                            const lvl = campaignLevels.find(l => l.level_order === dailyEntry.tier_achieved)
                                            return lvl ? `${lvl.level_name || ('Level '+lvl.level_order)} achieved` : `Level ${dailyEntry.tier_achieved} achieved`
                                          })()}
                                        </span>
                                      </span>
                                    ) : (
                                      <span>{rmFmt(reward, campCurrency)} total<br /><span style={{ fontSize:10, color:'var(--muted)' }}>{multiMetric?.completedCount || 0}/{campaignLevels.length} levels unlocked</span></span>
                                    )
                                  ) : !qualified ? '—' : campType==='dual_tier'
                                      ? <span>{rmFmt(dualReward.creditAmount, campCurrency)} Credit<br/><span style={{fontSize:10,color:'var(--muted)'}}>+ {rmFmt(dualReward.wcashAmount, campCurrency)} WCash</span></span>
                                      : rmFmt(reward, campCurrency)}
                                </td>
                                <td style={{ ...s.td, minWidth:110 }} onClick={e=>e.stopPropagation()}>
                                  {(() => {
                                    const playerContacts = contacts[p.id] || []
                                    const last = playerContacts[0]
                                    const TYPE_ICON = { daily:'📅', reward:'🎁', inactive:'💤' }
                                    const TYPE_LABEL = { daily:'Daily', reward:'Reward', inactive:'Inactive' }
                                    let badge = null
                                    if (last) {
                                      const days = Math.floor((Date.now() - new Date(last.contacted_at).getTime()) / 86400000)
                                      const col = days === 0 ? '#3fb950' : days <= 2 ? '#f59e0b' : '#f85149'
                                      badge = <div style={{ fontSize:10, color:col, fontWeight:700, marginBottom:3 }}>
                                        {TYPE_ICON[last.contact_type]||'📞'} {days === 0 ? 'Today' : `${days}d ago`}
                                        <span style={{ color:'var(--muted)', fontWeight:400, marginLeft:3 }}>{TYPE_LABEL[last.contact_type]||last.contact_type}</span>
                                      </div>
                                    } else {
                                      badge = <div style={{ fontSize:10, color:'#f85149', fontWeight:700, marginBottom:3 }}>📞 Never</div>
                                    }
                                    return <>
                                      {badge}
                                      {contactLog === p.id ? (
                                        <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:160 }}>
                                          <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6, fontWeight:600 }}>Log contact:</div>
                                          {[['daily','📅 Daily'],['reward','🎁 Reward'],['inactive','💤 Inactive']].map(([type,lbl])=>(
                                            <button key={type} onClick={()=>logContact(p.id, type)}
                                              style={{ display:'block', width:'100%', textAlign:'left', background:'none', border:'1px solid var(--border)', color:'var(--text)', borderRadius:5, padding:'4px 8px', fontSize:11, cursor:'pointer', marginBottom:3 }}>
                                              {lbl}
                                            </button>
                                          ))}
                                          <button onClick={()=>setContactLog(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer', marginTop:2 }}>✕ Cancel</button>
                                        </div>
                                      ) : (
                                        <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                                          <button onClick={()=>setContactLog(p.id)}
                                            style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600 }}>
                                            + Log
                                          </button>
                                          {p.whatsapp && (() => {
                                            const chaseReward = multi
                                              ? (isDailyMode ? rmFmt(dailyEntry?.credit_reward||0, campCurrency) : rmFmt(multiMetric?.qualifiedRewardTotal||0, campCurrency))
                                              : campType==='dual_tier' ? rmFmt((dualReward?.creditAmount||0)+(dualReward?.wcashAmount||0), campCurrency)
                                              : rmFmt(calcReward(campType,playerDeposit(p),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level), campCurrency)
                                            const chaseWaUrl = waHref(p.whatsapp, buildWaMsg(p.username, selected?.campaign_name||'Campaign', chaseReward, waLang, p.host_assigned||null, null, selected))
                                            return <a href={chaseWaUrl} target="_blank" rel="noopener noreferrer"
                                              style={{ background:'rgba(37,211,102,.1)', color:'#25d366', border:'1px solid rgba(37,211,102,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600, textDecoration:'none' }}>
                                              📱 WA
                                            </a>
                                          })()}
                                        </div>
                                      )}
                                    </>
                                  })()}
                                </td>
                                <td style={s.td}><span style={{ ...s.tag(pr.color, pr.bg), fontSize:10 }}>{pr.label}</span></td>
                                <td style={s.td} onClick={e=>e.stopPropagation()}>
                                  <button onClick={()=>removePlayer(p.id)} style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>✕</button>
                                </td>
                              </tr>
                            )
                          })
                      }
                    </tbody>
                    </>
                  )}
                </table>
              </div>
            )}

            {/* ── PAYOUT TAB ── */}
            {activeTab === 'payout' && (
              <div style={{ overflowX:'auto' }}>
                <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(63,185,80,.04)', borderBottom:'1px solid var(--border)' }}>
                  {selected?.is_multi_level ? (selected?.payout_mode === 'highest_only' ? 'Payout mode: Highest level only — one reward per player. Mark paid only after it is actually issued.' : 'Payout mode: All levels — each unlocked level earns its own reward. Mark the individual reward paid only after it is actually issued.') : isDailyMode ? <>Showing players who qualified on <strong style={{ color:'#c9a961' }}>{entryDate}</strong>.</> : 'Only showing players who reached the campaign target.'}
                </div>
                {selected?.is_multi_level && !isDailyMode ? (
                  multiPayoutRows.length === 0 ? <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>No unlocked rewards are ready for payout yet.</div> : (
                    <table style={s.tbl}>
                      <thead><tr><th style={s.th}>#</th><th style={s.th}>Player</th><th style={s.th}>Tier</th><th style={s.th}>Level</th><th style={s.th}>Campaign Deposit</th><th style={s.th}>Reward</th><th style={s.th}>Payout Status</th><th style={s.th}>Paid At</th><th style={s.th}>Phone / WA</th><th style={s.th}>Notes</th></tr></thead>
                      <tbody>
                        {multiPayoutRows.map((row,i)=>{
                          const paid = row.status === 'paid'
                          const payoutLabel = paid ? '✅ Paid' : row.status === 'approved' ? '🟦 Approved' : '⏳ Pending'
                          const player = players.find(p=>p.id===row.playerId)
                          const note = campaignRewards.find(r=>r.id===row.rewardId)?.notes || ''
                          const waMultiAgent = player?.host_assigned || null
                          const waMultiMult = selected?.turnover_multiplier ? Number(selected.turnover_multiplier) : null
                          const waMultiTurnover = waMultiMult && row.rewardAmount > 0 ? rewardFmt(row.rewardAmount * waMultiMult, campCurrency) : null
                          const waMultiText = buildWaMsgText(row.username, selected?.campaign_name||'Campaign', rewardFmt(row.rewardAmount,campCurrency), waLang, waMultiAgent, waMultiTurnover, selected)
                          const waUrl = player?.whatsapp ? waHref(player.whatsapp, buildWaMsg(row.username, selected?.campaign_name||'Campaign', rewardFmt(row.rewardAmount,campCurrency), waLang, waMultiAgent, waMultiTurnover, selected)) : null
                          return <tr key={row.rewardId} style={{ background:paid?'rgba(63,185,80,.04)':'transparent' }}>
                            <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                            <td style={{ ...s.td, fontWeight:700 }}>{row.username}</td>
                            <td style={s.td}>{row.tier && <span style={{ ...s.badge, background:TIER_BG[row.tier]||'transparent', color:TIER_COLOR[row.tier]||'var(--muted)' }}>{row.tier}</span>}</td>
                            <td style={{ ...s.td, fontWeight:600 }}>{row.levelName}</td>
                            <td style={{ ...s.td, color:'#3fb950', fontWeight:600 }}>{player ? rmFmt(playerDeposit(player), campCurrency) : '—'}</td>
                            <td style={{ ...s.td, color:typeInfo.color, fontWeight:700 }}>{rewardFmt(row.rewardAmount,campCurrency)} Credit</td>
                            <td style={s.td}><button onClick={()=>toggleCampaignReward(row.rewardId,!paid)} style={{ ...s.tag(paid?'#3fb950':'#f59e0b',paid?'rgba(63,185,80,.15)':'rgba(245,158,11,.15)'),cursor:'pointer',border:`1px solid ${paid?'rgba(63,185,80,.3)':'rgba(245,158,11,.3)'}` }}>{payoutLabel}</button></td>
                            <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{row.paidAt ? new Date(row.paidAt).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
                            <td style={{...s.td,minWidth:130}}>
                              <div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>{player?.whatsapp||'—'}</div>
                              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                                {waUrl && <a href={waUrl} target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:4, background:'rgba(37,211,102,.15)', color:'#25d366', border:'1px solid rgba(37,211,102,.3)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, textDecoration:'none' }}>📲 WA</a>}
                                <button onClick={()=>navigator.clipboard.writeText(waMultiText).catch(()=>{})} style={{ background:'rgba(88,166,255,.12)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.3)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, cursor:'pointer' }}>📋 Copy</button>
                                {!waUrl && <span style={{fontSize:10,color:'var(--muted)'}}>No number</span>}
                              </div>
                            </td>
                            <td style={s.td}><input defaultValue={note} onBlur={async e=>{const v=e.target.value;if(v!==note){const {error}=await supabase.from('campaign_rewards').update({notes:v}).eq('id',row.rewardId);if(error)console.error(error)}}} style={{ ...s.editInput,width:140 }} placeholder="Add note..." /></td>
                          </tr>
                        })}
                        <tr style={{ background:'var(--surface2)',fontWeight:700 }}><td colSpan={5} style={s.td}>Total unlocked rewards</td><td style={{ ...s.td,color:typeInfo.color,fontWeight:800 }}>{rewardFmt(totalReward,campCurrency)} Credit</td><td style={s.td}><span style={{color:'#3fb950'}}>{rewardFmt(paidOut,campCurrency)} paid</span><span style={{color:'#f85149',marginLeft:8}}>{rewardFmt(pendingPay,campCurrency)} pending</span></td><td colSpan={3} style={s.td}/></tr>
                      </tbody>
                    </table>
                  )
                ) : (isDailyMode ? dailyAchieved : achieved).length === 0 ? (
                  <div style={{ padding:32,textAlign:'center',color:'var(--muted)' }}>{isDailyMode?'No players qualified on this date yet.':'No players have reached the target yet.'}</div>
                ) : (
                  <>
                  {/* Payout host filter */}
                  {chaseHosts.length > 1 && (
                    <div style={{ padding:'6px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span style={{ fontSize:11, color:'var(--muted)', fontWeight:600 }}>Host:</span>
                      {chaseHosts.map(h => (
                        <button key={h} onClick={()=>setPayoutHostFilter(h)}
                          style={{ padding:'3px 10px', borderRadius:14, fontSize:11, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                            background: payoutHostFilter===h ? 'var(--accent)' : 'var(--surface2)',
                            color: payoutHostFilter===h ? '#fff' : 'var(--muted)' }}>
                          {h === 'all' ? '🌐 All' : h}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Payout search + sort controls */}
                  <div style={{ padding:'8px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <input value={payoutSearch} onChange={e=>setPayoutSearch(e.target.value)}
                      placeholder={`🔍 Search ${filteredPayoutList.length} players…`}
                      style={{ ...s.smInput, width:220, fontSize:12 }} />
                    {payoutSearch && <button onClick={()=>setPayoutSearch('')} style={{ fontSize:11, color:'var(--muted)', background:'none', border:'none', cursor:'pointer', padding:'2px 6px' }}>✕</button>}
                    <span style={{ fontSize:11, color:'var(--muted)', marginLeft:4 }}>Sort:</span>
                    {[['deposit','Deposit'],['reward','Reward'],['name','Name']].map(([key,lbl])=>(
                      <button key={key} onClick={()=>{ if(payoutSort===key){setPayoutSortDir(d=>d==='asc'?'desc':'asc')}else{setPayoutSort(key);setPayoutSortDir('desc')} }}
                        style={{ padding:'3px 10px', borderRadius:14, fontSize:11, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                          background: payoutSort===key ? 'var(--accent)' : 'var(--surface2)', color: payoutSort===key ? '#fff' : 'var(--muted)' }}>
                        {lbl} {payoutSort===key ? (payoutSortDir==='asc' ? '↑' : '↓') : ''}
                      </button>
                    ))}
                    <span style={{ fontSize:11, color:'var(--muted)', marginLeft:8 }}>WA Lang:</span>
                    {[['en','EN'],['my','MY'],['cn','中文']].map(([key,lbl])=>(
                      <button key={key} onClick={()=>setWaLang(key)}
                        style={{ padding:'3px 10px', borderRadius:14, fontSize:11, fontWeight:700, border:'1px solid var(--border)', cursor:'pointer',
                          background: waLang===key ? '#25d366' : 'var(--surface2)', color: waLang===key ? '#fff' : 'var(--muted)' }}>
                        {lbl}
                      </button>
                    ))}
                    <span style={{ marginLeft:'auto', fontSize:11, color:'var(--muted)' }}>{filteredPayoutList.length} of {(isDailyMode?dailyAchieved:achieved).length} players</span>
                    <button onClick={() => {
                      try {
                        const campName = selected?.campaign_name || 'Campaign'
                        const dateStr = isDailyMode && entryDate ? entryDate : new Date().toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'})
                        const safeTiers = rewardTiers || []
                        const safeLevels = campaignLevels || []
                        const lines = filteredPayoutList.map(p => {
                          const entry = isDailyMode ? dailyEntries[p.id] : null
                          const dep = isDailyMode ? (parseFloat(entry?.deposit_amount)||0) : playerDeposit(p)
                          let rewardAmt = ''
                          if (isDailyMode && selected?.is_multi_level) {
                            const cr = parseFloat(entry?.credit_reward)||0
                            rewardAmt = cr > 0 ? `RM ${cr.toLocaleString('en-MY')} Credit` : ''
                          } else if (isDailyMode && campType === 'dual_tier') {
                            // Recalculate from entry deposit+turnover — same logic as payout table
                            const r = calcDualTierReward(entry?.deposit_amount||0, entry?.turnover_amount||0, safeTiers)
                            let credit = r.creditAmount
                            let wcash = r.wcashAmount
                            // If recalc gives 0 (missing tier config), try stored values
                            if (credit === 0 && wcash === 0) {
                              credit = parseFloat(entry?.credit_reward)||0
                              wcash = parseFloat(entry?.wcash_reward)||0
                            }
                            rewardAmt = [credit>0&&`RM ${credit.toLocaleString('en-MY')} Credit`, wcash>0&&`RM ${wcash.toLocaleString('en-MY')} WCash`].filter(Boolean).join(' + ')
                            // Last resort: show deposit/turnover so export isn't blank
                            if (!rewardAmt) {
                              const dep2 = parseFloat(entry?.deposit_amount)||0
                              const to2 = parseFloat(entry?.turnover_amount)||0
                              if (dep2 > 0) rewardAmt = `Dep RM ${dep2.toLocaleString('en-MY')}${to2>0?' / TO RM '+to2.toLocaleString('en-MY'):''} (pending tier calc)`
                            }
                          } else if (isDailyMode) {
                            const cr = parseFloat(entry?.credit_reward)||0
                            const wr = parseFloat(entry?.wcash_reward)||0
                            rewardAmt = [cr>0&&`RM ${cr.toLocaleString('en-MY')} Credit`, wr>0&&`RM ${wr.toLocaleString('en-MY')} WCash`].filter(Boolean).join(' + ')
                          } else if (campType === 'dual_tier') {
                            const r = calcDualTierReward(dep, p.valid_bet, safeTiers)
                            rewardAmt = [r.creditAmount>0&&`RM ${r.creditAmount.toLocaleString('en-MY')} Credit`, r.wcashAmount>0&&`RM ${r.wcashAmount.toLocaleString('en-MY')} WCash`].filter(Boolean).join(' + ')
                          } else {
                            const r = calcReward(campType, dep, rewardPct, rewardFixed, goldVal, rewardCap, safeTiers, safeLevels, selected?.is_multi_level)
                            rewardAmt = rewardFmt(r, campCurrency)
                          }
                          return `${p.username} - ${rewardAmt}`
                        })
                        // Pending streak bonuses (all players, not just payout list)
                        const streakLines = []
                        for (const p of players) {
                          const pending = (streakBonuses[p.id] || []).filter(sb => sb.payout_status !== 'paid')
                          for (const sb of pending) {
                            const amt = parseFloat(sb.bonus_amount) || 0
                            streakLines.push(`${p.username} - Streak #${sb.streak_number}: RM ${amt.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`)
                          }
                        }
                        let text = `${campName}\n${dateStr}\n\n${lines.join('\n')}`
                        if (streakLines.length > 0) text += `\n\n--- Pending Streak Bonuses ---\n${streakLines.join('\n')}`
                        navigator.clipboard.writeText(text).catch(()=>{})
                        const el = document.createElement('a')
                        el.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text)
                        el.download = `payout_${campName.replace(/\s+/g,'_')}_${dateStr.replace(/\s+/g,'_')}.txt`
                        el.click()
                      } catch(err) {
                        console.error('Export error:', err)
                        alert('Export failed: ' + err.message)
                      }
                    }} style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'4px 12px', borderRadius:6, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>
                      ⬇ Export
                    </button>
                  </div>
                  <table style={s.tbl}>
                    <thead><tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>Player</th>
                      <th style={s.th}>{isDailyMode&&selected?.is_multi_level ? 'Level' : 'Tier'}</th>
                      <th style={s.th}>{isDailyMode&&campType==='dual_tier'&&!selected?.is_multi_level?'Deposit / Turnover (this date)':isDailyMode?'Deposit (this date)':'Deposit'}</th>
                      <th style={s.th}>Reward</th>
                      <th style={s.th}>Payout Status</th>
                      <th style={s.th}>Last Contact</th>
                      <th style={s.th}>Host</th>
                      <th style={s.th}>Phone / WA</th>
                      <th style={s.th}>Notes</th>
                    </tr></thead>
                    <tbody>{filteredPayoutList.map((p,i)=>{
                      const isDailyMulti = isDailyMode && selected?.is_multi_level
                      const entry = dailyEntries[p.id]
                      const dualReward = !isDailyMulti && campType==='dual_tier'
                        ? (isDailyMode ? calcDualTierReward(entry?.deposit_amount||0, entry?.turnover_amount||0, rewardTiers) : calcDualTierReward(playerDeposit(p), p.valid_bet, rewardTiers))
                        : null
                      const creditReward = isDailyMulti
                        ? (entry?.credit_reward || 0)
                        : campType==='dual_tier' ? dualReward.creditAmount : calcReward(campType, playerDeposit(p), rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level)
                      const wcashReward = isDailyMulti ? 0 : campType==='dual_tier' ? dualReward.wcashAmount : 0
                      const lvlAchieved = isDailyMulti ? entry?.tier_achieved : null
                      const lvlObj = lvlAchieved != null ? campaignLevels.find(l=>l.level_order===lvlAchieved) : null
                      const lvlName = lvlObj ? (lvlObj.level_name || `Level ${lvlObj.level_order}`) : lvlAchieved != null ? `Level ${lvlAchieved}` : '—'
                      const paid = isDailyMode ? (dailyEntries[p.id]?.payout_status === 'paid') : (p.payout_status === 'paid')
                      const playerStreakBonuses = streakBonuses[p.id] || []
                      const pendingStreakBonus = playerStreakBonuses.filter(r => r.payout_status !== 'paid').reduce((s,r) => s + (parseFloat(r.bonus_amount)||0), 0)
                      const waAgent = p.host_assigned || null
                      const waTurnoverMult = selected?.turnover_multiplier ? Number(selected.turnover_multiplier) : null
                      const waTurnoverReq = waTurnoverMult && creditReward > 0 ? rmFmt(creditReward * waTurnoverMult, campCurrency) : null
                      const waMsgText = buildWaMsgText(p.username, selected?.campaign_name||'Campaign', rmFmt(creditReward,campCurrency), waLang, waAgent, waTurnoverReq, selected)
                      const waUrl = p.whatsapp ? waHref(p.whatsapp, buildWaMsg(p.username, selected?.campaign_name||'Campaign', rmFmt(creditReward,campCurrency), waLang, waAgent, waTurnoverReq, selected)) : null
                      return <tr key={p.id}>
                        <td style={{...s.td,color:'var(--muted)',fontSize:11}}>{i+1}</td>
                        <td style={{...s.td,fontWeight:700}}>{p.username}</td>
                        <td style={s.td}>{isDailyMulti
                          ? <span style={{ fontSize:11, color:'#c9a961', fontWeight:600 }}>{lvlName}</span>
                          : (p.tier ? <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)' }}>{p.tier}</span> : '—')
                        }</td>
                        <td style={{...s.td,color:'#3fb950',fontWeight:600}}>{isDailyMode
                          ? (campType==='dual_tier'&&!isDailyMulti
                            ? <span>{rmFmt(entry?.deposit_amount||0,campCurrency)}<br/><span style={{fontSize:10,color:'var(--muted)'}}>{rmFmt(entry?.turnover_amount||0,campCurrency)} TO</span></span>
                            : rmFmt(entry?.deposit_amount||0,campCurrency))
                          : rmFmt(playerDeposit(p),campCurrency)
                        }</td>
                        <td style={{...s.td,color:typeInfo.color,fontWeight:700}}>{isDailyMulti
                          ? <span>{rmFmt(creditReward,campCurrency)} Credit</span>
                          : campType==='dual_tier'
                            ? <span>{rmFmt(dualReward.creditAmount,campCurrency)} Credit<br/><span style={{fontSize:10,color:'var(--muted)'}}>+ {rmFmt(dualReward.wcashAmount,campCurrency)} WCash</span></span>
                            : rmFmt(creditReward,campCurrency)
                        }</td>
                        <td style={s.td}>
                          <button onClick={()=> isDailyMode ? updateDailyPayout(p.id, paid?'pending':'paid') : updatePlayer(p.id,{payout_status:paid?'pending':'paid',payout_date:paid?null:new Date().toISOString()})} style={{...s.tag(paid?'#3fb950':'#f59e0b',paid?'rgba(63,185,80,.15)':'rgba(245,158,11,.15)'),cursor:'pointer'}}>{paid?'✅ Paid':'⏳ Pending'}</button>
                          {selected?.streak_enabled && pendingStreakBonus > 0 && (
                            <div style={{ marginTop:3, fontSize:10, color:'#f59e0b', fontWeight:700, whiteSpace:'nowrap' }}>🔥 +{rmFmt(pendingStreakBonus, campCurrency)} streak</div>
                          )}
                        </td>
                        <td style={{ ...s.td, minWidth:110 }} onClick={e=>e.stopPropagation()}>
                          {(() => {
                            const playerContacts = contacts[p.id] || []
                            const last = playerContacts[0]
                            const TYPE_ICON = { daily:'📅', reward:'🎁', inactive:'💤' }
                            const TYPE_LABEL = { daily:'Daily', reward:'Reward', inactive:'Inactive' }
                            let badge = null
                            if (last) {
                              const days = Math.floor((Date.now() - new Date(last.contacted_at).getTime()) / 86400000)
                              const col = days === 0 ? '#3fb950' : days <= 2 ? '#f59e0b' : '#f85149'
                              badge = <div style={{ fontSize:10, color:col, fontWeight:700, marginBottom:3 }}>
                                {TYPE_ICON[last.contact_type]||'📞'} {days === 0 ? 'Today' : `${days}d ago`}
                                <span style={{ color:'var(--muted)', fontWeight:400, marginLeft:3 }}>{TYPE_LABEL[last.contact_type]||last.contact_type}</span>
                              </div>
                            } else {
                              badge = <div style={{ fontSize:10, color:'#f85149', fontWeight:700, marginBottom:3 }}>📞 Never</div>
                            }
                            return <>
                              {badge}
                              {contactLog === p.id ? (
                                <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:160 }}>
                                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6, fontWeight:600 }}>Log contact:</div>
                                  {[['daily','📅 Daily'],['reward','🎁 Reward'],['inactive','💤 Inactive']].map(([type,lbl])=>(
                                    <button key={type} onClick={()=>logContact(p.id, type)}
                                      style={{ display:'block', width:'100%', textAlign:'left', background:'none', border:'1px solid var(--border)', color:'var(--text)', borderRadius:5, padding:'4px 8px', fontSize:11, cursor:'pointer', marginBottom:3 }}>
                                      {lbl}
                                    </button>
                                  ))}
                                  <button onClick={()=>setContactLog(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer', marginTop:2 }}>✕ Cancel</button>
                                </div>
                              ) : (
                                <button onClick={()=>setContactLog(p.id)}
                                  style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600 }}>
                                  + Log
                                </button>
                              )}
                            </>
                          })()}
                        </td>
                        <td style={{...s.td,fontSize:12,color:'var(--muted)',fontWeight:600}}>{p.host_assigned||<span style={{color:'var(--surface2)'}}>—</span>}</td>
                        <td style={{...s.td,minWidth:130}}>
                          <div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>{p.whatsapp||<span style={{color:'var(--surface2)'}}>—</span>}</div>
                          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                            {waUrl && <a href={waUrl} target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:4, background:'rgba(37,211,102,.15)', color:'#25d366', border:'1px solid rgba(37,211,102,.3)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, textDecoration:'none' }}>📲 WA</a>}
                            <button onClick={()=>navigator.clipboard.writeText(waMsgText).catch(()=>{})} style={{ background:'rgba(88,166,255,.12)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.3)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, cursor:'pointer' }}>📋 Copy</button>
                            {!waUrl && <span style={{fontSize:10,color:'var(--muted)'}}>No number</span>}
                          </div>
                        </td>
                        <td style={s.td}><input defaultValue={p.notes||''} onBlur={e=>{if(e.target.value!==(p.notes||''))updatePlayer(p.id,{notes:e.target.value})}} style={{...s.editInput,width:140}} placeholder="Add note..."/></td>
                      </tr>
                    })}
                    {(() => {
                      const sumDep = filteredPayoutList.reduce((s,p) => s + (isDailyMode ? (parseFloat(dailyEntries[p.id]?.deposit_amount)||0) : playerDeposit(p)), 0)
                      const sumReward = filteredPayoutList.reduce((s,p) => {
                        if (isDailyMode && selected?.is_multi_level) return s + (dailyEntries[p.id]?.credit_reward || 0)
                        if (campType==='dual_tier' && !selected?.is_multi_level) {
                          const dr = isDailyMode ? calcDualTierReward(dailyEntries[p.id]?.deposit_amount||0, dailyEntries[p.id]?.turnover_amount||0, rewardTiers) : calcDualTierReward(playerDeposit(p), p.valid_bet, rewardTiers)
                          return s + dr.creditAmount + dr.wcashAmount
                        }
                        return s + calcReward(campType, playerDeposit(p), rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level)
                      }, 0)
                      const paidCount = filteredPayoutList.filter(p=> isDailyMode ? dailyEntries[p.id]?.payout_status==='paid' : p.payout_status==='paid').length
                      return (
                        <tr style={{ background:'var(--surface2)', fontWeight:700, borderTop:'2px solid var(--border)' }}>
                          <td colSpan={2} style={{ ...s.td, color:'var(--muted)', fontSize:12 }}>Total ({filteredPayoutList.length} players · {paidCount} paid)</td>
                          <td style={s.td}/>
                          <td style={{ ...s.td, color:'#3fb950', fontWeight:800 }}>{rmFmt(sumDep, campCurrency)}</td>
                          <td style={{ ...s.td, color:typeInfo.color, fontWeight:800 }}>{rmFmt(sumReward, campCurrency)}</td>
                          <td colSpan={4} style={s.td}/>
                        </tr>
                      )
                    })()}
                    </tbody>
                  </table>
                  </>
                )}

                {/* ── STREAK BONUSES PAYOUT SECTION ── */}
                {selected?.streak_enabled && (() => {
                  const allStreakRows = Object.entries(streakBonuses).flatMap(([playerId, rows]) => {
                    const player = players.find(p => p.id === playerId)
                    return rows.map(sb => ({ ...sb, username: player?.username || playerId, tier: player?.tier }))
                  }).sort((a, b) => a.username.localeCompare(b.username) || a.streak_number - b.streak_number)
                  if (!allStreakRows.length && !streakBonusesLoading) return (
                    <div style={{ borderTop:'2px solid var(--border)', marginTop:8, padding:'12px 24px', background:'rgba(245,158,11,.04)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
                        <span style={{ fontSize:13, fontWeight:800 }}>🔥 Streak Bonuses</span>
                        <span style={{ fontSize:11, background:'rgba(245,158,11,.15)', color:'#f59e0b', borderRadius:4, padding:'1px 8px', fontWeight:600 }}>Enabled</span>
                      </div>
                      <div style={{ fontSize:12, color:'var(--muted)' }}>No streak bonuses awarded yet. Bonuses are triggered automatically after {selected.streak_days} consecutive qualifying days.</div>
                    </div>
                  )
                  return (
                    <div style={{ borderTop:'2px solid var(--border)', marginTop:8 }}>
                      <div style={{ padding:'10px 24px', display:'flex', alignItems:'center', gap:10, background:'rgba(245,158,11,.04)' }}>
                        <span style={{ fontSize:13, fontWeight:800 }}>🔥 Streak Bonuses</span>
                        {streakBonusesLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>Loading…</span>}
                        {!streakBonusesLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>{allStreakRows.length} bonus{allStreakRows.length !== 1 ? 'es' : ''} · {allStreakRows.filter(r=>r.payout_status==='paid').length} paid · {bonusFmt(allStreakRows.filter(r=>r.payout_status!=="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} pending</span>}
                        <button onClick={()=>loadStreakBonuses(selected.id)} style={{ marginLeft:'auto', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer' }}>↺ Refresh</button>
                      </div>
                      {allStreakRows.length > 0 && (
                        <table style={s.tbl}>
                          <thead><tr>
                            <th style={s.th}>#</th>
                            <th style={s.th}>Player</th>
                            <th style={s.th}>Streak</th>
                            <th style={s.th}>Period</th>
                            <th style={s.th}>Period Deposit</th>
                            <th style={s.th}>Bonus</th>
                            <th style={s.th}>Pay Date</th>
                            <th style={s.th}>Status</th>
                            <th style={s.th}>Notes</th>
                          </tr></thead>
                          <tbody>
                            {allStreakRows.map((sb, i) => {
                              const paid = sb.payout_status === 'paid'
                              return (
                                <tr key={sb.id} style={{ background: paid ? 'rgba(63,185,80,.04)' : 'transparent' }}>
                                  <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                                  <td style={{ ...s.td, fontWeight:700 }}>
                                    {sb.username}
                                    {sb.tier && <span style={{ ...s.badge, background:TIER_BG[sb.tier]||'transparent', color:TIER_COLOR[sb.tier]||'var(--muted)', fontSize:10, marginLeft:4 }}>{sb.tier}</span>}
                                  </td>
                                  <td style={{ ...s.td, color:'#f59e0b', fontWeight:700 }}>🔥 #{sb.streak_number}</td>
                                  <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{fmtDate(sb.period_start)} → {fmtDate(sb.period_end)}</td>
                                  <td style={{ ...s.td, color:'#3fb950', fontWeight:600 }}>{rmFmt(sb.period_deposit, campCurrency)}</td>
                                  <td style={{ ...s.td, color:'#f59e0b', fontWeight:800 }}>{bonusFmt(sb.bonus_amount, campCurrency)}</td>
                                  <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{sb.payout_date ? fmtDate(sb.payout_date) : '—'}</td>
                                  <td style={s.td}>
                                    <button onClick={async () => {
                                      const newStatus = paid ? 'pending' : 'paid'
                                      const { error } = await supabase.from('campaign_streak_bonuses').update({ payout_status: newStatus, payout_date: newStatus === 'paid' ? new Date().toISOString().slice(0,10) : sb.payout_date }).eq('id', sb.id)
                                      if (error) { console.error(error); return }
                                      await loadStreakBonuses(selected.id)
                                    }} style={{ ...s.tag(paid ? '#3fb950' : '#f59e0b', paid ? 'rgba(63,185,80,.15)' : 'rgba(245,158,11,.15)'), cursor:'pointer', border:`1px solid ${paid ? 'rgba(63,185,80,.3)' : 'rgba(245,158,11,.3)'}` }}>
                                      {paid ? '✅ Paid' : '⏳ Pending'}
                                    </button>
                                  </td>
                                  <td style={s.td}>
                                    <input defaultValue={sb.notes||''} onBlur={async e => { const v=e.target.value; if(v!==(sb.notes||'')) { await supabase.from('campaign_streak_bonuses').update({notes:v}).eq('id',sb.id); await loadStreakBonuses(selected.id) }}} style={{ ...s.editInput, width:140 }} placeholder="Add note…" />
                                  </td>
                                </tr>
                              )
                            })}
                            <tr style={{ background:'var(--surface2)', fontWeight:700 }}>
                              <td colSpan={5} style={s.td}>Total streak bonuses</td>
                              <td style={{ ...s.td, color:'#f59e0b', fontWeight:800 }}>{bonusFmt(allStreakRows.reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)}</td>
                              <td style={s.td} />
                              <td style={s.td}><span style={{color:'#3fb950'}}>{bonusFmt(allStreakRows.filter(r=>r.payout_status==="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} paid</span><span style={{color:'#f85149',marginLeft:8}}>{bonusFmt(allStreakRows.filter(r=>r.payout_status!=="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} pending</span></td>
                              <td style={s.td} />
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ── ALL PLAYERS TAB ── */}
            {/* ── INACTIVE TAB ── */}
            {activeTab === 'inactive' && (() => {
              // Players with zero qualifying entries (credit_reward > 0) across the whole campaign
              const qualifiedPlayerIds = new Set(
                allDailyEntries.filter(e => (parseFloat(e.credit_reward) || 0) > 0).map(e => e.player_id)
              )
              const allInactivePlayers = players.filter(p => !qualifiedPlayerIds.has(p.id))
              const inactiveHosts = ['all', ...Array.from(new Set(allInactivePlayers.map(p => p.host_assigned).filter(Boolean))).sort()]
              const inactivePlayers = inactiveHostFilter === 'all' ? allInactivePlayers : allInactivePlayers.filter(p => p.host_assigned === inactiveHostFilter)
              return (
                <div style={{ overflowX:'auto' }}>
                  <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(88,166,255,.04)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12 }}>
                    <span>😴 Players enrolled but never qualified for a reward across the entire campaign period</span>
                    {allDailyEntriesLoading && <span style={{ color:'#f59e0b' }}>Loading…</span>}
                    <button onClick={() => loadAllDailyEntries(selected.id)} style={{ marginLeft:'auto', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer' }}>↺ Refresh</button>
                  </div>
                  {/* Inactive tab host filter */}
                  {inactiveHosts.length > 1 && (
                    <div style={{ padding:'6px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span style={{ fontSize:11, color:'var(--muted)', marginRight:2 }}>Host:</span>
                      {inactiveHosts.map(h => (
                        <button key={h} onClick={() => setInactiveHostFilter(h)} style={{
                          padding:'3px 12px', borderRadius:16, fontSize:12, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                          background: inactiveHostFilter === h ? 'var(--accent)' : 'var(--surface2)',
                          color: inactiveHostFilter === h ? '#fff' : 'var(--muted)',
                        }}>{h === 'all' ? `All (${allInactivePlayers.length})` : `${h} (${allInactivePlayers.filter(p=>p.host_assigned===h).length})`}</button>
                      ))}
                    </div>
                  )}
                  {!allDailyEntriesLoading && inactivePlayers.length === 0 && (
                    <div style={{ padding:'32px 24px', textAlign:'center', color:'var(--muted)', fontSize:13 }}>🎉 All enrolled players have qualified at least once!</div>
                  )}
                  {inactivePlayers.length > 0 && (
                    <table style={s.tbl}>
                      <thead><tr>
                        <th style={s.th}>#</th>
                        <th style={s.th}>Player</th>
                        <th style={s.th}>Tier</th>
                        <th style={s.th}>Host</th>
                        <th style={s.th}>WhatsApp</th>
                        <th style={s.th}>Last Contact</th>
                        <th style={s.th}>Enrolled</th>
                        <th style={s.th}>Days in Campaign</th>
                      </tr></thead>
                      <tbody>
                        {inactivePlayers.map((p, i) => {
                          const enrolledDate = p.added_at ? new Date(p.added_at).toLocaleDateString('en-MY', { day:'numeric', month:'short' }) : '—'
                          // how many days this player has any entry (even non-qualifying)
                          const playerEntryDates = allDailyEntries.filter(e => e.player_id === p.id)
                          const playerContacts = contacts[p.id] || []
                          const lastContact = playerContacts[0]
                          const TYPE_ICON = { daily:'📅', reward:'🎁', inactive:'💤' }
                          const TYPE_LABEL = { daily:'Daily', reward:'Reward', inactive:'Inactive' }
                          return (
                            <tr key={p.id}>
                              <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                              <td style={{ ...s.td, fontWeight:700 }}>{p.username}</td>
                              <td style={s.td}>{p.tier ? <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)' }}>{p.tier}</span> : '—'}</td>
                              <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{p.host_assigned || '—'}</td>
                              <td style={{ ...s.td, fontSize:12 }}>{p.whatsapp || <span style={{ color:'var(--surface2)' }}>—</span>}</td>
                              <td style={{ ...s.td, minWidth:110 }} onClick={e=>e.stopPropagation()}>
                                {(() => {
                                  let badge
                                  if (lastContact) {
                                    const days = Math.floor((Date.now() - new Date(lastContact.contacted_at).getTime()) / 86400000)
                                    const col = days === 0 ? '#3fb950' : days <= 2 ? '#f59e0b' : '#f85149'
                                    badge = <div style={{ fontSize:10, color:col, fontWeight:700, marginBottom:3 }}>
                                      {TYPE_ICON[lastContact.contact_type]||'📞'} {days === 0 ? 'Today' : `${days}d ago`}
                                      <span style={{ color:'var(--muted)', fontWeight:400, marginLeft:3 }}>{TYPE_LABEL[lastContact.contact_type]||lastContact.contact_type}</span>
                                    </div>
                                  } else {
                                    badge = <div style={{ fontSize:10, color:'#f85149', fontWeight:700, marginBottom:3 }}>📞 Never</div>
                                  }
                                  return <>
                                    {badge}
                                    {contactLog === p.id ? (
                                      <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:160 }}>
                                        <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6, fontWeight:600 }}>Log contact:</div>
                                        {[['daily','📅 Daily'],['reward','🎁 Reward'],['inactive','💤 Inactive']].map(([type,lbl])=>(
                                          <button key={type} onClick={()=>logContact(p.id, type)}
                                            style={{ display:'block', width:'100%', textAlign:'left', background:'none', border:'1px solid var(--border)', color:'var(--text)', borderRadius:5, padding:'4px 8px', fontSize:11, cursor:'pointer', marginBottom:3 }}>
                                            {lbl}
                                          </button>
                                        ))}
                                        <button onClick={()=>setContactLog(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer', marginTop:2 }}>✕ Cancel</button>
                                      </div>
                                    ) : (
                                      <button onClick={()=>setContactLog(p.id)}
                                        style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600 }}>
                                        + Log
                                      </button>
                                    )}
                                  </>
                                })()}
                              </td>
                              <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{enrolledDate}</td>
                              <td style={{ ...s.td, fontSize:12, color: playerEntryDates.length > 0 ? '#f59e0b' : '#f85149' }}>
                                {playerEntryDates.length > 0 ? `${playerEntryDates.length} entries (0 qualifying)` : 'No entries at all'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)' }}>
                    {inactiveHostFilter !== 'all' ? `${inactivePlayers.length} shown · ` : ''}{allInactivePlayers.length} inactive · {players.length - allInactivePlayers.length} active
                  </div>
                </div>
              )
            })()}

            {/* ── STREAK TAB ── */}
            {activeTab === 'streak' && (() => {
              const streakDays = Number(selected?.streak_days) || 3
              const bonusType = selected?.streak_bonus_type || 'pct'
              const bonusPct = Number(selected?.streak_bonus_pct) || 1.0
              const bonusFixed = Number(selected?.streak_bonus_fixed) || 0
              const bonusCap = Number(selected?.streak_bonus_cap) || 0

              // Compute min qualifying deposit (lowest level threshold or deposit_target)
              const sortedLvls = [...campaignLevels].sort((a, b) => (parseFloat(a.deposit_threshold)||0) - (parseFloat(b.deposit_threshold)||0))
              const minThreshold = sortedLvls.length > 0 ? (parseFloat(sortedLvls[0].deposit_threshold)||0) : (parseFloat(selected?.deposit_target)||5000)

              // Build per-player streak data from allDailyEntries
              const perPlayer = {}
              for (const e of allDailyEntries) {
                if (!perPlayer[e.player_id]) perPlayer[e.player_id] = []
                perPlayer[e.player_id].push(e)
              }

              const playerStreakRows = players.map(p => {
                const entries = (perPlayer[p.id] || []).filter(e => (parseFloat(e.deposit_amount)||0) >= minThreshold)
                const dates = entries.map(e => e.entry_date).sort()
                // Find all consecutive runs
                const runs = []
                if (dates.length > 0) {
                  let cur = [dates[0]]
                  for (let i = 1; i < dates.length; i++) {
                    const prev = new Date(dates[i-1] + 'T00:00:00Z')
                    const next = new Date(dates[i] + 'T00:00:00Z')
                    if (Math.round((next - prev) / 86400000) === 1) { cur.push(dates[i]) }
                    else { runs.push(cur); cur = [dates[i]] }
                  }
                  runs.push(cur)
                }
                const maxStreak = runs.length > 0 ? Math.max(...runs.map(r => r.length)) : 0
                const currentRun = runs.length > 0 ? runs[runs.length - 1] : []
                const achieved = maxStreak >= streakDays
                // Total deposit across qualifying entries for bonus calc
                const totalDeposit = entries.reduce((s, e) => s + (parseFloat(e.deposit_amount)||0), 0)
                const totalReward = (perPlayer[p.id]||[]).reduce((s, e) => s + (parseFloat(e.credit_reward)||0), 0)
                // Compute bonus
                let bonusAmt = 0
                if (achieved) {
                  bonusAmt = bonusType === 'pct' ? totalDeposit * bonusPct / 100 : bonusFixed
                  if (bonusCap > 0) bonusAmt = Math.min(bonusAmt, bonusCap)
                }
                // Streak bonus records already in DB
                const awardedBonuses = streakBonuses[p.id] || []
                return { p, dates, runs, maxStreak, currentRun, achieved, bonusAmt, totalReward, awardedBonuses }
              }).sort((a, b) => b.maxStreak - a.maxStreak || a.p.username.localeCompare(b.p.username))

              // Flatten streak bonus rows for payout section
              const allStreakRows = Object.entries(streakBonuses).flatMap(([playerId, rows]) => {
                const player = players.find(p => p.id === playerId)
                return rows.map(sb => ({ ...sb, username: player?.username || playerId, tier: player?.tier, host: player?.host_assigned }))
              }).sort((a, b) => a.username.localeCompare(b.username) || a.streak_number - b.streak_number)

              return (
                <div style={{ overflowX:'auto' }}>
                  {/* Header */}
                  <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(245,158,11,.04)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12 }}>
                    <span>🔥 Streak target: <strong>{streakDays} consecutive days</strong> · Bonus: {bonusType === 'pct' ? `${bonusPct}% of period deposit` : `RM ${bonusFixed} fixed`}{bonusCap > 0 ? ` (cap: ${rmFmt(bonusCap, campCurrency)})` : ''}</span>
                    {allDailyEntriesLoading && <span style={{ color:'#f59e0b' }}>Loading…</span>}
                    {!selected?.streak_enabled && <span style={{ background:'rgba(248,81,73,.15)', color:'#f85149', borderRadius:4, padding:'1px 8px', fontSize:10, fontWeight:700 }}>STREAK DISABLED</span>}
                    <button onClick={async () => {
                      await loadAllDailyEntries(selected.id)
                      if (selected?.streak_enabled) {
                        const today = new Date().toISOString().slice(0, 10)
                        for (const p of players) await checkAndAwardStreak(p.id, today)
                      }
                      await loadStreakBonuses(selected.id)
                    }} style={{ marginLeft:'auto', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer' }}>↺ Refresh</button>
                  </div>

                  {/* Streak Bonus Payout section — shown first */}
                  <div style={{ borderBottom:'2px solid var(--border)', marginBottom:8 }}>
                    <div style={{ padding:'10px 24px', display:'flex', alignItems:'center', gap:10, background:'rgba(245,158,11,.04)' }}>
                      <span style={{ fontSize:13, fontWeight:800 }}>💸 Streak Bonus Payout</span>
                      {streakBonusesLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>Loading…</span>}
                      {!streakBonusesLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>
                        {allStreakRows.length} bonus{allStreakRows.length !== 1 ? 'es' : ''} · {allStreakRows.filter(r=>r.payout_status==='paid').length} paid · {bonusFmt(allStreakRows.filter(r=>r.payout_status!=="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} pending
                      </span>}
                      <button onClick={() => loadStreakBonuses(selected.id)} style={{ marginLeft:'auto', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer' }}>↺ Refresh</button>
                    </div>
                    {allStreakRows.length === 0 && !streakBonusesLoading && (
                      <div style={{ padding:'16px 24px', fontSize:12, color:'var(--muted)' }}>
                        No streak bonuses awarded yet. Bonuses are triggered automatically when a player saves a qualifying entry that completes a {streakDays}-day streak.
                      </div>
                    )}
                    {allStreakRows.length > 0 && (
                      <table style={s.tbl}>
                        <thead><tr>
                          <th style={s.th}>#</th>
                          <th style={s.th}>Player</th>
                          <th style={s.th}>Host</th>
                          <th style={s.th}>Streak #</th>
                          <th style={s.th}>Period</th>
                          <th style={s.th}>Period Deposit</th>
                          <th style={s.th}>Bonus</th>
                          <th style={s.th}>Pay Date</th>
                          <th style={s.th}>Status</th>
                          <th style={s.th}>Notes</th>
                        </tr></thead>
                        <tbody>
                          {allStreakRows.map((sb, i) => {
                            const paid = sb.payout_status === 'paid'
                            return (
                              <tr key={sb.id} style={{ background: paid ? 'rgba(63,185,80,.04)' : 'transparent' }}>
                                <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                                <td style={{ ...s.td, fontWeight:700 }}>
                                  {sb.username}
                                  {sb.tier && <span style={{ ...s.badge, background:TIER_BG[sb.tier]||'transparent', color:TIER_COLOR[sb.tier]||'var(--muted)', fontSize:10, marginLeft:4 }}>{sb.tier}</span>}
                                </td>
                                <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{sb.host || '—'}</td>
                                <td style={{ ...s.td, color:'#f59e0b', fontWeight:700 }}>🔥 #{sb.streak_number}</td>
                                <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{fmtDate(sb.period_start)} → {fmtDate(sb.period_end)}</td>
                                <td style={{ ...s.td, color:'#3fb950', fontWeight:600 }}>{rmFmt(sb.period_deposit, campCurrency)}</td>
                                <td style={{ ...s.td, color:'#f59e0b', fontWeight:800 }}>{bonusFmt(sb.bonus_amount, campCurrency)}</td>
                                <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{sb.payout_date ? fmtDate(sb.payout_date) : '—'}</td>
                                <td style={s.td}>
                                  <button onClick={async () => {
                                    const newStatus = paid ? 'pending' : 'paid'
                                    const { error } = await supabase.from('campaign_streak_bonuses').update({ payout_status: newStatus, payout_date: newStatus === 'paid' ? new Date().toISOString().slice(0,10) : sb.payout_date }).eq('id', sb.id)
                                    if (error) { console.error(error); return }
                                    await loadStreakBonuses(selected.id)
                                  }} style={{ ...s.tag(paid ? '#3fb950' : '#f59e0b', paid ? 'rgba(63,185,80,.15)' : 'rgba(245,158,11,.15)'), cursor:'pointer', border:`1px solid ${paid ? 'rgba(63,185,80,.3)' : 'rgba(245,158,11,.3)'}` }}>
                                    {paid ? '✅ Paid' : '⏳ Pending'}
                                  </button>
                                </td>
                                <td style={s.td}>
                                  <input defaultValue={sb.notes||''} onBlur={async e => { const v=e.target.value; if(v!==(sb.notes||'')) { await supabase.from('campaign_streak_bonuses').update({notes:v}).eq('id',sb.id); await loadStreakBonuses(selected.id) }}} style={{ ...s.editInput, width:140 }} placeholder="Add note…" />
                                </td>
                              </tr>
                            )
                          })}
                          <tr style={{ background:'var(--surface2)', fontWeight:700 }}>
                            <td colSpan={6} style={s.td}>Total streak bonuses</td>
                            <td style={{ ...s.td, color:'#f59e0b', fontWeight:800 }}>{bonusFmt(allStreakRows.reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)}</td>
                            <td style={s.td} />
                            <td style={s.td}>
                              <span style={{color:'#3fb950'}}>{bonusFmt(allStreakRows.filter(r=>r.payout_status==="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} paid</span>
                              <span style={{color:'#f85149',marginLeft:8}}>{bonusFmt(allStreakRows.filter(r=>r.payout_status!=="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} pending</span>
                            </td>
                            <td style={s.td} />
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Streak progress table — below payout */}
                  <table style={s.tbl}>
                    <thead><tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>Player</th>
                      <th style={s.th}>Tier</th>
                      <th style={s.th}>Host</th>
                      <th style={s.th}>Qualifying Days</th>
                      <th style={s.th}>Max Streak</th>
                      <th style={s.th}>Current Run</th>
                      <th style={s.th}>Target ({streakDays}d)</th>
                      <th style={s.th}>Cap Override</th>
                      <th style={s.th}>Est. Bonus</th>
                      <th style={s.th}>Awarded</th>
                    </tr></thead>
                    <tbody>
                      {playerStreakRows.map(({ p, dates, maxStreak, currentRun, achieved, bonusAmt, awardedBonuses }, i) => {
                        const awardedTotal = awardedBonuses.reduce((s, r) => s + (parseFloat(r.bonus_amount)||0), 0)
                        const awardedPaid = awardedBonuses.filter(r => r.payout_status === 'paid').length
                        const playerCapOverride = parseFloat(p.streak_bonus_cap_override) || 0
                        const campaignCap = parseFloat(selected.streak_bonus_cap) || 0
                        return (
                          <tr key={p.id} style={{ background: achieved ? 'rgba(63,185,80,.04)' : 'transparent' }}>
                            <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                            <td style={{ ...s.td, fontWeight:700 }}>{p.username}</td>
                            <td style={s.td}>{p.tier ? <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)' }}>{p.tier}</span> : '—'}</td>
                            <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{p.host_assigned || '—'}</td>
                            <td style={{ ...s.td, color:'#58a6ff', fontWeight:600 }}>{dates.length}</td>
                            <td style={{ ...s.td, color: maxStreak >= streakDays ? '#3fb950' : maxStreak >= Math.ceil(streakDays * 0.6) ? '#f59e0b' : 'var(--muted)', fontWeight:700, fontSize:15 }}>
                              {maxStreak > 0 ? `🔥 ${maxStreak}` : '—'}
                            </td>
                            <td style={{ ...s.td, fontSize:12, color: currentRun.length >= streakDays ? '#3fb950' : 'var(--muted)' }}>
                              {currentRun.length > 0 ? `${currentRun.length}d (${fmtDate(currentRun[0])}→${fmtDate(currentRun[currentRun.length-1])})` : '—'}
                            </td>
                            <td style={s.td}>
                              {achieved
                                ? <span style={{ color:'#3fb950', fontWeight:700 }}>✅ Hit</span>
                                : <span style={{ color:'#f85149', fontWeight:600 }}>❌ {streakDays - maxStreak}d short</span>
                              }
                            </td>
                            <td style={{ ...s.td, fontSize:11 }}>
                              <input
                                key={p.streak_bonus_cap_override}
                                defaultValue={playerCapOverride > 0 ? playerCapOverride : ''}
                                placeholder={campaignCap > 0 ? `${campaignCap} (camp)` : 'No cap'}
                                onBlur={async e => {
                                  const val = e.target.value.trim()
                                  const newCap = val === '' ? null : parseFloat(val)
                                  if (isNaN(newCap) && val !== '') return
                                  const { error } = await supabase.from('campaign_players')
                                    .update({ streak_bonus_cap_override: newCap })
                                    .eq('id', p.id)
                                  if (error) { console.error(error); return }
                                  await loadPlayers(selected.id)
                                }}
                                style={{ ...s.editInput, width:80, color: playerCapOverride > 0 ? '#f85149' : 'var(--muted)' }}
                              />
                            </td>
                            <td style={{ ...s.td, color: achieved ? '#f59e0b' : 'var(--muted)', fontWeight: achieved ? 700 : 400 }}>
                              {achieved ? rmFmt(bonusAmt, campCurrency) : '—'}
                            </td>
                            <td style={{ ...s.td, fontSize:11 }}>
                              {awardedBonuses.length > 0
                                ? <span>{awardedBonuses.length} bonus{awardedBonuses.length>1?'es':''} · {rmFmt(awardedTotal, campCurrency)} · {awardedPaid}/{awardedBonuses.length} paid</span>
                                : <span style={{ color:'var(--surface2)' }}>—</span>
                              }
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}

            {activeTab === 'register' && (
              <div style={{ overflowX:'auto' }}>
                <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(88,166,255,.04)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span>Deposit is manually tracked for reward eligibility · Turnover/Withdrawal are real platform data for the campaign period ({fmtDate(selected.start_date)} → {fmtDate(selected.end_date)})</span>
                  <button onClick={()=>{
                    const headers = ['#','Username','Tier','WhatsApp','Deposit (RM)','Turnover Real (RM)','Withdrawal Real (RM)','vs Target','Reward (RM)','Status','Added']
                    const rows = players.map((p,i)=>{
                      const real = realFinancials?.byPlayer?.[p.username]
                      const dailyTotal = isDailyMode ? summaryData?.playerRows?.find(r=>r.username===p.username) : null
                      const multi = selected?.is_multi_level && campType==='fixed_reward'
                      const multiMetric = multi ? multiMetricsByPlayer[p.id] : null
                      const dualReward = campType==='dual_tier' && !isDailyMode ? calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers) : null
                      const qualified = multi ? (multiMetric?.completedCount>0) : isDailyMode ? !!dailyTotal : campType==='dual_tier' ? dualReward.tierIndex>=0 : playerDeposit(p)>=depTarget
                      const reward = multi ? (multiMetric?.qualifiedRewardTotal||0) : isDailyMode ? (dailyTotal ? dailyTotal.credit+dailyTotal.wcash : 0) : !qualified ? 0 : campType==='dual_tier' ? (dualReward.creditAmount+dualReward.wcashAmount) : calcReward(campType,playerDeposit(p),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level)
                      const gap = multi ? (multiMetric?.nextLevel ? playerDeposit(p)-Number(multiMetric.nextLevel.deposit_threshold) : 0) : campType==='dual_tier' ? null : playerDeposit(p)-depTarget
                      const statusLabel = multi ? (multiMetric?.allCompleted ? 'Complete' : `${multiMetric?.completedCount||0}/${campaignLevels.length} Levels`) : (p.payout_status==='paid' ? 'Paid' : qualified ? 'Qualified' : 'In Progress')
                      const deposit = isDailyMode ? (real ? real.deposit : 0) : playerDeposit(p)
                      const vsTarget = campType==='dual_tier' ? 'N/A' : (gap!=null ? (gap>=0?'+':'')+gap.toFixed(0) : '—')
                      const added = p.added_at ? new Date(p.added_at).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'
                      return [i+1, p.username, p.tier||'', p.whatsapp||'', deposit.toFixed(2), real ? real.validBet.toFixed(2) : '', real ? real.withdrawal.toFixed(2) : '', vsTarget, reward.toFixed(2), statusLabel, added]
                    })
                    const csv = [headers, ...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
                    const blob = new Blob([csv], {type:'text/csv'})
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${selected.campaign_code||selected.campaign_name}-all-players.csv`
                    a.click()
                    URL.revokeObjectURL(url)
                  }} style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>⬇ Export CSV</button>
                </div>
                <table style={s.tbl}>
                  <thead><tr>
                    <th style={s.th}>#</th>
                    <th style={s.th}>Username</th>
                    <th style={s.th}>Tier</th>
                    <th style={s.th}>WhatsApp</th>
                    <th style={s.th}>Deposit</th>
                    <th style={s.th}>Turnover (real)</th>
                    <th style={s.th}>Withdrawal (real)</th>
                    <th style={s.th}>{selected?.is_multi_level ? 'Next Level' : 'vs Target'}</th>
                    <th style={s.th}>Reward</th>
                    {selected?.streak_enabled && <th style={s.th}>Streak 🔥</th>}
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Added</th>
                    <th style={s.th}>✕</th>
                  </tr></thead>
                  <tbody>
                    {players.length===0
                      ? <tr><td colSpan={12} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>No players yet.</td></tr>
                      : players.map((p,i)=>{
                          const real = realFinancials?.byPlayer?.[p.username]
                          // Daily mode never writes to campaign_players.total_deposit/valid_bet —
                          // Chase List writes to daily_turnover_entries instead. Checking the old
                          // fields here would always show "not qualified" regardless of actual
                          // daily performance. Use the aggregated per-player totals from Summary
                          // (calcDualTierReward re-run per day, summed) instead.
                          const dailyTotal = isDailyMode ? summaryData?.playerRows?.find(r => r.username === p.username) : null
                          const multi = selected?.is_multi_level && campType === 'fixed_reward'
                          const multiMetric = multi ? multiMetricsByPlayer[p.id] : null
                          const dualReward = campType==='dual_tier' && !isDailyMode ? calcDualTierReward(playerDeposit(p), p.valid_bet, rewardTiers) : null
                          const qualified = multi ? (multiMetric?.completedCount > 0) : isDailyMode ? !!dailyTotal : campType==='dual_tier' ? dualReward.tierIndex >= 0 : playerDeposit(p) >= depTarget
                          const reward = multi ? (multiMetric?.qualifiedRewardTotal || 0) : isDailyMode ? (dailyTotal ? dailyTotal.credit + dailyTotal.wcash : 0)
                            : !qualified ? 0 : campType==='dual_tier' ? (dualReward.creditAmount + dualReward.wcashAmount) : calcReward(campType, playerDeposit(p), rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level)
                          const gap = multi ? (multiMetric?.nextLevel ? playerDeposit(p) - Number(multiMetric.nextLevel.deposit_threshold) : 0) : campType === 'dual_tier' ? null : playerDeposit(p) - depTarget
                          const rowStatusColor = multi ? (multiMetric?.allCompleted ? '#3fb950' : qualified ? '#f59e0b' : 'var(--muted)') : (p.payout_status==='paid' ? '#3fb950' : qualified ? '#f59e0b' : 'var(--muted)')
                          const rowStatusLabel = multi ? (multiMetric?.allCompleted ? 'Complete' : `${multiMetric?.completedCount||0}/${campaignLevels.length} Levels`) : (p.payout_status==='paid' ? 'Paid' : qualified ? 'Qualified' : 'In Progress')
                          return (
                            <tr key={p.id} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                              <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                              <td style={{ ...s.td, fontWeight:700 }}>{p.username}</td>
                              <td style={s.td}>{p.tier && <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)' }}>{p.tier}</span>}</td>
                              <td style={{ ...s.td, fontSize:12 }}>{p.whatsapp||'—'}</td>
                              <td style={{ ...s.td, color:'#3fb950' }}>
                                {isDailyMode
                                  ? rmFmt(summaryData?.depositByPlayer?.[p.id] ?? null, campCurrency)
                                  : rmFmt(playerDeposit(p), campCurrency)}
                              </td>
                              <td style={{ ...s.td, color:'var(--accent)' }}>{real ? rmFmt(real.validBet, campCurrency) : <span style={{ color:'var(--muted)' }}>—</span>}</td>
                              <td style={{ ...s.td, color:'#f85149' }}>{real ? rmFmt(real.withdrawal, campCurrency) : <span style={{ color:'var(--muted)' }}>—</span>}</td>
                              <td style={s.td}>
                                {multi
                                  ? (multiMetric?.allCompleted
                                      ? <span style={{ fontSize:11, color:'#3fb950', fontWeight:700 }}>All levels unlocked</span>
                                      : <span style={{ fontSize:11, color:gap>=0?'#3fb950':'#f85149', fontWeight:600 }}>{multiMetric?.nextLevel ? `${multiMetric.nextLevel.level_name} · ${gap>=0?'+':''}${rmFmt(gap,campCurrency)}` : '—'}</span>)
                                  : campType === 'dual_tier'
                                    ? <span style={{ fontSize:11, color:'var(--muted)' }}>N/A</span>
                                    : <span style={{ fontSize:12, color:qualified?'#3fb950':'#f85149', fontWeight:600 }}>{qualified ? `+${rmFmt(gap, campCurrency)}` : rmFmt(gap, campCurrency)}</span>}
                              </td>
                              <td style={{ ...s.td, color:typeInfo.color, fontWeight:qualified?700:400 }}>
                                {qualified ? (multi ? (<span>{rmFmt(reward,campCurrency)} total<br /><span style={{ fontSize:10, color:'var(--muted)' }}>{multiMetric?.completedCount||0}/{campaignLevels.length} levels</span></span>) : rmFmt(reward,campCurrency)) : '—'}
                              </td>
                              {selected?.streak_enabled && (() => {
                                const pStreaks = streakBonuses[p.id] || []
                                const pPaid = pStreaks.filter(sb => sb.payout_status === 'paid')
                                const pPending = pStreaks.filter(sb => sb.payout_status !== 'paid')
                                const pTotal = pStreaks.reduce((s,r) => s + (parseFloat(r.bonus_amount)||0), 0)
                                return (
                                  <td style={s.td}>
                                    {pStreaks.length === 0
                                      ? <span style={{ fontSize:10, color:'var(--muted)' }}>—</span>
                                      : <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                                          {pPaid.length > 0 && <span style={{ fontSize:10, background:'rgba(63,185,80,.15)', color:'#3fb950', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥×{pPaid.length} paid</span>}
                                          {pPending.length > 0 && <span style={{ fontSize:10, background:'rgba(245,158,11,.15)', color:'#f59e0b', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥×{pPending.length} pending</span>}
                                          <span style={{ fontSize:10, color:'var(--muted)' }}>{bonusFmt(pTotal, campCurrency)}</span>
                                        </div>
                                    }
                                  </td>
                                )
                              })()}
                              <td style={s.td}>
                                <span style={{ ...s.tag(rowStatusColor, rowStatusColor==='var(--muted)' ? 'rgba(139,148,158,.15)' : undefined), fontSize:10 }}>
                                  {rowStatusLabel}
                                </span>
                              </td>
                              <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>
                                {p.added_at ? new Date(p.added_at).toLocaleDateString('en-MY',{day:'numeric',month:'short'}) : '—'}
                              </td>
                              <td style={s.td} onClick={e=>e.stopPropagation()}>
                                <button onClick={()=>removePlayer(p.id)} style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>✕</button>
                              </td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
            )}
            {activeTab === 'summary' && (
              <div style={{ padding:24 }}>
                <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>💰 Campaign Summary — {fmtDate(selected.start_date)} → {fmtDate(selected.end_date)}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12, marginBottom:18 }}>
                  {[
                    ['Players',players.length,'#a78bfa'],['Qualified',achieved.length,'#3fb950'],
                    ['Reward Rows', isDailyMode && selected?.is_multi_level ? (summaryData?.qualifyingEntries ?? '…') : selected?.is_multi_level ? multiSummary.rewardRows : achieved.length, '#c9a961'],
                    ['Total Reward',rewardFmt(totalReward,campCurrency),typeInfo.color],['Paid',rewardFmt(paidOut,campCurrency),'#3fb950'],['Pending',rewardFmt(pendingPay,campCurrency),'#f85149'],
                  ].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:18,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}
                </div>

                {selected?.is_multi_level && <>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>🏆 Multi-Level Progress</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
                    {(()=>{
                      const sortedLvls = [...campaignLevels].sort((a,b)=>Number(b.deposit_threshold)-Number(a.deposit_threshold))
                      const highestLvlId = sortedLvls[0]?.id
                      const dailyPlayersWithReward = isDailyMode ? (summaryData?.uniqueParticipants || 0) : multiSummary.playersWithReward
                      const dailyFullyCompleted = isDailyMode ? (summaryData?.levelPlayerCounts?.[highestLvlId] || 0) : multiSummary.fullyCompleted
                      const dailyUnlockedLevels = isDailyMode ? Object.values(summaryData?.levelPlayerCounts || {}).reduce((s,v)=>s+v,0) : multiSummary.unlockedLevels
                      const dailySuccessRate = isDailyMode ? (players.length ? Math.round(dailyFullyCompleted/players.length*100) : 0) : multiSummary.successRate
                      return [
                        ['Players with reward',dailyPlayersWithReward,'#3fb950'],['Fully completed',dailyFullyCompleted,'#a78bfa'],['Levels unlocked',dailyUnlockedLevels,'#c9a961'],['Full completion rate',dailySuccessRate+'%','#3fb950'],
                      ]
                    })().map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:20,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}
                  </div>
                  <table style={{...s.tbl,marginBottom:24}}><thead><tr><th style={s.th}>Level</th><th style={s.th}>Target</th><th style={s.th}>Qualified Players</th><th style={s.th}>Reward Each</th><th style={s.th}>{isDailyMode?'Player-Days':'Reward Rows'}</th></tr></thead><tbody>
                    {campaignLevels.map(level=>{
                      const unlockedCount=isDailyMode
                        ? (summaryData?.levelPlayerCounts?.[level.id] || 0)
                        : campaignPlayerLevels.filter(pl=>pl.campaign_level_id===level.id&&['unlocked','claimed','issued','paid','approved'].includes(pl.status)).length
                      const rewardRows=isDailyMode
                        ? Object.values(summaryData?.tierHitCounts||{}).reduce((s,v)=>s+v,0) // placeholder — not meaningful for multi-level daily
                        : campaignRewards.filter(r=>r.campaign_level_id===level.id).length
                      return <tr key={level.id}><td style={{...s.td,fontWeight:700}}>{level.level_name}</td><td style={s.td}>{rmFmt(level.deposit_threshold,campCurrency)}</td><td style={{...s.td,color:'#3fb950',fontWeight:700}}>{unlockedCount}</td><td style={{...s.td,color:typeInfo.color,fontWeight:700}}>{rmFmt(level.reward_amount,campCurrency)} Credit</td><td style={s.td}>{isDailyMode?'—':rewardRows}</td></tr>
                    })}
                  </tbody></table>
                </>}

                {realFinancialsLoading ? <div style={{textAlign:'center',padding:24,color:'var(--muted)'}}>Loading real platform financials…</div> : !realFinancials ? <div style={{textAlign:'center',padding:24,color:'var(--muted)'}}>No real platform data available for the selected campaign period.</div> : (()=>{const rewardCost=totalReward;const netPnl=realFinancials.deposit-realFinancials.withdrawal-rewardCost;const roi=calculateCampaignROI(rewardCost,netPnl);const roiLabel=roi===null?'N/A':`${roi.toFixed(1)}%`;return <><div style={{fontSize:13,fontWeight:700,marginBottom:8}}>💼 Campaign P&amp;L — Real Platform Data</div><div style={{display:'grid',gridTemplateColumns:'repeat(6,minmax(0,1fr))',gap:12,marginBottom:10}}>{[['Real Deposit',rmFmt(realFinancials.deposit,campCurrency),'#3fb950'],['Real Withdrawal',rmFmt(realFinancials.withdrawal,campCurrency),'#f85149'],['Real Valid Bet',rmFmt(realFinancials.validBet,campCurrency),'var(--accent)'],['Reward Cost',rewardFmt(rewardCost,campCurrency),'#c9a961'],['Net P&L',rmFmt(netPnl,campCurrency),netPnl>=0?'#3fb950':'#f85149'],['ROI',roiLabel,roi===null?'var(--muted)':roi>=0?'#3fb950':'#f85149']].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:18,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}</div><div style={{fontSize:11,color:'var(--muted)',marginBottom:24}}>Net P&amp;L = Real Deposit − Real Withdrawal − Reward Cost. ROI = Net P&amp;L ÷ Reward Cost × 100%. ROI is N/A when there is no reward cost. Real figures come from platform snapshots for the campaign period; qualification uses the campaign-period deposit tracked above.</div></>})()}

                {isDailyMode && (summaryLoading ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>Loading daily entries…</div> : !summaryData ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>No daily entries yet.</div> : <div><div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📅 Daily Turnover Settlement</div><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>{[['Days with Entries',summaryData.totalEntryDays,'#a78bfa'],['Unique Participants',summaryData.uniqueParticipants,'#3fb950'],['Total Credit Given',rmFmt(summaryData.totalCredit,campCurrency),'#c9a961'],['Total WCash Given',rmFmt(summaryData.totalWcash,campCurrency),'#f59e0b']].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:20,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}</div></div>)}

                {selected?.streak_enabled && (() => {
                  const allSRows = Object.entries(streakBonuses).flatMap(([pid, rows]) => {
                    const pl = players.find(p => p.id === pid)
                    return rows.map(sb => ({ ...sb, username: pl?.username || pid }))
                  })
                  const paidSRows = allSRows.filter(r => r.payout_status === 'paid')
                  const pendingSRows = allSRows.filter(r => r.payout_status !== 'paid')
                  const totalStreakAmt = allSRows.reduce((s,r) => s + (parseFloat(r.bonus_amount)||0), 0)
                  const paidStreakAmt = paidSRows.reduce((s,r) => s + (parseFloat(r.bonus_amount)||0), 0)
                  const pendingStreakAmt = pendingSRows.reduce((s,r) => s + (parseFloat(r.bonus_amount)||0), 0)
                  const playersWithStreak = new Set(allSRows.map(r => r.username)).size
                  return (
                    <div style={{ marginTop:18 }}>
                      <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>🔥 Streak Bonus Summary</div>
                      {streakBonusesLoading
                        ? <div style={{ color:'var(--muted)', fontSize:12 }}>Loading streak bonuses…</div>
                        : allSRows.length === 0
                          ? <div style={{ background:'rgba(255,165,0,.06)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, padding:'14px 18px', fontSize:12, color:'#f59e0b' }}>
                              🔥 Streak bonus is <strong>enabled</strong> for this campaign ({selected.streak_days} days · {selected.streak_bonus_type === 'pct' ? `${selected.streak_bonus_pct}%` : rmFmt(selected.streak_bonus_fixed, campCurrency)} per streak). No bonuses awarded yet — keep logging daily entries to trigger streak milestones.
                            </div>
                          : <>
                              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:12 }}>
                                {[
                                  ['Streak Days Target', selected.streak_days, '#f59e0b'],
                                  ['Players with Streak', playersWithStreak, '#a78bfa'],
                                  ['Total Bonuses', allSRows.length, '#c9a961'],
                                  ['Paid Amount', bonusFmt(paidStreakAmt, campCurrency), '#3fb950'],
                                  ['Pending Amount', bonusFmt(pendingStreakAmt, campCurrency), '#f85149'],
                                ].map(([label,val,color]) => (
                                  <div key={label} style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, padding:14 }}>
                                    <div style={{ fontSize:18, fontWeight:700, color }}>{val}</div>
                                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{label}</div>
                                  </div>
                                ))}
                              </div>
                              <table style={{ ...s.tbl, marginBottom:8 }}>
                                <thead><tr>
                                  <th style={s.th}>Player</th>
                                  <th style={s.th}>Streak #</th>
                                  <th style={s.th}>Bonus Amount</th>
                                  <th style={s.th}>Status</th>
                                  <th style={s.th}>Awarded At</th>
                                </tr></thead>
                                <tbody>
                                  {allSRows.sort((a,b) => a.username.localeCompare(b.username) || a.streak_number - b.streak_number).map((sb,i) => (
                                    <tr key={i} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                      <td style={{ ...s.td, fontWeight:700 }}>{sb.username}</td>
                                      <td style={s.td}><span style={{ fontSize:12, fontWeight:700, color:'#f59e0b' }}>🔥 #{sb.streak_number}</span></td>
                                      <td style={{ ...s.td, color:'#c9a961', fontWeight:700 }}>{bonusFmt(sb.bonus_amount, campCurrency)}</td>
                                      <td style={s.td}>
                                        <span style={{ ...s.tag(sb.payout_status==='paid'?'#3fb950':'#f59e0b'), fontSize:10 }}>
                                          {sb.payout_status==='paid' ? '✓ Paid' : 'Pending'}
                                        </span>
                                      </td>
                                      <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>
                                        {sb.created_at ? new Date(sb.created_at).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div style={{ fontSize:11, color:'var(--muted)' }}>Total streak bonus cost: {bonusFmt(totalStreakAmt, campCurrency)} ({paidSRows.length} paid · {pendingSRows.length} pending)</div>
                            </>
                      }
                    </div>
                  )
                })()}
              </div>
            )}

            {activeTab === 'leaderboard' && campType === 'leaderboard' && (() => {
              const minBet  = parseFloat(selected.min_valid_bet)||0
              const topN    = parseInt(selected.top_n)||3
              const rankRwds = selected.rank_rewards||[]
              const totalCost = rankRwds.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)
              const totalDep2 = players.reduce((s,p)=>s+playerDeposit(p),0)
              const totalWith = players.reduce((s,p)=>s+(parseFloat(p.total_withdrawal)||0),0)
              const roi = totalCost > 0 ? ((totalDep2-totalWith-totalCost)/totalCost*100).toFixed(1) : 0
              return (
                <div>
                  <div style={{ padding:'12px 24px', borderBottom:'1px solid var(--border)', background:'rgba(167,139,250,.06)', display:'flex', gap:24, flexWrap:'wrap' }}>
                    {[['Players',players.length,'#a78bfa'],['Min Valid Bet',rmFmt(minBet, campCurrency),'#a78bfa'],['Min Deposit',rmFmt(parseFloat(selected.min_deposit_lb)||0, campCurrency),'#a78bfa'],['Top N','Top '+topN,'#ffd700'],['Total Cost',rewardFmt(totalCost, campCurrency),'#f85149'],['Total Deposit',rmFmt(totalDep2, campCurrency),'#3fb950'],['Withdrawal',rmFmt(totalWith, campCurrency),'#f59e0b'],['ROI',roi+'%',parseFloat(roi)>=0?'#3fb950':'#f85149']].map(([l,v,c])=>(
                      <div key={l}><div style={{ fontSize:15, fontWeight:800, color:c }}>{v}</div><div style={{ fontSize:10, color:'var(--muted)' }}>{l}</div></div>
                    ))}
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={s.tbl}>
                      <thead><tr>
                        <th style={s.th}>Rank</th><th style={s.th}>Player</th><th style={s.th}>Tier</th>
                        <th style={s.th}>Valid Bet</th><th style={s.th}>Deposit</th><th style={s.th}>Withdrawal</th>
                        <th style={s.th}>Net</th><th style={s.th}>Reward</th><th style={s.th}>Status</th>
                      </tr></thead>
                      <tbody>
                        {players.length===0 ? (
                          <tr><td colSpan={9} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:32 }}>No players yet</td></tr>
                        ) : [...players].sort((a,b)=>leaderboardRankingValue(b)-leaderboardRankingValue(a) || String(a.username||'').localeCompare(String(b.username||''))).map((p,i)=>{
                          const vb=parseFloat(p.valid_bet)||0
                          const dep=playerDeposit(p)
                          const wit=parseFloat(p.total_withdrawal)||0
                          const minDep = parseFloat(selected.min_deposit_lb)||0
              const qualified=leaderboardQualified(p)
                          const rank=i+1
                          const inTop=rank&&rank<=topN
                          const reward=inTop&&qualified?(rankRwds[rank-1]?.amount||0):0
                          return (
                            <tr key={p.id} style={{ background:inTop?'rgba(167,139,250,.06)':'transparent' }}>
                              <td style={{ ...s.td, fontWeight:800 }}>{qualified?(rank<=3?['#1','#2','#3'][rank-1]:'#'+rank):'--'}</td>
                              <td style={{ ...s.td, fontWeight:700 }}>{p.username}</td>
                              <td style={s.td}><span style={{ ...s.badge, background:TIER_BG[p.tier]||'', color:TIER_COLOR[p.tier]||'var(--muted)' }}>{p.tier}</span></td>
                              <td style={{ ...s.td, color:qualified?'#a78bfa':'var(--muted)', fontWeight:700 }}>
                                <input type="number" style={{ ...s.editInput, width:90 }} defaultValue={vb||''} onBlur={e=>updatePlayer(p.id,{valid_bet:parseFloat(e.target.value)||0})} placeholder="valid bet" />
                                {!qualified&&vb>0&&<div style={{ fontSize:10, color:'#f85149' }}>short {rmFmt(minBet-vb, campCurrency)}</div>}
                              </td>
                              <td style={s.td}><input type="number" style={{ ...s.editInput, width:80 }} defaultValue={dep||''} onBlur={e=>updatePlayer(p.id,{total_deposit:parseFloat(e.target.value)||0})} placeholder="0" /></td>
                              <td style={s.td}><input type="number" style={{ ...s.editInput, width:80 }} defaultValue={wit||''} onBlur={e=>updatePlayer(p.id,{total_withdrawal:parseFloat(e.target.value)||0})} placeholder="0" /></td>
                              <td style={{ ...s.td, fontWeight:700, color:(dep-wit)>=0?'#3fb950':'#f85149' }}>{dep||wit?rmFmt(dep-wit, campCurrency):'--'}</td>
                              <td style={{ ...s.td, fontWeight:700, color:'#a78bfa' }}>{inTop?rewardFmt(reward, campCurrency):'--'}</td>
                              <td style={s.td}>
                                <select value={p.payout_status||'pending'} onChange={e=>updatePlayer(p.id,{payout_status:e.target.value})}
                                  style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'3px 8px', borderRadius:5, fontSize:11 }}>
                                  <option value="pending">Pending</option><option value="paid">Paid</option><option value="na">N/A</option>
                                </select>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding:'10px 24px', fontSize:11, color:'var(--muted)', borderTop:'1px solid var(--border)' }}>
                    ROI = (Total Deposit - Total Withdrawal - Reward Cost) / Reward Cost x 100%
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
      {waPopup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={()=>setWaPopup(null)}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:24, width:520, maxWidth:'94vw' }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div style={{ fontSize:14, fontWeight:700 }}>💬 WhatsApp Message</div>
              {(waPopup.enBody || waPopup.zhBody) && (
                <div style={{ display:'flex', gap:4 }}>
                  {waPopup.enBody && (
                    <button onClick={()=>setWaPopup(p=>({...p,message:p.enBody}))}
                      style={{ padding:'3px 10px', borderRadius:6, fontSize:12, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                        background: waPopup.message===waPopup.enBody ? 'var(--accent)' : 'var(--surface2)',
                        color: waPopup.message===waPopup.enBody ? '#fff' : 'var(--muted)' }}>🇬🇧 EN</button>
                  )}
                  {waPopup.zhBody && (
                    <button onClick={()=>setWaPopup(p=>({...p,message:p.zhBody}))}
                      style={{ padding:'3px 10px', borderRadius:6, fontSize:12, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                        background: waPopup.message===waPopup.zhBody ? 'var(--accent)' : 'var(--surface2)',
                        color: waPopup.message===waPopup.zhBody ? '#fff' : 'var(--muted)' }}>🇨🇳 中文</button>
                  )}
                </div>
              )}
            </div>
            <textarea rows={10} style={{ ...s.fta, width:'100%', marginBottom:14, fontFamily:"'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Twemoji Mozilla',sans-serif" }} value={waPopup.message} onChange={e=>setWaPopup(p=>({...p,message:e.target.value}))} />
            <div style={{ display:'flex', gap:8 }}>
              <a href={`https://wa.me/${waPopup.rawNumber}?text=${encodeURIComponent(waPopup.message)}`} target="_blank" rel="noopener noreferrer" onClick={()=>setWaPopup(null)}
                style={{ ...s.btnG, textDecoration:'none', padding:'8px 18px' }}>Open WhatsApp</a>
              <button style={{ ...s.btnSm, background: waCopied ? '#3fb950' : undefined, color: waCopied ? '#fff' : undefined }}
                onClick={()=>{ navigator.clipboard.writeText(waPopup.message); setWaCopied(true); setTimeout(()=>setWaCopied(false), 2000) }}>
                {waCopied ? '✅ Copied!' : '📋 Copy'}
              </button>
              <button style={s.btnSm} onClick={()=>{ setWaPopup(null); setWaCopied(false) }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
