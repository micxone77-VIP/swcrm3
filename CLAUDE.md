# SureWin VIP CRM — notes for Claude Code

Owner: **Marcus** (VIP Department, sureWin, Kuala Lumpur). Admin of this CRM. Not a coder: explain in plain words, English or 中文 (reply in the language he writes in).

## Read first
- `docs/claude/claude-chat-history.md`: full history of the Claude chat that built most features (summary + recent turns). Read it before starting so you know what was done and what is pending.
- `docs/claude/silver-bronze-architecture.md`: database layout since 2026-10-18 (MUST read before any SQL or player query).
- `docs/claude/business-logic-guide.md`: business rules layer (crm_rules, status / priority / recall views). Exact SQL of any view: `select pg_get_viewdef('public.<view>', true);`

## Stack & deploy
- React 18 + Vite (JSX), Supabase (Postgres + RLS), Cloudflare Pages auto-deploys on push.
- Repo: github.com/micxone77-VIP/swcrm3 · local `C:\Project\Redesign CRM\swcrm3-main\swcrm3-main`.
- Live Supabase project: **VIP Retention Hub** `utopskwciorvooronpwg`. Marcus's profile id `d76742ce-7a38-425e-b81e-0fd33773c9bb`.
- Check a change with `npx vite build` (and eslint on touched files) before saying it's done.
- Git: Marcus pushes. Before committing/pushing, show him the files changed and ask. Commit message format: short "Area: what changed".
- Sandbox copy (blackpepper889 / vipcrm.pages.dev) is ON HOLD. Work on the live CRM only.

## Hard rules
- Never store full IC numbers (last 4 only) or bank account numbers (mask as `****1234`), not in code, DB, logs or messages. Some BO remarks contain full bank numbers: never copy or repeat them.
- Player-facing WhatsApp text: casual Malaysian "bro" peer tone (same level as the VIP, not "boss/老板"), always open with "I'm {agent} from sureWin VIP department". Brand is **sureWin** (lowercase s) in player messages.
- Every UI string follows the EN/中文 toggle (`L2('en','中文')` / `T()` / `t()` patterns already in each file).
- MY (MYR) and SG (SGD) are different platforms: never add MYR and SGD together; show the right currency per player (`formatMoney(n, currency)`). KH = KHUSD.
- Keep edits small and in place; keep the file's existing line endings (CRLF in many files) and emoji intact.

## Database facts (live)
- `vip_members_all` / `vip_daily_snapshots_all` = base tables, every player incl. Silver/Bronze.
- `vip_members` / `vip_daily_snapshots` = security_invoker VIEWS, Gold+ only (KPIs, churn, Today, queues use these). `SELECT *` views: after adding a column to the `_all` table, recreate the view.
- App helper for all players: `src/lib/allPlayers.js` (`MEMBERS_ALL`, `DAILY_ALL`, `fetchMembersFor`, `findMembersByNames`, `fetchDailyFor`, chunks of 150).
- Never join these tables with `lower(a.username)=lower(b.username)`; it times out under RLS. Use exact `=`.
- In RLS policies wrap role calls: `(select get_my_role())`, `(select auth.uid())`.
- `vip_members_all.last_contact_date` is GENERATED. Never write it (the whole update fails). Write `last_contacted` only if needed; a trigger already syncs it from contact_logs.
- PostgREST caps responses at 1000 rows: paginate with `.range()` (`fetchAll` in `src/lib/depositProfile.js`). Don't put 100+ usernames in one `.in()`.
- Daily CSV: each daily row = that day's own figures. Players missing from a day's CSV get zeroed (`ZERO_DAY` in CSVImport). Older data: deposit/withdrawal/GGR only trusted when `monthly_valid_bet > 0`.
- `contact_logs` insert needs: username, tier, channel, outcome, direction, message_summary, host_name, host_id, logged_at, log_month (YYYY-MM, MYT), log_week (`String(Math.ceil(day/7))`). Optional `topic` (e.g. `'upgrade'`), `wa_number_used`, `entered_at` (auto). Triggers: sync last_contacted, close open follow-up/birthday tasks.
- Campaign tables: `campaigns` (impact_cost), `campaign_players` (ch_paid / ch_sent JSON per day), `campaign_media` + storage bucket `campaign-media`, `vip_bonus_txns` (BO bonuses), `department_expenses`.
- RPC `campaign_impact`: comparison group = same currency + tier at enrolment with "before" history; effect is ratio-based (`src/lib/campaignImpact.js`).
- Times are Malaysia time (UTC+8) for log dates and "today".
- Multi-statement DDL can time out: run one statement at a time, test RLS as Marcus with `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated` inside a DO block.

## Business rules (VIP)
- Inactivity: 3 days no deposit = at risk, 7 = churn, 15 = dormant/urgent.
- One status for every page (since 2026-10-21): `compute_vip_status()` → `refresh_days_inactive()` writes `vip_members_all.activity_status` (Active / Resting / At Risk / Churn / Dormant / Unknown), `churn_risk` (LOW = Active+Resting, MEDIUM = At Risk, HIGH = rest) and `days_inactive` (from latest data date). Real deposit day = deposit > 0 AND valid bet > 0. Resting = bet within 2 days, no deposit. Numbers from `crm_rules`. Audit + fix plan: `docs/claude/audit-2026-10-21.md`.
- Unreachable = 3 "Contacted" logs with no reply after.
- Big-loss gift: tracked net loss ≥ 100k; very big losers (~1M) get something new (e.g. latest iPhone Pro Max).
- Upgrade targets (monthly valid bet): Gold→Platinum 2M, Platinum→Diamond 6M, Gold straight to Diamond 8M (same numbers used for SGD).
- Thresholds live in the `crm_rules` table: change numbers there, not in code.

## Pending / open
- ON HOLD until Marcus says "relax the deposit rule": count deposits on no-bet days for dates after the CSV fix (2026-10-20). Example: jaslyn 18 Oct SGD 35,000, 0 bets.
- Unanswered: which of Mia, Marcus01, vip, Test Admin (auto) are real hosts (to hide the rest from host lists).
- Offered, not accepted: automatic Transfer P&L; VIP360 contact-edit popup; Expenses edit form as a popup (currently opens at the top of the page).
- Untracked leftovers in the repo root (`patch-*.cjs`, `Claude outputs/`, `.fuse_hidden*`) are old patch scripts, safe to ignore, don't commit them.
