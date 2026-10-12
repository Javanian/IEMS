
ALTER TABLE public.mch_transaction DROP COLUMN IF EXISTS status_record;

ALTER TABLE public.mch_transaction
  ADD COLUMN status_record boolean
  GENERATED ALWAYS AS (
    statusid IN (0, 3, 4)
    OR (

      status_activitytype IN ('M1', 'M2')
      AND NULLIF(btrim(order_no), '')            IS NOT NULL
      AND NULLIF(btrim(operation_no), '')        IS NOT NULL
      AND NULLIF(btrim(sn_employee), '')         IS NOT NULL
      AND NULLIF(btrim(confirmation_number), '') IS NOT NULL
    )
    OR (

      NULLIF(btrim(status_activitytype), '') IS NOT NULL
      AND status_activitytype NOT IN ('M1', 'M2')
      AND NULLIF(btrim(sn_employee), '') IS NOT NULL
    )
  ) STORED;

COMMENT ON COLUMN public.mch_transaction.status_record IS
  'TRUE = record layak. statusid 0/3/4 (sah tanpa job), ATAU productive (M1/M2) dgn '
  'order+operasi+operator+confirmation, ATAU unproductive (activity type) dgn operator '
  '(tanpa confirmation). Basis accuracy_machine + kelayakan SAP (kecuali 0/3/4 dikecualikan staging).';

CREATE INDEX IF NOT EXISTS idx_mch_transaction_status_record_false
  ON public.mch_transaction (machineno) WHERE status_record = false;

