// ExportPage.jsx — CSV exports for building the monthly report deck elsewhere
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatMoney, currentYearMonth, prevYearMonth, fmtMonthLabel, pctChange } from '../lib/format'
import { CURRENCY_LIST_MAIN, CURRENCY_SYMBOL, CURRENCY_REGION, REGION_LABEL } from '../lib/constants'
import { useLanguage } from '../contexts/LanguageContext'
import { useUrlParam } from '../hooks/useUrlParam'
import * as XLSX from 'xlsx'

// ── Helpers ──────────────────────────────────────────────────────────────────
// Legacy MY-only formatter, kept for spots that are already known to be MY-scoped.
const fmt = (n) => formatMoney(n, 'MYR')

// MYR and SGD must never be summed into one number. Build a username→currency
// lookup (from a vip_members-derived list that already carries `currency`),
// then sum rows into { MYR, SGD } instead of one mixed total.
function currencyLookup(vips) {
  const map = {}
  ;(vips || []).forEach(v => { map[v.username] = v.currency || 'MYR' })
  return map
}
function sumByCurrency(rows, lookup, getUsername, getAmount) {
  const totals = { MYR: 0, SGD: 0, KHUSD: 0 }
  ;(rows || []).forEach(r => {
    const cur = lookup[getUsername(r)] || 'MYR'
    totals[cur] = (totals[cur] || 0) + (parseFloat(getAmount(r)) || 0)
  })
  return totals
}
// One combined display string for a { MYR, SGD, KHUSD } total — used anywhere a
// single previously-mixed "RM X" figure needs to become real per-currency numbers.
// Cambodia is omitted from the string when zero, since most months have no KH data.
const fmtSplit = (totals) => {
  const parts = [formatMoney(totals.MYR, 'MYR'), formatMoney(totals.SGD, 'SGD')]
  if (totals.KHUSD) parts.push(formatMoney(totals.KHUSD, 'KHUSD'))
  return parts.join(' · ')
}


function downloadCSV(rows, filename) {
  if (!rows || rows.length === 0) return alert('No data to export.')
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const val = r[h] ?? ''
      const str = String(val).replace(/"/g, '""')
      return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str
    }).join(','))
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = {
  page:    { padding:'28px 32px', maxWidth:900, margin:'0 auto', color:'var(--text)' },
  heading: { fontSize:22, fontWeight:700, marginBottom:4 },
  sub:     { fontSize:13, color:'var(--muted)', marginBottom:28 },
  card:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'22px 24px', marginBottom:16 },
  cardHdr: { display:'flex', alignItems:'center', gap:12, marginBottom:16 },
  badge:   (c) => ({ background:c, color:'#fff', fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:20 }),
  title:   { fontSize:15, fontWeight:600 },
  desc:    { fontSize:12, color:'var(--muted)', marginTop:2 },
  row:     { display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:10 },
  label:   { fontSize:12, color:'var(--muted)', minWidth:100 },
  input:   { padding:'6px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13 },
  btn:     (c='var(--accent)', disabled=false) => ({
    padding:'8px 18px', borderRadius:7, border:'none',
    background: disabled ? 'var(--border)' : c,
    color: disabled ? 'var(--muted)' : '#fff',
    fontWeight:600, fontSize:13, cursor: disabled ? 'not-allowed' : 'pointer',
  }),
  btnSm:   (c='var(--accent)') => ({ padding:'6px 14px', borderRadius:6, border:'none', background:c, color:'#fff', fontWeight:600, fontSize:12, cursor:'pointer' }),
  divider: { border:'none', borderTop:'1px solid var(--border)', margin:'24px 0' },
  progress:{ fontSize:12, color:'var(--muted)', marginTop:8, fontStyle:'italic' },
  log:     { background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, padding:'12px 14px', marginTop:12, fontSize:12, color:'var(--muted)', maxHeight:200, overflowY:'auto', fontFamily:'monospace', lineHeight:1.6 },
}

// ── CSV EXPORT SECTION ────────────────────────────────────────────────────────
function CSVExportCard({ icon, title, desc, color, onExport, loading }) {
  return (
    <div style={{ ...s.card, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:14 }}>
        <span style={{ fontSize:28 }}>{icon}</span>
        <div>
          <div style={s.title}>{title}</div>
          <div style={s.desc}>{desc}</div>
        </div>
      </div>
      <button style={s.btn(color, loading)} disabled={loading} onClick={onExport}>
        {loading ? 'Exporting…' : '⬇ Export CSV'}
      </button>
    </div>
  )
}

export default function ExportPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [exportMonth, setExportMonth] = useUrlParam('month', currentYearMonth())
  const [loadingCSV, setLoadingCSV]   = useState({})
  const [mailingImporting, setMailingImporting] = useState(false)
  const [mailingResult, setMailingResult] = useState(null)
  const [dateFrom,   setDateFrom]     = useState('')
  const [dateTo,     setDateTo]       = useState('')
  const [hosts,      setHosts]         = useState([])
  const [selectedHost, setSelectedHost] = useState('')

  useEffect(() => {
    async function loadHosts() {
      const { data } = await supabase.from('profiles').select('full_name').in('role',['admin','host']).order('full_name')
      setHosts((data||[]).map(h => h.full_name).filter(Boolean))
    }
    loadHosts()
  }, [])

  // ── CSV EXPORTERS ──────────────────────────────────────────────────────────
  async function exportVIPs() {
    setLoadingCSV(p => ({...p, vip:true}))
    const { data } = await supabase.from('vip_members').select('*').order('tier').order('username')
    const vips = data || []

    // Merge accumulated month-to-date totals (vip_members.monthly_valid_bet/total_deposit
    // are now just the last uploaded day's numbers, since CSV uploads happen daily)
    // NOTE: don't filter with .in('username', usernames) — exporting all VIPs means 400+
    // usernames, which can exceed URL length limits. Fetch the whole month instead.
    let totalsMap = {}
    if (vips.length > 0) {
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      const { data: totals, error: totalsErr } = await supabase
        .from('vip_monthly_totals')
        .select('username, total_deposit, monthly_valid_bet')
        .eq('snapshot_month', currentMonth)
      if (totalsErr) console.error('exportVIPs: vip_monthly_totals fetch error', totalsErr)
      ;(totals||[]).forEach(t => { totalsMap[t.username] = t })
    }

    downloadCSV(vips.map(v => ({
      username:           v.username,
      full_name:          v.full_name,
      tier:               v.tier,
      monthly_valid_bet:  totalsMap[v.username]?.monthly_valid_bet ?? v.monthly_valid_bet,
      valid_bet_month:    v.valid_bet_month,
      total_deposit:      totalsMap[v.username]?.total_deposit ?? v.total_deposit,
      total_withdrawal:   v.total_withdrawal,
      total_rebate:       v.total_rebate,
      last_deposit_date:  v.last_deposit_date,
      days_inactive:      v.days_inactive,
      registration_date:  v.registration_date,
      host_assigned:      v.host_assigned,
      region:             v.region,
      currency:           v.currency,
      birthday:           v.birthday,
      city:               v.city,
      notes:              v.notes,
    })), `VIP_Members_${new Date().toISOString().slice(0,10)}.csv`)
    setLoadingCSV(p => ({...p, vip:false}))
  }

  async function exportMailingList() {
    setLoadingCSV(p => ({...p, mailing:true}))
    // Wildcard select — deliberately not naming email/address/race explicitly.
    // Those columns may not exist in this database yet; a wildcard select never
    // errors on that, it just won't include a key that isn't there, and
    // v.email/v.address/v.race below simply come back undefined → blank cell.
    // Works correctly whether the columns exist-but-empty or don't exist at all.
    const { data, error } = await supabase.from('vip_members').select('*').order('tier').order('username')
    if (error) { alert('Export failed: ' + error.message); setLoadingCSV(p => ({...p, mailing:false})); return }
    const vips = data || []
    downloadCSV(vips.map(v => ({
      Tier:     v.tier || '',
      Username: v.username || '',
      Name:     v.full_name || '',
      Phone:    v.phone || '',
      Email:    v.email || '',
      Address:  v.address || '',
      Race:     v.race || '',
    })), `VIP_Mailing_List_${new Date().toISOString().slice(0,10)}.csv`)
    setLoadingCSV(p => ({...p, mailing:false}))
  }

  async function importMailingList(file) {
    if (!file) return
    setMailingImporting(true)
    setMailingResult(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      let updated = 0, skippedBlank = 0, notFound = 0, errors = 0
      const notFoundUsernames = []

      for (const row of rows) {
        // Tolerate minor header casing/whitespace differences without silently
        // matching the wrong column.
        const get = (key) => {
          const k = Object.keys(row).find(rk => rk.trim().toLowerCase() === key.toLowerCase())
          return k ? String(row[k]).trim() : ''
        }
        const username = get('Username')
        if (!username) continue

        const name = get('Name')
        const email = get('Email')
        const address = get('Address')
        const race = get('Race')

        const payload = {}
        // '(Name)' is the literal placeholder our own export uses for a blank
        // name — never write that string into the database as if it were real.
        if (name && name !== '(Name)') payload.full_name = name
        if (email) payload.email = email
        if (address) payload.address = address
        if (race) payload.race = race
        // Phone is deliberately never included here — it's corrupted by Excel's
        // number auto-formatting in this file, and already correctly maintained
        // by the regular CSV import from platform data. Touching it here risks
        // overwriting a good number with a mangled one.

        if (Object.keys(payload).length === 0) { skippedBlank++; continue }

        const { data: existing, error: findErr } = await supabase
          .from('vip_members').select('id').eq('username', username).maybeSingle()
        if (findErr) { errors++; continue }
        if (!existing) { notFound++; notFoundUsernames.push(username); continue }

        const { error: updateErr } = await supabase.from('vip_members').update(payload).eq('id', existing.id)
        if (updateErr) {
          errors++
          console.error(`importMailingList: update failed for ${username}`, updateErr)
        } else {
          updated++
        }
      }

      setMailingResult({ total: rows.length, updated, skippedBlank, notFound, errors, notFoundUsernames })
    } catch (e) {
      alert('Import failed: ' + e.message)
    } finally {
      setMailingImporting(false)
    }
  }

  async function exportContacts() {
    setLoadingCSV(p => ({...p, contacts:true}))
    let q = supabase.from('contact_logs').select('*').order('logged_at', { ascending:false })
    if (dateFrom) q = q.gte('logged_at', dateFrom)
    if (dateTo)   q = q.lte('logged_at', dateTo + 'T23:59:59')
    const { data } = await q
    downloadCSV((data||[]).map(l => ({
      username:      l.username,
      tier:          l.tier,
      channel:       l.channel,
      outcome:       l.outcome,
      notes:         l.notes,
      bonus_offered: l.bonus_offered,
      bonus_type:    l.bonus_type,
      host_name:     l.host_name,
      logged_at:     l.logged_at,
      log_month:     l.log_month,
    })), `Contact_Logs_${new Date().toISOString().slice(0,10)}.csv`)
    setLoadingCSV(p => ({...p, contacts:false}))
  }

  async function exportUpgrades() {
    setLoadingCSV(p => ({...p, upgrades:true}))
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`

    const { data: vips } = await supabase.from('vip_members').select('username,tier,last_deposit_date,host_assigned').in('tier',['GOLD','PLATINUM'])
    const { data: pots } = await supabase.from('potential_players').select('*').eq('upgrade_flag',true).eq('is_graduated',false)

    // NOTE: don't filter with .in('username', ...) — GOLD/PLATINUM VIPs can be 400+, and flagged
    // potentials can run into the thousands, both of which can exceed URL length limits.
    // Fetch the whole month's totals instead and join client-side.
    const [{ data: vipTotals, error: vipTotalsErr }, { data: potTotals, error: potTotalsErr }] = await Promise.all([
      supabase.from('vip_monthly_totals').select('username, monthly_valid_bet').eq('snapshot_month', currentMonth),
      supabase.from('potential_monthly_totals').select('username, monthly_valid_bet').eq('snapshot_month', currentMonth),
    ])
    if (vipTotalsErr) console.error('exportUpgrades: vip_monthly_totals fetch error', vipTotalsErr)
    if (potTotalsErr) console.error('exportUpgrades: potential_monthly_totals fetch error', potTotalsErr)
    const vipTotalsMap = {}; (vipTotals||[]).forEach(t => { vipTotalsMap[t.username] = t.monthly_valid_bet })
    const potTotalsMap = {}; (potTotals||[]).forEach(t => { potTotalsMap[t.username] = t.monthly_valid_bet })

    const combined = [
      ...(vips||[]).map(v=>({ type:'VIP', ...v, monthly_valid_bet: vipTotalsMap[v.username] ?? 0, valid_bet_month: currentMonth }))
        .sort((a,b)=>(b.monthly_valid_bet||0)-(a.monthly_valid_bet||0)),
      ...(pots||[]).map(p=>({ type:'POTENTIAL', username:p.username, tier:p.tier, monthly_valid_bet:potTotalsMap[p.username] ?? 0, valid_bet_month: currentMonth, last_deposit_date:p.registration_date, host_assigned:p.host_assigned||'-' }))
        .sort((a,b)=>(b.monthly_valid_bet||0)-(a.monthly_valid_bet||0)),
    ]
    downloadCSV(combined, `Upgrades_Flagged_${new Date().toISOString().slice(0,10)}.csv`)
    setLoadingCSV(p => ({...p, upgrades:false}))
  }

  async function exportBirthdays() {
    setLoadingCSV(p => ({...p, birthdays:true}))
    const { data: vips } = await supabase.from('vip_members').select('username,full_name,tier,birthday,host_assigned').not('birthday','is',null).order('birthday')
    const { data: gifts } = await supabase.from('gift_logs').select('*').order('created_at', { ascending:false })
    const giftMap = {}
    ;(gifts||[]).forEach(g => { if (!giftMap[g.vip_id]) giftMap[g.vip_id] = g })
    downloadCSV((vips||[]).map(v => ({
      username:     v.username,
      full_name:    v.full_name,
      tier:         v.tier,
      birthday:     v.birthday,
      host_assigned:v.host_assigned,
      last_gift:    giftMap[v.id]?.gift_type || '-',
      last_gift_cost:giftMap[v.id]?.gift_cost || '-',
    })), `Birthday_Gift_Logs_${new Date().toISOString().slice(0,10)}.csv`)
    setLoadingCSV(p => ({...p, birthdays:false}))
  }

  async function exportByHost(hostName) {
    if (!hostName) return
    setLoadingCSV(p => ({...p, byHost:true}))
    const { data } = await supabase
      .from('vip_members')
      .select('username, full_name, tier, last_deposit_date, phone, host_assigned, region, currency, days_inactive, birthday, notes')
      .eq('host_assigned', hostName)
      .eq('is_excluded', false)
      .order('tier').order('username')
    const vips = data || []

    let totalsMap = {}
    if (vips.length > 0) {
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      // NOTE: don't filter with .in('username', usernames) — a single host can have 300+
      // VIPs, which can exceed URL length limits. Fetch the whole month instead.
      const { data: totals, error: totalsErr } = await supabase
        .from('vip_monthly_totals')
        .select('username, total_deposit, monthly_valid_bet')
        .eq('snapshot_month', currentMonth)
      if (totalsErr) console.error('exportByHost: vip_monthly_totals fetch error', totalsErr)
      ;(totals||[]).forEach(t => { totalsMap[t.username] = t })
    }

    downloadCSV(vips.map(v => ({
      username:          v.username,
      full_name:         v.full_name || '',
      tier:              v.tier,
      last_deposit_date: v.last_deposit_date || '',
      phone:             v.phone || '',
      host_assigned:     v.host_assigned || '',
      region:            v.region || '',
      currency:          v.currency || '',
      days_inactive:     v.days_inactive ?? '',
      total_deposit:     totalsMap[v.username]?.total_deposit || 0,
      monthly_valid_bet: totalsMap[v.username]?.monthly_valid_bet || 0,
      birthday:          v.birthday || '',
      notes:             v.notes || '',
    })), `VIPs_${hostName}_${new Date().toISOString().slice(0,10)}.csv`)
    setLoadingCSV(p => ({...p, byHost:false}))
  }

  async function exportPlayerProfiling() {
    setLoadingCSV(p => ({...p, profiling:true}))

    // Determine active snapshot month (fallback if current month has no data yet)
    const now = new Date()
    const thisMonthPP = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    const { data: _ppCheck } = await supabase.from('vip_monthly_totals').select('snapshot_month').eq('snapshot_month', thisMonthPP).limit(1)
    const activeMonth = (_ppCheck && _ppCheck.length > 0) ? thisMonthPP : await (async () => {
      const { data: _ppLatest } = await supabase.from('vip_monthly_totals').select('snapshot_month').order('snapshot_month', { ascending: false }).limit(1)
      return _ppLatest?.[0]?.snapshot_month || thisMonthPP
    })()

    // Fetch accumulated monthly totals
    const { data: totals } = await supabase
      .from('vip_monthly_totals')
      .select('username, tier, monthly_valid_bet, win_loss, total_deposit, total_withdrawal, bet_count, bonus_count, bonus_amount, total_rebate, has_promo, currency')
      .eq('snapshot_month', activeMonth)
      .in('currency', ['MYR', 'SGD'])

    if (!totals || totals.length === 0) {
      alert(`No profiling data found for ${activeMonth}`)
      setLoadingCSV(p => ({...p, profiling:false}))
      return
    }

    // Fetch vip_members extras (host, days_inactive)
    const { data: extras } = await supabase
      .from('vip_members')
      .select('username, host_assigned, days_inactive')
      .eq('is_excluded', false)
    const extrasMap = {}
    ;(extras||[]).forEach(e => { extrasMap[e.username] = e })

    // Classify each player (same logic as PlayerProfiling.jsx)
    function classifyROI(roi) {
      if (roi === null || roi === undefined) return t('exportPage.roiUnclassified')
      if (roi > 10)  return t('exportPage.roiAbnormal')
      if (roi > 3)   return t('exportPage.roiPro')
      if (roi >= 0)  return t('exportPage.roiGood')
      if (roi >= -15) return t('exportPage.roiNormal')
      return t('exportPage.roiUnclassified')
    }

    const rows = totals.map(v => {
      const vb    = parseFloat(v.monthly_valid_bet) || 0
      const wl    = parseFloat(v.win_loss) || 0
      const dep   = parseFloat(v.total_deposit) || 0
      const wd    = parseFloat(v.total_withdrawal) || 0
      const bets  = parseInt(v.bet_count) || 0
      const extra = extrasMap[v.username] || {}
      const roi   = vb > 0 ? (wl / vb * 100) : null
      const ltv   = dep > 0 ? ((dep - wd) / dep * 100) : null
      return {
        _sortVb: vb,
        [t('exportPage.csvMonth')]:          activeMonth,
        [t('common.username')]:              v.username,
        [t('common.tier')]:                  v.tier,
        [t('exportPage.csvCategory')]:       classifyROI(roi),
        [t('exportPage.csvRoiThisMonth')]:   roi !== null ? roi.toFixed(2) + '%' : 'N/A',
        [t('common.validBet')]:              vb.toFixed(2),
        [t('common.winLoss')]:               wl.toFixed(2),
        [t('exportPage.csvTotalDeposit')]:   dep.toFixed(2),
        [t('exportPage.csvTotalWithdrawal')]:wd.toFixed(2),
        [t('exportPage.csvBetCount')]:       bets,
        [t('exportPage.csvRebateRate')]:     vb > 0 ? ((parseFloat(v.total_rebate)||0) / vb * 100).toFixed(2) + '%' : 'N/A',
        [t('exportPage.csvClaimedPromo')]:   v.has_promo ? 'Yes' : 'No',
        [t('exportPage.csvBonusAmount')]:    parseFloat(v.bonus_amount) || 0,
        LTV_ROI:       ltv !== null ? ltv.toFixed(2) + '%' : 'N/A',
        Host:          extra.host_assigned || '',
        [t('exportPage.csvRecentInactiveDays')]: extra.days_inactive ?? '',
        [t('common.currency')]:              v.currency,
      }
    }).sort((a, b) => b._sortVb - a._sortVb).map(({ _sortVb, ...rest }) => rest)

    downloadCSV(rows, `PlayerProfiling_${activeMonth}.csv`)
    setLoadingCSV(p => ({...p, profiling:false}))
  }

  async function exportRetentionMetrics() {
    setLoadingCSV(p => ({...p, retention:true}))
    const { data } = await supabase
      .from('retention_metrics')
      .select('*')
      .order('month').order('tier').order('metric_type')
    downloadCSV((data||[]).map(r => ({
      month:        r.month,
      tier:         r.tier,
      metric_type:  r.metric_type,
      total_members:r.total_members,
      week1:        r.week1,
      week2:        r.week2,
      week3:        r.week3,
      week4:        r.week4,
      monthly:      r.monthly,
      week1_pct:    r.week1_pct,
      week2_pct:    r.week2_pct,
      week3_pct:    r.week3_pct,
      week4_pct:    r.week4_pct,
      monthly_pct:  r.monthly_pct,
    })), `Retention_Metrics_${new Date().toISOString().slice(0,10)}.csv`)
    setLoadingCSV(p => ({...p, retention:false}))
  }

  async function exportRewardCampaigns() {
    setLoadingCSV(p => ({...p, rewards:true}))
    const { data: camps } = await supabase
      .from('reward_campaigns')
      .select('*, reward_campaign_entries(*)')
      .order('month', { ascending:false })
    const rows = []
    ;(camps||[]).forEach(c => {
      rows.push({
        campaign_name:         c.campaign_name,
        month:                 c.month,
        platform:              c.platform,
        currency:              c.currency,
        total_entries:         c.total_entries,
        tier1_qualifiers:      c.tier1_qualifiers,
        tier2_qualifiers:      c.tier2_qualifiers,
        total_rewards_issued:  c.total_rewards_issued,
        total_rewards_pending: c.total_rewards_pending,
        member_group:          'TOTAL',
        group_tier1:           '',
        group_tier2:           '',
        group_total:           '',
        group_reward:          '',
      })
      ;(c.reward_campaign_entries||[]).forEach(e => {
        rows.push({
          campaign_name:         c.campaign_name,
          month:                 c.month,
          platform:              c.platform,
          currency:              c.currency,
          total_entries:         '',
          tier1_qualifiers:      '',
          tier2_qualifiers:      '',
          total_rewards_issued:  '',
          total_rewards_pending: '',
          member_group:          e.member_group,
          group_tier1:           e.tier1_qualifiers,
          group_tier2:           e.tier2_qualifiers,
          group_total:           e.total_qualifiers,
          group_reward:          e.total_reward,
        })
      })
    })
    downloadCSV(rows, `Reward_Campaigns_${new Date().toISOString().slice(0,10)}.csv`)
    setLoadingCSV(p => ({...p, rewards:false}))
  }

  async function exportMonthlyPackage(month) {
    if (!month) return
    setLoadingCSV(p => ({...p, bundle:true}))
    const monthLabel = fmtMonthLabel(month)
    const prevMonth  = prevYearMonth(month)
    const prevLabel  = fmtMonthLabel(prevMonth)
    const TIERS = ['DIAMOND','PLATINUM','GOLD','BLACK']
    const included = []
    // Calendar-safe month boundaries (avoids passing invalid dates like "2026-06-31" to Postgres)
    const monthEndOf = (m) => {
      const [y, mo] = m.split('-').map(Number)
      return new Date(y, mo, 0).toISOString().slice(0, 10)
    }
    const monthStart = `${month}-01`
    const monthEnd   = monthEndOf(month)

    // Excluded (test/staff) accounts must never be counted — vip_monthly_totals has no
    // is_excluded column itself, so fetch the exclusion set once here and filter every
    // section below against it. Previously this export skipped that filter entirely,
    // which inflated tier headcounts above what the Dashboard/Tier Analytics pages show.
    const { data: excludedRows } = await supabase.from('vip_members').select('username').eq('is_excluded', true)
    const excludedSet = new Set((excludedRows||[]).map(e => e.username))

    // ── 1. Tier Breakdown by Region — current vs prior month ──────────────────
    // Same figures as the Dashboard's Tier Financial Summary / Tier Analytics page.
    async function fetchTierTotals(currency, m) {
      const { data } = await supabase
        .from('vip_monthly_totals')
        .select('username, tier, monthly_valid_bet, total_deposit, total_withdrawal, win_loss, total_rebate')
        .eq('snapshot_month', m).eq('currency', currency).in('tier', TIERS)
      const byTier = {}
      TIERS.forEach(t => { byTier[t] = { count:0, active:0, depositCount:0, deposit:0, withdrawal:0, validBet:0, rebate:0, playerWinLoss:0 } })
      ;(data||[]).forEach(v => {
        if (excludedSet.has(v.username)) return
        const vb  = parseFloat(v.monthly_valid_bet) || 0
        const dep = parseFloat(v.total_deposit) || 0
        if (!byTier[v.tier]) return
        byTier[v.tier].count++
        if (vb > 0) byTier[v.tier].active++
        if (dep > 0) byTier[v.tier].depositCount++
        byTier[v.tier].deposit        += dep
        byTier[v.tier].withdrawal     += parseFloat(v.total_withdrawal) || 0
        byTier[v.tier].validBet       += vb
        byTier[v.tier].rebate         += parseFloat(v.total_rebate) || 0
        byTier[v.tier].playerWinLoss  += parseFloat(v.win_loss) || 0
      })
      return byTier
    }
    {
      const rows = []
      for (const currency of CURRENCY_LIST_MAIN) {
        const [curr, prev] = await Promise.all([fetchTierTotals(currency, month), fetchTierTotals(currency, prevMonth)])
        if (!TIERS.some(t => curr[t].count > 0)) continue
        TIERS.forEach(tier => {
          const c = curr[tier], p = prev[tier]
          // Platform Win/Loss matches the Dashboard's formula exactly: rebate is real cash
          // paid to players regardless of betting outcome, so it comes off the platform side
          // on top of whatever the players won or lost.
          const cPlatformWL = -c.playerWinLoss - c.rebate
          const pPlatformWL = -p.playerWinLoss - p.rebate
          const cPlatformPct = c.deposit > 0 ? (cPlatformWL / c.deposit * 100) : 0
          const pPlatformPct = p.deposit > 0 ? (pPlatformWL / p.deposit * 100) : 0
          rows.push({
            Region: REGION_LABEL[CURRENCY_REGION[currency]],
            Currency: currency,
            Tier: tier,
            Members: c.count,
            Active: c.active,
            'Active Rate': c.count ? Math.round(c.active/c.count*100)+'%' : '0%',
            'Deposit Count': c.depositCount,
            'Deposit Rate': c.count ? Math.round(c.depositCount/c.count*100)+'%' : '0%',
            [`Valid Bet (${monthLabel})`]: c.validBet.toFixed(2),
            [`Valid Bet (${prevLabel})`]: p.validBet.toFixed(2),
            'Valid Bet % Change': pctChange(c.validBet, p.validBet) ?? '',
            [`Deposit (${monthLabel})`]: c.deposit.toFixed(2),
            [`Deposit (${prevLabel})`]: p.deposit.toFixed(2),
            'Deposit % Change': pctChange(c.deposit, p.deposit) ?? '',
            [`Withdrawal (${monthLabel})`]: c.withdrawal.toFixed(2),
            [`Withdrawal (${prevLabel})`]: p.withdrawal.toFixed(2),
            'Withdrawal % Change': pctChange(c.withdrawal, p.withdrawal) ?? '',
            [`Rebate (${monthLabel})`]: c.rebate.toFixed(2),
            [`Rebate (${prevLabel})`]: p.rebate.toFixed(2),
            'Rebate % Change': pctChange(c.rebate, p.rebate) ?? '',
            [`Player Win/Loss (${monthLabel})`]: c.playerWinLoss.toFixed(2),
            [`Player Win/Loss (${prevLabel})`]: p.playerWinLoss.toFixed(2),
            [`Platform Win/Loss (${monthLabel})`]: cPlatformWL.toFixed(2),
            [`Platform Win/Loss (${prevLabel})`]: pPlatformWL.toFixed(2),
            'Platform Win/Loss % Change': pctChange(cPlatformWL, pPlatformWL) ?? '',
            [`Platform WL % of Deposit (${monthLabel})`]: cPlatformPct.toFixed(1)+'%',
            [`Platform WL % of Deposit (${prevLabel})`]:  pPlatformPct.toFixed(1)+'%',
          })
        })
      }
      if (rows.length) {
        downloadCSV(rows, `${monthLabel}_Tier_Breakdown_And_Retention_By_Region.csv`)
        included.push('Tier Breakdown & Retention by Region')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 2. VIP Activity — sourced from vip_monthly_totals (accumulated across that
    // month's daily CSV uploads). vip_members can't answer "this month" historically
    // since it only ever holds the latest uploaded day's numbers.
    {
      const { data: monthTotals } = await supabase
        .from('vip_monthly_totals')
        .select('username, tier, monthly_valid_bet, total_deposit, total_withdrawal, currency')
        .eq('snapshot_month', month)
        .order('tier').order('monthly_valid_bet', { ascending:false })
      let extraMap = {}
      if (monthTotals && monthTotals.length > 0) {
        const { data: extras, error: extrasErr } = await supabase
          .from('vip_members')
          .select('username, deposit_count, days_inactive, host_assigned, region')
        if (extrasErr) console.error('exportMonthlyPackage: vip_members fetch error', extrasErr)
        ;(extras||[]).forEach(e => { extraMap[e.username] = e })
      }
      const vips = (monthTotals||[]).filter(t => !excludedSet.has(t.username)).map(t => ({ ...t, ...extraMap[t.username] }))
      if (vips.length) {
        downloadCSV(vips.map(v => ({
          username: v.username, tier: v.tier,
          monthly_valid_bet: v.monthly_valid_bet,
          total_deposit: v.total_deposit, total_withdrawal: v.total_withdrawal,
          deposit_count: v.deposit_count, days_inactive: v.days_inactive,
          host_assigned: v.host_assigned, region: v.region, currency: v.currency,
        })), `${monthLabel}_VIP_Activity.csv`)
        included.push('VIP Activity')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 3. Contact Activity — host summary (current vs prior) + raw log export ─
    {
      const [{ data: currLogs }, { data: prevLogs }] = await Promise.all([
        supabase.from('contact_logs').select('host_name, outcome, channel, username, tier, notes, bonus_offered, logged_at').eq('log_month', month),
        supabase.from('contact_logs').select('host_name, outcome').eq('log_month', prevMonth),
      ])
      const summarize = (logs) => {
        const byHost = {}
        ;(logs||[]).forEach(l => {
          const h = l.host_name || 'Unknown'
          if (!byHost[h]) byHost[h] = { total:0, positive:0 }
          byHost[h].total++
          if (['Contacted','Replied','Deposited','Reactivated'].includes(l.outcome)) byHost[h].positive++
        })
        return byHost
      }
      const currByHost = summarize(currLogs)
      const prevByHost = summarize(prevLogs)
      const allHosts = [...new Set([...Object.keys(currByHost), ...Object.keys(prevByHost)])]
      const summaryRows = allHosts.map(h => {
        const c = currByHost[h] || { total:0, positive:0 }
        const p = prevByHost[h] || { total:0, positive:0 }
        return {
          Host: h,
          [`Contacts (${monthLabel})`]: c.total,
          [`Contacts (${prevLabel})`]: p.total,
          'Contacts % Change': pctChange(c.total, p.total) ?? '',
          [`Positive Outcomes (${monthLabel})`]: c.positive,
          'Positive Rate': c.total ? Math.round(c.positive/c.total*100)+'%' : '0%',
        }
      })
      if (summaryRows.length) {
        downloadCSV(summaryRows, `${monthLabel}_Contact_Activity_By_Host.csv`)
        included.push('Contact Activity by Host')
        await new Promise(r => setTimeout(r, 300))
      }
      if (currLogs?.length) {
        downloadCSV(currLogs.map(l => ({
          username: l.username, tier: l.tier, channel: l.channel,
          outcome: l.outcome, notes: l.notes,
          bonus_offered: l.bonus_offered, host_name: l.host_name, logged_at: l.logged_at,
        })), `${monthLabel}_Contact_Logs_Raw.csv`)
        included.push('Contact Logs (raw)')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 4. Churn & Reactivation Summary ────────────────────────────────────────
    {
      const [{ data: currVips }, { data: reactCurr }, { data: reactPrev }] = await Promise.all([
        supabase.from('vip_members').select('churn_risk, activity_status').eq('is_excluded', false),
        supabase.from('reactivation_logs').select('id').eq('reactivated_month', month),
        supabase.from('reactivation_logs').select('id').eq('reactivated_month', prevMonth),
      ])
      const rows = [{
        'High Risk (current)':   (currVips||[]).filter(v => v.churn_risk === 'HIGH').length,
        'Medium Risk (current)': (currVips||[]).filter(v => v.churn_risk === 'MEDIUM').length,
        'Dormant (current)':     (currVips||[]).filter(v => v.activity_status === 'Dormant').length,
        'At Risk (current)':     (currVips||[]).filter(v => v.activity_status === 'At Risk').length,
        [`Reactivated (${monthLabel})`]: (reactCurr||[]).length,
        [`Reactivated (${prevLabel})`]:  (reactPrev||[]).length,
        'Reactivated % Change': pctChange((reactCurr||[]).length, (reactPrev||[]).length) ?? '',
      }]
      downloadCSV(rows, `${monthLabel}_Churn_Reactivation_Summary.csv`)
      included.push('Churn & Reactivation Summary')
      await new Promise(r => setTimeout(r, 300))
    }

    // ── 5. Campaigns Performance + Player Results (in-app Campaigns system) ────
    // Date-range overlap is filtered client-side to avoid fragile PostgREST OR-filter syntax.
    // Two files: a campaign-level summary, and a per-player results file with the
    // actual rank/reward/winner detail — a PPT slide showing "who won what" needs the
    // second file, which the export never produced before (only aggregate totals).
    //
    // Reward math below (calcTieredReward / calcReward / leaderboard ranking) is copied
    // exactly from Campaigns.jsx so the numbers here always match what that page shows.
    function calcTieredReward(deposit, tiers) {
      if (!tiers || tiers.length === 0) return 0
      const dep = parseFloat(deposit) || 0
      const sorted = [...tiers].sort((a,b) => parseFloat(a.min)-parseFloat(b.min))
      let reward = 0
      for (const t of sorted) {
        const min = parseFloat(t.min) || 0
        const max = t.max ? parseFloat(t.max) : Infinity
        const pct = parseFloat(t.pct) || 0
        if (dep >= min && dep <= max) { reward = dep * pct / 100; break }
        if (dep > max) {
          const nextTier = sorted.find(tt => parseFloat(tt.min) > max)
          if (!nextTier) reward = dep * pct / 100
        }
      }
      return reward
    }
    function calcReward(type, deposit, rewardPct, rewardFixed, goldBarValue, rewardCap, rewardTiers) {
      let reward = 0
      if (type === 'pct_reward')         reward = (parseFloat(deposit)||0) * (parseFloat(rewardPct)||0) / 100
      else if (type === 'fixed_reward')  reward = parseFloat(rewardFixed)||0
      else if (type === 'gold_bar')      reward = parseFloat(goldBarValue)||0
      else if (type === 'tiered_reward') reward = calcTieredReward(deposit, rewardTiers||[])
      if (rewardCap && parseFloat(rewardCap) > 0) reward = Math.min(reward, parseFloat(rewardCap))
      return reward
    }
    {
      const { data: allCamps } = await supabase.from('campaigns').select('*')
      const camps = (allCamps||[]).filter(c => {
        if (!c.start_date) return false
        const s = c.start_date
        const e = c.end_date || monthEnd // ongoing campaigns count as covering through month end
        return s <= monthEnd && e >= monthStart
      })
      if (camps.length) {
        const summaryRows = []
        const playerResultRows = []

        for (const c of camps) {
          // Join to vip_members for each player's actual currency — split by that,
          // not by the campaign's platform label, so a mislabeled campaign (or one
          // genuinely spanning both markets) still comes out correctly separated.
          // MYR and SGD valid bets/deposits must never be combined into one ranking
          // or one total — same rule as everywhere else in this app.
          const { data: rawPlayers } = await supabase
            .from('campaign_players')
            .select('username, tier, valid_bet, total_deposit, converted, payout_status, vip_members(currency)')
            .eq('campaign_id', c.id)
          const allPlayers = (rawPlayers || []).map(p => ({ ...p, currency: p.vip_members?.currency || 'MYR' }))
          const tierSummary = Array.isArray(c.reward_tiers)
            ? c.reward_tiers.map(t => `${t.min}${t.max ? '-'+t.max : '+'}: ${t.pct}%`).join(' | ')
            : ''
          const currenciesPresent = [...new Set(allPlayers.map(p => p.currency))]

          for (const currency of currenciesPresent) {
            const players = allPlayers.filter(p => p.currency === currency)
            const regionLabel = REGION_LABEL[CURRENCY_REGION[currency]] || currency

            if (c.campaign_type === 'leaderboard') {
              const minBetTarget = parseFloat(c.min_valid_bet) || 0
              const minDepLb     = parseFloat(c.min_deposit_lb) || 0
              const topN         = parseInt(c.top_n) || 3
              const rankRewards  = c.rank_rewards || []
              // Ranked within this currency only — ranking a RM valid bet against an
              // SGD one wouldn't mean anything, so each currency gets its own top N.
              const ranked = [...players]
                .sort((a,b) => (parseFloat(b.valid_bet)||0) - (parseFloat(a.valid_bet)||0))
                .map((p, i) => {
                  const vb  = parseFloat(p.valid_bet) || 0
                  const dep = parseFloat(p.total_deposit) || 0
                  const qualified = vb >= minBetTarget || (minDepLb > 0 && dep >= minDepLb)
                  const posRank = i + 1
                  const rank    = qualified ? posRank : null
                  const inTop   = rank && rank <= topN
                  const reward  = inTop ? (parseFloat(rankRewards[rank-1]?.amount) || 0) : 0
                  return { ...p, vb, dep, qualified, rank, inTop, reward }
                })
              const totalRewardPool = rankRewards.reduce((s,r) => s + (parseFloat(r.amount)||0), 0)
              const paidOut = ranked.filter(p => p.inTop && p.payout_status === 'paid').reduce((s,p) => s + p.reward, 0)

              summaryRows.push({
                Campaign: c.campaign_name, Region: regionLabel, Currency: currency,
                Type: c.campaign_type, Platform: c.platform, Status: c.status,
                'Start Date': c.start_date, 'End Date': c.end_date || '',
                'Min Valid Bet': c.min_valid_bet ?? '', 'Top N': topN,
                Participants: players.length,
                Qualified: ranked.filter(p => p.qualified).length,
                'Total Reward Pool': totalRewardPool.toFixed(2),
                'Paid Out': paidOut.toFixed(2),
                'Pending Payout': (totalRewardPool - paidOut).toFixed(2),
                Budget: c.budget_rm ?? '',
              })
              ranked.filter(p => p.rank !== null).forEach(p => {
                playerResultRows.push({
                  Campaign: c.campaign_name, Region: regionLabel, Currency: currency, Type: c.campaign_type,
                  Username: p.username, Tier: p.tier,
                  Rank: p.rank, 'In Top N': p.inTop ? 'Yes' : 'No',
                  'Valid Bet': p.vb.toFixed(2), 'Total Deposit': p.dep.toFixed(2),
                  Reward: p.reward.toFixed(2), 'Payout Status': p.payout_status,
                })
              })
            } else {
              const rewardPct   = c.reward_pct, rewardFixed = c.reward_fixed
              const goldVal     = c.gold_bar_value, rewardCap = c.reward_cap
              const depTarget   = parseFloat(c.deposit_target) || 0
              const achieved    = players.filter(p => (parseFloat(p.total_deposit)||0) >= depTarget)
              const totalReward = achieved.reduce((s,p) => s + calcReward(c.campaign_type, p.total_deposit, rewardPct, rewardFixed, goldVal, rewardCap, c.reward_tiers), 0)
              const paidOut     = players.filter(p => p.payout_status === 'paid').reduce((s,p) => s + calcReward(c.campaign_type, p.total_deposit, rewardPct, rewardFixed, goldVal, rewardCap, c.reward_tiers), 0)

              summaryRows.push({
                Campaign: c.campaign_name, Region: regionLabel, Currency: currency,
                Type: c.campaign_type, Platform: c.platform, Status: c.status,
                'Start Date': c.start_date, 'End Date': c.end_date || '',
                'Target Tier': Array.isArray(c.target_tier) ? c.target_tier.join('/') : (c.target_tier || ''),
                'Min Deposit Target': c.deposit_target ?? '',
                'Reward %': c.reward_pct ?? '', 'Reward Fixed': c.reward_fixed ?? '',
                'Reward Cap': c.reward_cap ?? '', 'Reward Tiers': tierSummary,
                'Gold Bar Value': c.gold_bar_value ?? '', Offer: c.offer_desc || '',
                Participants: players.length,
                'Achieved Target': achieved.length,
                Converted: players.filter(p => p.converted).length,
                'Total Deposit': players.reduce((s,p) => s + (parseFloat(p.total_deposit)||0), 0).toFixed(2),
                'Total Reward Owed': totalReward.toFixed(2),
                'Paid Out': paidOut.toFixed(2),
                'Pending Payout': (totalReward - paidOut).toFixed(2),
                Budget: c.budget_rm ?? '',
              })
              achieved.forEach(p => {
                const reward = calcReward(c.campaign_type, p.total_deposit, rewardPct, rewardFixed, goldVal, rewardCap, c.reward_tiers)
                playerResultRows.push({
                  Campaign: c.campaign_name, Region: regionLabel, Currency: currency, Type: c.campaign_type,
                  Username: p.username, Tier: p.tier,
                  Rank: '', 'In Top N': '',
                  'Valid Bet': '', 'Total Deposit': (parseFloat(p.total_deposit)||0).toFixed(2),
                  Reward: reward.toFixed(2), 'Payout Status': p.payout_status,
                })
              })
            }
          }
        }

        downloadCSV(summaryRows, `${monthLabel}_Campaigns_Summary.csv`)
        included.push('Campaigns Summary')
        await new Promise(r => setTimeout(r, 300))

        if (playerResultRows.length) {
          downloadCSV(playerResultRows, `${monthLabel}_Campaigns_Player_Results.csv`)
          included.push('Campaigns Player Results (winners/achievers)')
          await new Promise(r => setTimeout(r, 300))
        }
      }
    }

    // ── 6. Budget & Expenses Summary — current vs prior month ──────────────────
    {
      const [{ data: currExp }, { data: prevExp }] = await Promise.all([
        supabase.from('department_expenses').select('platform, expense_type, amount').eq('month', month),
        supabase.from('department_expenses').select('platform, expense_type, amount').eq('month', prevMonth),
      ])
      const sumBy = (rows, plat, type) => (rows||[]).filter(r => r.platform===plat && r.expense_type===type).reduce((s,r) => s + (parseFloat(r.amount)||0), 0)
      const sections = [['MY','online'],['MY','offline'],['SG','online'],['SG','offline']]
      const rows = sections.map(([plat, type]) => {
        const c = sumBy(currExp, plat, type)
        const p = sumBy(prevExp, plat, type)
        return {
          Platform: plat, Type: type,
          [`Spend (${monthLabel})`]: c.toFixed(2),
          [`Spend (${prevLabel})`]:  p.toFixed(2),
          '% Change': pctChange(c, p) ?? '',
        }
      })
      downloadCSV(rows, `${monthLabel}_Budget_Expenses_Summary.csv`)
      included.push('Budget & Expenses Summary')
      await new Promise(r => setTimeout(r, 300))
    }

    // ── 6b. Bonus & Rebate Summary — current vs prior month ────────────────────
    // Two genuinely different things, kept separate: host-given retention bonuses
    // (logged manually in Contact Log against a specific contact) vs platform-side
    // promo/rebate amounts (bonus_amount, total_rebate — already in the Tier Breakdown
    // file above by tier/region, this section adds the by-tier host-bonus view that
    // wasn't available anywhere else in the export).
    //
    // MYR and SGD must never be summed together — same rule as everywhere else in
    // this app. Join to vip_members for currency and split every total by it, instead
    // of adding every bonus into one number and mislabeling it "RM".
    {
      const [{ data: currBonusLogs }, { data: prevBonusLogs }] = await Promise.all([
        supabase.from('contact_logs').select('tier, bonus_offered, vip_members!inner(currency)').eq('log_month', month).not('bonus_offered', 'is', null).gt('bonus_offered', 0),
        supabase.from('contact_logs').select('tier, bonus_offered, vip_members!inner(currency)').eq('log_month', prevMonth).not('bonus_offered', 'is', null).gt('bonus_offered', 0),
      ])
      const sumBonusByTierCurrency = (rows) => {
        const byKey = {}
        ;(rows||[]).forEach(l => {
          const tier = l.tier || 'Unknown'
          const currency = l.vip_members?.currency || 'MYR'
          const key = `${tier}|${currency}`
          if (!byKey[key]) byKey[key] = { tier, currency, count:0, total:0 }
          byKey[key].count++
          byKey[key].total += parseFloat(l.bonus_offered) || 0
        })
        return byKey
      }
      const currByKey = sumBonusByTierCurrency(currBonusLogs)
      const prevByKey = sumBonusByTierCurrency(prevBonusLogs)
      const allKeys = [...new Set([...Object.keys(currByKey), ...Object.keys(prevByKey)])]
      const rows = allKeys.map(key => {
        const c = currByKey[key] || {}
        const p = prevByKey[key] || {}
        const [tier, currency] = key.split('|')
        const cCount = c.count || 0, cTotal = c.total || 0
        const pCount = p.count || 0, pTotal = p.total || 0
        return {
          Tier: tier,
          Currency: currency,
          [`Bonuses Given (${monthLabel})`]: cCount,
          [`Bonuses Given (${prevLabel})`]:  pCount,
          [`Total Bonus (${monthLabel})`]: cTotal.toFixed(2),
          [`Total Bonus (${prevLabel})`]:  pTotal.toFixed(2),
          '% Change': pctChange(cTotal, pTotal) ?? '',
        }
      })
      if (rows.length) {
        downloadCSV(rows, `${monthLabel}_Host_Bonus_Summary_By_Tier.csv`)
        included.push('Host Bonus Summary by Tier')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // NOTE: There is no separate "Retention Metrics" section here anymore. Active Rate
    // and Deposit Rate by tier/region — the actual retention engagement numbers — are
    // already in the Tier Breakdown by Region file above, computed directly from
    // vip_monthly_totals (the same data every daily CSV upload already provides). The
    // retention_metrics table used to require a separate manual "Retention Engagement"
    // CSV built outside the CRM and uploaded via CSV Import — that step is unnecessary
    // for this purpose and has been dropped from the package.

    // ── 7. Transfer Tracker Snapshot ────────────────────────────────────────────
    // This tool tracks cumulative P&L since each player was added, not monthly figures
    // (the underlying data model has no monthly grouping) — so this is a point-in-time
    // snapshot as of today, not a current-vs-prior-month comparison like the sections above.
    {
      const { data: players } = await supabase.from('transfer_players').select('*')
      if (players?.length) {
        const rows = await Promise.all(players.map(async p => {
          const [{ data: snaps }, { data: costs }] = await Promise.all([
            supabase.from('transfer_snapshots').select('*').eq('username', p.username).order('snapshot_date', { ascending:false }).limit(1),
            supabase.from('transfer_costs').select('amount').eq('username', p.username),
          ])
          const latest = snaps?.[0]
          const totalCost = (costs||[]).reduce((s,c) => s + (parseFloat(c.amount)||0), 0)
          const netDeposit = latest ? (parseFloat(latest.total_deposit)||0) - (parseFloat(latest.total_withdrawal)||0) : 0
          const pnl = latest ? netDeposit + (parseFloat(latest.win_loss)||0) - totalCost : null
          return {
            Username: p.username,
            'Source Platform': p.source_platform,
            'Joined Date': p.joined_date,
            'Latest Deposit': latest?.total_deposit ?? '',
            'Latest Withdrawal': latest?.total_withdrawal ?? '',
            'Our Cost': totalCost.toFixed(2),
            'Net P&L': pnl !== null ? pnl.toFixed(2) : '',
            'As of': latest?.snapshot_date ?? '',
          }
        }))
        downloadCSV(rows, `Transfer_Tracker_Snapshot_${new Date().toISOString().slice(0,10)}.csv`)
        included.push('Transfer Tracker Snapshot')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 8. Birthdays & Gifts Summary — current vs prior month ──────────────────
    {
      const [{ data: currGifts }, { data: prevGifts }] = await Promise.all([
        supabase.from('gift_logs').select('gift_cost, bonus_given, service_cost').gte('contact_date', monthStart).lte('contact_date', monthEnd),
        supabase.from('gift_logs').select('gift_cost, bonus_given, service_cost').gte('contact_date', `${prevMonth}-01`).lte('contact_date', monthEndOf(prevMonth)),
      ])
      const sumGift = (rows) => (rows||[]).reduce((s,g) => s + (parseFloat(g.gift_cost)||0) + (parseFloat(g.bonus_given)||0) + (parseFloat(g.service_cost)||0), 0)
      const c = sumGift(currGifts), p = sumGift(prevGifts)
      const rows = [{
        [`Gifts Given (${monthLabel})`]: (currGifts||[]).length,
        [`Gifts Given (${prevLabel})`]:  (prevGifts||[]).length,
        [`Total Spend (${monthLabel})`]: c.toFixed(2),
        [`Total Spend (${prevLabel})`]:  p.toFixed(2),
        '% Change': pctChange(c, p) ?? '',
      }]
      downloadCSV(rows, `${monthLabel}_Birthdays_Gifts_Summary.csv`)
      included.push('Birthdays & Gifts Summary')
      await new Promise(r => setTimeout(r, 300))
    }

    // ── 9. Upgrade Pipeline ──────────────────────────────────────────────────────
    // NOTE: don't filter with .in('username', ...) — GOLD/PLATINUM VIPs can be 400+ and
    // flagged potentials can run into the thousands, both can exceed URL length limits.
    {
      const { data: candidateVips } = await supabase
        .from('vip_members')
        .select('username,tier,last_deposit_date,host_assigned')
        .in('tier',['GOLD','PLATINUM'])
      const { data: candidateTotals } = await supabase
        .from('vip_monthly_totals').select('username, monthly_valid_bet').eq('snapshot_month', month)
      const candidateTotalsMap = {}
      ;(candidateTotals||[]).forEach(t => { candidateTotalsMap[t.username] = t.monthly_valid_bet })
      const upgrades = (candidateVips||[])
        .map(v => ({ ...v, monthly_valid_bet: candidateTotalsMap[v.username] ?? 0 }))
        .filter(v => (v.monthly_valid_bet||0) >= 2000000)

      const { data: flagged } = await supabase
        .from('potential_players')
        .select('username,tier,last_import_month')
        .eq('upgrade_flag', true).eq('is_graduated', false)
      const { data: flaggedTotals } = await supabase
        .from('potential_monthly_totals').select('username, monthly_valid_bet').eq('snapshot_month', month)
      const flaggedTotalsMap = {}
      ;(flaggedTotals||[]).forEach(t => { flaggedTotalsMap[t.username] = t.monthly_valid_bet })
      const flaggedWithTotals = (flagged||[]).map(p => ({ ...p, monthly_valid_bet: flaggedTotalsMap[p.username] ?? 0 }))

      const pipeline = [
        ...upgrades.map(v=>({type:'VIP_UPGRADE',...v})),
        ...flaggedWithTotals.map(p=>({type:'POTENTIAL_FLAGGED',...p})),
      ]
      if (pipeline.length > 0) {
        downloadCSV(pipeline, `${monthLabel}_Upgrade_Pipeline.csv`)
        included.push('Upgrade Pipeline')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 10. Player Profiling — ROI classification for all VIPs this month ──────
    {
      const { data: profilingTotals } = await supabase
        .from('vip_monthly_totals')
        .select('username, tier, monthly_valid_bet, win_loss, total_deposit, total_withdrawal, bet_count, bonus_count, bonus_amount, total_rebate, has_promo, currency')
        .eq('snapshot_month', month)
        .in('currency', ['MYR', 'SGD'])
      if (profilingTotals && profilingTotals.length > 0) {
        const { data: profExtras } = await supabase
          .from('vip_members').select('username, host_assigned, days_inactive').eq('is_excluded', false)
        const profExtrasMap = {}
        ;(profExtras||[]).forEach(e => { profExtrasMap[e.username] = e })

        function classifyROI(roi) {
          if (roi === null || roi === undefined) return t('exportPage.roiUnclassified')
          if (roi > 10)  return t('exportPage.roiAbnormal')
          if (roi > 3)   return t('exportPage.roiPro')
          if (roi >= 0)  return t('exportPage.roiGood')
          if (roi >= -15) return t('exportPage.roiNormal')
          return t('exportPage.roiUnclassified')
        }

        const profilingRows = profilingTotals.map(v => {
          const vb  = parseFloat(v.monthly_valid_bet) || 0
          const wl  = parseFloat(v.win_loss) || 0
          const dep = parseFloat(v.total_deposit) || 0
          const wd  = parseFloat(v.total_withdrawal) || 0
          const roi = vb > 0 ? (wl / vb * 100) : null
          const ltv = dep > 0 ? ((dep - wd) / dep * 100) : null
          const ext = profExtrasMap[v.username] || {}
          return {
            _sortVb: vb,
            [t('exportPage.csvMonth')]: month,
            [t('common.username')]: v.username,
            [t('common.tier')]: v.tier,
            [t('exportPage.csvCategory')]: classifyROI(roi),
            [t('exportPage.csvRoiThisMonth')]: roi !== null ? roi.toFixed(2) + '%' : 'N/A',
            [t('common.validBet')]: vb.toFixed(2),
            [t('common.winLoss')]: wl.toFixed(2),
            [t('exportPage.csvTotalDeposit')]: dep.toFixed(2),
            [t('exportPage.csvTotalWithdrawal')]: wd.toFixed(2),
            [t('exportPage.csvBetCount')]: parseInt(v.bet_count) || 0,
            [t('exportPage.csvRebateRate')]: vb > 0 ? ((parseFloat(v.total_rebate)||0) / vb * 100).toFixed(2) + '%' : 'N/A',
            [t('exportPage.csvClaimedPromo')]: v.has_promo ? 'Yes' : 'No',
            [t('exportPage.csvBonusAmount')]: parseFloat(v.bonus_amount) || 0,
            LTV_ROI: ltv !== null ? ltv.toFixed(2) + '%' : 'N/A',
            Host: ext.host_assigned || '',
            [t('exportPage.csvRecentInactiveDays')]: ext.days_inactive ?? '',
            [t('common.currency')]: v.currency,
          }
        }).sort((a, b) => b._sortVb - a._sortVb).map(({ _sortVb, ...rest }) => rest)

        downloadCSV(profilingRows, `${monthLabel}_Player_Profiling.csv`)
        included.push('Player Profiling')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 11. Host Comparison — assigned VIPs, contact activity, response rate ───
    {
      const { data: hostVips } = await supabase
        .from('vip_members')
        .select('username, host_assigned')
        .eq('is_excluded', false)
      const assignedByHost = {}
      ;(hostVips||[]).forEach(v => {
        const h = v.host_assigned || 'Unassigned'
        assignedByHost[h] = (assignedByHost[h] || 0) + 1
      })

      const { data: hostLogs } = await supabase
        .from('contact_logs')
        .select('host_name, outcome, username')
        .eq('log_month', month)

      const byHost = {}
      ;(hostLogs||[]).forEach(l => {
        const h = l.host_name || 'Unknown'
        if (!byHost[h]) byHost[h] = { totalContacts: 0, uniqueVips: new Set(), responded: 0 }
        byHost[h].totalContacts++
        byHost[h].uniqueVips.add(l.username)
        if (['Replied', 'Deposited', 'Reactivated'].includes(l.outcome)) byHost[h].responded++
      })

      const allHostNames = [...new Set([...Object.keys(assignedByHost), ...Object.keys(byHost)])]
      const hostRows = allHostNames.map(h => {
        const stats = byHost[h] || { totalContacts: 0, uniqueVips: new Set(), responded: 0 }
        return {
          Host: h,
          'Assigned VIPs': assignedByHost[h] || 0,
          'Total Contacts': stats.totalContacts,
          'Unique VIPs Contacted': stats.uniqueVips.size,
          'Responded (Replied/Deposited/Reactivated)': stats.responded,
          'Response Rate': stats.totalContacts ? Math.round(stats.responded / stats.totalContacts * 100) + '%' : '0%',
        }
      })
      if (hostRows.length) {
        downloadCSV(hostRows, `${monthLabel}_Host_Comparison.csv`)
        included.push('Host Comparison (assigned VIPs, contacts, response rate)')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 11b. Platinum+Diamond 3-Month Trend — members, upgrades, downgrades,
    // TD/TW/VB, active rate ──────────────────────────────────────────────────
    // "Churned" here is an approximation (had valid bet last month, zero this
    // month) since there's no literal stored "churn event" anywhere in the
    // schema — only current activity snapshots. Upgrade/downgrade counts are
    // real recorded events from tier_change_logs (captured automatically on
    // every CSV import whenever a VIP's tier differs from what's on file).
    {
      const TIER_RANK = { BRONZE:0, SILVER:1, GOLD:2, PLATINUM:3, DIAMOND:4, BLACK:5 }
      const PD_TIERS = ['PLATINUM', 'DIAMOND']
      const prevMonth2 = prevYearMonth(prevMonth)
      const threeMonths = [prevMonth2, prevMonth, month]
      const threeMonthLabels = threeMonths.map(fmtMonthLabel)

      const { data: allChangeLogs } = await supabase
        .from('tier_change_logs')
        .select('old_tier, new_tier, import_month')
        .in('import_month', threeMonths)

      async function fetchPDMonthStats(currency, m) {
        const { data } = await supabase
          .from('vip_monthly_totals')
          .select('username, tier, monthly_valid_bet, total_deposit, total_withdrawal')
          .eq('snapshot_month', m).eq('currency', currency).in('tier', PD_TIERS)
        const byTier = {}
        PD_TIERS.forEach(t => { byTier[t] = { count:0, active:0, deposit:0, withdrawal:0, validBet:0, activeUsernames:new Set() } })
        ;(data||[]).forEach(v => {
          if (excludedSet.has(v.username)) return
          if (!byTier[v.tier]) return
          const vb = parseFloat(v.monthly_valid_bet) || 0
          byTier[v.tier].count++
          if (vb > 0) { byTier[v.tier].active++; byTier[v.tier].activeUsernames.add(v.username) }
          byTier[v.tier].deposit    += parseFloat(v.total_deposit) || 0
          byTier[v.tier].withdrawal += parseFloat(v.total_withdrawal) || 0
          byTier[v.tier].validBet   += vb
        })
        return byTier
      }

      const rows = []
      for (const currency of CURRENCY_LIST_MAIN) {
        const monthStats = {}
        for (const m of threeMonths) monthStats[m] = await fetchPDMonthStats(currency, m)
        const anyData = threeMonths.some(m => PD_TIERS.some(t => monthStats[m][t].count > 0))
        if (!anyData) continue

        for (const tier of PD_TIERS) {
          for (let i = 0; i < threeMonths.length; i++) {
            const m = threeMonths[i]
            const cur = monthStats[m][tier]
            const prev = i > 0 ? monthStats[threeMonths[i-1]][tier] : null

            const upgradesIn = (allChangeLogs||[]).filter(l =>
              l.import_month === m && l.new_tier === tier && (TIER_RANK[l.new_tier]||0) > (TIER_RANK[l.old_tier]||0)
            ).length
            const downgradesOut = (allChangeLogs||[]).filter(l =>
              l.import_month === m && l.old_tier === tier && (TIER_RANK[l.new_tier]||0) < (TIER_RANK[l.old_tier]||0)
            ).length
            // Approximate churn: active last month, not active this month (among this month's known tier members)
            let churned = ''
            if (prev) {
              let churnCount = 0
              prev.activeUsernames.forEach(u => { if (!cur.activeUsernames.has(u)) churnCount++ })
              churned = churnCount
            }

            rows.push({
              Region: REGION_LABEL[CURRENCY_REGION[currency]], Currency: currency, Tier: tier,
              Month: threeMonthLabels[i],
              Members: cur.count, Active: cur.active,
              'Active Rate': cur.count ? Math.round(cur.active/cur.count*100)+'%' : '0%',
              'Valid Bet': cur.validBet.toFixed(2), Deposit: cur.deposit.toFixed(2), Withdrawal: cur.withdrawal.toFixed(2),
              'Upgraded In': upgradesIn, 'Downgraded Out': downgradesOut,
              'Approx. Churned (active last month, inactive this month)': churned,
            })
          }
        }
      }
      if (rows.length) {
        downloadCSV(rows, `${monthLabel}_Platinum_Diamond_3Month_Trend.csv`)
        included.push('Platinum+Diamond 3-Month Trend')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 11c. Per-VIP Benefit Report — bonuses & gifts with TD before/after ─────
    // Covers what's individually attributable to a specific VIP: host-given
    // bonuses (Contact Log) and birthday gifts (Gift Log). General department
    // expenses (Gold Bar campaign costs, etc.) are NOT included here — those
    // are logged as lump sums in Expense Tracker with no link to a specific
    // member, so there's genuinely nothing to attribute per-VIP for those.
    {
      const { data: bonusEvents } = await supabase
        .from('contact_logs')
        .select('username, tier, bonus_offered, bonus_type, logged_at, vip_members!inner(currency)')
        .eq('log_month', month)
        .not('bonus_offered', 'is', null)
        .gt('bonus_offered', 0)
      const { data: giftEvents } = await supabase
        .from('gift_logs')
        .select('username, gift_type, gift_cost, bonus_given, service_cost, contact_date')
        .gte('contact_date', monthStart).lte('contact_date', monthEnd)

      const events = [
        ...(bonusEvents||[]).map(e => ({
          username: e.username, tier: e.tier, currency: e.vip_members?.currency || 'MYR',
          type: 'Host Bonus', detail: e.bonus_type || '', amount: parseFloat(e.bonus_offered) || 0, date: e.logged_at,
        })),
        ...(giftEvents||[]).map(e => ({
          username: e.username, tier: '', currency: '',
          type: 'Birthday Gift', detail: e.gift_type || '',
          amount: (parseFloat(e.gift_cost)||0) + (parseFloat(e.bonus_given)||0) + (parseFloat(e.service_cost)||0),
          date: e.contact_date,
        })),
      ]

      if (events.length) {
        const uniqueUsernames = [...new Set(events.map(e => e.username))]
        const [{ data: curTotals }, { data: prevTotals }] = await Promise.all([
          supabase.from('vip_monthly_totals').select('username, tier, currency, total_deposit').eq('snapshot_month', month).in('username', uniqueUsernames.slice(0, 200)),
          supabase.from('vip_monthly_totals').select('username, total_deposit').eq('snapshot_month', prevMonth).in('username', uniqueUsernames.slice(0, 200)),
        ])
        // NOTE: .in('username', ...) capped at 200 per Supabase URL-length limits (see
        // known limitation elsewhere in this file) — if a month has more than 200
        // distinct benefit recipients, only the first 200 get TD before/after filled in.
        const curTDMap = {}, prevTDMap = {}, tierMap = {}, currencyMap = {}
        ;(curTotals||[]).forEach(v => { curTDMap[v.username] = parseFloat(v.total_deposit)||0; tierMap[v.username] = v.tier; currencyMap[v.username] = v.currency })
        ;(prevTotals||[]).forEach(v => { prevTDMap[v.username] = parseFloat(v.total_deposit)||0 })

        const rows = events.map(e => {
            const tdBefore = prevTDMap[e.username]
            const tdAfter  = curTDMap[e.username]
            const tdChange = (tdBefore !== undefined && tdAfter !== undefined) ? (tdAfter - tdBefore) : ''
            return {
              Username: e.username,
              Tier: e.tier || tierMap[e.username] || '',
              Currency: e.currency || currencyMap[e.username] || '',
              'Benefit Type': e.type, Detail: e.detail, Amount: e.amount.toFixed(2), Date: e.date,
              [`TD (${prevLabel})`]: tdBefore !== undefined ? tdBefore.toFixed(2) : 'N/A',
              [`TD (${monthLabel})`]: tdAfter !== undefined ? tdAfter.toFixed(2) : 'N/A',
              'TD Change': tdChange !== '' ? tdChange.toFixed(2) : 'N/A',
            }
          })
        downloadCSV(rows, `${monthLabel}_Per_VIP_Benefit_Report.csv`)
        included.push('Per-VIP Benefit Report (with TD before/after)')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // ── 12. Dormant VIP List — 14-day and 30-day cutoffs ───────────────────────
    {
      const { data: dormantCandidates } = await supabase
        .from('vip_members')
        .select('username, tier, region, currency, host_assigned, days_inactive, last_deposit_date, total_deposit')
        .eq('is_excluded', false)
        .gte('days_inactive', 14)
        .order('days_inactive', { ascending: false })
      if (dormantCandidates?.length) {
        const rows = dormantCandidates.map(v => ({
          Username: v.username, Tier: v.tier, Region: v.region, Currency: v.currency,
          Host: v.host_assigned || '', 'Days Inactive': v.days_inactive,
          'Dormant 14+ Days': v.days_inactive >= 14 ? 'Yes' : 'No',
          'Dormant 30+ Days': v.days_inactive >= 30 ? 'Yes' : 'No',
          'Last Deposit Date': v.last_deposit_date || '', 'Last Known Deposit': v.total_deposit ?? '',
        }))
        downloadCSV(rows, `${monthLabel}_Dormant_VIP_List.csv`)
        included.push('Dormant VIP List (14d & 30d)')
        await new Promise(r => setTimeout(r, 300))
      }
    }

    setLoadingCSV(p => ({...p, bundle:false}))
    alert(`✅ ${monthLabel} report package downloaded!\n\nIncluded (${included.length} files):\n${included.map((f,i)=>`${i+1}. ${f}`).join('\n')}\n\nUpload all of them to build the monthly report. (KPI data is intentionally not included — that's tracked separately.)`)
  }

  return (
    <div style={s.page}>
      <div style={s.heading}>Export</div>
      <div style={s.sub}>Download your data as CSV — including a full Monthly Report Package for building your PPT</div>

      {/* ── CSV EXPORTS ── */}
      <div style={s.card}>
        <div style={s.cardHdr}>
          <span style={s.badge('#0ea5e9')}>CSV</span>
          <div>
            <div style={s.title}>Export & Import Data</div>
            <div style={{fontSize:13,color:'var(--muted)',marginTop:4}}>
              Download VIP data for analysis — or import a completed mailing list (.xlsx) back into the system.
              <span style={{color:'var(--amber,#f59e0b)',marginLeft:8}}>
                📌 To upload monthly platform data (Raw Data CSV), use Raw Data Import instead.
              </span>
            </div>
          </div>
        </div>

        {/* Contact log date filter */}
        <div style={{ ...s.row, marginBottom:16, background:'var(--bg)', padding:'10px 14px', borderRadius:8, border:'1px solid var(--border)' }}>
          <span style={s.label}>Contact logs filter:</span>
          <span style={{ fontSize:12, color:'var(--muted)' }}>From</span>
          <input type="date" style={s.input} value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
          <span style={{ fontSize:12, color:'var(--muted)' }}>To</span>
          <input type="date" style={s.input} value={dateTo}   onChange={e=>setDateTo(e.target.value)} />
          {(dateFrom||dateTo) && <button style={s.btnSm('#8b949e')} onClick={()=>{setDateFrom('');setDateTo('')}}>Clear</button>}
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <CSVExportCard icon="👑" title="VIP Members"             desc="All VIP profiles — tier, valid bet, deposit, host, birthday, region" color="#6366f1" loading={loadingCSV.vip}       onExport={exportVIPs} />
          <CSVExportCard icon="📮" title="VIP Mailing List"        desc="Tier, username, name, phone, email, address, race — for holiday gift mailing. Email/address/race aren't tracked yet, so those columns come out blank to fill in by hand." color="#14b8a6" loading={loadingCSV.mailing}   onExport={exportMailingList} />

          <div style={{ background:'var(--surface)', border:'1px dashed var(--border)', borderRadius:10, padding:'14px 16px', display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ fontSize:22 }}>⬆️</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>Import Completed Mailing List</div>
              <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                Upload the filled-in .xlsx back — updates Name, Email, Address, Race by matching Username. Blank cells are left untouched, never overwrite existing data. Phone is never touched by this import.
              </div>
              {mailingResult && (
                <div style={{ marginTop:8, fontSize:12, padding:'8px 12px', borderRadius:6, background:'var(--surface2)' }}>
                  ✅ {mailingResult.updated} updated · {mailingResult.skippedBlank} had nothing new to add · {mailingResult.notFound} username{mailingResult.notFound===1?'':'s'} not found
                  {mailingResult.errors > 0 && <span style={{ color:'#f85149' }}> · {mailingResult.errors} failed (columns may not exist yet — see setup note below)</span>}
                  {mailingResult.notFoundUsernames.length > 0 && (
                    <div style={{ marginTop:4, color:'var(--muted)' }}>Not found: {mailingResult.notFoundUsernames.slice(0,10).join(', ')}{mailingResult.notFoundUsernames.length>10?'…':''}</div>
                  )}
                </div>
              )}
            </div>
            <label style={{ background:'#14b8a6', color:'#fff', padding:'8px 16px', borderRadius:8, fontSize:12, fontWeight:700, cursor: mailingImporting ? 'default' : 'pointer', opacity: mailingImporting ? 0.6 : 1 }}>
              {mailingImporting ? 'Importing…' : 'Choose File'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} disabled={mailingImporting}
                onChange={e => { if (e.target.files[0]) importMailingList(e.target.files[0]); e.target.value = '' }} />
            </label>
          </div>
          <CSVExportCard icon="📋" title="Contact Logs"            desc={`All host-VIP contact history${dateFrom||dateTo?' (filtered by date)':''}`}                                          color="#0ea5e9" loading={loadingCSV.contacts}   onExport={exportContacts} />
          <CSVExportCard icon="⬆️" title="Upgrades / Flagged"      desc="VIPs qualifying for upgrade + Bronze/Silver flagged potentials"          color="#f59e0b" loading={loadingCSV.upgrades}  onExport={exportUpgrades} />
          <CSVExportCard icon="🎂" title="Birthdays & Gifts"       desc="All VIP birthdays with latest gift log summary"                           color="#ec4899" loading={loadingCSV.birthdays} onExport={exportBirthdays} />
          <CSVExportCard icon="🔬" title="Player Profiling"        desc={t('exportPage.playerProfilingDesc')} color="#f97316" loading={loadingCSV.profiling}  onExport={exportPlayerProfiling} />
          <CSVExportCard icon="📊" title="Retention Metrics"       desc="Weekly depositor/active rates by tier — all months stored in CRM"        color="#8b5cf6" loading={loadingCSV.retention} onExport={exportRetentionMetrics} />
          <CSVExportCard icon="🎁" title="Reward Campaigns"        desc="All bonus/deposit privilege campaigns with qualifier and payout breakdown" color="#f43f5e" loading={loadingCSV.rewards}   onExport={exportRewardCampaigns} />

        {/* Export by Host */}
        <div style={{ ...s.card, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <span style={{ fontSize:28 }}>👤</span>
            <div>
              <div style={s.title}>Export by Host</div>
              <div style={s.desc}>Download VIP list for a specific host — username, tier, last deposit date, phone number</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <select
              style={{ ...s.input, width:180 }}
              value={selectedHost}
              onChange={e => setSelectedHost(e.target.value)}>
              <option value="">— Select Host —</option>
              {hosts.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <button
              style={s.btn('#7c3aed', !selectedHost || loadingCSV.byHost)}
              disabled={!selectedHost || loadingCSV.byHost}
              onClick={() => exportByHost(selectedHost)}>
              {loadingCSV.byHost ? 'Exporting...' : '⬇ Export Host VIPs'}
            </button>
          </div>
        </div>
        </div>
      </div>

      <hr style={s.divider} />

      {/* ── MONTHLY REPORT PACKAGE ── */}
      <div style={s.card}>
        <div style={s.cardHdr}>
          <span style={s.badge('#0f766e')}>PACKAGE</span>
          <div>
            <div style={s.title}>Monthly Report Package</div>
            <div style={s.desc}>Every section of the CRM for one month, current vs prior month side-by-side — ready to upload elsewhere to build the PPT (KPI data not included, that's tracked separately)</div>
          </div>
        </div>
        <div style={{ ...s.row, marginBottom: 16 }}>
          <span style={s.label}>Report month:</span>
          <input type="month" value={exportMonth} onChange={e => setExportMonth(e.target.value)} style={s.input} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.7 }}>
          Downloads up to 17 files: Tier Breakdown &amp; Retention by Region · VIP Activity ·
          Contact Activity by Host · Contact Logs (raw) · Churn &amp; Reactivation · Campaigns Summary · Campaigns Player Results (winners/achievers) ·
          Budget &amp; Expenses · Host Bonus Summary by Tier · Platinum+Diamond 3-Month Trend (upgrades/downgrades/churn) ·
          Per-VIP Benefit Report (TD before/after) · Transfer Tracker Snapshot ·
          Birthdays &amp; Gifts · Upgrade Pipeline · Player Profiling · Host Comparison · Dormant VIP List (14d &amp; 30d)
        </div>
        <button
          style={s.btn('#0f766e', loadingCSV.bundle)}
          disabled={loadingCSV.bundle}
          onClick={() => exportMonthlyPackage(exportMonth)}
        >
          {loadingCSV.bundle ? '⏳ Downloading…' : `📦 Download ${fmtMonthLabel(exportMonth)} Full Package`}
        </button>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          Tip: Upload all downloaded files to Claude and ask it to build your monthly PPT report
        </div>
      </div>
    </div>
  )
}
