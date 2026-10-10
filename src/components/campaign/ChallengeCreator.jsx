// src/components/campaign/ChallengeCreator.jsx — create a Challenge campaign
// (💝 Trust Credit 信任金 / 💰 Rebate Challenge 返水挑战) with a data-driven audience builder.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { L } from '../../lib/campaignGuide'
import { fetchAll, SEGMENTS } from '../../lib/depositProfile'
import { countryFromPlayer, CAMPAIGN_COUNTRIES } from '../../lib/campaignAudience'
import { parseManualUserIds } from '../../lib/campaignEnrollment'
import { defaultChallengeConfig, suggestForPlayer, periodDates, num, FLAG_LABEL } from '../../lib/challengeEngine'
import { CampaignInfoButton } from './CampaignGuide'

const TIERS = ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE']
const COUNTRY_LABEL = { MY: '🇲🇾 MY', SG: '🇸🇬 SG', KH: '🇰🇭 KH' }
const input = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 9px', borderRadius: 7, boxSizing: 'border-box', fontSize: 13 }
const lbl = { fontSize: 10, color: 'var(--muted)', fontWeight: 800, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.3px' }
const btn = { background: 'var(--accent)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }
const sec = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 7, fontWeight: 700, cursor: 'pointer', fontSize: 12 }
const box = { border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginTop: 14 }
const rm = v => 'RM ' + Math.round(num(v)).toLocaleString('en-MY')
const NUMERIC_SKIP = ['mode', 'goal_metric', 'completion_type', 'streak_bonus_type']

function Field({ label, children, hint }) {
  return <div><div style={lbl}>{label}</div>{children}{hint && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{hint}</div>}</div>
}
function Chip({ active, onClick, children, color }) {
  return <button type="button" onClick={onClick} style={{ ...sec, padding: '5px 11px', borderColor: active ? (color || 'var(--accent)') : 'var(--border)', background: active ? 'rgba(255,106,0,.12)' : 'var(--surface2)', color: active ? (color || 'var(--text)') : 'var(--muted)' }}>{children}</button>
}

export function cleanChallengeConfig(cfg) {
  return Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, (typeof v === 'string' && v !== '' && !isNaN(v) && !NUMERIC_SKIP.includes(k)) ? Number(v) : v]))
}

// Rules editor — shared by the creator and the detail page "Edit rules"
export function ChallengeRulesEditor({ cfg, setCfg, days }) {
  const { lang } = useLanguage()
  const T = (en, zh) => L(lang, en, zh)
  const c = (k, v) => setCfg(f => ({ ...f, [k]: v }))
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px 14px' }}>
        <Field label={T('Upfront credit', '预先信用额')}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={!!cfg.credit_enabled} onChange={e => c('credit_enabled', e.target.checked)} />{T('Give credit first', '先发放信用额')}</label>
        </Field>
        {cfg.credit_enabled && <>
          <Field label={T('Default credit (RM)', '默认信用额 (RM)')}><input type="number" style={input} value={cfg.credit_default} onChange={e => c('credit_default', e.target.value)} /></Field>
          <Field label={T('Suggest % of 30d loss', '建议额 = 30天亏损 %')}><input type="number" step="0.5" style={input} value={cfg.credit_suggest_pct_of_loss} onChange={e => c('credit_suggest_pct_of_loss', e.target.value)} /></Field>
          <Field label={T('Max credit (RM)', '信用额上限 (RM)')}><input type="number" style={input} value={cfg.credit_cap} onChange={e => c('credit_cap', e.target.value)} /></Field>
        </>}
        <Field label={T('Goal', '任务目标')}>
          <select style={input} value={cfg.goal_metric} onChange={e => c('goal_metric', e.target.value)}>
            <option value="turnover">{T('Turnover', '流水')}</option>
            <option value="deposit">{T('Deposit', '存款')}</option>
            <option value="both">{T('Deposit + Turnover', '存款 + 流水')}</option>
          </select>
        </Field>
        {cfg.goal_metric !== 'deposit' && <Field label={T('Default turnover target', '默认流水目标')}><input type="number" style={input} value={cfg.target_turnover_default} onChange={e => c('target_turnover_default', e.target.value)} /></Field>}
        {cfg.goal_metric !== 'turnover' && <Field label={T('Default deposit target', '默认存款目标')}><input type="number" style={input} value={cfg.target_deposit_default} onChange={e => c('target_deposit_default', e.target.value)} /></Field>}
        <Field label={T('Personal target ×', '个人目标倍数')} hint={T('avg daily × days × this', '日均 × 天数 × 此倍数')}><input type="number" step="0.1" style={input} value={cfg.target_suggest_multiplier} onChange={e => c('target_suggest_multiplier', e.target.value)} /></Field>
        <Field label={T('When completed', '完成后奖励')}>
          <select style={input} value={cfg.completion_type} onChange={e => c('completion_type', e.target.value)}>
            <option value="review">{T('Review (suggest bonus)', '审核（系统建议奖金）')}</option>
            <option value="rebate_pct">{T('Rebate % of turnover', '按流水返水%')}</option>
            <option value="fixed">{T('Fixed amount', '固定金额')}</option>
            <option value="none">{T('No reward', '无奖励')}</option>
          </select>
        </Field>
        {(cfg.completion_type === 'review' || cfg.completion_type === 'rebate_pct') && <Field label={cfg.completion_type === 'review' ? T('Suggested bonus % of turnover', '建议奖金 = 流水 %') : T('Rebate % of turnover', '返水 = 流水 %')}><input type="number" step="0.05" style={input} value={cfg.completion_pct} onChange={e => c('completion_pct', e.target.value)} /></Field>}
        {cfg.completion_type === 'fixed' && <Field label={T('Fixed reward (RM)', '固定奖励 (RM)')}><input type="number" style={input} value={cfg.completion_fixed} onChange={e => c('completion_fixed', e.target.value)} /></Field>}
        {cfg.completion_type !== 'none' && <Field label={T('Reward cap (RM)', '奖励上限 (RM)')}><input type="number" style={input} value={cfg.completion_cap} onChange={e => c('completion_cap', e.target.value)} /></Field>}
      </div>
      <div style={{ borderTop: '1px dashed var(--border)', marginTop: 12, paddingTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px 14px' }}>
        <Field label={T('Streak bonus', '连续奖励')}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={!!cfg.streak_enabled} onChange={e => c('streak_enabled', e.target.checked)} />{T('Enable', '启用')}</label>
        </Field>
        {cfg.streak_enabled && <>
          <Field label={T('Min deposit days', '最少存款天数')} hint={T(`out of ${days} days`, `共 ${days} 天中`)}><input type="number" min="1" max={days} style={input} value={cfg.streak_min_days} onChange={e => c('streak_min_days', e.target.value)} /></Field>
          <Field label={T('Min deposit per day (RM)', '每日最低存款 (RM)')}><input type="number" style={input} value={cfg.streak_min_daily_deposit} onChange={e => c('streak_min_daily_deposit', e.target.value)} /></Field>
          <Field label={T('Bonus type', '奖励方式')}>
            <select style={input} value={cfg.streak_bonus_type} onChange={e => c('streak_bonus_type', e.target.value)}>
              <option value="fixed">{T('Fixed amount', '固定金额')}</option>
              <option value="pct">{T('% of period deposits', '期内存款 %')}</option>
            </select>
          </Field>
          {cfg.streak_bonus_type === 'fixed'
            ? <Field label={T('Streak bonus (RM)', '连续奖励 (RM)')}><input type="number" style={input} value={cfg.streak_bonus_fixed} onChange={e => c('streak_bonus_fixed', e.target.value)} /></Field>
            : <Field label={T('Streak bonus %', '连续奖励 %')}><input type="number" step="0.1" style={input} value={cfg.streak_bonus_pct} onChange={e => c('streak_bonus_pct', e.target.value)} /></Field>}
          <Field label={T('Streak cap (RM)', '连续奖励上限 (RM)')}><input type="number" style={input} value={cfg.streak_bonus_cap} onChange={e => c('streak_bonus_cap', e.target.value)} /></Field>
          <div style={{ gridColumn: 'span 2', fontSize: 11, color: 'var(--muted)', alignSelf: 'end' }}>
            {T(`Rule: deposit ≥ RM ${num(cfg.streak_min_daily_deposit).toLocaleString()} on at least ${cfg.streak_min_days} of ${days} days.`, `规则：${days} 天中至少 ${cfg.streak_min_days} 天每日存款 ≥ RM ${num(cfg.streak_min_daily_deposit).toLocaleString()}。`)}
          </div>
        </>}
      </div>
    </div>
  )
}

export default function ChallengeCreator({ mode = 'trust_credit', onCancel, onCreated }) {
  const { lang } = useLanguage()
  const T = (en, zh) => L(lang, en, zh)
  const trust = mode === 'trust_credit'

  const today = new Date().toISOString().slice(0, 10)
  const plus6 = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10)
  const [meta, setMeta] = useState({ campaign_name: '', campaign_code: '', start_date: today, end_date: plus6, status: 'active', budget_rm: '' })
  const [cfg, setCfg] = useState(() => defaultChallengeConfig(mode))

  // audience data
  const [members, setMembers] = useState([])
  const [stats, setStats] = useState({})
  const [segs, setSegs] = useState({})
  const [busy, setBusy] = useState({})     // username -> active campaign names
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  // filters
  const [countries, setCountries] = useState(['MY'])
  const [tiers, setTiers] = useState(trust ? ['PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK'] : ['GOLD', 'PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK'])
  const [segF, setSegF] = useState(trust ? ['Silent', 'Declining'] : [])
  const [hostF, setHostF] = useState('ALL')
  const [affF, setAffF] = useState('ALL')
  const [minLoss, setMinLoss] = useState(trust ? '20000' : '')
  const [minTurnover, setMinTurnover] = useState(trust ? '' : '10000')
  const [hideFlagged, setHideFlagged] = useState(false)
  const [hideBusy, setHideBusy] = useState(true)
  const [manual, setManual] = useState('')
  const [search, setSearch] = useState('')

  // selection + per-player overrides
  const [picked, setPicked] = useState(new Set())
  const [over, setOver] = useState({})   // username -> { credit, targetTurnover, targetDeposit }

  useEffect(() => { setCfg(defaultChallengeConfig(mode)) }, [mode])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const [mem, st, pr, act] = await Promise.all([
          fetchAll(() => supabase.from('vip_members').select('id,username,full_name,tier,currency,phone,whatsapp,host_assigned,affiliate_login,is_excluded').order('username')),
          fetchAll(() => supabase.from('v_vip_recent_stats').select('*').order('username')),
          fetchAll(() => supabase.from('v_vip_deposit_profile').select('login,segment').order('login')),
          supabase.from('campaigns').select('id,campaign_name').eq('status', 'active'),
        ])
        const sm = {}; st.forEach(r => { sm[r.username] = r })
        const pm = {}; pr.forEach(r => { pm[r.login] = r.segment })
        const bm = {}
        const ids = (act.data || []).map(x => x.id)
        if (ids.length) {
          const names = Object.fromEntries((act.data || []).map(x => [x.id, x.campaign_name]))
          const cp = await fetchAll(() => supabase.from('campaign_players').select('username,campaign_id').in('campaign_id', ids).order('username'))
          cp.forEach(r => { (bm[r.username] = bm[r.username] || []).push(names[r.campaign_id]) })
        }
        if (cancel) return
        setMembers(mem.filter(m => !m.is_excluded)); setStats(sm); setSegs(pm); setBusy(bm)
      } catch (e) { if (!cancel) setMsg('Load error: ' + (e.message || e)) }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [])

  const days = periodDates(meta.start_date, meta.end_date).length || 1
  const hosts = useMemo(() => [...new Set(members.map(m => m.host_assigned).filter(Boolean))].sort(), [members])
  const affs = useMemo(() => [...new Set(members.map(m => m.affiliate_login).filter(Boolean))].sort(), [members])
  const manualIds = useMemo(() => parseManualUserIds(manual).map(x => x.toLowerCase()), [manual])

  const rows = useMemo(() => {
    return members.map(m => {
      const s = stats[m.username]
      const sug = suggestForPlayer(s, cfg, days)
      const o = over[m.username] || {}
      return {
        ...m, stats: s, segment: segs[m.username] || 'No deposits', sug,
        credit: o.credit ?? sug.credit, targetTurnover: o.targetTurnover ?? sug.targetTurnover, targetDeposit: o.targetDeposit ?? sug.targetDeposit,
        busyIn: busy[m.username] || [], manual: manualIds.includes(m.username.toLowerCase()),
      }
    }).filter(r => {
      if (r.manual) return true // manual IDs bypass filters
      if (countries.length && !countries.includes(countryFromPlayer(r))) return false
      if (tiers.length && !tiers.includes(String(r.tier || '').toUpperCase())) return false
      if (segF.length && !segF.includes(r.segment)) return false
      if (hostF !== 'ALL' && (hostF === '__none' ? r.host_assigned : r.host_assigned !== hostF)) return false
      if (affF !== 'ALL' && (affF === '__direct' ? r.affiliate_login : r.affiliate_login !== affF)) return false
      if (num(minLoss) > 0 && r.sug.loss30 < num(minLoss)) return false
      if (num(minTurnover) > 0 && r.sug.avgDailyTurnover < num(minTurnover)) return false
      if (hideFlagged && r.sug.flags.length) return false
      if (hideBusy && r.busyIn.length) return false
      if (search && !(r.username.toLowerCase().includes(search.toLowerCase()) || (r.full_name || '').toLowerCase().includes(search.toLowerCase()))) return false
      return true
    }).sort((a, b) => (b.manual - a.manual) || (trust ? b.sug.loss30 - a.sug.loss30 : b.sug.avgDailyTurnover - a.sug.avgDailyTurnover))
  }, [members, stats, segs, busy, cfg, days, over, countries, tiers, segF, hostF, affF, minLoss, minTurnover, hideFlagged, hideBusy, manualIds, search, trust])

  const pickedRows = rows.filter(r => picked.has(r.username))
  const hiddenPicked = picked.size - pickedRows.length
  const missingManual = manualIds.filter(id => !members.some(m => m.username.toLowerCase() === id))
  const estCredit = pickedRows.reduce((s, r) => s + (cfg.credit_enabled ? num(r.credit) : 0), 0)

  function toggle(u) { setPicked(p => { const n = new Set(p); n.has(u) ? n.delete(u) : n.add(u); return n }) }
  function pickAll() { setPicked(p => { const n = new Set(p); rows.slice(0, 500).forEach(r => n.add(r.username)); return n }) }
  function clearAll() { setPicked(new Set()) }
  function setOv(u, k, v) { setOver(o => ({ ...o, [u]: { ...(o[u] || {}), [k]: v } })) }
  function toggleList(list, set, v) { set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]) }

  async function create() {
    if (!meta.campaign_name.trim()) return setMsg(T('Campaign name is required.', '请填写活动名称。'))
    if (!meta.start_date || !meta.end_date || meta.end_date < meta.start_date) return setMsg(T('Please set a valid start and end date.', '请设定有效的开始与结束日期。'))
    if (!pickedRows.length) return setMsg(T('Select at least one player (only players visible in the list are enrolled).', '请至少选择一位玩家（只有列表中显示的玩家会被加入）。'))
    setSaving(true); setMsg('')
    try {
      const code = meta.campaign_code.trim() || meta.campaign_name.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 20)
      const cleanCfg = cleanChallengeConfig(cfg)
      const row = {
        campaign_type: 'challenge', campaign_name: meta.campaign_name.trim(), campaign_code: code,
        start_date: meta.start_date, end_date: meta.end_date, status: meta.status,
        budget_rm: meta.budget_rm ? Number(meta.budget_rm) : null,
        platform: countries.length === 1 ? countries[0] : 'BOTH', target_countries: countries, target_tier: tiers, auto_enroll_tiers: null,
        enrollment_mode: 'manual', challenge_config: cleanCfg, created_at: new Date().toISOString(),
        streak_enabled: false, requires_period_deposit: false,
        deposit_target: cfg.goal_metric !== 'turnover' ? num(cfg.target_deposit_default) : null,
        min_valid_bet: cfg.goal_metric !== 'deposit' ? num(cfg.target_turnover_default) : null,
        notes: trust ? 'Trust Credit Challenge 信任金挑战' : 'Rebate Challenge 返水挑战',
      }
      const { data: camp, error } = await supabase.from('campaigns').insert(row).select().single()
      if (error) throw error
      const now = new Date().toISOString()
      const players = pickedRows.map(r => ({
        campaign_id: camp.id, vip_id: r.id, username: r.username, tier: r.tier, player_name: r.full_name || null,
        whatsapp: r.whatsapp || r.phone || null, total_deposit: 0, campaign_period_deposit: 0, converted: false,
        payout_status: 'pending', streak_payout_status: 'pending', status: 'enrolled',
        enrollment_source: r.manual ? 'manual' : 'tier', added_at: now, enrolled_at: now,
        ch_credit: cfg.credit_enabled ? num(r.credit) : null, ch_credit_status: cfg.credit_enabled ? 'pending' : 'none',
        ch_target_turnover: num(r.targetTurnover), ch_target_deposit: num(r.targetDeposit),
        ch_baseline: { loss_30d: r.sug.loss30, avg_daily_turnover_30d: r.sug.avgDailyTurnover, dep_30d: num(r.stats?.dep_30d), segment: r.segment, flags: r.sug.flags, as_of: r.stats?.data_as_of || null },
      }))
      for (let i = 0; i < players.length; i += 200) {
        const { error: pe } = await supabase.from('campaign_players').upsert(players.slice(i, i + 200), { onConflict: 'campaign_id,username' })
        if (pe) throw pe
      }
      onCreated && onCreated(camp, players.length)
    } catch (e) { setMsg(T('Create failed: ', '创建失败：') + (e.message || e)) }
    setSaving(false)
  }

  const th = { textAlign: 'left', padding: '7px 8px', color: 'var(--muted)', fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
  const td = { padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 12 }
  const small = { ...input, padding: '4px 6px', fontSize: 12, width: 100 }

  return (
    <div>
      {/* mode banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: trust ? 'rgba(244,114,182,.10)' : 'rgba(34,211,238,.10)', border: `1px solid ${trust ? '#f472b6' : '#22d3ee'}55` }}>
        <div style={{ fontSize: 22 }}>{trust ? '💝' : '💰'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800 }}>{trust ? T('Trust Credit Challenge', '信任金挑战') : T('Rebate Challenge', '返水挑战')}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trust
            ? T('Give credit first → personal turnover task → you approve a bonus when completed · optional daily-deposit streak bonus.', '先给信用额 → 个人流水任务 → 完成后由你审核奖金 · 可选每日存款连续奖励。')
            : T('Reach deposit / turnover target → rebate % of turnover · optional daily-deposit streak bonus.', '达成存款 / 流水目标 → 按流水返水% · 可选每日存款连续奖励。')}</div>
        </div>
        <CampaignInfoButton typeKey={trust ? 'challenge_trust' : 'challenge_rebate'} size={20} />
      </div>

      {/* basics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 14px', marginTop: 14 }}>
        <Field label={T('Campaign name *', '活动名称 *')}><input style={input} value={meta.campaign_name} onChange={e => setMeta(m => ({ ...m, campaign_name: e.target.value }))} /></Field>
        <Field label={T('Campaign code', '活动代码')}><input style={input} value={meta.campaign_code} onChange={e => setMeta(m => ({ ...m, campaign_code: e.target.value.toUpperCase() }))} /></Field>
        <Field label={T('Status', '状态')}><select style={input} value={meta.status} onChange={e => setMeta(m => ({ ...m, status: e.target.value }))}>{['draft', 'active', 'paused', 'ended'].map(x => <option key={x} value={x}>{x}</option>)}</select></Field>
        <Field label={T('Start date *', '开始日期 *')}><input type="date" style={input} value={meta.start_date} onChange={e => setMeta(m => ({ ...m, start_date: e.target.value }))} /></Field>
        <Field label={T('End date *', '结束日期 *')} hint={T(`${days} day(s)`, `共 ${days} 天`)}><input type="date" style={input} value={meta.end_date} onChange={e => setMeta(m => ({ ...m, end_date: e.target.value }))} /></Field>
        <Field label={T('Budget (RM)', '预算 (RM)')}><input type="number" style={input} value={meta.budget_rm} onChange={e => setMeta(m => ({ ...m, budget_rm: e.target.value }))} /></Field>
      </div>

      {/* rules */}
      <div style={box}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>⚙️ {T('Rules', '活动规则')}</div>
        <ChallengeRulesEditor cfg={cfg} setCfg={setCfg} days={days} />
      </div>

      {/* audience filters */}
      <div style={box}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>👥 {T('Target audience', '目标受众')} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>{T('— uses 30-day CRM data (loss, turnover, segment, host, affiliate)', '— 使用近30天CRM数据（亏损、流水、分群、负责人、代理）')}</span></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {CAMPAIGN_COUNTRIES.map(x => <Chip key={x} active={countries.includes(x)} onClick={() => toggleList(countries, setCountries, x)}>{COUNTRY_LABEL[x]}</Chip>)}
          <span style={{ width: 10 }} />
          {TIERS.map(x => <Chip key={x} active={tiers.includes(x)} onClick={() => toggleList(tiers, setTiers, x)}>{x}</Chip>)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[...Object.keys(SEGMENTS), 'No deposits'].map(k => <Chip key={k} color={SEGMENTS[k]?.color} active={segF.includes(k)} onClick={() => toggleList(segF, setSegF, k)}>{SEGMENTS[k] ? `${SEGMENTS[k].icon} ${lang === 'zh' ? SEGMENTS[k].zh : k}` : T('No deposits', '无存款')}</Chip>)}
          <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>{segF.length ? '' : T('(all segments)', '（全部分群）')}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px 14px' }}>
          <Field label={T('Host', '负责人')}><select style={input} value={hostF} onChange={e => setHostF(e.target.value)}><option value="ALL">{T('All hosts', '全部')}</option><option value="__none">{T('(No host)', '（无负责人）')}</option>{hosts.map(h => <option key={h}>{h}</option>)}</select></Field>
          <Field label={T('Affiliate', '代理')}><select style={input} value={affF} onChange={e => setAffF(e.target.value)}><option value="ALL">{T('All', '全部')}</option><option value="__direct">{T('Direct / unknown', '直客 / 未知')}</option>{affs.map(a => <option key={a}>{a}</option>)}</select></Field>
          <Field label={T('Min 30-day net loss (RM)', '30天最低净亏损 (RM)')}><input type="number" style={input} value={minLoss} onChange={e => setMinLoss(e.target.value)} placeholder="0" /></Field>
          <Field label={T('Min avg daily turnover', '最低日均流水')}><input type="number" style={input} value={minTurnover} onChange={e => setMinTurnover(e.target.value)} placeholder="0" /></Field>
          <Field label={T('Search', '搜索')}><input style={input} value={search} onChange={e => setSearch(e.target.value)} placeholder={T('username / name', '用户名 / 姓名')} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={hideBusy} onChange={e => setHideBusy(e.target.checked)} />{T('Hide players already in an active campaign', '隐藏已在进行中活动的玩家')}</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={hideFlagged} onChange={e => setHideFlagged(e.target.checked)} />{T('Hide ⚠️ escalation-flagged players', '隐藏有 ⚠️ 失控迹象的玩家')}</label>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={lbl}>{T('Manual user IDs (bypass filters)', '手动用户ID（不受筛选限制）')}</div>
          <textarea style={{ ...input, minHeight: 44, resize: 'vertical', fontFamily: 'inherit' }} value={manual} onChange={e => setManual(e.target.value)} placeholder={T('One per line or comma-separated', '每行一个或用逗号分隔')} />
          {missingManual.length > 0 && <div style={{ fontSize: 11, color: '#f87171', marginTop: 3 }}>{T('Not found: ', '找不到：')}{missingManual.join(', ')}</div>}
        </div>
      </div>

      {/* audience table */}
      <div style={{ ...box, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800 }}>{T('Matching players', '符合条件的玩家')}: {loading ? '…' : rows.length}</div>
          <button type="button" style={sec} onClick={pickAll}>{T('Select all shown', '全选显示中的')}</button>
          <button type="button" style={sec} onClick={clearAll}>{T('Clear selection', '清除选择')}</button>
          <div style={{ marginLeft: 'auto', fontSize: 12 }}>
            <b style={{ color: 'var(--accent)' }}>{pickedRows.length}</b> {T('selected', '已选')}
            {hiddenPicked > 0 && <span style={{ color: 'var(--muted)' }}> ({T(`${hiddenPicked} hidden by filters, not enrolled`, `${hiddenPicked} 位被筛选隐藏，不会加入`)})</span>}
            {cfg.credit_enabled && <> · {T('Credit to give', '需发放信用额')}: <b>{rm(estCredit)}</b></>}
          </div>
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}></th><th style={th}>VIP</th><th style={th}>{T('Tier', '等级')}</th><th style={th}>{T('Host', '负责人')}</th><th style={th}>{T('Affiliate', '代理')}</th>
              <th style={th}>{T('Segment', '分群')}</th><th style={{ ...th, textAlign: 'right' }}>{T('30d net loss', '30天净亏损')}</th><th style={{ ...th, textAlign: 'right' }}>{T('Avg daily turnover', '日均流水')}</th>
              {cfg.credit_enabled && <th style={th}>{T('Credit', '信用额')}</th>}
              {cfg.goal_metric !== 'deposit' && <th style={th}>{T('Turnover target', '流水目标')}</th>}
              {cfg.goal_metric !== 'turnover' && <th style={th}>{T('Deposit target', '存款目标')}</th>}
              <th style={th}>{T('Notes', '备注')}</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={12} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>{T('Loading CRM data…', '载入CRM数据中…')}</td></tr>
                : rows.length === 0 ? <tr><td colSpan={12} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--muted)' }}>{T('No players match these filters.', '没有符合条件的玩家。')}</td></tr>
                : rows.slice(0, 500).map(r => {
                  const on = picked.has(r.username)
                  const seg = SEGMENTS[r.segment]
                  return (
                    <tr key={r.username} style={{ background: on ? 'rgba(255,106,0,.06)' : 'transparent' }}>
                      <td style={td}><input type="checkbox" checked={on} onChange={() => toggle(r.username)} /></td>
                      <td style={td}><b>{r.username}</b>{r.manual && <span style={{ fontSize: 10, color: '#a78bfa', marginLeft: 4 }}>{T('manual', '手动')}</span>}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.full_name}</div></td>
                      <td style={td}>{r.tier}</td>
                      <td style={td}>{r.host_assigned || '—'}</td>
                      <td style={{ ...td, color: r.affiliate_login ? 'var(--accent)' : 'var(--muted)' }}>{r.affiliate_login || T('Direct', '直客')}</td>
                      <td style={td}>{seg ? <span style={{ color: seg.color, fontWeight: 700 }}>{seg.icon} {lang === 'zh' ? seg.zh : r.segment}</span> : <span style={{ color: 'var(--muted)' }}>{T('No deposits', '无存款')}</span>}</td>
                      <td style={{ ...td, textAlign: 'right', color: r.sug.loss30 > 0 ? '#f87171' : 'var(--muted)' }}>{r.sug.loss30 > 0 ? rm(r.sug.loss30) : '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.sug.avgDailyTurnover > 0 ? rm(r.sug.avgDailyTurnover) : '—'}</td>
                      {cfg.credit_enabled && <td style={td}><input type="number" style={small} value={r.credit} onChange={e => setOv(r.username, 'credit', e.target.value)} /></td>}
                      {cfg.goal_metric !== 'deposit' && <td style={td}><input type="number" style={{ ...small, width: 110 }} value={r.targetTurnover} onChange={e => setOv(r.username, 'targetTurnover', e.target.value)} /></td>}
                      {cfg.goal_metric !== 'turnover' && <td style={td}><input type="number" style={small} value={r.targetDeposit} onChange={e => setOv(r.username, 'targetDeposit', e.target.value)} /></td>}
                      <td style={{ ...td, fontSize: 11 }}>
                        {r.sug.flags.map(f => <div key={f} style={{ color: '#fbbf24' }}>⚠️ {lang === 'zh' ? FLAG_LABEL[f].zh : FLAG_LABEL[f].en}</div>)}
                        {r.busyIn.length > 0 && <div style={{ color: 'var(--muted)' }}>📣 {T('In', '已参加')}: {r.busyIn.join(', ')}</div>}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          {rows.length > 500 && <div style={{ padding: 8, fontSize: 11, color: 'var(--muted)' }}>{T('Showing first 500 — narrow the filters.', '仅显示前500位 — 请缩小筛选范围。')}</div>}
        </div>
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
          {T('Suggested credit = 30-day net loss × %, capped. Suggested target = average daily turnover (last 30 days) × campaign days × multiplier. Edit any value before creating.',
             '建议信用额 = 30天净亏损 × %（有上限）。建议目标 = 近30天日均流水 × 活动天数 × 倍数。创建前可修改任何数值。')}
        </div>
      </div>

      {msg && <div style={{ marginTop: 10, fontSize: 12, color: '#f87171' }}>{msg}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button type="button" style={{ ...sec, padding: '8px 14px' }} onClick={onCancel}>{T('Cancel', '取消')}</button>
        <button type="button" style={btn} disabled={saving} onClick={create}>{saving ? T('Creating…', '创建中…') : T(`Create & enroll ${pickedRows.length} players`, `创建并加入 ${pickedRows.length} 位玩家`)}</button>
      </div>
    </div>
  )
}
