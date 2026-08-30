// VipQuickSearch.jsx — Global VIP search bar
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TIER_COLOR } from '../lib/constants'
import { useLanguage } from '../contexts/LanguageContext'

export default function VipQuickSearch() {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)
  const navigate = useNavigate()
  const { lang } = useLanguage()
  const ref = useRef(null)

  const i18n = {
    placeholder: lang === 'zh' ? '🔍  搜索 VIP 用户名…'    : '🔍  Search VIP by username…',
    searching:   lang === 'zh' ? '搜索中…'                  : 'Searching…',
    noResult:    lang === 'zh'
      ? `未找到 "${query}" 相关 VIP`
      : `No VIP found for "${query}"`,
  }

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('vip_members')
        .select('id, username, tier, host_assigned, days_inactive, churn_risk, activity_status')
        .ilike('username', `%${query.trim()}%`)
        .eq('is_excluded', false)
        .limit(8)
      setResults(data || [])
      setOpen(true)
      setLoading(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div ref={ref} style={{ position: 'relative', maxWidth: 520 }}>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={i18n.placeholder}
        style={{
          width: '100%', padding: '10px 16px', borderRadius: 10, fontSize: 14,
          background: 'var(--surface)', border: '1px solid var(--border)',
          color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
        }}
      />

      {loading && (
        <div style={{
          position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
          fontSize: 11, color: 'var(--muted)',
        }}>
          {i18n.searching}
        </div>
      )}

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.3)', zIndex: 999, overflow: 'hidden',
        }}>
          {results.map(v => (
            <div
              key={v.id}
              onClick={() => { navigate(`/vips/${v.id}`); setOpen(false); setQuery('') }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{
                padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
                cursor: 'pointer', borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{v.username}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {v.host_assigned ? `Host: ${v.host_assigned} · ` : ''}
                  {v.days_inactive > 0 ? `${v.days_inactive}d inactive` : 'Active recently'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: TIER_COLOR[v.tier] || 'var(--muted)' }}>
                  {v.tier}
                </span>
                {v.churn_risk === 'HIGH' && (
                  <span style={{
                    fontSize: 10, background: 'rgba(220,38,38,.15)', color: '#dc2626',
                    padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                  }}>
                    HIGH RISK
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && !loading && results.length === 0 && query.trim().length >= 2 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 16px', fontSize: 13, color: 'var(--muted)',
        }}>
          {i18n.noResult}
        </div>
      )}
    </div>
  )
}
