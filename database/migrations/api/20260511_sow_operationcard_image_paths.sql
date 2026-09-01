BEGIN;

CREATE TABLE IF NOT EXISTS public.sow_operationcard (
  id BIGSERIAL PRIMARY KEY,
  sow_standard_id INTEGER,
  card_key TEXT,
  order_no TEXT,
  operation_no INTEGER,
  revision_no TEXT NOT NULL DEFAULT 'Original',
  image_path TEXT,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS sow_standard_id INTEGER;
ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS card_key TEXT;
ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS order_no TEXT;
ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS operation_no INTEGER;
ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS revision_no TEXT NOT NULL DEFAULT 'Original';
ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sow_operationcard'
      AND column_name = 'images'
      AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE public.sow_operationcard
      ALTER COLUMN images TYPE JSONB
      USING CASE
        WHEN images IS NULL OR btrim(images::text) = '' THEN '[]'::jsonb
        WHEN left(btrim(images::text), 1) IN ('[', '{') THEN images::jsonb
        ELSE jsonb_build_array(jsonb_build_object('src', images::text))
      END;
  END IF;
END $$;
ALTER TABLE public.sow_operationcard ALTER COLUMN images SET DEFAULT '[]'::jsonb;
ALTER TABLE public.sow_operationcard ALTER COLUMN images SET NOT NULL;
ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'sow_operationcard'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
      ) = ARRAY['sow_standard_id']
  LOOP
    EXECUTE format('ALTER TABLE public.sow_operationcard DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sow_operationcard_standard_revision
  ON public.sow_operationcard (sow_standard_id, revision_no);

CREATE INDEX IF NOT EXISTS idx_sow_operationcard_order_operation_revision
  ON public.sow_operationcard (order_no, operation_no, revision_no);

COMMIT;
