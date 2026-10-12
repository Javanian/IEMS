
ALTER TABLE public.ms_project_bay_schedule
  ADD COLUMN IF NOT EXISTS created_by_user_id integer,
  ADD COLUMN IF NOT EXISTS updated_by_user_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bay_schedule_created_by_user'
       AND conrelid = 'public.ms_project_bay_schedule'::regclass
  ) THEN
    ALTER TABLE public.ms_project_bay_schedule
      ADD CONSTRAINT fk_bay_schedule_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bay_schedule_updated_by_user'
       AND conrelid = 'public.ms_project_bay_schedule'::regclass
  ) THEN
    ALTER TABLE public.ms_project_bay_schedule
      ADD CONSTRAINT fk_bay_schedule_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bay_schedule_created_by_user
  ON public.ms_project_bay_schedule (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

UPDATE public.ms_project_bay_schedule b
   SET created_by_user_id = u.id
  FROM public.users u
 WHERE b.created_by_user_id IS NULL
   AND b.created_by IS NOT NULL
   AND lower(btrim(u.name)) = lower(btrim(b.created_by));

UPDATE public.ms_project_bay_schedule b
   SET created_by_user_id = u.id
  FROM public.users u
 WHERE b.created_by_user_id IS NULL
   AND b.created_by IS NOT NULL
   AND lower(btrim(u.username)) = lower(btrim(b.created_by));

UPDATE public.ms_project_bay_schedule b
   SET updated_by_user_id = u.id
  FROM public.users u
 WHERE b.updated_by_user_id IS NULL
   AND b.updated_by IS NOT NULL
   AND lower(btrim(u.name)) = lower(btrim(b.updated_by));

UPDATE public.ms_project_bay_schedule b
   SET updated_by_user_id = u.id
  FROM public.users u
 WHERE b.updated_by_user_id IS NULL
   AND b.updated_by IS NOT NULL
   AND lower(btrim(u.username)) = lower(btrim(b.updated_by));

COMMENT ON COLUMN public.ms_project_bay_schedule.created_by_user_id IS
  'Pembuat reservasi, ditautkan ke public.users(id). SUMBER KEBENARAN untuk menampilkan nama — '
  'kolom teks created_by hanya cadangan untuk aktor non-user (job/skrip) dan jejak historis.';
COMMENT ON COLUMN public.ms_project_bay_schedule.updated_by_user_id IS
  'Pengubah terakhir, ditautkan ke public.users(id). Lihat catatan di created_by_user_id.';

