// src/pages/Today.jsx — Command Center / Today (V2)
import { useState, useEffect, lazy, Suspense } from 'react'
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

const FollowUpTab = lazy(() => import('./FollowUp'))
const RetentionQueueTab = lazy(() => import('./RetentionQueue'))

const MAIN_TABS = [
  { key: 'today',     label: '📅 Today', zh: '📅 今天' },
  { key: 'followup',  label: '📞 Follow Up', zh: '📞 跟进' },
  { key: 'retention', label: '🎯 Retention Queue', zh: '🎯 留存队列' },
]

function TabBar({ active, onChange }) {
  const { lang } = useLanguage()
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
      {MAIN_TABS.map(tab => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          style={{ padding: '9px 18px', background: 'none', border: 'none', borderBottom: active === tab.key ? '2px solid var(--accent)' : '2px solid transparent', color: active === tab.key ? 'var(--accent)' : 'var(--muted)', fontWeight: active === tab.key ? 700 : 400, fontSize: 13, cursor: 'pointer', marginBottom: -1, transition: 'color .15s' }}>
          {lang === 'zh' ? tab.zh : tab.label}
        </button>
      ))}
    </div>
  )
}

const OUTCOMES = ['Contacted', 'No Reply', 'Replied', 'Deposited', 'Reactivated']
const OUTCOME_ZH = { Contacted: '已联系', 'No Reply': '未回复', Replied: '已回复', Deposited: '已存款', Reactivated: '已召回' }
const TIER_ZH = { BLACK: '黑金', DIAMOND: '钻石', PLATINUM: '白金', GOLD: '黄金', SILVER: '白银', BRONZE: '青铜' }
// Display-only translation of queue trigger labels produced by useDashboard
const REASON_ZH = {
  '🎂 Birthday today': '🎂 今天生日', '🔴 Critical risk': '🔴 严重风险', '⚠️ High risk': '⚠️ 高风险',
  '🔴 Lost yesterday': '🔴 昨日输钱', '⚡ 2-3 day gap': '⚡ 2-3天未活跃', '📅 Follow-up due': '📅 待跟进',
}
const TIER_ORDER = { BLACK:0, DIAMOND:1, PLATINUM:2, GOLD:3, SILVER:4, BRONZE:5 }

function timeAgo(d, lang = 'en') {
  if (!d) return '—'
  const zh = lang === 'zh'
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000)
  if (diff === 0) return zh ? '今天' : 'Today'
  if (diff === 1) return zh ? '昨天' : 'Yesterday'
  return zh ? `${diff}天前` : `${diff}d ago`
}

export default function Today() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast, ToastContainer } = useToast()
  const { t, lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [mainTab, setMainTab] = useState('today')
  const [host, setHost] = useState('All')
  const [tierFilter, setTierFilter] = useState(['PLATINUM','DIAMOND'])
  const [activeQueue, setActiveQueue] = useState('all')
  const [hostList, setHostList] = useState(['All'])
  const TIER_OPTS = ['DIAMOND','PLATINUM','GOLD','SILVER','BRONZE']
  function toggleTier(tier) {
    setTierFilter(prev => {
      if (tier === 'ALL') return []
      const next = prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier]
      return next
    })
  }

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

  // WA reload alerts
  const [waAlerts, setWaAlerts] = useState([])
  const [waNumbers, setWaNumbers] = useState([])
  useEffect(() => {
    if (!profile) return
    const myName = profile.full_name || profile.username || ''
    if (!myName) return
    const today = new Date(); today.setHours(0,0,0,0)
    supabase.from('wa_numbers')
      .select('id, codename, number, telco, status, last_reload_date, valid_until')
      .eq('host', myName)
      .in('status', ['Active', 'Cooling', 'Standby'])
      .then(({ data }) => {
        const all = data || []
        setWaNumbers(all.filter(n => n.status === 'Active'))
        const alerts = all.filter(n => {
          if (!['Active','Cooling'].includes(n.status)) return false
          let urgent = false, warn = false
          if (n.last_reload_date) {
            const days = Math.floor((today - new Date(n.last_reload_date)) / 86400000)
            if (days >= 30) urgent = true
            else if (days >= 25) warn = true
          }
          if (n.valid_until) {
            const daysLeft = Math.floor((new Date(n.valid_until) - today) / 86400000)
            if (daysLeft <= 7) urgent = true
          }
          return urgent || warn
        }).map(n => {
          let level = 'warn'
          if (n.last_reload_date) {
            const days = Math.floor((today - new Date(n.last_reload_date)) / 86400000)
            if (days >= 30) level = 'urgent'
          }
          if (n.valid_until) {
            const daysLeft = Math.floor((new Date(n.valid_until) - today) / 86400000)
            if (daysLeft <= 7) level = 'urgent'
          }
          return { ...n, level }
        })
        setWaAlerts(alerts)
      })
  }, [profile])

  // Quick-log modal
  const [logTarget, setLogTarget] = useState(null)
  const [logOutcome, setLogOutcome] = useState('Replied')
  const [logNote, setLogNote] = useState('')
  const [logWaNumber, setLogWaNumber] = useState('')
  const [logSaving, setLogSaving] = useState(false)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? L2('Good morning', '早上好') : hour < 18 ? L2('Good afternoon', '下午好') : L2('Good evening', '晚上好')
  const dateStr = now.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' })

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
      wa_number_used: logWaNumber || null,
    })
    setLogSaving(false)
    if (err) { toast(L2('Failed to log contact: ', '记录联系失败：') + err.message, 'error'); return }
    // Sync last_contacted on vip_members
    const _now = new Date().toISOString()
    await supabase.from('vip_members').update({ last_contacted: _now, last_contact_date: _now.slice(0,10) }).eq('id', logTarget.id)
    toast(L2(`Logged: ${logTarget.username} — ${logOutcome}`, `已记录：${logTarget.username} — ${OUTCOME_ZH[logOutcome] || logOutcome}`), 'success')
    setLogTarget(null); setLogNote(''); setLogOutcome('Replied'); setLogWaNumber('')
    refresh()
  }

  // Tier filter helper
  const applyTier = arr => tierFilter.length === 0 ? arr : arr.filter(v => tierFilter.includes((v.tier||'').toUpperCase()))

  // Queue data
  const queueMap = {
    all: applyTier(priorityQueue),
    overdue: applyTier(overdue),
    follow: applyTier(followUp),
    risk: applyTier(atRisk),
    birthday: applyTier(birthdays),
  }
  const displayItems = (queueMap[activeQueue] || applyTier(priorityQueue)).slice(0, 30)

  if (loading) return <div style={{ padding: 32 }}><LoadingState message={L2("Loading today's work…", '载入今日工作中…')} /></div>
  if (error) return <div style={{ padding: 32 }}><ErrorState message={error} onRetry={refresh} /></div>

  // Sub-tab shortcut renders — bypass dashboard data for non-today tabs
  if (mainTab === 'followup') return (
    <div style={{ padding: '24px 28px' }}>
      <TabBar active={mainTab} onChange={setMainTab} />
      <Suspense fallback={<LoadingState />}><FollowUpTab /></Suspense>
    </div>
  )
  if (mainTab === 'retention') return (
    <div style={{ padding: '24px 28px' }}>
      <TabBar active={mainTab} onChange={setMainTab} />
      <Suspense fallback={<LoadingState />}><RetentionQueueTab /></Suspense>
    </div>
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      <ToastContainer />
      <TabBar active={mainTab} onChange={setMainTab} />

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
              {greeting}{L2(', ', '，')}{profile?.full_name?.split(' ')[0] || L2('there', '')}
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
            options={hostList.map(h => ({ value: h, label: h === 'All' ? L2('All Hosts', '全部负责人') : h }))}
            active={host}
            onChange={setHost}
          />
        </div>

        {/* Tier filter */}
        <div style={{ marginTop: 10, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginRight:4 }}>{L2('Tier:', '等级：')}</span>
          <button
            onClick={() => setTierFilter([])}
            style={{
              padding:'3px 11px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
              border:`1px solid ${tierFilter.length===0?'var(--brand)':'var(--border)'}`,
              background: tierFilter.length===0?'var(--brand-dim)':'transparent',
              color: tierFilter.length===0?'var(--brand)':'var(--muted)',
            }}
          >{L2('All', '全部')}</button>
          {TIER_OPTS.map(tier => {
            const active = tierFilter.includes(tier)
            return (
              <button key={tier} onClick={() => toggleTier(tier)} style={{
                padding:'3px 11px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
                border:`1px solid ${active?'var(--brand)':'var(--border)'}`,
                background: active?'var(--brand-dim)':'transparent',
                color: active?'var(--brand)':'var(--muted)',
              }}>{L2(tier.charAt(0)+tier.slice(1).toLowerCase(), TIER_ZH[tier] || tier)}</button>
            )
          })}
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

      {/* ── Progress bar ── */}
      <Card style={{ marginBottom: 24, padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {t('today.contactedToday')}
            <span style={{ marginLeft: 12, fontSize: 22, fontWeight: 700, color: 'var(--success)' }}>{contactedToday}</span>
            <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--muted)' }}>/ {contactedToday + needContact} {L2('VIPs', '位VIP')}</span>
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

      {/* ── WA Reload Alerts ── */}
      {waAlerts.length > 0 && (
        <div style={{ background: waAlerts.some(a=>a.level==='urgent') ? 'rgba(248,81,73,.1)' : 'rgba(210,153,34,.1)', border: `1px solid ${waAlerts.some(a=>a.level==='urgent') ? 'rgba(248,81,73,.4)' : 'rgba(210,153,34,.4)'}`, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: waAlerts.some(a=>a.level==='urgent') ? '#f85149' : '#d29922', marginBottom: 8 }}>
            📱 {waAlerts.some(a=>a.level==='urgent') ? L2('🚨 URGENT', '🚨 紧急') : '⚠️'} {L2('WA Number Reload Reminder', 'WA号码充值提醒')} ({waAlerts.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {waAlerts.map(n => (
              <span key={n.id} style={{ display:'inline-flex', alignItems:'center', gap:5, background: n.level==='urgent'?'rgba(248,81,73,.15)':'rgba(210,153,34,.15)', border:`1px solid ${n.level==='urgent'?'rgba(248,81,73,.5)':'rgba(210,153,34,.5)'}`, borderRadius:7, padding:'4px 10px', fontSize:11 }}>
                <span style={{ fontWeight:700, color: n.level==='urgent'?'#f85149':'#d29922' }}>{n.codename}</span>
                <span style={{ color:'var(--muted)' }}>{n.number}</span>
                {n.last_reload_date && <span style={{ color:'var(--muted)' }}>· {L2(`${Math.floor((new Date()-new Date(n.last_reload_date))/86400000)}d since reload`, `距上次充值${Math.floor((new Date()-new Date(n.last_reload_date))/86400000)}天`)}</span>}
              </span>
            ))}
          </div>
          <div style={{ marginTop:8, fontSize:11, color:'var(--muted)' }}>
            {L2('Go to ', '前往 ')}<a href="/wa-numbers" style={{ color:'var(--accent)' }}>{L2('WA Numbers', 'WA号码')}</a>{L2(' to update reload dates.', ' 更新充值日期。')}
          </div>
        </div>
      )}

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
                        }}>{(lang === 'zh' && REASON_ZH[v._reason]) || v._reason || '—'}</span>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 12 }}>
                        {timeAgo(v.last_contacted || v.last_contact_date, lang)}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        {v.last_deposit_date
                          ? <><div style={{ color:'var(--text)', fontWeight:600 }}>{new Date(v.last_deposit_date).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY',{day:'2-digit',month:'short',year:'numeric'})}</div><div style={{ fontSize:11, color:'var(--muted)' }}>{timeAgo(v.last_deposit_date, lang)}</div></>
                          : <span style={{ color:'var(--muted)' }}>—</span>}
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
            <div style={{ fontSize: 14, fontWeight: 600 }}>{(logTarget.full_name && logTarget.full_name !== '(Name)') ? logTarget.full_name : logTarget.username}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t('today.outcome')}</label>
              <Select value={logOutcome} onChange={e => setLogOutcome(e.target.value)}>
                {OUTCOMES.map(o => <option key={o} value={o}>{L2(o, OUTCOME_ZH[o])}</option>)}
              </Select>
            </div>
            {waNumbers.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('📱 Send as (WA number)', '📱 发送号码 (WA)')}</label>
                <Select value={logWaNumber} onChange={e => setLogWaNumber(e.target.value)}>
                  <option value="">{L2('— Not specified —', '— 未指定 —')}</option>
                  {waNumbers.map(n => <option key={n.id} value={n.codename}>{n.codename} ({n.number}{n.telco ? ' · '+n.telco : ''})</option>)}
                </Select>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t('today.notesLabel')}</label>
              <Textarea value={logNote} onChange={e => setLogNote(e.target.value)} placeholder={t('today.notesPlaceholder')} rows={3} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => { setLogTarget(null); setLogNote(''); setLogWaNumber('') }}>{t('common.cancel')}</Btn>
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
