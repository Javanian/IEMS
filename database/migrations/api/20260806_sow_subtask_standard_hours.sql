
ALTER TABLE public.sow_sub_operation
  ADD COLUMN IF NOT EXISTS standard_hours numeric(10,2) NOT NULL DEFAULT 1;

ALTER TABLE public.sow_sub_operation_standard
  ADD COLUMN IF NOT EXISTS standard_hours numeric(10,2) NOT NULL DEFAULT 1;

UPDATE public.sow_sub_operation s
   SET standard_hours = s.weight
 WHERE s.weight <> 1;

UPDATE public.sow_sub_operation_standard s
   SET standard_hours = s.weight
 WHERE s.weight <> 1;

UPDATE public.sow_sub_operation s
   SET weight = round(s.standard_hours / t.total, 4)
  FROM (SELECT operation_id, SUM(standard_hours) AS total
          FROM public.sow_sub_operation
         WHERE is_active = true
         GROUP BY operation_id) t
 WHERE s.operation_id = t.operation_id AND s.is_active = true AND t.total > 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sow_sub_op_hours_nonneg'
       AND conrelid = 'public.sow_sub_operation'::regclass
  ) THEN
    ALTER TABLE public.sow_sub_operation
      ADD CONSTRAINT chk_sow_sub_op_hours_nonneg CHECK (standard_hours >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sow_sub_op_std_hours_nonneg'
       AND conrelid = 'public.sow_sub_operation_standard'::regclass
  ) THEN
    ALTER TABLE public.sow_sub_operation_standard
      ADD CONSTRAINT chk_sow_sub_op_std_hours_nonneg CHECK (standard_hours >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.seed_sow_sub_operation_from_standard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_total numeric;
BEGIN
  IF NEW.part_number IS NULL OR btrim(NEW.part_number) = ''
     OR NEW.operation_text IS NULL OR btrim(NEW.operation_text) = '' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.sow_sub_operation
              WHERE operation_id = NEW.idsow AND is_active = true) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.sow_sub_operation
        (operation_id, order_no, title, sort_order, standard_hours, progress, status, is_active, created_by)
  SELECT NEW.idsow, NEW.order_no, std.title, std.sort_order, std.standard_hours, 0, 'NOT_STARTED', true, 'sap-auto'
    FROM public.sow_sub_operation_standard std
   WHERE std.is_active = true
     AND upper(btrim(std.part_number))    = upper(btrim(NEW.part_number))
     AND upper(btrim(std.operation_text)) = upper(btrim(NEW.operation_text))
   ORDER BY std.sort_order, std.id;

  SELECT SUM(standard_hours) INTO v_total
    FROM public.sow_sub_operation
   WHERE operation_id = NEW.idsow AND is_active = true;

  IF v_total IS NOT NULL AND v_total > 0 THEN
    UPDATE public.sow_sub_operation
       SET weight = round(standard_hours / v_total, 4)
     WHERE operation_id = NEW.idsow AND is_active = true;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON COLUMN public.sow_sub_operation.standard_hours IS
  'Jam standar sub-task (sumber kebenaran). Bobot = standard_hours / SUM(standard_hours) atas sub-task AKTIF operasi itu. 0 = dikeluarkan dari roll-up.';
COMMENT ON COLUMN public.sow_sub_operation_standard.standard_hours IS
  'Jam standar template sub-task; disalin ke sow_sub_operation.standard_hours saat autoseed.';
COMMENT ON COLUMN public.sow_sub_operation.weight IS
  'TURUNAN: share jam (standard_hours / total). Dihitung ulang controller-side; JANGAN diedit manual.';

