
ALTER TABLE public.mch_transaction
  ADD CONSTRAINT mch_transaction_no_overlap
  EXCLUDE USING gist (
    machineno WITH =,
    tsrange(startdatetime, end_effective) WITH &&
  )
  WHERE (end_effective IS NOT NULL AND end_effective > startdatetime);

COMMENT ON CONSTRAINT mch_transaction_no_overlap ON public.mch_transaction IS
  'Satu mesin tidak boleh punya dua interval bersamaan. Menjaga hasil clamp end_effective (lapis 1a/1b). Kalau ini melanggar: cari kenapa recompute_end_effective tidak meng-clamp, JANGAN buang constraint-nya.';

