
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shift_definition'
      AND column_name = 'date'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shift_definition'
      AND column_name = 'effective_date'
  ) THEN
    ALTER TABLE public.shift_definition RENAME COLUMN "date" TO effective_date;
  END IF;
END $$;

ALTER TABLE public.shift_definition
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shift_definition'
      AND column_name = 'date'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shift_definition'
        AND column_name = 'effective_date'
    ) THEN
      EXECUTE 'UPDATE public.shift_definition SET effective_date = COALESCE(effective_date, "date")';
    END IF;
    ALTER TABLE public.shift_definition DROP COLUMN "date";
  END IF;
END $$;

UPDATE public.shift_definition
SET is_default = true
WHERE effective_date IS NULL
  AND is_default IS DISTINCT FROM true;

ALTER TABLE public.shift_definition
  DROP CONSTRAINT IF EXISTS shift_definition_shift_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_definition_default_code
  ON public.shift_definition (lower(shift_code))
  WHERE is_default = true;

DROP INDEX IF EXISTS public.uq_shift_definition_date_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_definition_effective_date_code
  ON public.shift_definition (lower(shift_code), effective_date)
  WHERE is_default = false AND effective_date IS NOT NULL;

DROP INDEX IF EXISTS public.idx_shift_definition_date_active;
CREATE INDEX IF NOT EXISTS idx_shift_definition_effective_date_active
  ON public.shift_definition (effective_date, is_active);

