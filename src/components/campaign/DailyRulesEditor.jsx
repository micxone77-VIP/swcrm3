// src/components/campaign/DailyRulesEditor.jsx — rules (+ optional WhatsApp templates) for a ⚡ Daily Milestone campaign
import { useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { L } from '../../lib/campaignGuide'
import { num } from '../../lib/challengeEngine'
import { DEFAULT_TEMPLATES, GROUPS, VARS } from '../../lib/dailyMilestone'

const input = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 9px', borderRadius: 7, boxSizing: 'border-box', fontSize: 13 }
const lbl = { fontSize: 10, color: 'var(--muted)', fontWeight: 800, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.3px' }
const sec = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '5px 10px', borderRadius: 7, fontWeight: 700, cursor: 'pointer', fontSize: 12 }

export function cleanDailyConfig(cfg) {
  return {
    ...cfg,
    tiers: (cfg.tiers || []).map(t => ({ turnover: num(t.turnover), reward: num(t.reward) })).filter(t => t.turnover > 0).sort((a, b) => a.turnover - b.turnover),
    streak_days: Math.max(1, Math.round(num(cfg.streak_days) || 3)), streak_pct: num(cfg.streak_pct), streak_cap: num(cfg.streak_cap), near_pct: num(cfg.near_pct ?? 50), turnover_multiplier: num(cfg.turnover_multiplier ?? 3),
  }
}

const TPL_KEYS = ['intro', 'won', 'streak', 'near', 'idle', 'care']
const TPL_LABEL = { intro: { icon: '📣', en: 'Campaign intro', zh: '活动介绍' }, ...GROUPS }

export function DailyRulesEditor({ cfg, setCfg, withTemplates = false }) {
  const { lang } = useLanguage()
  const T = (en, zh) => L(lang, en, zh)
  const c = (k, v) => setCfg(f => ({ ...f, [k]: v }))
  const tiers = cfg.tiers || []
  const setTier = (i, k, v) => c('tiers', tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)))
  const [tplKey, setTplKey] = useState('won')
  const tpl = cfg.wa_templates || {}
  const setTpl = (k, l, v) => c('wa_templates', { ...tpl, [k]: { ...(tpl[k] || {}), [l]: v } })

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)', gap: 16 }}>
        <div>
          <div style={lbl}>{T('Daily turnover tiers (paid next day)', '每日流水阶梯（隔天派发）')}</div>
          {tiers.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input type="number" style={input} value={t.turnover} onChange={e => setTier(i, 'turnover', e.target.value)} placeholder={T('Turnover', '流水')} />
              <span style={{ color: 'var(--muted)' }}>→</span>
              <input type="number" style={input} value={t.reward} onChange={e => setTier(i, 'reward', e.target.value)} placeholder={T('Credit', 'Credit')} />
              <button type="button" style={sec} onClick={() => c('tiers', tiers.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" style={sec} onClick={() => c('tiers', [...tiers, { turnover: '', reward: '' }])}>+ {T('Add tier', '新增阶梯')}</button>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{T('Each day pays only the highest tier reached that day. Same numbers apply to SGD players in SGD.', '每天只派当天达到的最高一档。SGD 玩家用同样数字（以 SGD 计）。')}</div>
        </div>
        <div>
          <div style={lbl}>{T('Streak bonus', '连续奖励')}</div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 8 }}><input type="checkbox" checked={!!cfg.streak_enabled} onChange={e => c('streak_enabled', e.target.checked)} />{T('Enable streak bonus', '启用连续奖励')}</label>
          {cfg.streak_enabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
              <div><div style={lbl}>{T('Consecutive days', '连续天数')}</div><input type="number" min="1" style={input} value={cfg.streak_days} onChange={e => c('streak_days', e.target.value)} /></div>
              <div><div style={lbl}>{T('% of deposits on those days', '这些天存款的 %')}</div><input type="number" step="0.1" style={input} value={cfg.streak_pct} onChange={e => c('streak_pct', e.target.value)} /></div>
              <div><div style={lbl}>{T('How it repeats', '重复方式')}</div>
                <select style={input} value={cfg.streak_style} onChange={e => c('streak_style', e.target.value)}>
                  <option value="rolling">{T('Rolling (every qualifying day after N)', '滚动（满N天后每天都算）')}</option>
                  <option value="block">{T('Every N days (resets)', '每满N天一轮（重置）')}</option>
                </select>
              </div>
              <div><div style={lbl}>{T('Cap per bonus (0 = none)', '每次上限（0 = 无）')}</div><input type="number" style={input} value={cfg.streak_cap} onChange={e => c('streak_cap', e.target.value)} /></div>
            </div>
          )}
          {cfg.streak_enabled && cfg.streak_style === 'rolling' && <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 6 }}>⚠️ {T(`Rolling: days 1-3, 2-4, 3-5… each pays, so one day's deposit can count in up to ${cfg.streak_days} bonuses (≈ ${num(cfg.streak_pct) * num(cfg.streak_days)}% of deposits for a player who qualifies every day).`, `滚动：第1-3、2-4、3-5天…每次都派，同一天的存款最多会被计算 ${cfg.streak_days} 次（每天都达标的玩家约等于存款的 ${num(cfg.streak_pct) * num(cfg.streak_days)}%）。`)}</div>}
          <div style={{ marginTop: 10 }}><div style={lbl}>{T('Reward turnover requirement (×) — shown on the payout list', '奖励流水要求（倍）— 显示在派发名单')}</div><input type="number" style={{ ...input, width: 120 }} value={cfg.turnover_multiplier ?? 3} onChange={e => c('turnover_multiplier', e.target.value)} /></div>
          <div style={{ marginTop: 10 }}><div style={lbl}>{T('"Almost" = turnover ≥ % of first tier', '"差一点" = 流水 ≥ 第一档的 %')}</div><input type="number" style={{ ...input, width: 120 }} value={cfg.near_pct ?? 50} onChange={e => c('near_pct', e.target.value)} /></div>
        </div>
      </div>

      {withTemplates && (
        <div style={{ marginTop: 16, borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
          <div style={lbl}>💬 {T('WhatsApp messages per group (leave empty = built-in text)', '各分组 WhatsApp 话术（留空 = 使用系统默认）')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
            {TPL_KEYS.map(k => <button type="button" key={k} style={{ ...sec, background: tplKey === k ? 'var(--accent)' : 'var(--surface2)', color: tplKey === k ? '#fff' : 'var(--text)' }} onClick={() => setTplKey(k)}>{TPL_LABEL[k].icon} {lang === 'zh' ? TPL_LABEL[k].zh : TPL_LABEL[k].en}{(tpl[k]?.zh || tpl[k]?.en) ? ' ✎' : ''}</button>)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{T('Variables: ', '变量：')}{VARS.join(' ')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {['zh', 'en'].map(l => (
              <div key={l}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={lbl}>{l === 'zh' ? '中文' : 'English'}</div>
                  <button type="button" style={{ ...sec, padding: '2px 8px', fontSize: 11 }} onClick={() => setTpl(tplKey, l, DEFAULT_TEMPLATES[tplKey][l])}>{T('Load default', '载入默认')}</button>
                </div>
                <textarea style={{ ...input, minHeight: 170, fontFamily: 'inherit', resize: 'vertical' }} value={tpl[tplKey]?.[l] || ''} placeholder={DEFAULT_TEMPLATES[tplKey][l]} onChange={e => setTpl(tplKey, l, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
