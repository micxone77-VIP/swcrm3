# SureWin CRM Retention Workspace Design

**Date:** 2026-09-01  
**Status:** Proposed for review

## 1. Goal

Turn the existing churn, follow-up, contact-log, and reactivation functionality into one coherent Retention workspace without creating a second VIP data model. The workspace should help hosts answer four operational questions quickly:

1. Which VIPs need attention now?
2. Who has been contacted and what was the result?
3. Which churn-risk VIPs were recovered?
4. What retention/recovery performance did the team achieve?

Existing Campaign, Leaderboard, Portal, payout, and financial workflows remain unchanged.

## 2. Product Structure

The existing `/churn` and `/follow-up` flows become the foundation rather than introducing duplicate pages or duplicate data.

### Retention workspace

- **Overview** — operational KPIs and priority queue.
- **Churn / At Risk** — risk-ranked VIP list with filters.
- **Follow Up** — actionable contact queue grouped by urgency.
- **Contact Log** — complete contact history and outcome recording.
- **Reactivated** — month-based recovery list and activation progress.
- **Retention Analytics** — retention, churn, reactivation, recovered deposit, and host performance.

Navigation may use a new Retention domain in the sidebar, while legacy routes remain available during the transition to avoid broken bookmarks.

## 3. Existing Data Sources

No new master VIP table is introduced.

- `vip_members` — current VIP identity, tier, host assignment, risk/status, contact fields, and current operational attributes.
- `vip_daily_snapshots` — daily behavioral/financial history used for churn and priority calculations.
- `vip_monthly_totals` — accumulated monthly financial totals where required; currency is always respected.
- `contact_logs` — authoritative contact-event history and outcomes.
- `reactivation_logs` — authoritative record of manual reactivation confirmation.

Derived metrics are calculated from these sources. A metric is not copied into a second table merely for UI convenience.

## 4. Operational Logic

### Priority contacts

Retain the current high-value Diamond/Platinum priority logic as the first iteration, including:

- significant 7-day deposit decline;
- several days without deposit;
- balance depletion behavior;
- recent material net loss;
- urgency score and reason explanations.

The existing implementation already paginates daily snapshots and avoids large username `IN` queries. These safeguards remain.

### Churn / At Risk

Use the existing `churn_risk`, `activity_status`, and `days_inactive` fields as operational filters. Default ordering remains urgency-oriented rather than alphabetical.

### Follow Up

A VIP enters the follow-up queue when they have not been contacted today and either have no prior contact or the last contact is at least three days old. Urgency is increased for seven-plus days since contact or HIGH/CRITICAL churn risk.

### Contact outcome

Supported outcomes remain:

- Contacted
- No Reply
- Replied
- Deposited
- Reactivated

A contact event should be recorded once, in `contact_logs`, with the appropriate type and outcome. The UI should not create shadow copies of the same event.

### Reactivation

A host can explicitly mark a VIP as reactivated. The existing `reactivation_logs` record is used for the monthly recovery count and progress target. Reactivation notes remain optional.

## 5. Retention KPIs

The first implementation will show:

- At-risk VIP count
- High-risk VIP count
- Dormant VIP count
- Contacted count
- Reactivated count
- Reactivation target/progress
- Retention rate
- Churn rate
- Reactivation rate
- Recovered deposit
- Host-level retention/recovery performance

Definitions must be explicit in the UI/help text and calculated from the selected reporting period. MYR, SGD, and KHUSD are never summed into one unlabeled monetary total.

Where a combined management view is needed, show separate currency subtotals.

## 6. VIP 360 Integration

Every actionable VIP row should provide a direct path to `/vips/:id` so the host can inspect the full player context before contacting them. Existing VIP360 remains the detailed profile surface rather than duplicating profile information inside Retention.

## 7. Contact Actions

For a VIP with a valid phone/WhatsApp number, the existing WhatsApp deep-link behavior can be retained. The contact number must be validated before generating a link. If no valid contact number exists, the UI shows the absence rather than generating a broken link.

The contact action and contact-log recording remain separate steps unless the existing UI can safely combine them without losing the user's ability to cancel or correct the outcome.

## 8. Permissions

Retention follows the existing role model:

- **Admin:** full Retention access and management views.
- **Host:** operational Retention access for assigned/workable VIPs.
- **Readonly:** reporting/read-only views only where the existing route permissions allow it.

Existing `RequireRole` route protection remains the enforcement point. UI hiding is not treated as security.

## 9. Language

The current application language system supports English and Chinese. New Retention UI strings must use the existing `useLanguage()` / translation pattern rather than hardcoded page text. Existing fallback behavior remains unchanged.

## 10. Error Handling

- Loading states use the existing UI patterns.
- Database errors are surfaced with an actionable error state/toast where appropriate.
- A failed reactivation save must not visually count the VIP as reactivated.
- A failed contact-log write must not be represented as a successful logged contact.
- Empty states explain what the user can do next.
- Currency or missing-data anomalies are displayed explicitly rather than silently converted or combined.

## 11. Scope Boundaries

This phase does **not**:

- replace the existing CRM database;
- create a separate retention database;
- create a second Player Portal;
- change Player Portal leaderboard behavior;
- change campaign payout authority;
- introduce automated outbound WhatsApp sending;
- introduce predictive ML churn scoring;
- change the existing VIP tier model.

## 12. Testing / Acceptance Criteria

Before calling the phase complete:

1. Existing CRM build passes.
2. Existing routes continue to resolve.
3. Churn, Follow Up, Contact Log, and Reactivation workflows still work.
4. A contact outcome is persisted correctly and appears in history.
5. A reactivation is persisted once and reflected in monthly progress.
6. Retention KPIs agree with the underlying source records for a known test period.
7. MYR/SGD/KHUSD are never accidentally combined.
8. Role restrictions are enforced for admin/host/readonly.
9. English and Chinese translations exist for new user-facing strings.
10. Existing Leaderboard/Portal/Campaign behavior remains unchanged.

## 13. Implementation Order

1. Add shared Retention calculations/helpers without changing source-of-truth tables.
2. Refactor the current Churn Alerts page into the Retention operational workspace.
3. Consolidate Follow Up and Contact Log navigation/entry points while retaining their routes.
4. Add Retention Overview KPIs.
5. Add Retention Analytics and host performance.
6. Integrate VIP360 links and validated contact actions.
7. Add translations.
8. Run build/tests and perform regression review against Campaign/Leaderboard/Portal routes.
