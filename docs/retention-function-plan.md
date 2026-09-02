# SureWin CRM — Retention / Monthly Churn Function Rebuild Plan

**Purpose:** This document is the handoff specification for Claude (or another developer agent) to rebuild the Retention / Monthly Churn function to match the proven legacy workflow shown in the user's reference screenshot, while preserving the current CRM's working data model and improving correctness.

**Important:** Do not treat the current simplified Retention page as the final product. The screenshot supplied by the user is the product/UX reference for the desired function.

---

## 1. Executive requirement

The target is a **working Monthly Churn / Retention operational function**, not merely a dashboard.

The final workflow must allow a Host/Admin to:

1. Select the previous month (the month used to define the opening active/depositing population).
2. Select the requested/current month.
3. Generate the churn/retention list from the database.
4. See retention %, opening active players, retained players and churned players.
5. See churn broken down by VIP tier.
6. Focus operational attention on **Diamond and Platinum first**.
7. Search/filter the churn list by tier, VIP ID/username, phone and Host.
8. Hide already-reactivated players from the active churn list.
9. Save the generated snapshot to the database only when the requested month's data is actually available.
10. Export the exact filtered list to CSV.
11. See daily reactivation activity grouped by date.
12. See reactivated player count and recovered deposit amount, separated by currency.
13. Open VIP360, WhatsApp, and Follow Up / Contact Log directly from a player row.
14. After a Host records a contact, the follow-up state must update correctly.
15. After a player deposits again and is recorded as reactivated, the player must move out of the active churn/recovery queue.
16. Feed the same source events into Retention Analytics and Host Performance.

The function must be reliable with real CRM data and must not depend on manually entering counts.

---

# 2. Target UX — use the supplied screenshot as the reference

The supplied reference screenshot shows the desired structure:

```text
Monthly Churn List
Players with deposits in the previous month but no deposit in the selected month.

Monthly Retention
82%
July 2026 306 players → August 2026 retained 250, churned 56

Previous month (deposited)   Requested month
July 2026                    August 2026
[Generate List] [Save to DB] [Export CSV]

Previous active players | Priority churn | Diamond churn | Platinum churn | Gold churn | Current retained

Player list
filters: tier / search / hide reactivated

Player | Tier | Previous deposit | Current deposit | Host | Status | Action

Daily reactivation
2026-08-31 ...
2026-08-28 ...
2026-08-26 ...
...
```

The current CRM screenshot supplied later by the user is **not accepted as the final design** if it loses the legacy operational capabilities.

### Tier emphasis

Business priority is:

1. **Diamond — highest priority**
2. **Platinum — highest priority**
3. **Gold — normal monitoring**
4. Silver / Bronze — low data / low priority; keep available but do not dominate the screen

Therefore the default filter and ordering should emphasize Diamond + Platinum.

---

# 3. Current implementation status as of 2026-09-02

## Already implemented / working at code level

### A. Shared retention logic — DONE

Current file:

`src/lib/retention.js`

Already contains:

- Diamond/Platinum priority tier helper
- tier ordering
- follow-up due calculation
- retention queue classification
- Contact Log URL helper
- retention contact payload builder
- churn urgency calculation
- retention rate calculation
- currency-separated aggregation
- snapshot-window resolution / historical fallback

Current tier order is:

`DIAMOND → PLATINUM → GOLD → SILVER → BRONZE`

Source: `src/lib/retention.js`.

### B. Monthly Retention Workspace — PARTIALLY DONE

Current file:

`src/pages/RetentionWorkspace.jsx`

Route:

`/retention`

Already supports:

- previous/current snapshot comparison
- retention calculation
- churn list
- Diamond + Platinum focus filter
- Gold filter
- search
- hide reactivated
- previous/current deposit values
- Host display
- VIP360 action
- Follow Up action
- WhatsApp action
- daily reactivation section
- CSV export
- snapshot save protection when the requested month has no snapshot
- historical Host preservation

### C. Retention Analytics — PARTIALLY DONE / FUNCTIONALLY STARTED

Current files:

- `src/pages/RetentionAnalytics.jsx`
- `src/lib/retentionAnalytics.js`

Already supports:

- opening active
- retained
- churned
- retention rate
- churn rate
- reactivated count
- recovery by currency
- Diamond / Platinum / Gold KPI cards
- Host performance
- tier-specific recovery aggregation
- historical snapshot fallback

### D. Daily Retention Work Queue — PARTIALLY DONE

Current file:

`src/pages/RetentionQueue.jsx`

Route:

`/retention-queue`

Already supports:

- Diamond / Platinum / Gold pool
- Follow-up Due
- At Risk
- Contacted Today
- Reactivated
- Gold Monitor
- quick Contact Log
- VIP360
- WhatsApp
- Host scoping
- contact log save
- refresh/reload

### E. Follow Up — EXISTING AND WORKING BASE

Current file:

`src/pages/FollowUp.jsx`

Route:

`/follow-up`

It already contains:

- follow-up queue
- urgency grouping
- Contact Log modal
- Contacted / No Reply / Replied / Deposited / Reactivated outcomes
- recovery amount/currency for Reactivated
- VIP360 links
- today suppression

### F. Contact Log — EXISTING SOURCE OF CONTACT HISTORY

Current file:

`src/pages/ContactLog.jsx`

Route:

`/contacts`

Uses `contact_logs` as the historical event source.

Important schema field:

- `logged_at` — **not `created_at`**

Do not reintroduce `created_at` queries for Contact Log unless the actual schema is first verified.

### G. Churn Alerts — PARTIALLY DONE / NEEDS SOURCE ALIGNMENT

Current file:

`src/pages/ChurnAlerts.jsx`

Route:

`/churn`

It has:

- Diamond/Platinum priority calculations
- daily snapshot analysis
- churn urgency
- Contact Log awareness
- follow-up due calculation
- WhatsApp action
- Reactivation handling

**Known problem:** Monthly Churn currently derives the main churn population from `vip_monthly_totals`, while Churn Alerts Priority derives from `vip_daily_snapshots`. This caused the real UAT screenshot situation:

```text
Monthly Churn:
Diamond churn = 1
Platinum churn = 7
Priority churn = 8

Churn Alerts:
Priority = 0
No priority VIPs
```

This is a real integration/data-source mismatch and must be fixed.

### H. Routing — DONE

`src/App.jsx` currently exposes:

- `/retention`
- `/retention-queue`
- `/retention-analytics`
- `/churn`
- `/follow-up`
- `/contacts`
- `/vips/:id`

Do not create duplicate routes for the same workflow unless there is a documented reason.

### I. Regression tests / CI — GOOD BASE

Existing regression tests include:

- `retention-workspace.test.mjs`
- `retention-tier-priority.test.mjs`
- `retention-host-tier.test.mjs`
- `retention-churn-urgency.test.mjs`
- `retention-queue-closure.test.mjs`

CRM CI has already passed the retention regression steps and production build on the current main commit.

Latest verified main commit at handoff:

`70c060d6fae45b60fe996b50d1f77173521e2a30`

Do not stop at unit tests. UAT with actual read-only production data is required.

---

# 4. What is still missing / must be completed

## P0 — Critical

### P0-1. Restore the legacy Monthly Churn operational workflow

The current page must behave like the reference screenshot.

Required controls:

- Previous month
- Requested month
- **Generate List** / Refresh calculation
- Save to DB
- Export CSV

The Generate List action must actually recalculate the selected window. It must not be a cosmetic/no-op button.

The page must clearly distinguish:

- requested month
- effective data month
- previous comparison month

If the requested month has no snapshot, the page must not silently present another month as if it were the requested month.

Preferred behavior:

```text
Requested September 2026
↓
No September snapshot available
↓
show latest available snapshot as fallback
↓
read-only
↓
clear warning
↓
Save disabled
```

### P0-2. One retention truth source

Create one shared normalized retention calculation/data layer so that:

`Monthly Churn`, `Churn Alerts`, `Retention Queue`, and `Retention Analytics`

cannot independently calculate contradictory populations.

The source records remain:

- `vip_members`
- `vip_monthly_totals`
- `vip_daily_snapshots`
- `contact_logs`
- `reactivation_logs`

Do not create a second VIP master table.

Recommended architecture:

```text
Supabase source tables
        ↓
Retention data adapter / normalized records
        ↓
Retention calculation engine
        ↓
 ┌────────────┬─────────────┬──────────────┐
 ↓            ↓             ↓              ↓
Monthly     Churn         Daily          Analytics
Churn       Alerts        Queue
```

### P0-3. Fix Churn Alerts mismatch

If Monthly Churn identifies 8 Diamond/Platinum churn players for a known period, Churn Alerts must be able to surface the corresponding priority players where daily data exists.

Do not simply force the number to 8.

The actual VIP identities must match based on stable identity keys:

1. `vip_id`
2. username fallback

### P0-4. Correct retention mathematics

Definition:

```text
Opening / Previous Active
= players with previous-month total_deposit > 0

Retained
= previous-month total_deposit > 0 AND current-month total_deposit > 0

Churned
= previous-month total_deposit > 0 AND current-month total_deposit <= 0

Retention Rate
= Retained / Previous Active × 100

Churn Rate
= Churned / Previous Active × 100
```

A player is not churned merely because today's daily snapshot is empty.

Incomplete current month must not create false churn.

### P0-5. Reactivation deduplication

A VIP must count once per reactivation month.

Use stable identity:

`vip_id || username || id`

The existing unique constraint on `reactivation_logs` is based on username + reactivated_month. Do not accidentally create duplicate UI counts when old records have null `vip_id`.

### P0-6. Contact → Queue closure

Required behavior:

```text
Follow-up Due
      ↓
Host logs contact
      ↓
contact_logs INSERT succeeds
      ↓
reload queue
      ↓
Contacted Today
      ↓
not shown in active Follow-up Due
```

Then:

```text
3 days without new contact
      ↓
Follow-up Due again
```

If outcome = Reactivated:

```text
contact_logs
+
reactivation_logs
      ↓
Reactivated
      ↓
removed from active churn/recovery action queue
```

### P0-7. Recovery amount must be real, not inferred

For a new Reactivation event, the Host must be able to enter:

- recovery deposit amount
- currency
- notes

The system must not invent a recovery amount from unrelated financial fields.

Supported currencies currently used by this workflow must remain separate:

- MYR
- SGD
- KHUSD / actual database currency code after schema verification

Never add MYR + SGD + KHUSD together as one monetary number.

---

# 5. P1 — Required for a polished final version

## P1-1. Monthly Churn KPI cards

Target cards:

```text
Previous Active Players
Priority Churn
Diamond Churn
Platinum Churn
Gold Churn
Current Retained
```

Priority churn must be:

`Diamond churn + Platinum churn`

The tier counts must use the same exact player population as the main list.

## P1-2. Player list

Columns:

```text
Player
Tier
Previous Deposit
Current Deposit
Host
Status
Action
```

Actions:

- Follow Up
- Open VIP
- WhatsApp

Additional useful status:

- Churn
- Reactivated
- Contacted Today
- Follow-up Due

## P1-3. Filters

Required:

- Priority: Diamond + Platinum
- All tiers
- Diamond
- Platinum
- Gold
- Silver
- Bronze
- Search username / VIP ID / phone / Host
- Hide reactivated

Default:

**Priority: Diamond + Platinum**

## P1-4. Daily Reactivation

Group by date.

Each date should show:

- number of reactivated players
- Diamond count
- Platinum count
- Gold count
- recovered deposit by currency
- player details expandable/clickable

Example:

```text
2026-08-31
5 players
Diamond 1 · Platinum 3 · Gold 1
Recovered MYR 25,000 · SGD 8,000
```

## P1-5. Retention Analytics

Keep:

- opening active
- retained
- churned
- retention rate
- churn rate
- reactivated
- reactivation rate
- recovery by currency

Tier cards:

- Diamond
- Platinum
- Gold

Silver/Bronze can remain in an optional detailed breakdown but should not dominate the management view.

## P1-6. Host Performance

Final Host table should be useful for management:

```text
Host
Assigned VIPs
Diamond Reactivated
Diamond Recovery
Platinum Reactivated
Platinum Recovery
Gold Reactivated
Gold Recovery
Total Reactivated
Reactivation Rate
Total Recovery by Currency
```

Historical Host assignment must come from the historical snapshot where the KPI period is defined. Do not overwrite the previous-month Host with the current Host merely because the current member record changed.

---

# 6. P2 — Quality / UX improvements

- English + Chinese via the existing translation system.
- No new hardcoded translation framework.
- Consistent dark CRM UI.
- Clear green retention / red churn hierarchy.
- Responsive table with horizontal scrolling.
- Loading / error / empty states.
- Clear fallback banner when requested snapshot is unavailable.
- Confirmation feedback after Save to DB.
- CSV filename should contain the effective data month.
- Do not expose raw database errors unnecessarily to normal users; show a friendly error and log the technical detail.

---

# 7. Source-of-truth database tables

Do not invent new tables unless schema review proves one is necessary.

## `vip_members`

Use for:

- VIP identity
- username
- phone / WhatsApp
- tier
- current Host assignment
- currency
- current operational state
- exclusion flag

## `vip_monthly_totals`

Use for:

- month-level deposit totals
- opening/current retention comparison
- tier/currency/Host snapshot data

This is the primary source for Monthly Churn calculation.

Known historical data at handoff:

- July 2026: 497 rows / 324 active depositors
- August 2026: 541 rows / 328 active depositors

## `vip_daily_snapshots`

Use for:

- daily churn urgency
- deposit decline
- recent activity
- recent net win/loss
- daily retention alerts

The implementation must paginate large queries.

## `contact_logs`

Use for:

- contact history
- channel
- outcome
- notes
- follow-up state
- Host

Important field:

`logged_at`

## `reactivation_logs`

Use for:

- explicit reactivation event
- reactivated month
- reactivation deposit
- currency
- Host
- notes

Known historical limitation:

Old July/August records can have reactivation players but no recovery amount. Do not fabricate historical recovery money.

---

# 8. Existing source files — where Claude should work

## Primary files

```text
src/pages/RetentionWorkspace.jsx
src/pages/ChurnAlerts.jsx
src/pages/RetentionQueue.jsx
src/pages/RetentionAnalytics.jsx
src/pages/FollowUp.jsx
src/pages/ContactLog.jsx
src/lib/retention.js
src/lib/retentionAnalytics.js
src/App.jsx
```

## Tests

```text
retention-workspace.test.mjs
retention-tier-priority.test.mjs
retention-host-tier.test.mjs
retention-churn-urgency.test.mjs
retention-queue-closure.test.mjs
```

## Existing design/spec documents

```text
docs/superpowers/specs/2026-09-01-retention-workspace-design.md
docs/superpowers/plans/2026-09-01-retention-workspace.md
```

This document is the **current implementation handoff** and supersedes those documents where they conflict with the user's supplied legacy screenshot and the P0 requirements above.

## Routing

Current routes are defined in:

`src/App.jsx`

Current relevant routes:

```text
/retention
/retention-queue
/retention-analytics
/churn
/follow-up
/contacts
/vips/:id
```

Do not remove existing routes without a migration reason.

---

# 9. Original / legacy reference files

The exact legacy UI shown in the user's reference screenshot is **not currently identifiable as a standalone legacy Retention source file in the repository tree**.

The screenshot is therefore the visual acceptance reference.

Claude must also inspect Git history to find earlier versions of the Retention page before rewriting it:

```bash
git log --all --oneline -- src/pages/RetentionWorkspace.jsx
git log --all --follow -- src/pages/RetentionWorkspace.jsx
git log --all --oneline -- src/pages/ChurnAlerts.jsx
```

If an older implementation contains the Generate List / daily reactivation behavior, recover the useful behavior rather than recreating it from memory.

The screenshot supplied by the user should be treated as the **legacy product reference**, not as a database source.

---

# 10. GitHub / Cloudflare / Supabase / Claude resources

## GitHub — source repository

Repository:

`micxone77-VIP/swcrm3`

url placeholder removed in actual Markdown — use the repository URL below when navigating.

Repository URL:

https://github.com/micxone77-VIP/swcrm3

Default branch:

`main`

Current handoff commit:

`70c060d6fae45b60fe996b50d1f77173521e2a30`

Claude should work from the latest `main`, not from an old local copy.

## Cloudflare Pages

Expected production Pages project / URL used during this project:

`swcrmv3.pages.dev`

Production URL:

https://swcrmv3.pages.dev

Cloudflare dashboard:

https://dash.cloudflare.com/

Important:

- GitHub `main` being green does not prove Cloudflare production deployment succeeded.
- Claude must verify the actual Pages deployment if Cloudflare credentials/integration are available.
- Do not claim deployment success without verification.

## Supabase

The application uses Supabase JS through:

`src/lib/supabase.js`

Environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The project-specific Supabase URL/key must come from the local `.env` / Claude environment / connected Supabase project. **Do not commit secrets into GitHub and do not write the anon key into this document.**

Supabase dashboard:

https://supabase.com/dashboard

The connected Supabase project should be inspected directly for schema verification before changing SQL or DDL.

## Claude

Claude web application:

https://claude.ai

Claude should read this file first, then inspect the repository and existing implementation before changing code.

---

# 11. Deployment / environment rules

1. GitHub is the source repository.
2. `main` is the active branch.
3. Cloudflare Pages is the expected web deployment target.
4. Supabase is the database/source-of-truth backend.
5. Never commit secrets.
6. Never use real VIP accounts as test fixtures.
7. Use static/unit tests or `_testauth_login` for authenticated testing.
8. Prefer read-only queries for UAT against production data.
9. Do not mutate production VIP records merely to prove the UI works.
10. Do not run destructive SQL without explicit schema/migration justification.

---

# 12. UAT acceptance test — mandatory

Claude must test the function against a known period with real read-only data.

Use July → August 2026 as the initial known period because the current CRM already has snapshots for those months.

Expected known result from current UAT screenshot:

```text
Previous active: 306
Retained: 250
Churned: 56
Retention: 82%

Diamond churn: 1
Platinum churn: 7
Priority churn: 8
Gold churn: 48
```

These values must reconcile across:

- Monthly Churn
- Churn Alerts where applicable
- Retention Analytics

Do not hardcode these numbers. They are acceptance-test reference values.

### UAT checks

- [ ] July → August produces the expected opening/retained/churned counts.
- [ ] Diamond churn = 1.
- [ ] Platinum churn = 7.
- [ ] Priority churn = 8.
- [ ] Gold churn = 48.
- [ ] Main player list count matches churn count after filter state is understood.
- [ ] Hide reactivated does not alter the underlying churn count.
- [ ] Re-showing reactivated players works.
- [ ] CSV matches the visible filtered population.
- [ ] Host values come from the correct historical period.
- [ ] Daily reactivation count is deduplicated.
- [ ] Recovery money is currency-separated.
- [ ] No false churn is generated for an incomplete current month.
- [ ] Follow-up status updates after Contact Log save.
- [ ] Reactivated player leaves the active recovery queue.
- [ ] VIP360 opens the correct player.
- [ ] WhatsApp only appears when a valid phone/WhatsApp number exists.
- [ ] Contact Log records use `logged_at`.
- [ ] No duplicate `reactivation_logs` event is created.

---

# 13. Test matrix

## Unit tests

Must cover:

- tier priority
- risk ordering
- follow-up due
- contacted today suppression
- queue classification
- churn urgency
- retention rate
- churn rate
- currency aggregation
- snapshot fallback
- reactivation deduplication
- host tier aggregation

## Integration-style tests

At minimum verify the normalized calculations using representative fixtures:

```text
Previous month:
Diamond A: deposit > 0
Platinum B: deposit > 0
Gold C: deposit > 0

Current month:
Diamond A: deposit = 0
Platinum B: deposit = 1000
Gold C: deposit = 0

Expected:
Diamond churn = 1
Platinum retained = 1
Gold churn = 1
```

## Build

```bash
npm ci
npm run build
```

## CI

All existing CRM regression jobs must remain green.

Warnings that indicate real runtime risk must be fixed rather than ignored merely because Vite exits with code 0.

---

# 14. Definition of Done

The Retention function is **NOT DONE** until all of the following are true:

### Product

- [ ] Matches the supplied legacy screenshot's operational capability.
- [ ] Generate List is functional.
- [ ] Save to DB is functional and protected from invalid snapshot fallback.
- [ ] Export CSV is functional.
- [ ] Monthly KPI cards reconcile with player rows.
- [ ] Daily Reactivation works.
- [ ] Diamond/Platinum are clearly prioritized.
- [ ] Gold remains monitor-level.
- [ ] Search/filter works.
- [ ] Hide/show reactivated works.
- [ ] Follow Up / Open VIP / WhatsApp work.

### Data

- [ ] Monthly Churn and Churn Alerts do not contradict each other.
- [ ] Retention Analytics reconciles with Monthly Churn.
- [ ] Reactivation is deduplicated.
- [ ] Recovery is currency-safe.
- [ ] Historical Host is correct.
- [ ] Incomplete snapshots cannot create false churn.

### Workflow

- [ ] Contact Log closes the follow-up for the day.
- [ ] Follow-up returns after the correct interval.
- [ ] Reactivation moves the VIP out of active churn action.
- [ ] Recovery appears in Analytics.
- [ ] Host performance updates from the same source events.

### Engineering

- [ ] Existing routes remain functional.
- [ ] Existing Campaign / Leaderboard / Portal behavior remains unchanged.
- [ ] English + Chinese translation path is preserved.
- [ ] Unit tests pass.
- [ ] Regression tests pass.
- [ ] Production build passes.
- [ ] No new console/runtime errors.
- [ ] No production VIP test mutations.
- [ ] No secrets committed.
- [ ] Cloudflare deployment is verified separately before claiming production completion.

---

# 15. Recommended implementation sequence for Claude

Claude should execute continuously without stopping for user confirmation after every small step.

```text
1. Read this plan.
2. Read existing retention spec/plan.
3. Inspect Git history for the old RetentionWorkspace behavior.
4. Inspect current RetentionWorkspace / ChurnAlerts / Queue / Analytics / FollowUp / ContactLog.
5. Inspect Supabase schemas before making assumptions.
6. Build a shared normalized retention calculation layer.
7. Fix Monthly Churn to match the legacy workflow.
8. Fix Churn Alerts to consume the same normalized population.
9. Complete Daily Queue closure.
10. Complete Reactivation + recovery.
11. Complete Analytics + Host Performance.
12. Add/repair translations.
13. Add regression tests for every discovered bug.
14. Run unit tests.
15. Run full regression suite.
16. Run production build.
17. Perform read-only UAT with July → August known data.
18. Fix every discrepancy.
19. Re-run all tests.
20. Only then report completion.
```

**Do not stop at “CI green”. The final gate is reconciliation between the UI, Supabase source records, and the user's reference workflow.**
