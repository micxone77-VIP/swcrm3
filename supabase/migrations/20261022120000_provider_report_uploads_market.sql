-- Gaming Report files now live in C:\Project\Gaming Report\<Malaysia|Singapore>\<PROVIDER>\.
-- The upload log records the market and the file's path relative to Gaming Report.
ALTER TABLE public.provider_report_uploads ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'MY';

UPDATE public.provider_report_uploads
SET file_name = 'Malaysia/' || regexp_replace(provider, '_\d+$', '') || '/' || file_name
WHERE market = 'MY' AND file_name NOT LIKE '%/%';
