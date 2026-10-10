// src/lib/campaignGuide.js — bilingual (EN / 中文) guide for every campaign type.
// Shown by the ⓘ icons in the campaign creator, campaign cards and campaign detail.

export const L = (lang, en, zh) => (lang === 'zh' ? zh : en)

// key → { icon, color, name, logic, howTo, purpose, audience } each { en, zh }
export const CAMPAIGN_GUIDE = {
  gold_bar: {
    icon: '🥇', color: '#ffd700',
    name: { en: 'Gold Bar', zh: '金条奖励' },
    logic: { en: 'Player reaches a deposit target within the campaign period → receives a physical gold bar or gift of fixed value.', zh: '玩家在活动期间达到存款目标 → 获得实体金条或固定价值礼品。' },
    howTo: { en: '1) Set the deposit target and gift value. 2) Choose tiers / manual IDs. 3) Track progress in the Chase List. 4) When achieved, record delivery address and tracking number.', zh: '1) 设定存款目标与礼品价值。2) 选择等级 / 手动ID。3) 在跟进名单追踪进度。4) 达标后登记收货地址与快递单号。' },
    purpose: { en: 'Big, memorable reward that drives one large push in deposits, good for festivals and brand loyalty.', zh: '奖励大且有记忆点，推动一次性大额存款，适合节庆与品牌忠诚度。' },
    audience: { en: 'High-value VIPs (Platinum / Diamond) who can reach a high deposit target and value physical gifts.', zh: '有能力达到高存款目标、重视实体礼品的高价值VIP（白金 / 钻石）。' },
  },
  pct_reward: {
    icon: '💰', color: '#3fb950',
    name: { en: '% Reward', zh: '百分比返利' },
    logic: { en: 'Reward = total deposit in the period × reward %, optionally capped. Only paid when the minimum deposit is reached.', zh: '奖励 = 活动期间总存款 × 返利%，可设上限。达到最低存款才发放。' },
    howTo: { en: '1) Set minimum deposit, reward % and cap. 2) Select audience. 3) After the period, review the Payout tab and mark paid.', zh: '1) 设定最低存款、返利%与上限。2) 选择受众。3) 活动结束后在派彩页审核并标记已派。' },
    purpose: { en: 'Simple, easy-to-explain cashback that lifts deposit volume across many players.', zh: '简单易懂的返现，提升大量玩家的存款量。' },
    audience: { en: 'Broad VIP base, especially Stable or Declining depositors who respond to cashback.', zh: '大范围VIP，尤其是对返现敏感的稳定或下滑型存款玩家。' },
  },
  fixed_reward: {
    icon: '🎁', color: '#b9f2ff',
    name: { en: 'Fixed Reward', zh: '固定奖励' },
    logic: { en: 'Deposit reaches the target → fixed reward amount (same for everyone).', zh: '存款达到目标 → 获得固定金额奖励（每人相同）。' },
    howTo: { en: '1) Set deposit target and fixed reward. 2) Select audience. 3) Chase players near the target. 4) Pay those who achieved it.', zh: '1) 设定存款目标与固定奖励。2) 选择受众。3) 跟进接近目标的玩家。4) 为达标者派奖。' },
    purpose: { en: 'Clear target with a known cost — easy budgeting.', zh: '目标清晰、成本可控，方便预算。' },
    audience: { en: 'Players whose normal deposit is slightly below the target, to stretch them a little.', zh: '平时存款略低于目标的玩家，推动他们多存一点。' },
  },
  tiered_deposit_reward: {
    icon: '🎁', color: '#b9f2ff',
    name: { en: 'Tiered Deposit Reward', zh: '阶梯存款奖励' },
    logic: { en: 'Several deposit levels (e.g. 10K / 30K / 50K), each with its own fixed Credit. Pay all unlocked levels or only the highest.', zh: '多个存款级别（如 10K / 30K / 50K），每级有固定Credit。可选择派发所有已解锁级别或只派最高级。' },
    howTo: { en: '1) Add levels with deposit threshold and Credit. 2) Choose payout mode. 3) Track which level each player unlocked. 4) Pay per level.', zh: '1) 添加级别：存款门槛与Credit。2) 选择派彩模式。3) 追踪每位玩家解锁的级别。4) 按级别派发。' },
    purpose: { en: 'Gives every player a reachable next step, so both small and big depositors are motivated.', zh: '让每位玩家都有可达到的下一级，大小玩家都有动力。' },
    audience: { en: 'Mixed-value groups (Gold to Diamond) in one campaign.', zh: '同一活动内价值不同的混合群体（黄金至钻石）。' },
  },
  tiered_reward: {
    icon: '📊', color: '#f0883e',
    name: { en: 'Tiered % Reward', zh: '阶梯百分比返利' },
    logic: { en: 'Reward % depends on the deposit band (e.g. 10K–30K = 1.5%, 30K–50K = 3%, 50K+ = 6%). More deposit = higher %.', zh: '返利%按存款区间决定（如 10K–30K = 1.5%，30K–50K = 3%，50K+ = 6%）。存越多比例越高。' },
    howTo: { en: '1) Define deposit bands and %. 2) Select audience. 3) Show players the next band in the Chase List. 4) Pay after the period.', zh: '1) 设定存款区间与百分比。2) 选择受众。3) 在跟进名单提示玩家下一个区间。4) 活动后派发。' },
    purpose: { en: 'Encourages players to move up to the next deposit band.', zh: '鼓励玩家升到更高的存款区间。' },
    audience: { en: 'Growing and Stable depositors who can be pushed to a higher band.', zh: '可以被推向更高区间的增长型与稳定型存款玩家。' },
  },
  dual_tier: {
    icon: '🎯', color: '#c9a961',
    name: { en: 'Deposit + Turnover Tiers', zh: '存款 + 流水阶梯' },
    logic: { en: 'Player must reach BOTH the deposit AND turnover of a tier to get that tier’s Credit + WCash. Can settle on the total period or daily, with optional streak bonus.', zh: '玩家需同时达到某级的存款与流水，才能获得该级Credit + WCash。可按总期或每日结算，可选连续奖励。' },
    howTo: { en: '1) Add tiers (deposit, turnover, Credit, WCash). 2) Choose total or daily settlement. 3) Daily mode: enter daily turnover. 4) Pay from the Payout tab.', zh: '1) 添加级别（存款、流水、Credit、WCash）。2) 选择总期或每日结算。3) 每日模式：录入每日流水。4) 在派彩页派发。' },
    purpose: { en: 'Rewards real play (turnover), not just deposits — protects margin.', zh: '奖励真实投注（流水）而非仅存款，保护利润。' },
    audience: { en: 'Active players with steady turnover.', zh: '流水稳定的活跃玩家。' },
  },
  leaderboard: {
    icon: '🏆', color: '#a78bfa',
    name: { en: 'Leaderboard', zh: '排行榜' },
    logic: { en: 'Players ranked by turnover, deposit, or both. The top N each receive the rank reward. Minimum turnover / deposit to qualify.', zh: '按流水、存款或两者排名。前N名获得对应名次奖励。需达到最低流水 / 存款才有资格。' },
    howTo: { en: '1) Choose the metric, minimums and top N. 2) Set the reward per rank. 3) Share live ranking with players. 4) Pay the winners.', zh: '1) 选择排名指标、最低门槛与前N名。2) 设定每个名次奖励。3) 向玩家分享实时排名。4) 为获奖者派奖。' },
    purpose: { en: 'Competition drives the biggest players to play more during a short window.', zh: '竞争刺激大玩家在短期内投入更多。' },
    audience: { en: 'Top-volume, competitive VIPs (Diamond / Black).', zh: '大流水、好胜心强的VIP（钻石 / 黑卡）。' },
  },
  challenge_trust: {
    icon: '💝', color: '#f472b6',
    name: { en: 'Trust Credit Challenge', zh: '信任金挑战' },
    logic: { en: 'You give the player free credit first (e.g. RM 6,888). You set a personal turnover task (e.g. RM 500K–1.5M in 7 days). If they complete it, the system suggests a bonus (% of turnover) and you approve the final amount. Optional streak bonus: deposit ≥ RM X on at least N days in the period → fixed amount or % of period deposits. Progress is tracked automatically from daily turnover / deposit data.', zh: '先赠送玩家免费信用额（如 RM 6,888）。为每位玩家设定专属流水任务（如7天内 RM 500K–1.5M）。完成后系统按流水%建议奖金，由你审核最终金额。可选连续奖励：活动期内至少N天每日存款 ≥ RM X → 固定金额或期内存款%。进度自动从每日流水 / 存款数据追踪。' },
    howTo: { en: '1) Pick the Trust Credit template. 2) Filter audience (e.g. high 30-day loss, Silent / Declining). 3) Review the suggested credit and turnover target per player and adjust. 4) Give the credit in BO and mark “Credit given”. 5) Chase progress with the WhatsApp progress message. 6) After the end date, approve the bonus for completed players and pay. 7) Watch the 30-day follow-up deposits to see if the player came back.', zh: '1) 选择信任金模板。2) 筛选受众（如30天亏损高、沉默 / 下滑）。3) 检查并调整每位玩家的建议信用额与流水目标。4) 在BO发放信用额并标记“已发放”。5) 用WhatsApp进度信息跟进。6) 结束后为完成者审核奖金并派发。7) 观察30天后续存款，判断玩家是否回流。' },
    purpose: { en: 'An investment to rebuild trust with valuable players after a bad run, giving them a clear task and a reason to stay with SureWin.', zh: '一种投资：在玩家经历低潮后重建信任，给他们明确任务与留在SureWin的理由。' },
    audience: { en: 'Valuable VIPs with a high recent net loss who are Silent or Declining. Avoid players showing escalation signs (many deposits per day, sudden spike); the CRM flags them with ⚠️ for you to decide.', zh: '近期净亏损高、处于沉默或下滑状态的高价值VIP。避开有失控迹象的玩家（一天多次存款、存款突然暴增），系统会以 ⚠️ 标记供你判断。' },
  },
  challenge_rebate: {
    icon: '💰', color: '#22d3ee',
    name: { en: 'Rebate Challenge', zh: '返水挑战' },
    logic: { en: 'Player completes a deposit and/or turnover target in the period → receives a rebate of X% (e.g. 0.2–0.3%) of total turnover, with an optional cap. Optional streak bonus for daily deposits (at least N days with deposit ≥ RM X). Progress is tracked automatically.', zh: '玩家在活动期间完成存款和/或流水目标 → 获得总流水 X%（如 0.2–0.3%）的返水，可设上限。可选每日存款连续奖励（至少N天每日存款 ≥ RM X）。进度自动追踪。' },
    howTo: { en: '1) Pick the Rebate template. 2) Set the default target (or use the suggested personal target) and rebate %. 3) Set streak rules. 4) Select audience. 5) Chase with WhatsApp progress messages. 6) After the end date, pay rebate + streak from the detail page.', zh: '1) 选择返水模板。2) 设定默认目标（或使用系统建议的个人目标）与返水%。3) 设定连续规则。4) 选择受众。5) 用WhatsApp进度信息跟进。6) 结束后在详情页派发返水与连续奖励。' },
    purpose: { en: 'Rewards real turnover with a cost that scales with play, and builds a daily deposit habit through the streak.', zh: '按真实流水奖励，成本随投注量变化；通过连续奖励培养每日存款习惯。' },
    audience: { en: 'Active, Stable or Growing players with steady turnover; also Declining players to lift volume.', zh: '流水稳定的活跃、稳定或增长型玩家；也适合下滑型玩家以拉升流水。' },
  },
}

export const GUIDE_ORDER = ['challenge_trust', 'challenge_rebate', 'dual_tier', 'tiered_deposit_reward', 'tiered_reward', 'pct_reward', 'fixed_reward', 'gold_bar', 'leaderboard']

// Map a campaign row (or creator type key) to its guide key
export function guideKeyFor(campaignOrType) {
  if (!campaignOrType) return null
  if (typeof campaignOrType === 'string') return CAMPAIGN_GUIDE[campaignOrType] ? campaignOrType : null
  const c = campaignOrType
  if (c.campaign_type === 'challenge') return c.challenge_config?.mode === 'rebate' ? 'challenge_rebate' : 'challenge_trust'
  if (c.campaign_type === 'fixed_reward' && c.is_multi_level) return 'tiered_deposit_reward'
  return CAMPAIGN_GUIDE[c.campaign_type] ? c.campaign_type : null
}
