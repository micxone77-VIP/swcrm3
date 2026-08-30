// CSVImport v2 — dual MY+SG upload, raw_imports history, monthly snapshot tracking
import { useState, useRef, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'

// ─── Column mappings per import type ───────────────────────────────────────
const RAW_DATA_SKIP_ROWS = 0
const TIER_FILE_SKIP_ROWS = 0

const VIP_TIERS       = ['GOLD', 'PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK']
const POTENTIAL_TIERS = ['BRONZE', 'SILVER']
const DEFAULT_THRESHOLDS = { BRONZE: 500, SILVER: 3000 }

// ─── CSV parser ─────────────────────────────────────────────────────────────
function parseCSV(text, skipRows = 0) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length <= skipRows) return []
  const headerLine = lines[skipRows]
  const splitLine = (line) => {
    const result = []
    let cur = '', inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    result.push(cur.trim())
    return result
  }
  const headers = splitLine(headerLine).map(h =>
    h.replace(/[^\x00-\x7F]/g, '').replace(/\uFEFF/g, '').trim()
  )
  const rows = []
  for (let i = skipRows + 1; i < lines.length; i++) {
    const vals = splitLine(lines[i])
    if (vals.every(v => !v)) continue
    const row = {}
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? '' })
    rows.push(row)
  }
  return rows
}

// ─── Value helpers ──────────────────────────────────────────────────────────
const toNum = (v) => {
  if (v === undefined || v === null || v === '') return 0
  const n = parseFloat(String(v).replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}
const toInt = (v) => {
  const n = parseInt(String(v).replace(/,/g, ''), 10)
  return isNaN(n) ? 0 : n
}
// Strips Excel "force text" artifacts (="123" or =+123, from Excel treating a
// leading + as a formula) and normalizes to plain digits only — no +, no
// spaces, no dashes. Returns '' if nothing usable is left.
const cleanPhone = (v) => {
  if (!v) return ''
  let s = String(v).trim()
  s = s.replace(/^="?/, '').replace(/"$/, '')
  return s.replace(/\D/g, '')
}
const toDate = (v) => {
  if (!v || v === '' || v === 'N/A') return null
  const s = String(v).trim()
  // Platform format: DD/MM/YYYY or DD/MM/YYYY HH:MM:SS
  // ALWAYS treat first part as DD, second as MM — never swap
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [datePart] = s.split(' ')
    const parts = datePart.split('/')
    const dd   = parseInt(parts[0], 10)
    const mm   = parseInt(parts[1], 10)
    const yyyy = parseInt(parts[2], 10)
    // Validate ranges
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
    // Build ISO date string directly — never use new Date(string) to avoid TZ issues
    return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
  }
  // DD-MMM-YY e.g. 05-Jun-26
  if (/^\d{2}-[A-Za-z]{3}-\d{2}$/.test(s)) {
    const months = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}
    const parts = s.split('-')
    const dd = parts[0].padStart(2,'0')
    const mm = String(months[parts[1]] || 1).padStart(2,'0')
    const yyyy = '20' + parts[2]
    return `${yyyy}-${mm}-${dd}`
  }
  // YYYY-MM-DD (already correct ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10)
  }
  return null
}
const currentYearMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthsFromDate = (dateStr) => {
  if (!dateStr) return 0
  const reg = new Date(dateStr)
  if (isNaN(reg.getTime())) return 0
  const now = new Date()
  return Math.max(0,
    (now.getFullYear() - reg.getFullYear()) * 12 +
    (now.getMonth() - reg.getMonth()) + 1
  )
}
const fmtMonth = (m) => {
  if (!m) return '-'
  const [y, mo] = m.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(mo,10)-1]} ${y}`
}

// ─── Merge MY + SG rows by username ────────────────────────────────────────
function mergeRows(myRows, sgRows) {
  if (!sgRows || sgRows.length === 0) return myRows
  if (!myRows || myRows.length === 0) return sgRows
  const map = {}
  myRows.forEach(r => {
    const key = (r['login'] || r['Member Login'] || '').trim().toLowerCase()
    if (key) map[key] = { ...r, _source: 'MY' }
  })
  sgRows.forEach(r => {
    const key = (r['login'] || r['Member Login'] || '').trim().toLowerCase()
    if (!key) return
    if (map[key]) {
      // Merge: fill in missing/zero values from SG
      Object.keys(r).forEach(col => {
        if (!map[key][col] || map[key][col] === '' || map[key][col] === '0') {
          map[key][col] = r[col]
        }
      })
      map[key]._source = 'BOTH'
    } else {
      map[key] = { ...r, _source: 'SG' }
    }
  })
  return Object.values(map)
}

// ─── IMPORT PROCESSORS ─────────────────────────────────────────────────────

async function processRawData(rows, month, thresholds, onProgress) {
  const vipRows       = rows.filter(r => VIP_TIERS.includes(r['Member Group']?.toUpperCase()))
  const potentialRows = rows.filter(r => POTENTIAL_TIERS.includes(r['Member Group']?.toUpperCase()))

  let vipUpdated = 0, vipCreated = 0, vipReset = 0, tierChanged = 0, potCreated = 0, potUpdated = 0, flagged = 0, errors = []

  // Collect all VIP usernames present in this CSV (for reset logic later)
  const csvVipUsernames = new Set(
    vipRows.map(r => r['login']?.trim()).filter(Boolean).map(u => u.toLowerCase())
  )

  // Pre-fetch current tiers for all VIP usernames in CSV (for tier change detection)
  const allCsvUsernames = vipRows.map(r => r['login']?.trim()).filter(Boolean)
  const { data: currentVipData } = await supabase
    .from('vip_members')
    .select('username, tier')
    .in('username', allCsvUsernames)
  const currentTierMap = {}
  ;(currentVipData || []).forEach(v => { currentTierMap[v.username] = v.tier })

  const tierChangeLogs = []

  // --- VIP members update ---
  const VIP_BATCH = 50
  for (let i = 0; i < vipRows.length; i += VIP_BATCH) {
    const batch = vipRows.slice(i, i + VIP_BATCH)
    for (const r of batch) {
      const username = r['login']?.trim()
      if (!username) continue
      const newTier = r['Member Group']?.toUpperCase()
      const oldTier = currentTierMap[username]

      // Detect tier change and queue log
      if (oldTier && newTier && oldTier !== newTier) {
        tierChangeLogs.push({
          username,
          old_tier:     oldTier,
          new_tier:     newTier,
          changed_at:   new Date().toISOString(),
          import_month: month,
          source:       'csv_import',
        })
      }

      const isNew = !currentTierMap[username]
      const upsertPayload = {
        username,
        vip_id:            String(r['id'] || r['ID'] || '').trim() || username,
        tier:              newTier,
        currency:          r['currency'] || r['Currency'] || 'MYR',
        total_deposit:     toNum(r['Total Deposit']),
        total_withdrawal:  toNum(r['Total Withdrawal']),
        monthly_valid_bet: toNum(r['Valid Bet']),
        win_loss:          toNum(r['Win/Loss']),
        deposit_count:     toInt(r['#Dep']),
        wd_count:          toInt(r['#Wd']),
        bet_count:         toInt(r['#Bet']),
        bonus_count:       toInt(r['Total Bonus Count']),
        bonus_amount:      toNum(r['Total Bonus']),
        has_promo:         toInt(r['Total Bonus Count']) > 0,
        total_rebate:      toNum(r['Total Rebate']),
        valid_bet_month:   month,
        updated_at:        new Date().toISOString(),
        // Only set phone when the CSV cell actually has a usable value — an
        // empty (or artifact-only) cell here should never overwrite a phone
        // number a host already corrected manually in VIP Detail. Omitting the
        // key entirely (rather than sending an empty string) means upsert
        // leaves the existing value untouched. cleanPhone() strips Excel's
        // formula-escape artifacts (="123" / =+123) and normalizes to plain
        // digits only, so "+60..." and "=+60..." and "60..." all end up the same.
        ...(cleanPhone(r['phone']) ? { phone: cleanPhone(r['phone']) } : {}),
      }
      const { error } = await supabase
        .from('vip_members')
        .upsert(upsertPayload, { onConflict: 'username' })
      if (error) errors.push(`VIP ${username}: ${error.message}`)
      else if (isNew) vipCreated++
      else vipUpdated++
    }
    onProgress(`Updating VIP members… ${Math.min(i + VIP_BATCH, vipRows.length)}/${vipRows.length}`)
  }

  // --- Save tier change logs to DB ---
  if (tierChangeLogs.length > 0) {
    onProgress(`Logging ${tierChangeLogs.length} tier change(s)…`)
    const LOG_BATCH = 50
    for (let i = 0; i < tierChangeLogs.length; i += LOG_BATCH) {
      await supabase.from('tier_change_logs').insert(tierChangeLogs.slice(i, i + LOG_BATCH))
    }
    tierChanged = tierChangeLogs.length
  }

  // --- Auto-graduate potential_players who now appear as VIPs in CSV ---
  // If a Bronze/Silver in potential_players now shows as Gold+ in the CSV, mark graduated
  onProgress('Checking for auto-graduations…')
  const csvVipMap = {}
  vipRows.forEach(r => {
    const u = r['login']?.trim()
    if (u) csvVipMap[u.toLowerCase()] = r['Member Group']?.toUpperCase()
  })

  // Fetch all non-graduated potentials
  const { data: activePotentials } = await supabase
    .from('potential_players')
    .select('id, username, tier')
    .eq('is_graduated', false)

  const toGraduate = (activePotentials || []).filter(p => {
    const csvTier = csvVipMap[p.username?.toLowerCase()]
    return csvTier && VIP_TIERS.includes(csvTier)
  })

  let autoGraduated = 0
  if (toGraduate.length > 0) {
    onProgress(`Auto-graduating ${toGraduate.length} players who moved to VIP tier…`)
    const GRAD_BATCH = 50
    for (let i = 0; i < toGraduate.length; i += GRAD_BATCH) {
      const batch = toGraduate.slice(i, i + GRAD_BATCH)
      for (const p of batch) {
        const newTier = csvVipMap[p.username?.toLowerCase()]
        await supabase.from('potential_players').update({
          is_graduated:     true,
          upgraded_at:      new Date().toISOString(),
          upgraded_to_tier: newTier,
          upgrade_flag:     false,
        }).eq('id', p.id)
        autoGraduated++
      }
    }
    onProgress(`✅ ${autoGraduated} players auto-graduated to VIP`)
  }

  // --- Reset monthly_valid_bet = 0 for VIPs NOT in this month's CSV ---
  // Fetch all active Gold/Platinum/Diamond usernames from DB
  onProgress('Resetting inactive VIP members for this month…')
  const { data: allVips } = await supabase
    .from('vip_members')
    .select('id, username')
    .in('tier', ['GOLD', 'PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK'])

  const missingVips = (allVips || []).filter(v => !csvVipUsernames.has(v.username?.toLowerCase()))

  const RESET_BATCH = 100
  for (let i = 0; i < missingVips.length; i += RESET_BATCH) {
    const batch = missingVips.slice(i, i + RESET_BATCH)
    const ids = batch.map(v => v.id)
    const { error } = await supabase
      .from('vip_members')
      .update({
        monthly_valid_bet: 0,
        win_loss:          0,
        valid_bet_month:   month,
        updated_at:        new Date().toISOString(),
      })
      .in('id', ids)
    if (!error) vipReset += batch.length
  }

  // --- Potential players upsert ---
  const thresh = thresholds || DEFAULT_THRESHOLDS
  const POT_BATCH = 100

  for (let i = 0; i < potentialRows.length; i += POT_BATCH) {
    const batch = potentialRows.slice(i, i + POT_BATCH)
    const usernames = batch.map(r => r['login']?.trim()).filter(Boolean)
    const { data: existing } = await supabase
      .from('potential_players')
      .select('username, first_seen_month, is_graduated')
      .in('username', usernames)

    const existingMap = {}
    ;(existing || []).forEach(e => { existingMap[e.username] = e })

    for (const r of batch) {
      const username = r['login']?.trim()
      if (!username) continue

      const tier        = r['Member Group']?.toUpperCase()
      const validBet    = toNum(r['Valid Bet'])
      const regDate     = toDate(r['Registration date'])
      const existingRow = existingMap[username]

      if (existingRow?.is_graduated) continue

      const upgradeThreshold = thresh[tier] ?? 99999999
      const shouldFlag = validBet >= upgradeThreshold

      const upsertData = {
        username,
        tier,
        currency:           r['currency'] || r['Currency'] || 'MYR',
        registration_date:  regDate,
        total_deposit:      toNum(r['Total Deposit']),
        total_withdrawal:   toNum(r['Total Withdrawal']),
        total_rebate:       toNum(r['Total Rebate']),
        total_reward:       toNum(r['Total Reward']),
        total_win_loss:     toNum(r['Total W/L']),
        deposit_count:      toInt(r['#Dep']),
        withdrawal_count:   toInt(r['#Wd']),
        monthly_valid_bet:  validBet,
        monthly_win_loss:   toNum(r['Win/Loss']),
        monthly_deposit:    toNum(r['Total Deposit']),
        monthly_withdrawal: toNum(r['Total Withdrawal']),
        valid_bet_month:    month,
        first_seen_month:   existingRow?.first_seen_month ?? month,
        last_import_month:  month,
        months_active:      monthsFromDate(regDate),
        upgrade_flag:       shouldFlag,
        upgrade_flagged_at: shouldFlag && !existingRow ? new Date().toISOString() : undefined,
        updated_at:         new Date().toISOString(),
      }
      Object.keys(upsertData).forEach(k => upsertData[k] === undefined && delete upsertData[k])

      const { error } = await supabase
        .from('potential_players')
        .upsert(upsertData, { onConflict: 'username' })

      if (error) { errors.push(`Potential ${username}: ${error.message}`); continue }

      if (existingRow) potUpdated++
      else potCreated++
      if (shouldFlag) flagged++

      await supabase.from('potential_snapshots').upsert({
        username,
        snapshot_month:    month,
        tier,
        monthly_valid_bet: validBet,
        monthly_deposit:   toNum(r['Total Deposit']),
        monthly_win_loss:  toNum(r['Win/Loss']),
        total_deposit:     toNum(r['Total Deposit']),
      }, { onConflict: 'username,snapshot_month' })
    }

    onProgress(`Processing Bronze/Silver… ${Math.min(i + POT_BATCH, potentialRows.length)}/${potentialRows.length}`)
  }

  return { vipUpdated, vipCreated, vipReset, tierChanged, tierChangeLogs, autoGraduated, potCreated, potUpdated, flagged, errors }
}

async function processTierFile(rows, tierLabel, onProgress) {
  let updated = 0, notFound = 0, created = 0, errors = [], notFoundUsernames = []
  const BATCH = 50

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    for (const r of batch) {
      const username = (r['Member Login'] || '').trim()
      if (!username) continue

      const lastDepDate = toDate(r['Last Deposit Date'])
      let daysInactive = null
      if (lastDepDate) {
        const diff = Date.now() - new Date(lastDepDate).getTime()
        daysInactive = Math.floor(diff / (1000 * 60 * 60 * 24))
      }

      const lastDepDateStr = lastDepDate ? lastDepDate.split('T')[0] : null
      const regDateStr = toDate(r['Register Date'])
      const regDateOnly = regDateStr ? regDateStr.split('T')[0] : null
      const currency = r['Currency'] || (r['Region'] === 'Singapore' ? 'SGD' : r['Region'] === 'Cambodia' ? 'KHUSD' : 'MYR')

      const updateData = {
        last_deposit_date: lastDepDateStr,
        days_inactive:     daysInactive,
        total_turnover:    toNum(r['Total Turnover']),
        total_rebate:      toNum(r['Total Rebate']),
        total_reward:      toNum(r['Total Reward']),
        total_deposit:     toNum(r['Total Deposit Amount']),
        total_withdrawal:  toNum(r['Total Withdraw Amount']),
        deposit_count:     toInt(r['Total Deposit Count']),
        registration_date: regDateOnly,
        region:            r['Region'] || null,
        currency,
        updated_at:        new Date().toISOString(),
      }
      Object.keys(updateData).forEach(k => { if (updateData[k] === null || updateData[k] === undefined) delete updateData[k] })

      // Case-insensitive match: platform exports and vip_members usernames may differ in case
      const { data, error } = await supabase
        .from('vip_members')
        .update(updateData)
        .ilike('username', username)
        .select('id')

      if (error) { errors.push(`${username}: ${error.message}`); continue }

      if (data && data.length > 0) { updated++; continue }

      // Not found by update — player reached this tier but was never created by the daily raw import.
      // Create them now instead of silently dropping their data.
      const insertPayload = {
        username,
        vip_id:            username,
        tier:               tierLabel,
        currency,
        total_deposit:      toNum(r['Total Deposit Amount']),
        total_withdrawal:   toNum(r['Total Withdraw Amount']),
        total_rebate:       toNum(r['Total Rebate']),
        deposit_count:      toInt(r['Total Deposit Count']),
        total_turnover:     toNum(r['Total Turnover']),
        last_deposit_date:  lastDepDateStr,
        days_inactive:      daysInactive,
        registration_date:  regDateOnly,
        region:             r['Region'] || null,
        is_excluded:        false,
        updated_at:         new Date().toISOString(),
      }
      Object.keys(insertPayload).forEach(k => { if (insertPayload[k] === null || insertPayload[k] === undefined) delete insertPayload[k] })

      const { error: insertError } = await supabase
        .from('vip_members')
        .upsert(insertPayload, { onConflict: 'username' })

      if (insertError) {
        errors.push(`${username}: could not create — ${insertError.message}`)
        notFound++; notFoundUsernames.push(username)
      } else {
        created++
      }
    }
    onProgress(`Updating ${tierLabel} members… ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }

  return { updated, notFound, created, errors, notFoundUsernames }
}

// ─── IMPORT 3: Retention Engagement CSV ─────────────────────────────────────
async function processRetentionData(rows, onProgress) {
  let inserted = 0, updated = 0, errors = []
  // Expected columns: Month, Tier, Total Members, Metric Type, 1-7, 8-14, 15-21, 22-end, Monthly, ...pct cols
  for (const r of rows) {
    if (!r['Month'] || !r['Tier'] || !r['Metric Type']) continue
    const month = r['Month']?.trim()
    const tier  = r['Tier']?.trim().toUpperCase()
    const metricType = r['Metric Type']?.trim()
    if (!month || !tier || !metricType) continue

    const toP = (v) => {
      if (!v || v === '') return null
      const s = String(v).replace('%','').trim()
      const n = parseFloat(s)
      return isNaN(n) ? null : n
    }

    const record = {
      month,
      tier,
      metric_type:  metricType,
      total_members: parseInt(r['Total Members']) || null,
      week1:  parseFloat(r['1-7'])    || null,
      week2:  parseFloat(r['8-14'])   || null,
      week3:  parseFloat(r['15-21'])  || null,
      week4:  parseFloat(r['22-end']) || null,
      monthly: parseFloat(r['Monthly']) || null,
      week1_pct:  toP(r['1-7_pct']  || Object.values(r)[9]),
      week2_pct:  toP(r['8-14_pct'] || Object.values(r)[10]),
      week3_pct:  toP(r['15-21_pct']|| Object.values(r)[11]),
      week4_pct:  toP(r['22-end_pct']||Object.values(r)[12]),
      monthly_pct: toP(r['Monthly_pct']||Object.values(r)[13]),
    }
    Object.keys(record).forEach(k => record[k] === null && delete record[k])

    const { error } = await supabase
      .from('retention_metrics')
      .upsert(record, { onConflict: 'month,tier,metric_type' })
    if (error) errors.push(`${month}/${tier}/${metricType}: ${error.message}`)
    else inserted++
  }
  onProgress(`Retention metrics: ${inserted} rows saved`)
  return { inserted, errors }
}

// ─── IMPORT 4: Reward Campaign CSV ──────────────────────────────────────────
async function processRewardCampaign(rows, campaignName, month, platform, currency, userId, onProgress) {
  // Parse summary rows — flexible structure
  let totalEntries = 0, tier1Q = 0, tier2Q = 0, totalIssued = 0, totalPending = 0
  const groupEntries = []

  for (const r of rows) {
    const vals = Object.values(r).map(v => String(v||'').trim())
    const keys = Object.keys(r)

    // Detect KPI summary rows
    if (vals[0]?.includes('Total Entries') || vals[1]?.includes('Total Entries')) {
      totalEntries = parseInt(vals.find(v => /^\d+$/.test(v))) || 0
    }
    if (vals[0]?.includes('Tier 1 Qualifiers') || vals[1]?.includes('Tier 1 Qualifiers')) {
      tier1Q = parseInt(vals.find(v => /^\d+$/.test(v))) || 0
    }
    if (vals[0]?.includes('Tier 2 Qualifiers') || vals[1]?.includes('Tier 2 Qualifiers')) {
      tier2Q = parseInt(vals.find(v => /^\d+$/.test(v))) || 0
    }
    if (vals[1]?.includes('Rewards Issued') || vals[0]?.includes('Rewards Issued')) {
      const numVal = vals.find(v => /^[\d,]+$/.test(v))
      if (numVal) totalIssued = parseFloat(numVal.replace(/,/g,'')) || 0
    }
    if (vals[1]?.includes('Rewards Pending') || vals[0]?.includes('Rewards Pending')) {
      const numVal = vals.find(v => /^[\d,]+$/.test(v))
      if (numVal) totalPending = parseFloat(numVal.replace(/,/g,'')) || 0
    }

    // Detect member group breakdown rows (BRONZE, SILVER, GOLD, PLATINUM, DIAMOND)
    const tierNames = ['BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','BLACK']
    const groupVal = vals.find(v => tierNames.includes(v.toUpperCase()))
    if (groupVal) {
      const nums = vals.filter(v => /^[\d,]+$/.test(v.replace(/,/g,''))).map(v => parseFloat(v.replace(/,/g,''))||0)
      groupEntries.push({
        member_group: groupVal.toUpperCase(),
        tier1_qualifiers: nums[0] || 0,
        tier2_qualifiers: nums[1] || 0,
        total_qualifiers: nums[2] || 0,
        total_reward:     nums[3] || 0,
        currency,
      })
    }
  }

  onProgress(`Saving campaign: ${campaignName} (${month})…`)

  // Insert campaign header
  const { data: camp, error: campErr } = await supabase
    .from('reward_campaigns')
    .upsert({
      campaign_name:         campaignName,
      month,
      platform,
      total_entries:         totalEntries,
      tier1_qualifiers:      tier1Q,
      tier2_qualifiers:      tier2Q,
      total_rewards_issued:  totalIssued,
      total_rewards_pending: totalPending,
      currency,
      created_by: userId || null,
    }, { onConflict: 'campaign_name,month' })
    .select('id')
    .single()

  if (campErr) return { inserted: 0, errors: [campErr.message] }

  // Insert group breakdown entries
  if (groupEntries.length > 0 && camp?.id) {
    await supabase.from('reward_campaign_entries').delete().eq('campaign_id', camp.id)
    await supabase.from('reward_campaign_entries').insert(
      groupEntries.map(e => ({ ...e, campaign_id: camp.id }))
    )
  }

  onProgress(`Campaign saved: ${groupEntries.length} tier groups`)
  return { inserted: 1 + groupEntries.length, errors: [] }
}

// ─── STYLES ────────────────────────────────────────────────────────────────
const s = {
  page: { padding: '28px 32px', maxWidth: 900, margin: '0 auto', color: 'var(--text)' },
  heading: { fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  sub: { fontSize: 13, color: 'var(--muted)', marginBottom: 28 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '22px 24px', marginBottom: 16 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  badge: (color) => ({ background: color, color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, letterSpacing: '0.05em' }),
  cardTitle: { fontSize: 15, fontWeight: 600, color: 'var(--text)' },
  cardDesc: { fontSize: 12, color: 'var(--muted)', marginTop: 2 },
  dropzone: (active) => ({
    border: `2px dashed ${active ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer',
    background: active ? 'rgba(99,102,241,0.06)' : 'var(--bg)', transition: 'all 0.2s', marginBottom: 12,
  }),
  dropText: { fontSize: 13, color: 'var(--muted)', marginBottom: 6 },
  fileName: { fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 },
  monthRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  monthLabel: { fontSize: 13, color: 'var(--muted)', minWidth: 110 },
  monthInput: { padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 },
  btn: (disabled, color = 'var(--accent)') => ({
    padding: '8px 20px', borderRadius: 7, border: 'none',
    background: disabled ? 'var(--border)' : color,
    color: disabled ? 'var(--muted)' : '#fff',
    fontWeight: 600, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', transition: 'opacity 0.15s',
  }),
  progress: { fontSize: 12, color: 'var(--muted)', marginTop: 8, fontStyle: 'italic' },
  result: (ok) => ({
    marginTop: 12, padding: '10px 14px', borderRadius: 8,
    background: ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
    border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
    fontSize: 13, color: ok ? '#4ade80' : '#f87171',
  }),
  statRow: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 },
  stat: { fontSize: 12, color: 'var(--muted)', background: 'var(--bg)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)' },
  divider: { border: 'none', borderTop: '1px solid var(--border)', margin: '24px 0' },
  historyRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
    borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)',
    marginBottom: 6, fontSize: 13,
  },
  pill: (color) => ({
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
    background: color + '22', color: color, border: `1px solid ${color}44`,
  }),
}

// ─── DROPZONE COMPONENT ────────────────────────────────────────────────────
function Dropzone({ onFile, file, label, accept = '.csv' }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef()

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <div>
      {label && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>}
      <div
        style={s.dropzone(dragging)}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }}
          onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
        {file
          ? <>
              <div style={s.fileName}>📄 {file.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{(file.size / 1024).toFixed(1)} KB · click to change</div>
            </>
          : <div style={s.dropText}>Drop CSV here or <span style={{ color: 'var(--accent)', fontWeight: 600 }}>click to browse</span></div>
        }
      </div>
    </div>
  )
}

// ─── MULTI-FILE DROPZONE ──────────────────────────────────────────────────
function MultiDropzone({ onFiles, files, label }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef()

  const addFiles = useCallback((newFiles) => {
    const arr = Array.from(newFiles).filter(f => f.name.endsWith('.csv'))
    if (arr.length === 0) return
    onFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...arr.filter(f => !existing.has(f.name))]
    })
  }, [onFiles])

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const removeFile = (name) => onFiles(prev => prev.filter(f => f.name !== name))

  return (
    <div>
      {label && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>}
      <div
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8, padding: '14px 16px', cursor: 'pointer',
          background: dragging ? 'rgba(99,102,241,0.06)' : 'var(--bg)', transition: 'all 0.2s', marginBottom: 8,
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".csv" multiple style={{ display: 'none' }}
          onChange={(e) => addFiles(e.target.files)} />
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
          Drop CSV files here or <span style={{ color: 'var(--accent)', fontWeight: 600 }}>click to browse</span>
          <span style={{ fontSize: 11, display: 'block', marginTop: 3 }}>Multiple files supported</span>
        </div>
      </div>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map(f => (
            <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>📄</span>
              <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{(f.size/1024).toFixed(0)} KB</span>
              <button onClick={(e) => { e.stopPropagation(); removeFile(f.name) }}
                style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
function ResultBox({ result }) {
  if (!result) return null
  const ok = !result.error && result.errors?.length === 0
  return (
    <div style={s.result(ok)}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{ok ? '✓ Import complete' : '⚠ Import finished with issues'}</div>
      <div style={s.statRow}>
        {result.myRows    != null && <span style={s.stat}>MY rows: {result.myRows}</span>}
        {result.sgRows    != null && <span style={s.stat}>SG rows: {result.sgRows}</span>}
        {result.merged    != null && <span style={s.stat}>Merged total: {result.merged}</span>}
        {result.vipCreated   != null && result.vipCreated > 0 && <span style={{ ...s.stat, color: '#3fb950', borderColor: '#3fb95044' }}>✨ New VIPs: {result.vipCreated}</span>}
        {result.dailySnapshotSaved != null && <span style={s.stat}>📅 Daily snapshot: {result.dailySnapshotSaved} saved</span>}
        {result.potentialDailySnapshotSaved != null && <span style={s.stat}>📅 Potential daily snapshot: {result.potentialDailySnapshotSaved} saved</span>}
        {result.autoReactivated != null && result.autoReactivated > 0 && <span style={{ ...s.stat, color:'#3fb950', borderColor:'#3fb95044' }}>✅ Auto-reactivated: {result.autoReactivated}</span>}
        {result.vipUpdated   != null && <span style={s.stat}>VIP updated: {result.vipUpdated}</span>}
        {result.vipReset     != null && result.vipReset > 0 && <span style={s.stat}>VIP reset to 0: {result.vipReset}</span>}
        {result.tierChanged    != null && result.tierChanged > 0 && <span style={{ ...s.stat, color: '#f59e0b', borderColor: '#f59e0b44' }}>⚡ Tier changes: {result.tierChanged}</span>}
        {result.autoGraduated != null && result.autoGraduated > 0 && <span style={{ ...s.stat, color: '#3fb950', borderColor: '#3fb95044' }}>🎓 Auto-graduated: {result.autoGraduated}</span>}
        {result.potCreated   != null && <span style={s.stat}>New potentials: {result.potCreated}</span>}
        {result.potUpdated   != null && <span style={s.stat}>Potentials refreshed: {result.potUpdated}</span>}
        {result.flagged      != null && <span style={s.stat}>Upgrade flagged: {result.flagged}</span>}
        {result.updated      != null && <span style={s.stat}>Updated: {result.updated}</span>}
        {result.created      != null && result.created > 0 && <span style={{ ...s.stat, color: '#3fb950', borderColor: '#3fb95044' }}>✨ New VIPs created: {result.created}</span>}
        {result.notFound     != null && result.notFound > 0 && <span style={s.stat}>Not in VIP list: {result.notFound}</span>}
      </div>
      {result.notFoundUsernames?.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
            ⚠ {result.notFoundUsernames.length} username(s) could not be created — click to review
          </summary>
          <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto', fontSize: 11 }}>
            {result.notFoundUsernames.map((u, i) => (
              <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>{u}</div>
            ))}
          </div>
        </details>
      )}
      {result.errors?.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>{result.errors.length} row error(s)</summary>
          <div style={{ marginTop: 6, maxHeight: 120, overflowY: 'auto', fontSize: 11 }}>
            {result.errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        </details>
      )}
      {result.tierChangeLogs?.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
            ⚡ {result.tierChangeLogs.length} tier change(s) — click to review
          </summary>
          <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto', fontSize: 11 }}>
            {result.tierChangeLogs.map((t, i) => (
              <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <strong>{t.username}</strong>
                <span style={{ color: 'var(--muted)', margin: '0 6px' }}>{t.old_tier}</span>
                <span style={{ color: '#f59e0b' }}>→</span>
                <span style={{ color: '#3fb950', marginLeft: 6 }}>{t.new_tier}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ─── IMPORT HISTORY ────────────────────────────────────────────────────────
function ImportHistory({ refresh }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('raw_imports')
        .select('id, import_month, import_date, row_count, notes')
        .order('import_date', { ascending: false })
        .limit(20)
      setHistory(data || [])
      setLoading(false)
    }
    load()
  }, [refresh])

  const typeColor = (notes) => {
    if (!notes) return '#8b949e'
    if (notes.includes('MY+SG')) return '#b9f2ff'
    if (notes.includes('MY'))    return '#3fb950'
    if (notes.includes('SG'))    return '#f59e0b'
    if (notes.includes('Tier'))  return '#a78bfa'
    return '#8b949e'
  }

  const shown = expanded ? history : history.slice(0, 5)

  return (
    <div style={{ ...s.card, marginBottom: 24 }}>
      <div style={s.cardHeader}>
        <span style={s.badge('#0ea5e9')}>HISTORY</span>
        <div>
          <div style={s.cardTitle}>Import History</div>
          <div style={s.cardDesc}>All past uploads — so you always know what's been loaded</div>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading history…</div>
      ) : history.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No imports yet. Upload your first file below.</div>
      ) : (
        <>
          {shown.map(h => (
            <div key={h.id} style={s.historyRow}>
              <span style={{ fontSize: 18 }}>📦</span>
              <span style={{ fontWeight: 700, minWidth: 80, color: 'var(--text)' }}>{fmtMonth(h.import_month)}</span>
              <span style={s.pill(typeColor(h.notes))}>{h.notes || 'Import'}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{h.row_count?.toLocaleString()} rows</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                {new Date(h.import_date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
          {history.length > 5 && (
            <button onClick={() => setExpanded(e => !e)}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', marginTop: 4 }}>
              {expanded ? '▲ Show less' : `▼ Show all ${history.length} imports`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────
export default function CSVImport() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [importMonth, setImportMonth] = useState(currentYearMonth())
  const [snapshotDate, setSnapshotDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [missingDays, setMissingDays] = useState(null) // { daysWithData: Set, totalDaysSoFar, monthLabel }

  useEffect(() => { checkMissingDays(importMonth) }, [importMonth, historyRefresh])

  async function checkMissingDays(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number)
    const today = new Date()
    const isCurrentMonth = today.getFullYear() === y && (today.getMonth() + 1) === m
    const lastDay = isCurrentMonth ? today.getDate() : new Date(y, m, 0).getDate()

    const monthStart = `${yearMonth}-01`
    const monthEnd   = `${yearMonth}-${String(lastDay).padStart(2,'0')}`

    // NOTE: previously this fetched every row in the date range and derived distinct dates
    // client-side — but Supabase caps unbounded selects at 1000 rows by default, so with
    // ~450+ players/day, anything past day ~2 silently never got counted. Pull distinct
    // snapshot_date values directly instead (bounded to at most 31 rows for a month).
    // NOTE: previously tried .limit(100000) assuming it would override Supabase's default
    // row cap — it does not. PostgREST enforces a hard server-side max-rows limit (1000)
    // that .limit() cannot exceed. Must paginate with .range() to get every row.
    let allDates = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data: page, error } = await supabase
        .from('vip_daily_snapshots')
        .select('snapshot_date')
        .gte('snapshot_date', monthStart)
        .lte('snapshot_date', monthEnd)
        .order('snapshot_date', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) { console.error('checkMissingDays page error:', error); break }
      if (!page || page.length === 0) break
      allDates = allDates.concat(page)
      if (page.length < PAGE) break // last page
      from += PAGE
    }

    const daysWithData = new Set(allDates.map(r => r.snapshot_date.slice(8, 10).replace(/^0/, '')))
    const missing = []
    for (let d = 1; d <= lastDay; d++) {
      if (!daysWithData.has(String(d))) missing.push(d)
    }
    setMissingDays({ missing, lastDay, monthLabel: yearMonth })
  }

  // Raw Data — multi-file MY + SG
  const [rawMyFiles,   setRawMyFiles]   = useState([])
  const [rawSgFiles,   setRawSgFiles]   = useState([])
  const [rawLoading,   setRawLoading]   = useState(false)
  const [rawProgress,  setRawProgress]  = useState('')
  const [rawResult,    setRawResult]    = useState(null)

  // Tier files
  const [goldFile,     setGoldFile]     = useState(null)
  const [platFile,     setPlatFile]     = useState(null)
  const [diaFile,      setDiaFile]      = useState(null)
  const [tierLoading,  setTierLoading]  = useState(false)
  const [tierProgress, setTierProgress] = useState('')
  const [tierResult,   setTierResult]   = useState(null)

  const readFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })

  const fetchThresholds = async () => {
    const { data } = await supabase
      .from('upgrade_thresholds')
      .select('from_tier, threshold')
      .eq('is_active', true)
    if (!data) return DEFAULT_THRESHOLDS
    const t = {}
    data.forEach(r => {
      if (!t[r.from_tier] || r.threshold < t[r.from_tier]) {
        t[r.from_tier] = r.threshold
      }
    })
    return t
  }

  const saveImportRecord = async (month, rowCount, notes) => {
    await supabase.from('raw_imports').insert({
      import_month: month,
      import_date:  new Date().toISOString(),
      imported_by:  profile?.id || null,
      row_count:    rowCount,
      notes,
    })
    setHistoryRefresh(n => n + 1)
  }

  // Save current vip_members state as a snapshot for this month
  const saveVipSnapshot = async (month, onProgress) => {
    onProgress('Saving VIP snapshot for this month…')
    const { data: vips } = await supabase
      .from('vip_members')
      .select('username, tier, monthly_valid_bet, total_deposit, total_withdrawal, days_inactive, host_assigned, region, currency, win_loss, bet_count, bonus_count, bonus_amount, has_promo, total_rebate')
      .in('tier', ['GOLD', 'PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK'])
      .eq('is_excluded', false)

    if (!vips || vips.length === 0) return

    const SNAP_BATCH = 100
    let saved = 0
    for (let i = 0; i < vips.length; i += SNAP_BATCH) {
      const batch = vips.slice(i, i + SNAP_BATCH).map(v => ({
        snapshot_month:    month,
        username:          v.username,
        tier:              v.tier,
        monthly_valid_bet: v.monthly_valid_bet || 0,
        total_deposit:     v.total_deposit     || 0,
        total_withdrawal:  v.total_withdrawal  || 0,
        days_inactive:     v.days_inactive,
        host_assigned:     v.host_assigned,
        region:            v.region,
        currency:          v.currency,
        win_loss:          v.win_loss          || 0,
        bet_count:         v.bet_count         || 0,
        bonus_count:       v.bonus_count       || 0,
        bonus_amount:      v.bonus_amount      || 0,
        has_promo:         v.has_promo         || false,
        total_rebate:      v.total_rebate      || 0,
      }))
      await supabase
        .from('vip_snapshots')
        .upsert(batch, { onConflict: 'snapshot_month,username' })
      saved += batch.length
      onProgress(`Saving snapshot… ${saved}/${vips.length}`)
    }
    onProgress(`✅ Snapshot saved: ${saved} VIPs for ${month}`)
  }

  // Save current vip_members state as a DAILY snapshot (for calendar heatmap)
  // dateStr: 'YYYY-MM-DD' — defaults to today, but can be backdated to cover missed days
  const saveDailySnapshot = async (dateStr, onProgress) => {
    onProgress(`Saving daily snapshot for ${dateStr}…`)
    const { data: vips, error: fetchErr } = await supabase
      .from('vip_members')
      .select('username, tier, total_deposit, total_withdrawal, monthly_valid_bet, win_loss, bet_count, bonus_count, bonus_amount, total_rebate, has_promo, currency, host_assigned')
      .in('tier', ['GOLD', 'PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK'])
      .eq('is_excluded', false)

    if (fetchErr) {
      onProgress(`⚠ Daily snapshot: failed to fetch VIPs — ${fetchErr.message}`)
      return { saved: 0, errors: [fetchErr.message] }
    }
    if (!vips || vips.length === 0) {
      onProgress('⚠ Daily snapshot: no VIPs found to snapshot')
      return { saved: 0, errors: [] }
    }

    const SNAP_BATCH = 200
    let saved = 0
    const errors = []
    for (let i = 0; i < vips.length; i += SNAP_BATCH) {
      const batch = vips.slice(i, i + SNAP_BATCH).map(v => ({
        username:           v.username,
        snapshot_date:      dateStr,
        tier:                v.tier,
        total_deposit:       v.total_deposit     || 0,
        total_withdrawal:    v.total_withdrawal  || 0,
        monthly_valid_bet:   v.monthly_valid_bet || 0,
        win_loss:            v.win_loss          || 0,
        bet_count:           v.bet_count         || 0,
        bonus_count:         v.bonus_count       || 0,
        bonus_amount:        v.bonus_amount      || 0,
        total_rebate:        v.total_rebate      || 0,
        has_promo:           v.has_promo         || false,
        currency:            v.currency          || 'MYR',
        host_assigned:       v.host_assigned     || null,
      }))
      const { error } = await supabase
        .from('vip_daily_snapshots')
        .upsert(batch, { onConflict: 'username,snapshot_date' })
      if (error) {
        errors.push(error.message)
        onProgress(`⚠ Daily snapshot batch failed: ${error.message}`)
      } else {
        saved += batch.length
      }
      onProgress(`Saving daily snapshot… ${saved}/${vips.length}`)
    }
    if (errors.length > 0) {
      onProgress(`⚠ Daily snapshot finished with errors: ${saved} saved, ${errors.length} batch error(s)`)
    } else {
      onProgress(`✅ Daily snapshot saved: ${saved} VIPs for ${dateStr}`)
    }
    return { saved, errors }
  }

  // Save current potential_players (Bronze/Silver) state as a daily snapshot —
  // same reasoning as saveDailySnapshot for VIPs: CSV uploads are daily, so
  // potential_players.monthly_valid_bet is also just the last uploaded day's number.
  const savePotentialDailySnapshot = async (dateStr, onProgress) => {
    onProgress(`Saving potential players daily snapshot for ${dateStr}…`)
    const { data: pots, error: fetchErr } = await supabase
      .from('potential_players')
      .select('username, tier, monthly_valid_bet')
      .eq('is_graduated', false)

    if (fetchErr) {
      onProgress(`⚠ Potential daily snapshot: failed to fetch — ${fetchErr.message}`)
      return { saved: 0, errors: [fetchErr.message] }
    }
    if (!pots || pots.length === 0) {
      return { saved: 0, errors: [] }
    }

    const SNAP_BATCH = 200
    let saved = 0
    const errors = []
    for (let i = 0; i < pots.length; i += SNAP_BATCH) {
      const batch = pots.slice(i, i + SNAP_BATCH).map(p => ({
        username:           p.username,
        snapshot_date:      dateStr,
        tier:                p.tier,
        monthly_valid_bet:   p.monthly_valid_bet || 0,
      }))
      const { error } = await supabase
        .from('potential_daily_snapshots')
        .upsert(batch, { onConflict: 'username,snapshot_date' })
      if (error) {
        errors.push(error.message)
        onProgress(`⚠ Potential daily snapshot batch failed: ${error.message}`)
      } else {
        saved += batch.length
      }
    }
    if (errors.length > 0) {
      onProgress(`⚠ Potential daily snapshot finished with errors: ${saved} saved`)
    } else {
      onProgress(`✅ Potential daily snapshot saved: ${saved} players for ${dateStr}`)
    }
    return { saved, errors }
  }

  // Auto-detect reactivations: if a VIP has valid_bet > 0 today but had 3+ consecutive
  // days of valid_bet = 0 immediately before, automatically log them as reactivated.
  const autoDetectReactivations = async (dateStr, onProgress) => {
    onProgress('Checking for auto-reactivations…')

    // Find VIPs active today AND all GOLD+/non-excluded VIPs (fetch separately to avoid .in() URL length issues)
    const [{ data: activeToday, error: activeErr }, { data: vipList }] = await Promise.all([
      supabase.from('vip_daily_snapshots').select('username, monthly_valid_bet').eq('snapshot_date', dateStr).gt('monthly_valid_bet', 0),
      supabase.from('vip_members').select('username, tier, host_assigned').in('tier', ['GOLD', 'PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK']).eq('is_excluded', false),
    ])

    if (activeErr || !activeToday || activeToday.length === 0) return { detected: 0 }

    // Filter to only VIP members (not potential players)
    const vipSet = new Set((vipList || []).map(v => v.username))
    const vipInfoMap = {}
    ;(vipList || []).forEach(v => { vipInfoMap[v.username] = v })
    const activeVIPs = activeToday.filter(p => vipSet.has(p.username))

    // For each active player, check if they had 3+ days of inactivity before today
    const snapshotMonth = dateStr.slice(0, 7)
    const reactivated = []

    for (const player of activeVIPs) {
      // Get their last 4 snapshots before today (to check 3 days of inactivity)
      const { data: prevSnaps } = await supabase
        .from('vip_daily_snapshots')
        .select('snapshot_date, monthly_valid_bet')
        .eq('username', player.username)
        .lt('snapshot_date', dateStr)
        .order('snapshot_date', { ascending: false })
        .limit(4)

      if (!prevSnaps || prevSnaps.length < 3) continue

      // Check if last 3 days were all 0
      const last3 = prevSnaps.slice(0, 3)
      const allInactive = last3.every(s => (parseFloat(s.monthly_valid_bet) || 0) === 0)
      if (!allInactive) continue

      // Check not already logged this month
      const { data: existing } = await supabase
        .from('reactivation_logs')
        .select('id')
        .eq('username', player.username)
        .eq('reactivated_month', snapshotMonth)
        .limit(1)
      if (existing && existing.length > 0) continue

      // Auto-log reactivation using vipInfoMap (no extra query needed)
      const vipInfo = vipInfoMap[player.username] || {}
      await supabase.from('reactivation_logs').insert({
        username:           player.username,
        tier:               vipInfo.tier || '',
        host_name:          vipInfo.host_assigned || '',
        reactivated_month:  snapshotMonth,
        notes:              `Auto-detected: valid_bet resumed after 3+ inactive days (${dateStr})`,
        created_at:         new Date().toISOString(),
      })
      reactivated.push(player.username)
    }

    if (reactivated.length > 0) {
      onProgress(`✅ Auto-reactivations detected: ${reactivated.length} (${reactivated.slice(0,3).join(', ')}${reactivated.length > 3 ? '…' : ''})`)
    }
    return { detected: reactivated.length }
  }
  const handleRawImport = async () => {
    if (rawMyFiles.length === 0 && rawSgFiles.length === 0) return
    setRawLoading(true)
    setRawResult(null)
    setRawProgress('Reading files…')

    try {
      let myRows = [], sgRows = []

      // Read all MY files and combine
      for (const file of rawMyFiles) {
        const text = await readFile(file)
        const rows = parseCSV(text, RAW_DATA_SKIP_ROWS)
        myRows = [...myRows, ...rows]
        setRawProgress(`MY: ${myRows.length} rows parsed`)
      }

      // Read all SG files and combine
      for (const file of rawSgFiles) {
        const text = await readFile(file)
        const rows = parseCSV(text, RAW_DATA_SKIP_ROWS)
        sgRows = [...sgRows, ...rows]
        setRawProgress(`SG: ${sgRows.length} rows parsed`)
      }

      // Deduplicate within MY and SG by username (keep last occurrence)
      const dedup = (rows) => {
        const map = {}
        rows.forEach(r => {
          const key = (r['login'] || '').trim().toLowerCase()
          if (key) map[key] = r
        })
        return Object.values(map)
      }
      myRows = dedup(myRows)
      sgRows = dedup(sgRows)

      const sourceLabel = rawMyFiles.length > 0 && rawSgFiles.length > 0 ? 'MY+SG'
        : rawMyFiles.length > 0 ? 'MY only' : 'SG only'
      const myFileCount = rawMyFiles.length, sgFileCount = rawSgFiles.length

      const mergedRows = mergeRows(myRows, sgRows)
      setRawProgress(`Merged ${mergedRows.length} rows (${myFileCount} MY file${myFileCount!==1?'s':''} + ${sgFileCount} SG file${sgFileCount!==1?'s':''}). Fetching thresholds…`)

      const thresholds = await fetchThresholds()
      setRawProgress('Starting import…')

      const result = await processRawData(mergedRows, importMonth, thresholds, setRawProgress)

      // Save to raw_imports history
      await saveImportRecord(importMonth, mergedRows.length, `Raw Data · ${sourceLabel} (${myFileCount+sgFileCount} files)`)

      // Save VIP snapshot for this month
      await saveVipSnapshot(importMonth, setRawProgress)

      // Save daily snapshot (for calendar heatmap) — uses the selected snapshot date,
      // so missed days can be backdated instead of always saving as "today"
      const dailySnapResult = await saveDailySnapshot(snapshotDate, setRawProgress)
      const potDailySnapResult = await savePotentialDailySnapshot(snapshotDate, setRawProgress)
      const reactivationResult = await autoDetectReactivations(snapshotDate, setRawProgress)
      setHistoryRefresh(n => n + 1) // also refresh the missing-days indicator

      setRawResult({
        ...result,
        myRows:  myRows.length,
        sgRows:  sgRows.length,
        merged:  mergedRows.length,
        tierChanged:    result.tierChanged || 0,
        tierChangeLogs: result.tierChangeLogs || [],
        autoGraduated:  result.autoGraduated || 0,
        dailySnapshotSaved: dailySnapResult?.saved || 0,
        potentialDailySnapshotSaved: potDailySnapResult?.saved || 0,
        autoReactivated: reactivationResult?.detected || 0,
        errors: [...(result.errors || []), ...(dailySnapResult?.errors || []), ...(potDailySnapResult?.errors || [])],
      })
      setRawProgress('')
    } catch (err) {
      setRawResult({ error: err.message, errors: [err.message] })
      setRawProgress('')
    }
    setRawLoading(false)
  }

  // ── IMPORT 2: Tier files ───────────────────────────────────────────────
  const handleTierImport = async () => {
    if (!goldFile && !platFile && !diaFile) return
    setTierLoading(true)
    setTierResult(null)

    let totalUpdated = 0, totalNotFound = 0, allErrors = []
    const tierJobs = [
      { file: goldFile, label: 'GOLD' },
      { file: platFile, label: 'PLATINUM' },
      { file: diaFile,  label: 'DIAMOND' },
    ].filter(j => j.file)

    try {
      let totalRows = 0
      let totalCreated = 0
      let allNotFoundUsernames = []
      for (const job of tierJobs) {
        setTierProgress(`Reading ${job.label} file…`)
        const text = await readFile(job.file)
        const rows = parseCSV(text, TIER_FILE_SKIP_ROWS)
        totalRows += rows.length
        setTierProgress(`Processing ${job.label} (${rows.length} rows)…`)
        const res = await processTierFile(rows, job.label, setTierProgress)
        totalUpdated  += res.updated
        totalNotFound += res.notFound
        totalCreated  += res.created
        allErrors      = [...allErrors, ...res.errors]
        allNotFoundUsernames = [...allNotFoundUsernames, ...res.notFoundUsernames.map(u => `${u} (${job.label})`)]
      }

      const tierLabels = tierJobs.map(j => j.label).join('+')
      await saveImportRecord(importMonth, totalRows, `Tier Files · ${tierLabels}`)

      setTierResult({ updated: totalUpdated, notFound: totalNotFound, created: totalCreated, errors: allErrors, notFoundUsernames: allNotFoundUsernames })
      setTierProgress('')
    } catch (err) {
      setTierResult({ error: err.message, errors: [err.message] })
      setTierProgress('')
    }
    setTierLoading(false)
  }

  // Step 3: Retention metrics
  const [retentionFile,    setRetentionFile]    = useState(null)
  const [retentionLoading, setRetentionLoading] = useState(false)
  const [retentionProgress,setRetentionProgress]= useState('')
  const [retentionResult,  setRetentionResult]  = useState(null)

  // Step 4: Reward campaign
  const [rewardFile,       setRewardFile]       = useState(null)
  const [rewardLoading,    setRewardLoading]    = useState(false)
  const [rewardProgress,   setRewardProgress]   = useState('')
  const [rewardResult,     setRewardResult]     = useState(null)
  const [campaignName,     setCampaignName]     = useState('')
  const [campaignPlatform, setCampaignPlatform] = useState('MY')
  const [campaignCurrency, setCampaignCurrency] = useState('MYR')

  const hasRawFile = rawMyFiles.length > 0 || rawSgFiles.length > 0

  // ── IMPORT 3: Retention Engagement ────────────────────────────────────
  const handleRetentionImport = async () => {
    if (!retentionFile) return
    setRetentionLoading(true)
    setRetentionResult(null)
    setRetentionProgress('Reading file…')
    try {
      const text = await readFile(retentionFile)
      const rows = parseCSV(text, 0)
      setRetentionProgress(`Parsed ${rows.length} rows…`)
      const result = await processRetentionData(rows, setRetentionProgress)
      await saveImportRecord(importMonth, rows.length, `Retention Metrics · ${importMonth}`)
      setRetentionResult({ inserted: result.inserted, errors: result.errors })
      setRetentionProgress('')
    } catch (err) {
      setRetentionResult({ error: err.message, errors: [err.message] })
      setRetentionProgress('')
    }
    setRetentionLoading(false)
  }

  // ── IMPORT 4: Reward Campaign ──────────────────────────────────────────
  const handleRewardImport = async () => {
    if (!rewardFile || !campaignName.trim()) return
    setRewardLoading(true)
    setRewardResult(null)
    setRewardProgress('Reading file…')
    try {
      const text = await readFile(rewardFile)
      const rows = parseCSV(text, 0)
      setRewardProgress(`Parsed ${rows.length} rows…`)
      const result = await processRewardCampaign(
        rows, campaignName.trim(), importMonth,
        campaignPlatform, campaignCurrency, profile?.id,
        setRewardProgress
      )
      await saveImportRecord(importMonth, result.inserted, `Reward Campaign · ${campaignName}`)
      setRewardResult({ inserted: result.inserted, errors: result.errors })
      setRewardProgress('')
    } catch (err) {
      setRewardResult({ error: err.message, errors: [err.message] })
      setRewardProgress('')
    }
    setRewardLoading(false)
  }

  // ── RENDER ─────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.heading}>CSV Import</div>
      <div style={{fontSize:13,color:'var(--muted)',marginTop:4}}>
        Upload the monthly platform CSV export — updates VIP activity, tiers, deposits and withdrawals.
        <span style={{color:'var(--amber,#f59e0b)',marginLeft:8}}>
          📌 To import the mailing list (.xlsx), use Export &amp; Mailing instead.
        </span>
      </div>

      {/* ── Import History ── */}
      <ImportHistory refresh={historyRefresh} />

      {/* ── Month selector ── */}
      <div style={{ ...s.card, marginBottom: 24 }}>
        <div style={s.cardHeader}>
          <span style={s.badge('#6366f1')}>REQUIRED</span>
          <div>
            <div style={s.cardTitle}>Import Month</div>
            <div style={s.cardDesc}>Set the month this data belongs to before uploading</div>
          </div>
        </div>
        <div style={s.monthRow}>
          <span style={s.monthLabel}>Data month:</span>
          <input type="month" value={importMonth} onChange={(e) => setImportMonth(e.target.value)} style={s.monthInput} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            (set to the month your platform data covers — April and May will both be kept)
          </span>
        </div>
        <div style={s.monthRow}>
          <span style={s.monthLabel}>Snapshot date:</span>
          <input type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} style={s.monthInput} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            (defaults to today — change this to backdate if you missed uploading on a previous day)
          </span>
        </div>

        {missingDays && missingDays.missing.length > 0 && (
          <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
              {t('csvImport.missingSnapshots', { month: missingDays.monthLabel, missing: missingDays.missing.length, total: missingDays.lastDay })}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {missingDays.missing.map(d => (
                <span key={d} onClick={() => setSnapshotDate(`${importMonth}-${String(d).padStart(2,'0')}`)}
                  style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', padding: '3px 8px', borderRadius: 5, cursor: 'pointer' }}
                  title={t('csvImport.clickToSelectDate')}>
                  {d}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{t('csvImport.clickDateHint')}</div>
          </div>
        )}
        {missingDays && missingDays.missing.length === 0 && (
          <div style={{ marginTop: 14, padding: '8px 14px', borderRadius: 8, background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.3)', fontSize: 12, color: '#3fb950' }}>
            {t('csvImport.allSnapshotsComplete', { month: missingDays.monthLabel, total: missingDays.lastDay })}
          </div>
        )}
      </div>

      {/* ── IMPORT 1: Raw Data (MY + SG) ── */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <span style={s.badge('#f59e0b')}>STEP 1</span>
          <div>
            <div style={s.cardTitle}>Raw Data — Monthly Activity</div>
            <div style={s.cardDesc}>
              Upload MY and/or SG files — they will be merged by username automatically.
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          ✓ MY + SG merged by username &nbsp;|&nbsp;
          ✓ Updates VIP activity (Gold/Platinum/Diamond) &nbsp;|&nbsp;
          ✓ Creates/refreshes Bronze &amp; Silver in potential_players &nbsp;|&nbsp;
          ✓ Flags upgrade candidates &nbsp;|&nbsp;
          ✓ Saves monthly snapshot to history
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
          <MultiDropzone
            onFiles={setRawMyFiles}
            files={rawMyFiles}
            label="🇲🇾 MY Raw Data (multiple files OK)"
          />
          <MultiDropzone
            onFiles={setRawSgFiles}
            files={rawSgFiles}
            label="🇸🇬 SG Raw Data (multiple files OK)"
          />
        </div>

        {/* Status indicator */}
        {(rawMyFiles.length > 0 || rawSgFiles.length > 0) && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {rawMyFiles.length > 0 && (
              <span style={s.pill('#3fb950')}>✓ MY: {rawMyFiles.length} file{rawMyFiles.length!==1?'s':''}</span>
            )}
            {rawSgFiles.length > 0 && (
              <span style={s.pill('#f59e0b')}>✓ SG: {rawSgFiles.length} file{rawSgFiles.length!==1?'s':''}</span>
            )}
            {rawMyFiles.length > 0 && rawSgFiles.length > 0 && (
              <span style={s.pill('#b9f2ff')}>⚡ Will merge MY + SG</span>
            )}
            <button onClick={() => { setRawMyFiles([]); setRawSgFiles([]) }}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', padding: '2px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
              Clear all
            </button>
          </div>
        )}

        <button
          style={s.btn(!hasRawFile || rawLoading)}
          disabled={!hasRawFile || rawLoading}
          onClick={handleRawImport}
        >
          {rawLoading ? 'Importing…' : rawMyFiles.length > 0 && rawSgFiles.length > 0 ? `Import MY + SG (${rawMyFiles.length + rawSgFiles.length} files)` : 'Import Raw Data'}
        </button>

        {rawProgress && <div style={s.progress}>⏳ {rawProgress}</div>}
        <ResultBox result={rawResult} />
      </div>

      <hr style={s.divider} />

      {/* ── IMPORT 2: Tier files ── */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <span style={s.badge('#10b981')}>STEP 2</span>
          <div>
            <div style={s.cardTitle}>Raw Gold / Platinum / Diamond — Tier Exports</div>
            <div style={s.cardDesc}>
              From your platform's tier export. Updates last deposit date, days inactive, total turnover for Gold+ members.
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          ✓ Updates: last_deposit_date, days_inactive, total_turnover, total_rebate &nbsp;|&nbsp;
          ✓ Upload all 3 or just the ones you have — each is independent
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>🥇 Raw Gold</div>
            <Dropzone onFile={setGoldFile} file={goldFile} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>🥈 Raw Platinum</div>
            <Dropzone onFile={setPlatFile} file={platFile} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>💎 Raw Diamond</div>
            <Dropzone onFile={setDiaFile} file={diaFile} />
          </div>
        </div>

        <button
          style={s.btn((!goldFile && !platFile && !diaFile) || tierLoading, '#10b981')}
          disabled={(!goldFile && !platFile && !diaFile) || tierLoading}
          onClick={handleTierImport}
        >
          {tierLoading ? 'Importing…' : 'Import Tier Files'}
        </button>

        {tierProgress && <div style={s.progress}>⏳ {tierProgress}</div>}
        <ResultBox result={tierResult} />
      </div>

      <hr style={s.divider} />

      {/* ── IMPORT 3: Retention Engagement ── */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <span style={s.badge('#8b5cf6')}>STEP 3</span>
          <div>
            <div style={s.cardTitle}>VIP Retention Engagement — Monthly</div>
            <div style={s.cardDesc}>
              Upload your monthly retention CSV (depositor rate, active rate by tier and week). Format: Month, Tier, Total Members, Metric Type, 1-7, 8-14, 15-21, 22-end, Monthly, + % columns.
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          ✓ Stores weekly depositor &amp; active rates by tier &nbsp;|&nbsp;
          ✓ Powers month-over-month engagement trends &nbsp;|&nbsp;
          ✓ Used in PPT report — Activity section
        </div>
        <Dropzone onFile={setRetentionFile} file={retentionFile} label="📊 Retention Engagement CSV" />
        <button
          style={s.btn(!retentionFile || retentionLoading, '#8b5cf6')}
          disabled={!retentionFile || retentionLoading}
          onClick={handleRetentionImport}
        >
          {retentionLoading ? 'Importing…' : 'Import Retention Data'}
        </button>
        {retentionProgress && <div style={s.progress}>⏳ {retentionProgress}</div>}
        <ResultBox result={retentionResult} />
      </div>

      <hr style={s.divider} />

      {/* ── IMPORT 4: Reward Campaign ── */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <span style={s.badge('#ec4899')}>STEP 4</span>
          <div>
            <div style={s.cardTitle}>Reward / Bonus Campaign</div>
            <div style={s.cardDesc}>
              Upload your deposit privilege tracker or bonus campaign summary CSV. Stores qualifier counts and payout totals per tier.
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          ✓ Stores campaign KPIs (Tier 1/2 qualifiers, total payout) &nbsp;|&nbsp;
          ✓ Breakdown by member group (Bronze → Diamond) &nbsp;|&nbsp;
          ✓ Exportable for PPT bonus slide
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Campaign Name *</div>
            <input
              style={{ ...s.monthInput, width: '100%', boxSizing: 'border-box' }}
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              placeholder="e.g. VIP Deposit Privilege May"
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Platform</div>
            <select
              style={{ ...s.monthInput, width: '100%' }}
              value={campaignPlatform}
              onChange={e => {
                setCampaignPlatform(e.target.value)
                setCampaignCurrency(e.target.value === 'SG' ? 'SGD' : 'MYR')
              }}
            >
              <option value="MY">MY (MYR)</option>
              <option value="SG">SG (SGD)</option>
              <option value="BOTH">Both Platforms</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Currency</div>
            <select
              style={{ ...s.monthInput, width: '100%' }}
              value={campaignCurrency}
              onChange={e => setCampaignCurrency(e.target.value)}
            >
              <option value="MYR">MYR</option>
              <option value="SGD">SGD</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
        <Dropzone onFile={setRewardFile} file={rewardFile} label="🎁 Reward Campaign CSV" />
        <button
          style={s.btn(!rewardFile || !campaignName.trim() || rewardLoading, '#ec4899')}
          disabled={!rewardFile || !campaignName.trim() || rewardLoading}
          onClick={handleRewardImport}
        >
          {rewardLoading ? 'Importing…' : 'Import Campaign Data'}
        </button>
        {!campaignName.trim() && rewardFile && (
          <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 6 }}>⚠ Please enter a campaign name first</div>
        )}
        {rewardProgress && <div style={s.progress}>⏳ {rewardProgress}</div>}
        <ResultBox result={rewardResult} />
      </div>

      <hr style={s.divider} />

      {/* ── Info box ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>📋 Monthly workflow reminder</div>
        <div>1. Set the import month above to the month your data covers</div>
        <div>2. Upload <strong>MY Raw Data</strong> + <strong>SG Raw Data</strong> together — they merge automatically by username</div>
        <div>3. Upload the <strong>3 tier files</strong> to refresh last deposit dates and turnover for Gold+ members</div>
        <div>4. Upload <strong>Retention Engagement CSV</strong> — weekly depositor/active rates by tier</div>
        <div>5. Upload <strong>Reward/Bonus Campaign CSV</strong> — qualifier counts and payout totals</div>
        <div>6. Check the <strong>Import History</strong> panel at the top — each month shows separately</div>
        <div>7. After all steps, go to <strong>Export</strong> → Generate Monthly Report PPT</div>
        <div style={{ marginTop: 8, color: 'var(--accent)' }}>
          ℹ️ CRM fields (host, birthday, notes, city) are updated directly on each VIP's profile page — not through CSV import
        </div>
      </div>
    </div>
  )
}
