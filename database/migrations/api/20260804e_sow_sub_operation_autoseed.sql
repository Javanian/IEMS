
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
     AND upper(btrim(std.part_number))    = upper(btrim(NEW.part_number))
     AND upper(btrim(std.operation_text)) = upper(btrim(NEW.operation_text))
   ORDER BY std.sort_order, std.id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sow_seed_sub_operation ON public.sow;
CREATE TRIGGER trg_sow_seed_sub_operation
  AFTER INSERT ON public.sow
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_sow_sub_operation_from_standard();

COMMENT ON FUNCTION public.seed_sow_sub_operation_from_standard() IS
  'Menyemai sow_sub_operation dari sow_sub_operation_standard saat baris sow baru dibuat. '
  'Cocok lewat (part_number, operation_text). Idempoten: dilewati bila operasi sudah punya '
  'sub-task aktif. Backfill order yang sudah terlanjur ada: POST /sow/subtask-standards/backfill.';

