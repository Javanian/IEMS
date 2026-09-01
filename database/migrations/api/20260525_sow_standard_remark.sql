BEGIN;

ALTER TABLE public.sow_standard
  ADD COLUMN IF NOT EXISTS remark text;

COMMIT;
