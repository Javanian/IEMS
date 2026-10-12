
BEGIN;

ALTER TABLE public.sow
    ALTER COLUMN order_no SET NOT NULL;

ALTER TABLE public.usernfc
    ALTER COLUMN nfcid SET NOT NULL;

ALTER TABLE public.timesheet_transaction
    ALTER COLUMN serialnumber SET NOT NULL,
    ALTER COLUMN full_name     SET NOT NULL;

COMMIT;

