ALTER TABLE public.buffer_transaction
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE public.buffer_transaction
  DROP CONSTRAINT IF EXISTS buffer_transaction_type_check;

ALTER TABLE public.buffer_transaction
  ADD CONSTRAINT buffer_transaction_type_check
  CHECK (type IN ('in', 'out', 'moving'));

DROP INDEX IF EXISTS public.uq_buffer_transaction_machine_order_operation;

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_latest
  ON public.buffer_transaction (machine_id, order_no, operation_no, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_box_priority
  ON public.buffer_transaction (machine_id, type, priority ASC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_history
  ON public.buffer_transaction (order_no, operation_no, created_at DESC);
