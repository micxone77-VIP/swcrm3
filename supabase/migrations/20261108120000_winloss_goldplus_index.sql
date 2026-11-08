-- Speed up v_vip_winloss_recent (bell + Alerts big win/loss list), 2026-11-08.
-- It read all ~559k daily rows (incl. Silver/Bronze) and passed the 8s API timeout (HTTP 500).
-- Partial covering index on Gold+ rows only (same filter as the vip_daily_snapshots view):
-- index-only scan, 5.3s -> 0.4s. Applied live with CONCURRENTLY (no write lock).
create index concurrently if not exists idx_vds_goldplus_winloss
  on public.vip_daily_snapshots_all (username, snapshot_date)
  include (win_loss, total_deposit, total_withdrawal, monthly_valid_bet)
  where (tier is null or tier <> all (array['SILVER'::text, 'BRONZE'::text]));
