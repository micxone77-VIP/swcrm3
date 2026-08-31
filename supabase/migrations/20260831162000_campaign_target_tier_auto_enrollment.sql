create or replace function public.sync_campaign_auto_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tiers vip_tier[];
begin
  tiers := coalesce(new.auto_enroll_tiers, new.target_tier);
  if coalesce(array_length(tiers, 1), 0) = 0 then
    return new;
  end if;

  insert into public.campaign_players (
    campaign_id, vip_id, username, tier, player_name, whatsapp,
    total_deposit, campaign_period_deposit, converted, payout_status,
    status, enrollment_source, added_at, enrolled_at
  )
  select
    new.id, v.id, v.username, v.tier, v.full_name, coalesce(v.whatsapp, v.phone),
    0, 0, false, 'pending', 'enrolled', 'tier', now(), now()
  from public.vip_members v
  where coalesce(v.is_excluded, false) = false
    and v.tier = any(tiers)
    and nullif(trim(v.username), '') is not null
  on conflict (campaign_id, username) do update
    set enrollment_source = case
      when public.campaign_players.enrollment_source in ('manual', 'both') then 'both'
      else 'tier'
    end,
    vip_id = coalesce(public.campaign_players.vip_id, excluded.vip_id),
    tier = excluded.tier,
    player_name = coalesce(public.campaign_players.player_name, excluded.player_name),
    whatsapp = coalesce(public.campaign_players.whatsapp, excluded.whatsapp);

  return new;
end;
$$;

revoke all on function public.sync_campaign_auto_enrollment() from public;
drop trigger if exists campaigns_auto_enroll_tiers on public.campaigns;
create trigger campaigns_auto_enroll_tiers
after insert or update of target_tier, auto_enroll_tiers on public.campaigns
for each row
execute function public.sync_campaign_auto_enrollment();
