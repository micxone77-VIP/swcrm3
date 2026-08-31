alter table public.campaign_players
  add column if not exists system_deposit numeric not null default 0,
  add column if not exists system_turnover numeric not null default 0,
  add column if not exists system_withdrawal numeric not null default 0,
  add column if not exists manual_deposit_override numeric,
  add column if not exists manual_turnover_override numeric,
  add column if not exists manual_withdrawal_override numeric,
  add column if not exists override_reason text,
  add column if not exists override_by uuid,
  add column if not exists override_at timestamptz,
  add column if not exists data_synced_at timestamptz;

create index if not exists campaign_players_performance_sync_idx
  on public.campaign_players (campaign_id, username);

create or replace function public.sync_campaign_player_performance(p_campaign_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cp record;
  c record;
  end_snap record;
  base_snap record;
  new_deposit numeric := 0;
  new_withdrawal numeric := 0;
  new_turnover numeric := 0;
  month_cursor date;
  month_end date;
  current_mtd numeric;
  baseline_mtd numeric;
  old_system_deposit numeric;
  old_system_turnover numeric;
  old_system_withdrawal numeric;
  final_deposit numeric;
  final_turnover numeric;
  final_withdrawal numeric;
  keep_manual_deposit numeric;
  keep_manual_turnover numeric;
  keep_manual_withdrawal numeric;
begin
  select * into cp from public.campaign_players where id = p_campaign_player_id;
  if not found then return; end if;

  select * into c from public.campaigns where id = cp.campaign_id;
  if not found then return; end if;

  old_system_deposit := coalesce(cp.system_deposit, 0);
  old_system_turnover := coalesce(cp.system_turnover, 0);
  old_system_withdrawal := coalesce(cp.system_withdrawal, 0);

  select * into end_snap
  from public.vip_daily_snapshots s
  where s.snapshot_date <= c.end_date
    and s.snapshot_date >= c.start_date
    and (s.vip_id = cp.vip_id or (cp.vip_id is null and s.username = cp.username))
  order by s.snapshot_date desc, s.created_at desc
  limit 1;

  select * into base_snap
  from public.vip_daily_snapshots s
  where s.snapshot_date < c.start_date
    and (s.vip_id = cp.vip_id or (cp.vip_id is null and s.username = cp.username))
  order by s.snapshot_date desc, s.created_at desc
  limit 1;

  if end_snap is not null then
    new_deposit := greatest(0, coalesce(end_snap.total_deposit, 0) - coalesce(base_snap.total_deposit, 0));
    new_withdrawal := greatest(0, coalesce(end_snap.total_withdrawal, 0) - coalesce(base_snap.total_withdrawal, 0));
  end if;

  month_cursor := date_trunc('month', c.start_date)::date;
  while month_cursor <= c.end_date loop
    month_end := least((month_cursor + interval '1 month - 1 day')::date, c.end_date);

    select coalesce(s.monthly_valid_bet, 0) into current_mtd
    from public.vip_daily_snapshots s
    where s.snapshot_date >= month_cursor
      and s.snapshot_date <= month_end
      and (s.vip_id = cp.vip_id or (cp.vip_id is null and s.username = cp.username))
    order by s.snapshot_date desc, s.created_at desc
    limit 1;

    if current_mtd is not null then
      if month_cursor = date_trunc('month', c.start_date)::date then
        select coalesce(s.monthly_valid_bet, 0) into baseline_mtd
        from public.vip_daily_snapshots s
        where s.snapshot_date < c.start_date
          and s.snapshot_date >= month_cursor
          and (s.vip_id = cp.vip_id or (cp.vip_id is null and s.username = cp.username))
        order by s.snapshot_date desc, s.created_at desc
        limit 1;
        new_turnover := new_turnover + greatest(0, current_mtd - coalesce(baseline_mtd, 0));
      else
        new_turnover := new_turnover + greatest(0, current_mtd);
      end if;
    end if;

    month_cursor := (month_cursor + interval '1 month')::date;
  end loop;

  keep_manual_deposit := cp.manual_deposit_override;
  keep_manual_turnover := cp.manual_turnover_override;
  keep_manual_withdrawal := cp.manual_withdrawal_override;

  if keep_manual_deposit is null and cp.total_deposit is distinct from old_system_deposit then
    keep_manual_deposit := cp.total_deposit;
  end if;
  if keep_manual_turnover is null and cp.valid_bet is distinct from old_system_turnover then
    keep_manual_turnover := cp.valid_bet;
  end if;
  if keep_manual_withdrawal is null and cp.total_withdrawal is distinct from old_system_withdrawal then
    keep_manual_withdrawal := cp.total_withdrawal;
  end if;

  final_deposit := coalesce(keep_manual_deposit, new_deposit);
  final_turnover := coalesce(keep_manual_turnover, new_turnover);
  final_withdrawal := coalesce(keep_manual_withdrawal, new_withdrawal);

  update public.campaign_players
  set system_deposit = new_deposit,
      system_turnover = new_turnover,
      system_withdrawal = new_withdrawal,
      manual_deposit_override = keep_manual_deposit,
      manual_turnover_override = keep_manual_turnover,
      manual_withdrawal_override = keep_manual_withdrawal,
      total_deposit = final_deposit,
      campaign_period_deposit = final_deposit,
      valid_bet = final_turnover,
      total_withdrawal = final_withdrawal,
      override_reason = case
        when keep_manual_deposit is not null or keep_manual_turnover is not null or keep_manual_withdrawal is not null
          then coalesce(cp.override_reason, 'Manual CRM adjustment')
        else null
      end,
      override_by = case
        when keep_manual_deposit is not null or keep_manual_turnover is not null or keep_manual_withdrawal is not null
          then coalesce(cp.override_by, auth.uid())
        else null
      end,
      override_at = case
        when keep_manual_deposit is not null or keep_manual_turnover is not null or keep_manual_withdrawal is not null
          then coalesce(cp.override_at, now())
        else null
      end,
      data_synced_at = now()
  where id = p_campaign_player_id;
end;
$$;

revoke all on function public.sync_campaign_player_performance(uuid) from public;
grant execute on function public.sync_campaign_player_performance(uuid) to authenticated;

create or replace function public.sync_campaign_players_for_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cp_id uuid;
begin
  for cp_id in
    select cp.id
    from public.campaign_players cp
    join public.campaigns c on c.id = cp.campaign_id
    where c.status = 'active'
      and new.snapshot_date between c.start_date and c.end_date
      and (cp.vip_id = new.vip_id or (cp.vip_id is null and cp.username = new.username))
  loop
    perform public.sync_campaign_player_performance(cp_id);
  end loop;
  return new;
end;
$$;

revoke all on function public.sync_campaign_players_for_snapshot() from public;

drop trigger if exists vip_daily_snapshots_campaign_performance on public.vip_daily_snapshots;
create trigger vip_daily_snapshots_campaign_performance
after insert or update of snapshot_date, total_deposit, total_withdrawal, monthly_valid_bet
on public.vip_daily_snapshots
for each row execute function public.sync_campaign_players_for_snapshot();

create or replace function public.sync_campaign_player_after_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_campaign_player_performance(new.id);
  return new;
end;
$$;

revoke all on function public.sync_campaign_player_after_enrollment() from public;

drop trigger if exists campaign_player_initial_performance_sync on public.campaign_players;
create trigger campaign_player_initial_performance_sync
after insert or update of campaign_id, vip_id, username
on public.campaign_players
for each row execute function public.sync_campaign_player_after_enrollment();

-- Backfill all existing campaign enrollments without changing existing manual values.
do $$
declare
  r record;
begin
  for r in select id from public.campaign_players loop
    perform public.sync_campaign_player_performance(r.id);
  end loop;
end;
$$;
