
ALTER TABLE public.sow
  ADD COLUMN IF NOT EXISTS people_required smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sow_people_required_positive'
      AND conrelid = 'public.sow'::regclass
  ) THEN
    ALTER TABLE public.sow
      ADD CONSTRAINT sow_people_required_positive
      CHECK (people_required IS NULL OR people_required > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.sow.people_required IS
  'Planned headcount (crew size) for this SOW operation. Per-operation planning attribute set by '
  'the manufacturing scheduler (PATCH /ms-project/sow-orders/:order_no/operations/people). '
  'NULL = not planned. Lives on sow, NOT on the bay reservation.';

