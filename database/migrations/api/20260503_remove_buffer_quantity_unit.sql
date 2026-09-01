ALTER TABLE public.buffer_transaction
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS unit;
