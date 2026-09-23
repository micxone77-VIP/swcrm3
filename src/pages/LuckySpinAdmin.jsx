// src/pages/LuckySpinAdmin.jsx — Lucky Spin campaign management
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const s = {
  page:  { padding:'24px 28px', minHeight:'100vh', color:'var(--text)' },
  title: { fontSize:22, fontWeight:700 },
  sub:   { fontSize:13, color:'var(--muted)', marginTop:4, marginBottom:24 },
  card:  { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, marginBottom:20 },
  cardHdr: { padding:'14px 20px', borderBottom:'1px solid var(--border)', fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', display:'flex', justifyContent:'space-between', alignItems:'center' },
  cardBody: { padding:20 },
  grid:  { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12, marginBottom:24 },
  stat:  { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 20px' },
  statN: { fontSize:28, fontWeight:800, color:'var(--brand)', marginBottom:2 },
  lbl:   { fontSize:12, color:'var(--muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.5px' },
  tbl:   { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:    { padding:'9px 14px', background:'var(--surface)', color:'var(--muted)', fontWeight:600, fontSize:11, textAlign:'left', borderBottom:'1px solid var(--border)' },
  td:    { padding:'10px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' },
  badge: { display:'inline-block', padding:'2px 9px', borderRadius:12, fontSize:11, fontWeight:700 },
  input: { background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' },
  btn:   { background:'var(--accent)', color:'#fff', border:'none', padding:'9px 20px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' },
  btnSm: { background:'var(--surface2)', color:'var(--text)', border:'1px solid var(--border)', padding:'6px 14px', borderRadius:7, fontSize:12, cursor:'pointer', fontWeight:600 },
  label: { fontSize:12, color:'var(--muted)', fontWeight:600, marginBottom:4, display:'block' },
  formRow: { marginBottom:14 },
  spinWheel: { width:180, height:180, borderRadius:'50%', border:'6px solid var(--brand)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:48, flexShrink:0, background:'linear-gradient(135deg,#ff6a00 0%,#ffd700 50%,#ff6a00 100%)' },
}

const PRIZE_COLORS = ['#ffd700','#3fb950','#58a6ff','#f0883e','#b9f2ff','#ff6a00','#e879f9','#a78bfa']
const DEFAULT_PRIZES = [
  { label:'🎰 Free Spin', prob:30, color:'#8b949e' },
  { label:'💰 RM 10 Credit', prob:25, color:'#3fb950' },
  { label:'💰 RM 50 Credit', prob:15, color:'#58a6ff' },
  { label:'💰 RM 100 Credit', prob:10, color:'#f0883e' },
  { label:'🎁 Mystery Box', prob:10, color:'#e879f9' },
  { label:'💰 RM 200 Credit', prob:6, color:'#b9f2ff' },
  { label:'🥇 Gold Bar', prob:3, color:'#ffd700' },
  { label:'💎 Jackpot RM 500', prob:1, color:'#ff6a00' },
]

export default function LuckySpinAdmin() {
  const { profile } = useAuth()
  const [prizes, setPrizes] = useState(DEFAULT_PRIZES)
  const [spinning, setSpinning] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const [spinLog, setSpinLog] = useState([])
  const [eligibleTiers, setEligibleTiers] = useState(['GOLD','PLATINUM','DIAMOND'])
  const [minDeposit, setMinDeposit] = useState(500)
  const [isActive, setIsActive] = useState(true)

  const totalProb = prizes.reduce((s,p) => s + p.prob, 0)

  function spin() {
    setSpinning(true)
    setTimeout(() => {
      let rand = Math.random() * totalProb
      let winner = prizes[prizes.length - 1]
      for (const p of prizes) {
        rand -= p.prob
        if (rand <= 0) { winner = p; break }
      }
      setLastResult(winner)
      setSpinLog(prev => [{ ...winner, time: new Date().toLocaleTimeString(), by: profile?.full_name || 'Admin' }, ...prev.slice(0,19)])
      setSpinning(false)
    }, 1200)
  }

  function updatePrize(i, field, value) {
    setPrizes(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: field === 'prob' ? Number(value) : value } : p))
  }

  function addPrize() {
    setPrizes(prev => [...prev, { label:'New Prize', prob:5, color:'#8b949e' }])
  }

  function removePrize(i) {
    setPrizes(prev => prev.filter((_, idx) => idx !== i))
  }

  const TIERS = ['GOLD','PLATINUM','DIAMOND','BLACK']

  return (
    <div style={s.page}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={s.title}>🎰 Lucky Spin Admin</div>
          <div style={s.sub}>Configure prizes, eligibility rules, and run test spins</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:12, color:'var(--muted)', fontWeight:600 }}>Campaign Status:</span>
          <button onClick={() => setIsActive(a => !a)}
            style={{ ...s.btnSm, background: isActive ? '#3fb95022' : 'var(--surface)', color: isActive ? '#3fb950' : 'var(--muted)', border: `1px solid ${isActive ? '#3fb950' : 'var(--border)'}` }}>
            {isActive ? '✅ Active' : '⏸ Paused'}
          </button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        {/* Left: Prize config */}
        <div>
          <div style={s.card}>
            <div style={s.cardHdr}>
              <span>🎁 Prize Segments ({prizes.length})</span>
              <button style={s.btnSm} onClick={addPrize}>+ Add Prize</button>
            </div>
            <div style={s.cardBody}>
              {prizes.map((p, i) => (
                <div key={i} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10, padding:'8px 10px', background:'var(--surface2)', borderRadius:8, border:'1px solid var(--border)' }}>
                  <div style={{ width:14, height:14, borderRadius:3, background:p.color, flexShrink:0 }} />
                  <input
                    style={{ ...s.input, flex:2, padding:'5px 8px' }}
                    value={p.label}
                    onChange={e => updatePrize(i,'label',e.target.value)}
                    placeholder="Prize name"
                  />
                  <input
                    style={{ ...s.input, width:60, padding:'5px 8px', textAlign:'center' }}
                    type="number" min={1} max={100}
                    value={p.prob}
                    onChange={e => updatePrize(i,'prob',e.target.value)}
                  />
                  <span style={{ fontSize:11, color:'var(--muted)', flexShrink:0 }}>
                    {totalProb > 0 ? ((p.prob/totalProb)*100).toFixed(1) : 0}%
                  </span>
                  <button onClick={() => removePrize(i)}
                    style={{ background:'none', border:'none', color:'#f85149', fontSize:16, cursor:'pointer', padding:0, lineHeight:1 }}>×</button>
                </div>
              ))}
              <div style={{ fontSize:11, color:'var(--muted)', marginTop:8 }}>
                Total weight: {totalProb} — probabilities shown as percentages
              </div>
            </div>
          </div>

          {/* Eligibility */}
          <div style={s.card}>
            <div style={s.cardHdr}>🔒 Eligibility Rules</div>
            <div style={s.cardBody}>
              <div style={s.formRow}>
                <label style={s.label}>Eligible Tiers</label>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {TIERS.map(t => (
                    <button key={t} onClick={() => setEligibleTiers(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev,t])}
                      style={{ ...s.btnSm, background: eligibleTiers.includes(t) ? 'var(--brand)22' : 'var(--surface)', color: eligibleTiers.includes(t) ? 'var(--brand)' : 'var(--muted)', border: `1px solid ${eligibleTiers.includes(t) ? 'var(--brand)' : 'var(--border)'}` }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div style={s.formRow}>
                <label style={s.label}>Min Deposit to Qualify (RM)</label>
                <input type="number" style={{ ...s.input, maxWidth:160 }} value={minDeposit}
                  onChange={e => setMinDeposit(Number(e.target.value))} />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Spin simulator + log */}
        <div>
          <div style={s.card}>
            <div style={s.cardHdr}>🎡 Spin Simulator</div>
            <div style={{ ...s.cardBody, display:'flex', flexDirection:'column', alignItems:'center', gap:20 }}>
              <div style={{ ...s.spinWheel, opacity: spinning ? 0.7 : 1, transition:'opacity .3s', fontSize:40 }}>
                {spinning ? '🌀' : lastResult ? '🎉' : '🎰'}
              </div>

              {lastResult && !spinning && (
                <div style={{ textAlign:'center', padding:'12px 20px', background: lastResult.color+'22', border:`1px solid ${lastResult.color}`, borderRadius:10 }}>
                  <div style={{ fontSize:20, marginBottom:4 }}>{lastResult.label}</div>
                  <div style={{ fontSize:12, color:'var(--muted)' }}>Prize awarded!</div>
                </div>
              )}

              <button style={{ ...s.btn, padding:'12px 32px', fontSize:15, opacity: spinning ? 0.6 : 1 }}
                onClick={spin} disabled={spinning}>
                {spinning ? 'Spinning…' : '🎰 Test Spin'}
              </button>
              <div style={{ fontSize:11, color:'var(--muted)', textAlign:'center' }}>
                Test spins are for preview only — they don't record in the database
              </div>
            </div>
          </div>

          {/* Spin log */}
          <div style={s.card}>
            <div style={s.cardHdr}>📜 Test Spin Log</div>
            {spinLog.length === 0 ? (
              <div style={{ ...s.cardBody, color:'var(--muted)', fontSize:13 }}>No spins yet — click Test Spin to try it.</div>
            ) : (
              <table style={s.tbl}>
                <thead><tr>
                  <th style={s.th}>Time</th>
                  <th style={s.th}>Result</th>
                  <th style={s.th}>By</th>
                </tr></thead>
                <tbody>
                  {spinLog.map((l,i) => (
                    <tr key={i}>
                      <td style={{ ...s.td, color:'var(--muted)', fontSize:12 }}>{l.time}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background:l.color+'22', color:l.color }}>{l.label}</span>
                      </td>
                      <td style={{ ...s.td, color:'var(--muted)' }}>{l.by}</td>
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
