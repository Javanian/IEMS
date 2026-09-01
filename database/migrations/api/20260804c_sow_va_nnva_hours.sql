
ALTER TABLE public.sow
  ADD COLUMN IF NOT EXISTS va_hours   numeric,
  ADD COLUMN IF NOT EXISTS nnva_hours numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sow_va_hours_non_negative'
      AND conrelid = 'public.sow'::regclass
  ) THEN
    ALTER TABLE public.sow
      ADD CONSTRAINT sow_va_hours_non_negative
      CHECK (va_hours IS NULL OR va_hours >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sow_nnva_hours_non_negative'
      AND conrelid = 'public.sow'::regclass
  ) THEN
    ALTER TABLE public.sow
      ADD CONSTRAINT sow_nnva_hours_non_negative
      CHECK (nnva_hours IS NULL OR nnva_hours >= 0);
  END IF;
END $$;

WITH nn AS (
  SELECT sow_standard_id, SUM(COALESCE(standard_hours, 0)) AS nnva_h
  FROM public.sow_nnva_standard
  GROUP BY sow_standard_id
)
UPDATE public.sow s
   SET nnva_hours = LEAST(nn.nnva_h, s.planhours),
       va_hours   = s.planhours - LEAST(nn.nnva_h, s.planhours)
  FROM nn
 WHERE nn.sow_standard_id = s.source_op_id
   AND s.planhours IS NOT NULL
   AND s.va_hours IS NULL;

UPDATE public.sow
   SET nnva_hours = 0,
       va_hours   = planhours
 WHERE va_hours IS NULL
   AND planhours IS NOT NULL;

COMMENT ON COLUMN public.sow.va_hours IS
  'Value-added hours untuk operasi ini. Angka yang DIINPUT PE. planhours = va_hours + nnva_hours '
  'dihitung di server saat write. Snapshot per order — tidak ikut berubah bila NNVA di master '
  'standar diedit.';

COMMENT ON COLUMN public.sow.nnva_hours IS
  'Non-value-added hours untuk operasi ini, di-snapshot dari sow_nnva_standard saat operasi '
  'dipilih dari standar. 0 untuk operasi yang ditambah manual atau tanpa link standar yang andal.';

