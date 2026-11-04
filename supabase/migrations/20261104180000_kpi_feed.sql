-- KPI feed for the other hub: saved monthly totals + the hash of the hub's key. No player data is stored here.
-- RLS on with no policies: only the kpi-feed Edge Function (service role) can read or write these tables.

create table if not exists public.kpi_feed_snapshots (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  data_date date not null,
  payload jsonb not null,
  calculated_at timestamptz not null default now()
);
alter table public.kpi_feed_snapshots enable row level security;

create table if not exists public.kpi_feed_settings (
  id int primary key default 1 check (id = 1),
  api_key_hash text,
  last_fetched_at timestamptz
);
alter table public.kpi_feed_settings enable row level security;

insert into public.kpi_feed_settings (id) values (1) on conflict (id) do nothing;
