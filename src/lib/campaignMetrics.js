export const UNLOCKED_LEVEL_STATUSES = new Set(['unlocked', 'claimed', 'issued', 'paid', 'approved'])

export function buildMultiLevelPlayerMetrics(player, levels = [], playerLevels = []) {
  const sorted = [...levels].sort((a, b) => Number(a.level_order || 0) - Number(b.level_order || 0))
  const stateByLevel = new Map(
    playerLevels
      .filter(pl => pl.campaign_player_id === player?.id)
      .map(pl => [pl.campaign_level_id, pl])
  )
  const unlockedLevels = sorted.filter(level => UNLOCKED_LEVEL_STATUSES.has(stateByLevel.get(level.id)?.status))
  const completedCount = unlockedLevels.length
  const nextLevel = sorted.find(level => !UNLOCKED_LEVEL_STATUSES.has(stateByLevel.get(level.id)?.status)) ?? null
  const currentLevel = unlockedLevels.at(-1) ?? null
  const allCompleted = sorted.length > 0 && completedCount === sorted.length
  const qualifiedRewardTotal = unlockedLevels.reduce((sum, level) => sum + Number(level.reward_amount || 0), 0)
  return { currentLevel, nextLevel, unlockedLevels, completedCount, allCompleted, qualifiedRewardTotal }
}

export function buildPayoutRows(players = [], levels = [], playerLevels = [], rewards = [], payoutMode = 'all') {
  const playersById = new Map(players.map(p => [p.id, p]))
  const levelsById = new Map(levels.map(l => [l.id, l]))
  const unlocked = new Set(
    playerLevels
      .filter(pl => UNLOCKED_LEVEL_STATUSES.has(pl.status))
      .map(pl => `${pl.campaign_player_id}:${pl.campaign_level_id}`)
  )
  let rows = rewards
    .filter(r => unlocked.has(`${r.campaign_player_id}:${r.campaign_level_id}`))
    .map(r => {
      const player = playersById.get(r.campaign_player_id)
      const level = levelsById.get(r.campaign_level_id)
      return {
        rewardId: r.id,
        playerId: r.campaign_player_id,
        username: player?.username ?? r.campaign_player_id,
        tier: player?.tier ?? null,
        levelId: r.campaign_level_id,
        levelOrder: Number(level?.level_order || 0),
        levelName: level?.level_name ?? 'Level',
        depositThreshold: Number(level?.deposit_threshold || 0),
        rewardAmount: Number(r.reward_amount || level?.reward_amount || 0),
        status: r.status || 'pending',
        paidAt: r.paid_at ?? null,
      }
    })
    .sort((a, b) => a.levelOrder - b.levelOrder || a.username.localeCompare(b.username))

  if (payoutMode === 'highest_only') {
    // Per player: keep only the row with the highest level order
    const highestByPlayer = new Map()
    for (const row of rows) {
      const existing = highestByPlayer.get(row.playerId)
      if (!existing || row.levelOrder > existing.levelOrder) {
        highestByPlayer.set(row.playerId, row)
      }
    }
    rows = [...highestByPlayer.values()].sort((a, b) => a.username.localeCompare(b.username))
  }

  return rows
}

export function buildCampaignSummary(players = [], levels = [], playerLevels = [], rewards = []) {
  const playerIds = new Set(players.map(p => p.id).filter(Boolean))
  const levelIds = new Set(levels.map(l => l.id).filter(Boolean))
  const scopedPlayerLevels = playerLevels.filter(pl =>
    playerIds.has(pl.campaign_player_id) && levelIds.has(pl.campaign_level_id)
  )
  const scopedRewards = rewards.filter(r =>
    playerIds.has(r.campaign_player_id) && levelIds.has(r.campaign_level_id)
  )
  // A reward row can exist before its campaign level is actually unlocked.
  // Summary/P&L must use the same payable population as buildPayoutRows,
  // otherwise a locked future reward inflates reward cost and pending payout.
  const unlockedKeys = new Set(
    scopedPlayerLevels
      .filter(pl => UNLOCKED_LEVEL_STATUSES.has(pl.status))
      .map(pl => `${pl.campaign_player_id}:${pl.campaign_level_id}`)
  )
  const payableRewards = scopedRewards.filter(r =>
    unlockedKeys.has(`${r.campaign_player_id}:${r.campaign_level_id}`)
  )
  const metrics = players.map(player => buildMultiLevelPlayerMetrics(player, levels, scopedPlayerLevels))
  const paidReward = payableRewards.filter(r => r.status === 'paid').reduce((sum, r) => sum + Number(r.reward_amount || 0), 0)
  const pendingReward = payableRewards.filter(r => ['pending', 'approved', 'issued', 'claimed'].includes(r.status)).reduce((sum, r) => sum + Number(r.reward_amount || 0), 0)
  const rejectedReward = payableRewards.filter(r => r.status === 'rejected').reduce((sum, r) => sum + Number(r.reward_amount || 0), 0)
  const unlockedLevels = metrics.reduce((sum, m) => sum + m.completedCount, 0)
  const playersWithReward = metrics.filter(m => m.completedCount > 0).length
  const fullyCompleted = metrics.filter(m => m.allCompleted).length
  return { players: players.length, playersWithReward, fullyCompleted, unlockedLevels, rewardRows: payableRewards.length, paidReward, pendingReward, rejectedReward, totalReward: paidReward + pendingReward, successRate: players.length ? Math.round(fullyCompleted / players.length * 100) : 0 }
}

export function calculateCampaignROI(rewardCost = 0, netPnl = 0) {
  const cost = Number(rewardCost || 0)
  const pnl = Number(netPnl || 0)
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(pnl)) return null
  return (pnl / cost) * 100
}
