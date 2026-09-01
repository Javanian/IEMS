
CREATE INDEX IF NOT EXISTS idx_sow_schedule_date
  ON public.sow_schedule (schedule_date);

CREATE INDEX IF NOT EXISTS idx_sow_schedule_batch_id
  ON public.sow_schedule (batch_id)
  WHERE batch_id IS NOT NULL;

