# Retention Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing At Risk, Follow Up, Contact Log, and reactivation capabilities into one operational Retention workspace without creating a second VIP data model or changing Campaign, Leaderboard, Portal, or payout authority.

**Architecture:** Add a small shared retention-calculation module over the existing Supabase source tables, then compose a Retention page from existing operational data. Keep `/at-risk`, `/follow-up`, `/contacts`, `/churn`, and `/vips/:id` working as legacy/direct routes while adding a `/retention` workspace entry point. All financial aggregates remain currency-separated.

**Tech Stack:** React, React Router, Supabase JS, existing UI components, existing `useAuth()` and `useLanguage()` contexts, existing Vite test/build setup.

**Spec:** `docs/superpowers/specs/2026-09-01-retention-workspace-design.md`

## Global Constraints

- No second VIP master table or retention database.
- Use `vip_members`, `vip_daily_snapshots`, `vip_monthly_totals`, `contact_logs`, and `reactivation_logs` as source records.
- Preserve existing churn/follow-up logic and pagination safeguards.
- MYR, SGD, and KHUSD must never be silently combined.
- Contact and reactivation writes must only be reported as successful after the database write succeeds.
- `/vips/:id` remains the detailed VIP360 surface.
- Existing Campaign, Leaderboard, Player Portal, and payout behavior must remain unchanged.
- New UI strings must use the existing `useLanguage()` translation pattern.
- Existing role enforcement remains authoritative: admin, host, readonly.

---

### Task 1: Add shared retention calculations

**Files:**
- Create: `src/lib/retention.js`
- Test: `retention-workspace.test.mjs`

**Interfaces:**
- Consumes: normalized VIP records, contact logs, reactivation logs, and a reporting period.
- Produces: pure functions for priority, follow-up eligibility, retention-rate calculations, and currency-separated monetary aggregation.

- [ ] **Step 1: Write failing tests for pure retention rules**

Test these cases in `retention-workspace.test.mjs`:

```js
import assert from 'node:assert/strict'
import {
  daysSince,
  isFollowUpDue,
  getRetentionPriority,
  calculateRate,
  sumByCurrency,
} from './src/lib/retention.js'

assert.equal(daysSince('2026-09-01T00:00:00Z', new Date('2026-09-04T00:00:00Z')), 3)
assert.equal(isFollowUpDue({ lastContact: null, contactedToday: false }), true)
assert.equal(isFollowUpDue({ lastContact: '2026-09-01T00:00:00Z', contactedToday: false }, new Date('2026-09-04T00:00:00Z')), true)
assert.equal(isFollowUpDue({ lastContact: '2026-09-02T00:00:00Z', contactedToday: false }, new Date('2026-09-04T00:00:00Z')), false)
assert.equal(getRetentionPriority({ tier: 'DIAMOND', churn_risk: 'CRITICAL', days_inactive: 8 }), 'CRITICAL')
assert.equal(calculateRate(3, 4), 75)
assert.deepEqual(sumByCurrency([
  { amount: 100, currency: 'MYR' },
  { amount: 50, currency: 'MYR' },
  { amount: 20, currency: 'SGD' },
]), { MYR: 150, SGD: 20 })
```

- [ ] **Step 2: Run the new test and verify it fails because the shared functions do not exist**

Run: `node retention-workspace.test.mjs`
Expected: FAIL with module/function import errors.

- [ ] **Step 3: Implement the pure functions without database access**

`src/lib/retention.js` must export:

```js
export function daysSince(dateValue, now = new Date()) { /* integer days; null stays null */ }
export function isFollowUpDue({ lastContact, contactedToday }, now = new Date()) { /* never contacted or >=3 days and not contacted today */ }
export function getRetentionPriority({ tier, churn_risk, days_inactive }) { /* CRITICAL/HIGH/MEDIUM/NORMAL */ }
export function calculateRate(numerator, denominator) { /* 0 when denominator is zero; rounded percentage */ }
export function sumByCurrency(rows) { /* object keyed by currency; never cross-sum */ }
```

Priority ordering must be CRITICAL first, then HIGH, then MEDIUM, with Diamond/Black/Platinum before lower tiers when risk is equal.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node retention-workspace.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit the shared calculation unit**

```bash
git add src/lib/retention.js retention-workspace.test.mjs
git commit -m "feat: add retention calculation helpers"
```

---

### Task 2: Build the Retention operational workspace

**Files:**
- Create: `src/pages/Retention.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/Sidebar.jsx`

**Interfaces:**
- Consumes: `retention.js`, Supabase records, existing `TierBadge`, `RiskBadge`, `KpiCard`, `Card`, `Btn`, `FilterPills`, loading/error/empty states, `useAuth()`, `useLanguage()`.
- Produces: `/retention` route with Overview, At Risk, Follow Up, Contact Log, and Reactivated navigation sections.

- [ ] **Step 1: Add a route-level smoke test before implementation**

Extend `retention-workspace.test.mjs` with the route contract as a pure assertion:

```js
const retentionRoute = '/retention'
assert.equal(retentionRoute, '/retention')
```

The test is intentionally small because router rendering is covered by the existing CRM build/regression suite.

- [ ] **Step 2: Implement Retention page data loading**

Load only the records required for the selected reporting period:

```js
const [{ data: vips, error: vipError }, { data: contacts, error: contactError }, { data: reactivations, error: reactError }] = await Promise.all([
  supabase.from('vip_members').select('*').neq('is_excluded', true),
  supabase.from('contact_logs').select('*').gte('created_at', periodStart).lte('created_at', periodEnd),
  supabase.from('reactivation_logs').select('*').gte('created_at', periodStart).lte('created_at', periodEnd),
])
```

The implementation must surface a database error rather than presenting partial data as authoritative.

- [ ] **Step 3: Implement the Overview section**

Show these KPI cards:

```text
At Risk VIPs
High Risk
Dormant
Contacted
Reactivated
Reactivation Progress
Retention Rate
Churn Rate
Reactivation Rate
```

Monetary recovery must be rendered as separate currency subtotals, for example `MYR RM…`, `SGD S$…`, and `KHUSD …`, instead of one mixed total.

- [ ] **Step 4: Implement the priority queue**

The default queue must sort by:

1. Critical/high churn risk.
2. Diamond/Black/Platinum tier.
3. Days since deposit/contact.

Each row must show the reason for priority and provide an `Open VIP` action to `/vips/:id`.

- [ ] **Step 5: Add workspace tabs/sections for existing operational flows**

Use links rather than duplicating their complete logic:

```text
Overview       /retention
At Risk        /at-risk
Follow Up      /follow-up
Contact Log    /contacts
Reactivated    /retention?view=reactivated
```

The Retention page may render compact summaries of those datasets, but the existing pages remain the detailed operational surfaces.

- [ ] **Step 6: Wire `/retention` into the router and sidebar**

In `App.jsx`, add:

```jsx
<Route path="retention" element={<RequireRole roles={['admin','host','readonly']}><Retention /></RequireRole>} />
```

In `Sidebar.jsx`, add a Retention domain entry visible to the same roles, positioned with VIP Operations rather than under Campaigns.

- [ ] **Step 7: Run the build**

Run: `npm run build`
Expected: successful Vite production build with no new import or routing errors.

- [ ] **Step 8: Commit the workspace shell**

```bash
git add src/pages/Retention.jsx src/App.jsx src/components/Sidebar.jsx retention-workspace.test.mjs
git commit -m "feat: add retention workspace"
```

---

### Task 3: Consolidate contact and reactivation writes around source-of-truth records

**Files:**
- Modify: `src/pages/FollowUp.jsx`
- Modify: `src/pages/ContactLog.jsx`
- Modify: `src/pages/Retention.jsx`
- Test: `retention-workspace.test.mjs`

**Interfaces:**
- Consumes: `contact_logs` and `reactivation_logs` as authoritative event records.
- Produces: successful-write semantics and consistent UI state after contact/reactivation actions.

- [ ] **Step 1: Add tests for failed-write semantics**

Add pure state assertions:

```js
function shouldCountAsCompleted({ saveSucceeded }) {
  return saveSucceeded === true
}

assert.equal(shouldCountAsCompleted({ saveSucceeded: true }), true)
assert.equal(shouldCountAsCompleted({ saveSucceeded: false }), false)
```

- [ ] **Step 2: Fix Follow Up contact logging to check both writes**

The existing flow inserts `contact_logs` and updates `vip_members` without checking either result. Change it so the UI only shows success after the insert succeeds, and surface a failure toast/error when either required write fails.

The insert payload remains:

```js
{
  username: logTarget.username,
  vip_id: logTarget.id,
  outcome: logOutcome,
  notes: logNote || null,
  host_name: profile?.full_name || null,
  logged_at: now,
  created_at: now,
}
```

- [ ] **Step 3: Preserve contact history as the event source**

Do not add a duplicate retention-specific contact table or local persistence. Reload `contact_logs` after a successful write so the same event appears in Contact Log and Retention.

- [ ] **Step 4: Wire explicit reactivation confirmation to `reactivation_logs`**

A reactivation action must insert one authoritative record, await the result, and only then update local UI state. If the insert fails, leave the VIP unreactivated in the UI and show the database error.

- [ ] **Step 5: Run tests and build**

Run:

```bash
node retention-workspace.test.mjs
npm run build
```

Expected: tests PASS and build succeeds.

- [ ] **Step 6: Commit source-of-truth write handling**

```bash
git add src/pages/FollowUp.jsx src/pages/ContactLog.jsx src/pages/Retention.jsx retention-workspace.test.mjs
git commit -m "fix: enforce retention source-of-truth writes"
```

---

### Task 4: Add Retention Analytics and host performance

**Files:**
- Modify: `src/pages/Retention.jsx`
- Create: `src/lib/retentionAnalytics.js`
- Test: `retention-workspace.test.mjs`

**Interfaces:**
- Consumes: normalized VIP/contact/reactivation rows from Task 1.
- Produces: period-scoped retention/churn/reactivation metrics and host-level performance, separated by currency for money metrics.

- [ ] **Step 1: Add failing analytics assertions**

Add tests such as:

```js
import { calculateRetentionMetrics } from './src/lib/retentionAnalytics.js'

const metrics = calculateRetentionMetrics({
  openingVipCount: 100,
  retainedVipCount: 60,
  churnedVipCount: 40,
  reactivatedVipCount: 10,
  recoveredDeposits: [
    { amount: 1000, currency: 'MYR' },
    { amount: 500, currency: 'SGD' },
  ],
})

assert.equal(metrics.retentionRate, 60)
assert.equal(metrics.churnRate, 40)
assert.equal(metrics.reactivationRate, 10)
assert.deepEqual(metrics.recoveredDepositsByCurrency, { MYR: 1000, SGD: 500 })
```

- [ ] **Step 2: Implement `calculateRetentionMetrics()`**

Return:

```js
{
  retentionRate,
  churnRate,
  reactivationRate,
  recoveredDepositsByCurrency,
}
```

Never calculate a single money total from rows with different currency codes.

- [ ] **Step 3: Add host performance aggregation**

Group operational outcomes by `host_assigned`/`host_name` and show:

```text
Assigned VIPs
Contacts
Positive Replies
Deposited
Reactivated
Reactivation Rate
Recovered Deposit by Currency
```

Hosts without records remain visible only when they exist in the current profile/assignment source; do not fabricate activity.

- [ ] **Step 4: Add the Analytics view to Retention**

Provide a reporting-period selector and an Analytics section. Definitions must be visible in help text/tooltips so `retention rate`, `churn rate`, and `reactivation rate` are not ambiguous.

- [ ] **Step 5: Run tests and build**

Run:

```bash
node retention-workspace.test.mjs
npm run build
```

Expected: PASS and successful production build.

- [ ] **Step 6: Commit analytics**

```bash
git add src/lib/retentionAnalytics.js src/pages/Retention.jsx retention-workspace.test.mjs
git commit -m "feat: add retention analytics"
```

---

### Task 5: Add translations and validated contact actions

**Files:**
- Modify: `src/pages/Retention.jsx`
- Modify: `src/components/Sidebar.jsx`
- Modify: the existing translation resource used by `src/contexts/LanguageContext.jsx` after inspecting its current shape
- Test: `retention-workspace.test.mjs`

**Interfaces:**
- Consumes: existing `useLanguage()` translation API and existing phone/WhatsApp data.
- Produces: English and Chinese Retention labels and validated contact action behavior.

- [ ] **Step 1: Inspect the existing language resource shape before editing it**

Use the existing keys and fallback conventions from `LanguageContext.jsx`; do not introduce a second translation mechanism.

- [ ] **Step 2: Add Retention translation keys**

Add English and Chinese translations for:

```text
Retention
Overview
At Risk
Follow Up
Contact Log
Reactivated
Retention Analytics
At-risk VIPs
High Risk
Dormant
Contacted
Reactivated
Retention Rate
Churn Rate
Reactivation Rate
Recovered Deposit
Host Performance
No valid contact number
Open VIP
Contact
```

- [ ] **Step 3: Validate phone/WhatsApp actions before generating a deep link**

If the normalized phone value is absent or invalid, show `No valid contact number` and do not create a WhatsApp URL. If valid, retain the application's existing WhatsApp deep-link behavior.

- [ ] **Step 4: Run language and build regression checks**

Run:

```bash
node retention-workspace.test.mjs
npm run build
```

Expected: PASS and successful build.

- [ ] **Step 5: Commit translations and contact validation**

```bash
git add src/pages/Retention.jsx src/components/Sidebar.jsx src/contexts/LanguageContext.jsx retention-workspace.test.mjs
git commit -m "feat: localize retention workspace"
```

---

### Task 6: Regression verification against existing CRM domains

**Files:**
- Test/inspect: `src/App.jsx`, `src/pages/AtRisk.jsx`, `src/pages/FollowUp.jsx`, `src/pages/ContactLog.jsx`, `src/pages/ChurnAlerts.jsx`, campaign/leaderboard regression tests.

**Interfaces:**
- Consumes: all changes from Tasks 1–5.
- Produces: verified Retention workspace without regressions in existing Campaign, Leaderboard, Portal, payout, or VIP workflows.

- [ ] **Step 1: Run the retention test suite**

Run: `node retention-workspace.test.mjs`
Expected: PASS.

- [ ] **Step 2: Run existing leaderboard regression tests**

Run:

```bash
node leaderboard-behavior-regression.test.mjs
node leaderboard-metric-regression.test.mjs
```

Expected: PASS. Retention work must not alter leaderboard behavior.

- [ ] **Step 3: Run the application build**

Run: `npm run build`
Expected: successful production build.

- [ ] **Step 4: Verify route protection manually**

Check `/retention` for admin, host, and readonly sessions. Confirm that existing `/at-risk`, `/follow-up`, `/contacts`, `/churn`, and `/vips/:id` routes still resolve and that their existing role restrictions remain intact.

- [ ] **Step 5: Verify currency separation with known records**

Use a period containing at least one MYR and one SGD/KHUSD record. Confirm that the Retention monetary KPI shows separate subtotals and never a combined unlabeled number.

- [ ] **Step 6: Verify failed-write behavior**

Simulate a failed contact-log/reactivation write in a test environment. Confirm that the UI does not increment Contacted/Reactivated until the database operation succeeds.

- [ ] **Step 7: Commit only after all verification passes**

```bash
git status
git log --oneline -6
```

Confirm the working tree contains only intended Retention changes before merging the feature branch.
