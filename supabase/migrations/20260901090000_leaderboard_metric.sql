ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS leaderboard_metric text NOT NULL DEFAULT 'turnover';

UPDATE public.campaigns
SET leaderboard_metric = 'turnover'
WHERE leaderboard_metric IS NULL
   OR leaderboard_metric NOT IN ('turnover', 'deposit', 'turnover_deposit');

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_leaderboard_metric_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_leaderboard_metric_check
  CHECK (leaderboard_metric IN ('turnover', 'deposit', 'turnover_deposit'));

DROP FUNCTION IF EXISTS public.get_portal_campaign_leaderboard(uuid);

CREATE FUNCTION public.get_portal_campaign_leaderboard(p_campaign_id uuid)
RETURNS TABLE(
  campaign_id uuid,
  campaign_name text,
  status text,
  start_date date,
  end_date date,
  top_n integer,
  leaderboard_metric text,
  rank_position bigint,
  username_masked text,
  tier public.vip_tier,
  metric_value numeric,
  turnover_value numeric,
  deposit_value numeric,
  withdrawal_value numeric,
  is_me boolean,
  reward_amount numeric,
  last_updated_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vip_id uuid;
  v_status text;
  v_campaign_type text;
BEGIN
  v_vip_id := public.get_player_vip_member_id();
  IF v_vip_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.status, c.campaign_type
    INTO v_status, v_campaign_type
  FROM public.campaigns c
  WHERE c.id = p_campaign_id;

  IF v_status IS NULL OR lower(coalesce(v_campaign_type, '')) <> 'leaderboard' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.campaign_players cp
    WHERE cp.campaign_id = p_campaign_id
      AND cp.vip_id = v_vip_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH campaign_base AS (
    SELECT c.id,
           c.campaign_name,
           c.status,
           c.start_date,
           c.end_date,
           c.top_n,
           c.min_valid_bet,
           c.min_deposit_lb,
           c.rank_rewards,
           coalesce(c.leaderboard_metric, 'turnover') AS leaderboard_metric
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND lower(coalesce(c.campaign_type, '')) = 'leaderboard'
  ),
  snapshot_perf AS (
    SELECT
      cp.id AS campaign_player_id,
      coalesce(sum(coalesce(s.total_deposit, 0)), 0) AS system_deposit,
      coalesce(sum(coalesce(s.monthly_valid_bet, 0)), 0) AS system_turnover,
      coalesce(sum(coalesce(s.total_withdrawal, 0)), 0) AS system_withdrawal,
      max(s.created_at) AS source_updated_at
    FROM public.campaign_players cp
    JOIN campaign_base c ON c.id = cp.campaign_id
    LEFT JOIN public.vip_daily_snapshots s
      ON lower(s.username) = lower(cp.username)
     AND s.snapshot_date BETWEEN c.start_date AND c.end_date
    GROUP BY cp.id
  ),
  effective AS (
    SELECT
      cp.id,
      cp.campaign_id,
      cp.username,
      cp.tier,
      cp.vip_id,
      cp.rank_position AS settled_rank,
      cp.reward_amount AS settled_reward,
      cp.data_synced_at,
      c.status,
      c.top_n,
      c.min_valid_bet,
      c.min_deposit_lb,
      c.rank_rewards,
      c.leaderboard_metric,
      CASE WHEN lower(c.status) = 'ended'
        THEN coalesce(cp.valid_bet, 0)
        ELSE coalesce(cp.manual_turnover_override, sp.system_turnover, cp.system_turnover, 0)
      END AS turnover_value,
      CASE WHEN lower(c.status) = 'ended'
        THEN coalesce(cp.total_deposit, 0)
        ELSE coalesce(cp.manual_deposit_override, sp.system_deposit, cp.total_deposit, 0)
      END AS deposit_value,
      CASE WHEN lower(c.status) = 'ended'
        THEN coalesce(cp.total_withdrawal, 0)
        ELSE coalesce(cp.manual_withdrawal_override, sp.system_withdrawal, cp.total_withdrawal, 0)
      END AS withdrawal_value,
      coalesce(sp.source_updated_at, cp.data_synced_at) AS source_updated_at
    FROM public.campaign_players cp
    JOIN campaign_base c ON c.id = cp.campaign_id
    LEFT JOIN snapshot_perf sp ON sp.campaign_player_id = cp.id
  ),
  effective_metric AS (
    SELECT e.*,
      CASE
        WHEN e.leaderboard_metric = 'deposit' THEN e.deposit_value
        ELSE e.turnover_value
      END AS ranking_value
    FROM effective e
  ),
  active_ranked AS (
    SELECT e.id,
           row_number() OVER (ORDER BY e.ranking_value DESC, lower(e.username) ASC) AS rn
    FROM effective_metric e
    WHERE lower(e.status) <> 'ended'
      AND (
        (e.leaderboard_metric = 'deposit' AND e.deposit_value >= coalesce(e.min_deposit_lb, 0))
        OR
        (e.leaderboard_metric IN ('turnover', 'turnover_deposit') AND e.turnover_value >= coalesce(e.min_valid_bet, 0))
      )
  ),
  final_rows AS (
    SELECT e.*,
           CASE WHEN lower(e.status) = 'ended' THEN e.settled_rank::bigint ELSE ar.rn END AS effective_rank,
           CASE WHEN lower(e.status) = 'ended' THEN coalesce(e.settled_reward, 0)
                ELSE coalesce((SELECT (x ->> 'amount')::numeric
                               FROM jsonb_array_elements(coalesce(e.rank_rewards, '[]'::jsonb)) x
                               WHERE (x ->> 'rank')::integer = ar.rn::integer
                               LIMIT 1), 0)
           END AS effective_reward
    FROM effective_metric e
    LEFT JOIN active_ranked ar ON ar.id = e.id
  )
  SELECT
    f.campaign_id,
    (SELECT cb.campaign_name FROM campaign_base cb LIMIT 1),
    f.status,
    (SELECT cb.start_date FROM campaign_base cb LIMIT 1),
    (SELECT cb.end_date FROM campaign_base cb LIMIT 1),
    f.top_n,
    f.leaderboard_metric,
    f.effective_rank,
    CASE
      WHEN nullif(trim(f.username), '') IS NULL THEN 'Player'
      WHEN length(trim(f.username)) = 1 THEN '*'
      WHEN length(trim(f.username)) = 2 THEN left(trim(f.username), 1) || '*'
      WHEN length(trim(f.username)) = 3 THEN left(trim(f.username), 1) || '*' || right(trim(f.username), 1)
      WHEN length(trim(f.username)) = 4 THEN left(trim(f.username), 1) || '**' || right(trim(f.username), 1)
      ELSE left(trim(f.username), 2) || repeat('*', greatest(length(trim(f.username)) - 3, 1)) || right(trim(f.username), 1)
    END,
    f.tier,
    CASE WHEN f.leaderboard_metric = 'deposit' THEN f.deposit_value ELSE f.turnover_value END,
    f.turnover_value,
    f.deposit_value,
    f.withdrawal_value,
    f.vip_id = v_vip_id,
    f.effective_reward,
    f.source_updated_at
  FROM final_rows f
  ORDER BY f.effective_rank NULLS LAST, lower(f.username) ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_portal_campaign_leaderboard(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_portal_campaign_leaderboard(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_portal_campaign_leaderboard(uuid) TO authenticated;
