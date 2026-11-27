-- Down days: days when a market's platform was down, so nobody could deposit or bet.
-- compute_vip_status() leaves these days out of days_inactive (and the Resting check), so an outage
-- does not push players to At Risk / Churn / Dormant. One row per day per currency (MYR, SGD, KHUSD).
-- First rows (Marcus, 2026-11-27): sureWin 1.0 down 20–21 Nov for MY (2.0 took over from 22 Nov,
-- already counted through sw2_daily) and 20–24 Nov for SG (no 2.0 for SG).

create table public.crm_down_days (
  day        date not null,
  currency   text not null check (currency in ('MYR', 'SGD', 'KHUSD')),
  note       text,
  created_at timestamptz not null default now(),
  primary key (day, currency)
);

alter table public.crm_down_days enable row level security;

create policy crm_down_days_read on public.crm_down_days for select to authenticated
  using ((select get_my_role()) = any (array['admin'::user_role, 'host'::user_role, 'readonly'::user_role]));
create policy crm_down_days_write on public.crm_down_days for all to authenticated
  using ((select get_my_role()) = 'admin'::user_role)
  with check ((select get_my_role()) = 'admin'::user_role);

revoke all on public.crm_down_days from anon;

insert into public.crm_down_days (day, currency, note) values
  ('2026-11-20', 'MYR', 'sureWin 1.0 down; 2.0 not live yet'),
  ('2026-11-21', 'MYR', 'sureWin 1.0 down; 2.0 not live yet'),
  ('2026-11-20', 'SGD', 'sureWin down'),
  ('2026-11-21', 'SGD', 'sureWin down'),
  ('2026-11-22', 'SGD', 'sureWin down'),
  ('2026-11-23', 'SGD', 'sureWin down'),
  ('2026-11-24', 'SGD', 'sureWin down');

CREATE OR REPLACE FUNCTION public.compute_vip_status()
 RETURNS TABLE(id uuid, username text, base_date date, last_active_date date, last_deposit_date date, days_inactive integer, status text, churn_risk text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- One status per player, from crm_rules (fix 1, 2026-10-21).
  -- Real deposit day = deposit > 0 AND valid bet > 0. Active day = valid bet > 0.
  -- Days are counted from the latest data date (base_date), not the calendar date.
  -- 2026-11-24: sureWin 2.0 (MY only). sw2_members (all-time file) + sw2_daily (one file per day), matched by v1_username.
  -- A deposit / bet on 2.0 counts too; for MYR players the base date is the latest of the 1.0 data date and the 2.0 dates.
  -- 2026-11-27: days in crm_down_days for the player's currency (platform down) are not counted as inactive days.
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
           GREATEST(COALESCE(g.last_deposit_date, m.last_deposit_date), CASE WHEN m.currency = 'MYR' THEN t.dep2 END) AS last_deposit_date
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
         CASE z.status WHEN 'Active' THEN 'LOW' WHEN 'Resting' THEN 'LOW' WHEN 'At Risk' THEN 'MEDIUM' ELSE 'HIGH' END
    FROM z;
$function$;
