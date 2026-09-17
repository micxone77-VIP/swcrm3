// src/pages/Today.jsx — Command Center / Today (V2)
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDashboard } from '../hooks/useDashboard'
import { supabase } from '../lib/supabase'
import {
  KpiCard, Btn, Card, CardHeader, CardBody,
  LoadingState, ErrorState, FilterPills, Badge, Modal,
  Select, Textarea, useToast,
} from '../components/ui'
import { TierBadge, RiskBadge } from '../components/ui'
import { formatMoney } from '../lib/format'
import VipQuickSearch from '../components/VipQuickSearch'
import { useLanguage } from '../contexts/LanguageContext'

const OUTCOMES = ['Contacted', 'No Reply', 'Replied', 'Deposited', 'Reactivated']
const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }
const CAMP_TYPE_LABEL = {
  gold_bar:'Gold Bar', pct_reward:'% Reward', tiered_reward:'Tiered', leaderboard:'Leaderboard',
  dual_tier:'Deposit+Turnover', fixed_reward:'Fixed Reward',
}
const CAMP_STATUS_COLOR = { active:'#3fb950', draft:'#d29922', upcoming:'#58a6ff', completed:'var(--muted)' }

function timeAgo(d) {
  if (!d) return '—'
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return `${diff}d ago`
}

export default function Today() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast, ToastContainer } = useToast()
  const { t } = useLanguage()
  const [host, setHost] = useState('All')
  const [activeQueue, setActiveQueue] = useState('all')
  const [hostList, setHostList] = useState(['All'])

  // Load hosts dynamically from profiles (same as AtRisk.jsx)
  useEffect(() => {
    supabase.from('profiles')
      .select('full_name')
      .in('role', ['admin', 'host'])
      .order('full_name')
      .then(({ data }) => {
        const names = (data || []).map(p => p.full_name).filter(Boolean)
        setHostList(['All', ...names])
      })
  }, [])

  const {
    loading, error, refresh,
    contactedToday, needContact,
    priorityQueue, overdue, followUp, atRisk, birthdays,
    contactedTodaySet, hostVips, getDays,
  } = useDashboard({ host })

  // Quick-log modal
  const [logTarget, setLogTarget] = useState(null)
  const [logOutcome, setLogOutcome] = useState('Replied')
  const [logNote, setLogNote] = useState('')
  const [logSaving, setLogSaving] = useState(false)

  // ── Yesterday's Pulse ──────────────────────────────────────────────────────
  const [pulse, setPulse] = useState(null)
  const [pulseOpen, setPulseOpen] = useState(true)
  const [churnOpen, setChurnOpen] = useState(false)

  useEffect(() => {
    async function fetchPulse() {
      const today = new Date()
      const fmt = d => d.toISOString().slice(0, 10)
      const yesterday  = fmt(new Date(today.getTime() - 86400000))
      const dayBefore  = fmt(new Date(today.getTime() - 2 * 86400000))

      const [
        { data: ySnaps },
        { data: dbSnaps },
        { data: depositSnaps },
        { data: churners },
      ] = await Promise.all([
        // Active yesterday (valid bet)
        supabase.from('vip_daily_snapshots')
          .select('username, tier, monthly_valid_bet')
          .eq('snapshot_date', yesterday)
          .gt('monthly_valid_bet', 0),
        // Active day-before
        supabase.from('vip_daily_snapshots')
          .select('username')
          .eq('snapshot_date', dayBefore)
          .gt('monthly_valid_bet', 0),
        // Deposited yesterday — use snapshots for accurate daily deposit amount
        supabase.from('vip_daily_snapshots')
          .select('username, total_deposit')
          .eq('snapshot_date', yesterday)
          .gt('total_deposit', 0)
          .order('total_deposit', { ascending: false })
          .limit(10),
        // Diamond/Platinum with high inactivity
        supabase.from('vip_members')
          .select('username, full_name, tier, days_inactive, churn_risk, id')
          .in('tier', ['DIAMOND', 'PLATINUM'])
          .eq('is_excluded', false)
          .gte('days_inactive', 7)
          .order('days_inactive', { ascending: false })
          .limit(8),
      ])

      // Look up member details for yesterday's depositors
      let depositedYday = []
      if (depositSnaps && depositSnaps.length > 0) {
        const { data: memberRows } = await supabase.from('vip_members')
          .select('username, full_name, tier, currency, id')
          .in('username', depositSnaps.map(r => r.username))
          .eq('is_excluded', false)
        const mMap = {}
        ;(memberRows || []).forEach(m => { mMap[m.username] = m })
        depositedYday = depositSnaps
          .map(s => ({ ...mMap[s.username], username: s.username, total_deposit: s.total_deposit }))
          .filter(d => d.id)
      }

      const ydaySet = new Set((ySnaps || []).map(r => r.username))
      const dbSet   = new Set((dbSnaps || []).map(r => r.username))
      const droppedOff = [...dbSet].filter(u => !ydaySet.has(u))

      setPulse({
        activeYesterday: ydaySet.size,
        activeYdayByTier: (ySnaps || []).reduce((acc, r) => {
          const t = (r.tier || '').toUpperCase()
          acc[t] = (acc[t] || 0) + 1; return acc
        }, {}),
        droppedOff: droppedOff.length,
        depositedYday: depositedYday || [],
        churners: churners || [],
        yesterday,
      })
    }
    fetchPulse()
  }, [])

  // ── Campaign Command ───────────────────────────────────────────────────────
  const [campaigns, setCampaigns] = useState(null)
  const [campOpen, setCampOpen] = useState(true)

  useEffect(() => {
    async function fetchCampaigns() {
      const { data } = await supabase.from('campaigns')
        .select('id, campaign_name, campaign_code, campaign_type, status, start_date, end_date, budget_rm, deposit_target')
        .in('status', ['active', 'draft', 'upcoming'])
        .order('start_date', { ascending: false })
      if (!data) return setCampaigns([])

      // Get player counts per campaign
      const ids = data.map(c => c.id)
      const { data: players } = await supabase.from('campaign_players')
        .select('campaign_id')
        .in('campaign_id', ids)
      const countMap = {}
      ;(players || []).forEach(p => { countMap[p.campaign_id] = (countMap[p.campaign_id] || 0) + 1 })
      setCampaigns(data.map(c => ({ ...c, playerCount: countMap[c.id] || 0 })))
    }
    fetchCampaigns()
  }, [])

  // ── Weekly active players ──────────────────────────────────────────────────
  const [weeklyActive, setWeeklyActive] = useState(null)
  const [weeklyLoading, setWeeklyLoading] = useState(true)

  useEffect(() => {
    async function fetchWeekly() {
      setWeeklyLoading(true)
      const today = new Date()
      const fmt = d => d.toISOString().slice(0, 10)
      const pad = n => new Date(today.getTime() - n * 86400000)

      const thisStart  = fmt(pad(6))    // last 7 days incl. today
      const thisEnd    = fmt(today)
      const lastStart  = fmt(pad(13))   // prior 7 days
      const lastEnd    = fmt(pad(7))
      const monthStart = fmt(new Date(today.getFullYear(), today.getMonth(), 1))

      // Active = valid_bet > 0 OR total_deposit > 0 (login-only does NOT count)
      const ACTIVE_FILTER = 'monthly_valid_bet.gt.0,total_deposit.gt.0'

      const [
        { data: thisData },
        { data: lastData },
        { data: monthData },
        { data: memberData },
      ] = await Promise.all([
        supabase.from('vip_daily_snapshots')
          .select('username, tier')
          .gte('snapshot_date', thisStart).lte('snapshot_date', thisEnd)
          .or(ACTIVE_FILTER),
        supabase.from('vip_daily_snapshots')
          .select('username, tier')
          .gte('snapshot_date', lastStart).lte('snapshot_date', lastEnd)
          .or(ACTIVE_FILTER),
        supabase.from('vip_daily_snapshots')
          .select('username, tier')
          .gte('snapshot_date', monthStart).lte('snapshot_date', thisEnd)
          .or(ACTIVE_FILTER),
        supabase.from('vip_members')
          .select('username, tier')
          .eq('is_excluded', false),
      ])

      // distinct username → tier
      const distinct = (rows) => {
        const seen = new Map()
        ;(rows || []).forEach(r => {
          if (!seen.has(r.username)) seen.set(r.username, (r.tier || '').toUpperCase())
        })
        return seen
      }

      const thisMap  = distinct(thisData)
      const lastMap  = distinct(lastData)
      const monthMap = distinct(monthData)

      // total members per tier
      const totalByTier = {}
      ;(memberData || []).forEach(m => {
        const t = (m.tier || '').toUpperCase()
        totalByTier[t] = (totalByTier[t] || 0) + 1
      })
      const totalAll = (memberData || []).length

      const TIERS = ['DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
      const byTier = TIERS.map(t => ({
        tier: t,
        total:     totalByTier[t] || 0,
        thisMonth: [...monthMap.values()].filter(v => v === t).length,
        thisWeek:  [...thisMap.values()].filter(v => v === t).length,
        lastWeek:  [...lastMap.values()].filter(v => v === t).length,
      })).filter(t => t.total > 0 || t.thisWeek > 0 || t.lastWeek > 0)

      setWeeklyActive({
        totalAll,
        thisMonth: monthMap.size,
        thisWeek: thisMap.size,
        lastWeek: lastMap.size,
        thisStart, thisEnd, lastStart, lastEnd,
        byTier,
      })
      setWeeklyLoading(false)
    }
    fetchWeekly()
  }, [])


  // ── Slipped Away ──────────────────────────────────────────────────────────
  const [slipped, setSlipped] = useState(null)
  const [slippedOpen, setSlippedOpen] = useState(true)

  useEffect(() => {
    async function fetchSlipped() {
      const today = new Date()
      const fmt = d => d.toISOString().slice(0, 10)
      const thisMonthStart = fmt(new Date(today.getFullYear(), today.getMonth(), 1))
      const prevMonthStart = fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1))
      const prevMonthEnd   = fmt(new Date(today.getFullYear(), today.getMonth(), 0))

      // Members who deposited in the prev month
      const { data: prevActive } = await supabase
        .from('vip_daily_snapshots')
        .select('username')
        .gte('snapshot_date', prevMonthStart)
        .lte('snapshot_date', prevMonthEnd)
        .gt('total_deposit', 0)

      if (!prevActive || prevActive.length === 0) return setSlipped([])
      const prevUsernames = [...new Set(prevActive.map(r => r.username))]

      // Of those, who has 0 deposit so far this month (in snapshots)?
      const { data: thisActive } = await supabase
        .from('vip_daily_snapshots')
        .select('username')
        .gte('snapshot_date', thisMonthStart)
        .gt('total_deposit', 0)
        .in('username', prevUsernames)

      const thisSet = new Set((thisActive || []).map(r => r.username))
      const slippedUsernames = prevUsernames.filter(u => !thisSet.has(u))
      if (slippedUsernames.length === 0) return setSlipped([])

      // Fetch member details for slipped VIPs, filtered by host if applicable
      const { data: members } = await supabase
        .from('vip_members')
        .select('id,username,full_name,tier,days_inactive,churn_risk,host_assigned,last_deposit_date,total_deposit,currency')
        .in('username', slippedUsernames)
        .eq('is_excluded', false)
        .order('tier', { ascending: true })
        .limit(30)

      setSlipped(members || [])
    }
    fetchSlipped()
  }, [])

  // ── My Open Tasks ─────────────────────────────────────────────────────────
  const [myTasks, setMyTasks] = useState(null)
  const [tasksOpen, setTasksOpen] = useState(true)

  useEffect(() => {
    if (!profile?.full_name) return
    async function fetchMyTasks() {
      const { data } = await supabase
        .from('tasks')
        .select('id,title,task_type,priority,status,due_date,vip_username,vip_tier,notes')
        .in('status', ['Open', 'In Progress'])
        .order('due_date', { ascending: true })
        .limit(20)
      setMyTasks(data || [])
    }
    fetchMyTasks()
  }, [profile])

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateStr = now.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' })

  async function submitLog() {
    if (!logTarget || logSaving) return
    setLogSaving(true)
    const { error: err } = await supabase.from('contact_logs').insert({
      username: logTarget.username,
      vip_id: logTarget.id,
      outcome: logOutcome,
      notes: logNote || null,
      host_name: profile?.full_name || null,
      logged_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
    setLogSaving(false)
    if (err) { toast('Failed to log contact: ' + err.message, 'error'); return }
    toast(`Logged: ${logTarget.username} — ${logOutcome}`, 'success')
    setLogTarget(null); setLogNote(''); setLogOutcome('Replied')
    refresh()
  }

  // Queue data
  const queueMap = {
    all: priorityQueue,
    overdue: overdue,
    follow: followUp,
    risk: atRisk,
    birthday: birthdays,
  }
  const displayItems = (queueMap[activeQueue] || priorityQueue).slice(0, 30)

  if (loading) return <div style={{ padding: 32 }}><LoadingState message="Loading today's work…" /></div>
  if (error) return <div style={{ padding: 32 }}><ErrorState message={error} onRetry={refresh} /></div>

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      <ToastContainer />

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
              {greeting}, {profile?.full_name?.split(' ')[0] || 'there'}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              {dateStr} · {t('today.subtitle')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <VipQuickSearch />
            <Btn variant="primary" onClick={refresh} size="sm">{t('today.refresh')}</Btn>
          </div>
        </div>

        {/* Host filter */}
        <div style={{ marginTop: 16 }}>
          <FilterPills
            options={hostList.map(h => ({ value: h, label: h === 'All' ? 'All Hosts' : h }))}
            active={host}
            onChange={setHost}
          />
        </div>
      </div>

      {/* ── KPI Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard
          label={t('today.kpiFollowUps')}
          value={followUp.length}
          color="var(--info)"
          onClick={() => setActiveQueue('follow')}
          sub={t('today.kpiFollowUpsSub')}
        />
        <KpiCard
          label={t('today.kpiOverdue')}
          value={overdue.length}
          color="var(--danger)"
          onClick={() => setActiveQueue('overdue')}
          sub={t('today.kpiOverdueSub')}
        />
        <KpiCard
          label={t('today.kpiAtRisk')}
          value={atRisk.length}
          color="var(--warning)"
          onClick={() => setActiveQueue('risk')}
          sub={t('today.kpiAtRiskSub')}
        />
        <KpiCard
          label={t('today.kpiBirthdays')}
          value={birthdays.length}
          color="#EC4899"
          onClick={() => setActiveQueue('birthday')}
          sub={t('today.kpiBirthdaysSub')}
        />
      </div>

      {/* ── Yesterday's Pulse ── */}
      {pulse && (() => {
        const TIER_COLOR = { DIAMOND:'#58a6ff', PLATINUM:'#cbd5e1', GOLD:'#fbbf24', SILVER:'#94a3b8', BRONZE:'#c2855a' }
        return (
          <Card style={{ marginBottom: 24 }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid var(--border)', cursor:'pointer' }}
              onClick={() => setPulseOpen(o => !o)}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase' }}>Yesterday's Pulse</span>
                <span style={{ fontSize:11, color:'var(--disabled)' }}>· {pulse.yesterday}</span>
              </div>
              <span style={{ fontSize:12, color:'var(--muted)' }}>{pulseOpen ? '▲' : '▼'}</span>
            </div>

            {pulseOpen && (
              <div style={{ padding:'16px 18px' }}>
                {/* Stat cards row */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:16 }}>
                  {/* Active yesterday */}
                  <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 14px', borderLeft:'3px solid #3fb950' }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--muted)', marginBottom:4 }}>ACTIVE YESTERDAY</div>
                    <div style={{ fontSize:28, fontWeight:800, color:'var(--text)', lineHeight:1 }}>{pulse.activeYesterday}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:2 }}>VIPs had valid bet</div>
                  </div>
                  {/* Dropped off */}
                  <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 14px', borderLeft:`3px solid ${pulse.droppedOff > 0 ? '#f85149' : '#3fb950'}` }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--muted)', marginBottom:4 }}>DROPPED OFF</div>
                    <div style={{ fontSize:28, fontWeight:800, color: pulse.droppedOff > 0 ? '#f85149' : 'var(--text)', lineHeight:1 }}>{pulse.droppedOff}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:2 }}>active day-before, gone yday</div>
                  </div>
                  {/* Deposited */}
                  <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 14px', borderLeft:'3px solid #58a6ff' }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--muted)', marginBottom:4 }}>DEPOSITED</div>
                    <div style={{ fontSize:28, fontWeight:800, color:'var(--text)', lineHeight:1 }}>{pulse.depositedYday.length}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:2 }}>VIPs deposited yesterday</div>
                  </div>
                  {/* Diamond/Platinum concern */}
                  <div style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 14px', borderLeft:`3px solid ${pulse.churners.length > 0 ? '#d29922' : '#3fb950'}` }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--muted)', marginBottom:4 }}>DIA/PLAT INACTIVE</div>
                    <div style={{ fontSize:28, fontWeight:800, color: pulse.churners.length > 0 ? '#d29922' : 'var(--text)', lineHeight:1 }}>{pulse.churners.length}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:2 }}>7+ days inactive</div>
                  </div>
                </div>

                {/* Tier breakdown */}
                {Object.keys(pulse.activeYdayByTier).length > 0 && (
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:16 }}>
                    {['DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].filter(t => pulse.activeYdayByTier[t]).map(t => (
                      <div key={t} style={{
                        display:'flex', alignItems:'center', gap:5,
                        background:'var(--surface2)', borderRadius:6, padding:'4px 10px',
                      }}>
                        <span style={{ width:7, height:7, borderRadius:'50%', background: TIER_COLOR[t] || '#888', display:'inline-block' }} />
                        <span style={{ fontSize:11, fontWeight:700, color: TIER_COLOR[t] || 'var(--muted)' }}>
                          {t.charAt(0) + t.slice(1).toLowerCase()}
                        </span>
                        <span style={{ fontSize:12, fontWeight:800, color:'var(--text)' }}>{pulse.activeYdayByTier[t]}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Deposited yesterday list */}
                {pulse.depositedYday.length > 0 && (
                  <div style={{ marginBottom:16 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.4px' }}>
                      Who Deposited Yesterday
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                      {pulse.depositedYday.map(v => (
                        <div key={v.id} style={{
                          display:'flex', alignItems:'center', gap:10,
                          padding:'7px 10px', background:'var(--surface2)', borderRadius:6,
                          cursor:'pointer',
                        }} onClick={() => navigate(`/vips/${v.id}`)}>
                          <TierBadge tier={v.tier} />
                          <span style={{ fontWeight:600, fontSize:13, color:'var(--text)', flex:1 }}>{v.username}</span>
                          {v.full_name && <span style={{ fontSize:11, color:'var(--muted)' }}>{v.full_name}</span>}
                          <span style={{ fontSize:12, fontWeight:700, color:'#58a6ff', marginLeft:'auto' }}>
                            {formatMoney(v.total_deposit, v.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Diamond/Platinum churn watch */}
                {pulse.churners.length > 0 && (
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, cursor:'pointer' }}
                      onClick={() => setChurnOpen(o => !o)}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#d29922', textTransform:'uppercase', letterSpacing:'.4px' }}>
                        ⚠ Diamond/Platinum Churn Watch
                      </div>
                      <span style={{ fontSize:10, color:'var(--muted)' }}>{churnOpen ? '▲' : '▼'}</span>
                    </div>
                    {churnOpen && (
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {pulse.churners.map(v => (
                          <div key={v.id} style={{
                            display:'flex', alignItems:'center', gap:10,
                            padding:'7px 10px', background:'var(--surface2)', borderRadius:6,
                            cursor:'pointer', borderLeft:'3px solid #d29922',
                          }} onClick={() => navigate(`/vips/${v.id}`)}>
                            <TierBadge tier={v.tier} />
                            <span style={{ fontWeight:600, fontSize:13, color:'var(--text)', flex:1 }}>{v.username}</span>
                            {v.full_name && <span style={{ fontSize:11, color:'var(--muted)' }}>{v.full_name}</span>}
                            <span style={{ fontSize:11, color: v.days_inactive >= 14 ? '#f85149' : '#d29922', marginLeft:'auto', fontWeight:700 }}>
                              {v.days_inactive}d inactive
                            </span>
                            <RiskBadge risk={v.churn_risk} />
                            <Btn size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setLogTarget(v) }}>Log</Btn>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        )
      })()}

      {/* ── Active Player Rate ── */}
      {!weeklyLoading && weeklyActive && (() => {
        const wDiff = weeklyActive.thisWeek - weeklyActive.lastWeek
        const wPct  = weeklyActive.lastWeek > 0 ? Math.round(Math.abs(wDiff) / weeklyActive.lastWeek * 100) : null
        const wUp   = wDiff > 0
        const TIER_COLOR = { DIAMOND:'#58a6ff', PLATINUM:'#cbd5e1', GOLD:'#fbbf24', SILVER:'#94a3b8', BRONZE:'#c2855a' }
        const monthRate = weeklyActive.totalAll > 0 ? Math.round(weeklyActive.thisMonth / weeklyActive.totalAll * 100) : 0
        return (
          <Card style={{ marginBottom: 24, padding: '16px 20px' }}>
            {/* Header row */}
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:12 }}>
              <span style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase' }}>
                Active Player Rate
              </span>
              <span style={{ fontSize:10, color:'var(--disabled)' }}>
                · active = valid bet OR deposit moved · login-only excluded
              </span>
            </div>

            {/* Summary stats row */}
            <div style={{ display:'flex', gap:24, flexWrap:'wrap', marginBottom:14 }}>
              {/* Total members */}
              <div>
                <div style={{ fontSize:10, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>TOTAL MEMBERS</div>
                <div style={{ fontSize:28, fontWeight:800, color:'var(--text)', lineHeight:1 }}>{weeklyActive.totalAll}</div>
              </div>
              {/* Separator */}
              <div style={{ width:1, background:'var(--border)', alignSelf:'stretch' }} />
              {/* This month */}
              <div>
                <div style={{ fontSize:10, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>ACTIVE THIS MONTH</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                  <span style={{ fontSize:28, fontWeight:800, color:'var(--text)', lineHeight:1 }}>{weeklyActive.thisMonth}</span>
                  <span style={{ fontSize:13, fontWeight:700, color: monthRate >= 50 ? '#3fb950' : monthRate >= 30 ? '#d29922' : '#f85149' }}>
                    {monthRate}%
                  </span>
                </div>
                <div style={{ fontSize:10, color:'var(--muted)' }}>of total members</div>
              </div>
              {/* Separator */}
              <div style={{ width:1, background:'var(--border)', alignSelf:'stretch' }} />
              {/* This week */}
              <div>
                <div style={{ fontSize:10, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>ACTIVE THIS WEEK</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                  <span style={{ fontSize:28, fontWeight:800, color:'var(--text)', lineHeight:1 }}>{weeklyActive.thisWeek}</span>
                  <span style={{ fontSize:12, fontWeight:700, color: wDiff === 0 ? 'var(--muted)' : wUp ? '#3fb950' : '#f85149' }}>
                    {wDiff === 0 ? '→' : wUp ? '▲' : '▼'} {wDiff === 0 ? 'same' : `${Math.abs(wDiff)}${wPct !== null ? ` (${wPct}%)` : ''}`}
                  </span>
                </div>
                <div style={{ fontSize:10, color:'var(--muted)' }}>vs {weeklyActive.lastWeek} last week</div>
              </div>
            </div>

            {/* Tier breakdown table */}
            {weeklyActive.byTier.length > 0 && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {weeklyActive.byTier.map(t => {
                  const wD = t.thisWeek - t.lastWeek
                  const color = TIER_COLOR[t.tier] || 'var(--muted)'
                  const mRate = t.total > 0 ? Math.round(t.thisMonth / t.total * 100) : 0
                  return (
                    <div key={t.tier} style={{
                      background:'var(--surface2)', borderRadius:8, padding:'10px 14px',
                      minWidth:140, borderLeft:`3px solid ${color}`,
                    }}>
                      <div style={{ fontSize:10, fontWeight:700, color, letterSpacing:'.4px', marginBottom:8 }}>
                        {t.tier.charAt(0) + t.tier.slice(1).toLowerCase()}
                      </div>
                      {/* Month active */}
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                        <span style={{ fontSize:10, color:'var(--muted)' }}>Active this month</span>
                        <span style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>
                          {t.thisMonth} <span style={{ fontWeight:400, color:'var(--muted)' }}>/ {t.total} members</span>
                          {t.total > 0 && <span style={{ marginLeft:5, fontSize:10, fontWeight:700, color: mRate >= 50 ? '#3fb950' : mRate >= 30 ? '#d29922' : '#f85149' }}>({mRate}%)</span>}
                        </span>
                      </div>
                      {/* This week */}
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:10, color:'var(--muted)' }}>Active this week</span>
                        <span style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>
                          {t.thisWeek}
                          {wD !== 0 && <span style={{ marginLeft:5, fontSize:10, fontWeight:700, color: wD > 0 ? '#3fb950' : '#f85149' }}>
                            ({wD > 0 ? '+' : ''}{wD} vs last week)
                          </span>}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )
      })()}

      {/* ── Campaign Command ── */}
      {campaigns !== null && (() => {
        const active    = campaigns.filter(c => c.status === 'active')
        const draft     = campaigns.filter(c => c.status === 'draft')
        const upcoming  = campaigns.filter(c => c.status === 'upcoming')
        const today     = new Date()
        const daysLeft  = (end) => {
          if (!end) return null
          const diff = Math.ceil((new Date(end) - today) / 86400000)
          return diff
        }
        return (
          <Card style={{ marginBottom: 24 }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid var(--border)', cursor:'pointer' }}
              onClick={() => setCampOpen(o => !o)}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--muted)', letterSpacing:'.5px', textTransform:'uppercase' }}>Campaign Command</span>
                <span style={{ fontSize:11, background:'#3fb95022', color:'#3fb950', borderRadius:20, padding:'2px 8px', fontWeight:700 }}>
                  {active.length} Active
                </span>
                {draft.length > 0 && (
                  <span style={{ fontSize:11, background:'#d2992222', color:'#d29922', borderRadius:20, padding:'2px 8px', fontWeight:700 }}>
                    {draft.length} Draft
                  </span>
                )}
                {upcoming.length > 0 && (
                  <span style={{ fontSize:11, background:'#58a6ff22', color:'#58a6ff', borderRadius:20, padding:'2px 8px', fontWeight:700 }}>
                    {upcoming.length} Upcoming
                  </span>
                )}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Btn size="sm" variant="ghost" onClick={e => { e.stopPropagation(); navigate('/campaigns') }}>View All</Btn>
                <span style={{ fontSize:12, color:'var(--muted)' }}>{campOpen ? '▲' : '▼'}</span>
              </div>
            </div>

            {campOpen && (
              <div style={{ padding:'14px 18px' }}>
                {/* Active Campaigns */}
                {active.length > 0 && (
                  <div style={{ marginBottom: draft.length + upcoming.length > 0 ? 16 : 0 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#3fb950', marginBottom:8, textTransform:'uppercase', letterSpacing:'.4px' }}>
                      ● Active Now
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {active.map(c => {
                        const dl = daysLeft(c.end_date)
                        const urgent = dl !== null && dl <= 3
                        return (
                          <div key={c.id} style={{
                            display:'flex', alignItems:'center', gap:12,
                            padding:'10px 12px', background:'var(--surface2)', borderRadius:8,
                            cursor:'pointer', borderLeft:'3px solid #3fb950',
                          }} onClick={() => navigate('/campaigns')}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontWeight:700, fontSize:13, color:'var(--text)', marginBottom:2 }}>{c.campaign_name}</div>
                              <div style={{ fontSize:11, color:'var(--muted)' }}>
                                {CAMP_TYPE_LABEL[c.campaign_type] || c.campaign_type}
                                {c.campaign_code && ` · ${c.campaign_code}`}
                              </div>
                            </div>
                            <div style={{ display:'flex', gap:16, alignItems:'center', flexShrink:0 }}>
                              <div style={{ textAlign:'center' }}>
                                <div style={{ fontSize:11, color:'var(--muted)', marginBottom:1 }}>Players</div>
                                <div style={{ fontSize:14, fontWeight:800, color:'var(--text)' }}>{c.playerCount}</div>
                              </div>
                              {c.budget_rm && (
                                <div style={{ textAlign:'center' }}>
                                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:1 }}>Budget</div>
                                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>RM {Number(c.budget_rm).toLocaleString()}</div>
                                </div>
                              )}
                              {dl !== null && (
                                <div style={{ textAlign:'center' }}>
                                  <div style={{ fontSize:11, color:'var(--muted)', marginBottom:1 }}>Ends</div>
                                  <div style={{ fontSize:13, fontWeight:700, color: urgent ? '#f85149' : '#3fb950' }}>
                                    {dl <= 0 ? 'Today' : `${dl}d left`}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Draft + Upcoming needing action */}
                {(draft.length + upcoming.length) > 0 && (
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#d29922', marginBottom:8, textTransform:'uppercase', letterSpacing:'.4px' }}>
                      ⚡ Needs Action
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {[...draft, ...upcoming].map(c => {
                        const dl = daysLeft(c.start_date)
                        const statusColor = CAMP_STATUS_COLOR[c.status] || 'var(--muted)'
                        return (
                          <div key={c.id} style={{
                            display:'flex', alignItems:'center', gap:12,
                            padding:'10px 12px', background:'var(--surface2)', borderRadius:8,
                            cursor:'pointer', borderLeft:`3px solid ${statusColor}`,
                          }} onClick={() => navigate('/campaigns')}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontWeight:700, fontSize:13, color:'var(--text)', marginBottom:2 }}>{c.campaign_name}</div>
                              <div style={{ fontSize:11, color:'var(--muted)' }}>
                                {CAMP_TYPE_LABEL[c.campaign_type] || c.campaign_type}
                                {c.campaign_code && ` · ${c.campaign_code}`}
                              </div>
                            </div>
                            <div style={{ display:'flex', gap:12, alignItems:'center', flexShrink:0 }}>
                              <span style={{
                                fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:20,
                                background: statusColor + '22', color: statusColor,
                              }}>{c.status.charAt(0).toUpperCase() + c.status.slice(1)}</span>
                              {c.status === 'draft' && (
                                <span style={{ fontSize:11, color:'#d29922', fontWeight:700 }}>→ Needs launch</span>
                              )}
                              {c.status === 'upcoming' && dl !== null && (
                                <span style={{ fontSize:11, color:'#58a6ff', fontWeight:700 }}>
                                  {dl <= 0 ? 'Starting today!' : `Starts in ${dl}d`}
                                </span>
                              )}
                              {c.budget_rm && (
                                <span style={{ fontSize:12, color:'var(--muted)' }}>RM {Number(c.budget_rm).toLocaleString()}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {campaigns.length === 0 && (
                  <div style={{ textAlign:'center', color:'var(--muted)', padding:'24px 0', fontSize:13 }}>
                    No active, draft, or upcoming campaigns — <span style={{ color:'var(--brand)', cursor:'pointer' }} onClick={() => navigate('/campaigns')}>Create one</span>
                  </div>
                )}
              </div>
            )}
          </Card>
        )
      })()}


      {/* ── Slipped Away ── */}
      {slipped !== null && slipped.length > 0 && (() => {
        const filtered = host === 'All' ? slipped : slipped.filter(v => v.host_assigned === host)
        if (filtered.length === 0) return null
        return (
          <Card style={{ marginBottom: 24 }}>
            <CardHeader onClick={() => setSlippedOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🌊</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Slipped Away</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>Active last month · 0 deposits this month</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Badge color="var(--warning)">{filtered.length}</Badge>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{slippedOpen ? '▲' : '▼'}</span>
                </div>
              </div>
            </CardHeader>
            {slippedOpen && (
              <CardBody>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['VIP', 'Tier', 'Last Deposit', 'Days Inactive', 'Risk', 'Action'].map(h => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(v => (
                        <tr key={v.id}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          style={{ transition: 'background .1s' }}
                        >
                          <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate(`/vips/${v.id}`)}>{v.username}</div>
                            {v.full_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{v.full_name}</div>}
                          </td>
                          <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}><TierBadge tier={v.tier} /></td>
                          <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>{timeAgo(v.last_deposit_date)}</td>
                          <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: v.days_inactive > 21 ? 'var(--danger)' : 'var(--muted)' }}>{v.days_inactive ?? '—'}d</td>
                          <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}><RiskBadge risk={v.churn_risk} /></td>
                          <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <Btn size="sm" variant="primary" onClick={() => setLogTarget(v)}>Log Contact</Btn>
                              <Btn size="sm" variant="ghost" onClick={() => navigate(`/vips/${v.id}`)}>Open</Btn>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            )}
          </Card>
        )
      })()}

      {/* ── My Open Tasks ── */}
      {myTasks !== null && myTasks.length > 0 && (() => {
        const PRIORITY_COLOR = { High: 'var(--danger)', Medium: 'var(--warning)', Low: 'var(--muted)' }
        const today = new Date().toISOString().slice(0, 10)
        return (
          <Card style={{ marginBottom: 24 }}>
            <CardHeader onClick={() => setTasksOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>My Open Tasks</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>Open & In Progress tasks</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Badge color={myTasks.filter(t => t.due_date && t.due_date < today).length > 0 ? 'var(--danger)' : 'var(--success)'}>
                    {myTasks.length}
                  </Badge>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tasksOpen ? '▲' : '▼'}</span>
                </div>
              </div>
            </CardHeader>
            {tasksOpen && (
              <CardBody>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {myTasks.map(task => {
                    const isOverdue = task.due_date && task.due_date < today
                    const pc = PRIORITY_COLOR[task.priority] || 'var(--muted)'
                    return (
                      <div key={task.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8,
                        borderLeft: `3px solid ${pc}`,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{task.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {task.task_type}
                            {task.vip_username && <> · <span style={{ color: 'var(--text)' }}>{task.vip_username}</span></>}
                            {task.vip_tier && <> · <TierBadge tier={task.vip_tier} /></>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                            background: pc + '22', color: pc,
                          }}>{task.priority}</span>
                          {task.due_date && (
                            <span style={{ fontSize: 11, color: isOverdue ? 'var(--danger)' : 'var(--muted)', fontWeight: isOverdue ? 700 : 400 }}>
                              {isOverdue ? '⚠ ' : ''}{task.due_date}
                            </span>
                          )}
                          <span style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 12,
                            background: task.status === 'In Progress' ? 'rgba(88,166,255,.15)' : 'var(--surface)',
                            color: task.status === 'In Progress' ? '#58a6ff' : 'var(--muted)',
                            border: '1px solid var(--border)',
                          }}>{task.status}</span>
                          <Btn size="sm" variant="ghost" onClick={() => navigate('/tasks')}>View</Btn>
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ textAlign: 'right', paddingTop: 4 }}>
                    <button onClick={() => navigate('/tasks')} style={{
                      background: 'none', border: 'none', color: 'var(--brand)', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                    }}>View all tasks →</button>
                  </div>
                </div>
              </CardBody>
            )}
          </Card>
        )
      })()}

      {/* ── Progress bar ── */
      <Card style={{ marginBottom: 24, padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {t('today.contactedToday')}
            <span style={{ marginLeft: 12, fontSize: 22, fontWeight: 700, color: 'var(--success)' }}>{contactedToday}</span>
            <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--muted)' }}>/ {contactedToday + needContact} VIPs</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {contactedToday + needContact > 0 ? Math.round(contactedToday / (contactedToday + needContact) * 100) : 0}{t('today.pctDone')}
          </div>
        </div>
        <div style={{ background: 'var(--surface2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, var(--success), #16a34a)',
            width: `${contactedToday + needContact > 0 ? Math.min(100, Math.round(contactedToday / (contactedToday + needContact) * 100)) : 0}%`,
            transition: 'width .4s',
          }} />
        </div>
      </Card>

      {/* ── Priority Queue ── */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span>{t('today.priorityTitle')}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { value: 'all', label: t('today.tabAll') },
                { value: 'overdue', label: t('today.tabOverdue').replace('{n}', overdue.length) },
                { value: 'follow', label: t('today.tabFollow').replace('{n}', followUp.length) },
                { value: 'risk', label: t('today.tabRisk').replace('{n}', atRisk.length) },
                { value: 'birthday', label: t('today.tabBirthday').replace('{n}', birthdays.length) },
              ].map(q => (
                <button key={q.value} onClick={() => setActiveQueue(q.value)} style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${activeQueue === q.value ? 'var(--brand)' : 'var(--border)'}`,
                  background: activeQueue === q.value ? 'var(--brand-dim)' : 'transparent',
                  color: activeQueue === q.value ? 'var(--brand)' : 'var(--muted)',
                  cursor: 'pointer', textTransform: 'none',
                }}>{q.label}</button>
              ))}
            </div>
          </div>
        </CardHeader>

        {displayItems.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>{t('today.allClear')}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{t('today.noItems')}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {[t('today.colVip'), t('today.colTier'), t('today.colTrigger'), t('today.colLastContact'), t('today.colLastDeposit'), t('today.colRisk'), t('today.colAction')].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', letterSpacing: '.3px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayItems.map((v, i) => {
                  const isContacted = contactedTodaySet.has(v.username)
                  const isBirthday = birthdays.some(b => b.id === v.id)
                  return (
                    <tr key={v.id}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      style={{ transition: 'background .1s', opacity: isContacted ? .6 : 1 }}
                    >
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}
                          onClick={() => navigate(`/vips/${v.id}`)}>{v.username}</div>
                        {v.full_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{v.full_name}</div>}
                        {isBirthday && <span style={{ fontSize: 10, color: '#EC4899' }}>{t('today.birthday')}</span>}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <TierBadge tier={v.tier} />
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: v._color || 'var(--text)',
                          background: (v._color || '#888') + '18',
                          padding: '3px 9px', borderRadius: 6,
                        }}>{v._reason || '—'}</span>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 12 }}>
                        {timeAgo(v.last_contacted || v.last_contact_date)}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        <div style={{ color: 'var(--text)' }}>{formatMoney(v.total_deposit, v.currency)}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{timeAgo(v.last_deposit_date)}</div>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <RiskBadge risk={v.churn_risk} />
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn size="sm" variant={isContacted ? 'ghost' : 'primary'}
                            onClick={() => setLogTarget(v)}>
                            {isContacted ? t('today.loggedBtn') : t('today.logContact')}
                          </Btn>
                          <Btn size="sm" variant="ghost" onClick={() => navigate(`/vips/${v.id}`)}>{t('today.openBtn')}</Btn>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Quick Log Modal ── */}
      <Modal open={!!logTarget} onClose={() => { setLogTarget(null); setLogNote('') }} title={t('today.modalTitle')} width={420}>
        {logTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{logTarget.full_name || logTarget.username}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t('today.outcome')}</label>
              <Select value={logOutcome} onChange={e => setLogOutcome(e.target.value)}>
                {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
              </Select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t('today.notesLabel')}</label>
              <Textarea value={logNote} onChange={e => setLogNote(e.target.value)} placeholder={t('today.notesPlaceholder')} rows={3} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => { setLogTarget(null); setLogNote('') }}>{t('common.cancel')}</Btn>
              <Btn variant="primary" onClick={submitLog} disabled={logSaving}>
                {logSaving ? t('today.savingLog') : t('today.saveLog')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
