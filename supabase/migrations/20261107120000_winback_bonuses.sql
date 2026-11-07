-- Win-back bonus tracker (Churn Urgency, 2026-11-07)
-- Hosts record each bonus given to a Churn (7-14 days) or Dormant (15+ days) VIP.
-- v_winback_results works out the result from the daily import: came back and deposited, bonus only, no response.
-- Real deposit day = deposit > 0 AND valid bet > 0 (same rule as the rest of the CRM).

create table if not exists public.winback_bonuses (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  vip_id uuid,
  tier text,
  currency text not null default 'MYR',
  stage text not null check (stage in ('Churn','Dormant')),
  days_inactive int,
  last_deposit_date date,
  bonus_type text not null default 'direct_credit' check (bonus_type in ('direct_credit','deposit_bonus')),
  amount numeric not null check (amount > 0),
  given_on date not null default ((now() at time zone 'Asia/Kuala_Lumpur')::date),
  host_name text,
  host_id uuid default auth.uid(),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists winback_bonuses_given_on_idx on public.winback_bonuses (given_on);
create index if not exists winback_bonuses_username_idx on public.winback_bonuses (username, given_on);

alter table public.winback_bonuses enable row level security;

create policy winback_bonuses_read on public.winback_bonuses for select to authenticated
  using ((select get_my_role()) = any (array['admin'::user_role, 'host'::user_role, 'readonly'::user_role]));
create policy winback_bonuses_insert on public.winback_bonuses for insert to authenticated
  with check ((select get_my_role()) = any (array['admin'::user_role, 'host'::user_role]));
create policy winback_bonuses_update on public.winback_bonuses for update to authenticated
  using ((select get_my_role()) = any (array['admin'::user_role, 'host'::user_role]))
  with check ((select get_my_role()) = any (array['admin'::user_role, 'host'::user_role]));
create policy winback_bonuses_delete on public.winback_bonuses for delete to authenticated
  using ((select get_my_role()) = 'admin'::user_role);

insert into public.crm_rules (rule_key, value, unit, category, description) values
  ('winback_window_days', 7, 'days', 'winback', 'Win-back bonus: days after the bonus to count a real deposit as "came back"'),
  ('winback_retain_days', 30, 'days', 'winback', 'Win-back bonus: days after the bonus to check a second deposit day ("stayed active") and total deposit / NGR')
on conflict (rule_key) do nothing;

create or replace view public.v_winback_results with (security_invoker = true) as
with r as (
  select coalesce((select value::int from crm_rules where rule_key = 'winback_window_days'), 7) as win,
         coalesce((select value::int from crm_rules where rule_key = 'winback_retain_days'), 30) as ret,
         (select max(snapshot_date) from vip_daily_snapshots_all) as data_through
)
select b.*,
  r.win as window_days, r.ret as retain_days, r.data_through,
  (b.given_on + r.win) as window_end,
  (r.data_through >= b.given_on + r.win) as window_done,
  d.first_deposit_date,
  (d.first_deposit_date - b.given_on) as days_to_deposit,
  coalesce(d.deposit_window, 0) as deposit_window,
  coalesce(d.bet_window, 0) as bet_window,
  coalesce(d.deposit_days_retain, 0) as deposit_days_retain,
  coalesce(d.deposit_retain, 0) as deposit_retain,
  coalesce(d.withdrawal_retain, 0) as withdrawal_retain,
  coalesce(d.bet_retain, 0) as bet_retain,
  coalesce(d.player_loss_retain, 0) as player_loss_retain,
  coalesce(d.bonus_retain, 0) as bonus_retain,
  coalesce(d.rebate_retain, 0) as rebate_retain,
  coalesce(d.bonus_seen, 0) as bonus_seen,
  case
    when d.first_deposit_date is not null then 'deposited'
    when r.data_through >= b.given_on + r.win then case when coalesce(d.bet_window, 0) > 0 then 'bonus_only' else 'no_response' end
    else 'waiting'
  end as result,
  (coalesce(d.deposit_days_retain, 0) >= 2) as stayed_active
from public.winback_bonuses b
cross join r
left join lateral (
  select
    min(s.snapshot_date) filter (where s.snapshot_date <= b.given_on + r.win and s.total_deposit > 0 and s.monthly_valid_bet > 0) as first_deposit_date,
    sum(s.total_deposit) filter (where s.snapshot_date <= b.given_on + r.win and s.monthly_valid_bet > 0) as deposit_window,
    sum(s.monthly_valid_bet) filter (where s.snapshot_date <= b.given_on + r.win) as bet_window,
    count(*) filter (where s.total_deposit > 0 and s.monthly_valid_bet > 0) as deposit_days_retain,
    sum(s.total_deposit) filter (where s.monthly_valid_bet > 0) as deposit_retain,
    sum(s.total_withdrawal) filter (where s.monthly_valid_bet > 0) as withdrawal_retain,
    sum(s.monthly_valid_bet) as bet_retain,
    sum(-s.win_loss) filter (where s.monthly_valid_bet > 0) as player_loss_retain,
    sum(s.bonus_amount) as bonus_retain,
    sum(s.total_rebate) as rebate_retain,
    sum(s.bonus_amount) filter (where s.snapshot_date <= b.given_on + 1) as bonus_seen
  from public.vip_daily_snapshots_all s
  where s.username = b.username
    and s.snapshot_date >= b.given_on
    and s.snapshot_date <= b.given_on + r.ret
) d on true;

grant select on public.v_winback_results to authenticated;
grant select, insert, update, delete on public.winback_bonuses to authenticated;
revoke all on public.winback_bonuses from anon;
revoke all on public.v_winback_results from anon;
