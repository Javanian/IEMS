
ALTER TABLE public.sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS is_correction boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sap_timesheet_staging.is_correction IS
  'TRUE = bundel koreksi (segmen yang datang setelah hari-kuncinya ter-POST). Di-post MANUAL '
  'dari UI, tidak oleh auto-poster. SAP aditif -> menambah jam ke order tanpa storno.';

CREATE INDEX IF NOT EXISTS idx_sap_staging_is_correction
  ON public.sap_timesheet_staging (is_correction, status, bucket_start);

