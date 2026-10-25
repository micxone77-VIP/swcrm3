// src/components/vip/SurveyCard.jsx — what this player answered in the VIP survey (vip_survey_responses)
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { surveyLabel, FEELING_EN, FEELING_COLOR } from '../../lib/surveyLabels'

const chip = { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', margin: '0 4px 4px 0' }

export default function SurveyCard({ username }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!username) return
    supabase.from('vip_survey_responses').select('*').eq('username', username).order('submitted_at', { ascending: false }).limit(3)
      .then(({ data }) => setRows(data || []), () => setRows([]))
  }, [username])

  if (!rows || !rows.length) return null
  const r = rows[0]
  const chips = (list) => (list || []).length
    ? list.map(v => <span key={v} style={chip}>{v.startsWith('Other: ') ? v.slice(7) : surveyLabel(v, lang)}</span>)
    : <span style={{ color: 'var(--muted)' }}>—</span>
  const line = (label, value) => (
    <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 8, padding: '5px 0', borderTop: '1px solid var(--border)', fontSize: 12 }}>
      <div style={{ color: 'var(--muted)' }}>{label}</div><div>{value}</div>
    </div>
  )
  const feel = r.benefit_feeling
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>🗣 {L2('What they told us (survey)', '玩家问卷回答')}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.survey_name} · {new Date(r.submitted_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}{rows.length > 1 ? L2(` · ${rows.length} surveys`, ` · 共 ${rows.length} 次`) : ''}</div>
      </div>
      {line(L2('VIP benefits feel', 'VIP 权益感受'), feel ? <b style={{ color: FEELING_COLOR[feel] || 'var(--text)' }}>{lang === 'zh' ? surveyLabel(feel, lang) : FEELING_EN[feel] || feel}</b> : '—')}
      {line(L2('Why playing less', '玩少的原因'), chips([r.reason_less_use, ...(r.drop_reasons || [])].filter((v, i, a) => v && a.indexOf(v) === i)))}
      {line(L2('Favourite rewards', '最喜欢的福利'), chips(r.preferred_rewards))}
      {line(L2('Wants from VIP manager', '希望经理提供'), chips(r.manager_wants))}
      {line(L2('Would bring them back', '会让他回来的'), chips(r.return_drivers))}
      {line(L2('Deposit decided by', '影响存款的因素'), r.deposit_factor ? (r.deposit_factor.startsWith('Other: ') ? r.deposit_factor.slice(7) : surveyLabel(r.deposit_factor, lang)) : '—')}
      {line(L2('Also plays on', '也在玩的平台'), chips(r.other_platforms))}
      {line(L2('Better elsewhere', '其他平台更好的'), chips(r.better_elsewhere))}
      {line(L2('Prefers updates by', '偏好通知方式'), r.channel ? surveyLabel(r.channel, lang) : '—')}
      {r.improve_one && line(L2('In their words', '原话'), <span style={{ fontStyle: 'italic' }}>“{r.improve_one}”</span>)}
      {r.reported_tier && r.tier_at_import && r.reported_tier.toUpperCase() !== r.tier_at_import && line(L2('Note', '注意'),
        <span style={{ color: '#d29922' }}>{L2(`They think they are ${r.reported_tier} — actually ${r.tier_at_import}. Tell them their real tier and benefits.`, `玩家以为自己是 ${r.reported_tier}，其实是 ${r.tier_at_import}。告诉他真实等级和权益。`)}</span>)}
    </div>
  )
}
