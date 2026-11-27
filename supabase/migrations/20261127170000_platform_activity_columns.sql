-- Where is each player playing? (27 Nov 2026)
-- The status (Active / At Risk / Churn ...) already counts deposits on both sureWin 1.0 and 2.0.
-- These columns keep the two platforms apart so the CRM can show "1.0 only / 2.0 only / both / nowhere".
--   v1_last_deposit_date  last real deposit day on 1.0 (deposit > 0 and valid bet > 0)
--   v2_last_deposit_date  last deposit day on 2.0 (MY only)
--   v2_last_active_date   last day with a bet or deposit on 2.0
--   v2_joined             has a 2.0 account matched to this 1.0 player
-- Filled by refresh_days_inactive() (runs after every import / 2.0 upload).

alter table public.vip_members_all
  add column if not exists v1_last_deposit_date date,
  add column if not exists v2_last_deposit_date date,
  add column if not exists v2_last_active_date  date,
  add column if not exists v2_joined boolean not null default false;

drop function if exists public.compute_vip_status();
create function public.compute_vip_status()
 returns table(id uuid, username text, base_date date, last_active_date date, last_deposit_date date, days_inactive integer, status text, churn_risk text,
               v1_last_deposit_date date, v2_last_deposit_date date, v2_last_active_date date, v2_joined boolean)
 language sql
 stable
 set search_path to 'public'
as $function$
  -- One status per player, from crm_rules (fix 1, 2026-10-21).
  -- Real deposit day = deposit > 0 AND valid bet > 0. Active day = valid bet > 0.
  -- Days are counted from the latest data date (base_date), not the calendar date.
  -- 2026-11-24: sureWin 2.0 (MY only). sw2_members (all-time file) + sw2_daily (one file per day), matched by v1_username.
  -- A deposit / bet on 2.0 counts too; for MYR players the base date is the latest of the 1.0 data date and the 2.0 dates.
  -- 2026-11-27: days in crm_down_days for the player's currency (platform down) are not counted as inactive days.
  -- 2026-11-27: also returns the 1.0 and 2.0 dates separately (where is the player playing).
  WITH b AS (SELECT max(snapshot_date) AS base_date FROM vip_daily_snapshots_all),
  b2 AS (SELECT GREATEST((SELECT max(snapshot_at)::date FROM sw2_members), (SELECT max(snapshot_date) FROM sw2_daily)) AS sw2_date),
  agg AS (
    SELECT s.username,
           max(s.snapshot_date) FILTER (WHERE s.monthly_valid_bet > 0) AS last_active_date,
           max(s.snapshot_date) FILTER (WHERE s.monthly_valid_bet > 0 AND s.total_deposit > 0) AS last_deposit_date
      FROM vip_daily_snapshots_all s
     GROUP BY s.username
  ),
  s2 AS (
    SELECT v1_username, max(dep2) AS dep2, max(act2) AS act2 FROM (
      SELECT w.v1_username,
             max(w.last_deposit_at::date) FILTER (WHERE w.total_deposit > 0) AS dep2,
             max(w.last_active_at::date)  FILTER (WHERE w.valid_bet > 0)     AS act2
        FROM sw2_members w WHERE w.v1_username IS NOT NULL GROUP BY w.v1_username
      UNION ALL
      SELECT d.v1_username,
             max(d.snapshot_date) FILTER (WHERE d.total_deposit > 0 AND d.valid_bet > 0),
             max(d.snapshot_date) FILTER (WHERE d.valid_bet > 0)
        FROM sw2_daily d WHERE d.v1_username IS NOT NULL GROUP BY d.v1_username
    ) u GROUP BY v1_username
  ),
  x AS (
    SELECT m.id, m.username, m.currency,
           CASE WHEN m.currency = 'MYR' THEN GREATEST(b.base_date, b2.sw2_date) ELSE b.base_date END AS base_date,
           GREATEST(g.last_active_date, CASE WHEN m.currency = 'MYR' THEN GREATEST(t.act2, t.dep2) END) AS last_active_date,
           GREATEST(COALESCE(g.last_deposit_date, m.last_deposit_date), CASE WHEN m.currency = 'MYR' THEN t.dep2 END) AS last_deposit_date,
           COALESCE(g.last_deposit_date, m.v1_last_deposit_date) AS v1_last_deposit_date,
           CASE WHEN m.currency = 'MYR' THEN t.dep2 END AS v2_last_deposit_date,
           CASE WHEN m.currency = 'MYR' THEN GREATEST(t.act2, t.dep2) END AS v2_last_active_date,
           (m.currency = 'MYR' AND t.v1_username IS NOT NULL) AS v2_joined
      FROM vip_members_all m CROSS JOIN b CROSS JOIN b2
      LEFT JOIN agg g ON g.username = m.username
      LEFT JOIN s2 t ON t.v1_username = m.username
     WHERE m.is_excluded = false
  ),
  y AS (
    SELECT x.*,
           (x.base_date - x.last_deposit_date)
             - (SELECT count(*) FROM crm_down_days dd WHERE dd.currency = x.currency AND dd.day > x.last_deposit_date AND dd.day <= x.base_date)::int AS d_dep,
           (x.base_date - x.last_active_date)
             - (SELECT count(*) FROM crm_down_days dd WHERE dd.currency = x.currency AND dd.day > x.last_active_date AND dd.day <= x.base_date)::int AS d_act
      FROM x
  ),
  z AS (
    SELECT y.*, CASE
        WHEN y.last_deposit_date IS NULL                           THEN 'Unknown'
        WHEN y.d_dep <= crm_rule('active_days')                    THEN 'Active'
        WHEN y.d_act IS NOT NULL AND y.d_act <= crm_rule('balance_play_days') THEN 'Resting'
        WHEN y.d_dep <  crm_rule('churn_days')                     THEN 'At Risk'
        WHEN y.d_dep <  crm_rule('dormant_days')                   THEN 'Churn'
        ELSE 'Dormant' END AS status
      FROM y
  )
  SELECT z.id, z.username, z.base_date, z.last_active_date, z.last_deposit_date, z.d_dep::int, z.status,
         CASE z.status WHEN 'Active' THEN 'LOW' WHEN 'Resting' THEN 'LOW' WHEN 'At Risk' THEN 'MEDIUM' ELSE 'HIGH' END,
         z.v1_last_deposit_date, z.v2_last_deposit_date, z.v2_last_active_date, z.v2_joined
    FROM z;
$function$;
revoke all on function public.compute_vip_status() from public, anon;
grant execute on function public.compute_vip_status() to authenticated, service_role;

create or replace function public.refresh_days_inactive()
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
BEGIN
  -- One status per player from crm_rules (see compute_vip_status, fix 1 2026-10-21):
  -- Active / Resting (betting, no deposit) / At Risk / Churn / Dormant / Unknown.
  -- churn_risk: Active, Resting = LOW; At Risk = MEDIUM; Churn, Dormant, Unknown = HIGH.
  -- last_bet_date = last day with valid bet > 0 (fix 2).
  -- 2026-11-27: also v1_ / v2_ dates and v2_joined (where is the player playing).
  UPDATE vip_members_all vm
     SET last_deposit_date    = c.last_deposit_date,
         last_bet_date        = c.last_active_date,
         days_inactive        = c.days_inactive,
         activity_status      = c.status::activity_status,
         churn_risk           = c.churn_risk::churn_risk,
         v1_last_deposit_date = c.v1_last_deposit_date,
         v2_last_deposit_date = c.v2_last_deposit_date,
         v2_last_active_date  = c.v2_last_active_date,
         v2_joined            = c.v2_joined,
         updated_at           = now()
    FROM compute_vip_status() c
   WHERE vm.id = c.id
     AND (vm.last_deposit_date IS DISTINCT FROM c.last_deposit_date
       OR vm.last_bet_date     IS DISTINCT FROM c.last_active_date
       OR vm.days_inactive     IS DISTINCT FROM c.days_inactive
       OR vm.activity_status::text IS DISTINCT FROM c.status
       OR vm.churn_risk::text      IS DISTINCT FROM c.churn_risk
       OR vm.v1_last_deposit_date IS DISTINCT FROM c.v1_last_deposit_date
       OR vm.v2_last_deposit_date IS DISTINCT FROM c.v2_last_deposit_date
       OR vm.v2_last_active_date  IS DISTINCT FROM c.v2_last_active_date
       OR vm.v2_joined            IS DISTINCT FROM c.v2_joined);

  -- Daily host task list (fix 3): runs after every import / scheduled refresh, tops up to the cap.
  PERFORM generate_followup_tasks(true);  -- follow-up dates due today (fix 4)
  PERFORM generate_daily_tasks(true);
END;
$function$;
