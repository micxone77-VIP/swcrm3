import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/format'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam, useUrlParamNumber } from '../hooks/useUrlParam'
import { TIER_COLOR, TIER_BG } from '../lib/constants'

// ── Tier config ───────────────────────────────────────────────────────────────
const TIER_ORDER = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'BLACK']

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
const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
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
  page:    { padding: '28px 32px', color: 'var(--text)', maxWidth: 1100, margin: '0 auto' },
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
          <span style={s.value}>{player.username}</span>
        </div>
        <div style={s.row}>
          <span style={s.label}>{t('upgrades.modal.currentTier', 'Current tier')}</span>
          <span style={s.tierBadge(player.tier)}>{player.tier}</span>
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
                {t}
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
            ℹ️ Their deposit history, valid bet, and months active will carry over to vip_members automatically.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={s.outlineBtn('var(--muted)')} onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
          <button
            style={{ ...s.btn(newTier ? TIER_COLOR[newTier] : 'var(--border)'), opacity: newTier ? 1 : 0.5 }}
            disabled={!newTier || loading}
            onClick={handle}
          >
            {loading ? t('upgrades.modal.upgrading', 'Upgrading…') : `${t('upgrades.modal.confirm', 'Confirm')} → ${newTier || '?'}`}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Inline Contact Log Form ────────────────────────────────────────────────────
function ContactLogForm({ player, onClose }) {
  const [channel, setChannel]   = useState('WhatsApp')
  const [outcome, setOutcome]   = useState('Contacted')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)

  const CHANNELS = ['WhatsApp','Call','In-person','Other']
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
    if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
    setSaving(false)
    onClose()
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Contact Type</div>
          <select value={channel} onChange={e => setChannel(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
            {CHANNELS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Outcome</div>
          <select value={outcome} onChange={e => setOutcome(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
            {OUTCOMES.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Notes *</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="What happened? Response, follow-up needed..."
          style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={s.outlineBtn('var(--muted)')} onClick={onClose}>Cancel</button>
        <button
          style={{ ...s.btn('#58a6ff'), opacity: notes.trim() ? 1 : 0.5 }}
          disabled={saving || !notes.trim()} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Log'}
        </button>
      </div>
    </div>
  )
}

// ── TAB 1: VIP Upgrade Candidates ─────────────────────────────────────────────
function VIPCandidatesTab() {
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
  const [selectedMonth, setSelectedMonth] = useUrlParam('vMonth', '')
  const [availableMonths, setAvailableMonths] = useState([])

  useEffect(() => {
    const init = async () => {
      // Paginate through vip_daily_snapshots to collect all distinct snapshot months.
      // Can't use a simple .select() because Supabase/PostgREST enforces a hard 1000-row
      // server cap — for a view like vip_monthly_totals, each row IS a month-player combo,
      // so we'd only ever see part of the data. Instead, paginate the raw date table.
      const monthSet = new Set()
      let from = 0
      const PAGE = 1000
      while (true) {
        const { data: page, error } = await supabase
          .from('vip_daily_snapshots')
          .select('snapshot_date')
          .order('snapshot_date', { ascending: false })
          .range(from, from + PAGE - 1)
        if (error || !page || page.length === 0) break
        page.forEach(r => monthSet.add(r.snapshot_date.slice(0, 7)))
        if (page.length < PAGE) break
        from += PAGE
      }
      const unique = [...monthSet].sort().reverse()
      setAvailableMonths(unique)
      setSelectedMonth(unique[0] || '')
    }
    init()
  }, [])

  useEffect(() => {
    if (!selectedMonth) return
    const load = async () => {
      setLoading(true)
      const { data: vipData } = await supabase
        .from('vip_members')
        .select('id, username, tier, last_deposit_date, days_inactive, host_assigned, currency')
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
      setLoading(false)
    }
    load()
  }, [selectedMonth, availableMonths])

  const filtered = vips.filter(v => {
    if (tierF !== 'ALL' && v.tier !== tierF) return false
    if (search && !v.username.toLowerCase().includes(search.toLowerCase())) return false
    if (upgradeF === 'QUALIFIES') return v.upgrade !== null
    if (upgradeF === 'SKIP') return v.upgrade && TIER_ORDER.indexOf(v.upgrade.tier) - TIER_ORDER.indexOf(v.tier) > 1
    if (upgradeF !== 'ALL') return v.upgrade?.tier === upgradeF
    return true
  })

  const qualified = vips.filter(v => v.upgrade !== null).length

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
          { label: 'Gold members',      val: vips.filter(v => v.tier === 'GOLD').length,      color: TIER_COLOR.GOLD },
          { label: 'Platinum members',  val: vips.filter(v => v.tier === 'PLATINUM').length,  color: TIER_COLOR.PLATINUM },
          { label: 'Qualify for upgrade', val: qualified, color: '#10b981' },
          { label: 'Skip-tier upgrades',  val: vips.filter(v => v.upgrade && TIER_ORDER.indexOf(v.upgrade.tier) - TIER_ORDER.indexOf(v.tier) > 1).length, color: '#f59e0b' },
        ].map((st, i) => (
          <div key={i} style={s.statCard(st.color)}>
            <div style={{ ...s.statNum, color: st.color }}>{st.val}</div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={s.filterRow}>
        <input placeholder="Search username…" value={search} onChange={e => setSearch(e.target.value)} style={s.searchInput} />
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={s.select}>
          <option value="ALL">All Tiers</option>
          <option value="GOLD">Gold</option>
          <option value="PLATINUM">Platinum</option>
        </select>
        <select value={upgradeF} onChange={e => setUpgradeF(e.target.value)} style={s.select}>
          <option value="ALL">All</option>
          <option value="QUALIFIES">✅ Qualifies Now</option>
          <option value="SKIP">⚡ Skip-Tier</option>
          <option value="PLATINUM">→ Platinum</option>
          <option value="DIAMOND">→ Diamond</option>
        </select>
        <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ ...s.select, color: 'var(--accent)', fontWeight: 700 }}>
          {availableMonths.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {filtered.length} members shown
        </span>
      </div>

      {loading ? <div style={s.loading}>Loading…</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {[t('common.username', 'Username'), t('upgrades.colCurrentTier', 'Current Tier'), t('upgrades.colValidBet', 'Valid Bet'), t('upgrades.colLastMonthTurnover'), t('upgrades.colProgress', 'Progress'), t('upgrades.colUpgradesTo', 'Upgrades To'), t('upgrades.colGap', 'Gap'), t('upgrades.colLastDeposit', 'Last Deposit'), t('upgrades.colHost', 'Host'), ''].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={9}><div style={s.empty}>No members match this filter</div></td></tr>
                : filtered.map(v => {
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
                      <td style={s.td}><strong>{v.username}</strong></td>
                      <td style={s.td}><span style={s.tierBadge(v.tier)}>{v.tier}</span></td>
                      <td style={s.td}>{fmt(v.monthly_valid_bet, v.currency)}</td>
                      <td style={s.td}>
                        {v.prev_valid_bet !== null
                          ? <span style={{ fontSize: 12, color: v.monthly_valid_bet >= v.prev_valid_bet ? '#3fb950' : '#f85149' }}>
                              {fmt(v.prev_valid_bet)}
                              <span style={{ fontSize: 10, marginLeft: 4 }}>
                                {v.monthly_valid_bet >= v.prev_valid_bet ? '↑' : '↓'}
                              </span>
                            </span>
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                      <td style={{ ...s.td, minWidth: 100 }}>
                        {nextTarget
                          ? <div>
                              <div style={s.progressWrap}>
                                <div style={s.progressBar(nextPct, TIER_COLOR[nextTarget.tier])} />
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{nextPct.toFixed(0)}%</div>
                            </div>
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                      <td style={s.td}>
                        {v.upgrade
                          ? <span>
                              <span style={s.tierBadge(v.upgrade.tier)}>{v.upgrade.tier}</span>
                              {isSkip && <span style={{ marginLeft: 5, fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>⚡SKIP</span>}
                            </span>
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>Not yet</span>
                        }
                      </td>
                      <td style={s.td}>
                        {v.upgrade
                          ? <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>✓ Ready</span>
                          : nextTarget
                            ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                                {fmt(nextTarget.threshold - v.monthly_valid_bet)}
                                <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>to {nextTarget.tier}</span>
                              </span>
                            : '—'
                        }
                      </td>
                      <td style={s.td}>{fmtDate(v.last_deposit_date)}</td>
                      <td style={{ ...s.td, fontSize: 12, color: 'var(--muted)' }}>{v.host_assigned || '—'}</td>
                      <td style={s.td} onClick={e => e.stopPropagation()}>
                        {v.upgrade
                          ? <button style={s.btn(TIER_COLOR[v.upgrade.tier], true)} onClick={() => setModal(v)}>
                              {t('upgrades.btn.upgrade', 'Upgrade')}
                            </button>
                          : <button style={s.outlineBtn('#58a6ff')} onClick={() => setContactModal(v)}>
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
            <div style={s.modalTitle}>Log Contact — {contactModal.username}</div>
            <div style={s.modalSub}>
              <span style={{ ...s.tierBadge(contactModal.tier), marginRight: 8 }}>{contactModal.tier}</span>
              Valid Bet: {fmt(contactModal.monthly_valid_bet)} · Last Deposit: {fmtDate(contactModal.last_deposit_date)}
            </div>
            <ContactLogForm player={contactModal} onClose={() => setContactModal(null)} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Default thresholds (fallback if DB fetch fails) ───────────────────────────
const DEFAULT_THRESHOLDS = { BRONZE: 500, SILVER: 3000 }

// ── TAB 2: Potential Players ───────────────────────────────────────────────────
function PotentialsTab() {
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
          { label: 'Bronze players',  val: players.filter(p => p.tier === 'BRONZE').length, color: TIER_COLOR.BRONZE },
          { label: 'Silver players',  val: players.filter(p => p.tier === 'SILVER').length, color: TIER_COLOR.SILVER },
          { label: 'Upgrade flagged', val: players.filter(p => p.upgrade_flag).length,       color: '#10b981' },
          { label: 'Total potentials', val: players.length,                                   color: 'var(--accent)' },
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
        <span>🏅 Bronze → Silver at <strong style={{ color: TIER_COLOR.SILVER }}>{fmt(threshMap.BRONZE)}</strong> valid bet</span>
        <span>🥈 Silver → Gold at <strong style={{ color: TIER_COLOR.GOLD }}>{fmt(threshMap.SILVER)}</strong> valid bet</span>
      </div>

      {/* Filters */}
      <div style={s.filterRow}>
        <input placeholder="Search username…" value={search} onChange={e => setSearch(e.target.value)} style={s.searchInput} />
        <select value={tierF} onChange={e => setTierF(e.target.value)} style={s.select}>
          <option value="ALL">All Tiers</option>
          <option value="BRONZE">Bronze</option>
          <option value="SILVER">Silver</option>
        </select>
        <select value={flagF} onChange={e => setFlagF(e.target.value)} style={s.select}>
          <option value="ALL">All Status</option>
          <option value="FLAGGED">🚀 Upgrade Flagged</option>
          <option value="CLEAN">Active</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {filtered.length} players · page {page + 1}/{totalPages || 1}
        </span>
      </div>

      {loading ? <div style={s.loading}>Loading…</div> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  {[t('common.username', 'Username'), t('upgrades.colTier', 'Tier'), t('upgrades.colValidBet', 'Valid Bet'), t('upgrades.colProgress', 'Progress'), t('upgrades.colGapToNext', 'Gap to Next'), t('common.totalDeposit', 'Total Deposit'), t('upgrades.colMemberSince', 'Member Since'), t('upgrades.colLastMonth', 'Last Month'), t('common.status', 'Status'), ''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0
                  ? <tr><td colSpan={9}><div style={s.empty}>No players match this filter</div></td></tr>
                  : paginated.map(p => {
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
                        <td style={s.td}><strong>{p.username}</strong></td>
                        <td style={s.td}><span style={s.tierBadge(p.tier)}>{p.tier}</span></td>
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
                                <span style={s.tierBadge(target.to_tier)}>{target.to_tier}</span>
                                {TIER_ORDER.indexOf(target.to_tier) - TIER_ORDER.indexOf(p.tier) > 1 &&
                                  <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginLeft: 4 }}>⚡SKIP</span>
                                }
                              </span>
                            : nextTarget
                              ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                                  {fmt(nextTarget.threshold - (p.monthly_valid_bet ?? 0))}
                                  <span style={{ fontSize: 10, marginLeft: 3 }}>to {nextTarget.to_tier}</span>
                                </span>
                              : '—'
                          }
                        </td>
                        <td style={s.td}>{fmt(p.total_deposit, p.currency)}</td>
                        <td style={{ ...s.td, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                          {p.registration_date
                            ? new Date(p.registration_date).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })
                            : '—'
                          }
                        </td>
                        <td style={{ ...s.td, fontSize: 12, color: 'var(--muted)' }}>{p.last_import_month || '—'}</td>
                        <td style={s.td}>
                          {p.upgrade_flag
                            ? <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 12 }}>🚀 Ready</span>
                            : <span style={{ color: 'var(--muted)', fontSize: 12 }}>Active</span>
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
              <button style={s.outlineBtn()} disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span style={{ fontSize: 13, padding: '4px 8px', color: 'var(--muted)' }}>{page + 1} / {totalPages}</span>
              <button style={s.outlineBtn()} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
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
            <div style={s.modalTitle}>Log Contact — {contactModal.username}</div>
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
function GraduatedTab() {
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

  const filtered = players.filter(p =>
    !search || p.username.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Stats */}
      <div style={s.statGrid}>
        {[
          { label: 'Total graduated',  val: players.length,                                                  color: '#10b981' },
          { label: 'Bronze → VIP',     val: players.filter(p => p.tier === 'BRONZE').length,                 color: TIER_COLOR.BRONZE },
          { label: 'Silver → VIP',     val: players.filter(p => p.tier === 'SILVER').length,                 color: TIER_COLOR.SILVER },
          { label: 'Graduated to Gold', val: players.filter(p => p.upgraded_to_tier === 'GOLD').length,      color: TIER_COLOR.GOLD },
        ].map((st, i) => (
          <div key={i} style={s.statCard(st.color)}>
            <div style={{ ...s.statNum, color: st.color }}>{st.val}</div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>

      <div style={s.filterRow}>
        <input placeholder="Search username…" value={search} onChange={e => setSearch(e.target.value)} style={s.searchInput} />
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {filtered.length} graduated players
        </span>
      </div>

      {loading ? <div style={s.loading}>Loading…</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {[t('common.username', 'Username'), t('upgrades.colWas', 'Was'), t('upgrades.colUpgradedTo', 'Upgraded To'), t('upgrades.colUpgradedOn', 'Upgraded On'), t('upgrades.colMonthsAsPotential', 'Months as Potential'), t('upgrades.colDepositAtUpgrade', 'Total Deposit at Upgrade'), t('upgrades.colValidBetAtUpgrade', 'Valid Bet at Upgrade'), t('upgrades.colViewVip', 'View VIP')].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={8}><div style={s.empty}>No graduated players yet</div></td></tr>
                : filtered.map(p => (
                  <tr
                    key={p.id}
                    style={s.tr(hovered === p.id)}
                    onMouseEnter={() => setHovered(p.id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <td style={s.td}><strong>{p.username}</strong></td>
                    <td style={s.td}><span style={s.tierBadge(p.tier)}>{p.tier}</span></td>
                    <td style={s.td}>
                      <span style={s.tierBadge(p.upgraded_to_tier || 'GOLD')}>
                        {p.upgraded_to_tier || '—'}
                      </span>
                    </td>
                    <td style={s.td}>{fmtDate(p.upgraded_at)}</td>
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

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function Upgrades() {
  const { t } = useLanguage()
  const [tab, setTab] = useUrlParam('tab', 'vip')
  const [counts, setCounts] = useState({ vipReady: 0, potFlagged: 0, graduated: 0 })

  useEffect(() => {
    const loadCounts = async () => {
      const [{ count: vipReady }, { count: potFlagged }, { count: graduated }] = await Promise.all([
        supabase.from('vip_members').select('*', { count: 'exact', head: true })
          .in('tier', ['GOLD', 'PLATINUM']),
        supabase.from('potential_players').select('*', { count: 'exact', head: true })
          .eq('upgrade_flag', true).eq('is_graduated', false),
        supabase.from('potential_players').select('*', { count: 'exact', head: true })
          .eq('is_graduated', true),
      ])
      setCounts({ vipReady: vipReady || 0, potFlagged: potFlagged || 0, graduated: graduated || 0 })
    }
    loadCounts()
  }, [])

  return (
    <div style={s.page}>
      <div style={s.heading}>{t('upgrades.heading', 'Upgrades')}</div>
      <div style={s.sub}>{t('upgrades.sub', 'Track VIP tier upgrades and promote Bronze/Silver players to VIP status')}</div>

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
      </div>

      {tab === 'vip'        && <VIPCandidatesTab />}
      {tab === 'potentials' && <PotentialsTab />}
      {tab === 'graduated'  && <GraduatedTab />}
    </div>
  )
}
