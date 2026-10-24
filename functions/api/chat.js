// functions/api/chat.js
// Cloudflare Pages Function — POST /api/chat
//
// Powers:
//   • Ask Data page (/ask)           — natural-language CRM questions
//   • Floating ✨ Ask AI button      — same questions with page context
//
// The model gets read-only tools (find_players, player_detail, alerts, …) and
// looks data up itself, a few rounds per question. Lookups run with the
// caller's own Supabase login, so RLS decides what they can see.
// DB helpers: ai_players(jsonb), ai_money_games(jsonb) + existing RPCs/views.
//
// Required Cloudflare Pages env vars (Settings → Environment variables):
//   SUPABASE_URL          e.g. https://utopskwciorvooronpwg.supabase.co
//   SUPABASE_ANON_KEY     your project's anon/public key
//   OPENAI_API_KEY        your OpenAI API key (secret)

import { summarizeImpact, VERDICT, LASTING } from '../../src/lib/campaignImpactCore.js'
import { buildCampaignDraft, challengePlayer, estimateCost, kindGuideText, GOAL_TO_KIND } from '../../src/lib/aiCampaignDraft.js'

const OPENAI_MODEL   = 'gpt-4.1'
const MAX_TOKENS     = 3000
const MAX_ROUNDS     = 6      // tool-calling rounds per question
const MAX_DB_CALLS   = 40     // Cloudflare allows 50 subrequests per request
const MAX_TOOL_CHARS = 20000  // per tool result sent back to the model

// ─── CRM System Knowledge ─────────────────────────────────────────────────────
// Injected into every Ask Data prompt so the AI can teach users how the
// campaign system works, explain fields, and check settings.

const CRM_SYSTEM_KNOWLEDGE = `
═══ CRM SYSTEM KNOWLEDGE (how this CRM works) ═══

You know the complete structure of the Campaign system. Use this knowledge to:
• Teach the host how to create a campaign step by step
• Explain what any campaign setting means
• Check whether a campaign's settings look correct
• Explain how reward calculations work
• Guide the host through using any tab or feature

── CAMPAIGN TYPES ───────────────────────────────────────────────────────────
There are 6 campaign types, each with its own reward logic:

1. GOLD BAR (gold_bar)
   - Player deposits ≥ deposit_target → receives a physical gold bar or gift
   - gold_bar_value field shows the RM value of the gold bar
   - Example: Deposit ≥ RM 50,000 → receive gold bar worth RM 3,400
   - Good for: high-value single-shot incentive campaigns

2. % REWARD (pct_reward)
   - Player deposits ≥ deposit_target → earns deposit × reward_pct%
   - Optional reward_cap limits the maximum payout (e.g. max RM 5,000)
   - Example: Deposit RM 50,000 × 6% = RM 3,000 Credit reward
   - Good for: scalable deposit incentives where bigger deposit = bigger reward

3. FIXED REWARD (fixed_reward)
   - Single level: deposit ≥ deposit_target → fixed reward_fixed amount
   - Multi-level (is_multi_level=true): multiple thresholds each unlock a credit reward
     e.g. Level 1: deposit ≥ RM 30k → RM 800 credit; Level 2: ≥ RM 50k → RM 1,500 credit
     The player can unlock multiple levels — each unlocked level pays its own credit amount
     Levels are additive: hitting Level 2 doesn't lose Level 1 reward
   - Good for: milestone-style campaigns with increasing incentives

4. TIERED % REWARD (tiered_reward)
   - Multiple deposit ranges, each with its own reward %
   - The % applies to the FULL deposit amount at the highest qualifying tier (not cumulative)
   - Example tiers: RM 10k-29,999 → 1.5% | RM 30k-49,999 → 3% | RM 50k+ → 6%
   - Player deposits RM 35,000 → highest qualifying tier is 3% → reward = RM 35,000 × 3% = RM 1,050
   - Good for: encouraging larger deposits with better rates for higher amounts

5. DEPOSIT + TURNOVER TIERS (dual_tier)
   - Player must meet BOTH a deposit threshold AND a turnover threshold simultaneously
   - Earns the HIGHEST tier where BOTH conditions are met at the same time
   - Each tier has: depositThreshold (RM), turnoverThreshold (RM), creditAmount, wcashAmount
   - Two settlement modes:
     a) TOTAL (settlement_frequency='total'): accumulates across the whole campaign period
     b) DAILY (settlement_frequency='daily'): each day is independent — no carry-over between days
        Daily mode uses a day-by-day entry screen to record each day's deposit + turnover
   - Reward is in Credit (cash) + WCash (withdrawal cash) — these are DIFFERENT reward types
   - Example: Tier 1: deposit ≥ RM 10,000 + turnover ≥ RM 50,000 → RM 200 credit + RM 200 wcash
   - Good for: rewarding both deposit activity AND betting turnover

6. LEADERBOARD (leaderboard)
   - Top N players by valid bet (or deposit, or both) win rank prizes
   - min_valid_bet: minimum monthly valid bet required to qualify
   - min_deposit_lb: optional minimum deposit requirement (in addition or alternative)
   - leaderboard_metric: 'turnover' (default), 'deposit', or 'turnover_deposit' (both required)
   - top_n: how many prize slots (e.g. top 3)
   - rank_rewards: each rank has an amount (e.g. Rank 1 = RM 12,000, Rank 2 = RM 8,000)
   - Players must qualify (meet minimums) to be eligible; ranked by their metric
   - Good for: competitive monthly challenges among VIPs

── CAMPAIGN STATUS FLOW ─────────────────────────────────────────────────────
draft → (publish) → upcoming (if start_date is future) or active (if start_date is today/past)
upcoming → (launch now) → active
active → (pause) → paused
paused → (resume) → active
active/paused → (end) → ended

- DRAFT: not live, not visible to players, editing allowed
- UPCOMING: published but campaign hasn't started yet
- ACTIVE: campaign is running, daily entries or player progress being recorded
- PAUSED: temporarily suspended
- ENDED: campaign is finished; rewards can still be marked paid

── REQUIRED FIELDS WHEN CREATING A CAMPAIGN ─────────────────────────────────
All campaigns need:
• campaign_type: the type (gold_bar / pct_reward / fixed_reward / tiered_reward / dual_tier / leaderboard)
• campaign_name: descriptive name (e.g. "September Deposit Reward")
• campaign_code: short code in capitals (e.g. "DEP-REWARD-SEP26")
• platform: MY (Malaysia), SG (Singapore), KH (Cambodia), or BOTH
• status: usually start as "draft"
• start_date and end_date: date range of the campaign
• budget_rm: total reward budget (RM)
• reward_delivery: how reward is paid out — Credit, WCash (withdrawal cash), Gold Bar, Gift, Voucher

Type-specific required fields:
• gold_bar: deposit_target (min deposit RM), gold_bar_value (gold bar RM value)
• pct_reward: deposit_target, reward_pct (e.g. 6 for 6%), optionally reward_cap
• fixed_reward: deposit_target, reward_fixed (RM amount); or campaign_levels for multi-level
• tiered_reward: deposit_target, reward_tiers (array of {min, max, pct})
• dual_tier: reward_tiers (array of {depositThreshold, turnoverThreshold, creditAmount, wcashAmount}), settlement_frequency (total or daily)
• leaderboard: min_valid_bet, top_n, rank_rewards (array of {rank, amount, desc}), optionally min_deposit_lb

Optional fields:
• offer_desc: description of the offer (shown on campaign card)
• target_tier: which VIP tiers this campaign targets (GOLD/PLATINUM/DIAMOND)
• turnover_multiplier: e.g. 3 = reward × 3 required turnover before withdrawal
• notes: internal notes
• whatsapp_template: custom WA message template for this campaign
  Placeholders: {username}, {campaign}, {agent}, {gap}
• festival: occasion name (e.g. "Merdeka 2026")
• campaign_category: standard / deposit_milestone / leaderboard / vip_exclusive

── HOW TO CREATE A CAMPAIGN (step by step) ──────────────────────────────────
1. Go to Campaigns page → click "+ New Campaign"
2. Select the campaign type (explains reward logic in the picker)
3. Fill in: Campaign Name, Campaign Code (UPPERCASE), Platform, Status (start as "draft")
4. Enter Start Date and End Date
5. Enter the type-specific reward fields (see above)
6. Select Reward Delivery Method (Credit / WCash / Gold Bar / Gift / Voucher)
7. Optionally select Target Tiers and fill in Offer Description and Notes
8. Click "Create Campaign" → campaign is saved as draft
9. Open the campaign, click "Edit" to enroll VIP players
10. When ready, click "Activate" (or "Publish Upcoming" if start date is future)

── ENROLLING PLAYERS ─────────────────────────────────────────────────────────
• Open a campaign → detail modal appears
• Use the "Add VIP" button or bulk-add from VIP list
• Players are stored in campaign_players table
• Each enrolled player has: status (active/dropped), payout_status (pending/paid)
• For multi-level fixed_reward campaigns: enrolling a player triggers sync_manual_campaign_player_progress RPC to calculate progress

── DAILY ENTRY (for dual_tier daily mode) ────────────────────────────────────
• Open the campaign → "Chase" tab shows a date selector at the top
• Select the date, enter each player's deposit_amount and turnover_amount
• Click Save — the system calculates the reward for that day automatically
• Each date is independent: depositing RM 5,000 on Day 1 does NOT carry to Day 2
• The reward calculation checks if both deposit AND turnover thresholds are met
• "Import from VIP Data" button: auto-pulls deposit + turnover from actual platform snapshots
  (vip_daily_snapshots table) — useful to avoid manual entry

── CAMPAIGN TABS (in the campaign detail modal) ──────────────────────────────
CHASE TAB (default view):
• Shows all enrolled players sorted by deposit (highest first)
• Columns: username, tier, host, deposit, status (qualified / near target / in progress)
• "Near target" = 70%+ of deposit goal but not yet qualified
• "In progress" = below 70% of goal
• WhatsApp button (green W) builds a progress-aware WA message for each player
• Filter by host or search by username
• For leaderboard campaigns: shows rank, valid bet, whether in top N

PAYOUT TAB:
• Shows only players who have QUALIFIED (met the reward condition)
• For daily dual_tier: shows all days with any qualifying entries (credit/wcash > 0)
• Columns: username, deposit, reward earned, payout status (pending/paid)
• Click "Mark Paid" to record that reward was delivered
• Shows totals: total reward owed, total paid, total pending

INACTIVE TAB:
• Players who enrolled but have NOT made any qualifying entries recently
• For daily mode: players with no entries in the last 7 days
• Helps identify which enrolled players need a chase call

STREAK TAB (only for streak-enabled campaigns):
• Shows streak bonus records — each completed N-day streak earns a bonus
• streak_days: how many consecutive qualifying days = 1 streak (e.g. 3)
• Streak bonus types: percentage of period deposit OR fixed amount
• Per-player cap override possible (streak_bonus_cap_override)
• Payout date = last day of streak period + 1 day
• Streaks break if player misses a day (no carry-over for non-consecutive days)

SUMMARY TAB (dual_tier daily mode):
• Shows aggregate across all days of the campaign
• Total: qualifying entries, unique participants, total credit reward, total wcash reward
• Per-player breakdown: total credit, total wcash, qualifying days
• Tier hit counts: how many entries hit each tier
• Paid vs pending split (Credit and WCash tracked separately — never combined)

ALL TAB:
• Full list of all enrolled players regardless of qualification status
• Useful for bulk operations and overall view

── REWARD CALCULATION DETAILS ────────────────────────────────────────────────
pct_reward: reward = deposit × (reward_pct / 100), capped at reward_cap if set
  e.g. RM 80,000 × 6% = RM 4,800; if cap = RM 4,000 → reward = RM 4,000

tiered_reward: find the highest tier where deposit falls (by min/max range)
  Apply that tier's % to the FULL deposit amount
  e.g. Tiers: 10k-29,999→1.5%, 30k-49,999→3%, 50k+→6%
  Player deposits RM 35,000 → highest qualifying tier is 3% → RM 35,000 × 3% = RM 1,050

dual_tier: player must meet BOTH deposit AND turnover thresholds simultaneously
  Find the HIGHEST tier where BOTH are satisfied
  e.g. Tiers: T1(dep≥10k, to≥50k → RM200 credit+RM200 wcash), T2(dep≥20k, to≥100k → RM400+RM400)
  Player: dep=RM 25,000, turnover=RM 80,000 → meets T1 but not T2 → earns RM 200 credit + RM 200 wcash

fixed_reward multi-level: each level is independent; all qualifying levels earn their reward
  Levels sorted by deposit_threshold ascending
  Player qualifies for every level whose threshold they have exceeded

leaderboard: players ranked by valid_bet (or deposit) descending
  Only players meeting min_valid_bet qualify
  Top N qualified players earn their rank's reward amount
  A player not meeting min_valid_bet does not qualify even if they rank in top N by bet size

── CONTACT LOG TYPES ─────────────────────────────────────────────────────────
Contact logs track all player interactions. Types:
• daily: regular daily check-in or update
• wa_sent: WhatsApp message was sent to the player
• responded: player responded to outreach
• no_response: player did not respond
• promised: player promised to deposit
• deposited: player actually deposited after promise
• reward: reward was credited/paid to player
• inactive: player marked as inactive after no activity
• other: any other type of note

── WHATSAPP MESSAGING ────────────────────────────────────────────────────────
• Every player row in Chase tab has a green "W" button
• Auto-builds a progress-aware message showing exactly how much more the player needs
• For pct_reward/fixed_reward: shows gap to deposit_target
• For dual_tier: shows gap to next tier (both deposit and turnover gaps)
• For leaderboard: shows rank, whether in top N, valid bet needed to reach top N
• For multi-level: shows which levels completed and what's needed for next level
• Custom template: set whatsapp_template on campaign with {username}, {campaign}, {agent}, {gap} placeholders
• Message opens WhatsApp web with pre-filled message — host reviews before sending

── PAYOUT / REWARD DELIVERY ──────────────────────────────────────────────────
Reward delivery methods:
• Credit: credited directly to player's account (most common)
• WCash: withdrawal cash — has wagering requirement before player can withdraw
• Gold Bar: physical gold bar or gift item
• Gift: physical gift
• Voucher: voucher code or physical voucher

Payout tracking:
• Each player has payout_status: "pending" or "paid"
• Mark as paid in the Payout tab after delivering the reward
• For multi-level: each level tracks separately via campaign_rewards table

── REAL FINANCIALS vs CAMPAIGN ENTRIES ───────────────────────────────────────
IMPORTANT DISTINCTION (used when checking campaign ROI):
• campaign_players.total_deposit / daily_turnover_entries: MANUALLY ENTERED values
  These are used purely to judge reward qualification — they may differ from actual platform data
• vip_daily_snapshots: REAL platform data (actual deposits, withdrawals, valid bet)
  The "Real Financials" section on each campaign uses snapshot data for profitability analysis
  Only counts days where monthly_valid_bet > 0 (inactive days have stale data on the platform)

── CHECKING IF A CAMPAIGN SETTING IS CORRECT ────────────────────────────────
When asked to check a campaign's settings, verify:
1. campaign_type matches the intended reward structure
2. start_date and end_date cover the right period
3. deposit_target is set appropriately (not 0, not too high or too low)
4. For pct_reward: reward_pct is a number 1-20 (e.g. 6 = 6%), reward_cap if needed
5. For dual_tier daily: settlement_frequency = 'daily', tiers have both deposit + turnover thresholds
6. For dual_tier: each tier must have turnoverThreshold set; depositThreshold is optional
7. For leaderboard: min_valid_bet is realistic, top_n matches rank_rewards array length
8. For tiered_reward: tier ranges shouldn't overlap; the highest tier should have no max (blank)
9. budget_rm should be >= the potential total reward payout
10. target_tier should include the right tiers (empty = all tiers eligible)
11. platform should match where the players are (MY/SG/KH/BOTH)
12. status: draft = not live, active = running, ended = finished
`

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  try {
    const token = extractToken(request)
    if (!token) return err('Unauthorized', 401)

    const authUser = await verifySupabaseToken(token, env)
    if (!authUser) return err('Unauthorized — session invalid or expired', 401)

    let body
    try { body = await request.json() }
    catch { return err('Invalid JSON body', 400) }

    const { question, history = [], language = 'en' } = body
    if (!question?.trim()) return err('"question" is required', 400)

    // Every lookup runs with the caller's own login, so database security (RLS) applies
    const db = makeDb(env, token)
    const [profile, dataDate] = await Promise.all([
      db.rows(`profiles?select=full_name,email,role&id=eq.${authUser.id}&limit=1`).then(r => r[0] || {}).catch(() => ({})),
      db.rows('vip_daily_snapshots_all?select=snapshot_date&order=snapshot_date.desc&limit=1').then(r => r[0]?.snapshot_date || '').catch(() => ''),
    ])

    const messages = [
      { role: 'system', content: buildSystemPrompt({ language, profile, dataDate }) },
      ...history.slice(-6).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
      { role: 'user', content: question.trim() },
    ]

    const { answer, steps, actions } = await runAgent(messages, db, env)
    return ok({ answer, steps, actions, data_date: dataDate })

  } catch (e) {
    console.error('[/api/chat] unhandled error:', e?.message || e)
    // Show the real reason (e.g. OpenAI quota / key problem) so it can be fixed;
    // only logged-in staff reach this point, and no secrets are in these messages.
    return err(`Server error: ${String(e?.message || e).slice(0, 300)}`, 500)
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function extractToken(request) {
  const auth = request.headers.get('Authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? m[1] : null
}

async function verifySupabaseToken(token, env) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (!res.ok) return null
  return res.json()  // { id, email, ... }
}

// ─── Supabase REST helper (caller's token) ────────────────────────────────────

function makeDb(env, token) {
  let calls = 0
  const headers = {
    apikey:         env.SUPABASE_ANON_KEY,
    Authorization:  `Bearer ${token}`,
    Accept:         'application/json',
    'Content-Type': 'application/json',
  }
  async function go(url, init) {
    if (++calls > MAX_DB_CALLS) throw new Error('Too many lookups for one question — ask something narrower')
    const res = await fetch(url, { headers, ...init })
    const text = await res.text()
    if (!res.ok) throw new Error(`database ${res.status}: ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }
  return {
    rows: path => go(`${env.SUPABASE_URL}/rest/v1/${path}`),
    rpc:  (fn, args) => go(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}) }),
  }
}

// ─── Tools the AI can call (all read-only) ────────────────────────────────────

const FILTER_PROPS = {
  tiers:       { type: 'array', items: { type: 'string', enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'DIAMOND-P', 'BLACK'] } },
  currencies:  { type: 'array', items: { type: 'string', enum: ['MYR', 'SGD', 'KHUSD'] } },
  statuses:    { type: 'array', items: { type: 'string', enum: ['Active', 'Resting', 'At Risk', 'Churn', 'Dormant', 'Unknown'] } },
  hosts:       { type: 'array', items: { type: 'string' }, description: 'VIP manager names as stored in host_assigned, e.g. "Angel", "Jennifer", "Marcus"' },
  no_host:     { type: 'boolean', description: 'only players with no manager assigned' },
  usernames:   { type: 'array', items: { type: 'string' }, description: 'exact usernames' },
  search:      { type: 'string', description: 'part of a username' },
  min_days_inactive: { type: 'integer' },
  max_days_inactive: { type: 'integer' },
  lifecycles:  { type: 'array', items: { type: 'string', enum: ['Active', 'Resting', 'At Risk', 'Churn', 'Dormant', 'Unknown'] }, description: 'segment lifecycle (Gold+ only)' },
  value_bands: { type: 'array', items: { type: 'string', enum: ['V1 Minimal', 'V2 Low', 'V3 Mid', 'V4 High', 'V5 Top'] }, description: '90-day deposit value band (Gold+ only)' },
  behaviours:  { type: 'array', items: { type: 'string', enum: ['Big ticket', 'Regular', 'Small & frequent', 'No deposit data'] }, description: 'deposit style (Gold+ only)' },
  preferences: { type: 'array', items: { type: 'string', enum: ['Live casino', 'Slots', 'Sports', 'Mixed', 'No game data'] }, description: 'main game type (Gold+ only)' },
  period_from: { type: 'string', description: 'YYYY-MM-DD, start of the money period (default: 29 days before period_to)' },
  period_to:   { type: 'string', description: 'YYYY-MM-DD, end of the money period (default: latest data date)' },
  min_deposit: { type: 'number', description: 'period deposit ≥' },
  max_deposit: { type: 'number', description: 'period deposit ≤' },
  min_valid_bet: { type: 'number', description: 'period valid bet ≥' },
  min_win_loss:  { type: 'number', description: 'period player win/loss ≥ (positive = player won)' },
  max_win_loss:  { type: 'number', description: 'period player win/loss ≤ (e.g. -100000 = lost 100k or more)' },
  birthday_within_days: { type: 'integer', description: 'birthday in the next N days' },
  upgrade_ready: { type: 'boolean', description: 'true = this month\'s valid bet already reaches a higher tier (qualifies_for is set); false = not yet' },
}

const tool = (name, description, properties = {}, required = []) =>
  ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } })

const TASK_TYPES = ['Follow Up', 'Call', 'VIP Contact', 'Campaign', 'Upgrade', 'Birthday', 'Review', 'Other']

// Tables the ask_sql safety net may read (contact columns left out on purpose; the DB function
// ai_readonly_query only runs one SELECT, as the caller, inside a read-only function, max 200 rows)
const SQL_GUIDE = `Main tables / views (public schema):
vip_members_all(username,tier,currency,region,host_assigned,activity_status,churn_risk,days_inactive,last_deposit_date,last_bet_date,last_contacted,birthday,join_date,registration_date,fav_game,lang_pref,best_contact_time,reply_rate,vip_score,is_excluded,personality_notes,interests_topics,special_requests,affiliate_login,upgrade_date,last_big_win,last_big_loss) — one row per player; its money columns are only the LATEST day, do not use them for totals
vip_daily_snapshots_all(username,snapshot_date,tier,currency,host_assigned,total_deposit,total_withdrawal,monthly_valid_bet,win_loss,bet_count,deposit_count,bonus_amount,total_rebate) — one row per player per day; monthly_valid_bet here = that DAY's valid bet; count deposit/withdrawal/win_loss only where monthly_valid_bet > 0
vip_monthly_totals(username,snapshot_month,tier,currency,host_assigned,total_deposit,total_withdrawal,monthly_valid_bet,win_loss,bonus_amount,days_with_data) — trusted month totals
v_vip_segments(username,tier,currency,host_assigned,lifecycle,dep_90d,value_band,behaviour,dep_trend,preference,games_month) — Gold+ only
v_vip_recent_stats(username,data_as_of,dep_30d,wd_30d,loss_30d,loss_60d,turnover_30d,active_days_30d,deposit_days_30d,dep_7d,dep_prev_28d)
contact_logs(username,tier,channel,direction,intent,message_summary,vip_response,outcome,follow_up_date,host_name,logged_at,log_month,emotion_tag,topic,bonus_offered,bonus_type)
tasks(title,task_type,vip_username,vip_tier,assigned_to,due_date,priority,status,source,completed_at)
campaigns(id,campaign_code,campaign_name,campaign_type,status,platform,start_date,end_date,target_tier,offer_desc,budget_rm,deposit_target,reward_pct,reward_fixed,reward_cap,reward_tiers,min_valid_bet,top_n,rank_rewards,leaderboard_metric,challenge_config,impact_cost)
campaign_players(campaign_id,username,tier,status,total_deposit,valid_bet,total_withdrawal,reward_amount,payout_status,rank_position,enrolled_at,enrollment_source)
vip_bonus_txns(username,txn_at,month,bonus_name,category,amount,currency)
department_expenses(month,category,item_name,platform,currency,amount,expense_type,linked_campaign,vip_username)
cash_voucher_claims(claimed_at,claim_month,username,currency,amount,status,satisfaction,recommend_score,feedback)
gift_logs(username,birthday_year,gift_type,gift_cost,bonus_given,total_spent,contacted,contact_date)
birthday_engine(username,tier,birthday,gift_type,budget_rm,gift_status,sent_date,host_name)
reactivation_logs(username,tier,currency,reactivated_month,days_was_inactive,prev_last_deposit,new_deposit_date,reactivation_deposit,host_name)
tier_change_logs(username,old_tier,new_tier,changed_at,import_month,source)
provider_player_monthly(period_month,provider,username,currency,bet_count,turnover,valid_turnover,win_loss,bonus,rebate)
v_bonus_dependency(month,username,tier,host_assigned,deposit_days,bonus_days,natural_days,deposit_total,bonus_total,bonus_cost_pct,dependency_class)
vip_profiles(username,preferred_games,deposit_pattern,deposit_trigger,preferred_contact_time,preferred_contact_channel,interests,personality_tags,relationship_level,family_tags)
retention_metrics(month,tier,total_members,metric_type,week1_pct,week2_pct,week3_pct,week4_pct,monthly_pct)
transfer_players(username,source_platform,joined_date,is_active)
crm_rules(rule_key,value,unit,category,description) · upgrade_thresholds(from_tier,to_tier,metric,threshold,is_active)
Rules: join tables on exact username = username (never lower()); always GROUP BY currency for money; dates are Malaysia time; keep queries simple (6 s limit, 200 rows).`

const TOOLS = [
  tool('find_players',
    'List players (all tiers, Bronze to Black) matching filters, with status, manager, last deposit/bet, segment, and money for the period (dep, wd, vb = valid bet, wl = player win/loss, bonus, dep_days, active_days, dep_90d). Returns total_matched and up to `limit` rows. Every row also has the upgrade picture, already calculated by the database: month_vb (valid bet this calendar month), next_tier, next_target, gap_to_next (still needed), qualifies_for (highest tier this month\'s valid bet already reaches, empty = none).',
    { ...FILTER_PROPS,
      sort: { type: 'string', enum: ['deposit', 'valid_bet', 'win_loss', 'withdrawal', 'days_inactive', 'dep_90d', 'bonus', 'last_deposit_date', 'month_vb', 'gap_to_next'], description: 'gap_to_next with ascending=true = closest to the next tier first' },
      ascending: { type: 'boolean' },
      limit: { type: 'integer', description: '1–200, default 50' } }),
  tool('summarize_players',
    'Count players and total their money for the period, grouped by one field (always split by currency). Each group also has month_valid_bet and upgrade_ready (how many already reach a higher tier this month). Use for "how many", totals, breakdowns.',
    { ...FILTER_PROPS,
      group_by: { type: 'string', enum: ['tier', 'currency', 'status', 'host', 'lifecycle', 'value_band', 'behaviour', 'preference', 'churn_risk'] } }),
  tool('player_detail',
    'Everything about ONE player: status and 30-day money, auto profile (games, deposit style, peak time, offer suggestion, reply rate), manual profile (interests, family, notes), next step, last 10 interactions, campaigns joined, tier changes.',
    { username: { type: 'string' } }, ['username']),
  tool('player_history',
    'Day-by-day or month-by-month deposit / turnover / win-loss / withdrawal for one or more players.',
    { usernames: { type: 'array', items: { type: 'string' } },
      granularity: { type: 'string', enum: ['daily', 'monthly'] },
      from: { type: 'string', description: 'YYYY-MM-DD (daily only, default 30 days back)' },
      to:   { type: 'string', description: 'YYYY-MM-DD (daily only)' } }, ['usernames']),
  tool('alerts',
    'Current warnings: big win / big loss / big withdrawal / deposit spike / deposit drop (money alerts), early-warning list with reasons and suggested action, and tier downgrade risk.'),
  tool('daily_brief', 'The CRM daily brief: today\'s headline numbers, who needs attention, tasks.'),
  tool('campaigns',
    'List campaigns with type, status, dates, platform, target tiers, budget and enrolled player count.',
    { status: { type: 'string', enum: ['draft', 'active', 'ended'] },
      search: { type: 'string', description: 'part of the campaign name' } }),
  tool('campaign_detail',
    'One campaign: settings, impact versus a comparison group (extra deposit caused by the campaign, cost, ROI), and top players by deposit.',
    { campaign_id: { type: 'string' }, name: { type: 'string', description: 'part of the campaign name' } }),
  tool('team_kpi',
    'VIP manager KPI for a month: contacts, coverage, reply rate, retention, recall rate by layer, ARPU per currency, daily task completion, sentiment score.',
    { month: { type: 'string', description: 'YYYY-MM (default: this month)' } }),
  tool('contacts_tasks',
    'Recent contact logs (channel, outcome, reply, mood, follow-up) and tasks (open / done / missed).',
    { username: { type: 'string' }, host: { type: 'string' },
      days: { type: 'integer', description: 'look back N days, default 7, max 90' } }),
  tool('money_and_games',
    'For a month: bonus paid by category, top bonus receivers, department expenses (gifts, vouchers), and game provider performance (per currency). Optionally for one player.',
    { month: { type: 'string', description: 'YYYY-MM (default: this month)' }, username: { type: 'string' } }),
  tool('rules', 'Current CRM thresholds (crm_rules: inactivity days, task cap, etc.) and tier upgrade thresholds.'),
  tool('birthdays', 'Players with a birthday coming up, with gift status.',
    { days_ahead: { type: 'integer', description: 'default 14' } }),
  tool('ask_sql',
    'Safety net: run ONE read-only SQL SELECT on the CRM database when no other tool can answer (unusual breakdowns, cross-table questions, history). Use the other tools first.\n' + SQL_GUIDE,
    { sql: { type: 'string', description: 'a single SELECT or WITH … SELECT, no semicolon' },
      purpose: { type: 'string', description: 'one line: what this query answers' } }, ['sql']),
  tool('tier_changes', 'Recent tier upgrades and downgrades.',
    { since: { type: 'string', description: 'YYYY-MM-DD, default 60 days back' } }),

  // Proposals: shown to the user as a confirm card; nothing changes until they click Confirm
  // (the page then calls the DB function ai_apply_action, which re-checks everything and logs it)
  tool('propose_tasks',
    'PROPOSE tasks / follow-up dates (max 50). Shown as a confirm card — not done until the user clicks Confirm. A follow-up date = task_type "Follow Up" due that date.',
    { tasks: { type: 'array', items: { type: 'object', properties: {
        username:    { type: 'string' },
        task_type:   { type: 'string', enum: TASK_TYPES },
        due_date:    { type: 'string', description: 'YYYY-MM-DD, today to 90 days ahead' },
        priority:    { type: 'string', enum: ['Urgent', 'High', 'Medium', 'Low'] },
        assigned_to: { type: 'string', description: 'manager name; leave empty = the player\'s own manager' },
        title:       { type: 'string' },
        notes:       { type: 'string', description: 'what to say / do, 1–2 lines' },
      }, required: ['username'] } } }, ['tasks']),
  tool('propose_campaign_draft',
    'PROPOSE a COMPLETE campaign as a DRAFT, with every setting its kind needs, so it can launch without editing. Shown as a confirm card with the settings, the audience and an estimated cost from recent history. Never launched by you. If it returns problems, fix them and propose again.\n\n' + GOAL_TO_KIND + '\n\nHow each kind works (same guide as the Campaigns page):\n' + kindGuideText(),
    { kind: { type: 'string', enum: ['challenge_daily', 'challenge_trust', 'challenge_rebate', 'dual_tier', 'tiered_deposit_reward', 'tiered_reward', 'pct_reward', 'fixed_reward', 'gold_bar', 'leaderboard'] },
      campaign_name: { type: 'string' },
      platform:      { type: 'string', enum: ['MY', 'SG'], description: 'one currency per campaign' },
      start_date:    { type: 'string', description: 'YYYY-MM-DD, today or later' },
      end_date:      { type: 'string', description: 'YYYY-MM-DD' },
      target_tiers:  { type: 'array', items: { type: 'string', enum: ['BLACK', 'DIAMOND-P', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER'] } },
      audience:      { type: 'string', enum: ['all_in_tiers', 'list'], description: 'all_in_tiers = every player of target_tiers on this platform; list = only usernames' },
      usernames:     { type: 'array', items: { type: 'string' }, description: 'for audience "list" (max 200)' },
      budget_rm:     { type: 'number' },
      offer_desc:    { type: 'string', description: 'the offer in plain words, as players will read it' },
      notes:         { type: 'string', description: 'why this campaign: the data behind it' },
      reward_delivery: { type: 'string', enum: ['credit', 'wcash'] },
      turnover_multiplier: { type: 'number', description: 'turnover requirement on the reward (e.g. 3 = ×3)' },
      wa_templates: { type: 'object', description: 'WhatsApp message for EVERY stage in en, my (Malay) and zh. Normal kinds: stages intro (new / not active yet), near (some play, not at target — use {gap} and {next_reward}), won (reached, reward being processed — {reward}), paid (angpow credited — {reward}, {turnover}), streak (1 day to streak bonus — {streak}, {streak_pct}), ended (thank you, more campaigns soon). Placeholders for normal kinds: {username} {agent} {campaign} {start} {end} {days_left} {cur} {gap} {next_reward} {reward} {turnover} {tier_list} {streak} {streak_n} {streak_pct}. challenge_daily stages: intro, won, streak, near, idle, care, ended with placeholders {cur} {username} {agent} {campaign} {start} {end} {asof} {days_left} {y_turnover} {y_reward} {next_target} {next_reward} {missed_by} {miss_reward} {first_target} {streak} {streak_n} {streak_pct} {streak_est} {winners} {top_reward} {tier_list} {total_reward} {final_line} {total_line}. challenge_trust / challenge_rebate: leave out (built-in progress message). Tone: casual Malaysian "bro" peer tone, every message starts with the agent intro ("I\'m {agent} from sureWin VIP department" / "Saya {agent} dari jabatan VIP sureWin" / "我是sureWin VIP部门的 {agent}"), brand "sureWin". Never invent other placeholders.',
        properties: Object.fromEntries(['intro', 'near', 'won', 'paid', 'streak', 'ended', 'idle', 'care'].map(st => [st, { type: 'object', properties: { en: { type: 'string' }, my: { type: 'string' }, zh: { type: 'string' } } }])) },
      deposit_target: { type: 'number', description: 'gold_bar / pct_reward / fixed_reward' },
      gold_bar_value: { type: 'number', description: 'gold_bar: value of the gift' },
      reward_pct:    { type: 'number', description: 'pct_reward' },
      reward_cap:    { type: 'number', description: 'pct_reward: max per player' },
      reward_fixed:  { type: 'number', description: 'fixed_reward' },
      levels:        { type: 'array', description: 'tiered_deposit_reward: reward ≤ 5% of its deposit', items: { type: 'object', properties: { deposit_threshold: { type: 'number' }, reward_amount: { type: 'number' }, level_name: { type: 'string' } } } },
      payout_mode:   { type: 'string', enum: ['all', 'highest_only'], description: 'tiered_deposit_reward: pay every level reached or only the highest' },
      tiers:         { type: 'array', description: 'tiered_reward: % of the whole-period deposit by band', items: { type: 'object', properties: { min: { type: 'number' }, pct: { type: 'number' } } } },
      dual_tiers:    { type: 'array', description: 'dual_tier: highest tier where BOTH thresholds are met', items: { type: 'object', properties: { deposit: { type: 'number' }, turnover: { type: 'number' }, credit: { type: 'number' }, wcash: { type: 'number' } } } },
      settlement:    { type: 'string', enum: ['total', 'daily'], description: 'dual_tier: whole period or each day on its own' },
      streak:        { type: 'object', description: 'dual_tier streak bonus', properties: { enabled: { type: 'boolean' }, days: { type: 'integer' }, type: { type: 'string', enum: ['pct', 'fixed'] }, pct: { type: 'number' }, fixed: { type: 'number' }, cap: { type: 'number' } } },
      metric:        { type: 'string', enum: ['turnover', 'deposit', 'turnover_deposit'], description: 'leaderboard ranking' },
      top_n:         { type: 'integer', description: 'leaderboard' },
      rank_rewards:  { type: 'array', description: 'leaderboard: one prize per rank 1..top_n', items: { type: 'object', properties: { rank: { type: 'integer' }, amount: { type: 'number' } } } },
      min_valid_bet: { type: 'number', description: 'leaderboard: minimum valid bet to qualify' },
      min_deposit:   { type: 'number', description: 'leaderboard: minimum deposit to qualify' },
      daily_tiers:   { type: 'array', description: "challenge_daily: the day's turnover → fixed reward", items: { type: 'object', properties: { turnover: { type: 'number' }, reward: { type: 'number' } } } },
      streak_enabled: { type: 'boolean', description: 'challenge_daily' }, streak_days: { type: 'integer', description: 'challenge_daily' },
      streak_style:  { type: 'string', enum: ['rolling', 'block'], description: 'challenge_daily' },
      streak_pct:    { type: 'number', description: 'challenge_daily: % of deposits on the streak days' }, streak_cap: { type: 'number', description: 'challenge_daily' },
      challenge:     { type: 'object', description: 'challenge_trust / challenge_rebate settings (leave out to use the standard ones)', properties: {
        credit_enabled: { type: 'boolean' }, credit_default: { type: 'number' }, credit_cap: { type: 'number' }, credit_suggest_pct_of_loss: { type: 'number' },
        goal_metric: { type: 'string', enum: ['turnover', 'deposit', 'both'] }, target_turnover_default: { type: 'number' }, target_deposit_default: { type: 'number' },
        target_suggest_multiplier: { type: 'number' }, completion_type: { type: 'string', enum: ['review', 'rebate_pct', 'fixed', 'none'] },
        completion_pct: { type: 'number' }, completion_fixed: { type: 'number' }, completion_cap: { type: 'number' },
        streak_enabled: { type: 'boolean' }, streak_min_days: { type: 'integer' }, streak_min_daily_deposit: { type: 'number' },
        streak_bonus_type: { type: 'string', enum: ['fixed', 'pct'] }, streak_bonus_fixed: { type: 'number' }, streak_bonus_pct: { type: 'number' }, streak_bonus_cap: { type: 'number' } } } },
    ['kind', 'campaign_name', 'platform', 'start_date', 'end_date', 'audience']),
  tool('propose_add_players',
    'PROPOSE adding players (max 200) to an existing draft / upcoming / active campaign. Shown as a confirm card.',
    { campaign_id: { type: 'string' }, name: { type: 'string', description: 'part of the campaign name' },
      usernames: { type: 'array', items: { type: 'string' } } }, ['usernames']),
]

const enc = s => encodeURIComponent(String(s ?? '').trim())
const safe = p => p.catch(e => ({ error: e.message }))

// Drop filter values the database doesn't know (e.g. a made-up status), so they don't silently match nothing
function cleanFilters(a) {
  const out = { ...a }
  for (const [k, def] of Object.entries(FILTER_PROPS)) {
    const allowed = def.items?.enum
    if (allowed && Array.isArray(out[k])) {
      out[k] = out[k].filter(v => allowed.includes(v))
      if (!out[k].length) delete out[k]
    }
  }
  return out
}

// v_vip_recent_stats rows by username (for challenge targets), in chunks like allPlayers.js
async function recentStats(db, usernames) {
  const out = {}
  for (let i = 0; i < usernames.length; i += 150) {
    const list = usernames.slice(i, i + 150).map(u => `"${String(u).replace(/"/g, '')}"`).join(',')
    const rows = await db.rows(`v_vip_recent_stats?select=username,data_as_of,dep_30d,loss_30d,avg_daily_turnover_30d,max_deps_one_day_14d,dep_7d,dep_prev_28d&username=in.(${encodeURIComponent(list)})`)
    for (const r of rows || []) out[r.username] = r
  }
  return out
}

// Known players among `usernames` → { found: [{username, tier, currency, host}], unknown: [...] }
async function checkPlayers(db, usernames, max) {
  const list = [...new Set((usernames || []).map(u => String(u).trim()).filter(Boolean))].slice(0, max)
  if (!list.length) return { found: [], unknown: [] }
  const r = await db.rpc('ai_players', { p: { usernames: list, limit: max } })
  const found = (r?.rows || []).map(x => ({ username: x.username, tier: x.tier, currency: x.currency, host: x.host || '' }))
  const seen = new Set(found.map(x => x.username))
  return { found, unknown: list.filter(u => !seen.has(u)) }
}

async function runTool(name, a, db, ctx = {}) {
  if (name === 'find_players' || name === 'summarize_players') a = cleanFilters(a)
  switch (name) {
    case 'find_players':
      return db.rpc('ai_players', { p: { ...a, mode: 'list' } })

    case 'summarize_players':
      return db.rpc('ai_players', { p: { ...a, mode: 'summary' } })

    case 'player_detail': {
      const u = String(a.username || '').trim()
      const stats = await db.rpc('ai_players', { p: { usernames: [u] } })
      if (!stats?.rows?.length) {
        const like = await db.rpc('ai_players', { p: { search: u, limit: 8, sort: 'dep_90d' } })
        return { error: `No player "${u}"`, did_you_mean: (like?.rows || []).map(r => `${r.username} (${r.tier})`) }
      }
      const [auto, manual, nextStep, timeline, campaigns, tiers] = await Promise.all([
        safe(db.rpc('get_vip_profile_auto', { p_username: u })),
        safe(db.rows(`vip_profiles?select=preferred_games,deposit_pattern,deposit_trigger,preferred_contact_time,preferred_contact_channel,interests,personality_tags,host_notes,relationship_level,family_tags,family_notes&username=eq.${enc(u)}`)),
        safe(db.rows(`v_vip_next_step?select=stage_label,next_action,attempts_since_reply,last_outcome,last_contact_date&username=eq.${enc(u)}`)),
        safe(db.rpc('get_vip_timeline', { p_username: u, p_limit: 10 })),
        safe(db.rows(`campaign_players?select=status,total_deposit,reward_amount,payout_status,enrolled_at,campaigns(campaign_name,status,start_date,end_date)&username=eq.${enc(u)}&order=enrolled_at.desc&limit=10`)),
        safe(db.rows(`tier_change_logs?select=old_tier,new_tier,changed_at&username=eq.${enc(u)}&order=changed_at.desc&limit=5`)),
      ])
      return { player: stats.rows[0], period: [stats.period_from, stats.period_to], auto_profile: auto, manual_profile: manual?.[0] || manual,
               next_step: nextStep?.[0] || nextStep, last_10_interactions: timeline, campaigns, tier_changes: tiers }
    }

    case 'player_history': {
      const users = (a.usernames || []).slice(0, 10)
      if (a.granularity === 'monthly') {
        return db.rows(`vip_monthly_totals?select=username,snapshot_month,currency,tier,total_deposit,total_withdrawal,monthly_valid_bet,win_loss,bonus_amount,days_with_data` +
          `&username=in.(${users.map(u => `"${String(u).replace(/"/g, '')}"`).join(',')})&order=snapshot_month.desc&limit=120`)
      }
      const to = a.to || null
      const from = a.from || daysBefore(to || todayMYT(), 30)
      return db.rpc('get_players_daily', { p_usernames: users, p_from: from, p_to: to || todayMYT() })
    }

    case 'alerts': {
      const cfg = await safe(db.rows('app_settings?select=value&key=eq.big_winloss_thresholds')).then(r => r?.[0]?.value || {})
      const [money, early, downgrade] = await Promise.all([
        safe(db.rpc('get_money_alerts', { p_settings: cfg })),
        safe(db.rows('v_vip_early_warning?select=username,tier,host_assigned,status,days_since_deposit,days_since_contact,dep_this_week,dep_prev_week,warning_score,reasons,suggested_action&order=warning_score.desc&limit=25')),
        safe(db.rows('v_tier_downgrade_risk?select=username,tier,quarterly_vb,maintenance_threshold,vb_gap,downgrade_to,period_start,period_end&order=quarterly_vb.desc&limit=15')),
      ])
      return { money_alerts: money, early_warning_top25: early, downgrade_risk_top15_by_value: downgrade }
    }

    case 'daily_brief':
      return db.rpc('get_daily_brief', { p_top: 10 })

    case 'campaigns': {
      const base = 'campaigns?select=id,campaign_name,campaign_type,status,platform,start_date,end_date,target_tier,budget_rm,offer_desc&order=start_date.desc.nullslast&limit=40' +
        (a.search ? `&campaign_name=ilike.*${enc(a.search)}*` : '')
      const [first, players] = await Promise.all([
        db.rows(base + (a.status ? `&status=eq.${enc(a.status)}` : '')),
        safe(db.rows('campaign_players?select=campaign_id&limit=5000')),
      ])
      // A wrong status guess (e.g. "ended" for a running campaign) must not hide the campaign
      let list = first, note
      if (!list.length && a.status) {
        list = await db.rows(base)
        if (list.length) note = `Nothing with status "${a.status}" — showing all statuses instead.`
      }
      const count = {}
      for (const p of Array.isArray(players) ? players : []) count[p.campaign_id] = (count[p.campaign_id] || 0) + 1
      const rows = list.map(c => ({ ...c, offer_desc: (c.offer_desc || '').slice(0, 160), players: count[c.id] || 0 }))
      return note ? { note, campaigns: rows } : rows
    }

    case 'campaign_detail': {
      let c
      if (a.campaign_id) c = (await db.rows(`campaigns?select=*&id=eq.${enc(a.campaign_id)}`))[0]
      if (!c && a.name) c = (await db.rows(`campaigns?select=*&campaign_name=ilike.*${enc(a.name)}*&order=start_date.desc.nullslast&limit=1`))[0]
      if (!c) return { error: 'Campaign not found — call campaigns first to get the id' }
      const keep = ['id', 'campaign_name', 'campaign_type', 'campaign_category', 'status', 'platform', 'start_date', 'end_date', 'target_tier', 'budget_rm',
        'offer_desc', 'deposit_target', 'reward_pct', 'reward_fixed', 'reward_cap', 'reward_tiers', 'min_valid_bet', 'top_n', 'rank_rewards', 'enrollment_mode',
        'leaderboard_metric', 'streak_enabled', 'streak_days', 'impact_cost', 'notes']
      const settings = Object.fromEntries(keep.filter(k => c[k] != null && c[k] !== '').map(k => [k, c[k]]))
      const [impact, players] = await Promise.all([
        safe(db.rpc('campaign_impact', { p_campaign_id: c.id })),
        safe(db.rows(`campaign_players?select=username,tier,status,total_deposit,valid_bet,reward_amount,payout_status&campaign_id=eq.${c.id}&order=total_deposit.desc.nullslast&limit=500`)),
      ])
      const list = Array.isArray(players) ? players : []
      return { settings, impact: impactSummary(impact, c), players_enrolled: list.length,
               players_with_deposit: list.filter(p => (p.total_deposit || 0) > 0).length, top_players: list.slice(0, 15) }
    }

    case 'team_kpi': {
      const m = a.month || todayMYT().slice(0, 7)
      const [kpi, sentiment, recall] = await Promise.all([
        safe(db.rpc('get_manager_kpi', { p_month: m })),
        safe(db.rpc('get_sentiment_kpi', { p_month: m })),
        safe(db.rows(`v_recall_summary_monthly?select=host_name,recall_layer,contacts,players_contacted,players_recalled,recall_rate_pct,recall_deposit_total&month=eq.${enc(m)}`)),
      ])
      return { month: m, manager_kpi: kpi, sentiment, recall_by_layer: recall }
    }

    case 'contacts_tasks': {
      const days = Math.min(Math.max(a.days || 7, 1), 90)
      const since = daysBefore(todayMYT(), days)
      let c = `contact_logs?select=logged_at,username,tier,channel,direction,outcome,message_summary,vip_response,host_name,emotion_tag,follow_up_date,topic&logged_at=gte.${since}&order=logged_at.desc&limit=60`
      let t = `tasks?select=title,task_type,vip_username,assigned_to,due_date,status,priority,source,notes&due_date=gte.${since}&order=due_date.desc&limit=60`
      if (a.username) { c += `&username=eq.${enc(a.username)}`; t += `&vip_username=eq.${enc(a.username)}` }
      if (a.host) { c += `&host_name=ilike.*${enc(a.host)}*`; t += `&assigned_to=ilike.*${enc(a.host)}*` }
      const [contacts, tasks] = await Promise.all([safe(db.rows(c)), safe(db.rows(t))])
      const cl = Array.isArray(contacts) ? contacts : []
      const tl = Array.isArray(tasks) ? tasks : []
      const tally = (arr, k) => arr.reduce((o, r) => ((o[r[k] || '?'] = (o[r[k] || '?'] || 0) + 1), o), {})
      return {
        since, contacts_shown: cl.length, contacts_by_outcome: tally(cl, 'outcome'),
        contacts: cl.map(r => ({ ...r, message_summary: (r.message_summary || '').slice(0, 120), vip_response: (r.vip_response || '').slice(0, 120) })),
        tasks_by_status: tally(tl, 'status'), tasks: tl.map(r => ({ ...r, notes: (r.notes || '').slice(0, 100) })),
      }
    }

    case 'money_and_games':
      return db.rpc('ai_money_games', { p: { month: a.month || null, username: a.username || null } })

    case 'rules': {
      const [rules, upgrades] = await Promise.all([
        db.rows('crm_rules?select=rule_key,value,unit,description&order=category'),
        safe(db.rows('upgrade_thresholds?select=from_tier,to_tier,metric,threshold&is_active=eq.true')),
      ])
      return { crm_rules: rules, upgrade_thresholds: upgrades }
    }

    case 'birthdays':
      return db.rpc('get_upcoming_birthdays', { days_ahead: Math.min(a.days_ahead || 14, 60) })

    case 'tier_changes':
      return db.rows(`tier_change_logs?select=username,old_tier,new_tier,changed_at&changed_at=gte.${a.since || daysBefore(todayMYT(), 60)}&order=changed_at.desc&limit=100`)

    case 'ask_sql':
      return db.rpc('ai_readonly_query', { p_sql: String(a.sql || '') })

    case 'propose_tasks': {
      const rows = (a.tasks || []).slice(0, 50)
      const { found, unknown } = await checkPlayers(db, rows.map(t => t.username), 50)
      const byName = Object.fromEntries(found.map(f => [f.username, f]))
      const tasks = rows.filter(t => byName[String(t.username).trim()]).map(t => {
        const pl = byName[String(t.username).trim()]
        return { username: pl.username, tier: pl.tier, task_type: TASK_TYPES.includes(t.task_type) ? t.task_type : 'Follow Up',
                 due_date: t.due_date || todayMYT(), priority: t.priority || 'Medium', assigned_to: t.assigned_to || pl.host || '',
                 title: t.title || '', notes: t.notes || '' }
      })
      if (!tasks.length) return { error: 'None of these players exist', unknown }
      ctx.actions?.push({ id: `a${ctx.actions.length + 1}`, kind: 'create_tasks', payload: { tasks } })
      return { proposal_shown: true, tasks: tasks.length, unknown_players: unknown, note: 'Shown to the user as a confirm card. Not created yet.' }
    }

    case 'propose_campaign_draft': {
      const draft = buildCampaignDraft(a, todayMYT())
      if (draft.errors?.length) return { error: 'Not proposed yet — fix these and call propose_campaign_draft again', problems: draft.errors }
      const cur = draft.summary.currency
      const days = Math.min(draft.days, 31)
      let history, unknown = []
      if (draft.allInTiers) {
        if (draft.tiers.includes('BRONZE')) return { error: 'Too many Bronze players for "all_in_tiers" — use Silver and above, or a list' }
        history = await db.rpc('ai_campaign_history', { p: { tiers: draft.tiers, currencies: [cur], days } })
      } else {
        const chk = await checkPlayers(db, a.usernames, 200)
        unknown = chk.unknown
        const other = chk.found.filter(f => f.currency !== cur).map(f => f.username)
        if (other.length) draft.warnings.push(`Left out (not ${cur}): ${other.join(', ')}`)
        const keep = chk.found.filter(f => f.currency === cur).map(f => f.username)
        if (!keep.length) return { error: `None of these players are ${cur} players`, unknown }
        history = await db.rpc('ai_campaign_history', { p: { usernames: keep, days } })
      }
      const usernames = (history?.players || []).map(x => x.u)
      if (!usernames.length) return { error: 'No players match this audience' }
      let players = []
      if (draft.campaign.campaign_type === 'challenge') {
        if (usernames.length > 1000) return { error: `${usernames.length} players — a challenge can take max 1000; narrow the tiers` }
        const stats = draft.cfg.mode === 'daily_milestone' ? {} : await recentStats(db, usernames)
        players = usernames.map(u => challengePlayer(u, stats[u], draft.cfg, draft.days))
      } else if (!draft.allInTiers) players = usernames.map(u => ({ username: u }))
      const estimate = estimateCost(draft, history, players)
      const display = { ...draft.summary, warnings: draft.warnings, estimate, unknown, player_count: usernames.length, sample: usernames.slice(0, 20),
        audience: draft.allInTiers ? 'all_in_tiers' : 'list', tiers: draft.tiers, name: draft.campaign.campaign_name,
        start_date: draft.campaign.start_date, end_date: draft.campaign.end_date, offer: draft.campaign.offer_desc, budget: draft.campaign.budget_rm,
        reward_delivery: draft.campaign.reward_delivery, turnover_multiplier: draft.campaign.turnover_multiplier, why: a.notes || '' }
      ctx.actions?.push({ id: `a${ctx.actions.length + 1}`, kind: 'create_campaign_draft', payload: { campaign: draft.campaign, levels: draft.levels, players, display } })
      return { proposal_shown: true, players: usernames.length, unknown_players: unknown, estimate, warnings: draft.warnings,
               note: 'Shown to the user as a confirm card with all settings. Not created yet; it will be a draft. Mention the estimated cost and that it is based on the last ' + days + ' days.' }
    }

    case 'propose_add_players': {
      let c
      if (a.campaign_id) c = (await db.rows(`campaigns?select=id,campaign_name,status,platform&id=eq.${enc(a.campaign_id)}`))[0]
      if (!c && a.name) c = (await db.rows(`campaigns?select=id,campaign_name,status,platform&campaign_name=ilike.*${enc(a.name)}*&order=start_date.desc.nullslast&limit=1`))[0]
      if (!c) return { error: 'Campaign not found — call campaigns first' }
      if (!['draft', 'upcoming', 'active'].includes(String(c.status).toLowerCase())) return { error: `Campaign is ${c.status}; players can only be added to draft, upcoming or active campaigns` }
      const { found, unknown } = await checkPlayers(db, a.usernames, 200)
      if (!found.length) return { error: 'None of these players exist', unknown }
      ctx.actions?.push({ id: `a${ctx.actions.length + 1}`, kind: 'add_players_to_campaign',
        payload: { campaign_id: c.id, campaign_name: c.campaign_name, usernames: found.map(f => f.username) } })
      return { proposal_shown: true, campaign: c.campaign_name, players: found.length, unknown_players: unknown, note: 'Shown to the user as a confirm card. Not added yet.' }
    }

    default:
      return { error: `Unknown tool ${name}` }
  }
}

// Same "did it work?" numbers as the Campaigns page (campaignImpactCore.js), per currency
function impactSummary(data, campaign) {
  if (!data || data.error) return data
  const r0 = n => (n == null || !Number.isFinite(n) ? null : Math.round(n))
  const r1 = n => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10)
  const eff = e => e && Object.fromEntries(Object.entries(e).map(([k, v]) => [k, {
    campaign_players_change_pct: r1(v.tPct), comparison_group_change_pct: r1(v.cPct),
    extra_vs_expected: r0(v.incremental), lift_pct: r1(v.liftPct) }]))
  const mover = g => ({ username: g.u, turnover_per_day_before: r0(g.b), turnover_per_day_during: r0(g.a) })
  const curs = [...new Set((data.players || []).filter(x => x.t).map(x => x.cur))]
  return {
    method: 'Campaign players vs a comparison group (same currency + tier, not in a campaign). Metrics: vb = turnover, dep = deposit, wd = withdrawal, ggr = house win, act = active players.',
    start: data.start, end: data.end, data_up_to: data.data_max,
    by_currency: curs.map(cur => {
      const raw = campaign.impact_cost?.byCur?.[cur]
      const cost = raw == null || raw === '' ? NaN : Number(raw)
      const s = summarizeImpact(data, cur, Number.isFinite(cost) ? cost : null)
      return {
        currency: cur, campaign_players: s.nT, comparison_players: s.nC, days: s.days,
        during: eff(s.during), after: eff(s.after),
        reward_cost: s.cost, extra_ggr: r0(s.incGGR), net_after_cost: r0(s.net), roi_pct: r1(s.roi),
        verdict: VERDICT[s.verdict]?.en || s.verdict, after_campaign: s.lasting ? LASTING[s.lasting]?.en : null,
        small_comparison_group: s.smallControl, still_running: s.running,
        top_gainers: (s.splitDuring?.gainers || []).slice(0, 5).map(mover),
        top_losers: (s.splitDuring?.losers || []).slice(0, 5).map(mover),
      }
    }),
  }
}

// ─── Agent loop: the model calls tools until it can answer ───────────────────

async function runAgent(messages, db, env) {
  const steps = []
  const ctx = { actions: [] }
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS - 1
    // Round 1 must look something up, so numbers never come from the model's memory
    const msg = await callOpenAI(messages, env, round === 0 ? 'required' : lastRound ? 'none' : 'auto')
    if (!msg.tool_calls?.length) {
      return { answer: (msg.content || '').trim() || 'No answer generated.', steps, actions: ctx.actions }
    }
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls })
    const results = await Promise.all(msg.tool_calls.map(async tc => {
      let args = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* keep {} */ }
      steps.push({ tool: tc.function.name, args })
      let out
      try { out = await runTool(tc.function.name, args, db, ctx) }
      catch (e) { out = { error: e.message } }
      return { role: 'tool', tool_call_id: tc.id, content: clip(JSON.stringify(maskDeep(out) ?? null)) }
    }))
    messages.push(...results)
  }
  return { answer: 'Sorry — this question needed too many lookups. Please ask something more specific.', steps, actions: ctx.actions }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt({ language, profile, dataDate }) {
  const lang = language === 'zh' ? 'Simplified Chinese (keep usernames, tiers and currency codes as they are)' : 'English'
  const name = profile.full_name || 'unknown'
  return `You are the data analyst and VIP-retention advisor inside sureWin's VIP CRM (Kuala Lumpur VIP department).
Reply in ${lang}.
Today (Malaysia time): ${todayMYT()}. Latest imported daily data: ${dataDate || 'unknown'} — money figures are up to that date.
The person asking: ${name} (role: ${profile.role || 'staff'}). Their own players = host_assigned "${name.split(/\s+/)[0]}" (match by first name).
SCOPE: filter to the asker's own players ONLY when they say "my / mine / 我的 / 我负责的", or ask what THEY personally should do today ("我应该…", "should I…"). Otherwise use ALL players / the whole team. Always say the scope in the first line (e.g. "全部 VIP" or "你负责的 VIP").
- Never drop rows from a tool result on your own (e.g. keeping only one manager's players). Show the rows you got, and when it is a subset say the total, e.g. "共 48 位，显示存款最高的 20 位" (use total_matched).

HOW TO WORK
- You have tools that read the live CRM database. ALWAYS look the data up with tools — never guess or invent numbers, names or dates.
- You can call several tools at once and do several rounds (e.g. find players, then open player_detail for the top ones).
- If something is not in the data, say so plainly and say what would be needed.
- You can see every player: Bronze and Silver (potential VIPs) and Gold, Platinum, Diamond, Diamond-P, Black (VIPs). "VIP" alone means Gold and above.
- ACTIONS: you can PROPOSE (1) tasks / follow-up dates (propose_tasks), (2) a DRAFT campaign, optionally with players (propose_campaign_draft), (3) adding players to an existing campaign (propose_add_players). Each proposal appears under your answer as a card with Confirm / Cancel — NOTHING changes until the user clicks Confirm. Propose only when the user asks you to do it or agrees to your suggestion; in analysis answers you may end with an offer such as "要我帮你建这些任务吗？". After proposing, say briefly what the card contains and ask them to check it and click Confirm. Never write that it is done / created / added ("已建立", "已加入", "已为…生成") — write "已准备好，按确认后才会建立". Write card notes in the same language as your answer. For tiered rewards put the tiers in offer_desc and say the tiers still need to be set on the Campaigns page. Campaign drafts are never launched by you; one currency per campaign (MY or SG). For campaigns pick the kind by the goal (see propose_campaign_draft) and fill EVERY setting of that kind (tiers / levels / prizes / streak / caps) — never leave the rules only in offer_desc. Always write wa_templates for every stage in all 3 languages (en, my, zh). If the user's idea does not fit any kind exactly, say so, choose the closest kind and explain the difference. Everything else (sending WhatsApp, changing hosts, launching campaigns, payouts) the user does on the CRM pages: say what to do and on which page. Use ONLY these page names (sidebar): Executive Overview, Today, My Tasks, Alerts, Daily Targets, All VIPs, Player Segments, Active Risk, Active Tracker, Follow Up, Birthdays, Upgrades, Transfers, Churn Analysis, Daily Work Queue, Churn Urgency, Contact Log, Weekly Outcome, Campaigns, Budget, Analytics, Player Insights, Reports, KPI, Manager KPI Board, Expenses, Mgmt View, and VIP360 (click a player name). Do not describe buttons or menus inside a page unless you are sure they exist — just name the page.

BUSINESS RULES (must follow)
- MYR (Malaysia) and SGD (Singapore) are different platforms; KHUSD is Cambodia. NEVER add different currencies together. Always show the currency with every amount, e.g. "MYR 12,500".
- win_loss / wl is from the PLAYER's side: negative = player lost (company won), positive = player won.
- A real deposit day = deposit > 0 AND valid bet > 0 that day. Deposits on days with no bets are not counted.
- Status (same on every page): Active = deposited within 3 days; Resting = no recent deposit but bet within 2 days; At Risk = 3+ days without deposit; Churn = 7+ days; Dormant = 15+ days. churn_risk: LOW = Active/Resting, MEDIUM = At Risk, HIGH = Churn/Dormant.
- Value band = 90-day deposit band V1 Minimal … V5 Top (Gold+ only).
- Upgrades are by valid bet in the calendar month (same numbers for SGD): Bronze→Silver 100,000; Silver→Gold 500,000; Bronze→Gold 600,000; Gold→Platinum 2,000,000; Platinum→Diamond 6,000,000; Gold straight to Diamond 8,000,000. Deposit is NOT an upgrade rule. For upgrade questions use find_players (upgrade_ready, or sort gap_to_next ascending) and report month_vb, next_tier, gap_to_next and qualifies_for exactly as given — do NOT compare or subtract numbers yourself. Only players with qualifies_for set have reached a higher tier.
- Never invent a threshold or rule. If a number is not listed here, get it with the rules tool or say it is not set.
- Unreachable = 3 "Contacted" logs in a row with no reply.
- Big-loss gift: tracked net loss ≥ 100,000; around 1,000,000 loss deserves a premium gift (e.g. latest iPhone Pro Max).
- Default money period = last 30 days up to the latest data date, unless the user asks for another period.
- Player-facing WhatsApp text: write it in casual English (Malaysian "bro" peer tone, same level as the player, never "boss/老板") even when you answer in Chinese, unless asked for another language; open with "I'm {agent} from sureWin VIP department", brand written "sureWin".
- Privacy: never show full phone, IC or bank numbers (they are masked as ****1234 — keep them masked).

ANSWER FORMAT
- Start with the direct answer in 1–2 lines, then the details.
- Use markdown tables for lists of players or numbers (| col | col |). Keep tables ≤ 20 rows unless asked.
- Wrap EVERY player username in **double asterisks** (e.g. **qqq163**) so it becomes clickable.
- Numbers with thousands separators; dates as YYYY-MM-DD.
- For analysis or "what should we do" questions, finish with "### Analysis & next steps": the key finding, who needs attention and why, and concrete actions (who contacts whom, by when, which channel, which offer). Base campaign suggestions on real results (campaign_detail impact, player behaviour, game preference, value band). Skip this section for simple lookups.
- Mention the data date when it matters (e.g. "as of ${dataDate || 'latest data'}").

${CRM_SYSTEM_KNOWLEDGE}`.trim()
}

// ─── OpenAI call ─────────────────────────────────────────────────────────────

async function callOpenAI(messages, env, toolChoice) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: messages.map(m => (typeof m.content === 'string' ? { ...m, content: wellFormed(m.content) } : m)),
      tools: TOOLS,
      tool_choice: toolChoice,
      max_tokens: MAX_TOKENS,
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error?.message || `OpenAI error ${res.status}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message || {}
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// Hide phone / bank numbers pasted into notes: 7+ digits -> ****last4
function maskDigits(t) { return String(t || '').replace(/\d{7,}/g, m => '****' + m.slice(-4)) }
const HIDDEN_KEYS = new Set(['phone', 'whatsapp', 'email', 'address', 'tng_verified_name'])
function maskDeep(v) {
  if (typeof v === 'string') return maskDigits(v)
  if (Array.isArray(v)) return v.map(maskDeep)
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) if (!HIDDEN_KEYS.has(k) && x !== null && x !== '') o[k] = maskDeep(x)
    return o
  }
  return v
}
function clip(s) {
  return s.length > MAX_TOOL_CHARS ? s.slice(0, MAX_TOOL_CHARS) + ' …(cut off — narrow the filter or use a smaller limit)' : s
}
// .slice() can cut an emoji in half; OpenAI rejects the leftover half as invalid JSON
function wellFormed(t) { return String(t ?? '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '') }
function todayMYT() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) }
function daysBefore(ymd, days) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10) }

function ok(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
}
function err(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } })
}
