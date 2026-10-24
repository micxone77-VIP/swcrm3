// src/components/campaign/CampaignWaEditor.jsx — edit the WhatsApp message for each campaign stage in EN / MY / 中文.
// Texts start from the campaign's saved text (or the built-in one); only changed texts are saved to campaigns.wa_templates.
import { useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { WA_STAGES, WA_LANGS, WA_LANG_LABEL, STAGE_INFO, WA_VARS, templateFor, fillWa, tierList } from '../../lib/campaignWaTemplates'

const box = { width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }

export default function CampaignWaEditor({ form, setForm, levels = [] }) {
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const [stage, setStage] = useState('intro')
  const tpl = l => templateFor(form, stage, l)
  const edited = (st, l) => !!form.wa_templates?.[st]?.[l]?.trim()
  const setText = (l, v) => setForm(f => ({ ...f, wa_templates: { ...(f.wa_templates || {}), [stage]: { ...(f.wa_templates?.[stage] || {}), [l]: v } } }))
  const reset = () => setForm(f => { const t = { ...(f.wa_templates || {}) }; delete t[stage]; return { ...f, wa_templates: t } })
  const cur = form.platform === 'SG' ? 'SGD ' : 'RM'
  const sample = l => ({ username: 'haur2972', agent: 'Marcus', campaign: form.campaign_name || 'Campaign', start: form.start_date || '', end: form.end_date || '',
    days_left: 3, cur, gap: '12,000', next_reward: `${cur}900`, reward: `${cur}900`, turnover: form.turnover_multiplier ? `${cur}${900 * Number(form.turnover_multiplier)}` : '',
    tier_list: tierList(form, levels, l), streak: (Number(form.streak_days) || 3) - 1, streak_n: form.streak_days || 3, streak_pct: form.streak_bonus_pct ?? 1 })

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#25d366', marginBottom: 4, letterSpacing: '.5px' }}>💬 {L2('WHATSAPP MESSAGES BY STAGE', 'WHATSAPP 分阶段讯息')}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
        {L2('The Chase list picks the stage for each player automatically; the EN / MY / 中文 buttons pick the language. Payout uses "Paid", the Streak tab uses "Streak". Variables:',
            '追踪名单会自动为每位玩家选择阶段；EN / MY / 中文 按钮选择语言。派彩用「已派彩」，连续奖励页用「连续」。变量：')}{' '}
        {WA_VARS.map(v => <code key={v} style={{ marginRight: 4 }}>{`{${v}}`}</code>)}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {WA_STAGES.map(st => {
          const info = STAGE_INFO[st]
          const any = WA_LANGS.some(l => edited(st, l))
          return (
            <button key={st} type="button" onClick={() => setStage(st)} style={{
              padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${stage === st ? 'var(--accent)' : 'var(--border)'}`, background: stage === st ? 'rgba(255,106,0,.12)' : 'var(--surface2)',
              color: stage === st ? 'var(--text)' : 'var(--muted)' }}>
              {info.icon} {lang === 'zh' ? info.zh : info.en}{any ? ' ✎' : ''}
            </button>
          )
        })}
        <button type="button" onClick={reset} style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 7, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)' }}>
          ↺ {L2('Use built-in text for this stage', '此阶段改回内置讯息')}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        {WA_LANGS.map(l => (
          <div key={l}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>
              {WA_LANG_LABEL[l]} {edited(stage, l) ? <span style={{ color: 'var(--accent)' }}>· {L2('custom', '已自定义')}</span> : <span>· {L2('built-in', '内置')}</span>}
            </div>
            <textarea rows={8} style={box} value={tpl(l)} onChange={e => setText(l, e.target.value)} />
            <div style={{ marginTop: 6, background: 'rgba(37,211,102,.06)', border: '1px solid rgba(37,211,102,.2)', borderRadius: 8, padding: '8px 10px', fontSize: 12, whiteSpace: 'pre-wrap' }}>
              <div style={{ fontSize: 10, color: '#25d366', fontWeight: 700, marginBottom: 4 }}>👁 {L2('Preview', '预览')}</div>
              {fillWa(tpl(l), sample(l))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
