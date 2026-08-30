import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { TIER_COLOR, TIER_BG, MONTHS } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { useUrlParam, useUrlParamNumber, useUrlParamBool } from '../hooks/useUrlParam'
import { useLanguage } from '../contexts/LanguageContext'

function daysUntilBirthday(birthdayStr) {
  if (!birthdayStr) return null
  const today = new Date()
  const bday  = new Date(birthdayStr)
  const next  = new Date(today.getFullYear(), bday.getMonth(), bday.getDate())
  if (next < today) next.setFullYear(today.getFullYear() + 1)
  return Math.ceil((next - today) / (1000 * 60 * 60 * 24))
}

function getAge(birthdayStr) {
  if (!birthdayStr) return null
  const bday  = new Date(birthdayStr)
  const today = new Date()
  let age = today.getFullYear() - bday.getFullYear()
  const m = today.getMonth() - bday.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < bday.getDate())) age--
  return age
}

function fmtBday(str) {
  if (!str) return '—'
  const d = new Date(str)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

const s = {
  page:    { padding:'24px 28px', minHeight:'100vh' },
  title:   { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' },
  td:      { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  badge:   { display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  tag:     { display:'inline-block', padding:'2px 9px', borderRadius:6, fontSize:11, fontWeight:600 },
  btn:     { background:'var(--accent)', color:'#fff', border:'none', padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm:   { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'6px 12px', borderRadius:7, fontSize:12, cursor:'pointer' },
  btnBlue: { background:'rgba(88,166,255,.15)', color:'#58a6ff', border:'1px solid rgba(88,166,255,.3)', padding:'5px 12px', borderRadius:7, fontSize:12, cursor:'pointer', fontWeight:600 },
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 },
  modal:   { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto' },
  mhdr:    { padding:'16px 22px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' },
  flbl:    { fontSize:11, color:'var(--muted)', marginBottom:4 },
  finput:  { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box' },
  fta:     { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box', fontFamily:'inherit', resize:'vertical' },
  g2:      { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 },
  g3:      { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 },
  frow:    { marginBottom:12 },
}

export default function BirthdayReminder() {
  const { profile }         = useAuth()
  const { t }               = useLanguage()
  const myName    = profile?.full_name || ''
  const [mineOnly, setMineOnly] = useUrlParamBool('mine', false)
  const navigate            = useNavigate()
  const [vips, setVips]     = useState([])
  const [gifts, setGifts]   = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useUrlParam('filter', 'upcoming') // upcoming | all | thismonth | past
  const [giftYear, setGiftYear] = useUrlParamNumber('year', new Date().getFullYear())
  const [tierF,  setTierF]    = useUrlParam('tier', 'ALL')
  const [search, setSearch]   = useUrlParam('search', '')
  const [modal,  setModal]    = useState(null) // { vip, gifts }
  const [giftForm, setGiftForm] = useState({ gift_type:'', gift_cost:'', bonus_given:'', service_cost:'', notes:'', contact_date:'' })
  const [saving, setSaving]   = useState(false)
  const [contactModal, setContactModal] = useState(null)
  const [contactForm, setContactForm]   = useState({ channel:'WhatsApp', outcome:'Contacted', notes:'' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: vipData } = await supabase
      .from('vip_members')
      .select('id, username, full_name, tier, birthday, phone, host_assigned, currency')
      .not('birthday', 'is', null)
      .eq('is_excluded', false)
      .order('tier')
    if (!vipData) { setLoading(false); return }

    const withDays = vipData.map(v => ({ ...v, daysUntil: daysUntilBirthday(v.birthday), age: getAge(v.birthday) }))
    setVips(withDays)

    // Load gift logs for this year
    const year = new Date().getFullYear()
    const { data: giftData } = await supabase
      .from('gift_logs')
      .select('*')
      .eq('birthday_year', year)
    if (giftData) {
      const map = {}
      giftData.forEach(g => { if (!map[g.username]) map[g.username] = []; map[g.username].push(g) })
      setGifts(map)
    }
    setLoading(false)
  }

  async function loadGiftsForVip(username) {
    const { data } = await supabase.from('gift_logs').select('*').eq('username', username).order('birthday_year', { ascending: false })
    return data || []
  }

  useEffect(() => {
    if (modal?.vip) openGiftModal(modal.vip, giftYear)
  }, [giftYear])

  async function openGiftModal(vip, year) {
    const yr = year || giftYear || new Date().getFullYear()
    if (!year) setGiftYear(yr)
    const history = await loadGiftsForVip(vip.username)
    const existing = history.find(g => g.birthday_year === yr)
    if (existing) {
      setGiftForm({ gift_type: existing.gift_type||'', gift_cost: existing.gift_cost||'', bonus_given: existing.bonus_given||'', service_cost: existing.service_cost||'', notes: existing.notes||'', contact_date: existing.contact_date||'' })
    } else {
      setGiftForm({ gift_type:'', gift_cost:'', bonus_given:'', service_cost:'', notes:'', contact_date: new Date().toISOString().slice(0,10) })
    }
    setModal({ vip, history, existingId: existing?.id })
  }

  async function saveGift() {
    if (!modal) return
    setSaving(true)
    const year = new Date().getFullYear()
    const payload = {
      vip_id:       modal.vip.id,
      username:     modal.vip.username,
      birthday_year: giftYear || year || new Date().getFullYear(),
      gift_type:    giftForm.gift_type || null,
      gift_cost:    parseFloat(giftForm.gift_cost) || 0,
      bonus_given:  parseFloat(giftForm.bonus_given) || 0,
      service_cost: parseFloat(giftForm.service_cost) || 0,
      total_spent:  (parseFloat(giftForm.gift_cost || 0) + parseFloat(giftForm.bonus_given || 0) + parseFloat(giftForm.service_cost || 0)),
      notes:        giftForm.notes || null,
      contacted:    true,
      contact_date: giftForm.contact_date || null,
      logged_by:    profile?.full_name || 'System',
    }
    if (modal.existingId) {
      await supabase.from('gift_logs').update(payload).eq('id', modal.existingId)
    } else {
      await supabase.from('gift_logs').insert(payload)
    }
    setSaving(false)
    setModal(null)
    loadData()
  }

  async function saveContactLog(vip) {
    const { data: { user } } = await supabase.auth.getUser()
    const myName = profile?.full_name || 'System'
    const { error } = await supabase.from('contact_logs').insert({
      vip_id:          vip.id,
      username:        vip.username,
      tier:            vip.tier,
      host_name:       myName,
      host_id:         user?.id || null,
      channel:         contactForm.channel,
      outcome:         contactForm.outcome,
      notes:           contactForm.notes || `Birthday greeting - ${new Date().getFullYear()}`,
      message_summary: contactForm.notes,
      direction:       'outbound',
      logged_at:       new Date().toISOString(),
      log_month:       new Date().toISOString().slice(0,7),
      log_week:        String(Math.ceil(new Date().getDate()/7)),
    })
    if (error) { alert('Save failed: ' + error.message); return }
    setContactModal(null)
    setContactForm({ channel:'WhatsApp', outcome:'Contacted', notes:'' })
  }

  const today = new Date()
  const filtered = vips.filter(v => {
    if (mineOnly && myName && v.host_assigned !== myName) return false
    if (tierF !== 'ALL' && v.tier !== tierF) return false
    if (search && !v.username.toLowerCase().includes(search.toLowerCase()) && !v.full_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'upcoming') return v.daysUntil !== null && v.daysUntil <= 30
    if (filter === 'all') return true // show ALL members
    if (filter === 'past') return new Date(v.birthday).getMonth() + 1 <= new Date().getMonth() + 1
    if (filter === 'thismonth') {
      const bday = new Date(v.birthday)
      return bday.getMonth() === today.getMonth()
    }
    return true
  }).sort((a, b) => (a.daysUntil ?? 999) - (b.daysUntil ?? 999))

  const upcoming7  = vips.filter(v => v.daysUntil !== null && v.daysUntil <= 7).length
  const upcoming30 = vips.filter(v => v.daysUntil !== null && v.daysUntil <= 30).length
  const thisMonth  = vips.filter(v => { const b = new Date(v.birthday); return b.getMonth() === today.getMonth() }).length
  const gifted     = Object.keys(gifts).length

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>🎂 {t('birthdayReminder.title')}</div>
          <div style={s.sub}>{vips.length} {t('birthdayReminder.subtitle')}</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {[
          { label: t('birthdayReminder.thisWeek'),       val: upcoming7,  color:'#f85149' },
          { label: t('birthdayReminder.next30Days'),     val: upcoming30, color:'#f0883e' },
          { label: t('birthdayReminder.thisMonth'),      val: thisMonth,  color:'#3fb950' },
          { label: t('birthdayReminder.giftedThisYear'), val: gifted,     color:'#ffd700' },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ ...s.card, padding:'14px 18px' }}>
            <div style={{ fontSize:26, fontWeight:800, color }}>{val}</div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        {[
          ['upcoming', `🔔 ${t('birthdayReminder.filterUpcoming')}`],
          ['thismonth', `📅 ${t('birthdayReminder.filterThisMonth')}`],
          ['all', `👥 ${t('birthdayReminder.filterAll')}`],
          ['past', `📖 ${t('birthdayReminder.filterPast')}`],
        ].map(([key,label]) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            padding:'6px 14px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer',
            border:`1px solid ${filter===key?'var(--accent)':'var(--border)'}`,
            background: filter===key?'rgba(99,102,241,.15)':'var(--surface)',
            color: filter===key?'var(--accent)':'var(--muted)',
          }}>{label}</button>
        ))}
        <button onClick={() => setMineOnly(m => !m)} style={{ background:mineOnly?'var(--accent)':'var(--surface2)', color:mineOnly?'#fff':'var(--text)', border:mineOnly?'none':'1px solid var(--border)', padding:'6px 12px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
          {mineOnly ? '★ Mine' : '☆ Mine'}
        </button>
        <select style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'6px 10px', borderRadius:8, fontSize:13, outline:'none' }} value={tierF} onChange={e => setTierF(e.target.value)}>
          <option value="ALL">{t('birthdayReminder.allTiers')}</option>
          {['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(t => <option key={t}>{t}</option>)}
        </select>
        <input style={{ ...s.finput, width:180 }} placeholder={t('birthdayReminder.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
        <span style={{ marginLeft:'auto', fontSize:12, color:'var(--muted)' }}>{filtered.length} {t('birthdayReminder.shown')}</span>
      </div>

      {/* Table */}
      <div style={{ ...s.card, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={s.tbl}>
            <thead>
              <tr>
                {[
                  '#',
                  t('birthdayReminder.colUsername'),
                  t('birthdayReminder.colTier'),
                  t('birthdayReminder.colBirthday'),
                  t('birthdayReminder.colAge'),
                  t('birthdayReminder.colDaysAway'),
                  t('birthdayReminder.colThisYearGift'),
                  t('birthdayReminder.colTotalSpent'),
                  t('birthdayReminder.colContacted'),
                  t('birthdayReminder.colActions'),
                ].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ ...s.td, textAlign:'center', padding:40, color:'var(--muted)' }}>{t('birthdayReminder.loading')}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} style={{ ...s.td, textAlign:'center', padding:40, color:'var(--muted)' }}>{t('birthdayReminder.noResults')}</td></tr>
              ) : filtered.map((v, i) => {
                const days     = v.daysUntil
                const isToday  = days === 0
                const isSoon   = days !== null && days <= 7
                const thisYearGifts = gifts[v.username] || []
                const gifted   = thisYearGifts.length > 0
                const totalSpent = thisYearGifts.reduce((s, g) => s + (g.total_spent || 0), 0)
                return (
                  <tr key={v.id}
                    style={{ background: isToday ? 'rgba(255,215,0,.08)' : isSoon ? 'rgba(255,215,0,.04)' : 'transparent', cursor:'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = isToday ? 'rgba(255,215,0,.08)' : isSoon ? 'rgba(255,215,0,.04)' : 'transparent'}
                    onClick={() => navigate(`/vips/${v.id}`)}>
                    <td style={{ ...s.td, color:'var(--muted)', fontSize:11 }}>{i+1}</td>
                    <td style={{ ...s.td, fontWeight:700 }}>
                      {isToday && <span style={{ marginRight:6 }}>🎂</span>}
                      {v.username}
                    </td>
                    <td style={s.td}><span style={{ ...s.badge, background:TIER_BG[v.tier], color:TIER_COLOR[v.tier] }}>{v.tier}</span></td>
                    <td style={{ ...s.td, fontWeight:600 }}>{fmtBday(v.birthday)}</td>
                    <td style={{ ...s.td, color:'var(--muted)', fontSize:12 }}>{v.age ? `${v.age} yrs` : '—'}</td>
                    <td style={s.td}>
                      {isToday
                        ? <span style={{ color:'#ffd700', fontWeight:700 }}>🎉 TODAY!</span>
                        : days !== null
                          ? <span style={{ color: days<=7?'#f85149':days<=14?'#f0883e':'var(--muted)', fontWeight: days<=7?700:400 }}>{days}d</span>
                          : '—'
                      }
                    </td>
                    <td style={s.td}>
                      {gifted
                        ? <span style={{ fontSize:12, color:'#3fb950' }}>✓ {thisYearGifts[0].gift_type || 'Gift logged'}</span>
                        : <span style={{ fontSize:12, color:'var(--muted)' }}>—</span>
                      }
                    </td>
                    <td style={{ ...s.td, fontSize:12, color: totalSpent > 0 ? '#ffd700' : 'var(--muted)' }}>
                      {totalSpent > 0 ? formatMoney(totalSpent, v.currency) : '—'}
                    </td>
                    <td style={s.td}>
                      {gifted && gifts[v.username]?.[0]?.contacted
                        ? <span style={{ fontSize:11, color:'#3fb950', fontWeight:600 }}>✓ Yes</span>
                        : <span style={{ fontSize:11, color:'var(--muted)' }}>—</span>
                      }
                    </td>
                    <td style={s.td} onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button style={s.btnBlue} onClick={() => { setContactModal(v); setContactForm({ channel:'WhatsApp', outcome:'Contacted', notes:`Happy Birthday! 🎂` }) }}>
                          {t('birthdayReminder.contact')}
                        </button>
                        <button style={{ ...s.btnSm, borderColor:'#ffd700', color:'#ffd700', background:'rgba(255,215,0,.08)' }}
                          onClick={() => openGiftModal(v)}>
                          {gifted ? t('birthdayReminder.editGift') : t('birthdayReminder.logGift')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gift Modal */}
      {modal && (
        <div style={s.overlay} onClick={() => setModal(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.mhdr}>
              <div>
                <div style={{ fontSize:16, fontWeight:700 }}>🎁 {t('birthdayReminder.giftLogTitle')} — {modal.vip.username}</div>
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:2, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span>{fmtBday(modal.vip.birthday)} · Age {modal.vip.age}</span>
                  <span style={{ color:'var(--accent)' }}>{t('birthdayReminder.year')}:</span>
                  <select style={{ background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'3px 8px', borderRadius:6, fontSize:12, outline:'none' }}
                    value={giftYear} onChange={e => setGiftYear(parseInt(e.target.value))}>
                    {Array.from({length:5},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={() => setModal(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:20, cursor:'pointer' }}>✕</button>
            </div>
            <div style={{ padding:'18px 22px' }}>
              <div style={s.frow}>
                <div style={s.flbl}>{t('birthdayReminder.giftType')}</div>
                <input style={s.finput} value={giftForm.gift_type} onChange={e => setGiftForm({...giftForm, gift_type:e.target.value})} placeholder="e.g. Ang Pao, Cake, Voucher, Watch..." />
              </div>
              <div style={{ ...s.g3, marginBottom:12 }}>
                <div>
                  <div style={s.flbl}>{t('birthdayReminder.giftCost')}</div>
                  <input type="number" style={s.finput} value={giftForm.gift_cost} onChange={e => setGiftForm({...giftForm, gift_cost:e.target.value})} placeholder="0" />
                </div>
                <div>
                  <div style={s.flbl}>{t('birthdayReminder.bonusGiven')}</div>
                  <input type="number" style={s.finput} value={giftForm.bonus_given} onChange={e => setGiftForm({...giftForm, bonus_given:e.target.value})} placeholder="0" />
                </div>
                <div>
                  <div style={s.flbl}>{t('birthdayReminder.otherCost')}</div>
                  <input type="number" style={s.finput} value={giftForm.service_cost} onChange={e => setGiftForm({...giftForm, service_cost:e.target.value})} placeholder="0" />
                </div>
              </div>
              <div style={{ ...s.g2, marginBottom:12 }}>
                <div>
                  <div style={s.flbl}>{t('birthdayReminder.contactDate')}</div>
                  <input type="date" style={s.finput} value={giftForm.contact_date} onChange={e => setGiftForm({...giftForm, contact_date:e.target.value})} />
                </div>
                <div style={{ display:'flex', alignItems:'flex-end', paddingBottom:2 }}>
                  <div style={{ fontSize:13, color:'var(--muted)' }}>
                    {t('birthdayReminder.total')}: <strong style={{ color:'#ffd700' }}>
                      {formatMoney((parseFloat(giftForm.gift_cost)||0) + (parseFloat(giftForm.bonus_given)||0) + (parseFloat(giftForm.service_cost)||0), modal.vip?.currency)}
                    </strong>
                  </div>
                </div>
              </div>
              <div style={s.frow}>
                <div style={s.flbl}>{t('birthdayReminder.notes')}</div>
                <textarea style={{ ...s.fta, marginTop:0 }} rows={3} value={giftForm.notes} onChange={e => setGiftForm({...giftForm, notes:e.target.value})} placeholder="VIP reaction, preferences, anything to remember..." />
              </div>

              {/* History */}
              {modal.history?.length > 0 && (
                <div style={{ marginTop:8, borderTop:'1px solid var(--border)', paddingTop:12 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>{t('birthdayReminder.previousYears')}</div>
                  {modal.history.filter(g => g.birthday_year !== new Date().getFullYear()).map(g => (
                    <div key={g.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                      <span style={{ color:'var(--muted)' }}>{g.birthday_year}</span>
                      <span>{g.gift_type || '—'}</span>
                      <span style={{ color:'#ffd700' }}>{formatMoney(g.total_spent, modal.vip?.currency)}</span>
                      {g.notes && <span style={{ color:'var(--muted)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.notes}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Past gift history */}
              {modal.history && modal.history.length > 0 && (
                <div style={{ marginTop:14, borderTop:'1px solid var(--border)', paddingTop:12 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', marginBottom:8, letterSpacing:'.5px' }}>📚 {t('birthdayReminder.giftHistory')}</div>
                  {modal.history.map((g) => (
                    <div key={g.id} onClick={() => setGiftYear(g.birthday_year)}
                      style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', borderRadius:7,
                        background: g.birthday_year===giftYear ? 'rgba(99,102,241,.12)' : 'var(--surface2)',
                        border: `1px solid ${g.birthday_year===giftYear ? 'var(--accent)' : 'var(--border)'}`,
                        marginBottom:5, cursor:'pointer', flexWrap:'wrap' }}>
                      <span style={{ fontSize:12, fontWeight:700, color: g.birthday_year===giftYear?'var(--accent)':'var(--muted)', minWidth:40 }}>{g.birthday_year}</span>
                      <span style={{ fontSize:12, flex:1, color:'var(--text)' }}>{g.gift_type||'—'}</span>
                      {g.gift_cost>0 && <span style={{ fontSize:11, color:'#ffd700' }}>🎁 {formatMoney(g.gift_cost, modal.vip?.currency)}</span>}
                      {g.bonus_given>0 && <span style={{ fontSize:11, color:'#3fb950' }}>💰 {formatMoney(g.bonus_given, modal.vip?.currency)}</span>}
                      {g.contact_date && <span style={{ fontSize:10, color:'var(--muted)' }}>{new Date(g.contact_date).toLocaleDateString('en-MY',{day:'numeric',month:'short'})}</span>}
                      {g.birthday_year===giftYear && <span style={{ fontSize:10, color:'var(--accent)', fontWeight:600 }}>✎ editing</span>}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display:'flex', gap:8, marginTop:16 }}>
                <button style={{ ...s.btn, opacity:saving?0.6:1 }} onClick={saveGift} disabled={saving}>{saving ? t('birthdayReminder.saving') : t('birthdayReminder.saveGiftLog')}</button>
                <button style={s.btnSm} onClick={() => setModal(null)}>{t('birthdayReminder.cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Modal */}
      {contactModal && (
        <div style={s.overlay} onClick={() => setContactModal(null)}>
          <div style={{ ...s.modal, maxWidth:440 }} onClick={e => e.stopPropagation()}>
            <div style={s.mhdr}>
              <div style={{ fontSize:16, fontWeight:700 }}>{t('birthdayReminder.logBirthdayContact')} — {contactModal.username}</div>
              <button onClick={() => setContactModal(null)} style={{ background:'none', border:'none', color:'var(--muted)', fontSize:20, cursor:'pointer' }}>✕</button>
            </div>
            <div style={{ padding:'18px 22px' }}>
              <div style={{ ...s.g2, marginBottom:12 }}>
                <div>
                  <div style={s.flbl}>{t('birthdayReminder.contactType')}</div>
                  <select style={{ ...s.finput, marginTop:0 }} value={contactForm.channel} onChange={e => setContactForm({...contactForm, channel:e.target.value})}>
                    {['WhatsApp','Call','In-person','Other'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <div style={s.flbl}>{t('birthdayReminder.outcome')}</div>
                  <select style={{ ...s.finput, marginTop:0 }} value={contactForm.outcome} onChange={e => setContactForm({...contactForm, outcome:e.target.value})}>
                    {['Contacted','No Reply','Replied','Deposited'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div style={s.frow}>
                <div style={s.flbl}>{t('birthdayReminder.notes')}</div>
                <textarea style={{ ...s.fta, marginTop:4 }} rows={3} value={contactForm.notes} onChange={e => setContactForm({...contactForm, notes:e.target.value})} />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button style={s.btn} onClick={() => saveContactLog(contactModal)}>{t('birthdayReminder.saveLog')}</button>
                <button style={s.btnSm} onClick={() => setContactModal(null)}>{t('birthdayReminder.cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
