// src/components/vip/AffiliateSummary.jsx — Analytics tab: VIPs grouped by affiliate (代理分析)
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'
import { SEGMENTS, fmtRM, fetchAll } from '../../lib/depositProfile'
import { useLanguage } from '../../contexts/LanguageContext'

const th = { textAlign: 'right', padding: '10px 12px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
const td = { padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }

export default function AffiliateSummary() {
  const navigate = useNavigate()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [sortKey, setSortKey] = useState('dep_total_3m')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)

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

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>{L2('Loading affiliates…', '载入代理中…')}</div>
  if (err) return <div style={{ padding: 24, color: '#f87171' }}>{L2('Error loading affiliates', '载入代理出错')}: {err}</div>

  // Export: sheet 1 = affiliate summary (as shown), sheet 2 = every VIP with its affiliate
  async function exportExcel() {
    setExporting(true)
    try {
      const affName = a => a === '(direct)' ? 'Direct (no affiliate)' : a === '(unknown)' ? 'Unknown (no deposit data)' : a
      const summary = list.map(r => {
        const normal = Number(r.normal_month || 0)
        return {
          'Affiliate 代理': affName(r.affiliate),
          'VIPs': Number(r.vips), 'Gold': Number(r.gold), 'Platinum': Number(r.platinum), 'Diamond+': Number(r.diamond_plus),
          'Deposits Jul-Sep (RM)': Math.round(Number(r.dep_total_3m)),
          'Normal / month (RM)': Math.round(normal),
          'Last 30d (RM)': Math.round(Number(r.dep_30d)),
          'Trend %': normal > 0 ? Math.round((Number(r.dep_30d) / normal - 1) * 100) : '',
          'Silent': Number(r.silent), 'Declining': Number(r.declining), 'Need action': Number(r.silent) + Number(r.declining),
          'Growing': Number(r.growing), 'Stable': Number(r.stable), 'New': Number(r.new_vips),
        }
      })
      const [members, prof] = await Promise.all([
        fetchAll(() => supabase.from('vip_members')
          .select('username, full_name, tier, host_assigned, region, currency, affiliate_login, affiliate_updated_at, is_excluded')
          .order('username')),
        fetchAll(() => supabase.from('v_vip_deposit_profile')
          .select('login, segment, deposit_style, dep_total, dep_30d, dep_prev_60d, trend_pct, last_deposit_at, days_since_last, peak_day_name, peak_hour, main_method')
          .order('login')),
      ])
      const pm = {}; prof.forEach(p => { pm[p.login] = p })
      const vips = members.filter(m => !m.is_excluded).map(m => {
        const p = pm[m.username] || {}
        return {
          'Affiliate 代理': m.affiliate_login || (m.affiliate_updated_at ? 'Direct (no affiliate)' : 'Unknown (no deposit data)'),
          'Username': m.username, 'Full Name': m.full_name || '', 'Tier': m.tier || '', 'Host': m.host_assigned || '',
          'Region': m.region || '', 'Currency': m.currency || '',
          'Segment 分群': p.segment || 'No deposits', 'Deposit Style': p.deposit_style || '',
          'Deposits Jul-Sep (RM)': p.dep_total != null ? Math.round(Number(p.dep_total)) : 0,
          'Normal / month (RM)': p.dep_prev_60d != null ? Math.round(Number(p.dep_prev_60d) / 2) : 0,
          'Last 30d (RM)': p.dep_30d != null ? Math.round(Number(p.dep_30d)) : 0,
          'Trend %': p.trend_pct ?? '',
          'Last Deposit': p.last_deposit_at ? String(p.last_deposit_at).slice(0, 10) : '',
          'Days Since Last': p.days_since_last ?? '',
          'Best Time': p.peak_day_name ? `${p.peak_day_name} ${p.peak_hour}:00` : '',
          'Main Method': p.main_method || '',
        }
      }).sort((a, b) => a['Affiliate 代理'].localeCompare(b['Affiliate 代理']) || b['Deposits Jul-Sep (RM)'] - a['Deposits Jul-Sep (RM)'])

      const wb = XLSX.utils.book_new()
      const ws1 = XLSX.utils.json_to_sheet(summary)
      ws1['!cols'] = [{ wch: 26 }, ...Array(14).fill({ wch: 14 })]
      const ws2 = XLSX.utils.json_to_sheet(vips)
      ws2['!cols'] = [{ wch: 26 }, { wch: 18 }, { wch: 28 }, ...Array(14).fill({ wch: 14 })]
      ws1['!autofilter'] = { ref: ws1['!ref'] }
      ws2['!autofilter'] = { ref: ws2['!ref'] }
      XLSX.utils.book_append_sheet(wb, ws1, 'Affiliate Summary')
      XLSX.utils.book_append_sheet(wb, ws2, 'VIPs by Affiliate')
      XLSX.writeFile(wb, `Affiliates_VIPs_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      console.error('Affiliate export error', e)
      alert(L2('Export failed: ', '导出失败：') + (e.message || e))
    }
    setExporting(false)
  }

  const openList = (aff, segment) => {
    const a = aff === '(direct)' ? '__direct__' : aff === '(unknown)' ? '__unknown__' : aff
    navigate(`/vips?affiliate=${encodeURIComponent(a)}${segment ? `&segment=${segment}` : ''}`)
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0 8px 8px 8px', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{L2('🤝 Affiliates', '🤝 代理分析')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Affiliate taken from BO deposit records (Jul–Sep). Click a row to open those VIPs in All VIPs.', '代理数据取自BO存款记录（7–9月）。点击一行可在全部VIP中打开这些VIP。')}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[
            [L2('Affiliates with VIPs', '有VIP的代理'), totals.aff],
            [L2('VIPs via affiliate', '经代理的VIP'), totals.vips - totals.direct - totals.unknown],
            [L2('Direct (no affiliate)', '直客（无代理）'), totals.direct],
            [L2('Unknown (no deposit data)', '未知（无存款数据）'), totals.unknown],
            [L2('Deposits Jul–Sep', '7–9月存款'), fmtRM(totals.dep)],
          ].map(([l, v]) => (
            <div key={l} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{typeof v === 'number' ? v.toLocaleString() : v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L2('Search affiliate', '搜索代理')}
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text)', minWidth: 200 }} />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{L2(`${list.length} rows`, `${list.length} 行`)}</span>
        <button onClick={exportExcel} disabled={exporting} style={{
          background: 'var(--brand, #FF6B00)', color: '#fff', border: 'none', borderRadius: 6,
          padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? 0.6 : 1,
        }}>{exporting ? L2('Exporting…', '导出中…') : L2('⬇ Export Excel', '⬇ 导出Excel')}</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...th, textAlign: 'left' }} onClick={() => sortBy('affiliate')}>{L2('Affiliate', '代理')}{arrow('affiliate')}</th>
              <th style={th} onClick={() => sortBy('vips')}>{L2('VIPs', 'VIP数')}{arrow('vips')}</th>
              <th style={th} onClick={() => sortBy('gold')}>{L2('Gold', '黄金')}{arrow('gold')}</th>
              <th style={th} onClick={() => sortBy('platinum')}>{L2('Plat', '白金')}{arrow('platinum')}</th>
              <th style={th} onClick={() => sortBy('diamond_plus')}>{L2('Diamond+', '钻石+')}{arrow('diamond_plus')}</th>
              <th style={th} onClick={() => sortBy('dep_total_3m')}>{L2('Deposits Jul–Sep', '7–9月存款')}{arrow('dep_total_3m')}</th>
              <th style={th} onClick={() => sortBy('normal_month')}>{L2('Normal / mth', '平常 / 月')}{arrow('normal_month')}</th>
              <th style={th} onClick={() => sortBy('dep_30d')}>{L2('Last 30d', '近30天')}{arrow('dep_30d')}</th>
              <th style={th} onClick={() => sortBy('trend')}>{L2('Trend', '趋势')}{arrow('trend')}</th>
              <th style={th} onClick={() => sortBy('risk')} title={L2('Silent + Declining — click the number to open the list', '沉默 + 下滑 — 点击数字打开名单')}>{L2('🚨 Need action', '🚨 需跟进')}{arrow('risk')}</th>
              <th style={th} onClick={() => sortBy('growing')}>{L2('📈 Growing', '📈 增长')}{arrow('growing')}</th>
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
                    {r.affiliate === '(direct)' ? L2('Direct (no affiliate)', '直客（无代理）') : r.affiliate === '(unknown)' ? L2('Unknown (no deposit data)', '未知（无存款数据）') : r.affiliate}
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
