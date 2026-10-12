
ALTER TABLE public.sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS is_productive boolean
  GENERATED ALWAYS AS (zconf_type IN ('M1', 'M2')) STORED;

COMMENT ON COLUMN public.sap_timesheet_staging.is_productive IS
  'TRUE bila zconf_type M1/M2 (konfirmasi order). FALSE = alokasi aktivitas (LSTAR).';

CREATE INDEX IF NOT EXISTS idx_sap_staging_productive_status
  ON public.sap_timesheet_staging (is_productive, status);

