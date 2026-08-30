// src/lib/format.js
// Single source of truth for money/date formatting. The old pattern was every
// page defining its own fmt()/rmFmt() that hardcoded "RM " regardless of the
// row's actual currency — fine for MY-only figures, wrong for SGD ones.
//
// formatMoney(n, currency) is currency-aware: pass the row's `currency` field
// ('MYR' | 'SGD') whenever you have it, and it'll use the right symbol. If you
// don't have a currency for a figure (e.g. a legacy MY-only tool), it falls
// back to MYR/"RM" so existing call sites that can't easily be changed keep
// working exactly as before.
//
// IMPORTANT: formatMoney formats ONE already-computed number. It does not
// protect you from adding MYR and SGD figures together before calling it —
// that has to be fixed at the point where the sum happens (see TierAnalytics,
// PlayerProfiling, BudgetStrategy, ContactLog for the pattern: split totals
// by currency BEFORE reducing, never after).

import { CURRENCY_SYMBOL, MONTHS } from './constants'

export function formatMoney(n, currency = 'MYR') {
  if (!n && n !== 0) return '—'
  const num = parseFloat(n) || 0
  const sym = CURRENCY_SYMBOL[currency] || CURRENCY_SYMBOL.MYR
  const neg = num < 0 ? '-' : ''
  const abs = Math.abs(num)
  if (abs >= 1000000) return `${neg}${sym} ${(abs / 1000000).toFixed(2)}M`
  if (abs >= 1000)    return `${neg}${sym} ${(abs / 1000).toFixed(1)}K`
  return `${neg}${sym} ${Math.round(abs).toLocaleString('en-MY')}`
}

// Compact axis-style formatting with no currency symbol (for chart Y axes etc.)
export function formatCompactNumber(n) {
  const num = parseFloat(n) || 0
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000)    return (num / 1000).toFixed(0) + 'K'
  return String(Math.round(num))
}

export function pctChange(current, prev) {
  if (!prev || prev === 0) return null
  return Math.round(((current - prev) / prev) * 100)
}

// 'YYYY-MM' -> 'Jan 2026'
export function fmtMonthLabel(m) {
  if (!m) return '—'
  const [y, mo] = m.split('-')
  return `${MONTHS[parseInt(mo, 10) - 1]} ${y}`
}

export function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function prevYearMonth(m) {
  const [y, mo] = m.split('-').map(Number)
  if (mo === 1) return `${y - 1}-12`
  return `${y}-${String(mo - 1).padStart(2, '0')}`
}

export function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}
