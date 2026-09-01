from pathlib import Path
import re

path = Path('src/pages/Campaigns.jsx')
source = path.read_text()

if "const leaderboardMetric = ['turnover','deposit','turnover_deposit']" in source:
    print('Leaderboard migration already applied.')
    raise SystemExit(0)

source, n = re.subn(
    r"(modal:\s*\{[^\n]*maxWidth:)720(, maxHeight:)'90vh'",
    r"\g<1>1200\2'92vh'",
    source,
    count=1,
)
if n != 1:
    raise SystemExit('PATCH_STOP: modal target not found')

start_marker = "  // ── Leaderboard-specific: rank by valid_bet, not deposit"
end_marker = "  const chaseList = campType==='leaderboard' ? lbRanked : [...players].sort((a,b)=>playerDeposit(b)-playerDeposit(a))"
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('PATCH_STOP: leaderboard derived-state markers not found')

replacement = '''  // ── Leaderboard-specific ranking/qualification
  const leaderboardMetric = ['turnover','deposit','turnover_deposit'].includes(selected?.leaderboard_metric)
    ? selected.leaderboard_metric : 'turnover'
  const leaderboardRankingValue = (p) => leaderboardMetric === 'deposit'
    ? playerDeposit(p) : (parseFloat(p.valid_bet) || 0)
  const leaderboardQualified = (p) => {
    const vb = parseFloat(p.valid_bet) || 0
    const dep = playerDeposit(p)
    if (leaderboardMetric === 'deposit') return dep >= minDepLb
    if (leaderboardMetric === 'turnover_deposit') return vb >= minBetTarget && dep >= minDepLb
    return vb >= minBetTarget
  }
  const lbRanked = campType === 'leaderboard'
    ? [...players].sort((a,b) => leaderboardRankingValue(b) - leaderboardRankingValue(a) || String(a.username||'').localeCompare(String(b.username||''))).map((p,i) => {
        const qualified = leaderboardQualified(p)
        const rank = i + 1
        const inTop = rank <= topN
        const reward = inTop && qualified ? (parseFloat(rankRewards[rank-1]?.amount)||0) : 0
        return { ...p, _vb:parseFloat(p.valid_bet)||0, _deposit:playerDeposit(p), _rankingValue:leaderboardRankingValue(p), _posRank:rank, _rank:rank, _inTop:inTop && qualified, _reward:reward, _qualified:qualified }
      }) : []
  const cutoffValue = campType==='leaderboard' && lbRanked[topN-1] ? lbRanked[topN-1]._rankingValue : null

  const achieved = campType === 'leaderboard' ? lbRanked.filter(p=>p._qualified)
    : campType === 'dual_tier' && isDailyMode ? players.filter(p=>summaryData?.playerRows?.some(r=>r.username===p.username && (r.credit>0 || r.wcash>0)))
    : campType === 'dual_tier' ? players.filter(p=>calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers).tierIndex>=0)
    : selected?.is_multi_level ? players.filter(p=>multiMetricsByPlayer[p.id]?.completedCount>0)
    : players.filter(p=>playerDeposit(p)>=depTarget)

  const dailyAchieved = isDailyMode ? players.filter(p=>dailyEntries[p.id]?.tier_achieved!==null && dailyEntries[p.id]?.tier_achieved!==undefined) : []
  const nearTarget = campType === 'leaderboard' ? lbRanked.filter(p=>{
      if (p._qualified) return false
      if (leaderboardMetric === 'turnover_deposit') return Math.min(minBetTarget?p._vb/minBetTarget:0, minDepLb?p._deposit/minDepLb:0) >= 0.7
      const target = leaderboardMetric === 'deposit' ? minDepLb : minBetTarget
      return target > 0 && p._rankingValue/target >= 0.7
    })
    : campType === 'dual_tier' ? []
    : selected?.is_multi_level ? players.filter(p=>{const m=multiMetricsByPlayer[p.id],n=m?.nextLevel,dep=playerDeposit(p);return n&&Number(n.deposit_threshold)>0&&dep/Number(n.deposit_threshold)>=0.7&&dep<Number(n.deposit_threshold)})
    : players.filter(p=>{const pct=depTarget?playerDeposit(p)/depTarget:0;return pct>=0.7&&pct<1})
  const inProgress = campType === 'leaderboard' ? lbRanked.filter(p=>!p._qualified && !nearTarget.includes(p))
    : campType === 'dual_tier' ? players.filter(p=>calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers).tierIndex<0)
    : selected?.is_multi_level ? players.filter(p=>{const m=multiMetricsByPlayer[p.id],n=m?.nextLevel;return !m?.allCompleted&&(!n||playerDeposit(p)<Number(n.deposit_threshold)*0.7)})
    : players.filter(p=>{const pct=depTarget?playerDeposit(p)/depTarget:0;return pct<0.7})

  const totalReward = campType === 'leaderboard' ? rankRewards.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)
    : campType === 'dual_tier' && isDailyMode ? (summaryData ? summaryData.totalCredit + summaryData.totalWcash : 0)
    : campType === 'dual_tier' ? achieved.reduce((s,p)=>{const r=calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers);return s+r.creditAmount+r.wcashAmount},0)
    : selected?.is_multi_level ? multiPayoutRows.reduce((s,r)=>s+r.rewardAmount,0)
    : achieved.reduce((s,p)=>s+calcReward(campType,playerDeposit(p),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level),0)
  const paidOut = campType === 'leaderboard' ? lbRanked.filter(p=>p._inTop&&p.payout_status==='paid').reduce((s,p)=>s+p._reward,0)
    : campType === 'dual_tier' && isDailyMode ? (summaryData ? summaryData.paidCredit + summaryData.paidWcash : 0)
    : campType === 'dual_tier' ? players.filter(p=>p.payout_status==='paid').reduce((s,p)=>{const r=calcDualTierReward(playerDeposit(p),p.valid_bet,rewardTiers);return s+r.creditAmount+r.wcashAmount},0)
    : selected?.is_multi_level ? multiPayoutRows.filter(r=>r.status==='paid').reduce((s,r)=>s+r.rewardAmount,0)
    : players.filter(p=>p.payout_status==='paid').reduce((s,p)=>s+calcReward(campType,playerDeposit(p),rewardPct,rewardFixed,goldVal,rewardCap,rewardTiers,campaignLevels,selected?.is_multi_level),0)
  const pendingPay = Math.max(0,totalReward-paidOut)
'''
source = source[:start] + replacement + end_marker + source[end+len(end_marker):]

old_sort = "[...players].sort((a,b)=>(parseFloat(b.valid_bet)||0)-(parseFloat(a.valid_bet)||0))"
if old_sort not in source:
    raise SystemExit('PATCH_STOP: leaderboard table sort target not found')
source = source.replace(old_sort, "[...players].sort((a,b)=>leaderboardRankingValue(b)-leaderboardRankingValue(a) || String(a.username||'').localeCompare(String(b.username||'')))", 1)

old_qualified = "const qualified=vb>=minBet||(minDep>0&&dep>=minDep)"
if old_qualified not in source:
    raise SystemExit('PATCH_STOP: leaderboard table qualification target not found')
source = source.replace(old_qualified, "const qualified=leaderboardQualified(p)", 1)
source = source.replace("const rank=qualified?i+1:null", "const rank=i+1", 1)
source = source.replace("const reward=inTop?(rankRwds[rank-1]?.amount||0):0", "const reward=inTop&&qualified?(rankRwds[rank-1]?.amount||0):0", 1)

old_analysis = "qualified = (parseFloat(p.valid_bet)||0) >= minBetTarget || (minDepLb>0 && playerDeposit(p)>=minDepLb)"
if old_analysis not in source:
    raise SystemExit('PATCH_STOP: campaign-analysis qualification target not found')
source = source.replace(old_analysis, "qualified = leaderboardQualified(p)", 1)

path.write_text(source)
print('Leaderboard source migration applied.')
