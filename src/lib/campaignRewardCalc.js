// src/lib/campaignRewardCalc.js — reward formulas for the normal campaign types
// (moved from Campaigns.jsx so VIP360 › Dept Spending uses the same numbers).

export function calcTieredReward(deposit, tiers) {
  // tiers: [{min, max, pct}] sorted by min ascending
  // % applies to FULL deposit amount at the highest qualifying tier
  if (!tiers || tiers.length === 0) return 0
  const dep = parseFloat(deposit) || 0
  const sorted = [...tiers].sort((a,b) => parseFloat(a.min)-parseFloat(b.min))
  let reward = 0
  for (const t of sorted) {
    const min = parseFloat(t.min) || 0
    const max = t.max ? parseFloat(t.max) : Infinity
    const pct = parseFloat(t.pct) || 0
    if (dep >= min && dep <= max) {
      reward = dep * pct / 100
      break
    }
    // If deposit exceeds all tiers, use the last tier
    if (dep > max) {
      const nextTier = sorted.find(tt => parseFloat(tt.min) > max)
      if (!nextTier) reward = dep * pct / 100
    }
  }
  return reward
}

export function calcDualTierReward(deposit, validBet, tiers) {
  if (!tiers || tiers.length === 0) return { creditAmount: 0, wcashAmount: 0, tierIndex: -1 }
  const dep = parseFloat(deposit) || 0
  const vb = parseFloat(validBet) || 0
  // Both conditions must be met simultaneously — find the highest tier where
  // deposit AND turnover both clear their threshold. Tiers assumed ascending.
  let best = null
  let bestIndex = -1
  tiers.forEach((tier, i) => {
    const depReq = parseFloat(tier.depositThreshold) || 0
    const vbReq = parseFloat(tier.turnoverThreshold) || 0
    if (dep >= depReq && vb >= vbReq) { best = tier; bestIndex = i }
  })
  if (!best) return { creditAmount: 0, wcashAmount: 0, tierIndex: -1 }
  return { creditAmount: parseFloat(best.creditAmount) || 0, wcashAmount: parseFloat(best.wcashAmount) || 0, tierIndex: bestIndex }
}

export function calcLevelFixedReward(deposit, levels) {
  const dep = parseFloat(deposit) || 0
  const sorted = [...(levels || [])].sort((a,b) => (parseFloat(a.deposit_threshold)||0) - (parseFloat(b.deposit_threshold)||0))
  let reward = 0
  for (const level of sorted) {
    if (dep >= (parseFloat(level.deposit_threshold)||0)) reward = parseFloat(level.reward_amount)||0
    else break
  }
  return reward
}

// For dual_tier + daily + is_multi_level campaigns: returns the highest campaign_level
// the deposit qualifies for, and that level's credit reward.
export function calcLevelTierForDeposit(dep, levels) {
  const deposit = parseFloat(dep) || 0
  const sorted = [...(levels || [])].sort((a, b) => Number(b.deposit_threshold) - Number(a.deposit_threshold))
  const bestLevel = sorted.find(l => deposit >= (Number(l.deposit_threshold) || 0))
  if (!bestLevel) return { levelOrder: null, creditReward: 0 }
  return { levelOrder: bestLevel.level_order ?? null, creditReward: Number(bestLevel.reward_amount) || 0 }
}

export function calcReward(type, deposit, rewardPct, rewardFixed, goldBarValue, rewardCap, rewardTiers, rewardLevels = [], isMultiLevel = false) {
  let reward = 0
  if (type === 'pct_reward') reward = (parseFloat(deposit)||0) * (parseFloat(rewardPct)||0) / 100
  else if (type === 'fixed_reward') reward = isMultiLevel ? calcLevelFixedReward(deposit, rewardLevels) : (parseFloat(rewardFixed)||0)
  else if (type === 'gold_bar') reward = parseFloat(goldBarValue)||0
  else if (type === 'tiered_reward') reward = calcTieredReward(deposit, rewardTiers||[])
  if (rewardCap && parseFloat(rewardCap) > 0) reward = Math.min(reward, parseFloat(rewardCap))
  return reward
}
