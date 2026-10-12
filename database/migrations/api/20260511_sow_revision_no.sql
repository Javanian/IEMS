BEGIN;

ALTER TABLE public.sow
  ADD COLUMN IF NOT EXISTS revision_no INTEGER NOT NULL DEFAULT 0;

UPDATE public.sow
SET revision_no = 0
WHERE revision_no IS NULL;

COMMIT;
