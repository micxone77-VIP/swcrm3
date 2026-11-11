// src/components/vip/AffiliateSummary.jsx — Analytics tab: VIPs grouped by affiliate (代理分析)
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'
import { SEGMENTS, fmtRM, fetchAll } from '../../lib/depositProfile'
import { useLanguage } from '../../contexts/LanguageContext'
import { formatMoney } from '../../lib/format'
import { loadPlayerCosts } from '../../lib/playerCost'
import CopyBtn from '../CopyBtn'

// Same grouping as v_affiliate_vip_summary
const affOf = m => m.affiliate_login || (m.affiliate_updated_at ? '(direct)' : '(unknown)')
const COST_PARTS = [['bonus', 'Bonus', '奖金'], ['rebate', 'Rebate', '返水'], ['campaign', 'Campaign', '活动奖励'], ['boBonus', 'BO bonus', '后台红包'], ['spend', 'Spending', '部门开销']]

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
  const [members, setMembers] = useState([])
  const [costInfo, setCostInfo] = useState(null)   // { costs, missing } from loadPlayerCosts
  const [open, setOpen] = useState(null)           // affiliate whose members are shown

  useEffect(() => {
    let cancelled = false
    fetchAll(() => supabase.from('v_affiliate_vip_summary').select('*').order('affiliate'))
      .then(d => { if (!cancelled) setRows(d) })
      .catch(e => { console.error('AffiliateSummary load error', e); if (!cancelled) setErr(e.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    // Members + what the company has spent on each (bonus, rebate, campaign, BO bonus, department spending)
    fetchAll(() => supabase.from('vip_members').select('id,username,full_name,tier,currency,host_assigned,activity_status,affiliate_login,affiliate_updated_at,is_excluded').order('username'))
      .then(async ms => {
        const list = ms.filter(m => !m.is_excluded)
        if (cancelled) return
        setMembers(list)
        const ci = await loadPlayerCosts(list)
        if (!cancelled) setCostInfo(ci)
      })
      .catch(e => { console.error('Affiliate cost load error', e); if (!cancelled) setCostInfo({ costs: {}, missing: ['all'] }) })
    return () => { cancelled = true }
  }, [])

  // Per affiliate: members (biggest cost first) and cost totals per currency (MYR and SGD never added together)
  const byAff = useMemo(() => {
    const out = {}
    members.forEach(m => {
      const a = affOf(m)
      const g = out[a] || (out[a] = { members: [], cur: {} })
      const c = costInfo?.costs?.[m.username]
      g.members.push({ ...m, cost: c })
      if (c) {
        const cur = String(m.currency || 'MYR').toUpperCase()
        const t = g.cur[cur] || (g.cur[cur] = { total: 0, bonus: 0, rebate: 0, campaign: 0, boBonus: 0, spend: 0 })
        Object.keys(t).forEach(k => { t[k] += Number(c[k]) || 0 })
      }
    })
    Object.values(out).forEach(g => g.members.sort((x, y) => (y.cost?.total || 0) - (x.cost?.total || 0)))
    return out
  }, [members, costInfo])
  const costTotal = aff => Object.values(byAff[aff]?.cur || {}).reduce((s, t) => s + t.total, 0)
  const costLines = aff => Object.entries(byAff[aff]?.cur || {}).filter(([, t]) => t.total > 0)

  const list = useMemo(() => {
    const f = rows.filter(r => !search || r.affiliate.toLowerCase().includes(search.toLowerCase()))
    const val = r => sortKey === 'affiliate' ? r.affiliate
      : sortKey === 'trend' ? (Number(r.normal_month) > 0 ? Number(r.dep_30d) / Number(r.normal_month) : -1)
      : sortKey === 'risk' ? Number(r.silent) + Number(r.declining)
      : sortKey === 'cost' ? costTotal(r.affiliate)
      : sortKey === 'cost_per_vip' ? costTotal(r.affiliate) / Math.max(Number(r.vips) || 1, 1)
      : Number(r[sortKey] || 0)
    return [...f].sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y
      return sortDir === 'asc' ? c : -c
    })
  }, [rows, search, sortKey, sortDir, byAff]) // eslint-disable-line react-hooks/exhaustive-deps

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
          'Cost so far': costLines(r.affiliate).map(([c, t]) => `${c} ${Math.round(t.total)}`).join(' / '),
          ...Object.fromEntries(COST_PARTS.map(([k, en]) => [en, costLines(r.affiliate).map(([c, t]) => `${c} ${Math.round(t[k])}`).join(' / ')])),
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
          'Cost so far': Math.round(costInfo?.costs?.[m.username]?.total || 0),
          ...Object.fromEntries(COST_PARTS.map(([k, en]) => [en, Math.round(costInfo?.costs?.[m.username]?.[k] || 0)])),
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
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Affiliate taken from BO deposit records (Jul–Sep). Click a row to see the VIPs under that affiliate and what we spent on each; ↗ opens them in All VIPs.', '代理数据取自BO存款记录（7–9月）。点击一行查看该代理下的VIP及每人的成本；↗ 在全部VIP中打开。')}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', width: '100%' }}>{L2('Cost so far = bonus + rebate (daily report, since Jun 2026) + paid campaign rewards + BO bonuses + department spending tagged to the player.', '累计成本 = 奖金 + 返水（每日报表，2026年6月起）+ 已派活动奖励 + 后台红包 + 记在该玩家名下的部门开销。')}{costInfo?.missing?.length > 0 && <span style={{ color: '#d29922' }}> {L2(`⚠️ Could not read: ${costInfo.missing.join(', ')} (not included).`, `⚠️ 无法读取：${costInfo.missing.join('、')}（未计入）。`)}</span>}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[
            [L2('Affiliates with VIPs', '有VIP的代理'), totals.aff],
            [L2('VIPs via affiliate', '经代理的VIP'), totals.vips - totals.direct - totals.unknown],
            [L2('Direct (no affiliate)', '直客（无代理）'), totals.direct],
            [L2('Unknown (no deposit data)', '未知（无存款数据）'), totals.unknown],
            [L2('Deposits Jul–Sep', '7–9月存款'), fmtRM(totals.dep)],
            [L2('Spent on affiliate VIPs', '代理VIP累计成本'), !costInfo ? '…' : (() => {
              const cur = {}
              Object.entries(byAff).filter(([a]) => !a.startsWith('(')).forEach(([, g]) => Object.entries(g.cur).forEach(([c, t]) => { cur[c] = (cur[c] || 0) + t.total }))
              return Object.entries(cur).filter(([, v]) => v > 0).map(([c, v]) => formatMoney(v, c)).join(' · ') || '—'
            })()],
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
              <th style={{ ...th, textAlign: 'left', cursor: 'default' }}>#</th>
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
              <th style={th} onClick={() => sortBy('cost')}>{L2('💸 Cost so far', '💸 累计成本')}{arrow('cost')}</th>
              <th style={th} onClick={() => sortBy('cost_per_vip')}>{L2('Cost / VIP', '每位成本')}{arrow('cost_per_vip')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, rowIdx) => {
              const normal = Number(r.normal_month || 0)
              const trend = normal > 0 ? Math.round((Number(r.dep_30d) / normal - 1) * 100) : null
              const risk = Number(r.silent) + Number(r.declining)
              const special = r.affiliate.startsWith('(')
              const isOpen = open === r.affiliate
              const lines = costLines(r.affiliate)
              const g = byAff[r.affiliate]
              return (
                <Fragment key={r.affiliate}>
                <tr onClick={() => setOpen(isOpen ? null : r.affiliate)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isOpen ? 'var(--surface2)' : 'transparent' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = isOpen ? 'var(--surface2)' : 'transparent' }}>
                  <td style={{ ...td, textAlign: 'left', color: 'var(--muted)', fontSize: 12, width: 36 }}>{isOpen ? '▾' : '▸'} {rowIdx + 1}</td>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700, color: special ? 'var(--muted)' : 'var(--brand, #FF6B00)' }}>
                    {r.affiliate === '(direct)' ? L2('Direct (no affiliate)', '直客（无代理）') : r.affiliate === '(unknown)' ? L2('Unknown (no deposit data)', '未知（无存款数据）') : r.affiliate}
                    {!special && <CopyBtn text={r.affiliate} />}
                    <button title={L2('Open these VIPs in All VIPs', '在全部VIP中打开')} onClick={e => { e.stopPropagation(); openList(r.affiliate) }} style={{ marginLeft: 6, background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--muted)', fontSize: 11, padding: '0 6px', cursor: 'pointer' }}>↗</button>
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
                  <td style={{ ...td, fontWeight: 700, color: '#f0883e' }}>{!costInfo ? '…' : lines.length ? lines.map(([c, t]) => <div key={c}>{formatMoney(t.total, c)}</div>) : '—'}</td>
                  <td style={td}>{!costInfo ? '…' : lines.length ? lines.map(([c, t]) => <div key={c}>{formatMoney(t.total / Math.max((g?.members || []).filter(m => String(m.currency || 'MYR').toUpperCase() === c).length, 1), c)}</div>) : '—'}</td>
                </tr>
                {isOpen && (
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td colSpan={14} style={{ padding: '10px 16px 16px', background: 'var(--surface2)' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                        <b style={{ fontSize: 13 }}>{L2(`${g?.members.length || 0} VIPs under this affiliate`, `此代理下 ${g?.members.length || 0} 位VIP`)}</b>
                        {lines.map(([c, t]) => <span key={c} style={{ fontSize: 12, color: 'var(--muted)' }}>{COST_PARTS.map(([k, en, zh]) => `${L2(en, zh)} ${formatMoney(t[k], c)}`).join(' · ')}</span>)}
                        {g?.members.length > 0 && <button onClick={() => navigator.clipboard.writeText(g.members.map(m => m.username).join('\n')).catch(() => {})} style={{ marginLeft: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>📋 {L2('Copy usernames', '复制用户名')}</button>}
                      </div>
                      {!costInfo && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{L2('Loading costs…', '载入成本中…')}</div>}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['#', L2('Player', '玩家'), L2('Tier', '等级'), L2('Host', '负责人'), L2('Status', '状态'), ...COST_PARTS.map(([, en, zh]) => L2(en, zh)), L2('Total cost', '总成本')].map((h, i) => <th key={i} style={{ ...th, cursor: 'default', textAlign: i < 5 ? 'left' : 'right' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {(g?.members || []).map((m, i) => (
                              <tr key={m.username} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }}>{i + 1}</td>
                                <td style={{ ...td, textAlign: 'left' }}><span onClick={() => navigate(`/vips/${m.id}`)} style={{ fontWeight: 700, cursor: 'pointer' }}>{m.username}</span><CopyBtn text={m.username} />{m.full_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.full_name}</div>}</td>
                                <td style={{ ...td, textAlign: 'left' }}>{m.tier}</td>
                                <td style={{ ...td, textAlign: 'left' }}>{m.host_assigned || '—'}</td>
                                <td style={{ ...td, textAlign: 'left' }}>{m.activity_status || '—'}</td>
                                {COST_PARTS.map(([k]) => <td key={k} style={{ ...td, color: m.cost?.[k] ? 'var(--text)' : 'var(--muted)' }}>{m.cost ? (m.cost[k] ? formatMoney(m.cost[k], m.currency) : '0') : '…'}</td>)}
                                <td style={{ ...td, fontWeight: 700, color: '#f0883e' }}>{m.cost ? formatMoney(m.cost.total, m.currency) : '…'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
