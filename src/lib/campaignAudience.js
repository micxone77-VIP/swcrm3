export const CAMPAIGN_COUNTRIES = ['MY', 'SG', 'KH']

export function countryFromPlayer(player) {
  const currency = String(player?.currency || '').trim().toUpperCase()
  if (currency === 'MYR') return 'MY'
  if (currency === 'SGD') return 'SG'
  if (currency === 'KHUSD') return 'KH'
  return null
}

export function buildFilteredCampaignAudience(players = [], countries = [], tiers = [], manualUserIds = []) {
  const allowedCountries = new Set((countries || []).map(v => String(v).trim().toUpperCase()).filter(Boolean))
  const allowedTiers = new Set((tiers || []).map(v => String(v).trim().toUpperCase()).filter(Boolean))
  const manual = new Set((manualUserIds || []).map(v => String(v).trim().toLowerCase()).filter(Boolean))
  const seen = new Map()

  const eligibleByFilter = (player) => {
    if (!player || player.is_excluded === true) return false
    const username = String(player.username || '').trim()
    if (!username) return false
    const country = countryFromPlayer(player)
    return allowedCountries.has(country) && allowedTiers.has(String(player.tier || '').trim().toUpperCase())
  }

  for (const player of players) {
    if (eligibleByFilter(player)) seen.set(String(player.username).trim().toLowerCase(), { ...player, enrollment_source: 'tier' })
  }

  // Manual IDs intentionally bypass country/tier filters, but still require a
  // real, non-excluded VIP record. This allows a host to make an explicit
  // exception without broadening the automatic audience.
  for (const player of players) {
    const key = String(player?.username || '').trim().toLowerCase()
    if (!key || !manual.has(key) || player.is_excluded === true) continue
    const existing = seen.get(key)
    if (existing) existing.enrollment_source = 'both'
    else seen.set(key, { ...player, enrollment_source: 'manual' })
  }

  return [...seen.values()]
}
