// src/components/vip/AffiliateSummary.jsx — Analytics tab: VIPs grouped by affiliate (代理分析)
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { SEGMENTS, fmtRM, fetchAll } from '../../lib/depositProfile'

const th = { textAlign: 'right', padding: '10px 12px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
const td = { padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }

export default function AffiliateSummary() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [sortKey, setSortKey] = useState('dep_total_3m')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchAll(() => supabase.from('v_affiliate_vip_summary').select('*').order('affiliate'))
      .then(d => { if (!cancelled) setRows(d) })
      .catch(e => { console.error('AffiliateSummary load error', e); if (!cancelled) setErr(e.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const list = useMemo(() => {
    const f = rows.filter(r => !search || r.affiliate.toLowerCase().includes(search.toLowerCase()))
    const val = r => sortKey === 'affiliate' ? r.affiliate
      : sortKey === 'trend' ? (Number(r.normal_month) > 0 ? Number(r.dep_30d) / Number(r.normal_month) : -1)
      : sortKey === 'risk' ? Number(r.silent) + Number(r.declining)
      : Number(r[sortKey] || 0)
    return [...f].sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y
      return sortDir === 'asc' ? c : -c
    })
  }, [rows, search, sortKey, sortDir])

  const totals = useMemo(() => rows.reduce((t, r) => ({
    vips: t.vips + Number(r.vips), dep: t.dep + Number(r.dep_total_3m), d30: t.d30 + Number(r.dep_30d),
    aff: t.aff + (r.affiliate.startsWith('(') ? 0 : 1),
    direct: t.direct + (r.affiliate === '(direct)' ? Number(r.vips) : 0),
    unknown: t.unknown + (r.affiliate === '(unknown)' ? Number(r.vips) : 0),
  }), { vips: 0, dep: 0, d30: 0, aff: 0, direct: 0, unknown: 0 }), [rows])

  function sortBy(k) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'affiliate' ? 'asc' : 'desc') }
  }
  const arrow = k => (sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading affiliates…</div>
  if (err) return <div style={{ padding: 24, color: '#f87171' }}>Error loading affiliates: {err}</div>

  const openList = (aff, segment) => {
    const a = aff === '(direct)' ? '__direct__' : aff === '(unknown)' ? '__unknown__' : aff
    navigate(`/vips?affiliate=${encodeURIComponent(a)}${segment ? `&segment=${segment}` : ''}`)
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0 8px 8px 8px', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>🤝 Affiliates 代理分析</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Affiliate taken from BO deposit records (Jul–Sep). Click a row to open those VIPs in All VIPs.</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[
            ['Affiliates with VIPs', totals.aff],
            ['VIPs via affiliate', totals.vips - totals.direct - totals.unknown],
            ['Direct (no affiliate)', totals.direct],
            ['Unknown (no deposit data)', totals.unknown],
            ['Deposits Jul–Sep', fmtRM(totals.dep)],
          ].map(([l, v]) => (
            <div key={l} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{typeof v === 'number' ? v.toLocaleString() : v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search affiliate"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text)', minWidth: 200 }} />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{list.length} rows</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...th, textAlign: 'left' }} onClick={() => sortBy('affiliate')}>Affiliate{arrow('affiliate')}</th>
              <th style={th} onClick={() => sortBy('vips')}>VIPs{arrow('vips')}</th>
              <th style={th} onClick={() => sortBy('gold')}>Gold{arrow('gold')}</th>
              <th style={th} onClick={() => sortBy('platinum')}>Plat{arrow('platinum')}</th>
              <th style={th} onClick={() => sortBy('diamond_plus')}>Diamond+{arrow('diamond_plus')}</th>
              <th style={th} onClick={() => sortBy('dep_total_3m')}>Deposits Jul–Sep{arrow('dep_total_3m')}</th>
              <th style={th} onClick={() => sortBy('normal_month')}>Normal / mth{arrow('normal_month')}</th>
              <th style={th} onClick={() => sortBy('dep_30d')}>Last 30d{arrow('dep_30d')}</th>
              <th style={th} onClick={() => sortBy('trend')}>Trend{arrow('trend')}</th>
              <th style={th} onClick={() => sortBy('risk')} title="Silent + Declining — click the number to open the list">🚨 Need action{arrow('risk')}</th>
              <th style={th} onClick={() => sortBy('growing')}>📈 Growing{arrow('growing')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => {
              const normal = Number(r.normal_month || 0)
              const trend = normal > 0 ? Math.round((Number(r.dep_30d) / normal - 1) * 100) : null
              const risk = Number(r.silent) + Number(r.declining)
              const special = r.affiliate.startsWith('(')
              return (
                <tr key={r.affiliate} onClick={() => openList(r.affiliate)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700, color: special ? 'var(--muted)' : 'var(--brand, #FF6B00)' }}>
                    {r.affiliate === '(direct)' ? 'Direct (no affiliate)' : r.affiliate === '(unknown)' ? 'Unknown (no deposit data)' : r.affiliate}
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{r.vips}</td>
                  <td style={td}>{r.gold || '—'}</td>
                  <td style={td}>{r.platinum || '—'}</td>
                  <td style={td}>{r.diamond_plus || '—'}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{fmtRM(r.dep_total_3m)}</td>
                  <td style={td}>{fmtRM(normal)}</td>
                  <td style={td}>{fmtRM(r.dep_30d)}</td>
                  <td style={{ ...td, fontWeight: 700, color: trend === null ? 'var(--muted)' : trend < 0 ? '#f87171' : '#34d399' }}>
                    {trend === null ? '—' : `${trend > 0 ? '+' : ''}${trend}%`}
                  </td>
                  <td style={td}>
                    {risk > 0 ? (
                      <span onClick={e => { e.stopPropagation(); openList(r.affiliate, 'RISK') }}
                        style={{ fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: SEGMENTS.Silent.bg, color: SEGMENTS.Silent.color }}>
                        {risk}
                      </span>
                    ) : <span style={{ color: 'var(--muted)' }}>0</span>}
                  </td>
                  <td style={{ ...td, color: Number(r.growing) > 0 ? SEGMENTS.Growing.color : 'var(--muted)', fontWeight: 700 }}>{r.growing}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
