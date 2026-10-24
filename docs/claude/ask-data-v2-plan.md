# Ask Data v2 — plan (2026-10-24)

Plan only, nothing built yet.

## Why the current Ask Data falls short
- It stuffs one fixed snapshot into the prompt: max 500 Gold+ VIPs, latest daily row, 30 days of contacts, 30 campaigns, 800 monthly rows, 500 tier changes.
- It can't see Silver/Bronze, segments, money alerts, profiles/timeline, KPI, recall, campaign impact, provider/game data, bonuses, expenses, tasks, birthdays.
- Old column names left some data silently empty (contact logs fixed 2026-10-24).
- It runs with the service key, so it ignores who is asking.
- Model gpt-4o-mini: OK for lookups, weak at analysis.

## Marcus's decisions (2026-10-24)
- Actions: **create tasks / follow-up dates**, and **campaigns: create a draft + add players**. Not: WA drafts, host assignment.
- Model: **strong model** (e.g. gpt-4.1).
- Who can trigger actions: **everyone** (read-only accounts too). Actions run on the server with a fixed whitelist, every action needs a confirm click and is written to an audit log with who asked.

## New design: AI with tools (it looks things up itself)
Instead of pasting data into the prompt, the AI gets a set of tools and calls them as needed, several rounds per question (max ~8 calls).

### Read tools (all players, Silver/Bronze included)
| Tool | Source |
|---|---|
| find_players (filters: tier, currency, status, host, segment, value band, days inactive, deposit/bet ranges, sort, limit) | v_vip_segments + vip_members_all |
| player_360 (one player: status, money, profile, auto profile, last 10 interactions, campaigns, bonuses) | get_vip_profile_auto, get_vip_timeline, v_vip_next_step |
| player_history (daily / monthly figures, date range) | vip_daily_snapshots_all, vip_monthly_stats |
| segments_overview | v_vip_segments |
| alerts (big win/loss, withdrawal, spike, drop, early warning, downgrade risk) | get_money_alerts, v_vip_early_warning, v_tier_downgrade_risk |
| daily_brief | get_daily_brief |
| campaigns (list, players, payouts, impact vs comparison group) | campaigns, campaign_players, campaign_impact |
| team_kpi (per manager: contacts, retention, recall, ARPU, sentiment, tasks) | get_manager_kpi, get_sentiment_kpi, v_recall_summary_monthly |
| contacts_and_tasks (logs, open/missed tasks, unreachable) | contact_logs, tasks |
| games_and_providers | provider_player_monthly, player_provider_summary |
| money_out (bonuses, expenses, campaign cost) | vip_bonus_txns, department_expenses, campaigns |
| rules (current thresholds) | crm_rules |
| ask_sql (safety net for anything else) | read-only SQL on a curated `ai` schema of masked views, 5 s timeout, 200 rows |

Rules kept in every answer: MYR and SGD never added together; real deposit day = deposit > 0 and bet > 0; status from compute_vip_status; no full IC / bank numbers (masked in the views).

### Action tools (confirm card before running)
- create_task (player, host, type Call/Follow Up/…, due date, note) / set_follow_up
- create_campaign_draft (name, type, dates, currency/platform, target tiers, offer, budget) → status draft only; going live stays a manual click on the Campaigns page
- add_players_to_campaign (draft or active campaign, list from find_players)

Flow: AI proposes → chat shows a card ("Create 12 Call tasks for Angel, due 25 Oct — Confirm / Cancel") → server runs the whitelisted action → result + link. Logged in new table `ai_action_log` (who, question, action, payload, result, time).

### Page
- Starter buttons showing what it can do (status overview, who to call today, campaign suggestion, team KPI, player lookup).
- Answers with tables, clickable VIP names, CSV export of lists, "how I got this" (tools used + data date).
- EN/中文 toggle as today.

## Build order (each step: preview → Marcus OK → push)
1. Server rewrite with read tools + strong model + data-date / currency rules; page shows tool steps. (Biggest win: it can read everything.)
2. ask_sql safety net on the `ai` schema.
3. Action tools + confirm cards + ai_action_log.
4. Starter buttons / capability guide, CSV export.

## Open
- Model price check on Marcus's OpenAI account (Billing → usage) after a week.
