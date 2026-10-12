
ALTER TABLE public.timesheet_transaction
  ADD COLUMN IF NOT EXISTS ms_area_code       text,
  ADD COLUMN IF NOT EXISTS ms_bay_codes       text[],
  ADD COLUMN IF NOT EXISTS ms_task_id         uuid,
  ADD COLUMN IF NOT EXISTS ms_project_id      uuid,
  ADD COLUMN IF NOT EXISTS ms_bay_schedule_id uuid;

COMMENT ON COLUMN public.timesheet_transaction.ms_area_code IS
  'Manufacturing device-area code of the bay reservation this check-in came from (e.g. AREA-18). '
  'From selectedactivity.manufacturing_area_code. NULL for salvaging / non-reservation check-ins.';

COMMENT ON COLUMN public.timesheet_transaction.ms_bay_codes IS
  'Bay codes of the reservation the operator checked in under. From '
  'selectedactivity.manufacturing_bay_codes (schedule bays), falling back to [manufacturing_bay_code].';

COMMENT ON COLUMN public.timesheet_transaction.ms_task_id IS
  'Linked ms_project_task.task_id when the Select Job row resolved to a specific task; '
  'NULL for order-level reservations. Type matches ms_project_task PK (uuid).';

COMMENT ON COLUMN public.timesheet_transaction.ms_project_id IS
  'Linked ms_project.project_id for the reservation/task. Type matches ms_project_task PK (uuid).';

COMMENT ON COLUMN public.timesheet_transaction.ms_bay_schedule_id IS
  'Source ms_project_bay_schedule.schedule_id (the reservation that produced this job). '
  'No FK — reservations are cancellable. Used to flip RESERVED -> CONFIRMED on check-in.';

CREATE INDEX IF NOT EXISTS ix_ts_ms_bay_schedule
  ON public.timesheet_transaction (ms_bay_schedule_id)
  WHERE ms_bay_schedule_id IS NOT NULL;

