CREATE TABLE IF NOT EXISTS public.sow_documentno (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  documentno TEXT NOT NULL UNIQUE,
  "default" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_documentno_default
  ON public.sow_documentno ("default")
  WHERE "default" = true;
