// src/components/vip/CashVoucherClaims.jsx — VIP360 › Dept Spending: this VIP's Cash Voucher form claims + feedback
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../hooks/useAuth'

const ST = { accepted: ['#3fb950', 'Accepted', '已批准'], declined: ['#f85149', 'Declined', '已拒绝'], pending: ['#d29922', 'Pending', '待处理'] }
const money = (n, c) => `${c === 'SGD' ? 'SGD ' : c === 'KHUSD' ? 'USD ' : 'RM '}${Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 2 })}`
const link = (u, label) => (u && /^https?:\/\//.test(u.split(',')[0].trim())
  ? <a href={u.split(',')[0].trim()} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 12 }}>{label}</a>
  : u ? <span title={u} style={{ fontSize: 12, color: 'var(--muted)' }}>{label}*</span> : <span style={{ color: 'var(--muted)' }}>—</span>)

export default function CashVoucherClaims({ username, onChange }) {
  const { lang } = useLanguage()
  const { profile } = useAuth()
  const canEdit = profile?.role === 'admin' || profile?.role === 'host'
  const [busyId, setBusyId] = useState(null)
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!username) return
    let off = false
    supabase.from('cash_voucher_claims').select('*').eq('username', username).order('claimed_at', { ascending: false })
      .then(({ data }) => { if (!off) setRows(data || []) })
    return () => { off = true }
  }, [username])

  // Change claim status; accepted ⇒ counted in Dept Spending, otherwise the auto-created expense is removed
  async function setStatus(r, status) {
    if (busyId || r.status === status) return
    setBusyId(r.id)
    try {
      let expense_id = r.expense_id
      if (status === 'accepted' && !expense_id) {
        const month = new Date(new Date(r.claimed_at).getTime() + 8 * 3600e3).toISOString().slice(0, 7)
        const { data: ex, error } = await supabase.from('department_expenses').insert({
          month: r.claim_month || month, category: 'Cash Voucher',
          item_name: /credit/i.test(r.remark || '') ? 'Credit (form claim)' : 'Cash Voucher (form claim)',
          platform: r.currency === 'SGD' ? 'SG' : r.currency === 'KHUSD' ? 'KH' : 'MY', currency: r.currency || 'MYR',
          amount: Number(r.amount) || 0, expense_type: 'online', vip_username: r.username, created_by: profile?.id || null,
          notes: `Imported from Cash Voucher form · claimed ${String(r.claimed_at).slice(0, 10)} · ref ${r.id}`,
        }).select('id').single()
        if (error) throw error
        expense_id = ex.id
      } else if (status !== 'accepted' && expense_id) {
        const { data: ex } = await supabase.from('department_expenses').select('id, notes').eq('id', expense_id).maybeSingle()
        // only delete expenses this importer created; hand-entered ones are just unlinked
        if (ex && /^Imported from Cash Voucher form/.test(ex.notes || '')) await supabase.from('department_expenses').delete().eq('id', expense_id)
        expense_id = null
      }
      const { error } = await supabase.from('cash_voucher_claims').update({ status, expense_id }).eq('id', r.id)
      if (error) throw error
      setRows(rs => rs.map(x => (x.id === r.id ? { ...x, status, expense_id } : x)))
      onChange && onChange()
    } catch (e) {
      window.alert(L2(`Update failed: ${e.message}`, `更新失败：${e.message}`))
    } finally { setBusyId(null) }
  }

  if (!rows || !rows.length) return null
  const acc = rows.filter(r => r.status === 'accepted')
  const byCur = {}; acc.forEach(r => { byCur[r.currency || 'MYR'] = (byCur[r.currency || 'MYR'] || 0) + Number(r.amount || 0) })
  const sats = rows.filter(r => r.satisfaction != null).map(r => r.satisfaction)
  const recs = rows.filter(r => r.recommend_score != null).map(r => r.recommend_score)
  const avg = a => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '—')
  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 10 }}>
        🎟️ {L2('Cash Voucher Claims', '现金券申请')} ({rows.length})
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.entries(byCur).map(([c, v]) => (
          <div key={c} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('Accepted total', '已批准总额')}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#3fb950' }}>{money(v, c)}</div>
          </div>
        ))}
        <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('Satisfaction (1–5)', '满意度 (1–5)')}</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>⭐ {avg(sats)}</div>
        </div>
        <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('Would recommend (0–10)', '推荐意愿 (0–10)')}</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{avg(recs)}</div>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>
            {[['Date', '日期'], ['Amount', '金额'], ['Status', '状态'], ['Receipt', '收据'], ['Trustpilot', 'Trustpilot'], ['Photo', '照片'], ['⭐', '⭐'], ['Remark / Feedback', '备注 / 反馈']].map(([h, z]) => (
              <th key={h} style={{ padding: '9px 12px', textAlign: 'left', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{L2(h, z)}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const st = ST[r.status] || ST.pending
              return (
                <tr key={r.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>{new Date(r.claimed_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{money(r.amount, r.currency)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {canEdit ? (
                      <select value={r.status} disabled={busyId === r.id} onChange={e => setStatus(r, e.target.value)}
                        style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 10, border: `1px solid ${st[0]}66`, background: st[0] + '22', color: st[0], cursor: 'pointer' }}>
                        {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{L2(v[1], v[2])}</option>)}
                      </select>
                    ) : <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: st[0] + '22', color: st[0] }}>{L2(st[1], st[2])}</span>}
                  </td>
                  <td style={td}>{link(r.receipt_url, L2('View', '查看'))}</td>
                  <td style={td}>{link(r.trustpilot_url, L2('View', '查看'))}</td>
                  <td style={td}>{link(r.item_photo_url, L2('View', '查看'))}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>{r.satisfaction ?? '—'} / {r.recommend_score ?? '—'}</td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--muted)', maxWidth: 320 }}>
                    {r.remark && <div>📝 {r.remark}</div>}
                    {r.feedback && <div>💬 {r.feedback}</div>}
                    {!r.remark && !r.feedback && '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{L2('Status: Accepted = counted in Dept Spending; Pending/Declined = not counted. * file name only (not a Google Drive link). ⭐ = satisfaction / recommend.', '状态：已批准 = 计入部门开支；待处理/已拒绝 = 不计入。* 仅文件名（非Google Drive链接）。⭐ = 满意度 / 推荐分。')}</div>
    </div>
  )
}
