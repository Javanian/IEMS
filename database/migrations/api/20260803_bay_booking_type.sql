
ALTER TABLE public.ms_project_bay_schedule
  ADD COLUMN IF NOT EXISTS booking_type      text NOT NULL DEFAULT 'ORDER',
  ADD COLUMN IF NOT EXISTS purpose           text,
  ADD COLUMN IF NOT EXISTS schedule_group_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bay_schedule_booking_type'
      AND conrelid = 'public.ms_project_bay_schedule'::regclass
  ) THEN
    ALTER TABLE public.ms_project_bay_schedule
      ADD CONSTRAINT chk_bay_schedule_booking_type
      CHECK (booking_type IN ('ORDER','PARKING','STORAGE','MAINTENANCE','OTHER'));
  END IF;
END $$;

ALTER TABLE public.ms_project_bay_schedule
  ALTER COLUMN order_no DROP NOT NULL;

DELETE FROM public.ms_project_bay_schedule
 WHERE status = 'CANCELLED'
   AND created_by = 'smoke-test'
   AND end_date > DATE '2090-01-01';

WITH g AS MATERIALIZED (
  SELECT order_no, start_date, end_date, bay_codes, gen_random_uuid() AS gid
    FROM public.ms_project_bay_schedule
   WHERE schedule_group_id IS NULL
   GROUP BY order_no, start_date, end_date, bay_codes
)
UPDATE public.ms_project_bay_schedule s
   SET schedule_group_id = g.gid
  FROM g
 WHERE s.schedule_group_id IS NULL
   AND s.order_no   IS NOT DISTINCT FROM g.order_no
   AND s.bay_codes  IS NOT DISTINCT FROM g.bay_codes
   AND s.start_date = g.start_date
   AND s.end_date   = g.end_date;

CREATE INDEX IF NOT EXISTS idx_ms_project_bay_schedule_group
  ON public.ms_project_bay_schedule (schedule_group_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bay_schedule_order_or_purpose'
      AND conrelid = 'public.ms_project_bay_schedule'::regclass
  ) THEN
    ALTER TABLE public.ms_project_bay_schedule
      ADD CONSTRAINT chk_bay_schedule_order_or_purpose
      CHECK (
           (booking_type =  'ORDER' AND order_no IS NOT NULL AND btrim(order_no) <> '')
        OR (booking_type <> 'ORDER' AND purpose  IS NOT NULL AND btrim(purpose)  <> '')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.ms_project_bay_schedule.booking_type IS
  'Jenis pemakaian bay: ORDER (reservasi job, wajib order_no) atau PARKING/STORAGE/MAINTENANCE/'
  'OTHER (booking non-job, wajib purpose). Default ORDER agar baris lama tetap valid.';

COMMENT ON COLUMN public.ms_project_bay_schedule.purpose IS
  'Keterangan tujuan pemakaian bay. WAJIB bila booking_type <> ''ORDER'' (lihat '
  'chk_bay_schedule_order_or_purpose); opsional sebagai catatan bebas untuk booking ORDER.';

COMMENT ON COLUMN public.ms_project_bay_schedule.schedule_group_id IS
  'Identitas satu reservasi = N baris jadwal (satu per task). Dipakai endpoint '
  'PUT/DELETE /ms-project/bay-schedules/group/:schedule_group_id agar ubah & batal jadi atomik '
  'satu transaksi. Baris lama di-backfill per kelompok (order_no, start_date, end_date, bay_codes) '
  '— kunci yang dulu dirangkai ulang FE sebagai reservationKey.';

