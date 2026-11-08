-- Speed up ai_players (AI chat "Find players"), 2026-11-08.
-- It sums ~490k daily rows (all players, last 30-38 days) and passed the 8s API timeout.
-- Replace the duplicate (username, snapshot_date) index (same as the unique key) with a
-- covering one so the sum is an index-only scan. Diamond list 5.2s -> 0.8s, Sports 10.3s -> 0.7s.
-- Applied live with CONCURRENTLY (no write lock).
create index concurrently if not exists idx_vds_user_date_cover
  on public.vip_daily_snapshots_all (username, snapshot_date)
  include (total_deposit, total_withdrawal, monthly_valid_bet, win_loss, bonus_amount);

drop index concurrently if exists public.idx_vds_user_date;
