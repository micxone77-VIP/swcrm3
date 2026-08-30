// KPIProgress v2 — Full KPI framework with weights, auto+manual, multi-user comparison
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  KPI_FRAMEWORK, ALL_ITEMS, TOTAL_WEIGHT,
  getScore, getStatusColor, getStatusLabel,
  loadKpiAutoData, loadKpiManualData,
  getActualFromMaps, hasManualEntry,
} from '../lib/kpi'
import { MONTHS, MONTHS_CN } from '../lib/constants'
import { useUrlParam, useUrlParamNumber } from '../hooks/useUrlParam'
import { useLanguage } from '../contexts/LanguageContext'

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page:     { padding:'24px 28px', minHeight:'100vh', color:'var(--text)' },
  title:    { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:      { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:20 },
  card:     { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, marginBottom:16 },
  cardHdr:  { padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' },
  cardBody: { padding:'18px 20px' },
  input:    { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:7, fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' },
  textarea: { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:7, fontSize:12, outline:'none', width:'100%', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit' },
  btn:      (c='var(--accent)', disabled=false) => ({ background: disabled?'var(--border)':c, color: disabled?'var(--muted)':'#fff', border:'none', padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor: disabled?'not-allowed':'pointer' }),
  btnSm:    { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  tag:      (c) => ({ display:'inline-block', padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:700, background: c+'22', color:c, border:`1px solid ${c}44` }),
  bar:      (pct, color) => ({ height:6, borderRadius:3, width:`${Math.min(100,pct*100)}%`, background:color, transition:'width .5s', minWidth: pct>0?4:0 }),
  barWrap:  { height:6, background:'var(--surface2)', borderRadius:3, overflow:'hidden', flex:1 },
  catHdr:   (color) => ({ display:'flex', alignItems:'center', gap:10, padding:'10px 20px', background:color+'11', borderBottom:`2px solid ${color}33` }),
}

// ── Score Ring Component ───────────────────────────────────────────────────────
function ScoreRing({ score, maxScore, label, color, size=80 }) {
  const pct = maxScore ? score / maxScore : 0
  const r = (size/2) - 8
  const circ = 2 * Math.PI * r
  const dash = circ * Math.min(1, pct)
  return (
    <div style={{ textAlign:'center', width:size }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={6} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition:'stroke-dasharray .6s' }} />
      </svg>
      <div style={{ marginTop:-size*0.65, fontSize: size>70?20:15, fontWeight:800, color }}>{score.toFixed(1)}</div>
      <div style={{ marginTop: size*0.35, fontSize:10, color:'var(--muted)' }}>{label}</div>
    </div>
  )
}

// ── KPI Item Row ──────────────────────────────────────────────────────────────
function KPIRow({ item, actual, onEdit, isEditing, editValue, onEditChange, onSave, onCancel, noteValue, onNoteChange, isMine, compact=false, isOverridden, onResetToAuto }) {
  const { t } = useLanguage()
  const color  = getStatusColor(actual, item.target)
  const score  = getScore(actual, item.target, item.weight)
  const pctVal = item.target ? Math.min(1, actual / item.target) : 0

  return (
    <div style={{ padding: compact?'10px 20px':'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
      <div style={{ fontSize:18, width:28, textAlign:'center', flexShrink:0 }}>{item.icon}</div>
      <div style={{ flex:2, minWidth:160 }}>
        <div style={{ fontSize:13, fontWeight:600 }}>{item.label}</div>
        <div style={{ fontSize:11, color:'var(--muted)', marginTop:1 }}>{item.desc}</div>
        {item.source === 'auto' && !isOverridden && <span style={{ ...s.tag('#06b6d4'), fontSize:10, marginTop:3, display:'inline-block' }}>{t('kpi.sourceAuto')}</span>}
        {item.source === 'auto' && isOverridden && <span style={{ ...s.tag('#f0883e'), fontSize:10, marginTop:3, display:'inline-block' }}>{t('kpi.sourceOverridden')}</span>}
        {item.source === 'manual' && <span style={{ ...s.tag('#8b5cf6'), fontSize:10, marginTop:3, display:'inline-block' }}>{t('kpi.sourceManual')}</span>}
      </div>
      <div style={{ flex:3, minWidth:140 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={s.barWrap}><div style={s.bar(pctVal, color)} /></div>
          <span style={{ fontSize:11, color, fontWeight:700, minWidth:36 }}>{Math.round(pctVal*100)}%</span>
        </div>
      </div>
      <div style={{ minWidth:90, textAlign:'right' }}>
        {isEditing && isMine ? (
          <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'flex-end' }}>
            <input type="number" style={{ ...s.input, width:90, textAlign:'right' }}
              value={editValue} onChange={e => onEditChange(e.target.value)}
              onKeyDown={e => { if(e.key==='Enter') onSave(); if(e.key==='Escape') onCancel() }}
              autoFocus />
            <input style={{ ...s.input, width:90, fontSize:11 }}
              value={noteValue} onChange={e => onNoteChange(e.target.value)}
              placeholder={t('kpi.notesPlaceholder')} />
            <div style={{ display:'flex', gap:4 }}>
              <button style={{ ...s.btn('#3fb950'), padding:'3px 8px', fontSize:11 }} onClick={onSave}>{t('common.save')}</button>
              <button style={{ ...s.btnSm, padding:'3px 8px', fontSize:11 }} onClick={onCancel}>{t('common.cancel')}</button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize:14, fontWeight:700, color }}>{item.fmt(actual)}</div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>{t('kpi.actualVsTarget', { target: item.fmt(item.target) })}</div>
          </div>
        )}
      </div>
      <div style={{ minWidth:60, textAlign:'center' }}>
        <div style={{ fontSize:15, fontWeight:700, color }}>{score.toFixed(1)}</div>
        <div style={{ fontSize:10, color:'var(--muted)' }}>{t('kpi.perWeight', { n: item.weight })}</div>
      </div>
      <div style={{ minWidth:60, textAlign:'center' }}>
        <span style={{ ...s.tag(color), fontSize:11 }}>{getStatusLabel(actual, item.target, t)}</span>
      </div>
      {isMine && item.source === 'manual' && !isEditing && (
        <button style={{ ...s.btnSm, padding:'4px 10px', fontSize:11 }} onClick={onEdit}>{t('kpi.fillIn')}</button>
      )}
      {isMine && item.source === 'auto' && !isEditing && !isOverridden && (
        <button style={{ ...s.btnSm, padding:'4px 10px', fontSize:11 }} onClick={onEdit}>{t('kpi.override')}</button>
      )}
      {isMine && item.source === 'auto' && !isEditing && isOverridden && (
        <div style={{ display:'flex', gap:4 }}>
          <button style={{ ...s.btnSm, padding:'4px 10px', fontSize:11 }} onClick={onEdit}>{t('common.edit')}</button>
          <button style={{ ...s.btnSm, padding:'4px 10px', fontSize:11, color:'#f0883e', borderColor:'rgba(240,136,62,.4)' }} onClick={onResetToAuto}>{t('kpi.resetToAuto')}</button>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function KPIProgress() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const isAdmin = profile?.role === 'admin'

  const now = new Date()
  const [month, setMonth] = useUrlParamNumber('month', now.getMonth())
  const [year,  setYear]  = useUrlParamNumber('year', now.getFullYear())
  const [view,  setView]  = useUrlParam('view', 'mine') // 'mine' | 'compare'

  // Data
  const [autoData,   setAutoData]   = useState({})
  const [myManual,   setMyManual]   = useState({})
  const [allUsers,   setAllUsers]   = useState([])
  const [allManual,  setAllManual]  = useState({}) // { userId: { key: value } }
  const [loading,    setLoading]    = useState(true)

  // Editing
  const [editingKey,  setEditingKey]  = useState(null)
  const [editValue,   setEditValue]   = useState('')
  const [editNote,    setEditNote]    = useState('')

  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`

  useEffect(() => { loadAll() }, [month, year])

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadAutoData(), loadManualData(), isAdmin && loadAllUsers()])
    setLoading(false)
  }, [month, year, isAdmin])

  async function loadAutoData() {
    const data = await loadKpiAutoData(monthStr)
    setAutoData(data)
  }

  async function loadManualData() {
    if (!profile?.id) return
    const map = await loadKpiManualData(profile.id, monthStr)
    setMyManual(map)
  }

  async function loadAllUsers() {
    const { data: users } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['admin','host'])
      .order('full_name')
    setAllUsers(users||[])

    if (!users?.length) return
    const { data: entries } = await supabase
      .from('kpi_entries')
      .select('user_id, kpi_key, value, notes')
      .in('user_id', users.map(u => u.id))
      .eq('month', monthStr)

    const map = {}
    ;(entries||[]).forEach(e => {
      if (!map[e.user_id]) map[e.user_id] = {}
      map[e.user_id][e.kpi_key] = { value: e.value, notes: e.notes }
    })
    setAllManual(map)
  }

  function getActual(key, userId=null) {
    const manualMap = userId ? (allManual[userId] || {}) : myManual
    return getActualFromMaps(key, autoData, manualMap)
  }

  function calcTotalScore(userId=null) {
    return ALL_ITEMS.reduce((sum, item) => {
      const actual = getActual(item.key, userId)
      return sum + getScore(actual, item.target, item.weight)
    }, 0)
  }

  async function saveManual(key, value, notes) {
    if (!profile?.id) return
    const { error } = await supabase.from('kpi_entries').upsert({
      user_id:    profile.id,
      month:      monthStr,
      kpi_key:    key,
      value:      parseFloat(value) || 0,
      notes:      notes || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,month,kpi_key' })
    if (!error) {
      setMyManual(prev => ({ ...prev, [key]: { value: parseFloat(value)||0, notes } }))
      if (isAdmin && profile?.id) {
        setAllManual(prev => ({
          ...prev,
          [profile.id]: { ...(prev[profile.id]||{}), [key]: { value: parseFloat(value)||0, notes } }
        }))
      }
    } else {
      console.error('saveManual error', error)
    }
    setEditingKey(null)
  }

  // Removes a manual override so an auto-calculated KPI goes back to using the
  // live calculated value instead of whatever number was manually entered.
  async function resetToAuto(key) {
    if (!profile?.id) return
    const { error } = await supabase
      .from('kpi_entries')
      .delete()
      .eq('user_id', profile.id)
      .eq('month', monthStr)
      .eq('kpi_key', key)
    if (!error) {
      setMyManual(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      if (isAdmin && profile?.id) {
        setAllManual(prev => {
          const userEntries = { ...(prev[profile.id] || {}) }
          delete userEntries[key]
          return { ...prev, [profile.id]: userEntries }
        })
      }
    } else {
      console.error('resetToAuto error', error)
    }
  }

  const myScore    = calcTotalScore()
  const scoreColor = myScore >= 85 ? '#3fb950' : myScore >= 60 ? '#d29922' : '#f85149'

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>📈 KPI Progress</div>
          <div style={s.sub}>{t('kpi.performanceTracking')} · {MONTHS[month]} {year}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {isAdmin && (
            <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
              {[['mine', t('kpi.tabMine')],['compare', t('kpi.tabCompare')]].map(([v,l]) => (
                <button key={v} onClick={() => setView(v)}
                  style={{ background:view===v?'var(--accent)':'transparent', color:view===v?'#fff':'var(--muted)', border:'none', padding:'7px 16px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <select style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:7, fontSize:13, outline:'none' }}
            value={month} onChange={e => setMonth(parseInt(e.target.value))}>
            {MONTHS.map((m,i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:7, fontSize:13, outline:'none' }}
            value={year} onChange={e => setYear(parseInt(e.target.value))}>
            {(() => { const currentYear = new Date().getFullYear(); const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i); return YEARS.map(y => <option key={y}>{y}</option>); })()}
          </select>
        </div>
      </div>

      {/* ── MY KPI VIEW ── */}
      {view === 'mine' && (
        <>
          {/* Score summary */}
          <div style={{ ...s.card, marginBottom:16 }}>
            <div style={{ padding:'20px 24px', display:'flex', alignItems:'center', gap:24, flexWrap:'wrap' }}>
              <ScoreRing score={myScore} maxScore={TOTAL_WEIGHT} label={t('kpi.totalScoreLabel')} color={scoreColor} size={90} />
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>
                  {profile?.full_name || 'Me'} · {MONTHS[month]} {year}
                </div>
                <div style={{ height:10, background:'var(--surface2)', borderRadius:5, overflow:'hidden', marginBottom:6 }}>
                  <div style={{ width:`${Math.min(100, myScore/TOTAL_WEIGHT*100)}%`, height:'100%', borderRadius:5, background:scoreColor, transition:'width .6s' }} />
                </div>
                <div style={{ fontSize:12, color:'var(--muted)' }}>
                  {t('kpi.scoreOfTotal', { score: myScore.toFixed(1), total: TOTAL_WEIGHT, pct: Math.round(myScore/TOTAL_WEIGHT*100) })}
                </div>
              </div>
              {/* Category scores */}
              <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                {KPI_FRAMEWORK.map(cat => {
                  const catScore = cat.items.reduce((s,item) => s + getScore(getActual(item.key), item.target, item.weight), 0)
                  const catMax   = cat.items.reduce((s,item) => s + item.weight, 0)
                  return (
                    <div key={cat.category} style={{ textAlign:'center', minWidth:60 }}>
                      <div style={{ fontSize:11, color:cat.color, fontWeight:700, marginBottom:2 }}>{cat.category}{t('kpi.categorySuffix')}</div>
                      <div style={{ fontSize:16, fontWeight:700, color:catScore/catMax>=0.85?'#3fb950':catScore/catMax>=0.6?'#d29922':'#f85149' }}>
                        {catScore.toFixed(1)}
                      </div>
                      <div style={{ fontSize:10, color:'var(--muted)' }}>{t('kpi.perWeight', { n: catMax })}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* KPI Categories */}
          {KPI_FRAMEWORK.map(cat => (
            <div key={cat.category} style={s.card}>
              <div style={s.catHdr(cat.color)}>
                <span style={{ ...s.tag(cat.color), fontSize:12 }}>{cat.category}{t('kpi.categorySuffix')} · {cat.weight}%</span>
                <span style={{ fontSize:14, fontWeight:700, color:cat.color }}>{cat.label}</span>
                <span style={{ marginLeft:'auto', fontSize:12, color:'var(--muted)' }}>
                  {t('kpi.subtotalScore', { score: cat.items.reduce((s,item) => s + getScore(getActual(item.key), item.target, item.weight), 0).toFixed(1) })}
                  &nbsp;/&nbsp;{cat.items.reduce((s,item) => s + item.weight, 0)} {t('kpi.categorySuffix') === '类' ? '分' : 'pts'}
                </span>
              </div>
              {cat.items.map(item => (
                <KPIRow
                  key={item.key}
                  item={item}
                  actual={getActual(item.key)}
                  isEditing={editingKey === item.key}
                  editValue={editValue}
                  noteValue={editNote}
                  onEdit={() => { setEditingKey(item.key); setEditValue(String(getActual(item.key)||'')); setEditNote(myManual[item.key]?.notes||'') }}
                  onEditChange={setEditValue}
                  onNoteChange={setEditNote}
                  onSave={() => saveManual(item.key, editValue, editNote)}
                  onCancel={() => setEditingKey(null)}
                  isMine={true}
                  isOverridden={hasManualEntry(item.key, myManual)}
                  onResetToAuto={() => resetToAuto(item.key)}
                />
              ))}
            </div>
          ))}

          {/* Auto data note */}
          <div style={{ padding:'10px 14px', background:'rgba(6,182,212,.06)', border:'1px solid rgba(6,182,212,.2)', borderRadius:8, fontSize:12, color:'#06b6d4', marginTop:4 }}>
            {t('kpi.autoCalculatedNote')}
          </div>
        </>
      )}

      {/* ── COMPARE VIEW (Admin only) ── */}
      {view === 'compare' && isAdmin && (
        <>
          <div style={{ ...s.card, marginBottom:16 }}>
            <div style={{ padding:'18px 24px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--muted)', marginBottom:14, textTransform:'uppercase', letterSpacing:'.5px' }}>
                {t('kpi.teamComparisonTitle', { month: MONTHS[month], year })}
              </div>
              <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-end' }}>
                {allUsers.map(user => {
                  const score = calcTotalScore(user.id)
                  const col   = score >= 85 ? '#3fb950' : score >= 60 ? '#d29922' : '#f85149'
                  return (
                    <div key={user.id} style={{ textAlign:'center', flex:1, minWidth:120 }}>
                      <ScoreRing score={score} maxScore={TOTAL_WEIGHT} label={user.full_name||'—'} color={col} size={80} />
                      <div style={{ marginTop:6, fontSize:11, color:'var(--muted)' }}>
                        {t('kpi.pctComplete', { pct: Math.round(score/TOTAL_WEIGHT*100) })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Comparison table by category */}
          {KPI_FRAMEWORK.map(cat => (
            <div key={cat.category} style={s.card}>
              <div style={s.catHdr(cat.color)}>
                <span style={{ ...s.tag(cat.color), fontSize:12 }}>{cat.category}{t('kpi.categorySuffix')} · {cat.weight}%</span>
                <span style={{ fontSize:14, fontWeight:700, color:cat.color }}>{cat.label}</span>
              </div>
              {/* Header row */}
              <div style={{ display:'flex', padding:'8px 20px', borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
                <div style={{ flex:2, fontSize:11, color:'var(--muted)', fontWeight:700 }}>{t('kpi.colMetric')}</div>
                <div style={{ minWidth:60, fontSize:11, color:'var(--muted)', fontWeight:700, textAlign:'center' }}>{t('kpi.colTarget')}</div>
                {allUsers.map(u => (
                  <div key={u.id} style={{ flex:1, minWidth:100, fontSize:11, color:'var(--muted)', fontWeight:700, textAlign:'center' }}>
                    {u.full_name}
                  </div>
                ))}
              </div>
              {cat.items.map(item => (
                <div key={item.key} style={{ display:'flex', alignItems:'center', padding:'10px 20px', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ flex:2, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600 }}>{item.icon} {item.label}</div>
                    <span style={{ ...s.tag(item.source==='auto'?'#06b6d4':'#8b5cf6'), fontSize:10 }}>
                      {item.source==='auto'?t('kpi.sourceAuto'):t('kpi.sourceManual')}
                    </span>
                  </div>
                  <div style={{ minWidth:60, textAlign:'center', fontSize:12, color:'var(--muted)' }}>
                    {item.fmt(item.target)}
                  </div>
                  {allUsers.map(user => {
                    const actual = getActual(item.key, user.id)
                    const color  = getStatusColor(actual, item.target)
                    const score  = getScore(actual, item.target, item.weight)
                    return (
                      <div key={user.id} style={{ flex:1, minWidth:100, textAlign:'center' }}>
                        <div style={{ fontSize:13, fontWeight:700, color }}>{item.fmt(actual)}</div>
                        <div style={{ fontSize:10, color:'var(--muted)' }}>{score.toFixed(1)}{t('kpi.perWeight', { n: item.weight })}</div>
                        <span style={{ ...s.tag(color), fontSize:10 }}>{getStatusLabel(actual, item.target, t)}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
              {/* Category total row */}
              <div style={{ display:'flex', padding:'10px 20px', background:'var(--surface2)' }}>
                <div style={{ flex:2, fontSize:12, fontWeight:700 }}>{t('kpi.subtotalLabel')}</div>
                <div style={{ minWidth:60 }} />
                {allUsers.map(user => {
                  const catScore = cat.items.reduce((s,item) => s + getScore(getActual(item.key, user.id), item.target, item.weight), 0)
                  const catMax   = cat.items.reduce((s,item) => s + item.weight, 0)
                  const col      = catScore/catMax >= 0.85 ? '#3fb950' : catScore/catMax >= 0.6 ? '#d29922' : '#f85149'
                  return (
                    <div key={user.id} style={{ flex:1, minWidth:100, textAlign:'center' }}>
                      <span style={{ fontSize:14, fontWeight:800, color:col }}>{catScore.toFixed(1)}</span>
                      <span style={{ fontSize:11, color:'var(--muted)' }}>/{catMax}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Grand total */}
          <div style={{ ...s.card, border:'2px solid var(--accent)' }}>
            <div style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:20, flexWrap:'wrap' }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--accent)', flex:2 }}>{t('kpi.totalScoreSummary', { month: MONTHS[month], year })}</div>
              {allUsers.map(user => {
                const total = calcTotalScore(user.id)
                const col   = total >= 85 ? '#3fb950' : total >= 60 ? '#d29922' : '#f85149'
                return (
                  <div key={user.id} style={{ flex:1, minWidth:120, textAlign:'center' }}>
                    <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4 }}>{user.full_name}</div>
                    <div style={{ fontSize:28, fontWeight:800, color:col }}>{total.toFixed(1)}</div>
                    <div style={{ fontSize:11, color:'var(--muted)' }}>/ {TOTAL_WEIGHT} {t('kpi.categorySuffix') === '类' ? '分' : 'pts'} · {Math.round(total/TOTAL_WEIGHT*100)}%</div>
                    <span style={{ ...s.tag(col), marginTop:4, display:'inline-block' }}>
                      {total >= 85 ? t('kpi.ratingExcellent') : total >= 60 ? t('kpi.ratingPass') : t('kpi.ratingNeedsImprovement')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
