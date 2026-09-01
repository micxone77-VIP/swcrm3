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

const STATUS_COLOR = { draft:'#8b949e', active:'#3fb950', paused:'#d29922', ended:'#f85149' }
const STATUS_BG    = { draft:'rgba(139,148,158,.15)', active:'rgba(63,185,80,.15)', paused:'rgba(210,153,34,.15)', ended:'rgba(248,81,73,.15)' }
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
    } else {
      setCampaignLevels([])
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
    setPlayers(campaignPlayers)
    if (campaignPlayers.length === 0) {
      setCampaignPlayerLevels([])
      setCampaignRewards([])
      return
    }

    const playerIds = campaignPlayers.map(p => p.id)
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
    await supabase.from('campaign_players').delete().eq('campaign_id', selected.id)
    const { error } = await supabase.from('campaigns').delete().eq('id', selected.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    closeModal()
    await loadCampaigns()
  }

  function closeModal() { setModal(null); setSelected(null); setPlayers([]); setCampaignPlayerLevels([]); setCampaignRewards([]); setVipSearch(''); setVipResults([]); setEditingCamp(false); setAiAnalysis(null); setDailyEntries({}); setEntryDate('') }

  async function loadDailyEntries(campaignId, date) {
    setDailyLoading(true)
    const { data, error } = await supabase.from('daily_turnover_entries')
      .select('player_id, turnover_amount, tier_achieved, credit_reward, wcash_reward')
      .eq('campaign_id', campaignId).eq('entry_date', date)
    if (error) { console.error('loadDailyEntries error', error); setDailyEntries({}); setDailyLoading(false); return }
    const map = {}
    ;(data || []).forEach(e => { map[e.player_id] = e })
    setDailyEntries(map)
    setDailyLoading(false)
  }

  // Upserts a player's turnover for the currently-selected date only — every
  // other date's row for this player is untouched. This IS the "doesn't carry
  // over to the next day" behavior: each date is its own independent record.
  async function saveDailyTurnover(playerId, turnoverAmount) {
    const dualReward = calcDualTierReward(0, turnoverAmount, rewardTiers) // deposit=0: daily mode is turnover-only by design
    const payload = {
      campaign_id: selected.id, player_id: playerId, entry_date: entryDate,
      turnover_amount: turnoverAmount,
      tier_achieved: dualReward.tierIndex >= 0 ? dualReward.tierIndex : null,
      credit_reward: dualReward.creditAmount, wcash_reward: dualReward.wcashAmount,
      entered_by: profile?.full_name || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('daily_turnover_entries')
      .upsert(payload, { onConflict: 'campaign_id,player_id,entry_date' })
    if (error) { alert('Save failed: ' + error.message); console.error(error); return }
    setDailyEntries(prev => ({ ...prev, [playerId]: payload }))
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
      .select('player_id, entry_date, turnover_amount')
      .eq('campaign_id', campaignId)
      .order('entry_date', { ascending: true })
    if (error) { console.error('loadCampaignSummary error', error); setSummaryData(null); setSummaryLoading(false); return }

    // Always recompute credit/wcash fresh from turnover_amount + the campaign's
    // CURRENT tier settings — never trust the stored credit_reward/wcash_reward
    // columns directly. Those are a snapshot from whenever that row was saved;
    // if an entry was saved before some bug fix, the stored figure can be
    // stale and wrong even though the raw turnover_amount is correct.
    const entries = (data || [])
      .filter(e => (parseFloat(e.turnover_amount) || 0) > 0)
      .map(e => {
        const r = calcDualTierReward(0, e.turnover_amount, rewardTiers)
        return { ...e, tier_achieved: r.tierIndex >= 0 ? r.tierIndex : null, credit_reward: r.creditAmount, wcash_reward: r.wcashAmount }
      })

    const uniqueParticipants = new Set(entries.map(e => e.player_id)).size
    const totalCredit = entries.reduce((s, e) => s + e.credit_reward, 0)
    const totalWcash = entries.reduce((s, e) => s + e.wcash_reward, 0)

    const tierHitCounts = {}
    ;(rewardTiers || []).forEach((t, i) => { tierHitCounts[i] = 0 })
    entries.forEach(e => { if (e.tier_achieved !== null) tierHitCounts[e.tier_achieved] = (tierHitCounts[e.tier_achieved] || 0) + 1 })

    const playerMap = {}
    players.forEach(p => { playerMap[p.id] = p })

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

    setSummaryData({ uniqueParticipants, totalCredit, totalWcash, tierHitCounts, playerRows, totalEntryDays: new Set(entries.map(e => e.entry_date)).size, paidCredit, paidWcash, pendingCredit, pendingWcash })
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
  // much more they need (if not qualified yet) or what they've earned (if
  // qualified), phrased correctly for whichever campaign type this is.
  function buildCampaignWaLink(p, extra) {
    const rawNumber = (p.whatsapp || '').replace(/\D/g, '')
    if (!rawNumber || rawNumber.length < 10) return null
    const campName = selected?.campaign_name || 'this campaign'
    let body

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
        // Find the next tier not yet reached, show both gaps.
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
      // pct_reward / fixed_reward / gold_bar / tiered_reward — single deposit target
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
    return `https://wa.me/${rawNumber}?text=${encodeURIComponent(body)}`
  }
  function CampaignWaButton({ p, extra }) {
    const link = buildCampaignWaLink(p, extra)
    if (!link) return <span style={{ color:'var(--muted)' }}>—</span>
    return (
      <a href={link} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
        style={{ display:'inline-flex', width:26, height:26, borderRadius:13, background:'#25D366', color:'#fff', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, textDecoration:'none' }}>W</a>
    )
  }

  const totalDep    = players.reduce((s,p)=>s+playerDeposit(p),0)

  const multiMetricsByPlayer = Object.fromEntries(players.map(p => [p.id, buildMultiLevelPlayerMetrics(p, campaignLevels, campaignPlayerLevels)]))
  const multiPayoutRows = buildPayoutRows(players, campaignLevels, campaignPlayerLevels, campaignRewards)
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
                  setSelected(camp); setActiveTab('chase'); setModal('detail')
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
                    {['draft','active','paused','ended'].map(s=><option key={s}>{s}</option>)}
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
                {selected.status==='draft'  && <button style={s.btnG} onClick={()=>setCampStatus(selected.id,'active')}>▶ {t('campaigns.activate')}</button>}
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
                  <div><div style={s.flbl}>Status</div><select style={s.fsel} value={editCampForm.status||'draft'} onChange={e=>setEditCampForm(f=>({...f,status:e.target.value}))}>{['draft','active','paused','ended'].map(v=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></div>
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
                  {(editCampForm.reward_tiers||[]).map((tier,i)=> editCampForm.campaign_type==='dual_tier' ? <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 32px', gap:6, marginBottom:6 }}><input type="number" style={s.finput} value={tier.depositThreshold||''} placeholder="Deposit" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],depositThreshold:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.turnoverThreshold||''} placeholder="Turnover" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],turnoverThreshold:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.creditAmount||''} placeholder="Credit" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],creditAmount:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.wcashAmount||''} placeholder="WCash" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],wcashAmount:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><button type="button" onClick={()=>setEditCampForm(f=>({...f,reward_tiers:(f.reward_tiers||[]).filter((_,j)=>j!==i)}))} style={{ ...s.btnR, padding:'4px 7px' }}>×</button></div> : <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 90px 32px', gap:6, marginBottom:6 }}><input type="number" style={s.finput} value={tier.min||''} placeholder="Min deposit" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],min:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.max||''} placeholder="Max" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],max:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><input type="number" style={s.finput} value={tier.pct||''} placeholder="%" onChange={e=>{const a=[...(editCampForm.reward_tiers||[])];a[i]={...a[i],pct:e.target.value};setEditCampForm(f=>({...f,reward_tiers:a}))}} /><button type="button" onClick={()=>setEditCampForm(f=>({...f,reward_tiers:(f.reward_tiers||[]).filter((_,j)=>j!==i)}))} style={{ ...s.btnR, padding:'4px 7px' }}>×</button></div>)}
                </div>}

                <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:14 }}>
                  <div style={s.flbl}>PLAYER CONTENT</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:8 }}>
                    <textarea style={s.fta} rows={3} value={editCampForm.offer_desc||''} onChange={e=>setEditCampForm(f=>({...f,offer_desc:e.target.value}))} placeholder="Write player-facing How to Join, Rules & Regulations, eligibility, deposit rules, reward conditions, and payout terms. Use line breaks for sections." />
                    <textarea style={s.fta} rows={3} value={editCampForm.notes||''} onChange={e=>setEditCampForm(f=>({...f,notes:e.target.value}))} placeholder="Internal notes" />
                  </div>
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
                [t('campaigns.successRate'),players.length?(selected?.is_multi_level?multiSummary.successRate:Math.round(achieved.length/players.length*100))+'%':'0%', '#3fb950'],
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
                ['payout',   `💰 Payout (${selected?.is_multi_level ? multiPayoutRows.length : achieved.length} rewards)`],
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
                {isDailyMode && (
                  <div style={{ padding:'12px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'#c9a961' }}>📅 Entry Date:</span>
                    <input type="date" value={entryDate} min={selected.start_date||undefined} max={selected.end_date||undefined}
                      onChange={e=>setEntryDate(e.target.value)}
                      style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:12, color:'var(--text)' }} />
                    <span style={{ fontSize:11, color:'var(--muted)' }}>Each day settles independently — entering turnover for this date does not affect any other date's record.</span>
                    {dailyLoading && <span style={{ fontSize:11, color:'var(--muted)' }}>Loading…</span>}
                  </div>
                )}
                <table style={s.tbl}>
                  {campType === 'leaderboard' ? (
                    <>
                    <thead><tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>Player</th>
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
                      {chaseList.length === 0
                        ? <tr><td colSpan={11} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>Add players above to start tracking.</td></tr>
                        : chaseList.map((p,i) => {
                            const rankingTarget = leaderboardMetric === 'deposit' ? minDepLb : minBetTarget
                            const pr = getProgress(p._rankingValue||0, rankingTarget)
                            const inTopByPosition = i < topN && p._qualified
                            const gap = cutoffValue!=null ? Math.max(0, cutoffValue - (p._rankingValue||0)) : null
                            return (
                              <tr key={p.id} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                                <td style={{ ...s.td, fontWeight:700, cursor:'pointer' }} onClick={()=>{if(p.vip_id){closeModal();navigate(`/vips/${p.vip_id}`)}}}>
                                  {p.username}
                                  {p.tier && <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)', marginLeft:6, fontSize:10 }}>{p.tier}</span>}
                                </td>
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
                      <th style={s.th}>WhatsApp</th>
                      <th style={s.th}>{isDailyMode ? 'Turnover (RM)' : campType==='dual_tier' ? 'Deposit / Turnover (RM)' : 'Campaign Deposit (RM)'}</th>
                      <th style={s.th}>Progress</th>
                      <th style={s.th}>Reward</th>
                      <th style={s.th}>Contact</th>
                      <th style={s.th}>Priority</th>
                      <th style={s.th}>✕</th>
                    </tr></thead>
                    <tbody>
                      {chaseList.length === 0
                        ? <tr><td colSpan={9} style={{ ...s.td, textAlign:'center', padding:24, color:'var(--muted)' }}>Add players above to start tracking.</td></tr>
                        : chaseList.map((p,i) => {
                            const multi = selected?.is_multi_level && campType === 'fixed_reward'
                            const multiMetric = multi ? multiMetricsByPlayer[p.id] : null
                            const dailyEntry = dailyEntries[p.id]
                            const dualReward = campType==='dual_tier'
                              ? (isDailyMode ? calcDualTierReward(0, dailyEntry?.turnover_amount||0, rewardTiers) : calcDualTierReward(playerDeposit(p), p.valid_bet, rewardTiers))
                              : null
                            let pr
                            if (multi) {
                              const target = multiMetric?.nextLevel?.deposit_threshold
                              if (multiMetric?.allCompleted) pr = { pct:100, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:'✅ ALL LEVELS' }
                              else if (target) pr = getProgress(playerDeposit(p), Number(target))
                              else pr = { pct:0, color:'#8b949e', bg:'rgba(139,148,158,.15)', label:'IN PROGRESS' }
                            } else if (isDailyMode && campType==='dual_tier') {
                              const currentTurnover = dailyEntry?.turnover_amount || 0
                              if (dualReward.tierIndex >= 0) {
                                // At least one tier reached — show which one explicitly, and progress
                                // toward the NEXT tier (not the highest) so achieving tier 1 or 2 doesn't
                                // still look like "behind" just because the top tier isn't reached yet.
                                const nextTier = rewardTiers[dualReward.tierIndex + 1]
                                if (nextTier) {
                                  const nextThreshold = parseFloat(nextTier.turnoverThreshold) || 0
                                  const pct = nextThreshold > 0 ? Math.min(100, Math.round(currentTurnover / nextThreshold * 100)) : 100
                                  pr = { pct, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:`✅ Tier ${dualReward.tierIndex+1} Achieved` }
                                } else {
                                  pr = { pct:100, color:'#3fb950', bg:'rgba(63,185,80,.15)', label:`✅ Tier ${dualReward.tierIndex+1} (Highest)` }
                                }
                              } else {
                                const firstThreshold = parseFloat(rewardTiers[0]?.turnoverThreshold) || 0
                                pr = getProgress(currentTurnover, firstThreshold)
                              }
                            } else {
                              pr = getProgress(playerDeposit(p), depTarget)
                            }
                            const reward = multi
                              ? (multiMetric?.qualifiedRewardTotal || 0)
                              : campType==='dual_tier' ? (dualReward.creditAmount + dualReward.wcashAmount) : calcReward(campType, playerDeposit(p), rewardPct, rewardFixed, goldVal, rewardCap, rewardTiers, campaignLevels, selected?.is_multi_level)
                            const qualified = multi ? (multiMetric?.completedCount > 0) : campType==='dual_tier' ? dualReward.tierIndex >= 0 : playerDeposit(p) >= depTarget
                            return (
                              <tr key={p.id} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                                <td style={{ ...s.td, fontWeight:700, cursor:'pointer' }} onClick={()=>{if(p.vip_id){closeModal();navigate(`/vips/${p.vip_id}`)}}}>
                                  {p.username}
                                  {p.tier && <span style={{ ...s.badge, background:TIER_BG[p.tier]||'transparent', color:TIER_COLOR[p.tier]||'var(--muted)', marginLeft:6, fontSize:10 }}>{p.tier}</span>}
                                </td>
                                <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>
                                  <input defaultValue={p.whatsapp||''} onBlur={e=>{if(e.target.value!==(p.whatsapp||''))updatePlayer(p.id,{whatsapp:e.target.value})}} style={{ ...s.editInput, width:120 }} placeholder="—" />
                                </td>
                                <td style={s.td}>
                                  {isDailyMode ? (
                                    <input type="number" key={`${p.id}-${entryDate}`} defaultValue={dailyEntry?.turnover_amount || ''}
                                      onBlur={e=>{ const v=parseFloat(e.target.value)||0; if(v!==(dailyEntry?.turnover_amount||0)) saveDailyTurnover(p.id, v) }}
                                      style={{ ...s.smInput, width:110 }} placeholder="Turnover" disabled={dailyLoading} />
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
                                  {multi && <div style={{ fontSize:10, color:'var(--muted)', marginTop:4 }}>{multiMetric?.allCompleted ? 'All campaign levels unlocked' : multiMetric?.nextLevel ? `Next: ${multiMetric.nextLevel.level_name} · ${rmFmt(Math.max(0, Number(multiMetric.nextLevel.deposit_threshold)-playerDeposit(p)), campCurrency)} more` : '—'}</div>}
                                </td>
                                <td style={{ ...s.td, color: qualified ? typeInfo.color : 'var(--muted)', fontWeight: qualified ? 700 : 400, fontSize:12 }}>
                                  {multi ? (
                                    <span>{rmFmt(reward, campCurrency)} total<br /><span style={{ fontSize:10, color:'var(--muted)' }}>{multiMetric?.completedCount || 0}/{campaignLevels.length} levels unlocked</span></span>
                                  ) : !qualified ? '—' : campType==='dual_tier'
                                      ? <span>{rmFmt(dualReward.creditAmount, campCurrency)} Credit<br/><span style={{fontSize:10,color:'var(--muted)'}}>+ {rmFmt(dualReward.wcashAmount, campCurrency)} WCash</span></span>
                                      : rmFmt(reward, campCurrency)}
                                </td>
                                <td style={s.td}><CampaignWaButton p={p} /></td>
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
                  {selected?.is_multi_level ? 'Each unlocked campaign level is a separate Credit reward. Mark the individual reward paid only after it is actually issued.' : isDailyMode ? <>Showing players who qualified on <strong style={{ color:'#c9a961' }}>{entryDate}</strong>.</> : 'Only showing players who reached the campaign target.'}
                </div>
                {selected?.is_multi_level ? (
                  multiPayoutRows.length === 0 ? <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>No unlocked rewards are ready for payout yet.</div> : (
                    <table style={s.tbl}>
                      <thead><tr><th style={s.th}>#</th><th style={s.th}>Player</th><th style={s.th}>Tier</th><th style={s.th}>Level</th><th style={s.th}>Campaign Deposit</th><th style={s.th}>Reward</th><th style={s.th}>Payout Status</th><th style={s.th}>Paid At</th><th style={s.th}>Notes</th></tr></thead>
                      <tbody>
                        {multiPayoutRows.map((row,i)=>{
                          const paid = row.status === 'paid'
                          const payoutLabel = paid ? '✅ Paid' : row.status === 'approved' ? '🟦 Approved' : '⏳ Pending'
                          const player = players.find(p=>p.id===row.playerId)
                          const note = campaignRewards.find(r=>r.id===row.rewardId)?.notes || ''
                          return <tr key={row.rewardId} style={{ background:paid?'rgba(63,185,80,.04)':'transparent' }}>
                            <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                            <td style={{ ...s.td, fontWeight:700 }}>{row.username}</td>
                            <td style={s.td}>{row.tier && <span style={{ ...s.badge, background:TIER_BG[row.tier]||'transparent', color:TIER_COLOR[row.tier]||'var(--muted)' }}>{row.tier}</span>}</td>
                            <td style={{ ...s.td, fontWeight:600 }}>{row.levelName}</td>
                            <td style={{ ...s.td, color:'#3fb950', fontWeight:600 }}>{player ? rmFmt(playerDeposit(player), campCurrency) : '—'}</td>
                            <td style={{ ...s.td, color:typeInfo.color, fontWeight:700 }}>{rewardFmt(row.rewardAmount,campCurrency)} Credit</td>
                            <td style={s.td}><button onClick={()=>toggleCampaignReward(row.rewardId,!paid)} style={{ ...s.tag(paid?'#3fb950':'#f59e0b',paid?'rgba(63,185,80,.15)':'rgba(245,158,11,.15)'),cursor:'pointer',border:`1px solid ${paid?'rgba(63,185,80,.3)':'rgba(245,158,11,.3)'}` }}>{payoutLabel}</button></td>
                            <td style={{ ...s.td, fontSize:11, color:'var(--muted)' }}>{row.paidAt ? new Date(row.paidAt).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
                            <td style={s.td}><input defaultValue={note} onBlur={async e=>{const v=e.target.value;if(v!==note){const {error}=await supabase.from('campaign_rewards').update({notes:v}).eq('id',row.rewardId);if(error)console.error(error)}}} style={{ ...s.editInput,width:140 }} placeholder="Add note..." /></td>
                          </tr>
                        })}
                        <tr style={{ background:'var(--surface2)',fontWeight:700 }}><td colSpan={5} style={s.td}>Total unlocked rewards</td><td style={{ ...s.td,color:typeInfo.color,fontWeight:800 }}>{rewardFmt(totalReward,campCurrency)} Credit</td><td style={s.td}><span style={{color:'#3fb950'}}>{rewardFmt(paidOut,campCurrency)} paid</span><span style={{color:'#f85149',marginLeft:8}}>{rewardFmt(pendingPay,campCurrency)} pending</span></td><td colSpan={2} style={s.td}/></tr>
                      </tbody>
                    </table>
                  )
                ) : (isDailyMode ? dailyAchieved : achieved).length === 0 ? (
                  <div style={{ padding:32,textAlign:'center',color:'var(--muted)' }}>{isDailyMode?'No players qualified on this date yet.':'No players have reached the target yet.'}</div>
                ) : (
                  <table style={s.tbl}>
                    <thead><tr><th style={s.th}>#</th><th style={s.th}>Player</th><th style={s.th}>Tier</th><th style={s.th}>{isDailyMode?'Turnover (this date)':'Deposit'}</th><th style={s.th}>Reward</th><th style={s.th}>Payout Status</th><th style={s.th}>Notes</th></tr></thead>
                    <tbody>{(isDailyMode?dailyAchieved:achieved).map((p,i)=>{const dualReward=isDailyMode?calcDualTierReward(0,dailyEntries[p.id]?.turnover_amount||0,rewardTiers):campType==='dual_tier'?calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers):null;const reward=campType==='dual_tier'?(dualReward.creditAmount+dualReward.wcashAmount):calcReward(campType,playerDeposit(p),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level);const paid=p.payout_status==='paid';return <tr key={p.id}><td style={{...s.td,color:'var(--muted)',fontSize:11}}>{i+1}</td><td style={{...s.td,fontWeight:700}}>{p.username}</td><td style={s.td}>{p.tier||'—'}</td><td style={{...s.td,color:'#3fb950',fontWeight:600}}>{isDailyMode?rmFmt(dailyEntries[p.id]?.turnover_amount||0,campCurrency):rmFmt(playerDeposit(p),campCurrency)}</td><td style={{...s.td,color:typeInfo.color,fontWeight:700}}>{campType==='dual_tier'?<span>{rmFmt(dualReward.creditAmount,campCurrency)} Credit<br/><span style={{fontSize:10,color:'var(--muted)'}}>+ {rmFmt(dualReward.wcashAmount,campCurrency)} WCash</span></span>:rmFmt(reward,campCurrency)}</td><td style={s.td}><button onClick={()=>updatePlayer(p.id,{payout_status:paid?'pending':'paid',payout_date:paid?null:new Date().toISOString()})} style={{...s.tag(paid?'#3fb950':'#f59e0b',paid?'rgba(63,185,80,.15)':'rgba(245,158,11,.15)'),cursor:'pointer'}}>{paid?'✅ Paid':'⏳ Pending'}</button></td><td style={s.td}><input defaultValue={p.notes||''} onBlur={e=>{if(e.target.value!==(p.notes||''))updatePlayer(p.id,{notes:e.target.value})}} style={{...s.editInput,width:140}} placeholder="Add note..."/></td></tr>})}</tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── ALL PLAYERS TAB ── */}
            {activeTab === 'register' && (
              <div style={{ overflowX:'auto' }}>
                <div style={{ padding:'8px 24px', fontSize:11, color:'var(--muted)', background:'rgba(88,166,255,.04)', borderBottom:'1px solid var(--border)' }}>
                  Deposit is manually tracked for reward eligibility · Turnover/Withdrawal are real platform data for the campaign period ({fmtDate(selected.start_date)} → {fmtDate(selected.end_date)})
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
                                  ? (real ? rmFmt(real.deposit, campCurrency) : <span style={{ color:'var(--muted)' }}>—</span>)
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
                    ['Reward Rows',selected?.is_multi_level?multiSummary.rewardRows:achieved.length,'#c9a961'],
                    ['Total Reward',rewardFmt(totalReward,campCurrency),typeInfo.color],['Paid',rewardFmt(paidOut,campCurrency),'#3fb950'],['Pending',rewardFmt(pendingPay,campCurrency),'#f85149'],
                  ].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:18,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}
                </div>

                {selected?.is_multi_level && <>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>🏆 Multi-Level Progress</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
                    {[
                      ['Players with reward',multiSummary.playersWithReward,'#3fb950'],['Fully completed',multiSummary.fullyCompleted,'#a78bfa'],['Levels unlocked',multiSummary.unlockedLevels,'#c9a961'],['Full completion rate',multiSummary.successRate+'%','#3fb950'],
                    ].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:20,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}
                  </div>
                  <table style={{...s.tbl,marginBottom:24}}><thead><tr><th style={s.th}>Level</th><th style={s.th}>Target</th><th style={s.th}>Unlocked Players</th><th style={s.th}>Reward Each</th><th style={s.th}>Reward Rows</th></tr></thead><tbody>
                    {campaignLevels.map(level=>{const unlockedCount=campaignPlayerLevels.filter(pl=>pl.campaign_level_id===level.id&&['unlocked','claimed','issued','paid','approved'].includes(pl.status)).length;const rewardRows=campaignRewards.filter(r=>r.campaign_level_id===level.id).length;return <tr key={level.id}><td style={{...s.td,fontWeight:700}}>{level.level_name}</td><td style={s.td}>{rmFmt(level.deposit_threshold,campCurrency)}</td><td style={{...s.td,color:'#3fb950',fontWeight:700}}>{unlockedCount}</td><td style={{...s.td,color:typeInfo.color,fontWeight:700}}>{rmFmt(level.reward_amount,campCurrency)} Credit</td><td style={s.td}>{rewardRows}</td></tr>})}
                  </tbody></table>
                </>}

                {realFinancialsLoading ? <div style={{textAlign:'center',padding:24,color:'var(--muted)'}}>Loading real platform financials…</div> : !realFinancials ? <div style={{textAlign:'center',padding:24,color:'var(--muted)'}}>No real platform data available for the selected campaign period.</div> : (()=>{const rewardCost=totalReward;const netPnl=realFinancials.deposit-realFinancials.withdrawal-rewardCost;const roi=calculateCampaignROI(rewardCost,netPnl);const roiLabel=roi===null?'N/A':`${roi.toFixed(1)}%`;return <><div style={{fontSize:13,fontWeight:700,marginBottom:8}}>💼 Campaign P&amp;L — Real Platform Data</div><div style={{display:'grid',gridTemplateColumns:'repeat(6,minmax(0,1fr))',gap:12,marginBottom:10}}>{[['Real Deposit',rmFmt(realFinancials.deposit,campCurrency),'#3fb950'],['Real Withdrawal',rmFmt(realFinancials.withdrawal,campCurrency),'#f85149'],['Real Valid Bet',rmFmt(realFinancials.validBet,campCurrency),'var(--accent)'],['Reward Cost',rewardFmt(rewardCost,campCurrency),'#c9a961'],['Net P&L',rmFmt(netPnl,campCurrency),netPnl>=0?'#3fb950':'#f85149'],['ROI',roiLabel,roi===null?'var(--muted)':roi>=0?'#3fb950':'#f85149']].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:18,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}</div><div style={{fontSize:11,color:'var(--muted)',marginBottom:24}}>Net P&amp;L = Real Deposit − Real Withdrawal − Reward Cost. ROI = Net P&amp;L ÷ Reward Cost × 100%. ROI is N/A when there is no reward cost. Real figures come from platform snapshots for the campaign period; qualification uses the campaign-period deposit tracked above.</div></>})()}

                {isDailyMode && (summaryLoading ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>Loading daily entries…</div> : !summaryData ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>No daily entries yet.</div> : <div><div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📅 Daily Turnover Settlement</div><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>{[['Days with Entries',summaryData.totalEntryDays,'#a78bfa'],['Unique Participants',summaryData.uniqueParticipants,'#3fb950'],['Total Credit Given',rmFmt(summaryData.totalCredit,campCurrency),'#c9a961'],['Total WCash Given',rmFmt(summaryData.totalWcash,campCurrency),'#f59e0b']].map(([label,val,color])=><div key={label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:14}}><div style={{fontSize:20,fontWeight:700,color}}>{val}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div></div>)}</div></div>)}
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
    </div>
  )
}
