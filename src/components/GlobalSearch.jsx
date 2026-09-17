// GlobalSearch.jsx — Cmd+K / Ctrl+K global search overlay
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TIER_COLOR = { BLACK:'#e2e8f0', DIAMOND:'#58a6ff', PLATINUM:'#cbd5e1', GOLD:'#fbbf24', SILVER:'#94a3b8', BRONZE:'#c2855a' }

const QUICK_LINKS = [
  { label:'📋 Today',        path:'/' },
  { label:'👥 All VIPs',     path:'/vips' },
  { label:'⚠️ At Risk',      path:'/at-risk' },
  { label:'💬 Ask Data',     path:'/ask' },
  { label:'📞 Contact Log',  path:'/contact-log' },
  { label:'📊 Analytics',    path:'/analytics' },
  { label:'✅ My Tasks',     path:'/tasks' },
  { label:'🎂 Birthdays',    path:'/birthdays' },
]

export default function GlobalSearch({ open, onClose }) {
  const [query, setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(-1)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setFocused(-1); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  useEffect(() => {
    function handler(e) { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      const q = query.trim()
      const { data } = await supabase
        .from('vip_members')
        .select('id,username,full_name,tier,host_assigned,days_inactive,churn_risk,total_deposit,currency')
        .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
        .eq('is_excluded', false)
        .order('total_deposit', { ascending: false })
        .limit(10)
      setResults(data || [])
      setLoading(false)
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  function go(id) { navigate(`/vips/${id}`); onClose() }

  function handleKey(e) {
    if (e.key === 'ArrowDown')  { e.preventDefault(); setFocused(f => Math.min(f+1, results.length-1)) }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setFocused(f => Math.max(f-1, -1)) }
    if (e.key === 'Enter' && focused >= 0 && results[focused]) go(results[focused].id)
  }

  if (!open) return null

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9999,
      background:'rgba(0,0,0,.65)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:80,
    }} onClick={onClose}>
      <div style={{
        background:'var(--surface)', borderRadius:14, width:'100%', maxWidth:580,
        border:'1px solid var(--border)', boxShadow:'0 24px 60px rgba(0,0,0,.55)',
        overflow:'hidden', margin:'0 16px',
      }} onClick={e => e.stopPropagation()}>

        {/* Input */}
        <div style={{ display:'flex', alignItems:'center', padding:'14px 18px', borderBottom:'1px solid var(--border)', gap:10 }}>
          <span style={{ fontSize:18, flexShrink:0 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setFocused(-1) }}
            onKeyDown={handleKey}
            placeholder="Search VIP by username or name…"
            style={{ flex:1, background:'transparent', border:'none', outline:'none', fontSize:16, color:'var(--text)' }}
          />
          {loading && <span style={{ fontSize:11, color:'var(--muted)', flexShrink:0 }}>Searching…</span>}
          <kbd style={{ fontSize:11, padding:'2px 7px', borderRadius:5, border:'1px solid var(--border)', color:'var(--muted)', background:'var(--surface2)', flexShrink:0 }}>ESC</kbd>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div style={{ maxHeight:420, overflowY:'auto' }}>
            {results.map((v, i) => (
              <div key={v.id}
                onClick={() => go(v.id)}
                onMouseEnter={() => setFocused(i)}
                style={{
                  padding:'12px 18px', display:'flex', alignItems:'center', gap:12,
                  cursor:'pointer', borderBottom:'1px solid var(--border)',
                  background: focused === i ? 'var(--surface2)' : 'transparent',
                  transition:'background .1s',
                }}>
                <div style={{ width:9, height:9, borderRadius:'50%', flexShrink:0, background: TIER_COLOR[v.tier] || '#888' }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:'var(--text)' }}>
                    {v.full_name && v.full_name !== '(Name)' ? v.full_name : v.username}
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                    @{v.username}{v.host_assigned ? ` · ${v.host_assigned}` : ''}{v.days_inactive > 0 ? ` · ${v.days_inactive}d inactive` : ''}
                  </div>
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                  <span style={{ fontSize:11, fontWeight:700, color: TIER_COLOR[v.tier] || 'var(--muted)' }}>{v.tier}</span>
                  {v.churn_risk === 'HIGH' && (
                    <span style={{ fontSize:10, background:'rgba(220,38,38,.15)', color:'#dc2626', padding:'2px 6px', borderRadius:4, fontWeight:700 }}>HIGH RISK</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div style={{ padding:'24px', textAlign:'center', color:'var(--muted)', fontSize:13 }}>
            No VIP found for "{query}"
          </div>
        )}

        {/* Quick links (when no query) */}
        {query.trim().length < 2 && (
          <div style={{ padding:'16px 18px' }}>
            <div style={{ fontSize:11, color:'var(--muted)', fontWeight:700, marginBottom:10, textTransform:'uppercase', letterSpacing:'.5px' }}>Quick navigate</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {QUICK_LINKS.map(item => (
                <button key={item.path}
                  onClick={() => { navigate(item.path); onClose() }}
                  style={{
                    padding:'7px 14px', borderRadius:8, fontSize:12, fontWeight:600,
                    background:'var(--surface2)', border:'1px solid var(--border)',
                    color:'var(--text)', cursor:'pointer',
                  }}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding:'10px 18px', borderTop:'1px solid var(--border)',
          display:'flex', gap:16, fontSize:11, color:'var(--disabled)',
        }}>
          {[['↵','open'],['↑↓','navigate'],['ESC','close'],['⌘K','toggle']].map(([k,l]) => (
            <span key={k}>
              <kbd style={{ padding:'1px 5px', borderRadius:3, border:'1px solid var(--border)', background:'var(--surface2)' }}>{k}</kbd> {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
