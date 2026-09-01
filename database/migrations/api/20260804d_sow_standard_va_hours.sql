
ALTER TABLE public.sow_standard
  ADD COLUMN IF NOT EXISTS va_hours numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sow_standard_va_hours_non_negative'
      AND conrelid = 'public.sow_standard'::regclass
  ) THEN
    ALTER TABLE public.sow_standard
      ADD CONSTRAINT sow_standard_va_hours_non_negative
      CHECK (va_hours IS NULL OR va_hours >= 0);
  END IF;
END $$;

WITH nn AS (
  SELECT sow_standard_id, SUM(COALESCE(standard_hours, 0)) AS nnva_h
  FROM public.sow_nnva_standard
  GROUP BY sow_standard_id
)
UPDATE public.sow_standard ss
   SET va_hours = GREATEST(COALESCE(ss.std_hours, 0) - COALESCE(nn.nnva_h, 0), 0)
  FROM (SELECT id FROM public.sow_standard) s
  LEFT JOIN nn ON nn.sow_standard_id = s.id
 WHERE ss.id = s.id
   AND ss.va_hours IS NULL;

COMMENT ON COLUMN public.sow_standard.va_hours IS
  'Value-added hours operasi standar ini — angka yang DIINPUT PE. std_hours = va_hours + '
  'SUM(sow_nnva_standard.standard_hours) dihitung di server saat operasi atau NNVA-nya disimpan. '
  'Perhatikan: kolom std_hours di template CSV seed_sow.js berarti porsi VA, sedangkan '
  'sow_standard.std_hours di database berarti TOTAL.';

