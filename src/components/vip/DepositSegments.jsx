// src/components/vip/DepositSegments.jsx — Analytics tab: deposit segments work list (充值分群)
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { TIER_COLOR, TIER_BG } from '../../lib/constants'
import { SEGMENTS, STYLES, fmtHour, fmtRM, fetchAll, dayNameZh } from '../../lib/depositProfile'
import { useLanguage } from '../../contexts/LanguageContext'
import { WaButton } from '../../components/WaSenderModal'

const sel = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text)' }
const th = { textAlign: 'left', padding: '10px 12px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
const td = { padding: '9px 12px', whiteSpace: 'nowrap' }

export default function DepositSegments({ myName = 'VIP Team' }) {
  const navigate = useNavigate()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [chaseOnly, setChaseOnly] = useState(false)
  const daysSince = d => (d ? Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000)) : null)
  // Needs chase: no deposit for 3+ days (live data) and not contacted since that last deposit
  const chaseInfo = r => {
    const m = members[r.login] || {}
    const dc = daysSince(m.lastContact), dd = daysSince(m.last_deposit_date)
    const cDay = m.lastContact ? String(m.lastContact).slice(0, 10) : null
    const needsChase = dd !== null && dd >= 3 && dd <= 30 && (cDay === null || cDay < String(m.last_deposit_date).slice(0, 10))
    return { dc, dd, needsChase, host: m.lastContactHost }
  }
  const [rows, setRows] = useState([])
  const [members, setMembers] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [segF, setSegF] = useState('RISK')       // RISK = Silent + Declining
  const [tierF, setTierF] = useState('ALL')
  const [hostF, setHostF] = useState('ALL')
  const [affF, setAffF] = useState('ALL')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('at_risk')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const prof = await fetchAll(() => supabase.from('v_vip_deposit_profile').select('*').order('login'))
        const mem = await fetchAll(() => supabase.from('vip_members').select('id, username, phone, whatsapp, is_excluded, last_deposit_date, last_contacted, last_contact_date').order('username'))
        const lc = await fetchAll(() => supabase.from('v_vip_last_contact').select('username,last_contact_at,last_contact_host').order('username'))
        const lcm = {}; lc.forEach(r => { lcm[r.username] = r })
        if (cancelled) return
        const map = {}
        mem.forEach(m => {
          const cands = [lcm[m.username]?.last_contact_at, m.last_contacted, m.last_contact_date].filter(Boolean)
          const lastContact = cands.length ? cands.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null
          map[m.username] = { ...m, lastContact, lastContactHost: lcm[m.username]?.last_contact_host || null }
        })
        setMembers(map)
        setRows(prof.filter(p => !map[p.login]?.is_excluded))
      } catch (e) {
        console.error('DepositSegments load error', e)
        if (!cancelled) setErr(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const hosts = useMemo(() => [...new Set(rows.map(r => r.host_assigned).filter(Boolean))].sort(), [rows])
  const affs = useMemo(() => [...new Set(rows.map(r => r.affiliate_login).filter(Boolean))].sort(), [rows])
  const tiers = useMemo(() => [...new Set(rows.map(r => r.tier).filter(Boolean))].sort(), [rows])

  // rows after tier/host/search (segment counts reflect these filters)
  const scoped = useMemo(() => rows.filter(r =>
    (tierF === 'ALL' || r.tier === tierF) &&
    (hostF === 'ALL' || (hostF === '__none' ? !r.host_assigned : r.host_assigned === hostF)) &&
    (affF === 'ALL' || (affF === '__direct' ? !r.affiliate_login : r.affiliate_login === affF)) &&
    (!search || r.login.toLowerCase().includes(search.toLowerCase()) || (r.member_name || '').toLowerCase().includes(search.toLowerCase()))
  ), [rows, tierF, hostF, affF, search])

  const counts = useMemo(() => {
    const c = {}
    Object.keys(SEGMENTS).forEach(k => { c[k] = { n: 0, normal: 0 } })
    scoped.forEach(r => { if (c[r.segment]) { c[r.segment].n++; c[r.segment].normal += Number(r.dep_prev_60d || 0) / 2 } })
    return c
  }, [scoped])

  const list = useMemo(() => {
    const f = scoped.filter(r => segF === 'ALL' || (segF === 'RISK' ? (r.segment === 'Silent' || r.segment === 'Declining') : r.segment === segF)).filter(r => !chaseOnly || chaseInfo(r).needsChase)
    const val = r => {
      switch (sortKey) {
        case 'at_risk': return Math.max(0, Number(r.dep_prev_60d || 0) / 2 - Number(r.dep_30d || 0))
        case 'normal': return Number(r.dep_prev_60d || 0) / 2
        case 'dep_30d': return Number(r.dep_30d || 0)
        case 'trend': return r.trend_pct === null ? -9999 : Number(r.trend_pct)
        case 'days': return Number(r.days_since_last || 0)
        case 'overdue': return Number(r.overdue_ratio || 0)
        case 'contact': { const d = chaseInfo(r).dc; return d === null ? 99999 : d }
        case 'login': return r.login
        default: return 0
      }
    }
    return [...f].sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y
      return sortDir === 'asc' ? c : -c
    })
  }, [scoped, segF, sortKey, sortDir, chaseOnly, members])

  function sortBy(k) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'login' ? 'asc' : 'desc') }
  }
  const arrow = k => (sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>{L2('Loading deposit segments…', '载入存款分群中…')}</div>
  if (err) return <div style={{ padding: 24, color: '#f87171' }}>{L2('Error loading deposit segments', '载入存款分群出错')}: {err}</div>

  const asOf = String(rows[0]?.data_as_of || '').slice(0, 10)

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0 8px 8px 8px', overflow: 'hidden' }}>
      {/* Segment cards */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{L2('🧭 Deposit Segments', '🧭 充值分群')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2(`Based on deposit logs · data up to ${asOf} · "normal" = monthly average of the 60 days before the last 30`, `基于存款记录 · 数据截至 ${asOf} · “平常” = 近30天之前60天的月平均`)}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[['RISK', null], ...Object.keys(SEGMENTS).map(k => [k, SEGMENTS[k]]), ['ALL', null]].map(([k, s]) => {
            const active = segF === k
            const n = k === 'ALL' ? scoped.length : k === 'RISK' ? counts.Silent.n + counts.Declining.n : counts[k].n
            const color = s ? s.color : k === 'RISK' ? '#FF6B00' : 'var(--text)'
            const title = k === 'RISK' ? L2('🚨 Need action', '🚨 需跟进') : k === 'ALL' ? L2('👥 All', '👥 全部') : `${s.icon} ${L2(k, s.zh)}`
            const sub = k === 'RISK' ? L2('Silent + Declining', '沉默 + 下滑') : k === 'ALL' ? L2('All depositors', '全部存款玩家') : L2(s.desc, s.descZh)
            return (
              <button key={k} onClick={() => setSegF(k)} style={{
                textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px',
                background: active ? (s ? s.bg : 'rgba(255,107,0,.12)') : 'var(--surface2)',
                border: active ? `1.5px solid ${color}` : '1px solid var(--border)', color: 'var(--text)',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color }}>{title}</div>
                <div style={{ fontSize: 22, fontWeight: 800, margin: '2px 0' }}>{n}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={sel}>
          <option value="ALL">{L2('All tiers', '全部等级')}</option>
          {tiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={hostF} onChange={e => setHostF(e.target.value)} style={sel}>
          <option value="ALL">{L2('All hosts', '全部负责人')}</option>
          <option value="__none">{L2('(No host)', '（无负责人）')}</option>
          {hosts.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <select value={affF} onChange={e => setAffF(e.target.value)} style={sel}>
          <option value="ALL">{L2('All affiliates', '全部代理')}</option>
          <option value="__direct">{L2('Direct (no affiliate)', '直客（无代理）')}</option>
          {affs.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L2('Search username / name', '搜索用户名 / 姓名')} style={{ ...sel, minWidth: 180 }} />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{L2(`${list.length} players`, `${list.length} 位玩家`)}</span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...th, cursor: 'default' }}>#</th>
              <th style={th} onClick={() => sortBy('login')}>{L2('Player', '玩家')}{arrow('login')}</th>
              <th style={th}>{L2('Tier', '等级')}</th>
              <th style={th}>{L2('Host', '负责人')}</th>
              <th style={th}>{L2('Affiliate', '代理')}</th>
              <th style={th}>{L2('Segment', '分群')}</th>
              <th style={th}>{L2('Style', '类型')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('normal')}>{L2('Normal / mth', '平常 / 月')}{arrow('normal')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('dep_30d')}>{L2('Last 30d', '近30天')}{arrow('dep_30d')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('at_risk')} title={L2('Normal monthly minus last 30 days', '平常月额减去近30天')}>{L2('Shortfall', '差额')}{arrow('at_risk')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('trend')}>{L2('Trend', '趋势')}{arrow('trend')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('days')}>{L2('Days since', '距今天数')}{arrow('days')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('overdue')} title={L2('Days since last deposit ÷ usual gap', '距上次存款天数 ÷ 平常间隔')}>{L2('Overdue', '逾期倍数')}{arrow('overdue')}</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => sortBy('contact')} title={L2('Days since last contact (from Contact Log)', '距最后联系天数（来自联系记录）')}>{L2('Last contact', '最后联系')}{arrow('contact')}</th>
              <th style={th}>{L2('Best time', '最佳时间')}</th>
              <th style={{ ...th, textAlign: 'center', cursor: 'default' }}>WA</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={16} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>{L2('No players in this segment.', '此分群没有玩家。')}</td></tr>
            ) : list.map((r, rowIdx) => {
              const m = members[r.login] || {}
              const seg = SEGMENTS[r.segment] || SEGMENTS.Stable
              const sty = STYLES[r.deposit_style] || STYLES.Regular
              const normal = Number(r.dep_prev_60d || 0) / 2
              const shortfall = Math.max(0, normal - Number(r.dep_30d || 0))
              const trend = r.trend_pct === null || r.trend_pct === undefined ? null : Number(r.trend_pct)
              const overdue = Number(r.overdue_ratio || 0)
              const ci = chaseInfo(r)
              const rawNumber = (m.phone && m.phone.replace(/\D/g, '').length >= 10) ? m.phone
                : (m.whatsapp && m.whatsapp.replace(/\D/g, '').length >= 10) ? m.whatsapp : ''
              const waNumber = rawNumber.replace(/\D/g, '')
              return (
                <tr key={r.login} style={{ borderBottom: '1px solid var(--border)', background: ci.needsChase ? 'rgba(248,81,73,.08)' : 'transparent', boxShadow: ci.needsChase ? 'inset 3px 0 0 #f85149' : 'none' }}
                  title={ci.needsChase ? L2('Needs chase: no deposit for 3–30 days and not contacted since the last deposit', '需跟进：3–30天未存款，且最后存款后未联系') : undefined}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = ci.needsChase ? 'rgba(248,81,73,.08)' : 'transparent' }}>
                  <td style={{ ...td, color: 'var(--muted)', fontSize: 12, width: 36 }}>{rowIdx + 1}</td>
                  <td style={td}>
                    {m.id ? (
                      <span onClick={() => navigate(`/vips/${m.id}`)} style={{ fontWeight: 700, color: 'var(--brand, #FF6B00)', cursor: 'pointer' }}>{r.login}</span>
                    ) : <span style={{ fontWeight: 700 }}>{r.login}</span>}
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.member_name}</div>
                  </td>
                  <td style={td}>
                    {r.tier && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: TIER_BG[r.tier] || 'transparent', color: TIER_COLOR[r.tier] || 'var(--text)' }}>{r.tier}</span>}
                  </td>
                  <td style={{ ...td, color: r.host_assigned ? 'var(--text)' : 'var(--muted)' }}>{r.host_assigned || '—'}</td>
                  <td style={{ ...td, color: r.affiliate_login ? 'var(--brand, #FF6B00)' : 'var(--muted)', fontWeight: r.affiliate_login ? 600 : 400 }}>{r.affiliate_login || L2('Direct', '直客')}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: seg.bg, color: seg.color }}>{seg.icon} {L2(r.segment, seg.zh)}</span>
                  </td>
                  <td style={td} title={r.deposit_style}>{sty.icon} {L2(r.deposit_style, sty.zh)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtRM(normal)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtRM(r.dep_30d)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: shortfall > 0 ? '#f87171' : 'var(--muted)' }}>{shortfall > 0 ? fmtRM(shortfall) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: trend === null ? 'var(--muted)' : trend < 0 ? '#f87171' : '#34d399' }}>
                    {trend === null ? '—' : `${trend > 0 ? '+' : ''}${trend}%`}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.days_since_last}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: overdue >= 2 ? 700 : 400, color: overdue >= 2 ? '#f87171' : 'var(--text)' }}>
                    {r.avg_gap_days ? `${overdue}×` : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: ci.needsChase ? '#f85149' : 'var(--muted)', fontWeight: ci.needsChase ? 700 : 400 }}>
                    {ci.dc === null ? L2('Never', '从未') : ci.dc === 0 ? L2('Today', '今天') : L2(`${ci.dc}d ago`, `${ci.dc}天前`)}
                    {ci.host && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{ci.host}</div>}
                  </td>
                  <td style={td}>{L2(r.peak_day_name, dayNameZh(r.peak_day_name))} {fmtHour(r.peak_hour, lang)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {waNumber ? (
                      <WaButton vip={{ ...r, username: r.login, phone: waNumber }} purpose="decline" style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 13, background: '#25D366', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>W</WaButton>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
