// src/components/vip/CashVoucherClaims.jsx — VIP360 › Dept Spending: this VIP's Cash Voucher form claims + feedback
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'

const ST = { accepted: ['#3fb950', 'Accepted', '已批准'], declined: ['#f85149', 'Declined', '已拒绝'], pending: ['#d29922', 'Pending', '待处理'] }
const money = (n, c) => `${c === 'SGD' ? 'SGD ' : c === 'KHUSD' ? 'USD ' : 'RM '}${Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 2 })}`
const link = (u, label) => (u && /^https?:\/\//.test(u.split(',')[0].trim())
  ? <a href={u.split(',')[0].trim()} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 12 }}>{label}</a>
  : u ? <span title={u} style={{ fontSize: 12, color: 'var(--muted)' }}>{label}*</span> : <span style={{ color: 'var(--muted)' }}>—</span>)

export default function CashVoucherClaims({ username }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!username) return
    let off = false
    supabase.from('cash_voucher_claims').select('*').eq('username', username).order('claimed_at', { ascending: false })
      .then(({ data }) => { if (!off) setRows(data || []) })
    return () => { off = true }
  }, [username])

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
                  <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: st[0] + '22', color: st[0] }}>{L2(st[1], st[2])}</span></td>
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
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{L2('* file name only (uploaded outside Google Drive). ⭐ = satisfaction / recommend.', '* 仅文件名（非Google Drive链接）。⭐ = 满意度 / 推荐分。')}</div>
    </div>
  )
}
