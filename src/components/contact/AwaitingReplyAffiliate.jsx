// src/components/contact/AwaitingReplyAffiliate.jsx — Contact Log → "Awaiting Reply" tab
// VIPs whose latest contact is still unanswered ("Contacted" / "No Reply"), grouped by affiliate,
// so the host can hand them over to the affiliate: copy message, Excel export, mark as escalated.
// Escalations are stored in affiliate_escalations (NOT contact_logs) so they don't count as contacts.
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { fetchAll } from '../../lib/depositProfile'
import { TIER_COLOR, TIER_BG } from '../../lib/constants'

const UNANSWERED = ['Contacted', 'No Reply']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const daysBetween = (a, b = new Date()) => (a ? Math.max(0, Math.floor((b - new Date(a)) / 86400000)) : null)
const dShort = (d, lang) => { if (!d) return '—'; const x = new Date(d); return lang === 'zh' ? `${x.getMonth() + 1}月${x.getDate()}日` : `${x.getDate()} ${MON[x.getMonth()]}` }
const dIso = d => (d ? new Date(d).toISOString().slice(0, 10) : '')
const DIRECT = '(Direct)', UNKNOWN = '(Unknown)'

const st = {
  page: { padding: '24px 28px', minHeight: '100vh' },
  title: { fontSize: 22, fontWeight: 800, color: 'var(--text)' },
  sub: { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  sel: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text)' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  pri: { background: 'var(--brand, #FF6B00)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  th: { textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' },
  td: { padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, whiteSpace: 'nowrap' },
}

export default function AwaitingReplyAffiliate({ onBack, myName, viewMode }) {
  const { lang } = useLanguage()
  const { profile } = useAuth()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [rows, setRows] = useState([])
  const [minDays, setMinDays] = useState('3')
  const [tierF, setTierF] = useState('ALL')
  const [affF, setAffF] = useState('ALL')
  const [search, setSearch] = useState('')
  const [hideEscalated, setHideEscalated] = useState(true)
  const [grouped, setGrouped] = useState(true)
  const [msgLang, setMsgLang] = useState(lang === 'zh' ? 'zh' : 'en')
  const [toast, setToast] = useState('')
  const flash = m => { setToast(m); setTimeout(() => setToast(''), 2200) }

  async function load() {
    setLoading(true); setErr('')
    try {
      const since = new Date(); since.setDate(since.getDate() - 120)
      const [logs, members, esc] = await Promise.all([
        fetchAll(() => {
          let q = supabase.from('contact_logs').select('id, username, vip_id, tier, host_name, outcome, notes, logged_at')
            .gte('logged_at', since.toISOString()).order('logged_at', { ascending: false }).order('id')
          if (viewMode === 'mine' && myName) q = q.eq('host_name', myName)
          return q
        }),
        fetchAll(() => supabase.from('vip_members').select('id, username, full_name, tier, host_assigned, affiliate_login, affiliate_updated_at, last_deposit_date, phone, whatsapp, is_excluded').order('username')),
        fetchAll(() => supabase.from('affiliate_escalations').select('username, affiliate_login, escalated_at, escalated_by').gte('escalated_at', since.toISOString()).order('escalated_at', { ascending: false })),
      ])
      const mem = {}; members.forEach(m => { mem[m.username] = m })
      const escBy = {}; esc.forEach(e => { if (!escBy[e.username]) escBy[e.username] = e })
      const byUser = {}; logs.forEach(l => { (byUser[l.username] = byUser[l.username] || []).push(l) })
      const now = new Date()
      const out = []
      Object.entries(byUser).forEach(([username, list]) => {
        const m = mem[username]
        if (m?.is_excluded) return
        if (!UNANSWERED.includes(list[0].outcome)) return
        // consecutive unanswered attempts since the last reply / deposit / reactivation
        const streak = []
        for (const l of list) { if (UNANSWERED.includes(l.outcome)) streak.push(l); else break }
        const first = streak[streak.length - 1], latest = streak[0]
        const anyNoReply = streak.some(l => l.outcome === 'No Reply')
        const e = escBy[username]
        const escalated = e && new Date(e.escalated_at) >= new Date(first.logged_at) ? e : null
        out.push({
          username, vip_id: m?.id || latest.vip_id, full_name: m?.full_name || '', tier: m?.tier || latest.tier,
          host: latest.host_name || m?.host_assigned || '', note: latest.notes || '',
          affiliate: m?.affiliate_login || (m?.affiliate_updated_at ? DIRECT : UNKNOWN),
          attempts: streak.length, firstAt: first.logged_at, lastAt: latest.logged_at,
          daysNoReply: daysBetween(first.logged_at, now), daysSinceLastTry: daysBetween(latest.logged_at, now),
          status: anyNoReply || streak.length >= 3 ? 'unreachable' : 'no_reply',
          lastDeposit: m?.last_deposit_date || null, daysSinceDeposit: daysBetween(m?.last_deposit_date, now),
          phone: m?.phone, whatsapp: m?.whatsapp, escalated,
        })
      })
      setRows(out)
    } catch (e) { console.error('AwaitingReplyAffiliate load', e); setErr(e.message || String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [viewMode, myName])

  const affOptions = useMemo(() => [...new Set(rows.map(r => r.affiliate))].sort((a, b) => (a.startsWith('(') - b.startsWith('(')) || a.localeCompare(b)), [rows])
  const filtered = rows.filter(r =>
    r.daysNoReply >= Number(minDays) &&
    (tierF === 'ALL' || String(r.tier || '').toUpperCase() === tierF) &&
    (affF === 'ALL' || r.affiliate === affF) &&
    (!hideEscalated || !r.escalated) &&
    (!search || r.username.toLowerCase().includes(search.toLowerCase()) || r.full_name.toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => b.daysNoReply - a.daysNoReply)

  const groups = useMemo(() => {
    const g = {}
    filtered.forEach(r => { (g[r.affiliate] = g[r.affiliate] || []).push(r) })
    return Object.entries(g).sort(([a, x], [b, y]) => (a.startsWith('(') - b.startsWith('(')) || y.length - x.length)
  }, [filtered])

  const affLabel = a => (a === DIRECT ? L2('Direct (no affiliate)', '直客（无代理）') : a === UNKNOWN ? L2('Unknown affiliate', '代理未知') : a)
  const statusLabel = (s, lg = lang) => (s === 'unreachable' ? (lg === 'zh' ? '联系不上' : 'Unable to reach') : (lg === 'zh' ? '未回复' : 'No reply'))

  function buildMessage(aff, list) {
    const host = profile?.full_name || myName || 'sureWin VIP'
    if (msgLang === 'zh') {
      const lines = list.map((r, i) => `${i + 1}. ${r.username}（${r.tier || '-'}）— ${statusLabel(r.status, 'zh')} ${r.daysNoReply} 天（联系 ${r.attempts} 次），最后存款：${r.lastDeposit ? `${dShort(r.lastDeposit, 'zh')}（${r.daysSinceDeposit} 天前）` : '无记录'}`)
      return [`${aff.startsWith('(') ? '' : aff + ' '}您好！我是sureWin VIP部门的${host}。`, '', `以下 ${list.length} 位玩家我们一直联系不上 / 没有回复，麻烦您那边帮忙联系一下：`, '', ...lines, '', '谢谢！🙏'].join('\n')
    }
    const lines = list.map((r, i) => `${i + 1}. ${r.username} (${r.tier || '-'}) — ${statusLabel(r.status, 'en').toLowerCase()} for ${r.daysNoReply} days (${r.attempts} attempt${r.attempts === 1 ? '' : 's'}), last deposit: ${r.lastDeposit ? `${dShort(r.lastDeposit, 'en')} (${r.daysSinceDeposit} days ago)` : 'none'}`)
    return [`Hi ${aff.startsWith('(') ? '' : aff}, this is ${host} from sureWin VIP.`, '', `We have not been able to reach the ${list.length} player${list.length === 1 ? '' : 's'} below. Could you help contact them from your side?`, '', ...lines, '', 'Thank you! 🙏'].join('\n')
  }

  async function copyMessage(aff, list) {
    const text = buildMessage(aff, list)
    try { await navigator.clipboard.writeText(text) } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    flash(L2(`Message for ${affLabel(aff)} copied (${list.length} VIPs)`, `已复制给 ${affLabel(aff)} 的信息（${list.length} 位VIP）`))
  }

  const sheetRows = list => list.map(r => ({
    'Affiliate': r.affiliate, 'Username': r.username, 'Name': r.full_name, 'Tier': r.tier || '',
    'Status': statusLabel(r.status, 'en'), 'Days No Reply': r.daysNoReply, 'Contact Attempts': r.attempts,
    'First Unanswered Contact': dIso(r.firstAt), 'Last Contact': dIso(r.lastAt),
    'Last Deposit': r.lastDeposit || '', 'Days Since Last Deposit': r.daysSinceDeposit ?? '', 'Host': r.host,
  }))
  function sheetName(name, used) {
    let base = String(name).replace(/[\[\]:*?/\\]/g, '').slice(0, 28) || 'Sheet'
    let n = base, i = 2
    while (used.has(n)) n = `${base.slice(0, 26)}_${i++}`
    used.add(n); return n
  }
  function exportExcel(only) {
    const list = only ? groups.filter(([a]) => a === only) : groups
    if (!list.length) return
    const wb = XLSX.utils.book_new(), used = new Set()
    if (!only) {
      const summary = list.map(([a, l]) => ({ 'Affiliate': a, 'VIPs': l.length, 'Unable to reach': l.filter(r => r.status === 'unreachable').length, 'Longest no reply (days)': Math.max(...l.map(r => r.daysNoReply)) }))
      const ws = XLSX.utils.json_to_sheet(summary); ws['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 16 }, { wch: 22 }]
      XLSX.utils.book_append_sheet(wb, ws, sheetName('Summary', used))
    }
    list.forEach(([a, l]) => {
      const ws = XLSX.utils.json_to_sheet(sheetRows(l))
      ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 15 }, { wch: 13 }, { wch: 15 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 12 }]
      ws['!autofilter'] = { ref: ws['!ref'] }
      XLSX.utils.book_append_sheet(wb, ws, sheetName(a.replace(/[()]/g, ''), used))
    })
    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, only ? `NoReply_${only.replace(/[^\w]+/g, '')}_${today}.xlsx` : `NoReply_ByAffiliate_${today}.xlsx`)
  }

  async function markEscalated(aff, list) {
    if (aff.startsWith('(')) return
    if (!window.confirm(L2(`Mark ${list.length} VIP(s) as handed over to ${aff}?`, `确定将 ${list.length} 位VIP标记为已转交给 ${aff}？`))) return
    const nowIso = new Date().toISOString()
    const recs = list.map(r => ({
      username: r.username, vip_id: r.vip_id || null, affiliate_login: aff, reason: r.status,
      days_no_reply: r.daysNoReply, attempts: r.attempts, last_contact_at: r.lastAt, last_deposit_date: r.lastDeposit,
      escalated_by: profile?.full_name || myName || null, escalated_by_id: profile?.id || null, escalated_at: nowIso,
    }))
    const { error } = await supabase.from('affiliate_escalations').insert(recs)
    if (error) return flash(L2('Save failed: ', '保存失败：') + error.message)
    flash(L2(`Marked ${list.length} VIP(s) as handed over to ${aff}`, `已标记 ${list.length} 位VIP转交给 ${aff}`))
    load()
  }

  const totalUnreach = filtered.filter(r => r.status === 'unreachable').length

  const table = list => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={st.th}>#</th><th style={st.th}>VIP</th><th style={st.th}>{L2('Tier', '等级')}</th>
          {!grouped && <th style={st.th}>{L2('Affiliate', '代理')}</th>}
          <th style={st.th}>{L2('Status', '状态')}</th><th style={st.th}>{L2('Days no reply', '未回复天数')}</th>
          <th style={st.th}>{L2('Attempts', '联系次数')}</th><th style={st.th}>{L2('Last contact', '最后联系')}</th>
          <th style={st.th}>{L2('Last deposit', '最后存款')}</th><th style={st.th}>{L2('Host', '负责人')}</th>
          <th style={st.th}>{L2('Last note', '最后备注')}</th><th style={st.th}>WA</th>
        </tr></thead>
        <tbody>
          {list.map((r, rowIdx) => {
            const raw = (r.phone && r.phone.replace(/\D/g, '').length >= 10) ? r.phone : (r.whatsapp && r.whatsapp.replace(/\D/g, '').length >= 10) ? r.whatsapp : ''
            const wa = raw.replace(/\D/g, '')
            const greet = encodeURIComponent(`Hi ${r.username}, just following up — wanted to check if you saw my earlier message. This is ${r.host || myName || 'the VIP team'}.`)
            return (
              <tr key={r.username}>
                <td style={{ ...st.td, color: 'var(--muted)', fontSize: 12, width: 36 }}>{rowIdx + 1}</td>
                <td style={st.td}><b>{r.username}</b><div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.full_name}</div></td>
                <td style={st.td}>{r.tier && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: TIER_BG[r.tier] || 'transparent', color: TIER_COLOR[r.tier] || 'var(--text)' }}>{r.tier}</span>}</td>
                {!grouped && <td style={{ ...st.td, color: r.affiliate.startsWith('(') ? 'var(--muted)' : 'var(--brand, #FF6B00)', fontWeight: 600 }}>{affLabel(r.affiliate)}</td>}
                <td style={st.td}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: r.status === 'unreachable' ? 'rgba(248,81,73,.15)' : 'rgba(210,153,34,.15)', color: r.status === 'unreachable' ? '#f85149' : '#d29922' }}>{statusLabel(r.status)}</span>
                  {r.escalated && <div style={{ fontSize: 10, color: '#a78bfa', marginTop: 2 }}>↗ {L2('Handed over', '已转交')} {dShort(r.escalated.escalated_at, lang)}</div>}</td>
                <td style={{ ...st.td, fontWeight: 700, color: r.daysNoReply >= 7 ? '#f85149' : r.daysNoReply >= 3 ? '#d29922' : 'var(--text)' }}>{L2(`${r.daysNoReply}d`, `${r.daysNoReply}天`)}</td>
                <td style={st.td}>{r.attempts}</td>
                <td style={st.td}>{dShort(r.lastAt, lang)} <span style={{ color: 'var(--muted)' }}>({L2(`${r.daysSinceLastTry}d ago`, `${r.daysSinceLastTry}天前`)})</span></td>
                <td style={st.td}>{r.lastDeposit ? <>{dShort(r.lastDeposit, lang)} <span style={{ color: 'var(--muted)' }}>({L2(`${r.daysSinceDeposit}d ago`, `${r.daysSinceDeposit}天前`)})</span></> : '—'}</td>
                <td style={{ ...st.td, color: 'var(--muted)' }}>{r.host || '—'}</td>
                <td style={{ ...st.td, color: 'var(--muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.note}>{r.note || '—'}</td>
                <td style={st.td}>{wa ? <a href={`https://wa.me/${wa}?text=${greet}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', width: 24, height: 24, borderRadius: 12, background: '#25D366', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>W</a> : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <div style={st.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={st.title}>{L2('⏳ Awaiting Reply → Affiliate handover', '⏳ 等待回复 → 转交代理')}</div>
          <div style={st.sub}>{L2('VIPs whose latest contact is still unanswered. Group by affiliate, then copy the message or export the list to send to the affiliate.', '最近一次联系仍未回复的VIP。按代理分组后，复制信息或导出名单发给代理。')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={st.pri} onClick={() => exportExcel(null)} disabled={!filtered.length}>⬇ {L2(`Export all (${filtered.length})`, `导出全部（${filtered.length}）`)}</button>
          <button style={st.btn} onClick={onBack}>← {L2('Back', '返回')}</button>
        </div>
      </div>

      {/* filters */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('No reply for at least', '未回复至少')}</span>
        <select style={st.sel} value={minDays} onChange={e => setMinDays(e.target.value)}>
          {['1', '2', '3', '5', '7', '14', '30'].map(d => <option key={d} value={d}>{L2(`${d} day${d === '1' ? '' : 's'}`, `${d} 天`)}</option>)}
        </select>
        <select style={st.sel} value={affF} onChange={e => setAffF(e.target.value)}>
          <option value="ALL">{L2('All affiliates', '全部代理')}</option>
          {affOptions.map(a => <option key={a} value={a}>{affLabel(a)}</option>)}
        </select>
        <select style={st.sel} value={tierF} onChange={e => setTierF(e.target.value)}>
          {['ALL', 'BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE'].map(t => <option key={t} value={t}>{t === 'ALL' ? L2('All tiers', '全部等级') : t}</option>)}
        </select>
        <input style={{ ...st.sel, width: 170 }} placeholder={L2('Search VIP', '搜索VIP')} value={search} onChange={e => setSearch(e.target.value)} />
        <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={hideEscalated} onChange={e => setHideEscalated(e.target.checked)} />{L2('Hide already handed over', '隐藏已转交')}</label>
        <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} />{L2('Group by affiliate', '按代理分组')}</label>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{L2('Message language', '信息语言')}:</span>
        {[['en', 'EN'], ['zh', '中文']].map(([k, l]) => <button key={k} onClick={() => setMsgLang(k)} style={{ ...st.btn, padding: '4px 10px', borderColor: msgLang === k ? 'var(--brand, #FF6B00)' : 'var(--border)', color: msgLang === k ? 'var(--brand, #FF6B00)' : 'var(--text)' }}>{l}</button>)}
      </div>

      {err && <div style={{ color: '#f85149', marginBottom: 12 }}>{err}</div>}
      {!loading && filtered.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          {L2(`${filtered.length} VIPs waiting · ${totalUnreach} unable to reach · ${groups.length} affiliate groups`, `${filtered.length} 位VIP等待回复 · ${totalUnreach} 位联系不上 · ${groups.length} 个代理组`)}
        </div>
      )}

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>{L2('Loading…', '载入中…')}</div>
        : filtered.length === 0 ? <div style={{ textAlign: 'center', padding: 60, color: '#3fb950' }}>{L2('✓ Nothing waiting on a reply for this filter.', '✓ 此筛选下没有等待回复的VIP。')}</div>
        : grouped ? groups.map(([aff, list]) => (
          <div key={aff} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', background: 'var(--surface2)' }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: aff.startsWith('(') ? 'var(--muted)' : 'var(--brand, #FF6B00)' }}>🤝 {affLabel(aff)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2(`${list.length} VIP${list.length === 1 ? '' : 's'} · ${list.filter(r => r.status === 'unreachable').length} unable to reach`, `${list.length} 位VIP · ${list.filter(r => r.status === 'unreachable').length} 位联系不上`)}</div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {!aff.startsWith('(') && <button style={st.btn} onClick={() => copyMessage(aff, list)}>📋 {L2('Copy message', '复制信息')}</button>}
                <button style={st.btn} onClick={() => exportExcel(aff)}>⬇ {L2('Excel', 'Excel')}</button>
                {!aff.startsWith('(') && <button style={{ ...st.btn, color: '#a78bfa', borderColor: 'rgba(167,139,250,.5)' }} onClick={() => markEscalated(aff, list)}>↗ {L2('Mark handed over', '标记已转交')}</button>}
              </div>
            </div>
            {aff.startsWith('(') && <div style={{ fontSize: 11, color: 'var(--muted)', padding: '6px 14px' }}>{aff === DIRECT ? L2('These VIPs have no affiliate — follow up directly.', '这些VIP没有代理 — 请直接跟进。') : L2('Affiliate not known yet (no deposit data) — upload the BO member export to fill it in.', '代理尚未知（无存款数据）— 上传BO会员导出以补齐。')}</div>}
            {table(list)}
          </div>
        ))
        : <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>{table(filtered)}</div>}

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#111f30', border: '1px solid var(--brand, #FF6B00)', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 13, zIndex: 1400 }}>{toast}</div>}
    </div>
  )
}
