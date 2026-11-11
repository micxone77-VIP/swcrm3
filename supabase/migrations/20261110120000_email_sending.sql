-- Email from the CRM (2026-11-10): sent through the surewinworld.com mail server by the
-- send-email edge function. Players can opt out with the link in every email (email-unsubscribe).

-- 1. Contact Log channel for emails
alter type public.contact_channel add value if not exists 'Email';

-- 2. Every email the CRM tries to send (written only by the edge function, service role)
create table if not exists public.email_logs (
  id          uuid primary key default gen_random_uuid(),
  username    text,
  to_email    text,
  subject     text,
  body        text,
  status      text not null check (status in ('sent', 'failed', 'skipped')),
  reason      text,
  sent_by     uuid references public.profiles(id),
  sender_name text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_email_logs_created on public.email_logs (created_at desc);
create index if not exists idx_email_logs_username on public.email_logs (username);
alter table public.email_logs enable row level security;
create policy email_logs_select on public.email_logs for select to authenticated
  using ((select get_my_role()) = any (array['admin'::user_role, 'readonly'::user_role]) or sent_by = (select auth.uid()));

-- 3. Players who clicked "unsubscribe" (never emailed again; an admin can remove the row)
create table if not exists public.email_unsubscribes (
  email           text primary key,
  username        text,
  unsubscribed_at timestamptz not null default now()
);
alter table public.email_unsubscribes enable row level security;
create policy email_unsub_select on public.email_unsubscribes for select to authenticated
  using ((select get_my_role()) = any (array['admin'::user_role, 'readonly'::user_role]));
create policy email_unsub_delete on public.email_unsubscribes for delete to authenticated
  using ((select get_my_role()) = 'admin'::user_role);

-- 4. Shared hosting caps sending per hour: the edge function stops at this number
insert into public.crm_rules (rule_key, value, unit, category, description)
values ('email_hourly_limit', 100, 'emails', 'email', 'Max emails the CRM sends per hour (mail server limit on shared hosting)')
on conflict (rule_key) do nothing;
