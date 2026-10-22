-- Per-player, per-provider activity from the back office "10.3 Provider Report -> Provider Report Detail"
-- export (Merchant SureWin, Region Malaysia, Currency MYR, Wallet Type All, Reporting Period This Month).
-- Loaded by C:\Project\Gaming Report\_tools\upload.mjs with the service role key.
-- One row per player x provider x month. A "This Month" export is month-to-date, so re-uploading a newer
-- file for the same month replaces the figures and moves period_end forward.

CREATE TABLE IF NOT EXISTS public.provider_player_monthly (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_month        date        NOT NULL,          -- first day of the month
  period_start        date        NOT NULL,
  period_end          date        NOT NULL,          -- last day included (month-to-date)
  provider            text        NOT NULL,          -- folder / back office code, e.g. EVO
  username            text        NOT NULL,          -- back office "login" = CRM username
  player_id           text,
  merchant_code       text,
  currency            text        NOT NULL,
  member_group        text,
  vip_grade           text,
  transfer_in_count   integer     NOT NULL DEFAULT 0,
  transfer_in         numeric(18,2) NOT NULL DEFAULT 0,
  transfer_out_count  integer     NOT NULL DEFAULT 0,
  transfer_out        numeric(18,2) NOT NULL DEFAULT 0,
  bet_count           integer     NOT NULL DEFAULT 0,
  turnover            numeric(18,2) NOT NULL DEFAULT 0,
  valid_turnover      numeric(18,2) NOT NULL DEFAULT 0,
  win_loss            numeric(18,2) NOT NULL DEFAULT 0,  -- player's win/loss (negative = player lost)
  bonus               numeric(18,2) NOT NULL DEFAULT 0,
  cancelled_bonus     numeric(18,2) NOT NULL DEFAULT 0,
  rebate              numeric(18,2) NOT NULL DEFAULT 0,
  total_win_loss      numeric(18,2) NOT NULL DEFAULT 0,
  source_file         text,
  imported_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_player_monthly_uniq UNIQUE (period_month, provider, username, currency)
);

CREATE INDEX IF NOT EXISTS provider_player_monthly_username_idx
  ON public.provider_player_monthly (username, period_month);
CREATE INDEX IF NOT EXISTS provider_player_monthly_provider_idx
  ON public.provider_player_monthly (period_month, provider);

-- One row per uploaded CSV, so you can see what has been loaded and when.
CREATE TABLE IF NOT EXISTS public.provider_report_uploads (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_name     text        NOT NULL UNIQUE,
  provider      text        NOT NULL,
  period_month  date        NOT NULL,
  period_start  date        NOT NULL,
  period_end    date        NOT NULL,
  row_count     integer     NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

-- CRM users read; only the upload script (service role, bypasses RLS) writes.
ALTER TABLE public.provider_player_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_report_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_role_read_provider_player_monthly ON public.provider_player_monthly;
CREATE POLICY crm_role_read_provider_player_monthly ON public.provider_player_monthly
  FOR SELECT TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['admin'::user_role, 'host'::user_role, 'readonly'::user_role]));

DROP POLICY IF EXISTS crm_role_read_provider_report_uploads ON public.provider_report_uploads;
CREATE POLICY crm_role_read_provider_report_uploads ON public.provider_report_uploads
  FOR SELECT TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['admin'::user_role, 'host'::user_role, 'readonly'::user_role]));
