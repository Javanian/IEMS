
CREATE INDEX IF NOT EXISTS idx_mch_transaction_machine_time
  ON public.mch_transaction (machineno, startdatetime, proddataid);

