-- Security lock-down (27 Nov 2026).
-- Before: some tables let anyone with the website's public key (no login) read / change / delete rows,
-- and many "authenticated" rules let player-portal players (same "authenticated" role as staff) read and
-- change staff data. After: these tables are staff only (anyone with a profiles row: admin / host /
-- readonly, exactly who could use them before minus players and strangers). Service role and cron jobs
-- are unaffected (they skip RLS).
-- NOTE: the old player-portal lucky-spin.html page (last used 16 Sep 2026) wrote vip_campaign_* with the
-- public key and stops working; it needs a safe rebuild before it is used again.

-- 1. Helper used by functions: stop logged-out callers and logged-in non-staff (players).
create or replace function public.require_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or auth.role() is null then
    return;                                   -- server, cron, triggers run by the database itself
  end if;
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;
revoke all on function public.require_staff() from public, anon;
grant execute on function public.require_staff() to authenticated, service_role;

-- 2. Tables open to strangers (anon) -> staff only.
alter policy "public write - chest"    on public.crown_league_chest_results    to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "public write - dividend" on public.crown_league_dividend_records to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "public write - players"  on public.crown_league_players          to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "public read - state"     on public.crown_league_state            to authenticated using ((select public.get_my_role()) is not null);
alter policy "authenticated write - state" on public.crown_league_state        to authenticated with check ((select public.get_my_role()) is not null);
alter policy "allow_all"               on public.player_gaming_labels          to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "vip_admin_full_codes"    on public.vip_campaign_codes            to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "vip_admin_full_prizes"   on public.vip_campaign_prizes           to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "vip_admin_full_campaigns" on public.vip_campaigns                to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "vip_admin_update_records" on public.vip_campaign_records         to authenticated using ((select public.get_my_role()) is not null);
alter policy "vip_player_insert_records" on public.vip_campaign_records        to authenticated with check ((select public.get_my_role()) is not null);
alter policy "vip_player_read_records" on public.vip_campaign_records          to authenticated using ((select public.get_my_role()) is not null);
alter policy "bday_select"             on public.birthday_engine               to authenticated using ((select public.get_my_role()) is not null);

-- 3. "Any logged-in user" rules (includes players) -> staff only.
alter policy "authenticated full access" on public.affiliate_escalations using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "authenticated read"        on public.app_settings          using ((select public.get_my_role()) is not null);
alter policy "authenticated write"       on public.app_settings          using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "authenticated users can select contacts" on public.campaign_player_contacts using ((select public.get_my_role()) is not null);
alter policy "authenticated users can update contacts" on public.campaign_player_contacts using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "authenticated users can delete contacts" on public.campaign_player_contacts using ((select public.get_my_role()) is not null);
alter policy "authenticated users can insert contacts" on public.campaign_player_contacts with check ((select public.get_my_role()) is not null);
alter policy "crm_rules_read"            on public.crm_rules             using ((select public.get_my_role()) is not null);
alter policy "read all"                  on public.email_templates       using ((select public.get_my_role()) is not null);
alter policy "Allow authenticated full access" on public.gift_logs           to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "Allow authenticated full access" on public.potential_players   to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "Allow authenticated full access" on public.potential_snapshots to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "Allow authenticated full access" on public.upgrade_thresholds  to authenticated using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "provider_categories_read"  on public.provider_categories   using ((select public.get_my_role()) is not null);
alter policy "allow_authenticated_read"  on public.provider_player_stats using ((select public.get_my_role()) is not null);
alter policy "retention_churn_snapshots_select" on public.retention_churn_snapshots using ((select public.get_my_role()) is not null);
alter policy "retention_churn_snapshots_write"  on public.retention_churn_snapshots using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "auth_all_upgrade_challenges"  on public.upgrade_challenges    using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "auth_users_campaign_deposits" on public.vip_campaign_deposits using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "auth_users_campaign_members"  on public.vip_campaign_members  using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "authenticated full access"    on public.vip_deposit_logs      using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "Authenticated users can insert monthly stats" on public.vip_monthly_stats with check ((select public.get_my_role()) is not null);
alter policy "Authenticated users can update monthly stats" on public.vip_monthly_stats using ((select public.get_my_role()) is not null);
alter policy "Authenticated users can read monthly stats"   on public.vip_monthly_stats using ((select public.get_my_role()) is not null);
alter policy "authenticated full access"    on public.vip_profiles          using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);
alter policy "Authenticated can manage wa_numbers" on public.wa_numbers     using ((select public.get_my_role()) is not null) with check ((select public.get_my_role()) is not null);

-- 4. Views that ran as their owner (skipping the table rules): run as the person asking instead.
alter view public.player_provider_summary      set (security_invoker = true);
alter view public.provider_monthly_performance set (security_invoker = true);
alter view public.vip_monthly_totals           set (security_invoker = true);
revoke select on public.player_provider_summary, public.provider_monthly_performance, public.vip_monthly_totals from anon;

-- 5. Staff-only functions that players could call: add the staff check at the start.
do $$
declare f regprocedure; def text;
begin
  foreach f in array array[
    'public.set_campaign_payout_status(uuid,text)'::regprocedure,
    'public.settle_leaderboard_campaign(uuid)'::regprocedure,
    'public.refresh_campaign_progress(text[])'::regprocedure,
    'public.sync_campaign_player_performance(uuid,text)'::regprocedure,
    'public.sync_campaign_player_performance(uuid)'::regprocedure]
  loop
    def := pg_get_functiondef(f);
    if def ~* 'require_staff' then continue; end if;
    def := regexp_replace(def, '(\$function\$.*?\mbegin\M)', '\1 perform public.require_staff();', 'i');
    execute def;
  end loop;
end $$;

create or replace function public.get_kpi4_count(p_month text, p_host_id uuid default null::uuid)
returns integer language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select count(distinct lower(username))::integer
  from contact_logs
  where log_month = p_month
    and (p_host_id is null or host_id = p_host_id)
    and (select public.get_my_role()) is not null
$function$;

create or replace function public.get_last_active_dates(days_back integer default 90)
returns table(username text, last_active_date date) language sql stable security definer set search_path to 'public'
as $function$
  select s.username, max(s.snapshot_date)::date as last_active_date
  from vip_daily_snapshots s
  where s.snapshot_date >= (current_date - days_back)
    and (s.monthly_valid_bet > 0 or s.total_deposit > 0)
    and (select public.get_my_role()) is not null
  group by s.username;
$function$;

-- get_upcoming_birthdays: same body, plus the staff check.
do $$
declare def text := pg_get_functiondef('public.get_upcoming_birthdays(integer)'::regprocedure);
begin
  if def !~* 'get_my_role' then
    def := regexp_replace(def, '(\)\s*between 0 and days_ahead)', '\1 and (select public.get_my_role()) is not null', 'i');
    execute def;
  end if;
end $$;

-- 6. Small warnings from the Supabase security check.
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.mask_long_numbers set search_path = public, pg_temp;
