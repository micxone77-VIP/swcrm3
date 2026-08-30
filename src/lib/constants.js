// src/lib/constants.js
// Single source of truth for tier colors, month labels, and the MY/SG
// region↔currency mapping. Previously each page redefined its own copies of
// these (with small inconsistencies), which is how several pages ended up
// silently summing MYR and SGD figures together under one "RM" label —
// there was no single place that said "these are two different currencies
// and must not be added together." See lib/format.js for the money formatter
// that uses CURRENCY_SYMBOL below.

export const TIER_COLOR = {
  DIAMOND:  '#b9f2ff',
  PLATINUM: '#C0C0C0',
  GOLD:     '#ffd700',
  SILVER:   '#a8a8a8',
  BRONZE:   '#cd7f32',
  BLACK:    '#ffffff',
}

export const TIER_BG = {
  DIAMOND:  'rgba(185,242,255,.12)',
  PLATINUM: 'rgba(192,192,192,.12)',
  GOLD:     'rgba(255,215,0,.12)',
  SILVER:   'rgba(168,168,168,.1)',
  BRONZE:   'rgba(205,127,50,.1)',
  BLACK:    'rgba(255,255,255,.08)',
}

export const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export const MONTHS_CN = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

// Regions as stored in vip_members.region, and the short labels used in the UI.
export const REGION_LIST  = ['Malaysia', 'Singapore', 'Cambodia']
export const REGION_LABEL = { Malaysia: 'MY', Singapore: 'SG', Cambodia: 'KH' }

// Currency as stored in vip_members.currency / vip_monthly_totals.currency.
// NOTE: KHUSD (Cambodia) exists in the data model (see CSVImport.jsx's currency
// detection and VIPList.jsx's existing multi-currency formatter) but is a much
// smaller market — most pages only toggle between MYR/SGD. CURRENCY_LIST here
// is the full set; use CURRENCY_LIST_MAIN where you only want the two primary
// markets (e.g. a simple MY/SG toggle) and are consciously leaving Cambodia out.
export const CURRENCY_LIST      = ['MYR', 'SGD', 'KHUSD']
export const CURRENCY_LIST_MAIN = ['MYR', 'SGD']
export const CURRENCY_SYMBOL    = { MYR: 'RM', SGD: 'S$', KHUSD: 'KHR', USD: 'USD' }

// Region <-> currency mapping — use this instead of hardcoding 'RM' anywhere.
// MYR, SGD, and KHUSD amounts must NEVER be summed together; if you need a
// combined view, show separate subtotals per currency, the way Dashboard.jsx's
// Tier Financial Summary already does for MY/SG.
export const REGION_CURRENCY = { Malaysia: 'MYR', Singapore: 'SGD', Cambodia: 'KHUSD' }
export const CURRENCY_REGION = { MYR: 'Malaysia', SGD: 'Singapore', KHUSD: 'Cambodia' }
