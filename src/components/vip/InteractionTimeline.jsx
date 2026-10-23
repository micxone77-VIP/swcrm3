// src/components/vip/InteractionTimeline.jsx — "last 10 interactions" for the 1v1 profile (2026-10-23)
// Data: get_vip_timeline() — contacts, campaigns (joined / paid / streak), BO bonuses, gifts, birthday gifts,
// cash vouchers, tier changes. Long numbers in notes are masked to ****last4 by the database.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { formatMoney } from '../../lib/format'
import { enumLabel } from '../../lib/enums'

const KIND = {
  contact:       { icon: '💬', color: '#58a6ff', en: 'Contact',          zh: '联系' },
  campaign_join: { icon: '📢', color: '#a78bfa', en: 'Joined campaign',  zh: '参加活动' },
  campaign_paid: { icon: '🎁', color: '#3fb950', en: 'Campaign reward',  zh: '活动奖励' },
  streak_paid:   { icon: '🔥', color: '#f97316', en: 'Streak bonus',     zh: '连续奖励' },
  bonus:         { icon: '💰', color: '#3fb950', en: 'Bonus',            zh: '奖金' },
  gift:          { icon: '🎀', color: '#f472b6', en: 'Gift',             zh: '礼物' },
  birthday_gift: { icon: '🎂', color: '#f472b6', en: 'Birthday gift',    zh: '生日礼物' },
  cash_voucher:  { icon: '🎫', color: '#d29922', en: 'Cash voucher',     zh: '现金券' },
  tier_change:   { icon: '⬆️', color: '#22d3ee', en: 'Tier change',      zh: '等级变动' },
}
const CAMPAIGN_TYPE_ZH = { dual_tier: '存款+流水等级', fixed_reward: '固定奖励', gold_bar: '金条', pct_reward: '百分比奖励', tiered_reward: '分级奖励', leaderboard: '排行榜', challenge: '挑战 / 每日里程碑' }
const SOURCE = { tier: ['auto (tier)', '自动（按等级）'], manual: ['added by hand', '手动加入'], country: ['auto (country)', '自动（按国家）'] }

export default function InteractionTimeline({ username, currency = 'MYR', limit = 10 }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [rows, setRows] = useState(null)
  const [n, setN] = useState(limit)

  useEffect(() => {
    if (!username) return
    let off = false
    supabase.rpc('get_vip_timeline', { p_username: username, p_limit: n })
      .then(({ data }) => { if (!off) setRows(data || []) })
    return () => { off = true }
  }, [username, n])

  const when = ts => new Date(ts).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
  // contact titles are "Channel · Outcome" plus an optional mood emoji (😊 😐 😠)
  const titleOf = r => {
    if (r.kind !== 'contact') return r.title
    const m = String(r.title).match(/^(.*?)(\s[😊😐😠])?$/u)
    return m[1].split(' · ').map(x => enumLabel(x, lang)).join(' · ') + (m[2] || '')
  }
  const detailOf = r => {
    if (r.kind === 'campaign_join') return lang === 'zh' ? (CAMPAIGN_TYPE_ZH[r.detail] || r.detail) : r.detail
    if (r.kind === 'campaign_paid') return L2('reward paid', '已派奖')
    if (r.kind === 'streak_paid') return r.detail.replace('streak bonus', L2('streak bonus', '连续奖励'))
    return r.detail
  }
  const actorOf = r => (r.kind === 'campaign_join' && SOURCE[r.actor] ? L2(...SOURCE[r.actor]) : r.actor)

  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px' }}>🕘 {L2(`Last ${n} interactions`, `最近 ${n} 次互动`)}</div>
        {rows && rows.length >= n && n < 50 && <button onClick={() => setN(50)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>{L2('Show more', '显示更多')}</button>}
      </div>
      {rows === null ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Loading…', '加载中…')}</div>
        : rows.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('No interactions recorded yet.', '还没有互动记录。')}</div>
        : <div style={{ position: 'relative' }}>
            {rows.map((r, i) => {
              const k = KIND[r.kind] || { icon: '•', color: 'var(--muted)', en: r.kind, zh: r.kind }
              return (
                <div key={i} style={{ display: 'flex', gap: 10, paddingBottom: i < rows.length - 1 ? 10 : 0, position: 'relative' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 13, background: `${k.color}22`, border: `1px solid ${k.color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{k.icon}</div>
                    {i < rows.length - 1 && <div style={{ width: 1, flex: 1, background: 'var(--border)', marginTop: 2 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.5 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 700, color: k.color }}>{L2(k.en, k.zh)}</span>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{titleOf(r)}</span>
                      {r.amount != null && Number(r.amount) !== 0 && <span style={{ fontWeight: 700 }}>{formatMoney(r.amount, r.currency || currency)}</span>}
                      <span style={{ marginLeft: 'auto', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{when(r.at)}{actorOf(r) ? ` · ${actorOf(r)}` : ''}</span>
                    </div>
                    {detailOf(r) && <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={detailOf(r)}>{detailOf(r)}</div>}
                  </div>
                </div>
              )
            })}
          </div>}
    </div>
  )
}
