# Silver / Bronze in the CRM (since 2026-10-18)

Decision (Marcus): Silver and Bronze players are full player records (VIP360, contact log, campaigns), but stay OUT of VIP KPIs, Churn, Today, No-contact counts and host queues.

## Database layout
| Object | What it is |
|---|---|
| `vip_members_all` (table) | Every player: Gold+ AND Silver/Bronze (~22.9k rows). Was `vip_members` before. |
| `vip_members` (VIEW, security_invoker) | `vip_members_all` where tier NOT IN (SILVER, BRONZE). All existing pages/KPIs read this, so VIP numbers did not change. Auto-updatable (insert/update/upsert work). |
| `vip_daily_snapshots_all` (table) | Daily rows for every player. |
| `vip_daily_snapshots` (VIEW) | Gold+ only. |
| `potential_players` / `potential_daily_snapshots` | Old Silver/Bronze store, still fed by the CSV import (turnover-only history since 2026-07-01). |

- Views use `SELECT *` → columns are frozen. **After `ALTER TABLE vip_members_all ADD COLUMN …`, recreate the two views.**
- Dependent views (vip_monthly_totals, v_vip_status_base, v_vip_recent_stats, …) point at the Gold+ views.
- Functions switched to `*_all`: campaign sync/progress, campaign_impact, auto-enrollment, refresh_days_inactive, sync_vip_snapshot_vip_id, sync_member_deposit_date, sync_vip_last_contacted, portal functions, get_players_daily.
- `trg_sync_campaign_players_from_snapshot` now only syncs campaigns the player is enrolled in (needed for the bulk Silver/Bronze daily insert). Indexes on lower(username) added.

## Performance lessons (2026-10-19)
- After the first Silver/Bronze import (22.6k rows/day) `vip_monthly_totals` timed out (>8s) for logged-in users: RLS + `lower(a.username) = lower(b.username)` joins forced a nested loop. Fixed by joining on exact `username =` (no case-only mismatches exist) in vip_monthly_totals, v_recall_attribution, v_vip_status_base, v_vip_next_step, v_tier_downgrade_risk, and by wrapping RLS calls as `(select get_my_role())`. **Never use lower()=lower() joins between these tables.**
- `last_contact_date` on vip_members_all is a GENERATED column (= last_contacted). Never write it — the whole update fails.

## Data quality
- CSV uploads are DAILY: each daily row = that day's own figures (not cumulative). VIP360 Deposit Calendar was fixed to use daily values (2026-10-20).
- Until 2026-10-20 the import carried yesterday's deposit forward for players not in today's CSV → fake repeat deposits. That's why deposit/withdrawal/GGR only count on days with valid bet > 0.
- Fixed 2026-10-20: players not in today's CSV get ALL daily figures zeroed (ZERO_DAY in CSVImport). **Pending:** after a few days of clean data, relax the rule so deposits count on no-bet days from that date onward (real example: jaslyn 18 Oct SGD 35,000 deposit, 0 bets). ~0.5% of deposits affected.

## Campaign Impact (campaign_impact RPC + src/lib/campaignImpact.js)
- Comparison group = same currency + tier AT ENROLMENT (campaign_players.tier), not enrolled, not in an overlapping campaign, and with daily data in the "before" window (stops Silver/Bronze with no history faking growth).
- Effect is ratio-based: expected = campaign players' own before-level × comparison group's % change (GGR scaled by comparison turnover ratio). Additive RM-per-player was unfair because campaign players are bigger players than the comparison group.

## App code
- `src/lib/allPlayers.js`: `MEMBERS_ALL`, `DAILY_ALL`, `fetchMembersFor`, `findMembersByNames`, `fetchDailyFor` (chunked by 150 usernames).
- Uses `*_all`: VIP360, campaign enrolment + tracking (Campaigns.jsx, MixedWrapper, UnifiedCreator, ChallengeCreator, ChallengeDetail, DailyMilestoneDetail), GlobalSearch / VipQuickSearch (VIPs first, then Silver/Bronze), All VIPs when tier filter = SILVER/BRONZE, cash voucher import.
- CSV import: VIP rows upsert into `vip_members_all`; Silver/Bronze rows batch-upserted (500) into `vip_members_all`; daily snapshot also writes Silver/Bronze into `vip_daily_snapshots_all`. Gold→Silver changes are logged in tier_change_logs and the player leaves the VIP list automatically.
- Full daily data (deposit/withdrawal/WL) for Silver/Bronze only exists from the first import after 2026-10-18.
