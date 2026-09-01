# Leaderboard Metric Selection

**Date:** 2026-09-01
**Status:** Approved

## Goal

Allow CRM staff to configure what a leaderboard campaign displays and ranks by, while keeping the existing Player Portal leaderboard as the only player-facing experience.

## Configuration

`campaigns.leaderboard_metric` supports:

- `turnover` — rank by effective valid bet/turnover and display turnover only.
- `deposit` — rank by effective campaign-period deposit and display deposit only.
- `turnover_deposit` — rank by turnover as the primary ranking metric and display both turnover and deposit.

Default for existing and newly-created leaderboard campaigns is `turnover`, preserving current behavior.

## Product Rules

1. Metric is selected in CRM Campaign create/edit.
2. Non-leaderboard campaign types do not show the setting.
3. Player Portal does not let players select the metric.
4. Portal leaderboard uses the existing player-safe Supabase RPC.
5. Active campaigns continue to refresh automatically.
6. Ended campaigns continue to use the settled/final ranking.
7. Top 3, Top N, and My Position all follow the same display configuration.
8. No CRM-only data is returned to the player.
9. No second leaderboard website or separate leaderboard database is introduced.

## Display Contract

| Metric | Ranking | Display |
|---|---|---|
| turnover | turnover | Turnover only |
| deposit | deposit | Deposit only |
| turnover_deposit | turnover | Turnover + Deposit |

For `turnover_deposit`, turnover is explicitly the primary ranking metric. Deposit is secondary display context and does not create a compound ranking formula.

## Data Contract

The player-safe RPC may expose only the following additional display configuration/value fields:

- `leaderboard_metric`
- `turnover_value`
- existing `deposit_value`
- existing `metric_value` as the effective ranking value

It must not expose raw usernames, VIP IDs, contacts, CRM notes, manual override metadata, campaign budget, internal approval data, or payout notes.

## Backward Compatibility

Existing leaderboard campaigns are backfilled to `turnover`. Existing portal behavior therefore remains unchanged until a CRM user explicitly selects another mode.
