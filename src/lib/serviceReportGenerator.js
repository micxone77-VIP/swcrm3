/**
 * serviceReportGenerator.js
 * Generates a 3-month VIP service coverage report as an .xlsx file
 * using the SheetJS (xlsx) library — runs entirely in the browser.
 *
 * Usage:
 *   import { generateServiceReport } from './serviceReportGenerator'
 *   await generateServiceReport(endMonth, supabase)
 *   // endMonth: 'YYYY-MM' string, e.g. '2026-09'
 *   // The report covers endMonth and the 2 months before it.
 */

import * as XLSX from 'xlsx'

// ─── helpers ────────────────────────────────────────────────────────────────

/** 'YYYY-MM' → { year, month (1-based) } */
function parseYM(ym) {
  const [y, m] = ym.split('-').map(Number)
  return { year: y, month: m }
}

/** Add/subtract months from a 'YYYY-MM' string. delta can be negative. */
function shiftMonth(ym, delta) {
  let { year, month } = parseYM(ym)
  month += delta
  while (month < 1)  { month += 12; year-- }
  while (month > 12) { month -= 12; year++ }
  return `${year}-${String(month).padStart(2, '0')}`
}

/** 'YYYY-MM' → human label, e.g. 'Sep 2026' */
function monthLabel(ym) {
  const { year, month } = parseYM(ym)
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

/** First day of month as ISO date string 'YYYY-MM-DD' */
function monthStart(ym) {
  return `${ym}-01`
}

/** Last day of month as ISO date string 'YYYY-MM-DD' */
function monthEnd(ym) {
  const { year, month } = parseYM(ym)
  const last = new Date(year, month, 0).getDate()
  return `${ym}-${String(last).padStart(2, '0')}`
}

// ─── data fetching ───────────────────────────────────────────────────────────

async function fetchVIPs(supabase) {
  const { data, error } = await supabase
    .from('vip_members')
    .select('id, username, full_name, tier, host_assigned')
    .in('tier', ['DIAMOND', 'Platinum', 'PLATINUM', 'Diamond'])
    .order('tier')
    .order('username')
  if (error) throw new Error(`fetchVIPs: ${error.message}`)

  // Normalise tier casing
  return (data || []).map(v => ({
    ...v,
    tier: v.tier.toUpperCase()
  }))
}

async function fetchContactLogs(supabase, months) {
  // months: array of 'YYYY-MM' strings
  const earliest = months[0]   // smallest month (months is sorted asc)
  const latest   = months[months.length - 1]
  const from = monthStart(earliest)
  const to   = monthEnd(latest)

  const { data, error } = await supabase
    .from('contact_logs')
    .select('vip_id, logged_at')
    .gte('logged_at', from)
    .lte('logged_at', `${to}T23:59:59`)
  if (error) throw new Error(`fetchContactLogs: ${error.message}`)
  return data || []
}

// ─── coverage matrix builder ──────────────────────────────────────────────────

/**
 * Returns a Map<vip_id, Set<'YYYY-MM'>> — months in which each VIP was contacted
 */
function buildCoverageMap(logs, months) {
  const map = new Map()
  for (const log of logs) {
    const d = new Date(log.logged_at)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!months.includes(ym)) continue
    if (!map.has(log.vip_id)) map.set(log.vip_id, new Set())
    map.get(log.vip_id).add(ym)
  }
  return map
}

// ─── Excel styles (SheetJS CE only supports basic style via utils) ────────────

// SheetJS Community Edition doesn't support rich cell styles out of the box.
// We use XLSX.utils to set cell types/values, and rely on header rows + value
// encoding (✓ / ✗) for human readability. Bold headers are added via aoa.

// ─── sheet builders ──────────────────────────────────────────────────────────

function buildOverviewSheet(vips, months, coverageMap) {
  const labels = months.map(monthLabel)
  const diamond = vips.filter(v => v.tier === 'DIAMOND')
  const platinum = vips.filter(v => v.tier === 'PLATINUM')

  const rows = []

  rows.push(['SureWin VIP Department — 3-Month Service Coverage Report'])
  rows.push([`Report Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}`])
  rows.push([`Coverage Period: ${labels[0]} – ${labels[labels.length - 1]}`])
  rows.push([])

  // ── Diamond summary ──
  rows.push(['DIAMOND VIP SUMMARY'])
  rows.push(['', ...labels, 'Full Coverage (All 3 Months)', 'At Least Once', 'Never Contacted'])

  const dTotals = months.map(() => 0)
  let dFullCoverage = 0, dAtLeastOnce = 0, dNever = 0
  for (const v of diamond) {
    const contacted = coverageMap.get(v.id) || new Set()
    const hits = months.map(m => contacted.has(m))
    hits.forEach((h, i) => { if (h) dTotals[i]++ })
    const count = hits.filter(Boolean).length
    if (count === months.length) dFullCoverage++
    if (count > 0) dAtLeastOnce++; else dNever++
  }
  rows.push(['VIPs Contacted', ...dTotals, dFullCoverage, dAtLeastOnce, dNever])
  rows.push(['Total Diamond VIPs', diamond.length])
  rows.push(['Contact Rate', ...dTotals.map(n => diamond.length ? `${Math.round(n / diamond.length * 100)}%` : '-')])
  rows.push([])

  // ── Platinum summary ──
  rows.push(['PLATINUM VIP SUMMARY'])
  rows.push(['', ...labels, 'Full Coverage (All 3 Months)', 'At Least Once', 'Never Contacted'])

  const pTotals = months.map(() => 0)
  let pFullCoverage = 0, pAtLeastOnce = 0, pNever = 0
  for (const v of platinum) {
    const contacted = coverageMap.get(v.id) || new Set()
    const hits = months.map(m => contacted.has(m))
    hits.forEach((h, i) => { if (h) pTotals[i]++ })
    const count = hits.filter(Boolean).length
    if (count === months.length) pFullCoverage++
    if (count > 0) pAtLeastOnce++; else pNever++
  }
  rows.push(['VIPs Contacted', ...pTotals, pFullCoverage, pAtLeastOnce, pNever])
  rows.push(['Total Platinum VIPs', platinum.length])
  rows.push(['Contact Rate', ...pTotals.map(n => platinum.length ? `${Math.round(n / platinum.length * 100)}%` : '-')])
  rows.push([])

  rows.push(['LEGEND'])
  rows.push(['✓  N×  (green)', `Contacted — N = number of contacts that month`])
  rows.push(['✗  None  (red)', 'Not contacted that month'])
  rows.push(['Coverage Rate', '% of months contacted out of total months in report'])

  return XLSX.utils.aoa_to_sheet(rows)
}

function buildVIPSheet(vips, months, coverageMap, allLogs) {
  const labels = months.map(monthLabel)

  // Build a map: vip_id → month → count
  const countMap = new Map()
  for (const log of allLogs) {
    const d = new Date(log.logged_at)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!months.includes(ym)) continue
    const key = `${log.vip_id}::${ym}`
    countMap.set(key, (countMap.get(key) || 0) + 1)
  }

  const header = [
    'Username', 'Full Name', 'Tier', 'Host Assigned',
    ...labels,
    'Months Covered', 'Coverage Rate %'
  ]
  const rows = [header]

  for (const v of vips) {
    const contacted = coverageMap.get(v.id) || new Set()
    const monthCells = months.map(m => {
      const cnt = countMap.get(`${v.id}::${m}`) || 0
      return contacted.has(m) ? `✓  ${cnt}×` : '✗  None'
    })
    const covered = months.filter(m => contacted.has(m)).length
    rows.push([
      v.username || '',
      v.full_name || '',
      v.tier,
      v.host_assigned || '(unassigned)',
      ...monthCells,
      `${covered}/${months.length}`,
      months.length ? `${Math.round(covered / months.length * 100)}%` : '-'
    ])
  }

  return XLSX.utils.aoa_to_sheet(rows)
}

// ─── main export ──────────────────────────────────────────────────────────────

/**
 * Fetch data from Supabase and trigger browser download of .xlsx file.
 * @param {string} endMonth  - 'YYYY-MM', the last (most recent) month of the 3-month window
 * @param {object} supabase  - Supabase client
 * @returns {Promise<void>}
 */
export async function generateServiceReport(endMonth, supabase) {
  // Build month list ascending: [endMonth-2, endMonth-1, endMonth]
  const months = [shiftMonth(endMonth, -2), shiftMonth(endMonth, -1), endMonth]

  const [vips, logs] = await Promise.all([
    fetchVIPs(supabase),
    fetchContactLogs(supabase, months)
  ])

  const coverageMap = buildCoverageMap(logs, months)
  const diamond = vips.filter(v => v.tier === 'DIAMOND')
  const platinum = vips.filter(v => v.tier === 'PLATINUM')

  const wb = XLSX.utils.book_new()

  const wsOverview = buildOverviewSheet(vips, months, coverageMap)
  XLSX.utils.book_append_sheet(wb, wsOverview, 'Overview')

  const wsDiamond = buildVIPSheet(diamond, months, coverageMap, logs)
  XLSX.utils.book_append_sheet(wb, wsDiamond, 'Diamond VIPs')

  const wsPlat = buildVIPSheet(platinum, months, coverageMap, logs)
  XLSX.utils.book_append_sheet(wb, wsPlat, 'Platinum VIPs')

  const labels = months.map(monthLabel)
  const filename = `SureWin_VIP_Service_${labels[0].replace(' ', '_')}_to_${labels[2].replace(' ', '_')}.xlsx`

  XLSX.writeFile(wb, filename)
}
