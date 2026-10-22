// src/components/vip/ProfileCard.jsx — player portrait card (2026-10-22)
// Reads v_vip_auto_profile: what the host typed (manual) first, values worked out from data as fallback.
// Shown at the top of VIP360 and inside the shared WA popup (compact).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { formatMoney } from '../../lib/format'
import { StatusBadge } from '../ui'

const ZH = {
  // game types
  'Casual': '休闲玩家', 'Live + Sports': '真人+体育', 'Live Casino VIP': '真人娱乐VIP', 'Multi-Platform': '多平台玩家',
  'Slots + Live': '老虎机+真人', 'Slots King': '老虎机王', 'Sports Punter': '体育玩家',
  // deposit segment / style
  'Declining': '下滑中', 'Growing': '增长中', 'New': '新玩家', 'Silent': '沉默', 'Stable': '稳定',
  'Big ticket': '大额型', 'Regular': '常规型', 'Small & frequent': '小额多次',
  // time of day / weekday
  'Morning': '早上', 'Afternoon': '下午', 'Evening': '晚上', 'Late night': '深夜',
  'Mon': '周一', 'Tue': '周二', 'Wed': '周三', 'Thu': '周四', 'Fri': '周五', 'Sat': '周六', 'Sun': '周日',
  // payment method
  'Bank - Cash Deposit Machine': '银行 CDM', 'Bank - Online Banking': '网银', 'Crypto': '加密货币', 'Payment Gateway': '支付网关',
  // win-rate class
  'Abnormal high win': '异常高胜率', 'Pro advantage': '职业优势', 'Good player': '优秀玩家', 'Recreational': '娱乐型玩家', 'Heavy loser': '大额亏损',
  // offer ideas
  'All-platform rebate or loyalty point multiplier': '全平台返水或积分加倍',
  'Combo rebate covering slots and live casino': '老虎机+真人组合返水',
  'Live casino rebate boost or VIP live table invite': '真人返水加码，或邀请 VIP 真人桌',
  'Mixed rebate covering live casino and sports': '真人+体育混合返水',
  'Slots cashback or free spins on favourite slot providers': '老虎机返现，或常玩供应商的免费旋转',
  'Sports reload bonus or parlay insurance offer': '体育再存奖金或串关保险',
  'Welcome back bonus or deposit match to reactivate': '回归奖金或存款配额，召回用',
}
const ROI_COLOR = { 'Abnormal high win': '#f85149', 'Pro advantage': '#f59e0b', 'Good player': '#58a6ff', 'Recreational': '#3fb950', 'Heavy loser': '#8b949e' }
const hour12 = h => (h == null ? '' : `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`)
const monthLabel = (ym, lang) => {
  if (!ym) return ''
  const [y, m] = String(ym).slice(0, 7).split('-')
  return lang === 'zh' ? `${Number(m)}月` : new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('en-MY', { month: 'short', timeZone: 'UTC' })
}

export function useAutoProfile(username, refreshKey = 0) {
  const [p, setP] = useState(undefined)
  useEffect(() => {
    if (!username) return
    let off = false
    setP(undefined)
    supabase.from('v_vip_auto_profile').select('*').eq('username', username).maybeSingle()
      .then(({ data }) => { if (!off) setP(data || null) })
    return () => { off = true }
  }, [username, refreshKey])
  return p
}

// compact = smaller version for the WA popup (no header line)
export default function ProfileCard({ username, compact = false }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const tr = v => (v == null ? v : lang === 'zh' ? (ZH[v] || v) : v)
  const p = useAutoProfile(username)

  const box = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: compact ? '10px 12px' : '14px 18px', marginBottom: compact ? 10 : 16, fontSize: compact ? 12 : 13, lineHeight: 1.7 }
  if (p === undefined) return <div style={{ ...box, color: 'var(--muted)' }}>{L2('Loading profile…', '加载画像中…')}</div>
  if (p === null) return null

  const muted = { color: 'var(--muted)' }
  const auto = <span title={L2('Worked out from data', '系统根据数据自动算出')} style={{ fontSize: 10, ...muted }}> 🤖</span>
  const pct = n => (n == null ? null : Math.round(Number(n)))

  // games: manual fav_game first, else monthly provider report
  const gameLine = p.fav_game
    ? <>🎮 {p.fav_game}</>
    : p.game_type ? <>{p.game_icon || '🎮'} <b>{tr(p.game_type)}</b>
        {[['slots_pct', L2('slots', '老虎机')], ['live_pct', L2('live', '真人')], ['sports_pct', L2('sports', '体育')]]
          .filter(([k]) => pct(p[k]) > 0).length > 0 && <span style={muted}> ({[['slots_pct', L2('slots', '老虎机')], ['live_pct', L2('live', '真人')], ['sports_pct', L2('sports', '体育')]]
          .filter(([k]) => pct(p[k]) > 0).map(([k, n]) => `${pct(p[k])}% ${n}`).join(' · ')})</span>}
        {p.best_provider && <> · {L2('plays most', '最常玩')} <b>{p.best_provider}</b></>}{auto}</>
    : null

  // deposit habit
  const timeText = p.best_contact_time || (p.peak_hour != null
    ? (lang === 'zh' ? `${tr(p.peak_day_name) || ''} ${tr(p.peak_daypart) || ''} ${p.peak_hour}点` : `${p.peak_day_name || ''} ${p.peak_daypart?.toLowerCase() || ''} ~${hour12(p.peak_hour)}`)
    : null)
  const depLine = p.deposit_style
    ? <>💰 <b>{tr(p.dep_segment)}</b>{p.trend_pct != null && Math.abs(p.trend_pct) >= 10 && <span style={{ color: p.trend_pct < 0 ? '#f85149' : '#3fb950' }}> ({p.trend_pct > 0 ? '+' : ''}{pct(p.trend_pct)}%)</span>}
        {' · '}{tr(p.deposit_style)} · {L2('avg', '平均每次')} <b>{formatMoney(p.avg_ticket, p.currency)}</b>
        {p.avg_gap_days != null && <> · {L2(`every ~${Number(p.avg_gap_days).toFixed(1)} days`, `约每 ${Number(p.avg_gap_days).toFixed(1)} 天一次`)}</>}{auto}</>
    : null

  const roiLine = p.roi_class
    ? <>📊 {L2('Win rate', '胜率')} {Number(p.roi_2m) > 0 ? '+' : ''}{Number(p.roi_2m).toFixed(1)}% → <b style={{ color: ROI_COLOR[p.roi_class] }}>{tr(p.roi_class)}</b>{auto}</>
    : null

  const lang_ = p.lang_pref || p.lang_auto
  const contactLine = <>💬 {p.contacts_90d > 0
      ? L2(`Last 90 days: ${p.contacts_90d} contacts, ${p.replies_90d} replies`, `近90天联系 ${p.contacts_90d} 次，回复 ${p.replies_90d} 次`)
      : L2('No contact in the last 90 days', '近90天没有联系')}
    {p.reply_rate_90d != null && <b style={{ color: p.reply_rate_90d >= 40 ? '#3fb950' : p.reply_rate_90d >= 15 ? '#d29922' : '#f85149' }}> ({p.reply_rate_90d}%)</b>}
    {lang_ && <> · {L2('Language', '语言')} <b>{lang_ === 'EN + 中文' ? L2('EN + 中文', '中英都用') : lang_}</b>{!p.lang_pref && auto}</>}
    {timeText && <> · ⏰ {p.best_contact_time ? L2('Best time', '最佳联系时间') : L2('Usually deposits', '常存款时间')} <b>{timeText}</b>{!p.best_contact_time && auto}</>}</>

  const missing = [
    !p.has_phone && L2('phone/WA', '电话/WA'), !p.birthday && L2('birthday', '生日'), !p.host_assigned && L2('host', '负责人'),
    !p.personality_notes && !p.special_requests && L2('personal notes', '性格/喜好备注'),
  ].filter(Boolean)
  const asOf = [p.game_month && L2(`games ${monthLabel(p.game_month, lang)}`, `游戏 ${monthLabel(p.game_month, lang)}`),
    p.dep_as_of && L2(`deposits to ${String(p.dep_as_of).slice(0, 10)}`, `存款到 ${String(p.dep_as_of).slice(0, 10)}`)].filter(Boolean)
  const doneColor = p.completeness_pct >= 75 ? '#3fb950' : p.completeness_pct >= 50 ? '#d29922' : '#f85149'

  return (
    <div style={box}>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>🪪 {L2('Player profile', '玩家画像')}</span>
          <StatusBadge status={p.status} />
          {p.days_inactive != null && p.status !== 'Active' && <span style={muted}>{L2(`${p.days_inactive}d since deposit`, `${p.days_inactive}天未存款`)}</span>}
          <span style={{ marginLeft: 'auto', fontSize: 12 }}>{L2('Profile complete', '资料完整度')} <b style={{ color: doneColor }}>{p.completeness_pct}%</b></span>
        </div>
      )}
      {gameLine && <div>{gameLine}</div>}
      {p.offer_recommendation && !p.fav_game && <div style={muted}>🎁 {L2('Offer idea', '建议优惠')}: {tr(p.offer_recommendation)}</div>}
      {depLine && <div>{depLine}</div>}
      {roiLine && <div>{roiLine}</div>}
      <div>{contactLine}</div>
      {(p.personality_notes || p.special_requests) && <div>📝 {[p.personality_notes, p.special_requests].filter(Boolean).join(' · ')}</div>}
      {(missing.length > 0 || asOf.length > 0) && (
        <div style={{ fontSize: 11, ...muted, marginTop: 2 }}>
          {missing.length > 0 && <span style={{ color: '#d29922' }}>❗ {L2('Missing', '缺')}: {missing.join(', ')}</span>}
          {missing.length > 0 && asOf.length > 0 && ' · '}
          {asOf.length > 0 && <span>{L2('Data', '数据')}: {asOf.join(', ')} · 🤖 = {L2('auto from data', '系统自动算')}</span>}
        </div>
      )}
    </div>
  )
}
