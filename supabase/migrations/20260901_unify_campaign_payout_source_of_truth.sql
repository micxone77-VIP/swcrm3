-- Unified campaign-level payout source of truth.
-- campaign_players.payout_status is authoritative for the player's overall
-- payout state in a campaign. campaign_rewards is a derived Portal ledger.

UPDATE public.campaign_players
SET payout_status = CASE
  WHEN lower(coalesce(payout_status,'')) = 'paid' THEN 'paid'
  ELSE 'pending'
END,
payout_date = CASE
  WHEN lower(coalesce(payout_status,'')) = 'paid' AND payout_date IS NULL THEN now()
  WHEN lower(coalesce(payout_status,'')) <> 'paid' THEN NULL
  ELSE payout_date
END;

ALTER TABLE public.campaign_players
  DROP CONSTRAINT IF EXISTS campaign_players_payout_status_check;

ALTER TABLE public.campaign_players
  ADD CONSTRAINT campaign_players_payout_status_check
  CHECK (payout_status IN ('pending','paid'));

COMMENT ON COLUMN public.campaign_players.payout_status IS
  'AUTHORITATIVE campaign-level payout status. Player Portal reward status is derived from this field.';
COMMENT ON COLUMN public.campaign_players.payout_date IS
  'Authoritative campaign-level payout timestamp. Set when payout_status becomes paid.';

CREATE OR REPLACE FUNCTION public.sync_campaign_reward_payout_from_player()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payout_status IS DISTINCT FROM OLD.payout_status
     OR NEW.payout_date IS DISTINCT FROM OLD.payout_date THEN
    UPDATE public.campaign_rewards
    SET status = NEW.payout_status,
        paid_at = CASE WHEN NEW.payout_status = 'paid'
                       THEN COALESCE(NEW.payout_date, now())
                       ELSE NULL END,
        updated_at = now()
    WHERE campaign_player_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_campaign_reward_payout_from_player
ON public.campaign_players;

CREATE TRIGGER trg_sync_campaign_reward_payout_from_player
AFTER UPDATE OF payout_status, payout_date ON public.campaign_players
FOR EACH ROW
EXECUTE FUNCTION public.sync_campaign_reward_payout_from_player();

-- Backfill the Portal ledger from the authoritative CRM status.
UPDATE public.campaign_rewards cr
SET status = cp.payout_status,
    paid_at = CASE WHEN cp.payout_status = 'paid'
                   THEN COALESCE(cp.payout_date, now())
                   ELSE NULL END,
    updated_at = now()
FROM public.campaign_players cp
WHERE cp.id = cr.campaign_player_id
  AND (cr.status IS DISTINCT FROM cp.payout_status
       OR cr.paid_at IS DISTINCT FROM CASE WHEN cp.payout_status = 'paid'
                                            THEN COALESCE(cp.payout_date, cr.paid_at)
                                            ELSE NULL END);

CREATE OR REPLACE FUNCTION public.set_campaign_payout_status(
  p_campaign_player_id uuid,
  p_status text
)
RETURNS public.campaign_players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.campaign_players;
BEGIN
  IF p_status NOT IN ('pending','paid') THEN
    RAISE EXCEPTION 'Invalid payout status: %. Allowed values: pending, paid', p_status;
  END IF;

  UPDATE public.campaign_players
  SET payout_status = p_status,
      payout_date = CASE WHEN p_status = 'paid' THEN COALESCE(payout_date, now()) ELSE NULL END
  WHERE id = p_campaign_player_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Campaign player not found: %', p_campaign_player_id;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_campaign_payout_status(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_campaign_payout_status(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_campaign_payout_status(uuid,text) TO authenticated;
