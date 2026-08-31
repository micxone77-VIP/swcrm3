export function parseManualUserIds(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))]
  }

  return [...new Set(
    String(value || '')
      .split(/[\s,;]+/)
      .map(v => v.trim())
      .filter(Boolean),
  )]
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase()
}

export function buildCampaignAudience(players = [], selectedTiers = [], manualUserIds = []) {
  const tiers = new Set((selectedTiers || []).map(t => String(t || '').trim().toUpperCase()).filter(Boolean))
  const manualIds = new Set(parseManualUserIds(manualUserIds).map(normalizeUsername))
  const byUsername = new Map()

  for (const player of players || []) {
    if (!player || player.is_excluded === true) continue
    const username = String(player.username || '').trim()
    if (!username) continue
    byUsername.set(normalizeUsername(username), player)
  }

  const audience = []
  const seen = new Map()

  const add = (player, source) => {
    const key = normalizeUsername(player.username)
    if (!key) return
    const existing = seen.get(key)
    if (existing) {
      existing.enrollment_source = existing.enrollment_source === source ? source : 'both'
      return
    }

    const enrolled = { ...player, enrollment_source: source }
    seen.set(key, enrolled)
    audience.push(enrolled)
  }

  for (const player of byUsername.values()) {
    if (tiers.has(String(player.tier || '').trim().toUpperCase())) add(player, 'tier')
  }

  for (const id of manualIds) {
    const player = byUsername.get(id)
    if (player) add(player, 'manual')
  }

  return audience
}
