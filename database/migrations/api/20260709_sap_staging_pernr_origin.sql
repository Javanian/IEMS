
BEGIN;

ALTER TABLE sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS pernr_origin text NOT NULL DEFAULT '';

COMMENT ON COLUMN sap_timesheet_staging.pernr_origin IS
  'SN karyawan asli sebelum substitusi Outsource (pernr dipaksa 11009413 untuk Outsource). Audit-only, tidak dikirim ke SAP.';

UPDATE sap_timesheet_staging
SET pernr_origin = pernr
WHERE pernr_origin = ''
  AND pernr <> '11009413';

COMMIT;

