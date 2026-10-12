
ALTER TABLE public.mch_transaction
  DROP CONSTRAINT IF EXISTS mch_transaction_no_overlap;

ALTER TABLE public.mch_transaction
  ADD CONSTRAINT mch_transaction_no_overlap
  EXCLUDE USING gist (
    machineno WITH =,
    tsrange(startdatetime, end_effective) WITH &&
  )
  WHERE (end_effective IS NOT NULL AND end_effective > startdatetime)
  DEFERRABLE INITIALLY IMMEDIATE;

COMMENT ON CONSTRAINT mch_transaction_no_overlap ON public.mch_transaction IS
  'Satu mesin tidak boleh punya dua interval bersamaan. Menjaga hasil clamp end_effective (lapis 1a/1b). DEFERRABLE: recompute_end_effective memakai SET CONSTRAINTS ALL DEFERRED karena melewati keadaan-antara yang sah. Kalau ini melanggar: cari kenapa end_effective tidak ter-clamp, JANGAN buang constraint-nya.';

