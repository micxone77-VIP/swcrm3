import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamNumber } from '../hooks/useUrlParam'
import { TIER_COLOR, TIER_BG } from '../lib/constants'
import { ContactFollowUp } from '../components/WaSenderModal'
import CopyBtn from '../components/CopyBtn'

// ── Tier config ───────────────────────────────────────────────────────────────
const TIER_ORDER = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'BLACK']
const TIER_ZH = { BLACK:'黑金', 'DIAMOND-P': '钻石P', DIAMOND:'钻石', PLATINUM:'白金', GOLD:'黄金', SILVER:'白银', BRONZE:'青铜', ALL:'全部' }
// UI-language helper: returns [L2(en, zh), lang]
function useL2() {
  const { lang } = useLanguage()
  return [(en, zh) => (lang === 'zh' ? zh : en), lang]
}

// VIP upgrade thresholds (monthly valid bet)
const VIP_THRESHOLDS = {
  GOLD:     2000000,
  PLATINUM: 6000000,
}

function getVipUpgradeTarget(tier, validBet) {
  const vb = parseFloat(validBet) || 0
  if (tier === 'GOLD') {
    if (vb >= 8000000) return { tier: 'DIAMOND',  threshold: 8000000 }
    if (vb >= 2000000) return { tier: 'PLATINUM', threshold: 2000000 }
    return null
  }
  if (tier === 'PLATINUM') {
    if (vb >= 6000000) return { tier: 'DIAMOND', threshold: 6000000 }
    return null
  }
  return null
}

// Potential upgrade thresholds
function getPotentialUpgradeTarget(tier, validBet, allThresholds) {
  const vb = parseFloat(validBet) || 0
  // Find the highest tier this player qualifies for right now
  const targets = allThresholds.filter(t => t.from_tier === tier && vb >= t.threshold)
  if (targets.length === 0) return null
  // Return highest qualifying target
  targets.sort((a, b) => TIER_ORDER.indexOf(b.to_tier) - TIER_ORDER.indexOf(a.to_tier))
  return targets[0]
}

// Get next immediate upgrade target (for progress bar — lowest threshold)
function getNextUpgradeTarget(tier, allThresholds) {
  const targets = allThresholds.filter(t => t.from_tier === tier)
  if (targets.length === 0) return null
  targets.sort((a, b) => a.threshold - b.threshold)
  return targets[0]
}

// Format numbers — pass a row's own `currency` where available (see lib/format.js)
const fmt = (n, currency = 'MYR') => formatMoney(n, currency)
const fmtDate = (d, lang = 'en') => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}
const monthsAgo = (dateStr) => {
  if (!dateStr) return null
  const reg = new Date(dateStr)
  if (isNaN(reg.getTime())) return null
  const now = new Date()
  return (now.getFullYear() - reg.getFullYear()) * 12 + (now.getMonth() - reg.getMonth())
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page:    { padding: '28px 20px', color: 'var(--text)', maxWidth: 1600, margin: '0 auto' },
  heading: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  sub:     { fontSize: 13, color: 'var(--muted)', marginBottom: 22 },

  tabBar: {
    display: 'flex', gap: 4, marginBottom: 22,
    borderBottom: '1px solid var(--border)', paddingBottom: 0,
  },
  tab: (active) => ({
    padding: '8px 18px', borderRadius: '8px 8px 0 0',
    border: '1px solid var(--border)', borderBottom: active ? '1px solid var(--surface)' : '1px solid var(--border)',
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--muted)',
    fontWeight: active ? 600 : 400, fontSize: 13,
    cursor: 'pointer', marginBottom: -1,
    transition: 'all 0.15s',
  }),
  tabBadge: (color) => ({
    background: color, color: '#fff',
    fontSize: 10, fontWeight: 700,
    padding: '1px 6px', borderRadius: 10,
    marginLeft: 6,
  }),

  filterRow: {
    display: 'flex', gap: 10, flexWrap: 'wrap',
    alignItems: 'center', marginBottom: 16,
  },
  select: {
    padding: '6px 10px', borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text)',
    fontSize: 13, cursor: 'pointer',
  },
  searchInput: {
    padding: '6px 12px', borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text)',
    fontSize: 13, width: 180,
  },

  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '10px 12px', textAlign: 'left',
    fontSize: 11, fontWeight: 600, color: 'var(--muted)',
    letterSpacing: '0.05em', textTransform: 'uppercase',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
  },
  tr: (hover) => ({
    borderBottom: '1px solid var(--border)',
    background: hover ? 'var(--surface)' : 'transparent',
    cursor: 'pointer', transition: 'background 0.1s',
  }),
  td: { padding: '11px 12px', fontSize: 13 },

  tierBadge: (tier) => ({
    display: 'inline-block',
    background: TIER_BG[tier] || 'var(--surface)',
    color: TIER_COLOR[tier] || 'var(--text)',
    border: `1px solid ${TIER_COLOR[tier] || 'var(--border)'}`,
    fontWeight: 700, fontSize: 11,
    padding: '2px 8px', borderRadius: 20,
    letterSpacing: '0.04em',
  }),

  progressWrap: { background: 'var(--border)', borderRadius: 4, height: 6, width: '100%', minWidth: 80 },
  progressBar: (pct, color) => ({
    height: 6, borderRadius: 4,
    width: `${Math.min(100, pct)}%`,
    background: color || 'var(--accent)',
    transition: 'width 0.3s',
  }),

  btn: (color = 'var(--accent)', sm = false) => ({
    padding: sm ? '4px 12px' : '7px 16px',
    borderRadius: 7, border: 'none',
    background: color, color: '#fff',
    fontWeight: 600, fontSize: sm ? 11 : 13,
    cursor: 'pointer',
  }),
  outlineBtn: (color = 'var(--accent)') => ({
    padding: '4px 12px', borderRadius: 7,
    border: `1px solid ${color}`, background: 'transparent',
    color: color, fontWeight: 600, fontSize: 11, cursor: 'pointer',
  }),

  card: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '14px 18px',
  },
  statGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10, marginBottom: 18,
  },
  statCard: (color) => ({
    background: 'var(--surface)', border: `1px solid var(--border)`,
    borderLeft: `3px solid ${color}`,
    borderRadius: 8, padding: '12px 14px',
  }),
  statNum: { fontSize: 22, fontWeight: 700, lineHeight: 1.2 },
  statLabel: { fontSize: 11, color: 'var(--muted)', marginTop: 2 },

  empty: {
    textAlign: 'center', padding: '48px 20px',
    color: 'var(--muted)', fontSize: 14,
  },
  loading: {
    textAlign: 'center', padding: '40px',
    color: 'var(--muted)', fontSize: 13,
  },

  modal: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modalBox: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 14, padding: '28px 32px',
    width: 440, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto',
  },
  modalTitle: { fontSize: 17, fontWeight: 700, marginBottom: 4 },
  modalSub:   { fontSize: 13, color: 'var(--muted)', marginBottom: 20 },
  row:        { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 },
  label:      { fontSize: 12, color: 'var(--muted)', minWidth: 130 },
  value:      { fontSize: 13, fontWeight: 500 },
}

// ── Confirm Upgrade Modal ─────────────────────────────────────────────────────
function ConfirmUpgradeModal({ player, isPotential, onClose, onConfirm }) {
  const { t } = useLanguage()
  const [L2] = useL2()
  const [newTier, setNewTier] = useState('')
  const [loading, setLoading] = useState(false)

  const availableTiers = isPotential
    ? TIER_ORDER.filter(t => TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(player.tier))
    : TIER_ORDER.filter(t => TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(player.tier))

  const handle = async () => {
    if (!newTier) return
    setLoading(true)
    await onConfirm(player, newTier, isPotential)
    setLoading(false)
    onClose()
  }

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={s.modalBox} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>{t('upgrades.modal.confirmUpgrade', 'Confirm Upgrade')}</div>
        <div style={s.modalSub}>
          {isPotential
            ? t('upgrades.modal.moveToPotential', `Move ${player.username} from potential_players to vip_members`)
            : t('upgrades.modal.upgradeToNewTier', `Upgrade ${player.username} to a new VIP tier`)}
        </div>

        <div style={s.row}>
          <span style={s.label}>{t('common.username', 'Username')}</span>
          <span style={s.value}>{player.username}<CopyBtn text={player.username} /></span>
        </div>
        <div style={s.row}>
          <span style={s.label}>{t('upgrades.modal.currentTier', 'Current tier')}</span>
          <span style={s.tierBadge(player.tier)}>{L2(player.tier, TIER_ZH[player.tier] || player.tier)}</span>
        </div>
        <div style={s.row}>
          <span style={s.label}>{t('upgrades.modal.validBetMonth', 'Valid bet (this month)')}</span>
          <span style={s.value}>{fmt(player.monthly_valid_bet, player.currency)}</span>
        </div>
        <div style={s.row}>
          <span style={s.label}>{t('upgrades.modal.monthsActive', 'Months active')}</span>
          <span style={s.value}>{player.months_active ?? monthsAgo(player.registration_date) ?? '—'}</span>
        </div>
        <div style={s.row}>
          <span style={s.label}>{t('common.totalDeposit', 'Total deposit')}</span>
          <span style={s.value}>{fmt(player.total_deposit, player.currency)}</span>
        </div>

        <div style={{ marginTop: 18, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('upgrades.modal.upgradeTo', 'Upgrade to tier:')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {availableTiers.map(t => (
              <button
                key={t}
                style={{
                  padding: '6px 16px', borderRadius: 20,
                  border: `2px solid ${TIER_COLOR[t]}`,
                  background: newTier === t ? TIER_BG[t] : 'transparent',
                  color: TIER_COLOR[t], fontWeight: 700,
                  fontSize: 12, cursor: 'pointer',
                }}
                onClick={() => setNewTier(t)}
              >
                {L2(t, TIER_ZH[t] || t)}
              </button>
            ))}
          </div>
        </div>

        {isPotential && (
          <div style={{
            fontSize: 12, color: 'var(--muted)',
            background: 'var(--bg)', borderRadius: 7,
            padding: '10px 12px', marginBottom: 18,
            border: '1px solid var(--border)',
          }}>
            {L2('ℹ️ Their deposit history, valid bet, and months active will carry over to vip_members automatically.', 'ℹ️ 其存款记录、有效投注和活跃月数会自动转入VIP会员表。')}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={s.outlineBtn('var(--muted)')} onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
          <button
            style={{ ...s.btn(newTier ? TIER_COLOR[newTier] : 'var(--border)'), opacity: newTier ? 1 : 0.5 }}
            disabled={!newTier || loading}
            onClick={handle}
          >
            {loading ? t('upgrades.modal.upgrading', 'Upgrading…') : `${t('upgrades.modal.confirm', 'Confirm')} → ${newTier ? L2(newTier, TIER_ZH[newTier] || newTier) : '?'}`}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Upgrade-reminder helpers (contact_logs.topic = 'upgrade') ────────────────
const MYT_MS = 8 * 3600 * 1000
const mytMonth = ts => new Date(new Date(ts).getTime() + MYT_MS).toISOString().slice(0, 7)
const daysAgo = ts => Math.floor((Date.now() - new Date(ts).getTime()) / 864e5)
const informAgo = (ts, L2) => { const d = daysAgo(ts); return d <= 0 ? L2('Today', '今天') : d === 1 ? L2('Yesterday', '昨天') : L2(`${d}d ago`, `${d}天前`) }
const informColor = ts => { const d = daysAgo(ts); return d <= 7 ? '#3fb950' : d <= 30 ? '#fbbf24' : 'var(--muted)' }
const platOf = v => { const c = String(v?.currency || 'MYR').toUpperCase(); return c === 'SGD' ? 'SG' : c === 'KHUSD' ? 'KH' : 'MY' }
const PLAT_STYLE = { MY: { bg: 'rgba(56,139,253,.15)', fg: '#58a6ff' }, SG: { bg: 'rgba(248,81,73,.15)', fg: '#ff7b72' }, KH: { bg: 'rgba(63,185,80,.15)', fg: '#3fb950' } }
const PlatTag = ({ v }) => { const p = platOf(v); const st = PLAT_STYLE[p]; return <span style={{ fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 4, background: st.bg, color: st.fg, marginRight: 6, letterSpacing: .5 }}>{p}</span> }
const fmtMytDateTime = ts => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// ── WhatsApp Template Modal ───────────────────────────────────────────────────
function WhatsAppModal({ player, agentName, waNumbers = [], onClose, onLogged }) {
  const [lang, setLang]     = useState('en')
  const [L2] = useL2()
  const [copied, setCopied] = useState(false)
  const [sender, setSender] = useState(waNumbers[0]?.codename || '')
  const [logId, setLogId]       = useState(null)
  const [logBusy, setLogBusy]   = useState(false)
  const [logErr, setLogErr]     = useState('')
  const [lastInfo, setLastInfo] = useState(undefined)

  useEffect(() => {
    let off = false
    supabase.from('contact_logs').select('logged_at, host_name').eq('topic', 'upgrade').eq('username', player.username)
      .order('logged_at', { ascending: false }).limit(1)
      .then(({ data }) => { if (!off) setLastInfo(data?.[0] || null) })
    return () => { off = true }
  }, [player.username])

  // Normalize stored whatsapp/phone number — strip spaces, dashes, leading +
  const rawWa = (player.whatsapp || player.phone || '').replace(/[\s\-()]/g, '')
  const waNumber = rawWa.startsWith('+') ? rawWa.slice(1) : rawWa

  const currency = player.currency || 'MYR'
  const turnover = fmt(player.monthly_valid_bet, currency)

  // Fallback next-tier map so template always has a target even when player hasn't qualified
  const FALLBACK_NEXT = {
    GOLD:     { tier: 'PLATINUM', threshold: 2000000 },
    PLATINUM: { tier: 'DIAMOND',  threshold: 6000000 },
    DIAMOND:  { tier: null,       threshold: null     },
  }
  const fallback = FALLBACK_NEXT[player.tier] || {}
  const nextTier   = player.upgrade?.tier   || player.next_tier   || fallback.tier   || null
  const nextThresh = player.upgrade?.threshold || player.next_thresh || fallback.threshold || null
  const gap = nextThresh
    ? fmt(Math.max(0, nextThresh - (player.monthly_valid_bet || 0)), currency)
    : null
  const isReady = (player.upgrade != null) || player.gap_to_next === 0

  const nextLabel = nextTier ? (TIER_ZH[nextTier] || nextTier) : '下一级别'
  const nextLabelEn = nextTier || 'next tier'
  const gapLabel = gap || '—'

  const templates = {
    en: isReady
      ? `Hi bro *${player.username}*! 👋 I'm ${agentName} from sureWin VIP department.\n\nGood news bro 🎉 this month your turnover *${turnover}* already qualify for *${nextLabelEn}*!\n\nI'll arrange the upgrade for you — let me know when you're free ya 💎`
      : `Hi bro *${player.username}*! 👋 I'm ${agentName} from sureWin VIP department.\n\nJust a heads up ah — this month your turnover is *${turnover}* already. Left only *${gapLabel}* more to reach *${nextLabelEn}*! 🎯\n\nPush a bit more bro, once you hit it I settle the upgrade for you. Anything just PM me ya 💎`,
    cn: isReady
      ? `嗨 *${player.username}*！👋 我是sureWin VIP部门的${agentName}。\n\n好消息🎉 这个月你的流水 *${turnover}* 已经达到 *${nextLabel}* 的标准了！\n\n我帮你安排升级，你方便的时候跟我说一声哦 💎`
      : `嗨 *${player.username}*！👋 我是sureWin VIP部门的${agentName}。\n\n跟你报告一下～这个月你的流水已经 *${turnover}* 了，只差 *${gapLabel}* 就可以升 *${nextLabel}* 啦！🎯\n\n再冲一下，达标了我马上帮你安排升级。有什么随时找我哦 💎`,
  }

  const message = templates[lang]

  // One Contact Log per modal open — written on the first Copy or WhatsApp click
  const logSend = async (via) => {
    if (logId || logBusy) return
    setLogBusy(true); setLogErr('')
    const { data: { user } } = await supabase.auth.getUser()
    const myt = new Date(Date.now() + MYT_MS)
    const summary = `⬆ Upgrade reminder sent (${via === 'wa' ? 'WhatsApp button' : 'copied, manual WhatsApp'}, ${lang === 'cn' ? '中文' : 'EN'}): turnover ${turnover} this month, `
      + (isReady ? `qualified for ${nextLabelEn}` : `gap ${gapLabel} to ${nextLabelEn}`)
    const { data, error } = await supabase.from('contact_logs').insert({
      vip_id:          player.id || null,
      username:        player.username,
      tier:            player.tier || null,
      channel:         'WhatsApp',
      outcome:         'Contacted',
      direction:       'outbound',
      topic:           'upgrade',
      notes:           summary,
      message_summary: summary,
      wa_number_used:  sender || null,
      host_name:       agentName,
      host_id:         user?.id || null,
      logged_at:       new Date().toISOString(),
      log_month:       myt.toISOString().slice(0, 7),
      log_week:        String(Math.ceil(myt.getUTCDate() / 7)),
    }).select('id').single()
    setLogBusy(false)
    if (error) { setLogErr(error.message); return }
    setLogId(data.id)
    onLogged && onLogged()
  }

  const undoLog = async () => {
    if (!logId) return
    const { data, error } = await supabase.from('contact_logs').delete().eq('id', logId).select('id')
    if (error || !data?.length) { setLogErr(error?.message || 'not allowed to delete'); return }
    setLogId(null)
    onLogged && onLogged()
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      logSend('copy')
    })
  }

  const handleWhatsApp = () => {
    const base = waNumber ? `https://wa.me/${waNumber}` : 'https://wa.me/'
    window.open(`${base}?text=${encodeURIComponent(message)}`, '_blank')
    logSend('wa')
  }

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={{ ...s.modalBox, width: 500 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 22 }}>💬</span>
          <div>
            <div style={s.modalTitle}>{L2('WhatsApp Template', 'WhatsApp 模板')}</div>
            <div style={s.modalSub}>
              <span style={s.tierBadge(player.tier)}>{L2(player.tier, TIER_ZH[player.tier] || player.tier)}</span>
              <span style={{ marginLeft: 8 }}>{player.username}<CopyBtn text={player.username} /></span>
              <span style={{ marginLeft: 8 }}>· {L2('Turnover', '流水')}: {turnover}</span>
              {nextTier && <span style={{ marginLeft: 8 }}>· {L2('Next', '下一级')}: {L2(nextTier, TIER_ZH[nextTier] || nextTier)}</span>}
            </div>
          </div>
        </div>

        {/* Last informed about upgrade */}
        <div style={{ fontSize: 12, margin: '8px 0 12px', padding: '7px 10px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          {lastInfo === undefined
            ? <span style={{ color: 'var(--muted)' }}>{L2('Checking last reminder…', '查询上次通知…')}</span>
            : lastInfo
              ? <>🕒 {L2('Last informed about upgrade:', '上次通知升级：')} <strong style={{ color: informColor(lastInfo.logged_at) }}>{fmtMytDateTime(lastInfo.logged_at)}</strong>
                  <span style={{ color: 'var(--muted)' }}> · {informAgo(lastInfo.logged_at, L2)}{lastInfo.host_name ? ` · ${L2('by', '由')} ${lastInfo.host_name}` : ''}</span></>
              : <span style={{ color: 'var(--muted)' }}>🕒 {L2('Never informed about upgrade yet', '还没有通知过升级')}</span>}
        </div>

        {/* Lang toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['en','English'],['cn','中文']].map(([k, label]) => (
            <button
              key={k}
              style={{
                padding: '5px 16px', borderRadius: 20,
                border: `1px solid ${lang === k ? 'var(--accent)' : 'var(--border)'}`,
                background: lang === k ? 'var(--accent)' : 'transparent',
                color: lang === k ? '#fff' : 'var(--muted)',
                fontWeight: lang === k ? 700 : 400,
                fontSize: 12, cursor: 'pointer',
              }}
              onClick={() => { setLang(k); setCopied(false) }}
            >
              {label}
            </button>
          ))}
          {isReady && (
            <span style={{
              marginLeft: 'auto', fontSize: 11, fontWeight: 700,
              color: '#4ade80', padding: '5px 10px',
              background: 'rgba(74,222,128,0.1)', borderRadius: 20,
              border: '1px solid rgba(74,222,128,0.3)',
            }}>
              {L2('✓ Ready to Upgrade', '✓ 可升级')}
            </span>
          )}
        </div>

        {/* Message preview */}
        <div style={{
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 16px',
          fontSize: 13, lineHeight: 1.7,
          whiteSpace: 'pre-wrap', color: 'var(--text)',
          marginBottom: 14, minHeight: 120,
          fontFamily: 'inherit',
        }}>
          {message.split('\n').map((line, i) => {
            // Render *bold* text
            const parts = line.split(/(\*[^*]+\*)/g)
            return (
              <span key={i}>
                {parts.map((p, j) =>
                  p.startsWith('*') && p.endsWith('*')
                    ? <strong key={j}>{p.slice(1, -1)}</strong>
                    : p
                )}
                {i < message.split('\n').length - 1 && <br />}
              </span>
            )
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            style={{
              ...s.btn(copied ? '#10b981' : 'var(--surface)'),
              color: copied ? '#fff' : 'var(--text)',
              border: `1px solid ${copied ? '#10b981' : 'var(--border)'}`,
              flex: 1,
            }}
            onClick={handleCopy}
          >
            {copied ? L2('✓ Copied!', '✓ 已复制！') : L2('📋 Copy Message', '📋 复制信息')}
          </button>
          <button
            style={{ ...s.btn('#25D366'), flex: 1 }}
            onClick={handleWhatsApp}
          >
            {L2('💬 Open WhatsApp', '💬 打开WhatsApp')}
          </button>
          <button style={s.outlineBtn('var(--muted)')} onClick={onClose}>{L2('Close', '关闭')}</button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, textAlign: 'center' }}>
          {logBusy
            ? <span style={{ color: 'var(--muted)' }}>{L2('Logging…', '记录中…')}</span>
            : logId
              ? <div style={{ textAlign: 'left' }}><ContactFollowUp logId={logId} onUndo={undoLog} onSaved={() => onLogged && onLogged()} /></div>
              : logErr
                ? <span style={{ color: '#f85149' }}>{L2('Log failed: ', '记录失败：')}{logErr}</span>
                : <span style={{ color: 'var(--muted)' }}>{L2('Copy or WhatsApp will auto-log this to Contact Log', '复制或打开WhatsApp会自动记录到联系记录')}</span>}
        </div>

        {waNumbers.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{L2('📱 Send as (codename)', '📱 发送号码 (代号)')}</div>
            <select value={sender} onChange={e => setSender(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:8, fontSize:12, outline:'none' }}>
              {waNumbers.map(n => <option key={n.id} value={n.codename}>{n.codename} — {n.number}{n.telco?' ('+n.telco+')':''}</option>)}
            </select>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>
          {waNumber
            ? <>{L2('📱 Will open chat with ', '📱 将直接打开与 ')}<strong>{rawWa}</strong>{L2(' directly', ' 的聊天')}</>
            : <>{L2('No phone number on file — select the contact manually.', '没有电话号码记录 — 请手动选择联系人。')}</>
          }
        </div>
      </div>
    </div>
  )
}

// ── Upgrade Challenge Modal ────────────────────────────────────────────────────
function ChallengeModal({ player, challenge, agentName, waNumbers = [], onClose, onSaved }) {
  const [targetAmount, setTargetAmount] = useState(challenge?.target_amount ? String(challenge.target_amount) : '')
  const [deadline, setDeadline]         = useState(challenge?.deadline ? challenge.deadline.slice(0, 10) : '')
  const [notes, setNotes]               = useState(challenge?.notes || '')
  const [saving, setSaving]             = useState(false)
  const [copied, setCopied]             = useState(false)
  const [lang, setLang]                 = useState('en')
  const [L2, uiLang] = useL2()

  // A challenge is a lower upgrade target for THIS MONTH (e.g. 1.8M instead of 2M):
  // progress = the month's total valid bet so far, not only what was played after the offer.
  const currency    = player.currency || 'MYR'
  const currentBet  = player.monthly_valid_bet ?? 0
  const target      = parseFloat(targetAmount) || 0
  const chProgress  = target > 0 ? Math.min(100, Math.max(0, (currentBet / target) * 100)) : 0
  const achieved    = target > 0 && currentBet >= target
  const remaining   = Math.max(0, target - currentBet)
  const normalTarget = { GOLD: 2000000, PLATINUM: 6000000 }[player.tier] || null
  const monthEnd    = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0) })()
  const pastMonth   = deadline && new Date(deadline + 'T00:00:00') > monthEnd

  const deadlineDate = deadline ? new Date(deadline + 'T23:59:59') : null
  const isExpired    = deadlineDate && deadlineDate < new Date()
  const daysLeft     = deadlineDate ? Math.ceil((deadlineDate - new Date()) / (1000 * 60 * 60 * 24)) : null

  const VIP_NEXT    = { GOLD: 'PLATINUM', PLATINUM: 'DIAMOND' }
  const nextTier    = VIP_NEXT[player.tier] || 'next tier'

  const targetFmt   = target > 0 ? fmt(target, currency) : '___'
  const deadlineFmt = deadline ? new Date(deadline + 'T12:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '___'
  const progressFmt = fmt(currentBet, currency)
  const remainingFmt = fmt(remaining, currency)

  const waTemplates = {
    en: achieved
      ? `Hi *${player.username}*! 🎉 Congratulations! You've completed our special upgrade challenge!\n\nYour valid bet this month is *${progressFmt}*, meeting the *${targetFmt}* target! 🏆\n\nYou are now eligible for your *${nextTier}* upgrade! We will arrange it shortly. Thank you for your loyalty! 💎`
      : `Hi *${player.username}*! 👋 This is ${agentName} from sureWin VIP Department.\n\nWe have a special offer just for you! 🎯\n\nReach *${targetFmt}* total valid bet this month by *${deadlineFmt}*, and you will be eligible for an upgrade to *${nextTier}*!\n\n📊 This month so far: *${progressFmt}* / ${targetFmt} (${chProgress.toFixed(0)}%) — only *${remainingFmt}* more to go!\n\nFeel free to reach out anytime! 💎`,
    cn: achieved
      ? `您好 *${player.username}*！🎉 恭喜您完成了我们的特别升级挑战！\n\n您本月的有效流水已达 *${progressFmt}*，达成了 *${targetFmt}* 的目标！🏆\n\n您现在有资格晋升到 *${nextTier}*！我们将尽快为您安排。感谢您的支持！💎`
      : `您好 *${player.username}*！👋 我是sureWin VIP部门的${agentName}。\n\n我们为您提供一个特别升级优惠！🎯\n\n在 *${deadlineFmt}* 之前，本月有效流水累计达到 *${targetFmt}*，即可获得晋升到 *${nextTier}* 的资格！\n\n📊 本月目前：*${progressFmt}* / ${targetFmt} (${chProgress.toFixed(0)}%) — 只差 *${remainingFmt}*！\n\n有任何需要请随时联系！💎`,
  }
  const message = waTemplates[lang]

  const handleSave = async () => {
    if (!targetAmount || !deadline) return
    setSaving(true)
    let error
    if (challenge?.id) {
      ;({ error } = await supabase.from('upgrade_challenges').update({
        target_amount: target,
        deadline,
        notes: notes || null,
        status: 'active',
      }).eq('id', challenge.id))
    } else {
      ;({ error } = await supabase.from('upgrade_challenges').insert({
        username:        player.username,
        upgrade_to_tier: nextTier,
        host_name:       agentName || null,
        baseline_bet:    player.monthly_valid_bet ?? 0,
        target_amount:   target,
        deadline,
        notes:           notes || null,
        status:          'active',
      }))
    }
    if (error) { alert(L2('Save failed: ', '保存失败：') + error.message); setSaving(false); return }
    setSaving(false)
    onSaved?.()
    onClose()
  }

  const handleCancel = async () => {
    if (!challenge?.id) return
    if (!window.confirm(L2('Cancel this challenge?', '确定取消此挑战？'))) return
    await supabase.from('upgrade_challenges').update({ status: 'cancelled' }).eq('id', challenge.id)
    onSaved?.()
    onClose()
  }

  const openWa = () => {
    const rawWa = (player.whatsapp || player.phone || '').replace(/[\s\-()+]/g, '')
    const wa = rawWa ? rawWa : ''
    window.open(`${wa ? `https://wa.me/${wa}` : 'https://wa.me/'}?text=${encodeURIComponent(message)}`, '_blank')
  }

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={{ ...s.modalBox, width: 530 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 22 }}>🎯</span>
          <div>
            <div style={s.modalTitle}>{L2('Upgrade Challenge', '升级挑战')} — {player.username}</div>
            <div style={s.modalSub}>
              <span style={s.tierBadge(player.tier)}>{L2(player.tier, TIER_ZH[player.tier] || player.tier)}</span>
              <span style={{ marginLeft: 8 }}>{L2('Valid Bet', '有效投注')}: {fmt(player.monthly_valid_bet, currency)}</span>
              <span style={{ marginLeft: 8 }}>→ <span style={s.tierBadge(nextTier)}>{L2(nextTier, TIER_ZH[nextTier] || '下一级')}</span></span>
            </div>
          </div>
        </div>

        {/* Existing challenge progress */}
        {challenge && (
          <div style={{
            background: 'var(--bg)',
            border: `1px solid ${achieved ? 'rgba(74,222,128,0.4)' : isExpired ? 'rgba(248,81,73,0.4)' : 'rgba(251,191,36,0.4)'}`,
            borderRadius: 10, padding: '12px 16px', marginTop: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: achieved ? '#4ade80' : isExpired ? '#f85149' : '#fbbf24', marginBottom: 8 }}>
              {achieved ? L2('✅ Challenge Completed!', '✅ 挑战已完成！') : isExpired ? L2('⏰ Challenge Expired', '⏰ 挑战已过期') : L2(`🎯 Challenge Active · ${daysLeft}d left`, `🎯 挑战进行中 · 剩余${daysLeft}天`)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${chProgress}%`, height: '100%', background: achieved ? '#4ade80' : isExpired ? '#f85149' : '#fbbf24', borderRadius: 4, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: achieved ? '#4ade80' : 'var(--text)', minWidth: 36 }}>{chProgress.toFixed(0)}%</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>{L2('This month', '本月')}: <strong style={{ color: 'var(--text)' }}>{fmt(currentBet, currency)}</strong> / {fmt(challenge.target_amount, currency)}{!achieved && <> · {L2('needs', '还差')} <strong style={{ color: 'var(--text)' }}>{fmt(Math.max(0, challenge.target_amount - currentBet), currency)}</strong></>}</span>
              <span>{L2('Deadline', '截止日期')}: <strong style={{ color: 'var(--text)' }}>{new Date(challenge.deadline + 'T12:00:00').toLocaleDateString(uiLang === 'zh' ? 'zh-CN' : 'en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></span>
            </div>
          </div>
        )}

        {/* Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{L2('Custom Target Amount', '自定义目标金额')} ({currency})</div>
            <input
              type="number"
              value={targetAmount}
              onChange={e => setTargetAmount(e.target.value)}
              placeholder={L2('e.g. 150000', '例如 150000')}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
            />
            {target > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>= {fmt(target, currency)}{normalTarget ? ` · ${L2('normal', '正常')} ${fmt(normalTarget, currency)}` : ''} · {L2("counts this month's total valid bet", '按本月累计有效流水计算')}</div>}
            {pastMonth && <div style={{ fontSize: 10, color: '#f85149', marginTop: 2 }}>{L2('Deadline is after this month — monthly valid bet starts again from 0 next month.', '截止日期超过本月 — 下个月有效流水会从 0 重新计算。')}</div>}
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{L2('Deadline', '截止日期')}</div>
            <input
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{L2('Notes (optional)', '备注（选填）')}</div>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={L2('e.g. Special offer: 150k in 2 days for upgrade', '例如：特别优惠 — 2天内完成15万即可升级')}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>

        {/* WhatsApp template */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>{L2('💬 WhatsApp Message Template', '💬 WhatsApp 信息模板')}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[['en', 'English'], ['cn', '中文']].map(([k, label]) => (
              <button key={k}
                style={{ padding: '4px 12px', borderRadius: 20, border: `1px solid ${lang === k ? 'var(--accent)' : 'var(--border)'}`, background: lang === k ? 'var(--accent)' : 'transparent', color: lang === k ? '#fff' : 'var(--muted)', fontSize: 11, cursor: 'pointer', fontWeight: lang === k ? 700 : 400 }}
                onClick={() => { setLang(k); setCopied(false) }}
              >{label}</button>
            ))}
            {achieved && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#4ade80', padding: '4px 10px', background: 'rgba(74,222,128,0.1)', borderRadius: 20, border: '1px solid rgba(74,222,128,0.3)' }}>{L2('✅ Achievement message', '✅ 达成信息')}</span>}
          </div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)', maxHeight: 150, overflowY: 'auto', fontFamily: 'inherit' }}>
            {message.split('\n').map((line, i) => {
              const parts = line.split(/(\*[^*]+\*)/g)
              return (
                <span key={i}>
                  {parts.map((p, j) => p.startsWith('*') && p.endsWith('*') ? <strong key={j}>{p.slice(1, -1)}</strong> : p)}
                  {i < message.split('\n').length - 1 && <br />}
                </span>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              style={{ ...s.btn(copied ? '#10b981' : 'var(--surface)'), color: copied ? '#fff' : 'var(--text)', border: `1px solid ${copied ? '#10b981' : 'var(--border)'}`, flex: 1, fontSize: 11 }}
              onClick={() => navigator.clipboard.writeText(message).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}
            >
              {copied ? L2('✓ Copied!', '✓ 已复制！') : L2('📋 Copy Message', '📋 复制信息')}
            </button>
            <button style={{ ...s.btn('#25D366'), flex: 1, fontSize: 11 }} onClick={openWa}>
              {L2('💬 Open WhatsApp', '💬 打开WhatsApp')}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {challenge?.id && challenge.status === 'active' && (
            <button style={{ ...s.outlineBtn('#f85149'), fontSize: 11 }} onClick={handleCancel}>
              {L2('✕ Cancel Challenge', '✕ 取消挑战')}
            </button>
          )}
          <button style={s.outlineBtn('var(--muted)')} onClick={onClose}>{L2('Close', '关闭')}</button>
          <button
            style={{ ...s.btn('#fbbf24'), color: '#000', fontWeight: 700, opacity: (targetAmount && deadline) ? 1 : 0.5 }}
            disabled={!targetAmount || !deadline || saving}
            onClick={handleSave}
          >
            {saving ? L2('Saving…', '保存中…') : challenge?.id ? L2('💾 Update Challenge', '💾 更新挑战') : L2('🎯 Set Challenge', '🎯 设置挑战')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Inline Contact Log Form ────────────────────────────────────────────────────
function ContactLogForm({ player, onClose }) {
  const [channel, setChannel]   = useState('WhatsApp')
  const [L2] = useL2()
  const CHANNEL_ZH = { WhatsApp:'WhatsApp', Call:'电话', Telegram:'Telegram', 'In-person':'面对面', Other:'其他' }
  const OUTCOME_ZH = { Contacted:'已联系', 'No Reply':'未回复', Replied:'已回复', Deposited:'已存款', Reactivated:'已召回' }
  const [outcome, setOutcome]   = useState('Contacted')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)

  const CHANNELS = ['WhatsApp','Call','Telegram','In-person','Other']
  const OUTCOMES = ['Contacted','No Reply','Replied','Deposited','Reactivated']

  const handleSave = async () => {
    if (!notes.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    let hostName = 'Marcus'
    if (user?.id) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
      if (prof?.full_name) hostName = prof.full_name
    }
    const { error } = await supabase.from('contact_logs').insert({
      vip_id:          player.id || null,
      username:        player.username,
      tier:            player.tier || null,
      channel,
      outcome,
      notes,
      message_summary: notes,
      host_name:       hostName,
      host_id:         user?.id || null,
      direction:       'outbound',
      logged_at:       new Date().toISOString(),
      log_month:       new Date().toISOString().slice(0,7),
      log_week:        String(Math.ceil(new Date().getDate()/7)),
    })
    if (error) { alert(L2('Save failed: ', '保存失败：') + error.message); setSaving(false); return }
    // Sync last_contacted on vip_members
    const _now = new Date().toISOString()
    await supabase.from('vip_members').update({ last_contacted: _now }).eq('username', player.username)
    setSaving(false)
    onClose()
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{L2('Contact Type', '联系方式')}</div>
          <select value={channel} onChange={e => setChannel(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
            {CHANNELS.map(c => <option key={c} value={c}>{L2(c, CHANNEL_ZH[c])}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{L2('Outcome', '结果')}</div>
          <select value={outcome} onChange={e => setOutcome(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
            {OUTCOMES.map(o => <option key={o} value={o}>{L2(o, OUTCOME_ZH[o])}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{L2('Notes *', '备注 *')}</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder={L2('What happened? Response, follow-up needed...', '发生了什么？回应、是否需要跟进…')}
          style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={s.outlineBtn('var(--muted)')} onClick={onClose}>{L2('Cancel', '取消')}</button>
        <button
          style={{ ...s.btn('#58a6ff'), opacity: notes.trim() ? 1 : 0.5 }}
          disabled={saving || !notes.trim()} onClick={handleSave}>
          {saving ? L2('Saving…', '保存中…') : L2('Save Log', '保存记录')}
        </button>
      </div>
    </div>
  )
}

// ── TAB 1: VIP Upgrade Candidates ─────────────────────────────────────────────
function VIPCandidatesTab({ hostFilter = 'ALL' }) {
  const [L2, uiLang] = useL2()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { t } = useLanguage()
  const myName = profile?.full_name || ''
  const [vips, setVips]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [tierF, setTierF]       = useUrlParam('vTier', 'ALL')
  const [upgradeF, setUpgradeF] = useUrlParam('vUpgrade', 'ALL')
  const [search, setSearch]     = useUrlParam('vSearch', '')
  const [hovered, setHovered]   = useState(null)
  const [modal, setModal]           = useState(null)
  const [contactModal, setContactModal] = useState(null)
  const [waModal, setWaModal]       = useState(null)
  const [selectedMonth, setSelectedMonth] = useUrlParam('vMonth', '')
  const [availableMonths, setAvailableMonths] = useState([])
  const [waNumbers, setWaNumbers]         = useState([])
  const [challengeMap, setChallengeMap]   = useState({})
  const [challengeModal, setChallengeModal] = useState(null)
  const [informMap, setInformMap] = useState({})
  const [informF, setInformF]     = useUrlParam('vInform', 'ALL')
  const [platF, setPlatF]         = useUrlParam('vPlat', 'ALL')
  const platOk = v => platF === 'ALL' || platOf(v) === platF

  const reloadInform = useCallback(async () => {
    const { data } = await supabase.from('contact_logs').select('username, logged_at, host_name')
      .eq('topic', 'upgrade').order('logged_at', { ascending: false }).limit(5000)
    const m = {}
    ;(data || []).forEach(r => { if (!m[r.username]) m[r.username] = r })
    setInformMap(m)
  }, [])
  useEffect(() => { reloadInform() }, [reloadInform])

  useEffect(() => {
    if (!myName) return
    supabase.from('wa_numbers').select('id,codename,number,telco').eq('host', myName).eq('status','Active')
      .then(({ data }) => setWaNumbers(data || []))
  }, [myName])

  const reloadChallenges = async () => {
    const { data } = await supabase.from('upgrade_challenges').select('*').in('status', ['active', 'expired'])
    const cMap = {}
    ;(data || []).forEach(c => { cMap[c.username] = c })
    setChallengeMap(cMap)
  }

  useEffect(() => {
    const init = async () => {
      // Fetch oldest and newest snapshot dates (2 queries only), then generate all
      // month labels between them in JS — avoids paginating all 26 000+ rows.
      const [{ data: oldest }, { data: newest }] = await Promise.all([
        supabase.from('vip_daily_snapshots').select('snapshot_date').order('snapshot_date', { ascending: true  }).limit(1),
        supabase.from('vip_daily_snapshots').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1),
      ])
      const months = []
      if (oldest?.[0] && newest?.[0]) {
        let cur = new Date(oldest[0].snapshot_date)
        cur = new Date(cur.getFullYear(), cur.getMonth(), 1)
        const end = new Date(newest[0].snapshot_date)
        const endM = new Date(end.getFullYear(), end.getMonth(), 1)
        while (cur <= endM) {
          months.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`)
          cur.setMonth(cur.getMonth() + 1)
        }
        months.reverse()
      }
      setAvailableMonths(months)
      setSelectedMonth(months[0] || '')
    }
    init()
  }, [])

  useEffect(() => {
    if (!selectedMonth) return
    const load = async () => {
      setLoading(true)
      const { data: vipData } = await supabase
        .from('vip_members')
        .select('id, username, tier, last_deposit_date, days_inactive, host_assigned, currency, phone, whatsapp')
        .in('tier', ['GOLD', 'PLATINUM'])

      if (!vipData || vipData.length === 0) { setVips([]); setLoading(false); return }

      // Fetch selected month totals AND previous month totals for comparison
      const monthIdx = availableMonths.indexOf(selectedMonth)
      const prevMonth = availableMonths[monthIdx + 1] || null

      const [{ data: totals }, { data: prevTotals }] = await Promise.all([
        supabase.from('vip_monthly_totals').select('username, monthly_valid_bet').eq('snapshot_month', selectedMonth),
        prevMonth
          ? supabase.from('vip_monthly_totals').select('username, monthly_valid_bet').eq('snapshot_month', prevMonth)
          : Promise.resolve({ data: [] }),
      ])

      const totalsMap = {}
      ;(totals || []).forEach(t => { totalsMap[t.username] = parseFloat(t.monthly_valid_bet) || 0 })
      const prevMap = {}
      ;(prevTotals || []).forEach(t => { prevMap[t.username] = parseFloat(t.monthly_valid_bet) || 0 })

      const merged = vipData
        .map(v => ({
          ...v,
          monthly_valid_bet: totalsMap[v.username] ?? 0,
          prev_valid_bet:    prevMap[v.username] ?? null,
        }))

      const withUpgrade = merged.map(v => ({
        ...v,
        upgrade: getVipUpgradeTarget(v.tier, v.monthly_valid_bet),
      }))

      // Sort by upgrade progress percentage descending — 100% (Ready) naturally floats to top,
      // followed by those closest to qualifying, then by monthly_valid_bet for ties
      withUpgrade.sort((a, b) => {
        const VIP_NEXT = { GOLD: { threshold: 2000000 }, PLATINUM: { threshold: 6000000 } }
        const aTarget = a.upgrade || VIP_NEXT[a.tier] || null
        const bTarget = b.upgrade || VIP_NEXT[b.tier] || null
        const aPct = aTarget ? (a.monthly_valid_bet||0) / aTarget.threshold : 0
        const bPct = bTarget ? (b.monthly_valid_bet||0) / bTarget.threshold : 0
        if (bPct !== aPct) return bPct - aPct
        return (b.monthly_valid_bet||0) - (a.monthly_valid_bet||0)
      })

      setVips(withUpgrade)

      // Load upgrade challenges alongside VIP data
      const { data: challenges } = await supabase
        .from('upgrade_challenges')
        .select('*')
        .in('status', ['active', 'expired'])
      const cMap = {}
      ;(challenges || []).forEach(c => { cMap[c.username] = c })
      setChallengeMap(cMap)

      setLoading(false)
    }
    load()
  }, [selectedMonth, availableMonths])

  const scoped = vips.filter(platOk)
  const filtered = vips.filter(v => {
    if (!platOk(v)) return false
    if (tierF !== 'ALL' && v.tier !== tierF) return false
    if (search && !v.username.toLowerCase().includes(search.toLowerCase())) return false
    if (hostFilter === 'UNASSIGNED' && v.host_assigned) return false
    if (hostFilter !== 'ALL' && hostFilter !== 'UNASSIGNED' && v.host_assigned !== hostFilter) return false
    if (informF !== 'ALL') {
      const inf = informMap[v.username]
      const thisMonth = new Date(Date.now() + MYT_MS).toISOString().slice(0, 7)
      const informedThisMonth = !!inf && mytMonth(inf.logged_at) === thisMonth
      if (informF === 'NOT_MONTH' && informedThisMonth) return false
      if (informF === 'MONTH' && !informedThisMonth) return false
    }
    if (upgradeF === 'QUALIFIES') return v.upgrade !== null
    if (upgradeF === 'SKIP') return v.upgrade && TIER_ORDER.indexOf(v.upgrade.tier) - TIER_ORDER.indexOf(v.tier) > 1
    if (upgradeF !== 'ALL') return v.upgrade?.tier === upgradeF
    return true
  })

  const qualified = scoped.filter(v => v.upgrade !== null).length

  const handleConfirm = async (player, newTier) => {
    await supabase.from('vip_members').update({ tier: newTier, updated_at: new Date().toISOString() }).eq('id', player.id)
    setVips(prev => prev.map(v => v.id === player.id
      ? { ...v, tier: newTier, upgrade: getVipUpgradeTarget(newTier, v.monthly_valid_bet) }
      : v
    ))
  }

  return (
    <div>
      {/* Stats */}
      <div style={s.statGrid}>
        {[
          { label: L2('Gold members', '黄金会员'),      val: scoped.filter(v => v.tier === 'GOLD').length,      color: TIER_COLOR.GOLD },
          { label: L2('Platinum members', '白金会员'),  val: scoped.filter(v => v.tier === 'PLATINUM').length,  color: TIER_COLOR.PLATINUM },
          { label: L2('Qualify for upgrade', '符合升级'), val: qualified, color: '#10b981' },
          { label: L2('Skip-tier upgrades', '跳级升级'),  val: scoped.filter(v => v.upgrade && TIER_ORDER.indexOf(v.upgrade.tier) - TIER_ORDER.indexOf(v.tier) > 1).length, color: '#f59e0b' },
        ].map((st, i) => (
          <div key={i} style={s.statCard(st.color)}>
            <div style={{ ...s.statNum, color: st.color }}>{st.val}</div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>

      {/* Platform */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 4 }}>{L2('Platform:', '平台：')}</span>
        {[['ALL', L2('All', '全部')], ['MY', '🇲🇾 MY'], ['SG', '🇸🇬 SG'], ...(vips.some(v => platOf(v) === 'KH') ? [['KH', '🇰🇭 KH']] : [])].map(([k, label]) => {
          const n = k === 'ALL' ? vips.length : vips.filter(v => platOf(v) === k).length
          const on = platF === k
          return (
            <button key={k} onClick={() => setPlatF(k)}
              style={{ padding: '5px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'var(--text)' }}>
              {label} · {n}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div style={s.filterRow}>
        <input placeholder={L2('Search username…', '搜索用户名…')} value={search} onChange={e => setSearch(e.target.value)} style={s.searchInput} />
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={s.select}>
          <option value="ALL">{L2('All Tiers', '全部等级')}</option>
          <option value="GOLD">{L2('Gold', '黄金')}</option>
          <option value="PLATINUM">{L2('Platinum', '白金')}</option>
        </select>
        <select value={upgradeF} onChange={e => setUpgradeF(e.target.value)} style={s.select}>
          <option value="ALL">{L2('All', '全部')}</option>
          <option value="QUALIFIES">{L2('✅ Qualifies Now', '✅ 现在符合')}</option>
          <option value="SKIP">{L2('⚡ Skip-Tier', '⚡ 跳级')}</option>
          <option value="PLATINUM">{L2('→ Platinum', '→ 白金')}</option>
          <option value="DIAMOND">{L2('→ Diamond', '→ 钻石')}</option>
        </select>
        <select value={informF} onChange={e => setInformF(e.target.value)} style={s.select}>
          <option value="ALL">{L2('📣 Informed: any', '📣 通知：全部')}</option>
          <option value="NOT_MONTH">{L2('🔕 Not informed this month', '🔕 本月未通知')}</option>
          <option value="MONTH">{L2('✅ Informed this month', '✅ 本月已通知')}</option>
        </select>
        <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ ...s.select, color: 'var(--accent)', fontWeight: 700 }}>
          {availableMonths.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {L2(`${filtered.length} members shown`, `显示 ${filtered.length} 位会员`)}
        </span>
      </div>

      {loading ? <div style={s.loading}>{L2('Loading…', '载入中…')}</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {['#', t('common.username', 'Username'), t('upgrades.colCurrentTier', 'Current Tier'), t('upgrades.colValidBet', 'Valid Bet'), t('upgrades.colLastMonthTurnover'), t('upgrades.colProgress', 'Progress'), t('upgrades.colUpgradesTo', 'Upgrades To'), t('upgrades.colGap', 'Gap'), t('upgrades.colLastDeposit', 'Last Deposit'), t('upgrades.colHost', 'Host'), L2('Last informed', '上次通知'), 'Phone / WA', ''].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={13}><div style={s.empty}>{L2('No members match this filter', '没有符合筛选的会员')}</div></td></tr>
                : filtered.map((v, rowIdx) => {
                  const pct = v.upgrade ? Math.min(100, (v.monthly_valid_bet / v.upgrade.threshold) * 100) : 0
                  const isSkip = v.upgrade && TIER_ORDER.indexOf(v.upgrade.tier) - TIER_ORDER.indexOf(v.tier) > 1
                  // Next tier thresholds for "Not yet" gap display
                  const VIP_NEXT = { GOLD: { tier: 'PLATINUM', threshold: 2000000 }, PLATINUM: { tier: 'DIAMOND', threshold: 6000000 } }
                  const nextTarget = v.upgrade || VIP_NEXT[v.tier] || null
                  const nextPct = nextTarget ? Math.min(100, (v.monthly_valid_bet / nextTarget.threshold) * 100) : 0
                  return (
                    <tr
                      key={v.id}
                      style={{ ...s.tr(hovered === v.id), borderLeft: (myName && v.host_assigned===myName) ? '3px solid var(--accent)' : '3px solid transparent', background: hovered===v.id ? 'var(--surface)' : (myName && v.host_assigned===myName) ? 'rgba(99,102,241,0.04)' : 'transparent' }}
                      onMouseEnter={() => setHovered(v.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => navigate(`/vips/${v.id}`)}
                    >
                      <td style={{ ...s.td, color:'var(--muted)', fontSize:12, width:36 }}>{rowIdx + 1}</td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <PlatTag v={v} />
                          <strong>{v.username}</strong>
                          <CopyBtn text={v.username} />
                        </div>
                      </td>
                      <td style={s.td}><span style={s.tierBadge(v.tier)}>{L2(v.tier, TIER_ZH[v.tier] || v.tier)}</span></td>
                      <td style={s.td}>{fmt(v.monthly_valid_bet, v.currency)}</td>
                      <td style={s.td}>
                        {v.prev_valid_bet !== null
                          ? <span style={{ fontSize: 12, color: v.monthly_valid_bet >= v.prev_valid_bet ? '#3fb950' : '#f85149' }}>
                              {fmt(v.prev_valid_bet, v.currency)}
                              <span style={{ fontSize: 10, marginLeft: 4 }}>
                                {v.monthly_valid_bet >= v.prev_valid_bet ? '↑' : '↓'}
                              </span>
                            </span>
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                      <td style={{ ...s.td, minWidth: 110 }}>
                        {nextTarget
                          ? <div>
                              <div style={s.progressWrap}>
                                <div style={s.progressBar(nextPct, TIER_COLOR[nextTarget.tier])} />
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{nextPct.toFixed(0)}%</div>
                              {(() => {
                                const ch = challengeMap[v.username]
                                if (!ch || ch.status !== 'active') return null
                                const chPct = ch.target_amount > 0
                                  ? Math.min(100, Math.max(0, ((v.monthly_valid_bet || 0) / ch.target_amount) * 100))
                                  : 0
                                return (
                                  <div style={{ marginTop: 5 }}>
                                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                      <div style={{ width: `${chPct}%`, height: '100%', background: chPct >= 100 ? '#4ade80' : '#fbbf24', borderRadius: 2 }} />
                                    </div>
                                    <div style={{ fontSize: 9, color: '#fbbf24', marginTop: 2 }}>🎯 {chPct.toFixed(0)}% {L2('challenge', '挑战')}</div>
                                  </div>
                                )
                              })()}
                            </div>
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                      <td style={s.td}>
                        {v.upgrade
                          ? <span>
                              <span style={s.tierBadge(v.upgrade.tier)}>{L2(v.upgrade.tier, TIER_ZH[v.upgrade.tier] || v.upgrade.tier)}</span>
                              {isSkip && <span style={{ marginLeft: 5, fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>{L2('⚡SKIP', '⚡跳级')}</span>}
                            </span>
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Not yet', '未达到')}</span>
                        }
                      </td>
                      <td style={s.td}>
                        {v.upgrade
                          ? <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>{L2('✓ Ready', '✓ 可升级')}</span>
                          : nextTarget
                            ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                                {fmt(nextTarget.threshold - v.monthly_valid_bet, v.currency)}
                                <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>{L2(`to ${nextTarget.tier}`, `距${TIER_ZH[nextTarget.tier] || nextTarget.tier}`)}</span>
                              </span>
                            : '—'
                        }
                      </td>
                      <td style={s.td}>{fmtDate(v.last_deposit_date, uiLang)}</td>
                      <td style={{ ...s.td, fontSize: 12, color: 'var(--muted)' }}>{v.host_assigned || '—'}</td>
                      <td style={{ ...s.td, fontSize: 12, whiteSpace: 'nowrap' }} title={informMap[v.username] ? fmtMytDateTime(informMap[v.username].logged_at) : ''}>
                        {informMap[v.username]
                          ? <><span style={{ color: informColor(informMap[v.username].logged_at), fontWeight: 600 }}>{informAgo(informMap[v.username].logged_at, L2)}</span>
                              {informMap[v.username].host_name && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>· {informMap[v.username].host_name}</span>}</>
                          : <span style={{ color: 'var(--muted)' }}>{L2('Never', '从未')}</span>}
                      </td>
                      <td style={s.td} onClick={e => e.stopPropagation()}>
                        {(v.phone || v.whatsapp)
                          ? <div style={{ display: 'flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: 12 }}>{v.whatsapp || v.phone}</span>
                              <CopyBtn text={v.whatsapp || v.phone} />
                            </div>
                          : <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                      <td style={s.td} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          {v.upgrade
                            ? <button style={s.btn(TIER_COLOR[v.upgrade.tier], true)} onClick={() => setModal(v)}>
                                {t('upgrades.btn.upgrade', 'Upgrade')}
                              </button>
                            : <>
                                {challengeMap[v.username]
                                  ? <button
                                      style={{
                                        ...s.outlineBtn(challengeMap[v.username].status === 'active' ? '#fbbf24' : '#f85149'),
                                        fontSize: 11, fontWeight: 700,
                                      }}
                                      onClick={() => setChallengeModal(v)}
                                    >
                                      {challengeMap[v.username].status === 'active' ? L2('🎯 Challenge', '🎯 挑战') : L2('⏰ Expired', '⏰ 已过期')}
                                    </button>
                                  : <button style={s.outlineBtn('#58a6ff')} onClick={() => setContactModal(v)}>
                                      {t('upgrades.btn.contact', 'Contact')}
                                    </button>
                                }
                                <button
                                  title={L2('Set / view upgrade challenge', '设置/查看升级挑战')}
                                  style={{ ...s.outlineBtn('#fbbf24'), padding: '3px 7px', fontSize: 12 }}
                                  onClick={() => setChallengeModal(v)}
                                >
                                  {challengeMap[v.username] ? '✏' : '🎯'}
                                </button>
                              </>
                          }
                          <button
                            title={L2('Send WhatsApp message', '发送WhatsApp信息')}
                            style={{ ...s.btn('#25D366', true), padding: '4px 9px', fontSize: 14 }}
                            onClick={() => setWaModal(v)}
                          >💬</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ConfirmUpgradeModal
          player={modal}
          isPotential={false}
          onClose={() => setModal(null)}
          onConfirm={handleConfirm}
        />
      )}

      {contactModal && (
        <div style={s.modal} onClick={() => setContactModal(null)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>{L2('Log Contact', '记录联系')} — {contactModal.username}</div>
            <div style={s.modalSub}>
              <span style={{ ...s.tierBadge(contactModal.tier), marginRight: 8 }}>{contactModal.tier}</span>
              Valid Bet: {fmt(contactModal.monthly_valid_bet, contactModal.currency)} · Last Deposit: {fmtDate(contactModal.last_deposit_date, uiLang)}
            </div>
            <ContactLogForm player={contactModal} onClose={() => setContactModal(null)} />
          </div>
        </div>
      )}

      {waModal && (
        <WhatsAppModal
          player={waModal}
          agentName={myName || 'Agent'}
          waNumbers={waNumbers}
          onClose={() => setWaModal(null)}
          onLogged={reloadInform}
        />
      )}

      {challengeModal && (
        <ChallengeModal
          player={challengeModal}
          challenge={challengeMap[challengeModal.username] || null}
          agentName={myName || 'Agent'}
          waNumbers={waNumbers}
          onClose={() => setChallengeModal(null)}
          onSaved={reloadChallenges}
        />
      )}
    </div>
  )
}

// ── Default thresholds (fallback if DB fetch fails) ───────────────────────────
const DEFAULT_THRESHOLDS = { BRONZE: 500, SILVER: 3000 }

// ── TAB 2: Potential Players ───────────────────────────────────────────────────
function PotentialsTab({ hostFilter = 'ALL' }) {
  const [L2, uiLang] = useL2()
  const { t } = useLanguage()
  const { profile } = useAuth()
  const myName = profile?.full_name || ''
  const [players, setPlayers]   = useState([])
  const [thresholds, setThresh] = useState([])
  const [threshMap, setThreshMap] = useState(DEFAULT_THRESHOLDS)
  const [loading, setLoading]   = useState(true)
  const [tierF, setTierF]       = useUrlParam('pTier', 'ALL')
  const [flagF, setFlagF]       = useUrlParam('pFlag', 'ALL')
  const [search, setSearch]     = useUrlParam('pSearch', '')
  const [hovered, setHovered]   = useState(null)
  const [modal, setModal]           = useState(null)
  const [contactModal, setContactModal] = useState(null)
  const [page, setPage]             = useUrlParamNumber('pPage', 0)
  const PAGE = 50

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      // Fetch thresholds
      const { data: thresh } = await supabase
        .from('upgrade_thresholds')
        .select('from_tier, to_tier, threshold')
        .eq('is_active', true)
      if (thresh) {
        setThresh(thresh) // full array for skip-tier logic
        const t = {}
        // Use the LOWEST threshold per tier (next immediate upgrade target)
        thresh.forEach(r => {
          if (!t[r.from_tier] || r.threshold < t[r.from_tier]) {
            t[r.from_tier] = r.threshold
          }
        })
        setThreshMap({ ...DEFAULT_THRESHOLDS, ...t })
      }
      // Fetch active potentials (not graduated)
      const { data } = await supabase
        .from('potential_players')
        .select('*')
        .eq('is_graduated', false)

      let merged = data || []
      if (merged.length > 0) {
        const now = new Date()
        const thisMonthPot = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
        const { data: _potCheck } = await supabase.from('potential_monthly_totals').select('snapshot_month').eq('snapshot_month', thisMonthPot).limit(1)
        const currentMonth = (_potCheck && _potCheck.length > 0) ? thisMonthPot : await (async () => {
          const { data: _potLatest } = await supabase.from('potential_monthly_totals').select('snapshot_month').order('snapshot_month', { ascending: false }).limit(1)
          return _potLatest?.[0]?.snapshot_month || thisMonthPot
        })()
        // NOTE: don't filter with .in('username', usernames) — potential_players can run into
        // the thousands, which would make the URL query string exceed length limits. Fetch the
        // whole month's totals instead (still a manageable dataset) and join client-side.
        const { data: totals, error: totalsErr } = await supabase
          .from('potential_monthly_totals')
          .select('username, monthly_valid_bet')
          .eq('snapshot_month', currentMonth)
        if (totalsErr) console.error('PotentialsTab: potential_monthly_totals fetch error', totalsErr)
        const totalsMap = {}
        ;(totals || []).forEach(t => { totalsMap[t.username] = t.monthly_valid_bet })
        merged = merged
          .map(p => ({ ...p, monthly_valid_bet: totalsMap[p.username] ?? p.monthly_valid_bet ?? 0 }))
          .sort((a, b) => (b.monthly_valid_bet||0) - (a.monthly_valid_bet||0))
      }
      setPlayers(merged)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = players.filter(p => {
    if (p.is_graduated) return false
    if (tierF !== 'ALL' && p.tier !== tierF) return false
    if (flagF === 'FLAGGED' && !p.upgrade_flag) return false
    if (flagF === 'CLEAN'   &&  p.upgrade_flag) return false
    if (search && !p.username.toLowerCase().includes(search.toLowerCase())) return false
    if (hostFilter === 'UNASSIGNED' && p.host_assigned) return false
    if (hostFilter !== 'ALL' && hostFilter !== 'UNASSIGNED' && p.host_assigned !== hostFilter) return false
    return true
  })

  const paginated = filtered.slice(page * PAGE, (page + 1) * PAGE)
  const totalPages = Math.ceil(filtered.length / PAGE)

  const handleConfirm = async (player, newTier) => {
    const now = new Date().toISOString()
    // Insert into vip_members
    await supabase.from('vip_members').upsert({
      username:         player.username,
      tier:             newTier,
      total_deposit:    player.total_deposit,
      total_withdrawal: player.total_withdrawal,
      total_rebate:     player.total_rebate,
      monthly_valid_bet: player.monthly_valid_bet,
      valid_bet_month:  player.valid_bet_month,
      deposit_count:    player.deposit_count,
      registration_date: player.registration_date,
      region:           player.region,
      created_at:       now,
      updated_at:       now,
    }, { onConflict: 'username' })
    // Mark as graduated in potential_players
    await supabase.from('potential_players').update({
      is_graduated:     true,
      upgraded_at:      now,
      upgraded_to_tier: newTier,
      upgrade_flag:     false,
    }).eq('id', player.id)
    // Remove from local state
    setPlayers(prev => prev.filter(p => p.id !== player.id))
  }

  return (
    <div>
      {/* Stats */}
      <div style={s.statGrid}>
        {[
          { label: L2('Bronze players', '青铜玩家'),  val: players.filter(p => p.tier === 'BRONZE').length, color: TIER_COLOR.BRONZE },
          { label: L2('Silver players', '白银玩家'),  val: players.filter(p => p.tier === 'SILVER').length, color: TIER_COLOR.SILVER },
          { label: L2('Upgrade flagged', '已标记升级'), val: players.filter(p => p.upgrade_flag).length,       color: '#10b981' },
          { label: L2('Total potentials', '潜力玩家总数'), val: players.length,                                   color: 'var(--accent)' },
        ].map((st, i) => (
          <div key={i} style={s.statCard(st.color)}>
            <div style={{ ...s.statNum, color: st.color }}>{st.val}</div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>

      {/* Thresholds reminder */}
      <div style={{
        fontSize: 12, color: 'var(--muted)',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '8px 14px', marginBottom: 14,
        display: 'flex', gap: 20,
      }}>
        <span>{L2('🏅 Bronze → Silver at ', '🏅 青铜 → 白银：有效投注 ')}<strong style={{ color: TIER_COLOR.SILVER }}>{fmt(threshMap.BRONZE)}</strong>{L2(' valid bet', '')}</span>
        <span>{L2('🥈 Silver → Gold at ', '🥈 白银 → 黄金：有效投注 ')}<strong style={{ color: TIER_COLOR.GOLD }}>{fmt(threshMap.SILVER)}</strong>{L2(' valid bet', '')}</span>
      </div>

      {/* Filters */}
      <div style={s.filterRow}>
        <input placeholder={L2('Search username…', '搜索用户名…')} value={search} onChange={e => setSearch(e.target.value)} style={s.searchInput} />
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={s.select}>
          <option value="ALL">{L2('All Tiers', '全部等级')}</option>
          <option value="BRONZE">{L2('Bronze', '青铜')}</option>
          <option value="SILVER">{L2('Silver', '白银')}</option>
        </select>
        <select value={flagF} onChange={e => setFlagF(e.target.value)} style={s.select}>
          <option value="ALL">{L2('All Status', '全部状态')}</option>
          <option value="FLAGGED">{L2('🚀 Upgrade Flagged', '🚀 已标记升级')}</option>
          <option value="CLEAN">{L2('Active', '活跃')}</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {L2(`${filtered.length} players · page ${page + 1}/${totalPages || 1}`, `${filtered.length} 位玩家 · 第 ${page + 1}/${totalPages || 1} 页`)}
        </span>
      </div>

      {loading ? <div style={s.loading}>{L2('Loading…', '载入中…')}</div> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['#', t('common.username', 'Username'), t('upgrades.colTier', 'Tier'), t('upgrades.colValidBet', 'Valid Bet'), t('upgrades.colProgress', 'Progress'), t('upgrades.colGapToNext', 'Gap to Next'), t('common.totalDeposit', 'Total Deposit'), t('upgrades.colMemberSince', 'Member Since'), t('upgrades.colLastMonth', 'Last Month'), t('common.status', 'Status'), ''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0
                  ? <tr><td colSpan={10}><div style={s.empty}>{L2('No players match this filter', '没有符合筛选的玩家')}</div></td></tr>
                  : paginated.map((p, rowIdx) => {
                    const target = getPotentialUpgradeTarget(p.tier, p.monthly_valid_bet, thresholds)
                    const nextTarget = getNextUpgradeTarget(p.tier, thresholds)
                    const thresh = nextTarget?.threshold ?? 99999999
                    const pct = Math.min(100, ((p.monthly_valid_bet ?? 0) / thresh) * 100)
                    return (
                      <tr
                        key={p.id}
                        style={{ ...s.tr(hovered === p.id), borderLeft: '3px solid transparent' }}
                        onMouseEnter={() => setHovered(p.id)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <td style={{ ...s.td, color:'var(--muted)', fontSize:12, width:36 }}>{page * PAGE + rowIdx + 1}</td>
                        <td style={s.td}><strong>{p.username}<CopyBtn text={p.username} /></strong></td>
                        <td style={s.td}><span style={s.tierBadge(p.tier)}>{L2(p.tier, TIER_ZH[p.tier] || p.tier)}</span></td>
                        <td style={s.td}>{fmt(p.monthly_valid_bet, p.currency)}</td>
                        <td style={{ ...s.td, minWidth: 100 }}>
                          <div style={s.progressWrap}>
                            <div style={s.progressBar(pct, target ? TIER_COLOR[target.tier] : TIER_COLOR[p.tier])} />
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{pct.toFixed(0)}%</div>
                        </td>
                        <td style={s.td}>
                          {target
                            ? <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
                                ✓ →{' '}
                                <span style={s.tierBadge(target.to_tier)}>{L2(target.to_tier, TIER_ZH[target.to_tier] || target.to_tier)}</span>
                                {TIER_ORDER.indexOf(target.to_tier) - TIER_ORDER.indexOf(p.tier) > 1 &&
                                  <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginLeft: 4 }}>{L2('⚡SKIP', '⚡跳级')}</span>
                                }
                              </span>
                            : nextTarget
                              ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                                  {fmt(nextTarget.threshold - (p.monthly_valid_bet ?? 0))}
                                  <span style={{ fontSize: 10, marginLeft: 3 }}>{L2(`to ${nextTarget.to_tier}`, `距${TIER_ZH[nextTarget.to_tier] || nextTarget.to_tier}`)}</span>
                                </span>
                              : '—'
                          }
                        </td>
                        <td style={s.td}>{fmt(p.total_deposit, p.currency)}</td>
                        <td style={{ ...s.td, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                          {p.registration_date
                            ? new Date(p.registration_date).toLocaleDateString(uiLang === 'zh' ? 'zh-CN' : 'en-MY', { month: 'short', year: 'numeric' })
                            : '—'
                          }
                        </td>
                        <td style={{ ...s.td, fontSize: 12, color: 'var(--muted)' }}>{p.last_import_month || '—'}</td>
                        <td style={s.td}>
                          {p.upgrade_flag
                            ? <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 12 }}>{L2('🚀 Ready', '🚀 可升级')}</span>
                            : <span style={{ color: 'var(--muted)', fontSize: 12 }}>{L2('Active', '活跃')}</span>
                          }
                        </td>
                        <td style={s.td} onClick={e => e.stopPropagation()}>
                          {p.upgrade_flag && target
                            ? <button
                                style={s.btn(TIER_COLOR[target.to_tier] || '#10b981', true)}
                                onClick={() => setModal(p)}
                              >
                                {t('upgrades.btn.upgrade', 'Upgrade')}
                              </button>
                            : <button
                                style={s.outlineBtn('#58a6ff')}
                                onClick={() => setContactModal(p)}
                              >
                                {t('upgrades.btn.contact', 'Contact')}
                              </button>
                          }
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 16 }}>
              <button style={s.outlineBtn()} disabled={page === 0} onClick={() => setPage(p => p - 1)}>{L2('‹ Prev', '‹ 上一页')}</button>
              <span style={{ fontSize: 13, padding: '4px 8px', color: 'var(--muted)' }}>{page + 1} / {totalPages}</span>
              <button style={s.outlineBtn()} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>{L2('Next ›', '下一页 ›')}</button>
            </div>
          )}
        </>
      )}

      {modal && (
        <ConfirmUpgradeModal
          player={modal}
          isPotential={true}
          onClose={() => setModal(null)}
          onConfirm={handleConfirm}
        />
      )}

      {contactModal && (
        <div style={s.modal} onClick={() => setContactModal(null)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>{L2('Log Contact', '记录联系')} — {contactModal.username}</div>
            <div style={s.modalSub}>
              <span style={{ ...s.tierBadge(contactModal.tier), marginRight: 8 }}>{contactModal.tier}</span>
              Valid Bet: {fmt(contactModal.monthly_valid_bet, contactModal.currency)} · Total Deposit: {fmt(contactModal.total_deposit, contactModal.currency)}
            </div>
            <ContactLogForm player={contactModal} onClose={() => setContactModal(null)} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── TAB 3: Graduated History ───────────────────────────────────────────────────
function GraduatedTab({ hostFilter = 'ALL' }) {
  const [L2, uiLang] = useL2()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useUrlParam('gSearch', '')
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('potential_players')
        .select('*')
        .eq('is_graduated', true)
        .order('upgraded_at', { ascending: false })
      setPlayers(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = players.filter(p => {
    if (search && !p.username.toLowerCase().includes(search.toLowerCase())) return false
    if (hostFilter === 'UNASSIGNED' && p.host_assigned) return false
    if (hostFilter !== 'ALL' && hostFilter !== 'UNASSIGNED' && p.host_assigned !== hostFilter) return false
    return true
  })

  return (
    <div>
      {/* Stats */}
      <div style={s.statGrid}>
        {[
          { label: L2('Total graduated', '已晋升总数'),  val: players.length,                                                  color: '#10b981' },
          { label: L2('Bronze → VIP', '青铜 → VIP'),     val: players.filter(p => p.tier === 'BRONZE').length,                 color: TIER_COLOR.BRONZE },
          { label: L2('Silver → VIP', '白银 → VIP'),     val: players.filter(p => p.tier === 'SILVER').length,                 color: TIER_COLOR.SILVER },
          { label: L2('Graduated to Gold', '晋升至黄金'), val: players.filter(p => p.upgraded_to_tier === 'GOLD').length,      color: TIER_COLOR.GOLD },
        ].map((st, i) => (
          <div key={i} style={s.statCard(st.color)}>
            <div style={{ ...s.statNum, color: st.color }}>{st.val}</div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>

      <div style={s.filterRow}>
        <input placeholder={L2('Search username…', '搜索用户名…')} value={search} onChange={e => setSearch(e.target.value)} style={s.searchInput} />
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {L2(`${filtered.length} graduated players`, `${filtered.length} 位已晋升玩家`)}
        </span>
      </div>

      {loading ? <div style={s.loading}>{L2('Loading…', '载入中…')}</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {['#', t('common.username', 'Username'), t('upgrades.colWas', 'Was'), t('upgrades.colUpgradedTo', 'Upgraded To'), t('upgrades.colUpgradedOn', 'Upgraded On'), t('upgrades.colMonthsAsPotential', 'Months as Potential'), t('upgrades.colDepositAtUpgrade', 'Total Deposit at Upgrade'), t('upgrades.colValidBetAtUpgrade', 'Valid Bet at Upgrade'), t('upgrades.colViewVip', 'View VIP')].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={9}><div style={s.empty}>{L2('No graduated players yet', '暂无已晋升玩家')}</div></td></tr>
                : filtered.map((p, rowIdx) => (
                  <tr
                    key={p.id}
                    style={s.tr(hovered === p.id)}
                    onMouseEnter={() => setHovered(p.id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <td style={{ ...s.td, color:'var(--muted)', fontSize:12, width:36 }}>{rowIdx + 1}</td>
                    <td style={s.td}><strong>{p.username}<CopyBtn text={p.username} /></strong></td>
                    <td style={s.td}><span style={s.tierBadge(p.tier)}>{L2(p.tier, TIER_ZH[p.tier] || p.tier)}</span></td>
                    <td style={s.td}>
                      <span style={s.tierBadge(p.upgraded_to_tier || 'GOLD')}>
                        {p.upgraded_to_tier ? L2(p.upgraded_to_tier, TIER_ZH[p.upgraded_to_tier] || p.upgraded_to_tier) : '—'}
                      </span>
                    </td>
                    <td style={s.td}>{fmtDate(p.upgraded_at, uiLang)}</td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{p.months_active ?? '—'}</td>
                    <td style={s.td}>{fmt(p.total_deposit, p.currency)}</td>
                    <td style={s.td}>{fmt(p.monthly_valid_bet, p.currency)}</td>
                    <td style={s.td} onClick={e => e.stopPropagation()}>
                      <button
                        style={s.outlineBtn('var(--accent)')}
                        onClick={async () => {
                          const { data } = await supabase
                            .from('vip_members')
                            .select('id')
                            .eq('username', p.username)
                            .single()
                          if (data) navigate(`/vips/${data.id}`)
                        }}
                      >
                        {t('upgrades.btn.view', 'View →')}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── TAB 4: Tier History ─────────────────────────────────────────────────────
function TierHistoryTab({ hostFilter = 'ALL' }) {
  const [L2, uiLang] = useL2()
  const navigate  = useNavigate()
  const [logs,    setLogs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [typeF,   setTypeF]   = useUrlParam('htType',   'ALL')
  const [tierF,   setTierF]   = useUrlParam('htTier',   'ALL')
  const [search,  setSearch]  = useUrlParam('htSearch', '')
  const [hovered, setHovered] = useState(null)

  const ORD = { SILVER: 0, GOLD: 1, PLATINUM: 2, DIAMOND: 3, BLACK: 4 }
  const isUpgrade = (oldT, newT) => (ORD[newT] ?? 0) > (ORD[oldT] ?? 0)

  const TC = {
    SILVER:   '#94a3b8',
    GOLD:     '#f59e0b',
    PLATINUM: '#e5e7eb',
    DIAMOND:  '#a78bfa',
    BLACK:    '#111827',
  }

  useEffect(() => {
    supabase
      .from('tier_change_logs')
      .select('id, username, old_tier, new_tier, changed_at, import_month, source, vip_id')
      .order('changed_at', { ascending: false })
      .then(({ data }) => { setLogs(data || []); setLoading(false) })
  }, [])

  const TierPill = ({ tier }) => {
    const c = TC[tier] || '#94a3b8'
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
        background: c + '22', color: c, border: `1px solid ${c}55`,
        display: 'inline-block',
      }}>{tier ? L2(tier, TIER_ZH[tier] || tier) : '?'}</span>
    )
  }

  const filtered = logs.filter(log => {
    const up = isUpgrade(log.old_tier, log.new_tier)
    if (typeF === 'UPGRADE'   && !up) return false
    if (typeF === 'DOWNGRADE' &&  up) return false
    if (tierF !== 'ALL' && log.new_tier !== tierF && log.old_tier !== tierF) return false
    if (search) {
      const q = search.toLowerCase()
      if (!log.username?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const upgrades   = logs.filter(l =>  isUpgrade(l.old_tier, l.new_tier)).length
  const downgrades = logs.filter(l => !isUpgrade(l.old_tier, l.new_tier)).length

  const fmtDate = (val) => {
    if (!val) return '—'
    return new Date(val).toLocaleDateString(uiLang === 'zh' ? 'zh-CN' : 'en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const chip = (active, color) => ({
    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, border: 'none',
    background: active ? color : 'var(--surface2)',
    color: active ? '#fff' : 'var(--muted)',
    cursor: 'pointer',
  })

  return (
    <div>
      {/* ── Summary Stats ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { count: upgrades,   label: L2('Upgrades', '升级'),   color: '#10b981' },
          { count: downgrades, label: L2('Downgrades', '降级'),  color: '#f85149' },
          { count: logs.length,label: L2('Total Events', '事件总数'), color: 'var(--text)' },
        ].map(({ count, label, color }) => (
          <div key={label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 18px',
            display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color }}>{count}</span>
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{L2('recorded', '已记录')}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={chip(typeF==='ALL',       'var(--brand)')} onClick={() => setTypeF('ALL')}>{L2('All', '全部')}</button>
          <button style={chip(typeF==='UPGRADE',   '#10b981')}     onClick={() => setTypeF('UPGRADE')}>{L2('▲ Upgrades', '▲ 升级')}</button>
          <button style={chip(typeF==='DOWNGRADE', '#f85149')}     onClick={() => setTypeF('DOWNGRADE')}>{L2('▼ Downgrades', '▼ 降级')}</button>
        </div>
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={{
          fontSize: 12, padding: '5px 10px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--surface2)',
          color: 'var(--text)', cursor: 'pointer',
        }}>
          {['ALL','SILVER','GOLD','PLATINUM','DIAMOND','BLACK'].map(t => (
            <option key={t} value={t}>{t === 'ALL' ? L2('All Tiers', '全部等级') : L2(t, TIER_ZH[t] || t)}</option>
          ))}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={L2('Search username…', '搜索用户名…')}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: 'var(--text)', width: 160 }}
        />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {L2(`${filtered.length} event${filtered.length !== 1 ? 's' : ''}`, `${filtered.length} 个事件`)}
        </span>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{L2('Loading…', '载入中…')}</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{L2('No events match your filter.', '没有符合筛选的事件。')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                {['#', L2('Date', '日期'), L2('Player', '玩家'), L2('Change', '变动'), L2('Type', '类型'), L2('Source', '来源')].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left',
                    fontSize: 11, fontWeight: 700, color: 'var(--muted)',
                    textTransform: 'uppercase', letterSpacing: '.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, i) => {
                const up = isUpgrade(log.old_tier, log.new_tier)
                const dotColor = up ? '#10b981' : '#f85149'
                return (
                  <tr key={log.id || i}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => log.vip_id && navigate(`/vips/${log.vip_id}`)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: hovered === i ? 'var(--surface2)' : 'transparent',
                      cursor: log.vip_id ? 'pointer' : 'default',
                      transition: 'background .1s',
                    }}>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12, width: 36 }}>{i + 1}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {fmtDate(log.changed_at || log.import_month, uiLang)}
                      {!log.changed_at && log.import_month && (
                        <span style={{ marginLeft: 4, opacity: 0.5, fontSize: 10 }}>{L2('(month)', '(月)')}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text)' }}>
                      {log.username || '—'}<CopyBtn text={log.username} />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TierPill tier={log.old_tier} />
                        <span style={{ color: dotColor, fontWeight: 700, fontSize: 14 }}>→</span>
                        <TierPill tier={log.new_tier} />
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: dotColor,
                        background: dotColor + '18', padding: '2px 8px', borderRadius: 20,
                        border: `1px solid ${dotColor}33`,
                      }}>{up ? L2('▲ UPGRADED', '▲ 已升级') : L2('▼ DOWNGRADED', '▼ 已降级')}</span>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>
                      {log.source === 'csv_import' ? L2('CSV Import', 'CSV导入') : log.source || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── TAB 5: Downgrade Risk ─────────────────────────────────────────────────────
function DowngradeRiskTab({ hostFilter = 'ALL' }) {
  const [L2, uiLang] = useL2()
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [tierF, setTierF]     = useUrlParam('drTier', 'ALL')
  const [riskF, setRiskF]     = useUrlParam('drRisk', 'AT RISK')
  const [search, setSearch]   = useUrlParam('drSearch', '')
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: riskData }, { data: vipData }] = await Promise.all([
        supabase.from('v_tier_downgrade_risk').select('*'),
        supabase.from('vip_members').select('id, username, host_assigned'),
      ])
      const vipMap = {}
      ;(vipData || []).forEach(v => { vipMap[v.username.toLowerCase()] = v })
      const merged = (riskData || []).map(r => ({
        ...r,
        id:            vipMap[r.username.toLowerCase()]?.id || null,
        host_assigned: vipMap[r.username.toLowerCase()]?.host_assigned || null,
      }))
      const TIER_ORD = { DIAMOND: 0, PLATINUM: 1, GOLD: 2 }
      merged.sort((a, b) => {
        if (a.risk_status !== b.risk_status) return a.risk_status === 'AT RISK' ? -1 : 1
        const td = (TIER_ORD[a.tier] ?? 9) - (TIER_ORD[b.tier] ?? 9)
        if (td !== 0) return td
        return (a.vb_gap ?? 0) - (b.vb_gap ?? 0)
      })
      setRows(merged)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = rows.filter(r => {
    if (tierF !== 'ALL' && r.tier !== tierF) return false
    if (riskF !== 'ALL' && r.risk_status !== riskF) return false
    if (search && !r.username.toLowerCase().includes(search.toLowerCase())) return false
    if (hostFilter === 'UNASSIGNED' && r.host_assigned) return false
    if (hostFilter !== 'ALL' && hostFilter !== 'UNASSIGNED' && r.host_assigned !== hostFilter) return false
    return true
  })

  const atRisk   = rows.filter(r => r.risk_status === 'AT RISK')
  const diamond  = atRisk.filter(r => r.tier === 'DIAMOND').length
  const platinum = atRisk.filter(r => r.tier === 'PLATINUM').length
  const gold     = atRisk.filter(r => r.tier === 'GOLD').length
  const safe     = rows.filter(r => r.risk_status === 'SAFE').length
  const period   = rows[0] ? `${rows[0].period_start} → ${rows[0].period_end}` : ''

  return (
    <div>
      {period && (
        <div style={{
          fontSize: 12, color: 'var(--muted)', marginBottom: 14,
          padding: '8px 14px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 7,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span>{L2('📅 Rolling quarter: ', '📅 滚动季度：')}<strong style={{ color: 'var(--text)' }}>{period}</strong></span>
          <span style={{ color: 'var(--border)' }}>·</span>
          <span>{L2('Maintenance quota: ', '保级门槛：')}<strong style={{ color: TIER_COLOR.GOLD }}>{L2('Gold 250K', '黄金 250K')}</strong> / <strong style={{ color: TIER_COLOR.PLATINUM }}>{L2('Platinum 1M', '白金 1M')}</strong> / <strong style={{ color: TIER_COLOR.DIAMOND }}>{L2('Diamond 3M', '钻石 3M')}</strong>{L2(' quarterly VB', ' 季度有效投注')}</span>
        </div>
      )}

      <div style={s.statGrid}>
        {[
          { label: L2('Diamond at risk', '钻石有风险'),  val: diamond,  color: TIER_COLOR.DIAMOND  || '#a78bfa' },
          { label: L2('Platinum at risk', '白金有风险'), val: platinum, color: TIER_COLOR.PLATINUM || '#e5e7eb' },
          { label: L2('Gold at risk', '黄金有风险'),     val: gold,     color: TIER_COLOR.GOLD     || '#f59e0b' },
          { label: L2('Met quota (safe)', '已达门槛（安全）'), val: safe,     color: '#10b981' },
        ].map((st, i) => (
          <div key={i} style={s.statCard(st.color)}>
            <div style={{ ...s.statNum, color: st.color }}>{st.val}</div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>

      <div style={s.filterRow}>
        <input
          placeholder={L2('Search username…', '搜索用户名…')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={s.searchInput}
        />
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={s.select}>
          <option value="ALL">{L2('All Tiers', '全部等级')}</option>
          <option value="DIAMOND">{L2('Diamond', '钻石')}</option>
          <option value="PLATINUM">{L2('Platinum', '白金')}</option>
          <option value="GOLD">{L2('Gold', '黄金')}</option>
        </select>
        <select value={riskF} onChange={e => setRiskF(e.target.value)} style={s.select}>
          <option value="AT RISK">{L2('⚠️ At Risk Only', '⚠️ 仅有风险')}</option>
          <option value="ALL">{L2('All (incl. Safe)', '全部（含安全）')}</option>
          <option value="SAFE">{L2('✅ Safe Only', '✅ 仅安全')}</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {filtered.length} players shown
        </span>
      </div>

      {loading ? <div style={s.loading}>{L2('Loading…', '载入中…')}</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {['#', L2('Username', '用户名'), L2('Tier', '等级'), L2('Quarterly VB', '季度有效投注'), L2('Quota', '门槛'), L2('Gap', '差距'), L2('Months', '月数'), L2('Downgrade To', '降级至'), L2('Host', '负责人'), L2('Status', '状态')].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={10}><div style={s.empty}>{L2('No players match this filter', '没有符合筛选的玩家')}</div></td></tr>
                : filtered.map((r, rowIdx) => {
                  const pct = r.maintenance_threshold > 0
                    ? Math.min(100, (r.quarterly_vb / r.maintenance_threshold) * 100)
                    : 0
                  const isAtRisk = r.risk_status === 'AT RISK'
                  const barColor = isAtRisk
                    ? (pct < 30 ? '#f85149' : pct < 70 ? '#f59e0b' : '#fbbf24')
                    : '#10b981'
                  return (
                    <tr
                      key={r.username}
                      style={{
                        ...s.tr(hovered === r.username),
                        borderLeft: isAtRisk ? '3px solid #f85149' : '3px solid #10b981',
                        background: hovered === r.username
                          ? 'var(--surface)'
                          : isAtRisk ? 'rgba(248,81,73,0.03)' : 'transparent',
                        cursor: r.id ? 'pointer' : 'default',
                      }}
                      onMouseEnter={() => setHovered(r.username)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => r.id && navigate(`/vips/${r.id}`)}
                    >
                      <td style={{ ...s.td, color:'var(--muted)', fontSize:12, width:36 }}>{rowIdx + 1}</td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <strong>{r.username}</strong>
                          <CopyBtn text={r.username} />
                        </div>
                      </td>
                      <td style={s.td}><span style={s.tierBadge(r.tier)}>{L2(r.tier, TIER_ZH[r.tier] || r.tier)}</span></td>
                      <td style={{ ...s.td, minWidth: 130 }}>
                        <div style={{ fontWeight: 600, marginBottom: 3 }}>{fmt(r.quarterly_vb)}</div>
                        <div style={s.progressWrap}>
                          <div style={s.progressBar(pct, barColor)} />
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          {pct.toFixed(0)}% of quota
                        </div>
                      </td>
                      <td style={{ ...s.td, color: 'var(--muted)', fontSize: 12 }}>
                        {fmt(r.maintenance_threshold)}
                      </td>
                      <td style={s.td}>
                        <span style={{ fontWeight: 600, color: isAtRisk ? '#f85149' : '#10b981' }}>
                          {isAtRisk ? '' : '+'}{fmt(r.vb_gap)}
                        </span>
                      </td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        <span style={{ fontWeight: 700, color: (r.months_covered || 0) < 3 ? '#f59e0b' : 'var(--text)' }}>
                          {r.months_covered ?? 0}/3
                        </span>
                      </td>
                      <td style={s.td}>
                        {r.downgrade_to
                          ? <span style={s.tierBadge(r.downgrade_to)}>{L2(r.downgrade_to, TIER_ZH[r.downgrade_to] || r.downgrade_to)}</span>
                          : <span style={{ color: '#10b981', fontSize: 12 }}>{L2('✓ Safe', '✓ 安全')}</span>}
                      </td>
                      <td style={{ ...s.td, fontSize: 12, color: 'var(--muted)' }}>
                        {r.host_assigned || '—'}
                      </td>
                      <td style={s.td}>
                        {isAtRisk ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#f85149', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 20, padding: '2px 8px' }}>{L2('⚠️ AT RISK', '⚠️ 有风险')}</span>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 20, padding: '2px 8px' }}>{L2('✓ SAFE', '✓ 安全')}</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function Upgrades() {
  const [L2, uiLang] = useL2()
  const { t } = useLanguage()
  const { profile } = useAuth()
  const [tab, setTab] = useUrlParam('tab', 'vip')
  const [hostFilter, setHostFilter] = useUrlParam('hHost', 'ALL')
  const [hosts, setHosts] = useState([])
  const [counts, setCounts] = useState({ vipReady: 0, potFlagged: 0, graduated: 0, downgradeAtRisk: 0 })

  useEffect(() => {
    const loadCounts = async () => {
      const [{ count: vipReady }, { count: potFlagged }, { count: graduated }, { data: hostData }, { count: downgradeAtRisk }] = await Promise.all([
        supabase.from('vip_members').select('*', { count: 'exact', head: true })
          .in('tier', ['GOLD', 'PLATINUM']),
        supabase.from('potential_players').select('*', { count: 'exact', head: true })
          .eq('upgrade_flag', true).eq('is_graduated', false),
        supabase.from('potential_players').select('*', { count: 'exact', head: true })
          .eq('is_graduated', true),
        supabase.from('vip_members').select('host_assigned')
          .not('host_assigned', 'is', null).neq('host_assigned', ''),
        supabase.from('v_tier_downgrade_risk').select('*', { count: 'exact', head: true })
          .eq('risk_status', 'AT RISK'),
      ])
      setCounts({ vipReady: vipReady || 0, potFlagged: potFlagged || 0, graduated: graduated || 0, downgradeAtRisk: downgradeAtRisk || 0 })
      if (hostData) {
        const unique = [...new Set(hostData.map(r => r.host_assigned))].sort()
        setHosts(unique)
      }
    }
    loadCounts()
  }, [])

  // "My players" quick shortcut — auto-detect current user's name
  const myName = profile?.full_name || ''

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
        <div>
          <div style={s.heading}>{t('upgrades.heading', 'Upgrades')}</div>
          <div style={s.sub}>{t('upgrades.sub', 'Track VIP tier upgrades and promote Bronze/Silver players to VIP status')}</div>
        </div>

        {/* ── Global Host Filter ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{L2('Host:', '负责人：')}</span>
          <select
            value={hostFilter}
            onChange={e => setHostFilter(e.target.value)}
            style={{
              ...s.select,
              fontWeight: hostFilter !== 'ALL' ? 700 : 400,
              color: hostFilter !== 'ALL' ? 'var(--accent)' : 'var(--text)',
              minWidth: 160,
            }}
          >
            <option value="ALL">{L2('All Hosts', '全部负责人')}</option>
            {myName && <option value={myName}>{L2('👤 My Players', '👤 我的玩家')} ({myName})</option>}
            {hosts.filter(h => h !== myName).map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
            <option value="UNASSIGNED">{L2('— Unassigned —', '— 未分配 —')}</option>
          </select>
          {hostFilter !== 'ALL' && (
            <button
              style={{ ...s.outlineBtn('var(--muted)'), fontSize: 11, padding: '4px 10px' }}
              onClick={() => setHostFilter('ALL')}
            >
              {L2('✕ Clear', '✕ 清除')}
            </button>
          )}
        </div>
      </div>

      <div style={s.tabBar}>
        <button style={s.tab(tab === 'vip')} onClick={() => setTab('vip')}>
          {t('upgrades.tabVip', 'VIP Candidates')}
          {counts.vipReady > 0 && <span style={s.tabBadge(TIER_COLOR.GOLD)}>{counts.vipReady}</span>}
        </button>
        <button style={s.tab(tab === 'potentials')} onClick={() => setTab('potentials')}>
          {t('upgrades.tabPotentials', 'Potential Players')}
          {counts.potFlagged > 0 && <span style={s.tabBadge('#10b981')}>{counts.potFlagged} {t('upgrades.ready', 'ready')}</span>}
        </button>
        <button style={s.tab(tab === 'graduated')} onClick={() => setTab('graduated')}>
          {t('upgrades.tabGraduated', 'Graduated')}
          {counts.graduated > 0 && <span style={s.tabBadge('var(--muted)')}>{counts.graduated}</span>}
        </button>
        <button style={s.tab(tab === 'history')} onClick={() => setTab('history')}>
          {L2('Tier History', '等级历史')}
        </button>
        <button style={s.tab(tab === 'downgrade')} onClick={() => setTab('downgrade')}>
          {L2('Downgrade Risk', '降级风险')}
          {counts.downgradeAtRisk > 0 && (
            <span style={s.tabBadge('#f85149')}>{counts.downgradeAtRisk}</span>
          )}
        </button>
      </div>

      {tab === 'vip'        && <VIPCandidatesTab hostFilter={hostFilter} />}
      {tab === 'potentials' && <PotentialsTab    hostFilter={hostFilter} />}
      {tab === 'graduated'  && <GraduatedTab     hostFilter={hostFilter} />}
      {tab === 'history'    && <TierHistoryTab   hostFilter={hostFilter} />}
      {tab === 'downgrade'  && <DowngradeRiskTab  hostFilter={hostFilter} />}
    </div>
  )
}
