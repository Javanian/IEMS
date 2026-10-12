
DROP INDEX IF EXISTS public.uq_sow_sub_op_std_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_sub_op_std_active
  ON public.sow_sub_operation_standard (
    upper(regexp_replace(btrim(part_number),    '\s+', ' ', 'g')),
    upper(regexp_replace(btrim(operation_text), '\s+', ' ', 'g')),
    upper(regexp_replace(btrim(title),          '\s+', ' ', 'g'))
  )
  WHERE is_active;

DROP INDEX IF EXISTS public.idx_sow_sub_op_std_part;
CREATE INDEX IF NOT EXISTS idx_sow_sub_op_std_part
  ON public.sow_sub_operation_standard (upper(regexp_replace(btrim(part_number), '\s+', ' ', 'g')))
  WHERE is_active;

CREATE OR REPLACE FUNCTION public.seed_sow_sub_operation_from_standard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
        (operation_id, order_no, title, sort_order, weight, progress, status, is_active, created_by)
  SELECT NEW.idsow, NEW.order_no, std.title, std.sort_order, std.weight, 0, 'NOT_STARTED', true, 'sap-auto'
    FROM public.sow_sub_operation_standard std
   WHERE std.is_active = true
     AND upper(regexp_replace(btrim(std.part_number),    '\s+', ' ', 'g'))
       = upper(regexp_replace(btrim(NEW.part_number),    '\s+', ' ', 'g'))
     AND upper(regexp_replace(btrim(std.operation_text), '\s+', ' ', 'g'))
       = upper(regexp_replace(btrim(NEW.operation_text), '\s+', ' ', 'g'))
   ORDER BY std.sort_order, std.id;

  RETURN NULL;
END;
$$;

