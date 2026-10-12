
ALTER TABLE public.mch_transaction
  ADD COLUMN IF NOT EXISTS end_effective   timestamp without time zone,
  ADD COLUMN IF NOT EXISTS overlap_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_stuck        boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mch_transaction.end_effective IS
  'Akhir interval SETELAH clamp ke start baris berikutnya pada mesin yang sama: LEAST(enddatetime, next_start). SEMUA konsumen (staging SAP, report, OEE) harus memakai kolom ini, bukan enddatetime. Dihitung ulang oleh etl_mch_transaction_v3.py atas kandidat + pendahulunya.';
COMMENT ON COLUMN public.mch_transaction.overlap_seconds IS
  'Detik yang terpotong oleh clamp (enddatetime - end_effective). 0 = baris sehat.';
COMMENT ON COLUMN public.mch_transaction.is_stuck IS
  'TRUE bila baris ini "nyangkut": intervalnya menabrak baris berikutnya di mesin yang sama. Untuk laporan/alert, bukan untuk menyaring diam-diam.';

WITH seq AS (
  SELECT
    proddataid,
    enddatetime,
    lead(startdatetime) OVER (PARTITION BY machineno ORDER BY startdatetime, proddataid) AS next_start
  FROM public.mch_transaction
),
calc AS (
  SELECT
    proddataid,
    CASE
      WHEN enddatetime IS NULL THEN NULL
      WHEN next_start IS NOT NULL AND next_start < enddatetime THEN next_start
      ELSE enddatetime
    END AS end_effective,
    CASE
      WHEN enddatetime IS NOT NULL AND next_start IS NOT NULL AND next_start < enddatetime
        THEN GREATEST(EXTRACT(EPOCH FROM (enddatetime - next_start))::int, 0)
      ELSE 0
    END AS overlap_seconds
  FROM seq
)
UPDATE public.mch_transaction t
SET end_effective   = c.end_effective,
    overlap_seconds = c.overlap_seconds,
    is_stuck        = (c.overlap_seconds > 0)
FROM calc c
WHERE c.proddataid = t.proddataid;

CREATE INDEX IF NOT EXISTS idx_mch_transaction_stuck
  ON public.mch_transaction (startdatetime)
  WHERE is_stuck;

