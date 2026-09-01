CREATE TABLE IF NOT EXISTS public.buffer_transaction (
  id bigserial PRIMARY KEY,
  machine_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('in', 'out', 'moving')),
  component_id bigint NULL REFERENCES public.components(component_id) ON DELETE SET NULL,
  component_label text NULL,
  order_no text NULL,
  ssbr_id text NULL,
  operation_no integer NULL,
  operation_text text NULL,
  "timestamp" timestamptz NOT NULL DEFAULT NOW(),
  reference_no text NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_machine_time
  ON public.buffer_transaction (machine_id, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_component
  ON public.buffer_transaction (component_id);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_order_operation
  ON public.buffer_transaction (machine_id, order_no, operation_no, created_at DESC);

CREATE TABLE IF NOT EXISTS public.component_hours (
  id bigserial PRIMARY KEY,
  machine_id text NOT NULL,
  component_id bigint NULL REFERENCES public.components(component_id) ON DELETE SET NULL,
  component_label text NULL,
  total_hours numeric(12, 2) NOT NULL DEFAULT 0,
  last_calculated_at timestamptz NOT NULL DEFAULT NOW(),
  note text NULL,
  UNIQUE (machine_id, component_id, component_label)
);

CREATE INDEX IF NOT EXISTS idx_component_hours_machine
  ON public.component_hours (machine_id, total_hours DESC);
