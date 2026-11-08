-- VIP Transfer applications from the public page (public/vip-transfer.html).
-- Written only by the transfer-application edge function; admins read and review them in Transfer Tracker.
create table public.transfer_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','contacted','approved','rejected')),
  full_name text not null,
  contact_number text not null,
  whatsapp_number text not null,
  email text not null,
  platform_name text not null,
  platform_link text not null,
  current_tier text not null,
  avg_deposit text not null,
  avg_withdrawal text,
  why_us text not null,
  has_account boolean not null,
  member_id text,
  preferred_tier text not null,
  acknowledged_at timestamptz not null,
  proof_tier_path text,
  proof_activity_path text not null,
  proof_identity_path text not null,
  lang text,
  ip_hash text,
  review_notes text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  sheet_synced_at timestamptz,
  sync_error text
);
create index transfer_applications_created_idx on public.transfer_applications (created_at desc);
create index transfer_applications_ip_idx on public.transfer_applications (ip_hash, created_at desc);
alter table public.transfer_applications enable row level security;
create policy transfer_applications_admin_select on public.transfer_applications for select to authenticated using ((select public.get_my_role()) = 'admin');
create policy transfer_applications_admin_update on public.transfer_applications for update to authenticated using ((select public.get_my_role()) = 'admin') with check ((select public.get_my_role()) = 'admin');

-- Google Sheet + email webhook. No policies on purpose: only the edge function (service role) can read it.
create table public.transfer_application_settings (
  id boolean primary key default true check (id),
  webhook_url text,
  webhook_secret text not null default replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')
);
alter table public.transfer_application_settings enable row level security;
insert into public.transfer_application_settings (id) values (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transfer-proofs','transfer-proofs',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','application/pdf']);
create policy transfer_proofs_admin_read on storage.objects for select to authenticated using (bucket_id = 'transfer-proofs' and (select public.get_my_role()) = 'admin');
