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
import * as XLSX from 'xlsx'
import ChallengeDetail from '../components/campaign/ChallengeDetail'
import { CampaignInfoButton } from '../components/campaign/CampaignGuide'

// ── Constants ─────────────────────────────────────────────────────────────────
const TIERS = ['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
const TIER_COLOR = { DIAMOND:'#b9f2ff', PLATINUM:'#C0C0C0', GOLD:'#ffd700', SILVER:'#a8a8a8', BRONZE:'#cd7f32' }
const TIER_BG    = { DIAMOND:'rgba(185,242,255,.12)', PLATINUM:'rgba(192,192,192,.12)', GOLD:'rgba(255,215,0,.12)', SILVER:'rgba(168,168,168,.1)', BRONZE:'rgba(205,127,50,.1)' }

// Contact log types — used across Chase List, Payout, and Inactive tabs
const CONTACT_TYPES = [
  ['daily',       '📅', 'Daily Chase', '每日跟进'],
  ['wa_sent',     '📱', 'WA Sent', '已发WA'],
  ['responded',   '✅', 'Responded', '已回复'],
  ['no_response', '🔕', 'No Reply', '未回复'],
  ['promised',    '🤝', 'Promised', '已承诺'],
  ['deposited',   '💰', 'Deposited', '已存款'],
  ['reward',      '🎁', 'Reward', '奖励'],
  ['inactive',    '💤', 'Inactive', '不活跃'],
  ['other',       '💬', 'Other', '其他'],
]
const CT_ICON  = Object.fromEntries(CONTACT_TYPES.map(([k,icon])=>[k,icon]))
const CT_LABEL = Object.fromEntries(CONTACT_TYPES.map(([k,,lbl])=>[k,lbl]))
const CT_LABEL_ZH = Object.fromEntries(CONTACT_TYPES.map(([k,,,zh])=>[k,zh]))

const CAMPAIGN_TYPES = {
  gold_bar:     { label:'🥇 Gold Bar',       color:'#ffd700', desc:'Deposit threshold → receive physical gold bar or gift', zh:'🥇 金条', descZh:'存款达标 → 获得实体金条或礼品' },
  pct_reward:   { label:'💰 % Reward',        color:'#3fb950', desc:'Deposit amount × % = cashback (credit/cash)', zh:'💰 百分比奖励', descZh:'存款金额 × % = 返现（信用额/现金）' },
  fixed_reward:  { label:'🎁 Fixed Reward',    color:'#b9f2ff', desc:'Deposit reaches threshold → fixed reward amount', zh:'🎁 固定奖励', descZh:'存款达标 → 固定奖励金额' },
  tiered_reward: { label:'📊 Tiered % Reward',  color:'#f0883e', desc:'Different % reward at each deposit tier — more deposit = higher %', zh:'📊 分级百分比奖励', descZh:'每个存款等级不同奖励 % — 存越多 % 越高' },
  dual_tier:     { label:'🎯 Deposit + Turnover Tiers', color:'#c9a961', desc:'Must reach BOTH deposit AND turnover at a tier → get that tier\'s Credit + WCash', zh:'🎯 存款 + 流水等级', descZh:'须同时达到某等级的存款和流水 → 获得该等级的 Credit + WCash' },
  leaderboard:   { label:'[TOP] Leaderboard',    color:'#a78bfa', desc:'Top N players by monthly valid bet - each rank gets different cash voucher', zh:'[TOP] 排行榜', descZh:'按月有效投注排名前 N 位玩家 - 每个名次获得不同现金券' },
  challenge:     { label:'💝 Challenge', color:'#f472b6', desc:'Trust Credit / Rebate Challenge — personal target + streak, tracked from daily data', zh:'💝 挑战', descZh:'信任金 / 返水挑战 — 个人目标 + 连续奖励，按每日数据追踪' },
}

function getCampaignTypeInfo(campaignOrForm) {
  const type = campaignOrForm?.campaign_type || 'gold_bar'
  const multi = Boolean(campaignOrForm?.is_multi_level)
  if (type === 'fixed_reward' && multi) {
    return { label:'🎁 Tiered Deposit Reward', color:'#b9f2ff', desc:'Different fixed Credit reward at each deposit level', zh:'🎁 分级存款奖励', descZh:'每个存款级别不同的固定 Credit 奖励' }
  }
  if (type === 'challenge') {
    return campaignOrForm?.challenge_config?.mode === 'rebate'
      ? { label:'💰 Rebate Challenge', color:'#22d3ee', desc:'Target → rebate % of turnover + streak', zh:'💰 返水挑战', descZh:'达标 → 按流水返水 % + 连续奖励' }
      : { label:'💝 Trust Credit Challenge', color:'#f472b6', desc:'Credit first → personal turnover task → reviewed bonus + streak', zh:'💝 信任金挑战', descZh:'先给信用额 → 个人流水任务 → 审核奖金 + 连续奖励' }
  }
  return CAMPAIGN_TYPES[type] || CAMPAIGN_TYPES.gold_bar
}

const REWARD_DELIVERY = {
  credit:   { label:'💳 Credit',      color:'#3fb950', zh:'💳 Credit' },
  cash:     { label:'💵 Cash',        color:'#f59e0b', zh:'💵 现金' },
  gold_bar: { label:'🥇 Gold Bar',    color:'#ffd700', zh:'🥇 金条' },
  gift:     { label:'🎁 Physical Gift',color:'#b9f2ff', zh:'🎁 实体礼品' },
  voucher:  { label:'🎫 Voucher',     color:'#8b5cf6', zh:'🎫 现金券' },
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
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const tLabel = (x) => (lang === 'zh' ? (x?.zh || x?.label) : x?.label)
  const tDesc  = (x) => (lang === 'zh' ? (x?.descZh || x?.desc) : x?.desc)
  const PR_ZH = { '✅ ACHIEVED':'✅ 已达标', '⚡ CLOSE':'⚡ 接近', '🔴 BEHIND':'🔴 落后' }
  const prLabel = (l) => (lang === 'zh' ? (PR_ZH[l] || l) : l)
  const ctLabel = (k) => (lang === 'zh' ? CT_LABEL_ZH[k] : CT_LABEL[k]) || k
  const STATUS_LABEL = { draft:L2('Draft','草稿'), upcoming:L2('Upcoming','即将开始'), active:L2('Active','进行中'), paused:L2('Paused','暂停'), ended:L2('Ended','已结束') }
  const [challengeCamp, setChallengeCamp] = useState(null) // Challenge campaigns open their own detail page
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
  const [inactiveSort, setInactiveSort] = useState('days')
  const [inactiveSortDir, setInactiveSortDir] = useState('desc')
  const [allPlayerSort, setAllPlayerSort] = useState('deposit')
  const [allPlayerSortDir, setAllPlayerSortDir] = useState('desc')
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
  const [contactNote, setContactNote] = useState('')       // note being entered in log popup
  const [contactHistory, setContactHistory] = useState(null) // player_id of open history view
  const [waPopup, setWaPopup] = useState(null)  // { rawNumber, message } — editable before opening WA
  const [waCopied, setWaCopied] = useState(false)
  // All daily entries for streak/inactive tabs — loaded on demand
  const [allDailyEntries, setAllDailyEntries] = useState([])  // full flat list for campaign
  const [allDailyEntriesLoading, setAllDailyEntriesLoading] = useState(false)

  // VIP search
  const [vipSearch,   setVipSearch]   = useState('')
  const [vipResults,  setVipResults]  = useState([])

  // Bulk enrollment
  const [bulkEnrollOpen,     setBulkEnrollOpen]     = useState(false)
  const [bulkEnrollList,     setBulkEnrollList]     = useState([])
  const [bulkEnrollLoading,  setBulkEnrollLoading]  = useState(false)
  const [bulkEnrollSelected, setBulkEnrollSelected] = useState(new Set())
  const [bulkEnrollSearch,   setBulkEnrollSearch]   = useState('')
  const [bulkEnrollTier,     setBulkEnrollTier]     = useState('all')

  // Bulk removal (chase + all-players tabs)
  const [selectedForRemoval, setSelectedForRemoval] = useState(new Set())

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
    if (!form.campaign_name.trim()) { setMsg({ text:L2('Campaign name required.','请填写活动名称。'), ok:false }); return }
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
    if (error) { setMsg({ text:L2('Error: ','错误：')+error.message, ok:false }); return }
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
    if (error) { alert(L2('Add failed: ','添加失败：') + error.message); console.error(error) }
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
    if (error) { alert(L2('Update failed: ','更新失败：') + error.message); console.error(error); return }

    // Manual CRM deposit entry is a campaign-period value for reward campaigns.
    // Keep Supabase campaign_period_deposit + player-level unlock state + reward
    // rows in sync immediately; do not wait for the hourly snapshot refresh.
    if (Object.prototype.hasOwnProperty.call(updates, 'total_deposit')) {
      const { error: syncError } = await supabase.rpc('sync_manual_campaign_player_progress', {
        p_campaign_player_id: pid,
        p_campaign_period_deposit: Number(updates.total_deposit) || 0,
      })
      if (syncError) {
        alert(L2('Deposit saved, but campaign progress sync failed: ','存款已保存，但活动进度同步失败：') + syncError.message)
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
        alert(L2('CRM payout saved, but Player Portal reward sync failed: ','CRM 派彩已保存，但玩家门户奖励同步失败：') + rewardSyncError.message)
        console.error('campaign_rewards payout sync failed:', rewardSyncError)
      }
    }

    await loadPlayers(selected.id)
  }

  async function toggleCampaignReward(rewardId, makePaid, playerId, newPlayerTotal) {
    if (!rewardId) return
    const patch = makePaid ? { status:'paid', paid_at:new Date().toISOString() } : { status:'pending', paid_at:null }
    const { error } = await supabase.from('campaign_rewards').update(patch).eq('id', rewardId)
    if (error) { alert(L2('Reward update failed: ','奖励更新失败：') + error.message); console.error(error); return }
    // Sync total paid reward amount back to campaign_players so PPT and DB stay in sync
    if (playerId != null && newPlayerTotal != null) {
      const { error: cpErr } = await supabase.from('campaign_players').update({ reward_amount: newPlayerTotal }).eq('id', playerId)
      if (cpErr) console.error('campaign_players reward_amount sync failed:', cpErr)
    }
    await loadPlayers(selected.id)
  }

  // ── Remove player ───────────────────────────────────────────────────────────
  async function removePlayer(pid) {
    if (!window.confirm(L2('Remove this player from the campaign?','确定将此玩家移出活动？'))) return
    await supabase.from('campaign_players').delete().eq('id', pid)
    await loadPlayers(selected.id)
  }

  // ── Bulk enrollment ──────────────────────────────────────────────────────────
  async function openBulkEnroll() {
    setBulkEnrollOpen(true); setBulkEnrollSelected(new Set()); setBulkEnrollSearch(''); setBulkEnrollTier('all')
    setBulkEnrollLoading(true)
    const { data } = await supabase.from('vip_members').select('id,username,full_name,tier,phone,whatsapp').eq('is_excluded',false).order('tier').order('username').limit(500)
    const enrolled = new Set(players.map(p => p.username))
    setBulkEnrollList((data||[]).filter(v => !enrolled.has(v.username)))
    setBulkEnrollLoading(false)
  }

  async function doBulkEnroll() {
    if (!selected || bulkEnrollSelected.size === 0) return
    const toAdd = bulkEnrollList.filter(v => bulkEnrollSelected.has(v.id))
    const rows = toAdd.map(v => ({
      campaign_id: selected.id, vip_id: v.id, username: v.username, tier: v.tier,
      whatsapp: v.whatsapp || v.phone || null, total_deposit: 0, campaign_period_deposit: 0,
      converted: false, payout_status: 'pending', added_at: new Date().toISOString(),
    }))
    setBulkEnrollLoading(true)
    const { data: inserted, error } = await supabase.from('campaign_players').insert(rows).select('id')
    if (error) { alert(L2('Bulk add failed: ','批量添加失败：') + error.message); setBulkEnrollLoading(false); return }
    if (selected?.is_multi_level && inserted?.length) {
      await Promise.all(inserted.map(r => supabase.rpc('sync_manual_campaign_player_progress', { p_campaign_player_id: r.id, p_campaign_period_deposit: 0 })))
    }
    await loadPlayers(selected.id)
    setBulkEnrollLoading(false); setBulkEnrollOpen(false)
  }

  // ── Bulk remove ──────────────────────────────────────────────────────────────
  async function bulkRemovePlayers() {
    if (selectedForRemoval.size === 0) return
    if (!window.confirm(L2(`Remove ${selectedForRemoval.size} player${selectedForRemoval.size > 1 ? 's' : ''} from the campaign?`, `确定将 ${selectedForRemoval.size} 位玩家移出活动？`))) return
    await supabase.from('campaign_players').delete().in('id', [...selectedForRemoval])
    await loadPlayers(selected.id)
    setSelectedForRemoval(new Set())
  }

  // ── Export Inactive players to Excel ────────────────────────────────────────
  function exportInactiveToExcel(inactivePlayers) {
    const campName = selected?.campaign_name || 'Campaign'
    const rows = inactivePlayers.map((p, i) => {
      const playerEntries = allDailyEntries.filter(e => e.player_id === p.id)
      const playerContacts = contacts[p.id] || []
      const lastContact = playerContacts[0]
      const lastContactStr = lastContact
        ? new Date(lastContact.contacted_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' })
        : 'Never'
      const enrolledStr = p.added_at
        ? new Date(p.added_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' })
        : '—'
      const entriesStr = playerEntries.length > 0 ? `${playerEntries.length} entries (0 qualifying)` : 'No entries at all'
      return {
        '#': i + 1,
        'Username': p.username,
        'Tier': p.tier || '—',
        'Host': p.host_assigned || '—',
        'WhatsApp': p.whatsapp || '—',
        'Last Contact': lastContactStr,
        'Enrolled': enrolledStr,
        'Days in Campaign': entriesStr,
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    // Column widths
    ws['!cols'] = [{ wch:4 },{ wch:18 },{ wch:10 },{ wch:12 },{ wch:16 },{ wch:14 },{ wch:12 },{ wch:24 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inactive Players')
    const filename = `${campName.replace(/[^a-z0-9]/gi,'_')}_Inactive_${new Date().toISOString().slice(0,10)}.xlsx`
    XLSX.writeFile(wb, filename)
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
      alert(L2('Could not load campaign: ','无法加载活动：') + campaignRes.error.message)
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
            throw new Error(L2('One or more levels are already used by player progress/rewards. They cannot be deleted or disabled.','一个或多个级别已被玩家进度/奖励使用，无法删除或停用。'))
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
      setMsg({ text:L2('Campaign saved successfully.','活动已成功保存。'), ok:true })
    } catch (error) {
      alert(L2('Save failed: ','保存失败：') + error.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteCampaign() {
    if (!window.confirm(L2(`Delete "${selected.campaign_name}"? This will also remove all player records.`, `确定删除“${selected.campaign_name}”？这也会删除所有玩家记录。`))) return
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
    if (error) { alert(L2('Delete failed: ','删除失败：') + error.message); return }
    closeModal()
    await loadCampaigns()
  }

  function closeModal() { setModal(null); setSelected(null); setPlayers([]); setCampaignPlayerLevels([]); setCampaignRewards([]); setVipSearch(''); setVipResults([]); setEditingCamp(false); setAiAnalysis(null); setDailyEntries({}); setEntryDate(''); setStreakBonuses({}); setStreakBonusesLoading(false); setContacts({}); setContactLog(null); setContactNote(''); setContactHistory(null); setInactiveHostFilter('all'); setBulkEnrollOpen(false); setBulkEnrollList([]); setBulkEnrollSelected(new Set()); setSelectedForRemoval(new Set()) }

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

    // Sync campaign_players: check if ALL daily entries for this player are now paid
    const { data: allEntries } = await supabase
      .from('daily_turnover_entries')
      .select('payout_status, credit_reward, wcash_reward')
      .eq('campaign_id', selected.id)
      .eq('player_id', playerId)
    if (allEntries) {
      // Only consider entries that actually have a reward (non-qualifiers have 0 reward and should not block paid status)
      const qualifyingEntries = allEntries.filter(e => (parseFloat(e.credit_reward) || 0) + (parseFloat(e.wcash_reward) || 0) > 0)
      const allPaid = qualifyingEntries.length > 0 && qualifyingEntries.every(e => e.payout_status === 'paid')
      const totalReward = allPaid
        ? qualifyingEntries.reduce((s, e) => s + (parseFloat(e.credit_reward) || 0) + (parseFloat(e.wcash_reward) || 0), 0)
        : 0
      const { error: cpErr } = await supabase
        .from('campaign_players')
        .update({ payout_status: allPaid ? 'paid' : 'pending', reward_amount: totalReward })
        .eq('id', playerId)
      if (cpErr) {
        console.error('campaign_players daily sync error:', cpErr)
      } else {
        // Patch players immediately so the header (paidCredit/paidWcash) updates right away
        const patchedPlayers = players.map(p =>
          p.id === playerId ? { ...p, payout_status: allPaid ? 'paid' : 'pending' } : p
        )
        await loadCampaignSummary(selected.id, patchedPlayers)
        loadPlayers(selected.id) // background refresh for full DB sync
      }
    }
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
    if (error) { alert(L2('Save failed: ','保存失败：') + error.message); console.error(error); return }
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

  async function logContact(playerId, type) {
    const now = new Date().toISOString()
    const { error } = await supabase.from('campaign_player_contacts').insert({
      campaign_id: selected.id,
      campaign_player_id: playerId,
      contacted_at: now,
      contact_type: type,
      host: profile?.email || null,
      notes: contactNote.trim() || null,
    })
    if (error) { console.error('logContact error', error); return }
    // Auto-sync to global contact_logs + VIP data
    const player = players.find(p => p.id === playerId)
    if (player?.username) {
      const myName = profile?.full_name || profile?.username || (profile?.email ? profile.email.split('@')[0] : 'Host')
      const channelMap = { wa_sent:'WhatsApp', daily:'WhatsApp', responded:'WhatsApp', no_response:'WhatsApp', promised:'WhatsApp', deposited:'WhatsApp', reward:'WhatsApp', inactive:'WhatsApp', other:'Other' }
      const noteText = contactNote.trim() || `Campaign chase: ${selected?.campaign_name || ''}`
      const { data: vipRow } = await supabase.from('vip_members').select('id').eq('username', player.username).maybeSingle()
      await Promise.all([
        supabase.from('contact_logs').insert({
          vip_id: vipRow?.id || null,
          username: player.username,
          tier: player.tier || null,
          host_name: myName,
          host_id: profile?.id || null,
          channel: channelMap[type] || 'WhatsApp',
          outcome: 'Contacted',
          notes: noteText,
          message_summary: noteText,
          direction: 'outbound',
          logged_at: now,
          log_month: now.slice(0, 7),
          log_week: String(Math.ceil(new Date().getDate() / 7)),
        }),
        supabase.from('vip_members').update({ last_contacted: now, last_contact_date: now.slice(0, 10) }).eq('username', player.username),
      ])
    }
    setContactLog(null)
    setContactNote('')
    setContactHistory(null)
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
    if (error) { alert(L2('Load failed: ','加载失败：') + error.message); setDailyLoading(false); return }
    const rows = data || []
    if (!rows.length) { alert(L2('No entries to recalculate.','没有可重新计算的记录。')); setDailyLoading(false); return }
    // Use individual .update() calls — never .upsert() here, which would try to INSERT
    // a new row when the id doesn't match, triggering the campaign_id not-null constraint.
    const now = new Date().toISOString()
    for (const row of rows) {
      const { levelOrder, creditReward } = calcLevelTierForDeposit(row.deposit_amount, campaignLevels)
      const { error: upErr } = await supabase.from('daily_turnover_entries')
        .update({ tier_achieved: levelOrder, credit_reward: creditReward, wcash_reward: 0, updated_at: now })
        .eq('id', row.id)
      if (upErr) { alert(L2('Recalc failed: ','重新计算失败：') + upErr.message); setDailyLoading(false); return }
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
    alert(L2(`✅ Recalculated rewards for ${rows.length} entries.`, `✅ 已重新计算 ${rows.length} 条记录的奖励。`))
    setDailyLoading(false)
  }

  async function checkAndAwardStreak(playerId, afterEntryDate) {
    if (!selected?.streak_enabled || !isDailyMode) return

    // Fetch all entries for this player sorted by date
    const { data: allEntries, error: entriesErr } = await supabase
      .from('daily_turnover_entries')
      .select('entry_date, deposit_amount, credit_reward')
      .eq('campaign_id', selected.id)
      .eq('player_id', playerId)
      .order('entry_date', { ascending: true })
    if (entriesErr || !allEntries?.length) return

    // A day qualifies for streak if the player earned a reward that day (credit_reward > 0).
    // This correctly handles all campaign types — turnover-only, deposit+turnover, etc. —
    // since credit_reward is only > 0 when the player met the tier criteria.
    const qualifyingDates = allEntries
      .filter(e => (parseFloat(e.credit_reward) || 0) > 0)
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
    if (!startDate || !endDate) { alert(L2('Campaign dates are not set.','活动日期未设置。')); return }

    const confirmed = window.confirm(
      isDailyMode
        ? L2(`Import real deposit + turnover from VIP snapshot for ${entryDate}?\nThis will overwrite all values entered for that date.`, `从 VIP 快照导入 ${entryDate} 的真实存款 + 流水？\n这将覆盖该日期已输入的所有数值。`)
        : L2(`Import real deposit + turnover from VIP snapshots (${fmtDate(startDate)} → ${fmtDate(endDate)})?\nThis will overwrite existing values for players found in the snapshot data.`, `从 VIP 快照导入真实存款 + 流水（${fmtDate(startDate)} → ${fmtDate(endDate)}）？\n这将覆盖快照数据中找到的玩家的现有数值。`)
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
      if (error) { alert(L2('Failed to load snapshot data: ','加载快照数据失败：') + error.message); setDailyLoading(false); return }
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
      alert(L2('No matching players found in the snapshot data for this date range.','此日期范围的快照数据中没有找到匹配的玩家。'))
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
        if (error) { alert(L2('Batch upsert failed: ','批量写入失败：') + error.message); setDailyLoading(false); return }
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
    setMsg({ text: L2(`✅ Imported data for ${matched.length} / ${players.length} players from VIP snapshots.`, `✅ 已从 VIP 快照导入 ${matched.length} / ${players.length} 位玩家的数据。`), ok: true })
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
      alert(L2('Could not generate analysis: ','无法生成分析：') + e.message)
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

  async function loadCampaignSummary(campaignId, playersOverride = null) {
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
    ;(playersOverride || players).forEach(p => { playerMap[p.id] = p })

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
      if (chaseSort === 'turnover') {
        const tA = isDailyMode ? (parseFloat(dailyEntries[a.id]?.turnover_amount) || 0) : (parseFloat(a.valid_bet) || 0)
        const tB = isDailyMode ? (parseFloat(dailyEntries[b.id]?.turnover_amount) || 0) : (parseFloat(b.valid_bet) || 0)
        return sm * (tA - tB)
      }
      if (chaseSort === 'progress') {
        const pA = depTarget > 0 ? playerDeposit(a) / depTarget : 0
        const pB = depTarget > 0 ? playerDeposit(b) / depTarget : 0
        return sm * (pA - pB)
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
            <option value="ALL">{L2('All Types','全部类型')}</option>
            {Object.entries(CAMPAIGN_TYPES).map(([k,v])=><option key={k} value={k}>{tLabel(v)}</option>)}
          </select>
          <select style={{ ...s.smInput, padding:'7px 12px' }} value={filterStat} onChange={e=>setFilterStat(e.target.value)}>
            <option value="ALL">{L2('All Status','全部状态')}</option>
            {['draft','active','paused','ended'].map(s=><option key={s} value={s}>{STATUS_LABEL[s]||s}</option>)}
          </select>
          <select style={{ ...s.smInput, padding:'7px 12px' }} value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}>
            <option value="ALL">{L2('All Months','全部月份')}</option>
            {monthOptions.map(mo=><option key={mo} value={mo}>{mo}</option>)}
          </select>
        </div>
      </div>

      {/* Campaign cards */}
      {loading ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>{L2('Loading...','加载中...')}</div>
      ) : campaigns.length === 0 ? (
        <div style={{ ...s.card, padding:40, textAlign:'center', color:'var(--muted)' }}>
          {L2('No campaigns yet.','暂无活动。')} <span style={{ color:'var(--accent)', cursor:'pointer' }} onClick={()=>{ setForm(blankForm); setModal('create') }}>{L2('Create one →','立即创建 →')}</span>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:12 }}>
          {campaigns.map(camp => {
            const ct = camp.campaign_type || 'gold_bar'
            const ti = getCampaignTypeInfo(camp)
            return (
              <div key={camp.id} style={{ ...s.card, cursor:'pointer', transition:'border-color .15s' }}
                onClick={async () => {
                  if (ct === 'challenge') { setChallengeCamp(camp); return }
                  setSelected(camp); setActiveTab('chase'); setModal('detail'); setChaseFilter(''); setHostFilter('all')
                  const today = new Date().toISOString().slice(0,10)
                  const inRange = camp.start_date && camp.end_date && today >= camp.start_date && today <= camp.end_date
                  setEntryDate(inRange ? today : (camp.start_date || today))
                }}
                onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
                onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
                <div style={{ padding:'14px 16px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                    <span style={{ ...s.tag(ti.color), fontSize:11 }}>{tLabel(ti)}</span>
                    <CampaignInfoButton campaign={camp} />
                    <span style={{ ...s.tag(STATUS_COLOR[camp.status], STATUS_BG[camp.status]), fontSize:11 }}>{STATUS_LABEL[camp.status]||camp.status}</span>
                    {camp.platform && <span style={{ ...s.tag('#8b949e'), fontSize:11 }}>{camp.platform}</span>}
                  </div>
                  <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{camp.campaign_name}</div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>
                    {camp.campaign_code} · {fmtDate(camp.start_date)} → {fmtDate(camp.end_date)}
                  </div>
                  <div style={{ display:'flex', gap:16, fontSize:12 }}>
                    {ct==='challenge'
                      ? <span style={{ color:'var(--muted)' }}>{lang==='zh'?'目标':'Goal'}: <strong style={{ color:'var(--text)' }}>{camp.challenge_config?.goal_metric==='deposit'?(lang==='zh'?'存款':'Deposit'):camp.challenge_config?.goal_metric==='both'?(lang==='zh'?'存款 + 流水':'Deposit + Turnover'):(lang==='zh'?'个人流水':'Personal turnover')}</strong>{camp.challenge_config?.streak_enabled && <span style={{ color:'#22d3ee', marginLeft:12 }}>{lang==='zh'?'连续':'Streak'}: <strong>{camp.challenge_config.streak_min_days}{L2('d','天')} ≥ RM {Number(camp.challenge_config.streak_min_daily_deposit||0).toLocaleString()}</strong></span>}</span>
                      : ct==='leaderboard'
                      ? <span style={{ color:'var(--muted)' }}>{L2('Min Turnover','最低流水')}: <strong style={{ color:'var(--text)' }}>{rmFmt(camp.min_valid_bet, campaignCurrency(camp.platform))}</strong></span>
                      : <span style={{ color:'var(--muted)' }}>{L2('Min','最低')}: <strong style={{ color:'var(--text)' }}>{rmFmt(camp.deposit_target, campaignCurrency(camp.platform))}</strong></span>}
                    {ct==='pct_reward'   && <span style={{ color:'#3fb950' }}>{L2('Reward','奖励')}: <strong>{camp.reward_pct||6}%{camp.reward_cap?` (${L2('max','上限')} ${rmFmt(camp.reward_cap, campaignCurrency(camp.platform))})`:''}</strong></span>}
                    {ct==='fixed_reward' && camp.is_multi_level && <span style={{ color:'#b9f2ff' }}>{L2('Levels','级别')}: <strong>{camp.max_levels || 0}</strong> · Credit</span>}
                     {ct==='fixed_reward' && !camp.is_multi_level && <span style={{ color:'#b9f2ff' }}>{L2('Reward','奖励')}: <strong>{rmFmt(camp.reward_fixed, campaignCurrency(camp.platform))}</strong></span>}
                    {ct==='tiered_reward' && <span style={{ color:'#f0883e' }}>{L2('Tiers','等级')}: <strong>{camp.reward_tiers?.length||0} {L2('levels','级')}</strong></span>}
                    {ct==='gold_bar'     && <span style={{ color:'#ffd700' }}>{L2('Gold Bar','金条')}: <strong>{rmFmt(camp.gold_bar_value, campaignCurrency(camp.platform))}</strong></span>}
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
                      <div style={{ fontSize:14, fontWeight:700, color:form.campaign_type===k?v.color:'var(--text)' }}>{tLabel(v)}</div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{tDesc(v)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={s.g2}>
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.campaignName')} *</div><input style={s.finput} value={form.campaign_name} onChange={e=>setForm({...form,campaign_name:e.target.value})} placeholder={L2('e.g. June Deposit Reward','例如：六月存款奖励')} /></div>
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.campaignCode')}</div><input style={s.finput} value={form.campaign_code} onChange={e=>setForm({...form,campaign_code:e.target.value.toUpperCase()})} placeholder={L2('e.g. DEP-REWARD-JUN26','例如：DEP-REWARD-JUN26')} /></div>
                <div style={s.frow}><div style={s.flbl}>{t('campaigns.platform')}</div>
                  <select style={s.fsel} value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>
                    {PLATFORMS.map(p=><option key={p}>{p}</option>)}
                  </select>
                </div>
                <div style={s.frow}><div style={s.flbl}>{t('common.status')}</div>
                  <select style={s.fsel} value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>
                    {['draft','upcoming','active','paused','ended'].map(s=><option key={s} value={s}>{STATUS_LABEL[s]||s}</option>)}
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
                    <div style={s.flbl}>{L2('Reward % (e.g. 6 = 6%)','奖励 %（例如 6 = 6%）')}</div>
                    <input type="number" style={s.finput} value={form.reward_pct} onChange={e=>setForm({...form,reward_pct:e.target.value})} placeholder="6" />
                    <div style={{ fontSize:11, color:'#3fb950', marginTop:4 }}>
                      {L2('e.g.','例如')} RM 50,000 × {form.reward_pct||6}% = {rmFmt((parseFloat(form.deposit_target)||50000)*(parseFloat(form.reward_pct)||6)/100)} {L2('reward','奖励')}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:8 }}>
                      <label style={{ fontSize:12, color:'var(--muted)', display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                        <input type="checkbox" checked={form.has_cap} onChange={e=>setForm({...form,has_cap:e.target.checked,reward_cap:''})} />
                        {L2('Max reward cap?','设置奖励上限？')}
                      </label>
                      {form.has_cap && (
                        <div style={{ flex:1 }}>
                          <input type="number" style={{ ...s.finput }} value={form.reward_cap} onChange={e=>setForm({...form,reward_cap:e.target.value})} placeholder={L2('e.g. 5000 (max payout)','例如：5000（最高派彩）')} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {form.campaign_type === 'fixed_reward' && (
                  <div style={s.frow}>
                    <div style={s.flbl}>{L2('Fixed Reward Amount (RM)','固定奖励金额 (RM)')}</div>
                    <input type="number" style={s.finput} value={form.reward_fixed} onChange={e=>setForm({...form,reward_fixed:e.target.value})} placeholder="3000" />
                  </div>
                )}
                {form.campaign_type === 'gold_bar' && (
                  <div style={s.frow}>
                    <div style={s.flbl}>{L2('Gold Bar Value (RM)','金条价值 (RM)')}</div>
                    <input type="number" style={s.finput} value={form.gold_bar_value} onChange={e=>setForm({...form,gold_bar_value:e.target.value})} placeholder="3400" />
                  </div>
                )}
              </div>


              </div>

              {/* Tiered Reward Builder */}
              {form.campaign_type === 'tiered_reward' && (
                <div style={{ ...s.frow, gridColumn:'1/-1' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={s.flbl}>{L2('REWARD TIERS (deposit range → reward %)','奖励等级（存款范围 → 奖励 %）')}</div>
                    <button type="button" style={{ ...s.btnSm, fontSize:11 }}
                      onClick={()=>setForm(f=>({...f,reward_tiers:[...f.reward_tiers,{min:'',max:'',pct:''}]}))}>
                      {L2('+ Add Tier','+ 添加等级')}
                    </button>
                  </div>
                  <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:0, padding:'6px 12px', background:'var(--surface2)', fontSize:11, color:'var(--muted)', fontWeight:700 }}>
                      <span>{L2('MIN DEPOSIT (RM)','最低存款 (RM)')}</span><span>{L2('MAX DEPOSIT (RM)','最高存款 (RM)')}</span><span>{L2('REWARD %','奖励 %')}</span><span></span>
                    </div>
                    {form.reward_tiers.map((tier, i) => (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:8, padding:'8px 12px', borderTop:'1px solid var(--border)', alignItems:'center' }}>
                        <input type="number" style={s.smInput} value={tier.min} placeholder={L2('e.g. 10000','例如：10000')}
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],min:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <input type="number" style={s.smInput} value={tier.max} placeholder={L2('blank = no limit','留空 = 无上限')}
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],max:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <input type="number" style={{ ...s.smInput, width:70 }} value={tier.pct} placeholder={L2('e.g. 6','例如：6')}
                            onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],pct:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                          <span style={{ fontSize:12, color:'var(--muted)' }}>%</span>
                          {tier.min && tier.pct && (
                            <span style={{ fontSize:11, color:'#3fb950' }}>
                              {L2('e.g.','例如')} {rmFmt(parseFloat(tier.min))} × {tier.pct}% = {rmFmt(parseFloat(tier.min)*parseFloat(tier.pct)/100)}
                            </span>
                          )}
                        </div>
                        <button type="button" onClick={()=>{ const t=form.reward_tiers.filter((_,j)=>j!==i); setForm(f=>({...f,reward_tiers:t})) }}
                          style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:12, cursor:'pointer' }}>✕</button>
                      </div>
                    ))}
                    {form.reward_tiers.length === 0 && (
                      <div style={{ padding:'12px', fontSize:12, color:'var(--muted)', textAlign:'center' }}>{L2('No tiers yet — click "+ Add Tier"','暂无等级 — 点击“+ 添加等级”')}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Dual Tier (Deposit + Turnover) Builder */}
              {form.campaign_type === 'dual_tier' && (
                <div style={{ ...s.frow, gridColumn:'1/-1' }}>
                  <div style={{ marginBottom:14 }}>
                    <div style={s.flbl}>{L2('Settlement Frequency','结算频率')}</div>
                    <div style={{ display:'flex', gap:16, marginTop:6 }}>
                      {[['total',L2('Total — accumulates across the whole campaign period','累计 — 整个活动期间累计计算')],['daily',L2('Daily — each day settles independently, does not carry over','每日 — 每天独立结算，不累计到次日')]].map(([v,label]) => (
                        <label key={v} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer' }}>
                          <input type="radio" checked={(form.settlement_frequency||'total')===v} onChange={()=>setForm(f=>({...f,settlement_frequency:v}))} />
                          {label}
                        </label>
                      ))}
                    </div>
                    {form.settlement_frequency==='daily' && (
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>
                        {L2('Daily settlement uses a separate day-by-day entry screen on the campaign detail page, once this campaign is created.','每日结算在活动创建后，于活动详情页使用独立的逐日录入界面。')}
                      </div>
                    )}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={s.flbl}>{L2("TIERS — must reach turnover to earn that tier's reward",'等级 — 须达到流水才能获得该等级奖励')}{form.settlement_frequency!=='daily' && L2(' (and deposit, if set)','（及存款，如有设置）')}</div>
                    <button type="button" style={{ ...s.btnSm, fontSize:11 }}
                      onClick={()=>setForm(f=>({...f,reward_tiers:[...f.reward_tiers,{depositThreshold:'',turnoverThreshold:'',creditAmount:'',wcashAmount:''}]}))}>
                      {L2('+ Add Tier','+ 添加等级')}
                    </button>
                  </div>
                  <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:0, padding:'6px 12px', background:'var(--surface2)', fontSize:11, color:'var(--muted)', fontWeight:700 }}>
                      <span>{L2('DEPOSIT ≥ (RM) — optional','存款 ≥ (RM) — 可选')}</span><span>{L2('TURNOVER ≥ (RM)','流水 ≥ (RM)')}</span><span>CREDIT (RM)</span><span>WCASH (RM)</span><span></span>
                    </div>
                    {form.reward_tiers.map((tier, i) => (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:8, padding:'8px 12px', borderTop:'1px solid var(--border)', alignItems:'center' }}>
                        <input type="number" style={s.smInput} value={tier.depositThreshold||''} placeholder={L2('leave blank to skip','留空则跳过')}
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],depositThreshold:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <input type="number" style={s.smInput} value={tier.turnoverThreshold||''} placeholder={L2('e.g. 100000','例如：100000')}
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],turnoverThreshold:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <input type="number" style={s.smInput} value={tier.creditAmount||''} placeholder={L2('e.g. 200','例如：200')}
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],creditAmount:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <input type="number" style={s.smInput} value={tier.wcashAmount||''} placeholder={L2('e.g. 200','例如：200')}
                          onChange={e=>{ const t=[...form.reward_tiers]; t[i]={...t[i],wcashAmount:e.target.value}; setForm(f=>({...f,reward_tiers:t})) }} />
                        <button type="button" onClick={()=>{ const t=form.reward_tiers.filter((_,j)=>j!==i); setForm(f=>({...f,reward_tiers:t})) }}
                          style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'2px 8px', borderRadius:5, fontSize:12, cursor:'pointer' }}>✕</button>
                      </div>
                    ))}
                    {form.reward_tiers.length === 0 && (
                      <div style={{ padding:'12px', fontSize:12, color:'var(--muted)', textAlign:'center' }}>{L2('No tiers yet — click "+ Add Tier"','暂无等级 — 点击“+ 添加等级”')}</div>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>
                    {L2('A player only earns the HIGHEST tier where all set conditions are met simultaneously — not each tier added up. Leave Deposit blank on every tier for a turnover-only campaign.','玩家只获得同时满足所有设定条件的最高等级奖励 — 不会逐级累加。若为纯流水活动，所有等级的存款请留空。')}
                  </div>
                </div>
              )}

              {form.campaign_type === 'leaderboard' && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                    <div>
                      <div style={s.flbl}>{L2('Min Valid Bet (RM) *','最低有效投注 (RM) *')}</div>
                      <input type="number" style={s.finput} value={form.min_valid_bet}
                        onChange={e => setForm(f => ({ ...f, min_valid_bet: e.target.value }))} placeholder={L2('e.g. 3000000','例如：3000000')} />
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{L2('Monthly valid bet required to qualify','达标所需的每月有效投注')}</div>
                    </div>
                    <div>
                      <div style={s.flbl}>{L2('Min Deposit (RM) - optional','最低存款 (RM) - 可选')}</div>
                      <input type="number" style={s.finput} value={form.min_deposit_lb||''}
                        onChange={e => setForm(f => ({ ...f, min_deposit_lb: e.target.value }))} placeholder={L2('e.g. 50000','例如：50000')} />
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{L2('Qualify if deposit OR valid bet met','存款或有效投注任一达标即合格')}</div>
                    </div>
                    <div>
                      <div style={s.flbl}>{L2('Top N (slots) *','前 N 名（名额）*')}</div>
                      <input type="number" style={s.finput} value={form.top_n} min={1} max={20}
                        onChange={e => {
                          const n = parseInt(e.target.value)||1
                          const rewards = Array.from({length:n}, (_,i) => form.rank_rewards[i] || {rank:i+1, amount:12000})
                          setForm(f => ({ ...f, top_n: n, rank_rewards: rewards }))
                        }} />
                    </div>
                  </div>
                  <div style={s.flbl}>{L2('Reward per Rank (RM)','每个名次奖励 (RM)')}</div>
                  <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'80px 1fr 1fr', padding:'6px 12px', background:'var(--surface2)', fontSize:11, color:'var(--muted)', fontWeight:700 }}>
                      <span>{L2('Rank','名次')}</span><span>{L2('Amount (RM)','金额 (RM)')}</span><span>{L2('Description','描述')}</span>
                    </div>
                    {form.rank_rewards.map((r, i) => (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'80px 1fr 1fr', gap:8, padding:'8px 12px', borderTop:'1px solid var(--border)', alignItems:'center' }}>
                        <span style={{ fontWeight:700, color:'#a78bfa', fontSize:13 }}>
                          {'#'+(i+1)+L2(' Top ',' 第 ')+(i+1)+L2('',' 名')}
                        </span>
                        <input type="number" style={s.smInput} value={r.amount} placeholder={L2('e.g. 12000','例如：12000')}
                          onChange={e => { const rw=[...form.rank_rewards]; rw[i]={...rw[i],amount:parseFloat(e.target.value)||0}; setForm(f=>({...f,rank_rewards:rw})) }} />
                        <input style={s.smInput} value={r.desc||''} placeholder={L2('e.g. Cash Voucher 12K','例如：现金券 12K')}
                          onChange={e => { const rw=[...form.rank_rewards]; rw[i]={...rw[i],desc:e.target.value}; setForm(f=>({...f,rank_rewards:rw})) }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:8, fontSize:12, color:'#a78bfa', fontWeight:600 }}>
                    {L2('Total reward cost','总奖励成本')}: RM {(form.rank_rewards.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)).toLocaleString('en-MY')}
                  </div>
                </div>
              )}

              <div style={s.g2}>
              <div style={s.frow}>
                <div style={s.flbl}>{L2('Reward Delivery Method','奖励发放方式')}</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
                  {Object.entries(REWARD_DELIVERY).map(([k,v]) => (
                    <div key={k} onClick={()=>setForm(f=>({...f,reward_delivery:k}))}
                      style={{ padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600,
                        border:`2px solid ${form.reward_delivery===k?v.color:'var(--border)'}`,
                        background: form.reward_delivery===k?v.color+'22':'var(--surface2)',
                        color: form.reward_delivery===k?v.color:'var(--muted)',
                        transition:'all .15s' }}>
                      {tLabel(v)}
                    </div>
                  ))}
                </div>
              </div>

              <div style={s.frow}>
                <div style={s.flbl}>{L2('Target Tiers','目标等级')}</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
                  {TIERS.map(tier => { const active=form.target_tier.includes(tier); return (
                    <div key={tier} onClick={()=>toggleTier(tier)} style={{ ...s.badge, cursor:'pointer', background:active?TIER_BG[tier]:'var(--surface2)', color:active?TIER_COLOR[tier]:'var(--muted)', border:`1px solid ${active?TIER_COLOR[tier]:'var(--border)'}`, padding:'5px 14px' }}>{tier}</div>
                  )})}
                </div>
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>💡 {L2('Leave blank — all tiers will be eligible','留空 — 所有等级均可参加')}</div>
              </div>
              <div style={s.frow}><div style={s.flbl}>{L2('Offer Description','优惠描述')}</div><textarea style={s.fta} rows={2} value={form.offer_desc} onChange={e=>setForm({...form,offer_desc:e.target.value})} placeholder={L2("What's being offered?",'提供什么优惠？')} /></div>
              <div style={s.frow}><div style={s.flbl}>{L2('Turnover Multiplier','流水倍数')} <span style={{ fontWeight:400, color:'var(--muted)', fontSize:10 }}>{L2('(WA message — e.g. 3 means reward × 3 required before withdrawal)','（WA 讯息 — 例如 3 表示提款前需完成奖励 × 3 的流水）')}</span></div><input type="number" min="1" step="0.5" style={s.finput} value={form.turnover_multiplier??''} onChange={e=>setForm({...form,turnover_multiplier:e.target.value})} placeholder={L2('e.g. 3 (leave blank = no requirement)','例如：3（留空 = 无要求）')} /></div>
              <div style={s.frow}><div style={s.flbl}>{L2('Notes','备注')}</div><textarea style={s.fta} rows={2} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></div>
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
                  <span style={{ ...s.tag(typeInfo.color), fontSize:11 }}>{tLabel(typeInfo)}</span>
                  <span style={{ ...s.tag(STATUS_COLOR[selected.status], STATUS_BG[selected.status]), fontSize:11 }}>{STATUS_LABEL[selected.status]||selected.status}</span>
                  {selected.platform && <span style={{ ...s.tag('#8b949e'), fontSize:11 }}>{selected.platform}</span>}
                </div>
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>
                  {selected.campaign_code} · {campType==='leaderboard' ? `${L2('Min Valid Bet','最低有效投注')}: ${rmFmt(selected.min_valid_bet, campCurrency)}` : campType==='dual_tier' ? `${(rewardTiers||[]).length} ${L2('tier'+((rewardTiers||[]).length===1?'':'s'),'个等级')}${selected.settlement_frequency==='daily' ? L2(' · Daily settlement',' · 每日结算') : ''}` : `${L2('Min Deposit','最低存款')}: ${rmFmt(depTarget, campCurrency)}`} · {fmtDate(selected.start_date)} → {fmtDate(selected.end_date)}
                  {campType==='pct_reward'   && ` · ${rewardPct}% ${tLabel(deliveryInfo)}${rewardCap?' ('+L2('max ','上限 ')+rmFmt(rewardCap, campCurrency)+')':''}`}
                  {campType==='fixed_reward' && ` · ${rmFmt(rewardFixed, campCurrency)} ${L2('fixed','固定')} ${tLabel(deliveryInfo)}`}
                  {campType==='gold_bar'     && ` · ${L2('Gold Bar','金条')} ${rmFmt(goldVal, campCurrency)}`}
                   {campType==='fixed_reward' && selected?.is_multi_level && ` · ${campaignLevels.length} ${L2('Credit levels','个 Credit 级别')}`}
                  {campType==='tiered_reward' && ` · ${rewardTiers.length} ${L2('reward tiers','个奖励等级')}`}
                </div>
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                {selected.status==='draft' && (() => {
                  const today = new Date().toISOString().slice(0,10)
                  const isFuture = selected.start_date && selected.start_date > today
                  return <button style={s.btnG} onClick={()=>setCampStatus(selected.id, isFuture ? 'upcoming' : 'active')}>▶ {isFuture ? L2('Publish Upcoming','发布为即将开始') : t('campaigns.activate')}</button>
                })()}
                {selected.status==='upcoming' && <><button style={{ ...s.btnG, background:'#3fb950', borderColor:'#3fb950' }} onClick={()=>setCampStatus(selected.id,'active')}>🚀 {L2('Launch Now','立即启动')}</button><button style={s.btnSm} onClick={()=>setCampStatus(selected.id,'draft')}>↩ {L2('Back to Draft','退回草稿')}</button></>}
                {selected.status==='active' && <><button style={s.btnSm} onClick={()=>setCampStatus(selected.id,'paused')}>⏸ {t('campaigns.pause')}</button><button style={s.btnR} onClick={()=>setCampStatus(selected.id,'ended')}>⏹ {t('campaigns.end')}</button></>}
                {selected.status==='paused' && <button style={s.btnG} onClick={()=>setCampStatus(selected.id,'active')}>▶ {t('campaigns.resume')}</button>}
                {players.length > 0 && (
                  <button style={{ ...s.btnSm, color:'#a78bfa', borderColor:'#a78bfa' }} disabled={analyzing} onClick={runCampaignAnalysis}>
                    {analyzing ? L2('⏳ Analyzing…','⏳ 分析中…') : L2('🤖 Analyze','🤖 分析')}
                  </button>
                )}
                <button style={{ ...s.btnSm, color:'var(--accent)', borderColor:'var(--accent)' }} onClick={openCampaignEditor} disabled={levelsLoading}>✏️ {levelsLoading ? L2('Loading…','加载中…') : L2('Edit','编辑')}</button>
                <button style={s.btnR} onClick={deleteCampaign}>🗑 {L2('Delete','删除')}</button>
                <button onClick={closeModal} style={{ background:'none',border:'none',color:'var(--muted)',fontSize:22,cursor:'pointer' }}>×</button>
              </div>
            </div>

            {aiAnalysis && (
              <div style={{ margin:'12px 24px', background:'rgba(167,139,250,.08)', border:'1px solid rgba(167,139,250,.3)', borderRadius:10, padding:'14px 18px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:'#a78bfa', textTransform:'uppercase', letterSpacing:'.5px' }}>{L2('🤖 AI Campaign Analysis','🤖 AI 活动分析')}</span>
                  <button onClick={()=>setAiAnalysis(null)} style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:16 }}>×</button>
                </div>
                <div style={{ fontSize:13, lineHeight:1.7, color:'var(--text)', whiteSpace:'pre-wrap' }}>{aiAnalysis}</div>
              </div>
            )}

            {/* Tiered Reward Reference */}
            {campType === 'tiered_reward' && rewardTiers.length > 0 && !editingCamp && (
              <div style={{ padding:'8px 24px', borderBottom:'1px solid var(--border)', background:'rgba(240,136,62,.05)' }}>
                <span style={{ fontSize:11, color:'#f0883e', fontWeight:700, marginRight:16 }}>{L2('📊 REWARD TIERS:','📊 奖励等级：')}</span>
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
                    <div style={{ fontSize:13, fontWeight:800, color:'var(--accent)' }}>{L2('✏️ CAMPAIGN EDITOR','✏️ 活动编辑器')}</div>
                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{L2('Edit the campaign configuration stored in Supabase.','编辑储存在 Supabase 中的活动配置。')}</div>
                  </div>
                  <span style={{ ...s.tag('#8b949e'), fontSize:10 }}>{editCampForm.campaign_code || L2('NEW CODE','新代码')}</span>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'10px 14px', marginBottom:16 }}>
                  <div><div style={s.flbl}>{L2('Campaign Name *','活动名称 *')}</div><input style={s.finput} value={editCampForm.campaign_name||''} onChange={e=>setEditCampForm(f=>({...f,campaign_name:e.target.value}))} /></div>
                  <div><div style={s.flbl}>{L2('Campaign Code *','活动代码 *')}</div><input style={s.finput} value={editCampForm.campaign_code||''} onChange={e=>setEditCampForm(f=>({...f,campaign_code:e.target.value.toUpperCase()}))} /></div>
                  <div><div style={s.flbl}>{L2('Campaign Type','活动类型')}</div><select style={s.fsel} value={editCampForm.campaign_type||'gold_bar'} onChange={e=>setEditCampForm(f=>({...f,campaign_type:e.target.value}))}>{Object.entries(CAMPAIGN_TYPES).map(([k,v])=><option key={k} value={k}>{k==='fixed_reward' && editCampForm.is_multi_level ? L2('Tiered Deposit Reward','分级存款奖励') : tLabel(v).replace(/^[^ ]+ /,'')}</option>)}</select></div>
                  <div><div style={s.flbl}>{L2('Campaign Category (Optional)','活动类别（可选）')}</div><select style={s.fsel} value={editCampForm.campaign_category||'standard'} onChange={e=>setEditCampForm(f=>({...f,campaign_category:e.target.value}))}><option value="standard">{L2('Standard','标准')}</option><option value="deposit_milestone">{L2('Deposit Milestone','存款里程碑')}</option><option value="leaderboard">{L2('Leaderboard','排行榜')}</option><option value="vip_exclusive">{L2('VIP Exclusive','VIP 专属')}</option></select></div>
                  <div><div style={s.flbl}>{L2('Platform','平台')}</div><select style={s.fsel} value={editCampForm.platform||'MY'} onChange={e=>setEditCampForm(f=>({...f,platform:e.target.value}))}>{PLATFORMS.map(p=><option key={p} value={p}>{p}</option>)}</select></div>
                  <div><div style={s.flbl}>{L2('Status','状态')}</div><select style={s.fsel} value={editCampForm.status||'draft'} onChange={e=>setEditCampForm(f=>({...f,status:e.target.value}))}>{['draft','upcoming','active','paused','ended'].map(v=><option key={v} value={v}>{lang==='zh' ? STATUS_LABEL[v] : v.toUpperCase()}</option>)}</select></div>
                  <div><div style={s.flbl}>{L2('Festival / Occasion','节日 / 场合')}</div><input style={s.finput} value={editCampForm.festival||''} onChange={e=>setEditCampForm(f=>({...f,festival:e.target.value}))} placeholder={L2('e.g. Merdeka 2026','例如：Merdeka 2026')} /></div>
                  <div><div style={s.flbl}>{L2('Budget (RM)','预算 (RM)')}</div><input type="number" min="0" style={s.finput} value={editCampForm.budget_rm??''} onChange={e=>setEditCampForm(f=>({...f,budget_rm:e.target.value}))} /></div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', marginBottom:10, letterSpacing:'.5px' }}>{L2('CAMPAIGN PERIOD & QUALIFICATION','活动期间与资格')}</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'10px 14px' }}>
                    <div><div style={s.flbl}>{L2('Start Date','开始日期')}</div><input type="date" style={s.finput} value={editCampForm.start_date||''} onChange={e=>setEditCampForm(f=>({...f,start_date:e.target.value}))} /></div>
                    <div><div style={s.flbl}>{L2('End Date','结束日期')}</div><input type="date" style={s.finput} value={editCampForm.end_date||''} onChange={e=>setEditCampForm(f=>({...f,end_date:e.target.value}))} /></div>
                    {editCampForm.campaign_type!=='leaderboard' && editCampForm.campaign_type!=='dual_tier' && <div><div style={s.flbl}>{L2('Deposit Target','存款目标')}</div><input type="number" min="0" style={s.finput} value={editCampForm.deposit_target??''} onChange={e=>setEditCampForm(f=>({...f,deposit_target:e.target.value}))} /></div>}
                    {editCampForm.campaign_type==='leaderboard' && <><div><div style={s.flbl}>{L2('Minimum Valid Bet','最低有效投注')}</div><input type="number" min="0" style={s.finput} value={editCampForm.min_valid_bet??''} onChange={e=>setEditCampForm(f=>({...f,min_valid_bet:e.target.value}))} /></div><div><div style={s.flbl}>{L2('Minimum Deposit','最低存款')}</div><input type="number" min="0" style={s.finput} value={editCampForm.min_deposit_lb??''} onChange={e=>setEditCampForm(f=>({...f,min_deposit_lb:e.target.value}))} /></div></>}
                    <div><div style={s.flbl}>{L2('Settlement Frequency','结算频率')}</div><select style={s.fsel} value={editCampForm.settlement_frequency||'total'} onChange={e=>setEditCampForm(f=>({...f,settlement_frequency:e.target.value}))}><option value="total">{L2('Total','累计')}</option><option value="daily">{L2('Daily','每日')}</option></select></div>
                    <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text)', paddingTop:18, cursor:'pointer' }}><input type="checkbox" checked={editCampForm.requires_period_deposit!==false} onChange={e=>setEditCampForm(f=>({...f,requires_period_deposit:e.target.checked}))} /> {L2('Requires period deposit','需要活动期间存款')}</label>
                  </div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', marginBottom:10, letterSpacing:'.5px' }}>{L2('TARGET VIP TIERS','目标 VIP 等级')}</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {TIERS.map(tier=>{ const active=(editCampForm.target_tier||[]).includes(tier); return <button type="button" key={tier} onClick={()=>setEditCampForm(f=>({...f,target_tier:active?(f.target_tier||[]).filter(x=>x!==tier):[...(f.target_tier||[]),tier]}))} style={{ ...s.badge, padding:'6px 14px', cursor:'pointer', background:active?TIER_BG[tier]:'var(--surface2)', color:active?TIER_COLOR[tier]:'var(--muted)', border:`1px solid ${active?TIER_COLOR[tier]:'var(--border)'}` }}>{tier}</button> })}
                  </div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', marginBottom:10, letterSpacing:'.5px' }}>{L2('REWARD CONFIGURATION','奖励配置')}</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'10px 14px' }}>
                    <div><div style={s.flbl}>{L2('Reward Delivery','奖励发放')}</div><select style={s.fsel} value={editCampForm.reward_delivery||'credit'} onChange={e=>setEditCampForm(f=>({...f,reward_delivery:e.target.value}))}>{Object.entries(REWARD_DELIVERY).map(([k,v])=><option key={k} value={k}>{tLabel(v).replace(/^[^ ]+ /,'')}</option>)}</select></div>
                    {editCampForm.campaign_type==='pct_reward' && <><div><div style={s.flbl}>{L2('Reward %','奖励 %')}</div><input type="number" min="0" step="0.01" style={s.finput} value={editCampForm.reward_pct??''} onChange={e=>setEditCampForm(f=>({...f,reward_pct:e.target.value}))} /></div><div><div style={s.flbl}>{L2('Reward Cap','奖励上限')}</div><input type="number" min="0" style={s.finput} value={editCampForm.reward_cap??''} onChange={e=>setEditCampForm(f=>({...f,reward_cap:e.target.value}))} placeholder={L2('No cap','无上限')} /></div></>}
                    {editCampForm.campaign_type==='fixed_reward' && !editCampForm.is_multi_level && <div><div style={s.flbl}>{L2('Fixed Reward','固定奖励')}</div><input type="number" min="0" style={s.finput} value={editCampForm.reward_fixed??''} onChange={e=>setEditCampForm(f=>({...f,reward_fixed:e.target.value}))} /></div>}
                    {editCampForm.campaign_type==='gold_bar' && <div><div style={s.flbl}>{L2('Gold Bar Value','金条价值')}</div><input type="number" min="0" style={s.finput} value={editCampForm.gold_bar_value??''} onChange={e=>setEditCampForm(f=>({...f,gold_bar_value:e.target.value}))} /></div>}
                  </div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <div><div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', letterSpacing:'.5px' }}>{L2('MULTI-LEVEL CAMPAIGN','多级别活动')}</div><div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{L2('Uses','使用')} <code>campaign_levels</code> {L2('— the same source used by the Player Portal.','— 与玩家门户使用相同的数据来源。')}</div></div>
                    <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, cursor:'pointer' }}><input type="checkbox" checked={Boolean(editCampForm.is_multi_level)} onChange={e=>setEditCampForm(f=>({...f,is_multi_level:e.target.checked,max_levels:e.target.checked?Math.max(1,campaignLevelsEdit.length):1}))} /> {L2('Enable levels','启用级别')}</label>
                  </div>
                  {editCampForm.is_multi_level && <>
                    <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
                      <div style={{ fontSize:10, color:'var(--muted)', fontWeight:800, marginBottom:8 }}>{L2('PAYOUT MODE','派彩模式')}</div>
                      <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
                        <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer' }}>
                          <input type="radio" name="edit_payout_mode" value="all" checked={(editCampForm.payout_mode||'all')==='all'} onChange={()=>setEditCampForm(f=>({...f,payout_mode:'all'}))} />
                          <span><strong>{L2('Pay all unlocked levels','派发所有已解锁级别')}</strong> {L2('— each level earns its own reward','— 每个级别各自获得奖励')}</span>
                        </label>
                        <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer' }}>
                          <input type="radio" name="edit_payout_mode" value="highest_only" checked={editCampForm.payout_mode==='highest_only'} onChange={()=>setEditCampForm(f=>({...f,payout_mode:'highest_only'}))} />
                          <span><strong>{L2('Pay highest level only','只派发最高级别')}</strong> {L2('— one reward per player (the biggest)','— 每位玩家一份奖励（最高的）')}</span>
                        </label>
                      </div>
                    </div>
                    <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}><button type="button" style={{ ...s.btnSm, fontSize:11 }} onClick={()=>setCampaignLevelsEdit(prev=>[...prev,{...normalizeLevel({},prev.length),level_order:prev.length+1}])}>{L2('+ Add Level','+ 添加级别')}</button></div>
                    <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:9, overflow:'hidden' }}>
                      <div style={{ display:'grid', gridTemplateColumns:'46px 100px 1.2fr 110px 110px 110px 1.2fr 32px', gap:6, padding:'7px 10px', background:'var(--surface2)', fontSize:10, color:'var(--muted)', fontWeight:800 }}><span>#</span><span>{L2('CODE','代码')}</span><span>{L2('LEVEL NAME','级别名称')}</span><span>{L2('DEPOSIT','存款')}</span><span>{L2('REWARD','奖励')}</span><span>{L2('MAX %','上限 %')}</span><span>{L2('DESCRIPTION','描述')}</span><span></span></div>
                      {campaignLevelsEdit.map((level,i)=><div key={level.id||`new-${i}`} style={{ display:'grid', gridTemplateColumns:'46px 100px 1.2fr 110px 110px 110px 1.2fr 32px', gap:6, padding:'8px 10px', borderTop:'1px solid var(--border)', alignItems:'center' }}>
                        <input type="number" min="1" style={s.finput} value={level.level_order} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],level_order:e.target.value};setCampaignLevelsEdit(a)}} />
                        <input style={s.finput} value={level.level_code||''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],level_code:e.target.value.toUpperCase()};setCampaignLevelsEdit(a)}} placeholder="CODE31" />
                        <input style={s.finput} value={level.level_name||''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],level_name:e.target.value};setCampaignLevelsEdit(a)}} placeholder={L2('Level 1','级别 1')} />
                        <input type="number" min="0" style={s.finput} value={level.deposit_threshold??''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],deposit_threshold:e.target.value};setCampaignLevelsEdit(a)}} />
                        <input type="number" min="0" style={s.finput} value={level.reward_amount??''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],reward_amount:e.target.value};setCampaignLevelsEdit(a)}} />
                        <input type="number" min="0.01" max="100" step="0.01" style={s.finput} value={Number(level.max_reward_pct??0.05)*100} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],max_reward_pct:(Number(e.target.value)||0)/100};setCampaignLevelsEdit(a)}} />
                        <input style={s.finput} value={level.description||''} onChange={e=>{const a=[...campaignLevelsEdit];a[i]={...a[i],description:e.target.value};setCampaignLevelsEdit(a)}} placeholder={L2('Deposit RM31,000 within campaign period','活动期间存款 RM31,000')} />
                        <button type="button" onClick={()=>setCampaignLevelsEdit(prev=>prev.filter((_,j)=>j!==i))} style={{ background:'none', border:'1px solid rgba(248,81,73,.3)', color:'#f85149', padding:'5px 7px', borderRadius:5, cursor:'pointer' }}>×</button>
                      </div>)}
                      {!campaignLevelsEdit.length && <div style={{ padding:14, textAlign:'center', fontSize:12, color:'var(--muted)' }}>{L2('No levels yet.','暂无级别。')}</div>}
                    </div>
                    {campaignLevelsEdit.some(l=>Number(l.deposit_threshold)>0 && Number(l.reward_amount)>Number(l.deposit_threshold)*Number(l.max_reward_pct||0)) && <div style={{ marginTop:8, padding:'8px 10px', borderRadius:7, background:'rgba(248,81,73,.1)', color:'#f85149', fontSize:11 }}>{L2('⚠️ One or more levels exceed their configured reward cap.','⚠️ 一个或多个级别超出所设定的奖励上限。')}</div>}
                  </>}
                </div>

                {/* ── STREAK BONUS CONFIG (daily mode only) ── */}
                {editCampForm.campaign_type === 'dual_tier' && editCampForm.settlement_frequency === 'daily' && (
                  <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', letterSpacing:'.5px' }}>{L2('🔥 STREAK BONUS','🔥 连续奖励')}</div>
                        <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{L2('Extra reward when players complete consecutive qualifying days.','玩家连续多天达标时给予额外奖励。')}</div>
                      </div>
                      <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, cursor:'pointer' }}>
                        <input type="checkbox" checked={Boolean(editCampForm.streak_enabled)} onChange={e=>setEditCampForm(f=>({...f,streak_enabled:e.target.checked}))} />
                        {L2('Enable streak','启用连续奖励')}
                      </label>
                    </div>
                    {editCampForm.streak_enabled && (
                      <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'12px 14px' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'10px 14px', marginBottom:10 }}>
                          <div>
                            <div style={s.flbl}>{L2('Streak Length (days)','连续天数')}</div>
                            <input type="number" min="2" max="30" style={s.finput} value={editCampForm.streak_days||3} onChange={e=>setEditCampForm(f=>({...f,streak_days:e.target.value}))} />
                            <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{L2('Consecutive qualifying days per bonus','每次奖励所需的连续达标天数')}</div>
                          </div>
                          <div>
                            <div style={s.flbl}>{L2('Bonus Mode','奖金模式')}</div>
                            <select style={s.fsel} value={editCampForm.streak_bonus_type||'pct'} onChange={e=>setEditCampForm(f=>({...f,streak_bonus_type:e.target.value}))}>
                              <option value="pct">{L2('% of Period Deposit','期间存款 %')}</option>
                              <option value="fixed">{L2('Fixed Amount','固定金额')}</option>
                            </select>
                          </div>
                          {(editCampForm.streak_bonus_type||'pct')==='pct' ? (
                            <div>
                              <div style={s.flbl}>{L2('Bonus %','奖金 %')}</div>
                              <input type="number" min="0" step="0.01" style={s.finput} value={editCampForm.streak_bonus_pct??1} onChange={e=>setEditCampForm(f=>({...f,streak_bonus_pct:e.target.value}))} placeholder={L2('e.g. 1','例如：1')} />
                              <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{L2(`% of total deposit in those ${editCampForm.streak_days||3} days`, `这 ${editCampForm.streak_days||3} 天总存款的 %`)}</div>
                            </div>
                          ) : (
                            <div>
                              <div style={s.flbl}>{L2('Fixed Bonus (RM)','固定奖金 (RM)')}</div>
                              <input type="number" min="0" style={s.finput} value={editCampForm.streak_bonus_fixed??0} onChange={e=>setEditCampForm(f=>({...f,streak_bonus_fixed:e.target.value}))} placeholder={L2('e.g. 100','例如：100')} />
                            </div>
                          )}
                          <div>
                            <div style={s.flbl}>{L2('Max Cap (RM)','上限 (RM)')}</div>
                            <input type="number" min="0" style={s.finput} value={editCampForm.streak_bonus_cap??0} onChange={e=>setEditCampForm(f=>({...f,streak_bonus_cap:e.target.value}))} placeholder={L2('0 = no cap','0 = 无上限')} />
                            <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>{L2('0 = no cap','0 = 无上限')}</div>
                          </div>
                        </div>
                        <div style={{ fontSize:11, color:'var(--muted)', padding:'8px 10px', background:'rgba(88,166,255,.06)', borderRadius:6 }}>
                          <strong>{L2('How it works:','运作方式：')}</strong> {L2(`Player qualifies for streak when they deposit ≥ Level 1 threshold on a given day. Every ${editCampForm.streak_days||3} consecutive qualifying days earns one bonus, paid the next day. Streak resets if any day is missed.`, `玩家当天存款 ≥ 级别 1 门槛即算达标。每连续达标 ${editCampForm.streak_days||3} 天获得一次奖金，于次日派发。若中断任何一天，连续记录将重置。`)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {editCampForm.campaign_type==='leaderboard' && <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}><div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
  <div>
    <div style={s.flbl}>{L2('Leaderboard Metric','排行榜指标')}</div>
    <select style={s.fsel} value={editCampForm.leaderboard_metric||'turnover'} onChange={e=>setEditCampForm(f=>({...f,leaderboard_metric:e.target.value}))}>
      <option value="turnover">{L2('Turnover Race','流水竞赛')}</option>
      <option value="deposit">{L2('Deposit Race','存款竞赛')}</option>
      <option value="turnover_deposit">{L2('Turnover + Deposit Race','流水 + 存款竞赛')}</option>
    </select>
  </div>
</div>

                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}><div style={s.flbl}>{L2('LEADERBOARD REWARDS','排行榜奖励')}</div><div><span style={{ fontSize:11, color:'var(--muted)', marginRight:8 }}>{L2('Top N','前 N 名')}</span><input type="number" min="1" max="50" style={{ ...s.smInput, width:65 }} value={editCampForm.top_n||3} onChange={e=>{const n=Math.max(1,Math.min(50,parseInt(e.target.value)||1));const rw=Array.from({length:n},(_,i)=>(editCampForm.rank_rewards||[])[i]||{rank:i+1,amount:0,desc:''});setEditCampForm(f=>({...f,top_n:n,rank_rewards:rw}))}} /></div></div>
                  {(editCampForm.rank_rewards||[]).map((r,i)=><div key={i} style={{ display:'grid', gridTemplateColumns:'70px 160px 1fr', gap:8, marginBottom:6 }}><div style={{ padding:'8px 10px', color:'#a78bfa', fontWeight:700, fontSize:12 }}>#{i+1}</div><input type="number" min="0" style={s.finput} value={r.amount??''} placeholder={L2('Amount','金额')} onChange={e=>{const rw=[...(editCampForm.rank_rewards||[])];rw[i]={...rw[i],amount:e.target.value};setEditCampForm(f=>({...f,rank_rewards:rw}))}} /><input style={s.finput} value={r.desc||''} placeholder={L2('Reward description','奖励描述')} onChange={e=>{const rw=[...(editCampForm.rank_rewards||[])];rw[i]={...rw[i],desc:e.target.value};setEditCampForm(f=>({...f,rank_rewards:rw}))}} /></div>)}
                </div>}

                {(editCampForm.campaign_type==='tiered_reward' || editCampForm.campaign_type==='dual_tier') && <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}><div><div style={s.flbl}>{L2('JSON REWARD TIERS','JSON 奖励等级')}</div><div style={{ fontSize:10, color:'var(--muted)' }}>{L2('Used by the existing tiered/dual-tier engine. Separate from campaign_levels.','由现有的分级/双等级引擎使用，与 campaign_levels 分开。')}</div></div><button type="button" style={{ ...s.btnSm, fontSize:11 }} onClick={()=>setEditCampForm(f=>({...f,reward_tiers:[...(f.reward_tiers||[]), editCampForm.campaign_type==='dual_tier'?{depositThreshold:'',turnoverThreshold:'',creditAmount:'',wcashAmount:''}:{min:'',max:'',pct:''}]}))}>{L2('+ Add Tier','+ 添加等级')}</button></div>
                  {editCampForm.campaign_type==='dual_tier' && <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 32px', gap:6, marginBottom:4 }}><div style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>{L2('MIN DEPOSIT (RM)','最低存款 (RM)')}</div><div style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>{L2('MIN TURNOVER (RM)','最低流水 (RM)')}</div><div style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>CREDIT (RM)</div><div style={{ fontSize:10, color:'var(--muted)', fontWeight:700 }}>WCASH (RM)</div><div/></div>}
                  {(editCampForm.reward_tiers||[]).map((tier,i)=> editCampForm.campaign_type==='dual_tier' ? <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 32px', gap:6, marginBottom:6 }}><input type="number" style={s.finput} value={tier.depositThreshold||''} placeholder={L2('e.g. 9000','例如：9000')} onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],depositThreshold:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.turnoverThreshold||''} placeholder={L2('e.g. 99000','例如：99000')} onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],turnoverThreshold:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.creditAmount||''} placeholder={L2('e.g. 900','例如：900')} onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],creditAmount:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.wcashAmount||''} placeholder={L2('e.g. 0','例如：0')} onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],wcashAmount:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><button type="button" onClick={()=>setEditCampForm(f=>({...f,reward_tiers:(f.reward_tiers||[]).filter((_,j)=>j!==i)}))} style={{ ...s.btnR, padding:'4px 7px' }}>×</button></div> : <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 90px 32px', gap:6, marginBottom:6 }}><input type="number" style={s.finput} value={tier.min||''} placeholder={L2('Min deposit','最低存款')} onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],min:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.max||''} placeholder={L2('Max','最高')} onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],max:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.pct||''} placeholder="%" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],pct:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><button type="button" onClick={()=>setEditCampForm(f=>({...f,reward_tiers:(f.reward_tiers||[]).filter((_,j)=>j!==i)}))} style={{ ...s.btnR, padding:'4px 7px' }}>×</button></div>)}
                </div>}

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={s.flbl}>{L2('PLAYER CONTENT','玩家内容')}</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:8 }}>
                    <textarea style={s.fta} rows={3} value={editCampForm.offer_desc||''} onChange={e=>setEditCampForm(f=>({...f,offer_desc:e.target.value}))} placeholder={L2('Write player-facing How to Join, Rules & Regulations, eligibility, deposit rules, reward conditions, and payout terms. Use line breaks for sections.','填写面向玩家的参加方式、规则与条款、资格、存款规则、奖励条件及派彩条款。用换行分隔各部分。')} />
                    <textarea style={s.fta} rows={3} value={editCampForm.notes||''} onChange={e=>setEditCampForm(f=>({...f,notes:e.target.value}))} placeholder={L2('Internal notes','内部备注')} />
                  </div>
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={s.flbl}>{L2('Turnover Multiplier','流水倍数')} <span style={{ fontWeight:400, color:'var(--muted)', fontSize:10 }}>{L2('(WA payout message — e.g. 3 means reward × 3 required before withdrawal)','（WA 派彩讯息 — 例如 3 表示提款前需完成奖励 × 3 的流水）')}</span></div>
                  <input type="number" min="1" step="0.5" style={{ ...s.finput, width:180, marginTop:4 }} value={editCampForm.turnover_multiplier??''} onChange={e=>setEditCampForm(f=>({...f,turnover_multiplier:e.target.value}))} placeholder={L2('e.g. 3 (leave blank = no requirement)','例如：3（留空 = 无要求）')} />
                </div>

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', marginBottom:6, letterSpacing:'.5px' }}>{L2('💬 WHATSAPP MESSAGE TEMPLATE','💬 WHATSAPP 讯息模板')}</div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:8 }}>{L2('Optional — overrides the auto-generated message. Variables:','可选 — 覆盖自动生成的讯息。变量：')} <code>{'{username}'}</code> <code>{'{campaign}'}</code> <code>{'{agent}'}</code> <code>{'{gap}'}</code></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4, fontWeight:600 }}>🇬🇧 {L2('English','英文')}</div>
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
                  <div style={{ fontSize:11, fontWeight:800, color:'#25d366', marginBottom:4, letterSpacing:'.5px' }}>📲 {L2('PAYOUT NOTIFICATION MESSAGE','派彩通知讯息')}</div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:10 }}>
                    {L2('Edit the message sent when a player qualifies for payout. Leave blank to use the default. Variables:','编辑玩家符合派彩条件时发送的讯息。留空则使用默认讯息。变量：')} <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{username}'}</code> <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{campaign}'}</code> <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{agent}'}</code> <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{reward}'}</code> <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>{'{turnover}'}</code>
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
                            <div style={{ fontSize:10, color:'#25d366', fontWeight:700, marginBottom:6 }}>👁 {L2('Preview','预览')}</div>
                            {preview}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <button style={s.btnG} onClick={editCampaign} disabled={saving}>{saving?L2('Saving…','保存中…'):L2('💾 Save Campaign','💾 保存活动')}</button>
                  <button style={s.btnSm} onClick={()=>{setEditingCamp(false);setCampaignLevelsEdit([])}} disabled={saving}>{L2('Cancel','取消')}</button>
                  <span style={{ fontSize:10, color:'var(--muted)', marginLeft:4 }}>{L2('Changes are saved to the existing campaign; player records are not recreated.','更改将保存到现有活动；玩家记录不会重新创建。')}</span>
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
                [t('campaigns.totalReward'),`${rewardFmt(totalReward, campCurrency)} ${tLabel(deliveryInfo)}`, typeInfo.color],
                [t('campaigns.paidOut'),    rewardFmt(paidOut, campCurrency),    '#3fb950'],
                [t('campaigns.pendingPay'), rewardFmt(pendingPay, campCurrency), '#f85149'],
                [t('campaigns.successRate'),players.length?(isDailyMode||!selected?.is_multi_level?Math.round(achieved.length/players.length*100):multiSummary.successRate)+'%':'0%', '#3fb950'],
              ].map(([l,v,c])=>( <div key={l}><div style={{ fontSize:16, fontWeight:800, color:c }}>{v}</div><div style={{ fontSize:10, color:'var(--muted)' }}>{l}</div></div> ))}
            </div>

            {/* Add VIP */}
            <div style={{ padding:'10px 24px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>➕ {L2('ADD PLAYER TO CAMPAIGN','添加玩家到活动')}</div>
              <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                <div style={{ position:'relative', flex:1 }}>
                  <input style={s.finput} value={vipSearch} onChange={e=>setVipSearch(e.target.value)} placeholder={L2('Search username or name…','搜索用户名或姓名…')} />
                  {vipResults.length > 0 && (
                    <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, zIndex:100, boxShadow:'0 8px 24px rgba(0,0,0,.5)', marginTop:2 }}>
                      {vipResults.map((v,idx)=>(
                        <div key={v.username+idx} onClick={()=>addVIP(v)}
                          style={{ padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid var(--border)' }}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <span style={{ ...s.badge, background:TIER_BG[v.tier]||'transparent', color:TIER_COLOR[v.tier]||'var(--muted)' }}>{v.tier}</span>
                          {v.source==='potential' && <span style={{ ...s.badge, background:'rgba(99,102,241,.15)', color:'#818cf8', fontSize:9, padding:'1px 6px' }}>{L2('POTENTIAL','潜在')}</span>}
                          <span style={{ fontWeight:700 }}>{v.username}</span>
                          <span style={{ color:'var(--muted)', fontSize:12 }}>{v.full_name||''}</span>
                          <span style={{ marginLeft:'auto', color:'#3fb950', fontSize:12 }}>{L2('+ Add','+ 添加')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={openBulkEnroll}
                  style={{ background:'rgba(88,166,255,.1)', border:'1px solid rgba(88,166,255,.3)', color:'#58a6ff', padding:'9px 14px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
                  📋 {L2('Browse All VIPs','浏览所有 VIP')}
                </button>
              </div>

              {/* Bulk enrollment panel */}
              {bulkEnrollOpen && (
                <div style={{ marginTop:10, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                  {/* Panel header */}
                  <div style={{ padding:'10px 14px', background:'var(--surface)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>{L2('Select VIPs to Enroll','选择要加入的 VIP')}</span>
                    <input value={bulkEnrollSearch} onChange={e=>setBulkEnrollSearch(e.target.value)} placeholder={L2('Filter by username…','按用户名筛选…')}
                      style={{ ...s.smInput, width:160, fontSize:12 }} />
                    <select value={bulkEnrollTier} onChange={e=>setBulkEnrollTier(e.target.value)}
                      style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'5px 8px', fontSize:12, color:'var(--text)', cursor:'pointer' }}>
                      <option value="all">{L2('All Tiers','全部等级')}</option>
                      {TIERS.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <span style={{ fontSize:11, color:'var(--muted)', marginLeft:'auto' }}>
                      {bulkEnrollLoading ? L2('Loading…','加载中…') : `${bulkEnrollList.filter(v=>(bulkEnrollTier==='all'||v.tier===bulkEnrollTier)&&(!bulkEnrollSearch||v.username.toLowerCase().includes(bulkEnrollSearch.toLowerCase())||((v.full_name||'').toLowerCase().includes(bulkEnrollSearch.toLowerCase())))).length} VIPs · ${bulkEnrollSelected.size} ${L2('selected','已选')}`}
                    </span>
                    <button onClick={()=>setBulkEnrollOpen(false)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:14, cursor:'pointer', padding:'2px 6px' }}>✕</button>
                  </div>

                  {/* VIP list */}
                  <div style={{ maxHeight:260, overflowY:'auto' }}>
                    {bulkEnrollLoading
                      ? <div style={{ padding:20, textAlign:'center', fontSize:12, color:'var(--muted)' }}>{L2('Loading VIPs…','正在加载 VIP…')}</div>
                      : (() => {
                          const filtered = bulkEnrollList.filter(v =>
                            (bulkEnrollTier==='all'||v.tier===bulkEnrollTier) &&
                            (!bulkEnrollSearch || v.username.toLowerCase().includes(bulkEnrollSearch.toLowerCase()) || ((v.full_name||'').toLowerCase().includes(bulkEnrollSearch.toLowerCase())))
                          )
                          if (!filtered.length) return <div style={{ padding:20, textAlign:'center', fontSize:12, color:'var(--muted)' }}>{L2('No VIPs match.','没有匹配的 VIP。')}</div>
                          return filtered.map(v => {
                            const checked = bulkEnrollSelected.has(v.id)
                            return (
                              <div key={v.id} onClick={()=>{
                                setBulkEnrollSelected(prev=>{const s=new Set(prev); checked?s.delete(v.id):s.add(v.id); return s})
                              }}
                                style={{ padding:'8px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid var(--border)', background: checked ? 'rgba(88,166,255,.07)' : 'transparent' }}
                                onMouseEnter={e=>{ if(!checked) e.currentTarget.style.background='var(--surface2)' }}
                                onMouseLeave={e=>{ e.currentTarget.style.background = checked ? 'rgba(88,166,255,.07)' : 'transparent' }}>
                                <input type="checkbox" checked={checked} readOnly style={{ accentColor:'var(--accent)', width:14, height:14, cursor:'pointer', flexShrink:0 }} />
                                <span style={{ ...s.badge, background:TIER_BG[v.tier]||'transparent', color:TIER_COLOR[v.tier]||'var(--muted)', fontSize:10 }}>{v.tier}</span>
                                <span style={{ fontWeight:700, fontSize:13 }}>{v.username}</span>
                                <span style={{ color:'var(--muted)', fontSize:12 }}>{v.full_name||''}</span>
                              </div>
                            )
                          })
                        })()
                    }
                  </div>

                  {/* Panel footer */}
                  <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', display:'flex', gap:8, alignItems:'center' }}>
                    <button onClick={()=>{
                      const filtered = bulkEnrollList.filter(v=>(bulkEnrollTier==='all'||v.tier===bulkEnrollTier)&&(!bulkEnrollSearch||v.username.toLowerCase().includes(bulkEnrollSearch.toLowerCase())||((v.full_name||'').toLowerCase().includes(bulkEnrollSearch.toLowerCase()))))
                      setBulkEnrollSelected(new Set(filtered.map(v=>v.id)))
                    }} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'5px 12px', fontSize:12, color:'var(--muted)', cursor:'pointer' }}>
                      {L2('Select All','全选')}
                    </button>
                    <button onClick={()=>setBulkEnrollSelected(new Set())} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'5px 12px', fontSize:12, color:'var(--muted)', cursor:'pointer' }}>
                      {L2('Clear','清除')}
                    </button>
                    <button onClick={doBulkEnroll} disabled={bulkEnrollSelected.size===0||bulkEnrollLoading}
                      style={{ marginLeft:'auto', background: bulkEnrollSelected.size===0 ? 'var(--surface2)' : 'var(--accent)', border:'none', borderRadius:8, padding:'7px 18px', fontSize:13, fontWeight:700, color: bulkEnrollSelected.size===0 ? 'var(--muted)' : '#fff', cursor: bulkEnrollSelected.size===0 ? 'default' : 'pointer', opacity: bulkEnrollLoading ? 0.6 : 1 }}>
                      {bulkEnrollLoading ? L2('Enrolling…','加入中…') : L2(`✅ Enroll Selected (${bulkEnrollSelected.size})`, `✅ 加入所选 (${bulkEnrollSelected.size})`)}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 24px' }}>
              {[
                ['chase',    L2(`🏃 Chase List (${players.length})`, `🏃 跟进名单 (${players.length})`)],
                ['payout',   `💰 ${L2('Payout','派彩')} (${isDailyMode ? dailyAchieved.length : selected?.is_multi_level ? multiPayoutRows.length : achieved.length} ${L2('rewards','份奖励')})`],
                ...(isDailyMode ? [['streak', `🔥 ${L2('Streak','连续奖励')}${selected?.streak_enabled ? '' : L2(' (off)',' (关闭)')}`]] : []),
                ...(isDailyMode ? [['inactive', `😴 ${L2('Inactive','不活跃')}`]] : []),
                ['register', L2('📋 All Players','📋 所有玩家')],
                ...(campType==='leaderboard' ? [['leaderboard',L2('[TOP] Leaderboard','[TOP] 排行榜')]] : []),
                ['summary', L2('📊 Summary','📊 汇总')],
              ].map(([id,label])=>(
                <button key={id} onClick={()=>setActiveTab(id)} style={{ background:'none', border:'none', cursor:'pointer', padding:'10px 16px', fontSize:13, fontWeight:600, color:activeTab===id?'var(--accent)':'var(--muted)', borderBottom:activeTab===id?'2px solid var(--accent)':'2px solid transparent', transition:'color .15s' }}>{label}</button>
              ))}
            </div>

            {/* ── CHASE LIST ── */}
            {activeTab === 'chase' && (
              <div style={{ overflowX:'auto' }}>
                <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(88,166,255,.04)', borderBottom:'1px solid var(--border)' }}>
                  {L2('Click deposit field to update · reward auto-calculated based on campaign type','点击存款栏位进行更新 · 奖励根据活动类型自动计算')}
                </div>
                {/* Chase list host filter */}
                {chaseHosts.length > 1 && (
                  <div style={{ padding:'6px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                    <span style={{ fontSize:11, color:'var(--muted)', marginRight:2 }}>{L2('Host:','负责人：')}</span>
                    {chaseHosts.map(h => (
                      <button key={h} onClick={() => setHostFilter(h)} style={{
                        padding:'3px 12px', borderRadius:16, fontSize:12, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                        background: hostFilter === h ? 'var(--accent)' : 'var(--surface2)',
                        color: hostFilter === h ? '#fff' : 'var(--muted)',
                      }}>{h === 'all' ? `${L2('All','全部')} (${chaseList.length})` : `${h} (${chaseList.filter(p=>p.host_assigned===h).length})`}</button>
                    ))}
                  </div>
                )}
                {/* Chase list search + sort filter */}
                <div style={{ padding:'8px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <input
                    value={chaseFilter}
                    onChange={e => setChaseFilter(e.target.value)}
                    placeholder={L2(`🔍 Filter ${filteredChaseList.length} players by username…`, `🔍 按用户名筛选 ${filteredChaseList.length} 位玩家…`)}
                    style={{ ...s.smInput, width:240, fontSize:12 }}
                  />
                  {chaseFilter && (
                    <button onClick={() => setChaseFilter('')} style={{ fontSize:11, color:'var(--muted)', background:'none', border:'none', cursor:'pointer', padding:'2px 6px' }}>✕ {L2('Clear','清除')}</button>
                  )}
                  {chaseFilter && <span style={{ fontSize:11, color:'var(--muted)' }}>{filteredChaseList.length} {L2('match'+(filteredChaseList.length !== 1 ? 'es' : ''),'个匹配')}</span>}
                  <span style={{ fontSize:11, color:'var(--muted)', marginLeft:4 }}>{L2('Sort:','排序：')}</span>
                  {[['deposit',L2('Deposit','存款')],['turnover',L2('Turnover','流水')],['reward',L2('Reward','奖励')],['progress',L2('Progress','进度')],['name',L2('Name','名称')]].map(([key,lbl])=>(
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
                    {selectedForRemoval.size > 0 && campType !== 'leaderboard' && (
                      <button onClick={bulkRemovePlayers}
                        style={{ background:'rgba(248,81,73,.1)', border:'1px solid rgba(248,81,73,.4)', color:'#f85149', padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
                        🗑 {L2('Remove Selected','移除所选')} ({selectedForRemoval.size})
                      </button>
                    )}
                    {campType !== 'leaderboard' && (
                      <button
                        onClick={importFromVipData}
                        disabled={dailyLoading || realFinancialsLoading}
                        title={L2('Auto-fill deposit and turnover from VIP daily snapshot data for the campaign date range','根据活动日期范围，从 VIP 每日快照数据自动填入存款和流水')}
                        style={{ background:'rgba(88,166,255,.12)', border:'1px solid rgba(88,166,255,.3)', color:'#58a6ff', padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', opacity: (dailyLoading||realFinancialsLoading) ? 0.5 : 1 }}
                      >
                        {dailyLoading ? L2('⏳ Importing…','⏳ 导入中…') : L2('⬇ Import from VIP Data','⬇ 从 VIP 数据导入')}
                      </button>
                    )}
                  </div>
                </div>
                {isDailyMode && (
                  <div style={{ padding:'12px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'#c9a961' }}>{L2('📅 Entry Date:','📅 录入日期：')}</span>
                    <input type="date" value={entryDate} min={selected.start_date||undefined} max={selected.end_date||undefined}
                      onChange={e=>setEntryDate(e.target.value)}
                      style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:12, color:'var(--text)' }} />
                    <span style={{ fontSize:11, color:'var(--muted)' }}>{L2("Each day settles independently — entering turnover for this date does not affect any other date's record.",'每天独立结算 — 录入此日期的流水不会影响其他日期的记录。')}</span>
                    {dailyLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>{L2('Loading…','加载中…')}</span>}
                    {selected?.is_multi_level && campaignLevels?.length > 0 && (
                      <button onClick={recalcDailyRewards} disabled={dailyLoading}
                        style={{ marginLeft:'auto', background:'rgba(201,169,97,.12)', border:'1px solid rgba(201,169,97,.3)', color:'#c9a961', padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}
                        title={L2('Recalculate tier_achieved and credit_reward for ALL entries of this campaign using campaign level thresholds','使用活动级别门槛，重新计算此活动所有记录的 tier_achieved 和 credit_reward')}>
                        🔄 {L2('Recalculate All Rewards','重新计算所有奖励')}
                      </button>
                    )}
                  </div>
                )}
                <table style={s.tbl}>
                  {campType === 'leaderboard' ? (
                    <>
                    <thead><tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>{L2('Player','玩家')}</th>
                      <th style={s.th}>{L2('Host','负责人')}</th>
                      <th style={s.th}>WhatsApp</th>
                      <th style={s.th}>{L2('Valid Bet (RM)','有效投注 (RM)')}</th>
                      <th style={s.th}>{L2('Deposit (RM)','存款 (RM)')}</th>
                      <th style={s.th}>{L2('Progress (Min Bet)','进度（最低投注）')}</th>
                      <th style={s.th}>{L2('Gap to Rank #','距离第 ')}{topN}{L2('',' 名差距')}</th>
                      <th style={s.th}>{L2('Reward','奖励')}</th>
                      <th style={s.th}>{L2('Contact','联系')}</th>
                      <th style={s.th}>{L2('Priority','优先级')}</th>
                      <th style={s.th}>✕</th>
                    </tr></thead>
                    <tbody>
                      {filteredChaseList.length === 0
                        ? <tr><td colSpan={12} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>{chaseList.length === 0 ? L2('Add players above to start tracking.','请在上方添加玩家以开始追踪。') : L2('No players match the search.','没有符合搜索的玩家。')}</td></tr>
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
                                    <button title={L2('Copy username','复制用户名')} onClick={()=>copyUsername(p.id, p.username)} style={{ marginLeft:2, background:'none', border:'none', cursor:'pointer', fontSize:11, color: copiedId===p.id ? '#3fb950' : 'var(--muted)', padding:'1px 4px', borderRadius:4 }}>{copiedId===p.id ? '✓' : '⎘'}</button>
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
                                    ? <span style={{ color:'#3fb950', fontWeight:700 }}>🏆 {L2('In Top','位于前')} {topN}{L2('',' 名')}</span>
                                    : gap!=null
                                      ? <span style={{ color:'#f85149' }}>{L2('short','差')} {rmFmt(gap, campCurrency)}<br/><span style={{ color:'var(--muted)', fontSize:10 }}>{L2('vs','对比')} {chaseList[topN-1]?.username}</span></span>
                                      : <span style={{ color:'var(--muted)' }}>—</span>}
                                </td>
                                <td style={{ ...s.td, color: p._inTop ? '#a78bfa' : 'var(--muted)', fontWeight: p._inTop ? 700 : 400, fontSize:12 }}>
                                  {p._inTop ? rewardFmt(p._reward, campCurrency) : '—'}
                                </td>
                                <td style={s.td}><CampaignWaButton p={p} extra={{ vb: p._vb, inTop: p._inTop, reward: p._reward, gap }} /></td>
                                <td style={s.td}><span style={{ ...s.tag(pr.color, pr.bg), fontSize:10 }}>{prLabel(pr.label)}</span></td>
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
                      <th style={{ ...s.th, width:32 }}>
                        <input type="checkbox" title={L2('Select all','全选')}
                          checked={filteredChaseList.length > 0 && filteredChaseList.every(p => selectedForRemoval.has(p.id))}
                          onChange={e => {
                            setSelectedForRemoval(prev => {
                              const s = new Set(prev)
                              if (e.target.checked) filteredChaseList.forEach(p => s.add(p.id))
                              else filteredChaseList.forEach(p => s.delete(p.id))
                              return s
                            })
                          }}
                          style={{ accentColor:'var(--accent)', cursor:'pointer' }} />
                      </th>
                      <th style={s.th}>#</th>
                      <th style={s.th}>{L2('Player','玩家')}</th>
                      <th style={s.th}>{L2('Host','负责人')}</th>
                      <th style={s.th}>WhatsApp</th>
                      <th style={s.th}>{campType==='dual_tier' ? L2('Deposit / Turnover (RM)','存款 / 流水 (RM)') : L2('Campaign Deposit (RM)','活动存款 (RM)')}</th>
                      <th style={s.th}>{L2('Progress','进度')}</th>
                      <th style={s.th}>{L2('Reward','奖励')}</th>
                      <th style={s.th}>{L2('Last Contact','最后联系')}</th>
                      <th style={s.th}>{L2('Priority','优先级')}</th>
                      <th style={s.th}>✕</th>
                    </tr></thead>
                    <tbody>
                      {chaseList.length === 0
                        ? <tr><td colSpan={11} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>{L2('Add players above to start tracking.','请在上方添加玩家以开始追踪。')}</td></tr>
                        : filteredChaseList.length === 0
                        ? <tr><td colSpan={11} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>{L2('No players match the search.','没有符合搜索的玩家。')}</td></tr>
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
                              if (allDone) pr = { pct:100, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:L2('✅ ALL LEVELS','✅ 全部级别') }
                              else if (nextLvl) pr = getProgress(dep, parseFloat(nextLvl.deposit_threshold)||0)
                              else pr = { pct:0, color:'#8b949e', bg:'rgba(139,148,158,.15)', label:L2('IN PROGRESS','进行中') }
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
                                  pr = { pct, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:L2(`✅ Tier ${dualReward.tierIndex+1} Achieved`, `✅ 等级 ${dualReward.tierIndex+1} 已达标`) }
                                } else {
                                  pr = { pct:100, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:L2(`✅ Tier ${dualReward.tierIndex+1} (Highest)`, `✅ 等级 ${dualReward.tierIndex+1}（最高）`) }
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
                                <td style={{ ...s.td, width:32 }} onClick={e=>e.stopPropagation()}>
                                  <input type="checkbox" checked={selectedForRemoval.has(p.id)}
                                    onChange={e=>{ setSelectedForRemoval(prev=>{const s=new Set(prev); e.target.checked?s.add(p.id):s.delete(p.id); return s}) }}
                                    style={{ accentColor:'var(--accent)', cursor:'pointer' }} />
                                </td>
                                <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                                <td style={{ ...s.td, fontWeight:700 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                                    <span style={{ cursor:'pointer' }} onClick={()=>{if(p.vip_id){closeModal();navigate(`/vips/${p.vip_id}`)}}}>
                                      {p.username}
                                    </span>
                                    {p.tier && <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)', fontSize:10 }}>{p.tier}</span>}
                                    <button title={L2('Copy username','复制用户名')} onClick={()=>copyUsername(p.id, p.username)} style={{ marginLeft:2, background:'none', border:'none', cursor:'pointer', fontSize:11, color: copiedId===p.id ? '#3fb950' : 'var(--muted)', padding:'1px 4px', borderRadius:4 }}>
                                      {copiedId===p.id ? '✓' : '⎘'}
                                    </button>
                                  </div>
                                  {selected?.streak_enabled && (
                                    <div style={{ marginTop:4, display:'flex', gap:4, flexWrap:'wrap' }}>
                                      {playerStreaks.length === 0
                                        ? <span style={{ fontSize:10, background:'rgba(255,165,0,.1)', color:'#f59e0b', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥 {L2('Streak ON','连续奖励开启')}</span>
                                        : <>
                                            {paidStreaks.length > 0 && <span style={{ fontSize:10, background:'rgba(63,185,80,.15)', color:'#3fb950', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥×{paidStreaks.length} {L2('paid','已派')}</span>}
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
                                        style={{ ...s.smInput, width:110, display:'block', marginBottom:4 }} placeholder={L2('Deposit','存款')} disabled={dailyLoading} />
                                      <input type="number" key={`${p.id}-${entryDate}-to`} defaultValue={dailyEntry?.turnover_amount || ''}
                                        onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==(dailyEntry?.turnover_amount||0)) saveDailyEntry(p.id, dailyEntry?.deposit_amount||0, v) }}
                                        style={{ ...s.smInput, width:110 }} placeholder={L2('Turnover','流水')} disabled={dailyLoading} />
                                    </>
                                  ) : <>
                                    <input type="number" defaultValue={playerDeposit(p)||''}
                                      onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==playerDeposit(p)) updatePlayer(p.id,{total_deposit:v, converted: campType==='dual_tier' ? calcDualTierReward(v,p.valid_bet,rewardTiers).tierIndex>=0 : v>=depTarget}) }}
                                      style={{ ...s.smInput, width:110 }} placeholder={campType==='dual_tier' ? L2('Deposit','存款') : undefined} />
                                    {campType==='dual_tier' && (
                                      <input type="number" defaultValue={p.valid_bet||''}
                                        onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==(p.valid_bet||0)) updatePlayer(p.id,{valid_bet:v, converted: calcDualTierReward(playerDeposit(p),v,rewardTiers).tierIndex>=0}) }}
                                        style={{ ...s.smInput, width:110, marginTop:4 }} placeholder={L2('Turnover','流水')} />
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
                                          return nextLvl ? `${L2('Next','下一级')}: ${nextLvl.level_name || (L2('Level ','级别 ')+nextLvl.level_order)} · ${L2('','还差 ')}${rmFmt(Math.max(0, Number(nextLvl.deposit_threshold)-dep), campCurrency)}${L2(' more','')}` : dep > 0 ? L2('All levels unlocked today','今日已解锁所有级别') : '—'
                                        })()
                                      : (multiMetric?.allCompleted ? L2('All campaign levels unlocked','已解锁所有活动级别') : multiMetric?.nextLevel ? `${L2('Next','下一级')}: ${multiMetric.nextLevel.level_name} · ${L2('','还差 ')}${rmFmt(Math.max(0, Number(multiMetric.nextLevel.deposit_threshold)-playerDeposit(p)), campCurrency)}${L2(' more','')}` : '—')
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
                                            if (dailyEntry?.tier_achieved == null) return L2('No level yet','尚未达到级别')
                                            const lvl = campaignLevels.find(l => l.level_order === dailyEntry.tier_achieved)
                                            return lvl ? `${lvl.level_name || (L2('Level ','级别 ')+lvl.level_order)} ${L2('achieved','已达标')}` : `${L2('Level','级别')} ${dailyEntry.tier_achieved} ${L2('achieved','已达标')}`
                                          })()}
                                        </span>
                                      </span>
                                    ) : (
                                      <span>{rmFmt(reward, campCurrency)} {L2('total','合计')}<br /><span style={{ fontSize:10, color:'var(--muted)' }}>{multiMetric?.completedCount || 0}/{campaignLevels.length} {L2('levels unlocked','级已解锁')}</span></span>
                                    )
                                  ) : !qualified ? '—' : campType==='dual_tier'
                                      ? <span>{rmFmt(dualReward.creditAmount, campCurrency)} Credit<br/><span style={{fontSize:10,color:'var(--muted)'}}>+ {rmFmt(dualReward.wcashAmount, campCurrency)} WCash</span></span>
                                      : rmFmt(reward, campCurrency)}
                                </td>
                                <td style={{ ...s.td, minWidth:110 }} onClick={e=>e.stopPropagation()}>
                                  {(() => {
                                    const playerContacts = contacts[p.id] || []
                                    const last = playerContacts[0]
                                    let badge = null
                                    if (last) {
                                      const days = Math.floor((Date.now() - new Date(last.contacted_at).getTime()) / 86400000)
                                      const col = days === 0 ? '#3fb950' : days <= 2 ? '#f59e0b' : '#f85149'
                                      badge = <div style={{ fontSize:10, color:col, fontWeight:700, marginBottom:3, cursor:'pointer' }}
                                        onClick={()=>{setContactLog(null);setContactNote('');setContactHistory(contactHistory===p.id?null:p.id)}} title={L2('View contact history','查看联系记录')}>
                                        {CT_ICON[last.contact_type]||'📞'} {days === 0 ? L2('Today','今天') : L2(`${days}d ago`, `${days} 天前`)}
                                        <span style={{ color:'var(--muted)', fontWeight:400, marginLeft:3 }}>{ctLabel(last.contact_type)}</span>
                                        {last.notes && <div style={{ color:'var(--muted)', fontWeight:400, fontSize:9, fontStyle:'italic', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>"{last.notes}"</div>}
                                      </div>
                                    } else {
                                      badge = <div style={{ fontSize:10, color:'#f85149', fontWeight:700, marginBottom:3 }}>📞 {L2('Never','从未')}</div>
                                    }
                                    return <>
                                      {badge}
                                      {contactLog === p.id ? (
                                        <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:210 }}>
                                          <div style={{ fontSize:11, color:'var(--muted)', marginBottom:5, fontWeight:600 }}>{L2('Log contact','记录联系')}</div>
                                          <textarea value={contactNote} onChange={e=>setContactNote(e.target.value)} placeholder={L2('Notes (optional)...','备注（可选）...')} rows={2}
                                            style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:5, color:'var(--text)', fontSize:11, padding:'4px 6px', resize:'none', marginBottom:5, boxSizing:'border-box' }} />
                                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:3, marginBottom:5 }}>
                                            {CONTACT_TYPES.map(([type,icon,lbl])=>(
                                              <button key={type} onClick={()=>logContact(p.id, type)}
                                                style={{ textAlign:'left', background:'none', border:'1px solid var(--border)', color:'var(--text)', borderRadius:5, padding:'3px 6px', fontSize:10, cursor:'pointer' }}>
                                                {icon} {ctLabel(type)}
                                              </button>
                                            ))}
                                          </div>
                                          <button onClick={()=>{setContactLog(null);setContactNote('')}} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer' }}>✕ {L2('Cancel','取消')}</button>
                                        </div>
                                      ) : contactHistory === p.id ? (
                                        <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:210, maxHeight:220, overflowY:'auto' }}>
                                          <div style={{ fontSize:11, color:'var(--muted)', marginBottom:5, fontWeight:600, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                            <span>📋 {p.username}</span>
                                            <button onClick={()=>setContactHistory(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer', padding:0 }}>✕</button>
                                          </div>
                                          {(contacts[p.id]||[]).slice(0,8).map((c,ci)=>{
                                            const d=Math.floor((Date.now()-new Date(c.contacted_at).getTime())/86400000)
                                            return <div key={ci} style={{ borderBottom:'1px solid var(--border)', paddingBottom:4, marginBottom:4 }}>
                                              <div style={{ fontSize:10, fontWeight:600, color:d===0?'#3fb950':d<=2?'#f59e0b':'var(--muted)' }}>
                                                {CT_ICON[c.contact_type]||'📞'} {ctLabel(c.contact_type)} · {d===0?L2('Today','今天'):L2(`${d}d ago`, `${d} 天前`)}
                                                {c.host&&<span style={{ fontWeight:400, color:'var(--muted)', marginLeft:4 }}>{c.host.split('@')[0]}</span>}
                                              </div>
                                              {c.notes&&<div style={{ fontSize:9, color:'var(--muted)', marginTop:1, fontStyle:'italic' }}>"{c.notes}"</div>}
                                            </div>
                                          })}
                                          {!(contacts[p.id]||[]).length&&<div style={{ fontSize:10, color:'var(--muted)' }}>{L2('No contacts yet.','暂无联系记录。')}</div>}
                                          <button onClick={()=>{setContactHistory(null);const waResult=buildCampaignWaMessage(p,null);setContactNote(waResult?.body||'');setContactLog(p.id)}} style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600, marginTop:2 }}>{L2('+ Log New','+ 新记录')}</button>
                                        </div>
                                      ) : (
                                        <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                                          <button onClick={()=>{setContactHistory(null);const waResult=buildCampaignWaMessage(p,null);setContactNote(waResult?.body||'');setContactLog(p.id)}}
                                            style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600 }}>
                                            + Log
                                          </button>
                                          {p.whatsapp && (() => {
                                            const chaseReward = multi
                                              ? (isDailyMode ? rmFmt(dailyEntry?.credit_reward||0, campCurrency) : rmFmt(multiMetric?.qualifiedRewardTotal||0, campCurrency))
                                              : campType==='dual_tier' ? rmFmt((dualReward?.creditAmount||0)+(dualReward?.wcashAmount||0), campCurrency)
                                              : rmFmt(calcReward(campType,playerDeposit(p),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level), campCurrency)
                                            const chaseWaMsgResult = buildCampaignWaMessage(p, null)
                                            const chaseWaUrl = chaseWaMsgResult
                                              ? waHref(p.whatsapp, encodeURIComponent(chaseWaMsgResult.body))
                                              : waHref(p.whatsapp, buildWaMsg(p.username, selected?.campaign_name||'Campaign', chaseReward, waLang, p.host_assigned||null, null, selected))
                                            const chaseTemplateTxt = chaseWaMsgResult?.body || ''
                                            return <>
                                              <a href={chaseWaUrl} target="_blank" rel="noopener noreferrer"
                                                style={{ background:'rgba(37,211,102,.1)', color:'#25d366', border:'1px solid rgba(37,211,102,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600, textDecoration:'none' }}>
                                                📱 WA
                                              </a>
                                              <button onClick={()=>{navigator.clipboard.writeText(chaseTemplateTxt || p.whatsapp||''); const btn=document.getElementById('copy-wa-'+p.id); if(btn){btn.textContent='✓';setTimeout(()=>{btn.textContent=L2('Copy','复制')},1200)}}}
                                                id={'copy-wa-'+p.id}
                                                style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600 }}>
                                                {L2('Copy','复制')}
                                              </button>
                                            </>
                                          })()}
                                        </div>
                                      )}
                                    </>
                                  })()}
                                </td>
                                <td style={s.td}><span style={{ ...s.tag(pr.color, pr.bg), fontSize:10 }}>{prLabel(pr.label)}</span></td>
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
                <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(63,185,80,.04)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  {selected?.is_multi_level ? (selected?.payout_mode === 'highest_only' ? L2('Payout mode: Highest level only — one reward per player. Mark paid only after it is actually issued.','派彩模式：只派最高级别 — 每位玩家一份奖励。确实发放后才标记为已派。') : L2('Payout mode: All levels — each unlocked level earns its own reward. Mark the individual reward paid only after it is actually issued.','派彩模式：所有级别 — 每个已解锁级别各自获得奖励。确实发放后才将该奖励标记为已派。')) : isDailyMode ? <><span>{L2('Showing players who qualified on','显示以下日期达标的玩家')}</span><input type="date" value={entryDate} min={selected?.start_date||undefined} max={selected?.end_date||undefined} onChange={e=>setEntryDate(e.target.value)} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'3px 8px', fontSize:11, color:'#c9a961', fontWeight:700, cursor:'pointer' }} /></> : L2('Only showing players who reached the campaign target.','只显示已达到活动目标的玩家。')}
                </div>
                {selected?.is_multi_level && !isDailyMode ? (
                  multiPayoutRows.length === 0 ? <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>{L2('No unlocked rewards are ready for payout yet.','暂无可派彩的已解锁奖励。')}</div> : (
                    <table style={s.tbl}>
                      <thead><tr><th style={s.th}>#</th><th style={s.th}>{L2('Player','玩家')}</th><th style={s.th}>{L2('Tier','等级')}</th><th style={s.th}>{L2('Level','级别')}</th><th style={s.th}>{L2('Campaign Deposit','活动存款')}</th><th style={s.th}>{L2('Reward','奖励')}</th><th style={s.th}>{L2('Payout Status','派彩状态')}</th><th style={s.th}>{L2('Paid At','派发时间')}</th><th style={s.th}>{L2('Phone / WA','电话 / WA')}</th><th style={s.th}>{L2('Notes','备注')}</th></tr></thead>
                      <tbody>
                        {multiPayoutRows.map((row,i)=>{
                          const paid = row.status === 'paid'
                          const payoutLabel = paid ? L2('✅ Paid','✅ 已派') : row.status === 'approved' ? L2('🟦 Approved','🟦 已批准') : L2('⏳ Pending','⏳ 待处理')
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
                            <td style={s.td}><button onClick={()=>{const newTotal=multiPayoutRows.filter(r=>r.playerId===row.playerId).filter(r=>r.rewardId===row.rewardId?!paid:r.status==='paid').reduce((s,r)=>s+r.rewardAmount,0);toggleCampaignReward(row.rewardId,!paid,row.playerId,newTotal)}} style={{ ...s.tag(paid?'#3fb950':'#f59e0b',paid?'rgba(63,185,80,.15)':'rgba(245,158,11,.15)'),cursor:'pointer',border:`1px solid ${paid?'rgba(63,185,80,.3)':'rgba(245,158,11,.3)'}` }}>{payoutLabel}</button></td>
                            <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{row.paidAt ? new Date(row.paidAt).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
                            <td style={{...s.td,minWidth:130}}>
                              <div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>{player?.whatsapp||'—'}</div>
                              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                                {waUrl && <a href={waUrl} target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:4, background:'rgba(37,211,102,.15)', color:'#25d366', border:'1px solid rgba(37,211,102,.3)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, textDecoration:'none' }}>📲 WA</a>}
                                <button onClick={()=>navigator.clipboard.writeText(waMultiText).catch(()=>{})} style={{ background:'rgba(88,166,255,.12)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.3)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, cursor:'pointer' }}>📋 {L2('Copy','复制')}</button>
                                {!waUrl && <span style={{fontSize:10,color:'var(--muted)'}}>{L2('No number','无号码')}</span>}
                              </div>
                            </td>
                            <td style={s.td}><input defaultValue={note} onBlur={async e=>{const v=e.target.value;if(v!==note){const {error}=await supabase.from('campaign_rewards').update({notes:v}).eq('id',row.rewardId);if(error)console.error(error)}}} style={{ ...s.editInput,width:140 }} placeholder={L2('Add note...','添加备注...')} /></td>
                          </tr>
                        })}
                        <tr style={{ background:'var(--surface2)',fontWeight:700 }}><td colSpan={5} style={s.td}>{L2('Total unlocked rewards','已解锁奖励合计')}</td><td style={{ ...s.td,color:typeInfo.color,fontWeight:800 }}>{rewardFmt(totalReward,campCurrency)} Credit</td><td style={s.td}><span style={{color:'#3fb950'}}>{rewardFmt(paidOut,campCurrency)} {L2('paid','已派')}</span><span style={{color:'#f85149',marginLeft:8}}>{rewardFmt(pendingPay,campCurrency)} {L2('pending','待处理')}</span></td><td colSpan={3} style={s.td}/></tr>
                      </tbody>
                    </table>
                  )
                ) : (isDailyMode ? dailyAchieved : achieved).length === 0 ? (
                  <div style={{ padding:32,textAlign:'center',color:'var(--muted)' }}>{isDailyMode?L2('No players qualified on this date yet.','此日期尚无玩家达标。'):L2('No players have reached the target yet.','尚无玩家达到目标。')}</div>
                ) : (
                  <>
                  {/* Payout host filter */}
                  {chaseHosts.length > 1 && (
                    <div style={{ padding:'6px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span style={{ fontSize:11, color:'var(--muted)', fontWeight:600 }}>{L2('Host:','负责人：')}</span>
                      {chaseHosts.map(h => (
                        <button key={h} onClick={()=>setPayoutHostFilter(h)}
                          style={{ padding:'3px 10px', borderRadius:14, fontSize:11, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                            background: payoutHostFilter===h ? 'var(--accent)' : 'var(--surface2)',
                            color: payoutHostFilter===h ? '#fff' : 'var(--muted)' }}>
                          {h === 'all' ? L2('🌐 All','🌐 全部') : h}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Payout search + sort controls */}
                  <div style={{ padding:'8px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <input value={payoutSearch} onChange={e=>setPayoutSearch(e.target.value)}
                      placeholder={L2(`🔍 Search ${filteredPayoutList.length} players…`, `🔍 搜索 ${filteredPayoutList.length} 位玩家…`)}
                      style={{ ...s.smInput, width:220, fontSize:12 }} />
                    {payoutSearch && <button onClick={()=>setPayoutSearch('')} style={{ fontSize:11, color:'var(--muted)', background:'none', border:'none', cursor:'pointer', padding:'2px 6px' }}>✕</button>}
                    <span style={{ fontSize:11, color:'var(--muted)', marginLeft:4 }}>{L2('Sort:','排序：')}</span>
                    {[['deposit',L2('Deposit','存款')],['reward',L2('Reward','奖励')],['name',L2('Name','名称')]].map(([key,lbl])=>(
                      <button key={key} onClick={()=>{ if(payoutSort===key){setPayoutSortDir(d=>d==='asc'?'desc':'asc')}else{setPayoutSort(key);setPayoutSortDir('desc')} }}
                        style={{ padding:'3px 10px', borderRadius:14, fontSize:11, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                          background: payoutSort===key ? 'var(--accent)' : 'var(--surface2)', color: payoutSort===key ? '#fff' : 'var(--muted)' }}>
                        {lbl} {payoutSort===key ? (payoutSortDir==='asc' ? '↑' : '↓') : ''}
                      </button>
                    ))}
                    <span style={{ fontSize:11, color:'var(--muted)', marginLeft:8 }}>{L2('WA Lang:','WA 语言：')}</span>
                    {[['en','EN'],['my','MY'],['cn','中文']].map(([key,lbl])=>(
                      <button key={key} onClick={()=>setWaLang(key)}
                        style={{ padding:'3px 10px', borderRadius:14, fontSize:11, fontWeight:700, border:'1px solid var(--border)', cursor:'pointer',
                          background: waLang===key ? '#25d366' : 'var(--surface2)', color: waLang===key ? '#fff' : 'var(--muted)' }}>
                        {lbl}
                      </button>
                    ))}
                    <span style={{ marginLeft:'auto', fontSize:11, color:'var(--muted)' }}>{L2(`${filteredPayoutList.length} of ${(isDailyMode?dailyAchieved:achieved).length} players`, `${filteredPayoutList.length} / ${(isDailyMode?dailyAchieved:achieved).length} 位玩家`)}</span>
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
                        alert(L2('Export failed: ','导出失败：') + err.message)
                      }
                    }} style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'4px 12px', borderRadius:6, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>
                      ⬇ {L2('Export','导出')}
                    </button>
                  </div>
                  <table style={s.tbl}>
                    <thead><tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>{L2('Player','玩家')}</th>
                      <th style={s.th}>{isDailyMode&&selected?.is_multi_level ? L2('Level','级别') : L2('Tier','等级')}</th>
                      <th style={s.th}>{isDailyMode&&campType==='dual_tier'&&!selected?.is_multi_level?L2('Deposit / Turnover (this date)','存款 / 流水（当日）'):isDailyMode?L2('Deposit (this date)','存款（当日）'):L2('Deposit','存款')}</th>
                      <th style={s.th}>{L2('Reward','奖励')}</th>
                      <th style={s.th}>{L2('Payout Status','派彩状态')}</th>
                      <th style={s.th}>{L2('Last Contact','最后联系')}</th>
                      <th style={s.th}>{L2('Host','负责人')}</th>
                      <th style={s.th}>{L2('Phone / WA','电话 / WA')}</th>
                      <th style={s.th}>{L2('Notes','备注')}</th>
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
                            ? <span>{rmFmt(entry?.deposit_amount||0,campCurrency)}<br/><span style={{fontSize:10,color:'var(--muted)'}}>{rmFmt(entry?.turnover_amount||0,campCurrency)} {L2('TO','流水')}</span></span>
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
                          <button onClick={()=> isDailyMode ? updateDailyPayout(p.id, paid?'pending':'paid') : updatePlayer(p.id,{payout_status:paid?'pending':'paid',payout_date:paid?null:new Date().toISOString(),reward_amount:paid?0:creditReward+wcashReward})} style={{...s.tag(paid?'#3fb950':'#f59e0b',paid?'rgba(63,185,80,.15)':'rgba(245,158,11,.15)'),cursor:'pointer'}}>{paid?L2('✅ Paid','✅ 已派'):L2('⏳ Pending','⏳ 待处理')}</button>
                          {selected?.streak_enabled && pendingStreakBonus > 0 && (
                            <div style={{ marginTop:3, fontSize:10, color:'#f59e0b', fontWeight:700, whiteSpace:'nowrap' }}>🔥 +{rmFmt(pendingStreakBonus, campCurrency)} {L2('streak','连续奖励')}</div>
                          )}
                        </td>
                        <td style={{ ...s.td, minWidth:110 }} onClick={e=>e.stopPropagation()}>
                          {(() => {
                            const playerContacts = contacts[p.id] || []
                            const last = playerContacts[0]
                            let badge = null
                            if (last) {
                              const days = Math.floor((Date.now() - new Date(last.contacted_at).getTime()) / 86400000)
                              const col = days === 0 ? '#3fb950' : days <= 2 ? '#f59e0b' : '#f85149'
                              badge = <div style={{ fontSize:10, color:col, fontWeight:700, marginBottom:3, cursor:'pointer' }}
                                onClick={()=>{setContactLog(null);setContactNote('');setContactHistory(contactHistory===p.id?null:p.id)}} title={L2('View contact history','查看联系记录')}>
                                {CT_ICON[last.contact_type]||'📞'} {days === 0 ? L2('Today','今天') : L2(`${days}d ago`, `${days} 天前`)}
                                <span style={{ color:'var(--muted)', fontWeight:400, marginLeft:3 }}>{ctLabel(last.contact_type)}</span>
                                {last.notes && <div style={{ color:'var(--muted)', fontWeight:400, fontSize:9, fontStyle:'italic', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>"{last.notes}"</div>}
                              </div>
                            } else {
                              badge = <div style={{ fontSize:10, color:'#f85149', fontWeight:700, marginBottom:3 }}>📞 {L2('Never','从未')}</div>
                            }
                            return <>
                              {badge}
                              {contactLog === p.id ? (
                                <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:210 }}>
                                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:5, fontWeight:600 }}>{L2('Log contact','记录联系')}</div>
                                  <textarea value={contactNote} onChange={e=>setContactNote(e.target.value)} placeholder={L2('Notes (optional)...','备注（可选）...')} rows={2}
                                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:5, color:'var(--text)', fontSize:11, padding:'4px 6px', resize:'none', marginBottom:5, boxSizing:'border-box' }} />
                                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:3, marginBottom:5 }}>
                                    {CONTACT_TYPES.map(([type,icon,lbl])=>(
                                      <button key={type} onClick={()=>logContact(p.id, type)}
                                        style={{ textAlign:'left', background:'none', border:'1px solid var(--border)', color:'var(--text)', borderRadius:5, padding:'3px 6px', fontSize:10, cursor:'pointer' }}>
                                        {icon} {ctLabel(type)}
                                      </button>
                                    ))}
                                  </div>
                                  <button onClick={()=>{setContactLog(null);setContactNote('')}} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer' }}>✕ {L2('Cancel','取消')}</button>
                                </div>
                              ) : contactHistory === p.id ? (
                                <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:210, maxHeight:220, overflowY:'auto' }}>
                                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:5, fontWeight:600, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                    <span>📋 {p.username}</span>
                                    <button onClick={()=>setContactHistory(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer', padding:0 }}>✕</button>
                                  </div>
                                  {(contacts[p.id]||[]).slice(0,8).map((c,ci)=>{
                                    const d=Math.floor((Date.now()-new Date(c.contacted_at).getTime())/86400000)
                                    return <div key={ci} style={{ borderBottom:'1px solid var(--border)', paddingBottom:4, marginBottom:4 }}>
                                      <div style={{ fontSize:10, fontWeight:600, color:d===0?'#3fb950':d<=2?'#f59e0b':'var(--muted)' }}>
                                        {CT_ICON[c.contact_type]||'📞'} {ctLabel(c.contact_type)} · {d===0?L2('Today','今天'):L2(`${d}d ago`, `${d} 天前`)}
                                        {c.host&&<span style={{ fontWeight:400, color:'var(--muted)', marginLeft:4 }}>{c.host.split('@')[0]}</span>}
                                      </div>
                                      {c.notes&&<div style={{ fontSize:9, color:'var(--muted)', marginTop:1, fontStyle:'italic' }}>"{c.notes}"</div>}
                                    </div>
                                  })}
                                  {!(contacts[p.id]||[]).length&&<div style={{ fontSize:10, color:'var(--muted)' }}>{L2('No contacts yet.','暂无联系记录。')}</div>}
                                  <button onClick={()=>{setContactHistory(null);setContactLog(p.id)}} style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600, marginTop:2 }}>{L2('+ Log New','+ 新记录')}</button>
                                </div>
                              ) : (
                                <button onClick={()=>{setContactHistory(null);setContactNote('');setContactLog(p.id)}}
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
                            <button onClick={()=>navigator.clipboard.writeText(waMsgText).catch(()=>{})} style={{ background:'rgba(88,166,255,.12)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.3)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:700, cursor:'pointer' }}>📋 {L2('Copy','复制')}</button>
                            {!waUrl && <span style={{fontSize:10,color:'var(--muted)'}}>{L2('No number','无号码')}</span>}
                          </div>
                        </td>
                        <td style={s.td}><input defaultValue={p.notes||''} onBlur={e=>{if(e.target.value!==(p.notes||''))updatePlayer(p.id,{notes:e.target.value})}} style={{...s.editInput,width:140}} placeholder={L2('Add note...','添加备注...')}/></td>
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
                          <td colSpan={2} style={{ ...s.td, color:'var(--muted)', fontSize:12 }}>{L2(`Total (${filteredPayoutList.length} players · ${paidCount} paid)`, `合计（${filteredPayoutList.length} 位玩家 · ${paidCount} 已派）`)}</td>
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
                        <span style={{ fontSize:13, fontWeight:800 }}>{L2('🔥 Streak Bonuses','🔥 连续奖励')}</span>
                        <span style={{ fontSize:11, background:'rgba(245,158,11,.15)', color:'#f59e0b', borderRadius:4, padding:'1px 8px', fontWeight:600 }}>{L2('Enabled','已启用')}</span>
                      </div>
                      <div style={{ fontSize:12, color:'var(--muted)' }}>{L2(`No streak bonuses awarded yet. Bonuses are triggered automatically after ${selected.streak_days} consecutive qualifying days.`, `尚未发放连续奖励。连续达标 ${selected.streak_days} 天后将自动触发奖金。`)}</div>
                    </div>
                  )
                  return (
                    <div style={{ borderTop:'2px solid var(--border)', marginTop:8 }}>
                      <div style={{ padding:'10px 24px', display:'flex', alignItems:'center', gap:10, background:'rgba(245,158,11,.04)' }}>
                        <span style={{ fontSize:13, fontWeight:800 }}>{L2('🔥 Streak Bonuses','🔥 连续奖励')}</span>
                        {streakBonusesLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>{L2('Loading…','加载中…')}</span>}
                        {!streakBonusesLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>{allStreakRows.length} {L2('bonus'+(allStreakRows.length !== 1 ? 'es' : ''),'笔奖金')} · {allStreakRows.filter(r=>r.payout_status==='paid').length} {L2('paid','已派')} · {bonusFmt(allStreakRows.filter(r=>r.payout_status!=="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} {L2('pending','待处理')}</span>}
                        <button onClick={()=>loadStreakBonuses(selected.id)} style={{ marginLeft:'auto', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer' }}>{L2('↺ Refresh','↺ 刷新')}</button>
                      </div>
                      {allStreakRows.length > 0 && (
                        <table style={s.tbl}>
                          <thead><tr>
                            <th style={s.th}>#</th>
                            <th style={s.th}>{L2('Player','玩家')}</th>
                            <th style={s.th}>{L2('Streak','连续奖励')}</th>
                            <th style={s.th}>{L2('Period','期间')}</th>
                            <th style={s.th}>{L2('Period Deposit','期间存款')}</th>
                            <th style={s.th}>{L2('Bonus','奖金')}</th>
                            <th style={s.th}>{L2('Pay Date','派发日期')}</th>
                            <th style={s.th}>{L2('Status','状态')}</th>
                            <th style={s.th}>{L2('Notes','备注')}</th>
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
                                      {paid ? L2('✅ Paid','✅ 已派') : L2('⏳ Pending','⏳ 待处理')}
                                    </button>
                                  </td>
                                  <td style={s.td}>
                                    <input defaultValue={sb.notes||''} onBlur={async e => { const v=e.target.value; if(v!==(sb.notes||'')) { await supabase.from('campaign_streak_bonuses').update({notes:v}).eq('id',sb.id); await loadStreakBonuses(selected.id) }}} style={{ ...s.editInput, width:140 }} placeholder={L2('Add note…','添加备注…')} />
                                  </td>
                                </tr>
                              )
                            })}
                            <tr style={{ background:'var(--surface2)', fontWeight:700 }}>
                              <td colSpan={5} style={s.td}>{L2('Total streak bonuses','连续奖励合计')}</td>
                              <td style={{ ...s.td, color:'#f59e0b', fontWeight:800 }}>{bonusFmt(allStreakRows.reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)}</td>
                              <td style={s.td} />
                              <td style={s.td}><span style={{color:'#3fb950'}}>{bonusFmt(allStreakRows.filter(r=>r.payout_status==="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} {L2('paid','已派')}</span><span style={{color:'#f85149',marginLeft:8}}>{bonusFmt(allStreakRows.filter(r=>r.payout_status!=="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} {L2('pending','待处理')}</span></td>
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
              const inactiveFiltered = inactiveHostFilter === 'all' ? allInactivePlayers : allInactivePlayers.filter(p => p.host_assigned === inactiveHostFilter)
              const inactiveSmDir = inactiveSortDir === 'asc' ? 1 : -1
              const inactivePlayers = [...inactiveFiltered].sort((a, b) => {
                if (inactiveSort === 'days') {
                  const dA = a.added_at ? Math.floor((Date.now() - new Date(a.added_at).getTime()) / 86400000) : 0
                  const dB = b.added_at ? Math.floor((Date.now() - new Date(b.added_at).getTime()) / 86400000) : 0
                  return inactiveSmDir * (dA - dB)
                }
                if (inactiveSort === 'entries') {
                  const eA = allDailyEntries.filter(e => e.player_id === a.id).length
                  const eB = allDailyEntries.filter(e => e.player_id === b.id).length
                  return inactiveSmDir * (eA - eB)
                }
                return inactiveSmDir * (a.username||'').localeCompare(b.username||'')
              })
              return (
                <div style={{ overflowX:'auto' }}>
                  <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(88,166,255,.04)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <span>{L2('😴 Players enrolled but never qualified for a reward across the entire campaign period','😴 已加入但整个活动期间从未达标的玩家')}</span>
                    {allDailyEntriesLoading && <span style={{ color:'#f59e0b' }}>{L2('Loading…','加载中…')}</span>}
                    <span style={{ color:'var(--muted)', marginLeft:4 }}>{L2('Sort:','排序：')}</span>
                    {[['days',L2('Days in Campaign','活动天数')],['entries',L2('Entries','记录数')],['name',L2('Name','名称')]].map(([key,lbl])=>(
                      <button key={key} onClick={()=>{ if(inactiveSort===key){setInactiveSortDir(d=>d==='asc'?'desc':'asc')}else{setInactiveSort(key);setInactiveSortDir('desc')} }}
                        style={{ padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:600, border:'1px solid var(--border)', cursor:'pointer',
                          background: inactiveSort===key ? 'var(--accent)' : 'var(--surface2)', color: inactiveSort===key ? '#fff' : 'var(--muted)' }}>
                        {lbl} {inactiveSort===key ? (inactiveSortDir==='asc' ? '↑' : '↓') : ''}
                      </button>
                    ))}
                    <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
                      <button onClick={() => exportInactiveToExcel(inactivePlayers)} disabled={inactivePlayers.length === 0 || allDailyEntriesLoading}
                        style={{ background:'#166534', border:'1px solid #16a34a', color:'#4ade80', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer', fontWeight:600, opacity: inactivePlayers.length === 0 ? 0.5 : 1 }}>
                        ⬇ {L2('Export Excel','导出 Excel')}
                      </button>
                      <button onClick={() => loadAllDailyEntries(selected.id)} style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer' }}>{L2('↺ Refresh','↺ 刷新')}</button>
                    </div>
                  </div>
                  {/* Inactive tab host filter */}
                  {inactiveHosts.length > 1 && (
                    <div style={{ padding:'6px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span style={{ fontSize:11, color:'var(--muted)', marginRight:2 }}>{L2('Host:','负责人：')}</span>
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
                    <div style={{ padding:'32px 24px', textAlign:'center', color:'var(--muted)', fontSize:13 }}>{L2('🎉 All enrolled players have qualified at least once!','🎉 所有已加入的玩家都至少达标过一次！')}</div>
                  )}
                  {inactivePlayers.length > 0 && (
                    <table style={s.tbl}>
                      <thead><tr>
                        <th style={s.th}>#</th>
                        <th style={s.th}>{L2('Player','玩家')}</th>
                        <th style={s.th}>{L2('Tier','等级')}</th>
                        <th style={s.th}>{L2('Host','负责人')}</th>
                        <th style={s.th}>WhatsApp</th>
                        <th style={s.th}>{L2('Last Contact','最后联系')}</th>
                        <th style={s.th}>{L2('Enrolled','加入日期')}</th>
                        <th style={s.th}>{L2('Days in Campaign','活动天数')}</th>
                      </tr></thead>
                      <tbody>
                        {inactivePlayers.map((p, i) => {
                          const enrolledDate = p.added_at ? new Date(p.added_at).toLocaleDateString('en-MY', { day:'numeric', month:'short' }) : '—'
                          // how many days this player has any entry (even non-qualifying)
                          const playerEntryDates = allDailyEntries.filter(e => e.player_id === p.id)
                          const playerContacts = contacts[p.id] || []
                          const lastContact = playerContacts[0]
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
                                    badge = <div style={{ fontSize:10, color:col, fontWeight:700, marginBottom:3, cursor:'pointer' }}
                                      onClick={()=>{setContactLog(null);setContactNote('');setContactHistory(contactHistory===p.id?null:p.id)}} title={L2('View contact history','查看联系记录')}>
                                      {CT_ICON[lastContact.contact_type]||'📞'} {days === 0 ? L2('Today','今天') : L2(`${days}d ago`, `${days} 天前`)}
                                      <span style={{ color:'var(--muted)', fontWeight:400, marginLeft:3 }}>{ctLabel(lastContact.contact_type)}</span>
                                      {lastContact.notes && <div style={{ color:'var(--muted)', fontWeight:400, fontSize:9, fontStyle:'italic', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>"{lastContact.notes}"</div>}
                                    </div>
                                  } else {
                                    badge = <div style={{ fontSize:10, color:'#f85149', fontWeight:700, marginBottom:3 }}>📞 {L2('Never','从未')}</div>
                                  }
                                  return <>
                                    {badge}
                                    {contactLog === p.id ? (
                                      <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:210 }}>
                                        <div style={{ fontSize:11, color:'var(--muted)', marginBottom:5, fontWeight:600 }}>{L2('Log contact','记录联系')}</div>
                                        <textarea value={contactNote} onChange={e=>setContactNote(e.target.value)} placeholder={L2('Notes (optional)...','备注（可选）...')} rows={2}
                                          style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:5, color:'var(--text)', fontSize:11, padding:'4px 6px', resize:'none', marginBottom:5, boxSizing:'border-box' }} />
                                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:3, marginBottom:5 }}>
                                          {CONTACT_TYPES.map(([type,icon,lbl])=>(
                                            <button key={type} onClick={()=>logContact(p.id, type)}
                                              style={{ textAlign:'left', background:'none', border:'1px solid var(--border)', color:'var(--text)', borderRadius:5, padding:'3px 6px', fontSize:10, cursor:'pointer' }}>
                                              {icon} {ctLabel(type)}
                                            </button>
                                          ))}
                                        </div>
                                        <button onClick={()=>{setContactLog(null);setContactNote('')}} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer' }}>✕ {L2('Cancel','取消')}</button>
                                      </div>
                                    ) : contactHistory === p.id ? (
                                      <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:8, minWidth:210, maxHeight:220, overflowY:'auto' }}>
                                        <div style={{ fontSize:11, color:'var(--muted)', marginBottom:5, fontWeight:600, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                          <span>📋 {p.username}</span>
                                          <button onClick={()=>setContactHistory(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:10, cursor:'pointer', padding:0 }}>✕</button>
                                        </div>
                                        {(contacts[p.id]||[]).slice(0,8).map((c,ci)=>{
                                          const d=Math.floor((Date.now()-new Date(c.contacted_at).getTime())/86400000)
                                          return <div key={ci} style={{ borderBottom:'1px solid var(--border)', paddingBottom:4, marginBottom:4 }}>
                                            <div style={{ fontSize:10, fontWeight:600, color:d===0?'#3fb950':d<=2?'#f59e0b':'var(--muted)' }}>
                                              {CT_ICON[c.contact_type]||'📞'} {ctLabel(c.contact_type)} · {d===0?L2('Today','今天'):L2(`${d}d ago`, `${d} 天前`)}
                                              {c.host&&<span style={{ fontWeight:400, color:'var(--muted)', marginLeft:4 }}>{c.host.split('@')[0]}</span>}
                                            </div>
                                            {c.notes&&<div style={{ fontSize:9, color:'var(--muted)', marginTop:1, fontStyle:'italic' }}>"{c.notes}"</div>}
                                          </div>
                                        })}
                                        {!(contacts[p.id]||[]).length&&<div style={{ fontSize:10, color:'var(--muted)' }}>{L2('No contacts yet.','暂无联系记录。')}</div>}
                                        <button onClick={()=>{setContactHistory(null);setContactLog(p.id)}} style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600, marginTop:2 }}>{L2('+ Log New','+ 新记录')}</button>
                                      </div>
                                    ) : (
                                      <button onClick={()=>{setContactHistory(null);setContactNote('');setContactLog(p.id)}}
                                        style={{ background:'rgba(88,166,255,.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.25)', borderRadius:5, padding:'2px 7px', fontSize:10, cursor:'pointer', fontWeight:600 }}>
                                        + Log
                                      </button>
                                    )}
                                  </>
                                })()}
                              </td>
                              <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{enrolledDate}</td>
                              <td style={{ ...s.td, fontSize:12, color: playerEntryDates.length > 0 ? '#f59e0b' : '#f85149' }}>
                                {playerEntryDates.length > 0 ? L2(`${playerEntryDates.length} entries (0 qualifying)`, `${playerEntryDates.length} 条记录（0 达标）`) : L2('No entries at all','完全没有记录')}
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

              // Build per-player streak data from allDailyEntries
              const perPlayer = {}
              for (const e of allDailyEntries) {
                if (!perPlayer[e.player_id]) perPlayer[e.player_id] = []
                perPlayer[e.player_id].push(e)
              }

              const playerStreakRows = players.map(p => {
                // A day qualifies for streak if the player earned a reward that day (credit_reward > 0)
                const entries = (perPlayer[p.id] || []).filter(e => (parseFloat(e.credit_reward)||0) > 0)
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
                    <span>🔥 {L2('Streak target:','连续目标：')} <strong>{L2(`${streakDays} consecutive days`, `连续 ${streakDays} 天`)}</strong> · {L2('Bonus:','奖金：')} {bonusType === 'pct' ? L2(`${bonusPct}% of period deposit`, `期间存款的 ${bonusPct}%`) : L2(`RM ${bonusFixed} fixed`, `固定 RM ${bonusFixed}`)}{bonusCap > 0 ? ` (${L2('cap','上限')}: ${rmFmt(bonusCap, campCurrency)})` : ''}</span>
                    {allDailyEntriesLoading && <span style={{ color:'#f59e0b' }}>{L2('Loading…','加载中…')}</span>}
                    {!selected?.streak_enabled && <span style={{ background:'rgba(248,81,73,.15)', color:'#f85149', borderRadius:4, padding:'1px 8px', fontSize:10, fontWeight:700 }}>{L2('STREAK DISABLED','连续奖励已停用')}</span>}
                    <button onClick={async () => {
                      await loadAllDailyEntries(selected.id)
                      if (selected?.streak_enabled) {
                        const today = new Date().toISOString().slice(0, 10)
                        for (const p of players) await checkAndAwardStreak(p.id, today)
                      }
                      await loadStreakBonuses(selected.id)
                    }} style={{ marginLeft:'auto', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer' }}>{L2('↺ Refresh','↺ 刷新')}</button>
                  </div>

                  {/* Streak Bonus Payout section — shown first */}
                  <div style={{ borderBottom:'2px solid var(--border)', marginBottom:8 }}>
                    <div style={{ padding:'10px 24px', display:'flex', alignItems:'center', gap:10, background:'rgba(245,158,11,.04)' }}>
                      <span style={{ fontSize:13, fontWeight:800 }}>{L2('💸 Streak Bonus Payout','💸 连续奖励派彩')}</span>
                      {streakBonusesLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>{L2('Loading…','加载中…')}</span>}
                      {!streakBonusesLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>
                        {allStreakRows.length} {L2('bonus'+(allStreakRows.length !== 1 ? 'es' : ''),'笔奖金')} · {allStreakRows.filter(r=>r.payout_status==='paid').length} {L2('paid','已派')} · {bonusFmt(allStreakRows.filter(r=>r.payout_status!=="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} pending
                      </span>}
                      <button onClick={() => loadStreakBonuses(selected.id)} style={{ marginLeft:'auto', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--muted)', padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer' }}>{L2('↺ Refresh','↺ 刷新')}</button>
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
                          <th style={s.th}>{L2('Player','玩家')}</th>
                          <th style={s.th}>{L2('Host','负责人')}</th>
                          <th style={s.th}>{L2('Streak #','连续奖励 #')}</th>
                          <th style={s.th}>{L2('Period','期间')}</th>
                          <th style={s.th}>{L2('Period Deposit','期间存款')}</th>
                          <th style={s.th}>{L2('Bonus','奖金')}</th>
                          <th style={s.th}>{L2('Pay Date','派发日期')}</th>
                          <th style={s.th}>{L2('Status','状态')}</th>
                          <th style={s.th}>{L2('Notes','备注')}</th>
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
                                    {paid ? L2('✅ Paid','✅ 已派') : L2('⏳ Pending','⏳ 待处理')}
                                  </button>
                                </td>
                                <td style={s.td}>
                                  <input defaultValue={sb.notes||''} onBlur={async e => { const v=e.target.value; if(v!==(sb.notes||'')) { await supabase.from('campaign_streak_bonuses').update({notes:v}).eq('id',sb.id); await loadStreakBonuses(selected.id) }}} style={{ ...s.editInput, width:140 }} placeholder={L2('Add note…','添加备注…')} />
                                </td>
                              </tr>
                            )
                          })}
                          <tr style={{ background:'var(--surface2)', fontWeight:700 }}>
                            <td colSpan={6} style={s.td}>{L2('Total streak bonuses','连续奖励合计')}</td>
                            <td style={{ ...s.td, color:'#f59e0b', fontWeight:800 }}>{bonusFmt(allStreakRows.reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)}</td>
                            <td style={s.td} />
                            <td style={s.td}>
                              <span style={{color:'#3fb950'}}>{bonusFmt(allStreakRows.filter(r=>r.payout_status==="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} {L2('paid','已派')}</span>
                              <span style={{color:'#f85149',marginLeft:8}}>{bonusFmt(allStreakRows.filter(r=>r.payout_status!=="paid").reduce((s,r)=>s+(parseFloat(r.bonus_amount)||0),0), campCurrency)} {L2('pending','待处理')}</span>
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
                      <th style={s.th}>{L2('Player','玩家')}</th>
                      <th style={s.th}>{L2('Tier','等级')}</th>
                      <th style={s.th}>{L2('Host','负责人')}</th>
                      <th style={s.th}>{L2('Qualifying Days','达标天数')}</th>
                      <th style={s.th}>{L2('Max Streak','最长连续')}</th>
                      <th style={s.th}>{L2('Current Run','当前连续')}</th>
                      <th style={s.th}>{L2('Target','目标')} ({streakDays}{L2('d','天')})</th>
                      <th style={s.th}>{L2('Cap Override','上限覆盖')}</th>
                      <th style={s.th}>{L2('Est. Bonus','预估奖金')}</th>
                      <th style={s.th}>{L2('Awarded','已发放')}</th>
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
                                ? <span style={{ color:'#3fb950', fontWeight:700 }}>✅ {L2('Hit','已达成')}</span>
                                : <span style={{ color:'#f85149', fontWeight:600 }}>❌ {L2(`${streakDays - maxStreak}d short`, `差 ${streakDays - maxStreak} 天`)}</span>
                              }
                            </td>
                            <td style={{ ...s.td, fontSize:11 }}>
                              <input
                                key={p.streak_bonus_cap_override}
                                defaultValue={playerCapOverride > 0 ? playerCapOverride : ''}
                                placeholder={campaignCap > 0 ? `${campaignCap} (${L2('camp','活动')})` : L2('No cap','无上限')}
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
                                ? <span>{awardedBonuses.length} {L2('bonus'+(awardedBonuses.length>1?'es':''),'笔奖金')} · {rmFmt(awardedTotal, campCurrency)} · {awardedPaid}/{awardedBonuses.length} {L2('paid','已派')}</span>
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

            {activeTab === 'register' && (() => {
              const apSm = allPlayerSortDir === 'asc' ? 1 : -1
              const sortedAllPlayers = [...players].sort((a, b) => {
                const realA = realFinancials?.byPlayer?.[a.username]
                const realB = realFinancials?.byPlayer?.[b.username]
                const dailyA = isDailyMode ? summaryData?.playerRows?.find(r=>r.username===a.username) : null
                const dailyB = isDailyMode ? summaryData?.playerRows?.find(r=>r.username===b.username) : null
                if (allPlayerSort === 'name') return apSm * (a.username||'').localeCompare(b.username||'')
                if (allPlayerSort === 'deposit') {
                  const dA = isDailyMode ? (summaryData?.depositByPlayer?.[a.id] ?? playerDeposit(a)) : playerDeposit(a)
                  const dB = isDailyMode ? (summaryData?.depositByPlayer?.[b.id] ?? playerDeposit(b)) : playerDeposit(b)
                  return apSm * (dA - dB)
                }
                if (allPlayerSort === 'turnover') return apSm * ((realA?.validBet||0) - (realB?.validBet||0))
                if (allPlayerSort === 'withdrawal') return apSm * ((realA?.withdrawal||0) - (realB?.withdrawal||0))
                if (allPlayerSort === 'reward') {
                  const rA = isDailyMode ? ((dailyA?.credit||0)+(dailyA?.wcash||0)) : calcReward(campType,playerDeposit(a),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level)
                  const rB = isDailyMode ? ((dailyB?.credit||0)+(dailyB?.wcash||0)) : calcReward(campType,playerDeposit(b),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level)
                  return apSm * (rA - rB)
                }
                if (allPlayerSort === 'streak') {
                  const sA = (streakBonuses[a.id]||[]).length
                  const sB = (streakBonuses[b.id]||[]).length
                  return apSm * (sA - sB)
                }
                if (allPlayerSort === 'status') {
                  const stA = a.payout_status==='paid' ? 2 : playerDeposit(a)>=(depTarget||0) ? 1 : 0
                  const stB = b.payout_status==='paid' ? 2 : playerDeposit(b)>=(depTarget||0) ? 1 : 0
                  return apSm * (stA - stB)
                }
                return 0
              })
              return (
              <div style={{ overflowX:'auto' }}>
                <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(88,166,255,.04)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span>{L2('Deposit is manually tracked for reward eligibility · Turnover/Withdrawal are real platform data for the campaign period','存款为手动追踪，用于判断奖励资格 · 流水/提款为活动期间的真实平台数据')} ({fmtDate(selected.start_date)} → {fmtDate(selected.end_date)})</span>
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
                  }} style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>⬇ {L2('Export CSV','导出 CSV')}</button>
                </div>
                {selectedForRemoval.size > 0 && (
                  <div style={{ padding:'8px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8 }}>
                    <button onClick={bulkRemovePlayers}
                      style={{ background:'rgba(248,81,73,.1)', border:'1px solid rgba(248,81,73,.4)', color:'#f85149', padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                      🗑 {L2('Remove Selected','移除所选')} ({selectedForRemoval.size})
                    </button>
                    <button onClick={()=>setSelectedForRemoval(new Set())} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'5px 10px', fontSize:11, color:'var(--muted)', cursor:'pointer' }}>{L2('Clear','清除')}</button>
                  </div>
                )}
                <table style={s.tbl}>
                  <thead><tr>
                    <th style={{ ...s.th, width:32 }}>
                      <input type="checkbox" title={L2('Select all','全选')}
                        checked={players.length > 0 && players.every(p => selectedForRemoval.has(p.id))}
                        onChange={e => {
                          setSelectedForRemoval(prev => {
                            const s = new Set(prev)
                            if (e.target.checked) players.forEach(p => s.add(p.id))
                            else players.forEach(p => s.delete(p.id))
                            return s
                          })
                        }}
                        style={{ accentColor:'var(--accent)', cursor:'pointer' }} />
                    </th>
                    <th style={s.th}>#</th>
                    {[['name',L2('Username','用户名')],['deposit',L2('Deposit','存款')],['turnover',L2('Turnover (real)','流水（真实）')],['withdrawal',L2('Withdrawal (real)','提款（真实）')],['reward',L2('Reward','奖励')],['status',L2('Status','状态')]].map(([key,lbl])=>(
                      <th key={key} style={{ ...s.th, cursor:'pointer', userSelect:'none' }} onClick={()=>{ if(allPlayerSort===key){setAllPlayerSortDir(d=>d==='asc'?'desc':'asc')}else{setAllPlayerSort(key);setAllPlayerSortDir('desc')} }}>
                        {lbl} {allPlayerSort===key ? (allPlayerSortDir==='asc' ? '↑' : '↓') : <span style={{ color:'var(--surface2)', fontSize:9 }}>⇅</span>}
                      </th>
                    ))}
                    <th style={s.th}>{L2('Tier','等级')}</th>
                    <th style={s.th}>WhatsApp</th>
                    <th style={s.th}>{selected?.is_multi_level ? L2('Next Level','下一级别') : L2('vs Target','对比目标')}</th>
                    {selected?.streak_enabled && <th key="streak" style={{ ...s.th, cursor:'pointer', userSelect:'none' }} onClick={()=>{ if(allPlayerSort==='streak'){setAllPlayerSortDir(d=>d==='asc'?'desc':'asc')}else{setAllPlayerSort('streak');setAllPlayerSortDir('desc')} }}>{L2('Streak','连续奖励')} 🔥 {allPlayerSort==='streak' ? (allPlayerSortDir==='asc' ? '↑' : '↓') : <span style={{ color:'var(--surface2)', fontSize:9 }}>⇅</span>}</th>}
                    <th style={s.th}>{L2('Added','加入日期')}</th>
                    <th style={s.th}>✕</th>
                  </tr></thead>
                  <tbody>
                    {sortedAllPlayers.length===0
                      ? <tr><td colSpan={13} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>{L2('No players yet.','暂无玩家。')}</td></tr>
                      : sortedAllPlayers.map((p,i)=>{
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
                          const rowStatusLabel = multi ? (multiMetric?.allCompleted ? L2('Complete','已完成') : `${multiMetric?.completedCount||0}/${campaignLevels.length} ${L2('Levels','级别')}`) : (p.payout_status==='paid' ? L2('Paid','已派') : qualified ? L2('Qualified','已达标') : L2('In Progress','进行中'))
                          return (
                            <tr key={p.id} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                              <td style={{ ...s.td, width:32 }} onClick={e=>e.stopPropagation()}>
                                <input type="checkbox" checked={selectedForRemoval.has(p.id)}
                                  onChange={e=>{ setSelectedForRemoval(prev=>{const s=new Set(prev); e.target.checked?s.add(p.id):s.delete(p.id); return s}) }}
                                  style={{ accentColor:'var(--accent)', cursor:'pointer' }} />
                              </td>
                              <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                              <td style={{ ...s.td, fontWeight:700 }}>{p.username}</td>
                              <td style={{ ...s.td, color:'#3fb950' }}>
                                {isDailyMode
                                  ? rmFmt(summaryData?.depositByPlayer?.[p.id] ?? null, campCurrency)
                                  : rmFmt(playerDeposit(p), campCurrency)}
                              </td>
                              <td style={{ ...s.td, color:'var(--accent)' }}>{real ? rmFmt(real.validBet, campCurrency) : <span style={{ color:'var(--muted)' }}>—</span>}</td>
                              <td style={{ ...s.td, color:'#f85149' }}>{real ? rmFmt(real.withdrawal, campCurrency) : <span style={{ color:'var(--muted)' }}>—</span>}</td>
                              <td style={{ ...s.td, color:typeInfo.color, fontWeight:qualified?700:400 }}>
                                {qualified ? (multi ? (<span>{rmFmt(reward,campCurrency)} {L2('total','合计')}<br /><span style={{ fontSize:10, color:'var(--muted)' }}>{multiMetric?.completedCount||0}/{campaignLevels.length} {L2('levels','级')}</span></span>) : rmFmt(reward,campCurrency)) : '—'}
                              </td>
                              <td style={s.td}>
                                <span style={{ ...s.tag(rowStatusColor, rowStatusColor==='var(--muted)' ? 'rgba(139,148,158,.15)' : undefined), fontSize:10 }}>
                                  {rowStatusLabel}
                                </span>
                              </td>
                              <td style={s.td}>{p.tier && <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)' }}>{p.tier}</span>}</td>
                              <td style={{ ...s.td, fontSize:12 }}>{p.whatsapp||'—'}</td>
                              <td style={s.td}>
                                {multi
                                  ? (multiMetric?.allCompleted
                                      ? <span style={{ fontSize:11, color:'#3fb950', fontWeight:700 }}>{L2('All levels unlocked','已解锁所有级别')}</span>
                                      : <span style={{ fontSize:11, color:gap>=0?'#3fb950':'#f85149', fontWeight:600 }}>{multiMetric?.nextLevel ? `${multiMetric.nextLevel.level_name} · ${gap>=0?'+':''}${rmFmt(gap,campCurrency)}` : '—'}</span>)
                                  : campType === 'dual_tier'
                                    ? <span style={{ fontSize:11, color:'var(--muted)' }}>N/A</span>
                                    : <span style={{ fontSize:12, color:qualified?'#3fb950':'#f85149', fontWeight:600 }}>{qualified ? `+${rmFmt(gap, campCurrency)}` : rmFmt(gap, campCurrency)}</span>}
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
                                          {pPaid.length > 0 && <span style={{ fontSize:10, background:'rgba(63,185,80,.15)', color:'#3fb950', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥×{pPaid.length} {L2('paid','已派')}</span>}
                                          {pPending.length > 0 && <span style={{ fontSize:10, background:'rgba(245,158,11,.15)', color:'#f59e0b', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>🔥×{pPending.length} {L2('pending','待处理')}</span>}
                                          <span style={{ fontSize:10, color:'var(--muted)' }}>{bonusFmt(pTotal, campCurrency)}</span>
                                        </div>
                                    }
                                  </td>
                                )
                              })()}
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
              )
            })()}
            {activeTab === 'summary' && (
              <div style={{ padding:24 }}>
                <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>💰 {L2('Campaign Summary','活动汇总')} — {fmtDate(selected.start_date)} → {fmtDate(selected.end_date)}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12, marginBottom:18 }}>
                  {[
                    [L2('Players','玩家'),players.length,'#a78bfa'],[L2('Qualified','已达标'),achieved.length,'#3fb950'],
                    [L2('Reward Rows','奖励笔数'), isDailyMode && selected?.is_multi_level ? (summaryData?.qualifyingEntries ?? '…') : selected?.is_multi_level ? multiSummary.rewardRows : achieved.length, '#c9a961'],
                    [L2('Total Reward','奖励总额'),rewardFmt(totalReward,campCurrency),typeInfo.color],[L2('Paid','已派'),rewardFmt(paidOut,campCurrency),'#3fb950'],[L2('Pending','待处理'),rewardFmt(pendingPay,campCurrency),'#f85149'],
                  ].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:18,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}
                </div>

                {selected?.is_multi_level && <>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>🏆 {L2('Multi-Level Progress','多级别进度')}</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
                    {(()=>{
                      const sortedLvls = [...campaignLevels].sort((a,b)=>Number(b.deposit_threshold)-Number(a.deposit_threshold))
                      const highestLvlId = sortedLvls[0]?.id
                      const dailyPlayersWithReward = isDailyMode ? (summaryData?.uniqueParticipants || 0) : multiSummary.playersWithReward
                      const dailyFullyCompleted = isDailyMode ? (summaryData?.levelPlayerCounts?.[highestLvlId] || 0) : multiSummary.fullyCompleted
                      const dailyUnlockedLevels = isDailyMode ? Object.values(summaryData?.levelPlayerCounts || {}).reduce((s,v)=>s+v,0) : multiSummary.unlockedLevels
                      const dailySuccessRate = isDailyMode ? (players.length ? Math.round(dailyFullyCompleted/players.length*100) : 0) : multiSummary.successRate
                      return [
                        [L2('Players with reward','获得奖励的玩家'),dailyPlayersWithReward,'#3fb950'],[L2('Fully completed','全部完成'),dailyFullyCompleted,'#a78bfa'],[L2('Levels unlocked','已解锁级别'),dailyUnlockedLevels,'#c9a961'],[L2('Full completion rate','全部完成率'),dailySuccessRate+'%','#3fb950'],
                      ]
                    })().map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:20,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}
                  </div>
                  <table style={{...s.tbl,marginBottom:24}}><thead><tr><th style={s.th}>{L2('Level','级别')}</th><th style={s.th}>{L2('Target','目标')}</th><th style={s.th}>{L2('Qualified Players','达标玩家')}</th><th style={s.th}>{L2('Reward Each','每份奖励')}</th><th style={s.th}>{isDailyMode?L2('Player-Days','玩家天数'):L2('Reward Rows','奖励笔数')}</th></tr></thead><tbody>
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

                {realFinancialsLoading ? <div style={{textAlign:'center',padding:24,color:'var(--muted)'}}>{L2('Loading real platform financials…','正在加载真实平台财务数据…')}</div> : !realFinancials ? <div style={{textAlign:'center',padding:24,color:'var(--muted)'}}>{L2('No real platform data available for the selected campaign period.','所选活动期间没有真实平台数据。')}</div> : (()=>{const rewardCost=totalReward;const netPnl=realFinancials.deposit-realFinancials.withdrawal-rewardCost;const roi=calculateCampaignROI(rewardCost,netPnl);const roiLabel=roi===null?'N/A':`${roi.toFixed(1)}%`;return <><div style={{fontSize:13,fontWeight:700,marginBottom:8}}>💼 {L2('Campaign P&L — Real Platform Data','活动盈亏 — 真实平台数据')}</div><div style={{display:'grid',gridTemplateColumns:'repeat(6,minmax(0,1fr))',gap:12,marginBottom:10}}>{[[L2('Real Deposit','真实存款'),rmFmt(realFinancials.deposit,campCurrency),'#3fb950'],[L2('Real Withdrawal','真实提款'),rmFmt(realFinancials.withdrawal,campCurrency),'#f85149'],[L2('Real Valid Bet','真实有效投注'),rmFmt(realFinancials.validBet,campCurrency),'var(--accent)'],[L2('Reward Cost','奖励成本'),rewardFmt(rewardCost,campCurrency),'#c9a961'],[L2('Net P&L','净盈亏'),rmFmt(netPnl,campCurrency),netPnl>=0?'#3fb950':'#f85149'],['ROI',roiLabel,roi===null?'var(--muted)':roi>=0?'#3fb950':'#f85149']].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:18,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}</div><div style={{fontSize:11,color:'var(--muted)',marginBottom:24}}>{L2('Net P&L = Real Deposit − Real Withdrawal − Reward Cost. ROI = Net P&L ÷ Reward Cost × 100%. ROI is N/A when there is no reward cost. Real figures come from platform snapshots for the campaign period; qualification uses the campaign-period deposit tracked above.','净盈亏 = 真实存款 − 真实提款 − 奖励成本。ROI = 净盈亏 ÷ 奖励成本 × 100%。没有奖励成本时 ROI 为 N/A。真实数据来自活动期间的平台快照；资格判定使用上方追踪的活动期间存款。')}</div></>})()}

                {isDailyMode && (summaryLoading ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>{L2('Loading daily entries…','正在加载每日记录…')}</div> : !summaryData ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>{L2('No daily entries yet.','暂无每日记录。')}</div> : <div><div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📅 {L2('Daily Turnover Settlement','每日流水结算')}</div><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>{[[L2('Days with Entries','有记录的天数'),summaryData.totalEntryDays,'#a78bfa'],[L2('Participants / Enrolled','参与 / 已加入'),`${summaryData.uniqueParticipants} / ${players.length}`,'#3fb950'],[L2('Total Credit Given','已发 Credit 总额'),rmFmt(summaryData.totalCredit,campCurrency),'#c9a961'],[L2('Total WCash Given','已发 WCash 总额'),rmFmt(summaryData.totalWcash,campCurrency),'#f59e0b']].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:20,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}</div></div>)}

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
                      <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>🔥 {L2('Streak Bonus Summary','连续奖励汇总')}</div>
                      {streakBonusesLoading
                        ? <div style={{ color:'var(--muted)', fontSize:12 }}>{L2('Loading streak bonuses…','正在加载连续奖励…')}</div>
                        : allSRows.length === 0
                          ? <div style={{ background:'rgba(255,165,0,.06)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, padding:'14px 18px', fontSize:12, color:'#f59e0b' }}>
                              🔥 {L2('Streak bonus is','此活动的连续奖励已')} <strong>{L2('enabled','启用')}</strong> {L2('for this campaign','')} ({selected.streak_days} {L2('days','天')} · {selected.streak_bonus_type === 'pct' ? `${selected.streak_bonus_pct}%` : rmFmt(selected.streak_bonus_fixed, campCurrency)} {L2('per streak','每次连续')}). {L2('No bonuses awarded yet — keep logging daily entries to trigger streak milestones.','尚未发放奖金 — 请继续录入每日记录以触发连续奖励里程碑。')}
                            </div>
                          : <>
                              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:12 }}>
                                {[
                                  [L2('Streak Days Target','连续天数目标'), selected.streak_days, '#f59e0b'],
                                  [L2('Players with Streak','有连续奖励的玩家'), playersWithStreak, '#a78bfa'],
                                  [L2('Total Bonuses','奖金总笔数'), allSRows.length, '#c9a961'],
                                  [L2('Paid Amount','已派金额'), bonusFmt(paidStreakAmt, campCurrency), '#3fb950'],
                                  [L2('Pending Amount','待处理金额'), bonusFmt(pendingStreakAmt, campCurrency), '#f85149'],
                                ].map(([label,val,color]) => (
                                  <div key={label} style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, padding:14 }}>
                                    <div style={{ fontSize:18, fontWeight:700, color }}>{val}</div>
                                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{label}</div>
                                  </div>
                                ))}
                              </div>
                              <table style={{ ...s.tbl, marginBottom:8 }}>
                                <thead><tr>
                                  <th style={s.th}>{L2('Player','玩家')}</th>
                                  <th style={s.th}>{L2('Streak #','连续奖励 #')}</th>
                                  <th style={s.th}>{L2('Bonus Amount','奖金金额')}</th>
                                  <th style={s.th}>{L2('Status','状态')}</th>
                                  <th style={s.th}>{L2('Awarded At','发放时间')}</th>
                                </tr></thead>
                                <tbody>
                                  {allSRows.sort((a,b) => a.username.localeCompare(b.username) || a.streak_number - b.streak_number).map((sb,i) => (
                                    <tr key={i} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                      <td style={{ ...s.td, fontWeight:700 }}>{sb.username}</td>
                                      <td style={s.td}><span style={{ fontSize:12, fontWeight:700, color:'#f59e0b' }}>🔥 #{sb.streak_number}</span></td>
                                      <td style={{ ...s.td, color:'#c9a961', fontWeight:700 }}>{bonusFmt(sb.bonus_amount, campCurrency)}</td>
                                      <td style={s.td}>
                                        <span style={{ ...s.tag(sb.payout_status==='paid'?'#3fb950':'#f59e0b'), fontSize:10 }}>
                                          {sb.payout_status==='paid' ? L2('✓ Paid','✓ 已派') : L2('Pending','待处理')}
                                        </span>
                                      </td>
                                      <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>
                                        {sb.created_at ? new Date(sb.created_at).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div style={{ fontSize:11, color:'var(--muted)' }}>{L2('Total streak bonus cost:','连续奖励总成本：')} {bonusFmt(totalStreakAmt, campCurrency)} ({paidSRows.length} {L2('paid','已派')} · {pendingSRows.length} {L2('pending','待处理')})</div>
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
                    {[[L2('Players','玩家'),players.length,'#a78bfa'],[L2('Min Valid Bet','最低有效投注'),rmFmt(minBet, campCurrency),'#a78bfa'],[L2('Min Deposit','最低存款'),rmFmt(parseFloat(selected.min_deposit_lb)||0, campCurrency),'#a78bfa'],[L2('Top N','前 N 名'),L2('Top '+topN,'前 '+topN+' 名'),'#ffd700'],[L2('Total Cost','总成本'),rewardFmt(totalCost, campCurrency),'#f85149'],[L2('Total Deposit','总存款'),rmFmt(totalDep2, campCurrency),'#3fb950'],[L2('Withdrawal','提款'),rmFmt(totalWith, campCurrency),'#f59e0b'],['ROI',roi+'%',parseFloat(roi)>=0?'#3fb950':'#f85149']].map(([l,v,c])=>(
                      <div key={l}><div style={{ fontSize:15, fontWeight:800, color:c }}>{v}</div><div style={{ fontSize:10, color:'var(--muted)' }}>{l}</div></div>
                    ))}
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={s.tbl}>
                      <thead><tr>
                        <th style={s.th}>{L2('Rank','名次')}</th><th style={s.th}>{L2('Player','玩家')}</th><th style={s.th}>{L2('Tier','等级')}</th>
                        <th style={s.th}>{L2('Valid Bet','有效投注')}</th><th style={s.th}>{L2('Deposit','存款')}</th><th style={s.th}>{L2('Withdrawal','提款')}</th>
                        <th style={s.th}>{L2('Net','净额')}</th><th style={s.th}>{L2('Reward','奖励')}</th><th style={s.th}>{L2('Status','状态')}</th>
                      </tr></thead>
                      <tbody>
                        {players.length===0 ? (
                          <tr><td colSpan={9} style={{ ...s.td, textAlign:'center', color:'var(--muted)', padding:32 }}>{L2('No players yet','暂无玩家')}</td></tr>
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
                                <input type="number" style={{ ...s.editInput, width:90 }} defaultValue={vb||''} onBlur={e=>updatePlayer(p.id,{valid_bet:parseFloat(e.target.value)||0})} placeholder={L2('valid bet','有效投注')} />
                                {!qualified&&vb>0&&<div style={{ fontSize:10, color:'#f85149' }}>{L2('short','差')} {rmFmt(minBet-vb, campCurrency)}</div>}
                              </td>
                              <td style={s.td}><input type="number" style={{ ...s.editInput, width:80 }} defaultValue={dep||''} onBlur={e=>updatePlayer(p.id,{total_deposit:parseFloat(e.target.value)||0})} placeholder="0" /></td>
                              <td style={s.td}><input type="number" style={{ ...s.editInput, width:80 }} defaultValue={wit||''} onBlur={e=>updatePlayer(p.id,{total_withdrawal:parseFloat(e.target.value)||0})} placeholder="0" /></td>
                              <td style={{ ...s.td, fontWeight:700, color:(dep-wit)>=0?'#3fb950':'#f85149' }}>{dep||wit?rmFmt(dep-wit, campCurrency):'--'}</td>
                              <td style={{ ...s.td, fontWeight:700, color:'#a78bfa' }}>{inTop?rewardFmt(reward, campCurrency):'--'}</td>
                              <td style={s.td}>
                                <select value={p.payout_status||'pending'} onChange={e=>updatePlayer(p.id,{payout_status:e.target.value})}
                                  style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'3px 8px', borderRadius:5, fontSize:11 }}>
                                  <option value="pending">{L2('Pending','待处理')}</option><option value="paid">{L2('Paid','已派')}</option><option value="na">N/A</option>
                                </select>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding:'10px 24px', fontSize:11, color:'var(--muted)', borderTop:'1px solid var(--border)' }}>
                    {L2('ROI = (Total Deposit - Total Withdrawal - Reward Cost) / Reward Cost x 100%','ROI = (总存款 - 总提款 - 奖励成本) / 奖励成本 x 100%')}
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
              <div style={{ fontSize:14, fontWeight:700 }}>💬 {L2('WhatsApp Message','WhatsApp 讯息')}</div>
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
                style={{ ...s.btnG, textDecoration:'none', padding:'8px 18px' }}>{L2('Open WhatsApp','打开 WhatsApp')}</a>
              <button style={{ ...s.btnSm, background: waCopied ? '#3fb950' : undefined, color: waCopied ? '#fff' : undefined }}
                onClick={()=>{ navigator.clipboard.writeText(waPopup.message); setWaCopied(true); setTimeout(()=>setWaCopied(false), 2000) }}>
                {waCopied ? L2('✅ Copied!','✅ 已复制！') : L2('📋 Copy','📋 复制')}
              </button>
              <button style={s.btnSm} onClick={()=>{ setWaPopup(null); setWaCopied(false) }}>{L2('Cancel','取消')}</button>
            </div>
          </div>
        </div>
      )}

      {challengeCamp && <ChallengeDetail campaign={challengeCamp} onClose={() => setChallengeCamp(null)} onChanged={loadCampaigns} />}
    </div>
  )
}
