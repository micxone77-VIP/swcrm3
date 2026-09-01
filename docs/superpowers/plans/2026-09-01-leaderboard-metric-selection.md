# Leaderboard Metric Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CRM-controlled `leaderboard_metric` setting so each leaderboard campaign determines whether the Player Portal displays/ranks by turnover, deposit, or both.

**Architecture:** Keep CRM Campaigns as the configuration source. Persist one enum-like text field on `campaigns`, expose it through the existing player-safe leaderboard RPC, and make the Portal render only the configured metric(s). For `turnover_deposit`, turnover remains the primary ranking metric while deposit is displayed as the secondary metric.

**Tech Stack:** React 18, Vite, Supabase/PostgreSQL, existing campaign editor and player-safe RPC.

**Spec:** `docs/superpowers/specs/2026-09-01-leaderboard-metric-selection.md`

## Global Constraints

- Reuse the existing Campaign and Leaderboard data path; do not create another leaderboard site or data store.
- CRM controls the metric; players never select or submit the metric.
- Player Portal must never expose CRM-only fields.
- Active campaigns continue automatic refresh; ended campaigns remain fixed.
- Supported values are exactly `turnover`, `deposit`, `turnover_deposit`.
- For `turnover_deposit`, ranking uses turnover as the primary metric and deposit is displayed as secondary context.

---

### Task 1: Persist leaderboard metric in campaigns

**Files:**
- Create: `supabase/migrations/20260901090000_leaderboard_metric.sql`

**Interfaces:**
- Produces `public.campaigns.leaderboard_metric` with default `turnover`.

- [ ] Write migration adding the nullable/defaulted field with a check constraint limited to `turnover`, `deposit`, `turnover_deposit`.
- [ ] Backfill existing leaderboard campaigns to `turnover`; leave non-leaderboard campaigns at `turnover` or null according to the existing schema convention.
- [ ] Add an index only if the existing query path needs it; do not add an index solely for display configuration.
- [ ] Verify the migration is idempotent enough for the repository's migration workflow and does not alter campaign player data.

### Task 2: Add CRM create/edit configuration

**Files:**
- Modify: `src/pages/CampaignsUnifiedCreator.jsx`
- Modify: `src/pages/Campaigns.jsx`
- Modify: `src/lib/campaignEditor.js`

**Interfaces:**
- Campaign creator writes `leaderboard_metric` for leaderboard campaigns.
- Campaign editor reads/writes `leaderboard_metric` for leaderboard campaigns.

- [ ] Add a three-option control in leaderboard-specific settings: `Turnover Race`, `Deposit Race`, `Turnover + Deposit Race`.
- [ ] Default new leaderboard campaigns to `turnover` so existing behavior is preserved.
- [ ] Hide this control for non-leaderboard campaign types.
- [ ] Include the field in `EDITABLE_CAMPAIGN_FIELDS` and `normalizeCampaignForEdit`.
- [ ] Include the field in `buildCampaignUpdate`, with validation/defaulting to `turnover` for leaderboard campaigns.
- [ ] Ensure campaign creation inserts the field without changing existing non-leaderboard payloads.
- [ ] Add a compact label on the CRM leaderboard detail/header so staff can immediately see the selected metric.
- [ ] Keep the existing Top N/reward settings unchanged.

### Task 3: Update the player-safe leaderboard RPC

**Files:**
- Modify: `supabase/migrations/20260901090000_leaderboard_metric.sql`

**Interfaces:**
- Extends `get_portal_campaign_leaderboard(uuid)` with `leaderboard_metric` and separate `turnover_value` while preserving `deposit_value`.

- [ ] Return `leaderboard_metric` as a display-safe field.
- [ ] Calculate effective turnover and effective deposit independently for active campaigns.
- [ ] Select the ranking value by campaign configuration: turnover for `turnover` and `turnover_deposit`; deposit for `deposit`.
- [ ] Keep ended campaigns frozen using settled rank/performance values rather than recomputing them from current snapshots.
- [ ] Keep username masking and enrollment authorization unchanged.
- [ ] Do not return raw usernames, VIP IDs, contact data, CRM notes, manual override metadata, budget, or other CRM-only fields.
- [ ] Preserve explicit `REVOKE`/`GRANT` function permissions and `SET search_path = ''` security posture.

### Task 4: Update Portal rendering

**Files:**
- Modify: `src/pages/Leaderboard.jsx`
- Modify: `src/lib/leaderboard.js`

**Interfaces:**
- Portal consumes `leaderboard_metric`, `metric_value`, `turnover_value`, and `deposit_value` from the existing RPC.

- [ ] Derive display mode from the RPC/campaign data; never hardcode a campaign-specific metric.
- [ ] `turnover`: show only `TURNOVER` in podium, Top N, and My Position.
- [ ] `deposit`: show only `DEPOSIT` in podium, Top N, and My Position.
- [ ] `turnover_deposit`: show both metrics with clear labels and spacing in podium, Top N, and My Position.
- [ ] Change the Top N hint from the current hardcoded `Turnover ranking` to the configured metric label.
- [ ] Keep masking, Top 3, Top N, My Position, refresh, and ended/final behavior intact.
- [ ] Avoid exposing any CRM-only field in rendered state.

### Task 5: Regression tests

**Files:**
- Modify: `leaderboard-page-regression.test.mjs`
- Modify: `leaderboard.test.mjs`
- Create/modify: `leaderboard-metric-regression.test.mjs`

- [ ] Test turnover mode renders only turnover.
- [ ] Test deposit mode renders only deposit.
- [ ] Test turnover+deposit mode renders both.
- [ ] Test the displayed ranking label is not hardcoded to turnover.
- [ ] Test Top N and My Position use the same configured metric visibility.
- [ ] Test default/legacy leaderboard behavior remains turnover.
- [ ] Run `npm run lint` and `npm run build` in the Portal repository.
- [ ] Run the repository's existing test commands and verify no regression in campaign detail/leaderboard routing.

### Task 6: Final verification

- [ ] Verify a newly created CRM leaderboard persists the selected metric.
- [ ] Verify editing an existing leaderboard changes only its configuration and does not recreate campaign players.
- [ ] Verify the Portal reads the setting through the RPC rather than directly from CRM tables.
- [ ] Verify active leaderboard refresh still works and ended leaderboard remains fixed.
- [ ] Verify non-leaderboard campaigns are unaffected.
