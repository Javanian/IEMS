ALTER TABLE public.buffer_transaction
  ADD COLUMN IF NOT EXISTS order_no text,
  ADD COLUMN IF NOT EXISTS ssbr_id text,
  ADD COLUMN IF NOT EXISTS operation_no integer,
  ADD COLUMN IF NOT EXISTS operation_text text;

ALTER TABLE public.buffer_transaction
  DROP CONSTRAINT IF EXISTS buffer_transaction_type_check;

ALTER TABLE public.buffer_transaction
  ADD CONSTRAINT buffer_transaction_type_check
  CHECK (type IN ('in', 'out', 'moving'));

UPDATE public.buffer_transaction b
SET
  order_no = COALESCE(b.order_no, s.order_no),
  ssbr_id = COALESCE(b.ssbr_id, s.ssbr_id),
  operation_no = COALESCE(b.operation_no, s.operation_no),
  operation_text = COALESCE(b.operation_text, s.operation_text),
  component_label = COALESCE(NULLIF(s.part_name, ''), b.component_label)
FROM public.sow s
WHERE b.reference_no = CONCAT('SEED-SOW-', s.idsow::text);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_order_operation
  ON public.buffer_transaction (machine_id, order_no, operation_no, created_at DESC);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY machine_id, order_no, operation_no
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.buffer_transaction
  WHERE order_no IS NOT NULL
    AND operation_no IS NOT NULL
)
DELETE FROM public.buffer_transaction b
USING ranked r
WHERE b.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_buffer_transaction_machine_order_operation
  ON public.buffer_transaction (machine_id, order_no, operation_no)
  WHERE order_no IS NOT NULL AND operation_no IS NOT NULL;
