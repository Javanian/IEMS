
BEGIN;

ALTER TABLE public.mch_transaction
  ADD COLUMN IF NOT EXISTS status_record boolean
  GENERATED ALWAYS AS (
    statusid IN (0, 3, 4)
    OR (
         NULLIF(btrim(order_no), '')            IS NOT NULL
     AND NULLIF(btrim(operation_no), '')        IS NOT NULL
     AND NULLIF(btrim(sn_employee), '')         IS NOT NULL
     AND NULLIF(btrim(confirmation_number), '') IS NOT NULL
    )
  ) STORED;

COMMENT ON COLUMN public.mch_transaction.status_record IS
  'TRUE = record OK (statusid 0/3/4 Off/Downtime/NoJob, OR order_no+operation_no+sn_employee+confirmation_number all present). FALSE = incomplete. Basis for EWS accuracy_machine.';

CREATE INDEX IF NOT EXISTS idx_mch_transaction_status_record_false
  ON public.mch_transaction (machineno) WHERE status_record = false;

COMMIT;

