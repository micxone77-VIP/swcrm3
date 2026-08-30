import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { MONTHS, TIER_COLOR, TIER_BG, CURRENCY_LIST, CURRENCY_SYMBOL, CURRENCY_REGION, REGION_LABEL } from '../lib/constants'
import { formatMoney } from '../lib/format'
import { useUrlParam, useUrlParamNumber } from '../hooks/useUrlParam'

const s = {
  page:    { padding:'24px 28px', minHeight:'100vh' },
  title:   { fontSize:22, fontWeight:700, color:'var(--text)' },
  sub:     { fontSize:13, color:'var(--muted)', marginTop:4 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' },
  cardBody:{ padding:'18px 20px' },
  grid2:   { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 },
  grid4:   { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 },
  input:   { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 12px', borderRadius:8, fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' },
  btn:     { background:'var(--accent)', color:'#fff', border:'none', padding:'9px 20px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm:   { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer' },
  flbl:    { fontSize:11, color:'var(--muted)', marginBottom:4 },
  tbl:     { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)' },
  td:      { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  badge:   { display:'inline-block', padding:'2px 10px', borderRadius:12, fontSize:11, fontWeight:700 },
  toggle:  (active) => ({ background: active?'var(--accent)':'transparent', color: active?'#fff':'var(--muted)', border:'none', padding:'8px 16px', fontSize:12, fontWeight:600, cursor:'pointer' }),
}

const DEFAULT_BUDGET = {
  // BLACK defaults to 0 deliberately — it's a real tier now but there's no basis
  // to guess a budget number for it. Admins should set a real value via "Set Budget".
  BLACK: 0, DIAMOND: 5000, PLATINUM: 3000, GOLD: 1500, SILVER: 500, BRONZE: 200,
  total: 20000,
}

export default function BudgetStrategy() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const now = new Date()
  const [month,    setMonth]    = useUrlParamNumber('month', now.getMonth())
  const [year,     setYear]     = useUrlParamNumber('year', now.getFullYear())
  // MYR and SGD bonus spend must never be summed together, and each currency
  // needs its own budget — this toggle picks ONE currency at a time for
  // every query, total, and saved budget on this page. See lib/constants.js.
  const [currency, setCurrency] = useUrlParam('currency', 'MYR')
  const [budget,   setBudget]   = useState(DEFAULT_BUDGET)
  const [editB,    setEditB]    = useState(DEFAULT_BUDGET)
  const [editing,  setEditing]  = useState(false)
  const [logs,     setLogs]     = useState([])
  const [tierStats,setTierStats]= useState({})
  const [loading,  setLoading]  = useState(true)

  const fmt = (n) => formatMoney(n, currency)

  useEffect(() => { loadData() }, [month, year, currency])

  function budgetKey(monthStr) {
    return `budget_${monthStr}_${currency}`
  }

  async function loadData() {
    setLoading(true)
    const monthStr  = `${year}-${String(month+1).padStart(2,'0')}`
    const startDate = `${monthStr}-01`
    const endDate   = new Date(year, month+1, 0).toISOString().slice(0,10)

    // load saved budget (per currency — see budgetKey)
    const saved = localStorage.getItem(budgetKey(monthStr))
    if (saved) { const b = JSON.parse(saved); setBudget(b); setEditB(b) }
    else { setBudget(DEFAULT_BUDGET); setEditB(DEFAULT_BUDGET) }

    // bonus logs this month — join vip_members for tier AND currency, so we can
    // scope everything below to a single currency and never mix MYR with SGD.
    const { data: bonusLogs } = await supabase
      .from('contact_logs')
      .select('*, vip_members!inner(tier, currency)')
      .not('bonus_offered', 'is', null)
      .gt('bonus_offered', 0)
      .gte('logged_at', startDate)
      .lte('logged_at', endDate + 'T23:59:59')
      .eq('vip_members.currency', currency)
      .order('logged_at', { ascending: false })

    setLogs(bonusLogs || [])

    // aggregate by tier
    const stats = {}
    ;(bonusLogs || []).forEach(l => {
      const tier = l.vip_members?.tier || 'Unknown'
      if (!stats[tier]) stats[tier] = { count:0, total:0 }
      stats[tier].count++
      stats[tier].total += l.bonus_offered || 0
    })
    setTierStats(stats)
    setLoading(false)
  }

  function saveBudget() {
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}`
    localStorage.setItem(budgetKey(monthStr), JSON.stringify(editB))
    setBudget(editB)
    setEditing(false)
  }

  const totalSpent  = Object.values(tierStats).reduce((s,v) => s+v.total, 0)
  const totalBudget = budget.total || 0
  const remaining   = totalBudget - totalSpent
  const spentPct    = totalBudget ? Math.min(100, Math.round(totalSpent/totalBudget*100)) : 0
  const budgetColor = spentPct >= 90 ? '#f85149' : spentPct >= 70 ? '#d29922' : '#3fb950'

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={s.title}>💼 Budget Strategy</div>
          <div style={s.sub}>Bonus budget planning and allocation tracking — {REGION_LABEL[CURRENCY_REGION[currency]]} ({CURRENCY_SYMBOL[currency]}) only</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {CURRENCY_LIST.map(c => (
              <button key={c} onClick={() => setCurrency(c)} style={s.toggle(currency === c)}>
                {REGION_LABEL[CURRENCY_REGION[c]]} ({CURRENCY_SYMBOL[c]})
              </button>
            ))}
          </div>
          <select style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none' }}
            value={month} onChange={e=>setMonth(parseInt(e.target.value))}>
            {MONTHS.map((m,i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none' }}
            value={year} onChange={e=>setYear(parseInt(e.target.value))}>
            {[2024,2025,2026,2027].map(y => <option key={y}>{y}</option>)}
          </select>
          {isAdmin && !editing && <button style={s.btnSm} onClick={()=>setEditing(true)}>⚙️ Set Budget</button>}
          {editing && (
            <>
              <button style={s.btn} onClick={saveBudget}>💾 Save</button>
              <button style={s.btnSm} onClick={()=>setEditing(false)}>Cancel</button>
            </>
          )}
        </div>
      </div>

      {/* Budget overview */}
      <div style={{ ...s.grid4, marginBottom:16 }}>
        {[
          { label:'Total Budget', value: fmt(totalBudget), color:'var(--accent)' },
          { label:'Spent',        value: fmt(totalSpent),  color: budgetColor },
          { label:'Remaining',    value: fmt(remaining),   color: remaining>=0?'#3fb950':'#f85149' },
          { label:'Bonuses Given',value: logs.length,        color:'var(--text)', sub:`${MONTHS[month]} ${year}` },
        ].map(({ label, value, color, sub }) => (
          <div key={label} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px' }}>
            <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>{label}</div>
            <div style={{ fontSize:26, fontWeight:800, color }}>{value}</div>
            {sub && <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Budget bar */}
      <div style={{ ...s.card, marginBottom:16 }}>
        <div style={s.cardBody}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
            <span style={{ fontSize:13, fontWeight:600 }}>Budget Utilisation</span>
            <span style={{ fontSize:13, fontWeight:700, color:budgetColor }}>{spentPct}% used</span>
          </div>
          <div style={{ height:14, background:'var(--surface2)', borderRadius:7, overflow:'hidden' }}>
            <div style={{ width:spentPct+'%', height:'100%', background:budgetColor, borderRadius:7, transition:'width .5s' }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--muted)', marginTop:6 }}>
            <span>{CURRENCY_SYMBOL[currency]} 0</span>
            <span>{fmt(totalBudget)} total budget</span>
          </div>
        </div>
      </div>

      <div style={{ ...s.grid2, marginBottom:16 }}>
        {/* Budget by tier */}
        <div style={s.card}>
          <div style={s.cardHdr}>💎 Budget by Tier</div>
          <div style={s.cardBody}>
            {editing && (
              <div style={{ marginBottom:16, padding:'12px 14px', background:'rgba(88,166,255,.08)', border:'1px solid rgba(88,166,255,.2)', borderRadius:8 }}>
                <div style={{ fontSize:11, color:'var(--muted)', marginBottom:10 }}>Set monthly budget per tier ({CURRENCY_SYMBOL[currency]})</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                  {['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(tier => (
                    <div key={tier}>
                      <div style={{ ...s.flbl, color:TIER_COLOR[tier] }}>{tier}</div>
                      <input type="number" style={s.input} value={editB[tier]||''}
                        onChange={e=>setEditB({...editB,[tier]:parseFloat(e.target.value)||0})} />
                    </div>
                  ))}
                </div>
                <div>
                  <div style={s.flbl}>Total Monthly Budget ({CURRENCY_SYMBOL[currency]})</div>
                  <input type="number" style={s.input} value={editB.total||''}
                    onChange={e=>setEditB({...editB,total:parseFloat(e.target.value)||0})} />
                </div>
              </div>
            )}
            {['BLACK','DIAMOND','PLATINUM','GOLD','SILVER','BRONZE'].map(tier => {
              const spent     = tierStats[tier]?.total || 0
              const allocated = budget[tier] || 0
              const p         = allocated ? Math.min(100, Math.round(spent/allocated*100)) : 0
              const color     = p>=90?'#f85149':p>=70?'#d29922':'#3fb950'
              return (
                <div key={tier} style={{ marginBottom:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ ...s.badge, background:TIER_BG[tier], color:TIER_COLOR[tier] }}>{tier}</span>
                    <span style={{ fontSize:12 }}>
                      <span style={{ fontWeight:700, color }}>{fmt(spent)}</span>
                      <span style={{ color:'var(--muted)' }}> / {fmt(allocated)}</span>
                    </span>
                  </div>
                  <div style={{ height:6, background:'var(--surface2)', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ width:p+'%', height:'100%', background:color, borderRadius:3 }} />
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--muted)', marginTop:2 }}>
                    <span>{tierStats[tier]?.count||0} bonuses</span>
                    <span>{p}% used</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Bonus log */}
        <div style={s.card}>
          <div style={s.cardHdr}>📋 Bonus Log — {MONTHS[month]} {year}
            <span style={{fontSize:11,fontWeight:400,color:'var(--muted)',display:'block',marginTop:2}}>
              Auto-synced from Contact Log — no need to record separately
            </span>
          </div>
          <div style={{ maxHeight:380, overflowY:'auto' }}>
            {loading ? (
              <div style={{ padding:20, textAlign:'center', color:'var(--muted)' }}>Loading...</div>
            ) : logs.length === 0 ? (
              <div style={{ padding:20, textAlign:'center', color:'var(--muted)', fontSize:13 }}>No bonuses given this month.</div>
            ) : (
              <table style={s.tbl}>
                <thead>
                  <tr>
                    <th style={s.th}>VIP</th>
                    <th style={s.th}>Tier</th>
                    <th style={s.th}>Amount</th>
                    <th style={s.th}>Type</th>
                    <th style={s.th}>Host</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{ ...s.td, fontWeight:700 }}>{log.vip_username}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background:TIER_BG[log.vip_members?.tier]||'transparent', color:TIER_COLOR[log.vip_members?.tier]||'var(--text)', fontSize:10 }}>
                          {log.vip_members?.tier||'—'}
                        </span>
                      </td>
                      <td style={{ ...s.td, fontWeight:700, color:'#ffd700' }}>{fmt(log.bonus_offered)}</td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{log.bonus_type||'—'}</td>
                      <td style={{ ...s.td, fontSize:12, color:'var(--muted)' }}>{log.host_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
