const RETENTION_TIER_RANK = { DIAMOND: 0, PLATINUM: 1, GOLD: 2, SILVER: 3, BRONZE: 4 }
const RETENTION_RISK_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, NORMAL: 3 }
export function getRetentionTierRank(tier) { return RETENTION_TIER_RANK[String(tier || '').trim().toUpperCase()] ?? 99 }
export function isPriorityRetentionTier(tier) { const normalizedTier = String(tier || '').trim().toUpperCase(); return normalizedTier === 'DIAMOND' || normalizedTier === 'PLATINUM' }
export function sortRetentionPlayers(rows = []) { return [...rows].sort((a,b)=>{ const tierRank=getRetentionTierRank(a?.tier)-getRetentionTierRank(b?.tier); if(tierRank!==0)return tierRank; const riskA=RETENTION_RISK_RANK[String(a?.churn_risk||a?.risk_level||'').trim().toUpperCase()]??3; const riskB=RETENTION_RISK_RANK[String(b?.churn_risk||b?.risk_level||'').trim().toUpperCase()]??3; if(riskA!==riskB)return riskA-riskB; const inactiveA=Number(a?.days_inactive??a?.days_since_deposit??0)||0; const inactiveB=Number(b?.days_inactive??b?.days_since_deposit??0)||0; if(inactiveA!==inactiveB)return inactiveB-inactiveA; return String(a?.username||'').localeCompare(String(b?.username||'')) }) }

export function daysSince(dateValue, now = new Date()) { if (!dateValue) return null; const then=new Date(dateValue); const current=now instanceof Date?now:new Date(now); if(Number.isNaN(then.getTime())||Number.isNaN(current.getTime()))return null; return Math.max(0,Math.floor((current.getTime()-then.getTime())/86400000)) }
export function isFollowUpDue({ lastContact, contactedToday }, now = new Date()) { if(contactedToday)return false; if(!lastContact)return true; const days=daysSince(lastContact,now); return days!==null&&days>=3 }
export function calculateChurnUrgency({ declinePct, daysSinceDeposit, depletionDays, netWinLoss3d, memberInactiveDays }) {
  const reasons=[]
  let urgencyScore=0
  const decline=Number(declinePct)
  const hasDepositDate=daysSinceDeposit !== null && daysSinceDeposit !== undefined && daysSinceDeposit !== ''
  const inactive=hasDepositDate ? Number(daysSinceDeposit) : null
  const depletion=Number(depletionDays)||0
  const loss=Number(netWinLoss3d)||0
  const memberDays=Number(memberInactiveDays)||0
  if(Number.isFinite(decline)&&decline<=-50){reasons.push('deposit_decline');urgencyScore+=3}
  if(hasDepositDate&&Number.isFinite(inactive)&&inactive>=3){reasons.push('no_recent_deposit');urgencyScore+=2}
  if(depletion>=1){reasons.push('balance_depletion');urgencyScore+=2}
  if(loss<=-2000){reasons.push('recent_net_loss');urgencyScore+=1}
  if(!hasDepositDate&&memberDays>=3){reasons.push('member_inactive');urgencyScore=Math.max(urgencyScore,2)}
  return { urgencyScore, reasons }
}
export function getRetentionPriority({ tier, churn_risk, days_inactive }) { const risk=String(churn_risk||'').toUpperCase(); if(risk==='CRITICAL')return'CRITICAL'; if(risk==='HIGH')return'HIGH'; if(risk==='MEDIUM')return'MEDIUM'; const normalizedTier=String(tier||'').toUpperCase(); const days=Number(days_inactive)||0; if(['DIAMOND','BLACK','PLATINUM'].includes(normalizedTier)&&days>=14)return'HIGH'; if(['DIAMOND','BLACK','PLATINUM'].includes(normalizedTier)&&days>=7)return'MEDIUM'; return'NORMAL' }
export function calculateRate(numerator, denominator) { const n=Number(numerator)||0; const d=Number(denominator)||0; return d===0?0:Math.round((n/d)*100) }
export function sumByCurrency(rows = []) { return rows.reduce((totals,row)=>{ const currency=String(row?.currency||'').toUpperCase(); const amount=Number(row?.amount)||0; if(currency)totals[currency]=(totals[currency]||0)+amount; return totals },{}) }
export function latestSnapshotMonth(snapshotMonths = [], currentMonth) { const current=String(currentMonth||'').slice(0,7); const candidates=[...new Set(snapshotMonths.map(value=>String(value||'').slice(0,7)).filter(Boolean))].filter(value=>!current||value<=current).sort(); return candidates.at(-1)||current||null }
export function resolveSnapshotWindow(snapshotMonths = [], selectedMonth) { const selected=String(selectedMonth||'').slice(0,7); const available=[...new Set(snapshotMonths.map(value=>String(value||'').slice(0,7)).filter(Boolean))].filter(month=>!selected||month<=selected).sort(); const currentMonth=available.at(-1)||selected||null; const previousMonth=currentMonth?[...available].reverse().find(month=>month<currentMonth)||null:null; return {selectedMonth:selected||null,currentMonth,previousMonth,usedFallback:Boolean(selected&&currentMonth&&selected!==currentMonth)} }
