// src/components/exec/VipVoice.jsx — "VIP Voice": summary of the VIP member survey (vip_survey_responses)
// for the Executive Overview. Counts each answer per tier; free text ("Other: …") is shown as quotes.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { surveyLabel, FEELING_EN, FEELING_COLOR } from '../../lib/surveyLabels'

const TIERS = ['ALL', 'BLACK', 'DIAMOND', 'PLATINUM', 'GOLD']

function count(rows, pick) {
  const c = {}
  rows.forEach(r => [...new Set((pick(r) || []).filter(v => v && !String(v).startsWith('Other: ')))].forEach(v => { c[v] = (c[v] || 0) + 1 }))
  return Object.entries(c).sort((a, b) => b[1] - a[1])
}

export default function VipVoice({ card, h2 }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const navigate = useNavigate()
  const [all, setAll] = useState(null)
  const [tier, setTier] = useState('ALL')

  useEffect(() => {
    supabase.from('vip_survey_responses').select('*').order('submitted_at', { ascending: false }).limit(2000)
      .then(({ data }) => setAll(data || []), () => setAll([]))
  }, [])

  const rows = useMemo(() => (all || []).filter(r => tier === 'ALL' || String(r.tier_at_import || r.reported_tier || '').toUpperCase() === tier), [all, tier])
  if (!all || !all.length) return null
  const n = rows.length
  const surveys = [...new Set(all.map(r => r.survey_name))]
  const pct = v => (n ? Math.round((v / n) * 100) : 0)

  const Bars = ({ title, items, color = 'var(--brand)', max = 5 }) => (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {items.slice(0, max).map(([k, v]) => (
        <div key={k} style={{ marginBottom: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{surveyLabel(k, lang)}</span>
            <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{v} · {pct(v)}%</span>
          </div>
          <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
            <div style={{ width: `${pct(v)}%`, height: '100%', background: color, borderRadius: 3 }} />
          </div>
        </div>
      ))}
      {!items.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>—</div>}
    </div>
  )

  const feel = ['good', 'average', 'decreased', 'unclear'].map(k => [k, rows.filter(r => r.benefit_feeling === k).length])
  const quotes = rows.filter(r => r.improve_one && r.improve_one.length > 6)

  return (
    <div style={{ ...card, marginTop: 14 }}>
      <div style={h2}>
        <span>🗣 {L2('VIP Voice — member survey', 'VIP 心声 — 会员问卷')}</span>
        <span style={{ fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{surveys.join(' · ')} · {L2(`${n} answers`, `${n} 份回答`)}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TIERS.map(t => {
          const c = t === 'ALL' ? all.length : all.filter(r => String(r.tier_at_import || r.reported_tier || '').toUpperCase() === t).length
          if (!c) return null
          return <button key={t} onClick={() => setTier(t)} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)',
            background: tier === t ? 'var(--accent)' : 'var(--surface2)', color: tier === t ? '#fff' : 'var(--muted)' }}>{t === 'ALL' ? L2('All', '全部') : t} ({c})</button>
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 18 }}>
        <Bars title={L2('Why they play less', '玩少的原因')} items={count(rows, r => (r.drop_reasons || []).filter(v => v !== 'Still active'))} color="#f85149" />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{L2('How VIP benefits feel', 'VIP 权益感受')}</div>
          {feel.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: FEELING_COLOR[k] }}>{lang === 'zh' ? surveyLabel(k, lang) : FEELING_EN[k]}</span><span style={{ color: 'var(--muted)' }}>{v} · {pct(v)}%</span>
              </div>
              <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
                <div style={{ width: `${pct(v)}%`, height: '100%', background: FEELING_COLOR[k], borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
        <Bars title={L2('Favourite rewards', '最喜欢的福利')} items={count(rows, r => r.preferred_rewards)} color="#3fb950" />
        <Bars title={L2('Want from VIP manager', '希望经理提供')} items={count(rows, r => r.manager_wants)} color="#58a6ff" />
        <Bars title={L2('Better at other platforms', '其他平台更好的')} items={count(rows, r => r.better_elsewhere)} color="#d29922" />
        <Bars title={L2('Other platforms they play', '他们也在玩的平台')} items={count(rows, r => (r.other_platforms || []).filter(v => v !== 'sureWin only'))} color="#a371f7" max={6} />
      </div>
      {quotes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>💬 {L2('In their own words', '玩家原话')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {quotes.slice(0, 8).map(r => (
              <div key={r.id} onClick={() => r.username && navigate(`/vip360?player=${encodeURIComponent(r.username)}`)}
                style={{ fontSize: 12, background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', cursor: r.username ? 'pointer' : 'default' }}>
                <div style={{ fontStyle: 'italic' }}>“{r.improve_one}”</div>
                <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>— {r.username || L2('(no username)', '（无用户名）')}{r.tier_at_import ? ` · ${r.tier_at_import}` : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
