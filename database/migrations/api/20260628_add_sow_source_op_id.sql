ALTER TABLE public.sow
  ADD COLUMN IF NOT EXISTS source_op_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_sow_source_op_id
  ON public.sow (source_op_id);
