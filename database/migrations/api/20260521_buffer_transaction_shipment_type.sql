ALTER TABLE public.buffer_transaction
  DROP CONSTRAINT IF EXISTS buffer_transaction_type_check;

ALTER TABLE public.buffer_transaction
  ADD CONSTRAINT buffer_transaction_type_check
  CHECK (type IN ('in', 'out', 'moving', 'shipment'));

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_shipment_latest
  ON public.buffer_transaction (type, order_no, created_at DESC, id DESC)
  WHERE type = 'shipment';
