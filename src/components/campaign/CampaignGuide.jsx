// src/components/campaign/CampaignGuide.jsx — ⓘ info button + guide modal for campaign types (EN / 中文)
import { useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { CAMPAIGN_GUIDE, GUIDE_ORDER, guideKeyFor, L } from '../../lib/campaignGuide'

function Section({ title, text, color }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: color || 'var(--muted)', letterSpacing: '.4px', textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  )
}

export function GuideModal({ initialKey, onClose }) {
  const { lang } = useLanguage()
  const [key, setKey] = useState(initialKey && CAMPAIGN_GUIDE[initialKey] ? initialKey : GUIDE_ORDER[0])
  const g = CAMPAIGN_GUIDE[key]
  const tx = o => (o ? o[lang === 'zh' ? 'zh' : 'en'] : '')
  return (
    <div onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', overflow: 'hidden' }}>
        {/* type list */}
        <div style={{ width: 230, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', padding: '6px 8px' }}>{L(lang, 'CAMPAIGN TYPES', '活动类型')}</div>
          {GUIDE_ORDER.map(k => {
            const it = CAMPAIGN_GUIDE[k]
            const active = k === key
            return (
              <button key={k} onClick={() => setKey(k)} style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                border: active ? `1px solid ${it.color}` : '1px solid transparent', background: active ? 'var(--surface2)' : 'transparent',
                color: active ? it.color : 'var(--text)', fontSize: 12, fontWeight: active ? 700 : 500,
              }}>{it.icon} {tx(it.name)}</button>
            )
          })}
        </div>
        {/* detail */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: g.color }}>{g.icon} {tx(g.name)}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>
          <Section title={L(lang, '⚙️ How it works (logic)', '⚙️ 运作逻辑')} text={tx(g.logic)} color={g.color} />
          <Section title={L(lang, '🛠 How to use', '🛠 使用步骤')} text={tx(g.howTo)} />
          <Section title={L(lang, '🎯 Purpose', '🎯 活动目的')} text={tx(g.purpose)} />
          <Section title={L(lang, '👥 Target audience', '👥 目标受众')} text={tx(g.audience)} />
        </div>
      </div>
    </div>
  )
}

// Small ⓘ button. Pass either typeKey ('pct_reward', 'challenge_trust'...) or campaign (row).
export function CampaignInfoButton({ typeKey, campaign, size = 16, style }) {
  const [open, setOpen] = useState(false)
  const key = typeKey ? guideKeyFor(typeKey) : guideKeyFor(campaign)
  return (
    <>
      <span role="button" title="Info / 说明"
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(true) }}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: '50%',
          border: '1px solid var(--muted)', color: 'var(--muted)', fontSize: size * 0.62, fontWeight: 800, cursor: 'pointer', flexShrink: 0, fontStyle: 'normal', lineHeight: 1, ...style }}>i</span>
      {open && <GuideModal initialKey={key} onClose={() => setOpen(false)} />}
    </>
  )
}

// "📘 Campaign Guide" button listing every type
export function CampaignGuideButton({ style }) {
  const { lang } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13, ...style }}>
        📘 {L(lang, 'Campaign Guide', '活动说明')}
      </button>
      {open && <GuideModal onClose={() => setOpen(false)} />}
    </>
  )
}
