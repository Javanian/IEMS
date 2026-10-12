
CREATE TABLE IF NOT EXISTS public.sow_sub_operation_standard (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  part_number    text        NOT NULL,
  operation_text text        NOT NULL,
  operation_no   integer,
  title          text        NOT NULL,
  sort_order     integer     NOT NULL DEFAULT 0,
  weight         numeric(6,2) NOT NULL DEFAULT 1,
  is_active      boolean     NOT NULL DEFAULT true,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  updated_at     timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sow_sub_op_std_weight' AND conrelid = 'public.sow_sub_operation_standard'::regclass
  ) THEN
    ALTER TABLE public.sow_sub_operation_standard
      ADD CONSTRAINT chk_sow_sub_op_std_weight CHECK (weight > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sow_sub_op_std_not_blank' AND conrelid = 'public.sow_sub_operation_standard'::regclass
  ) THEN
    ALTER TABLE public.sow_sub_operation_standard
      ADD CONSTRAINT chk_sow_sub_op_std_not_blank
      CHECK (btrim(part_number) <> '' AND btrim(operation_text) <> '' AND btrim(title) <> '');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_sub_op_std_active
  ON public.sow_sub_operation_standard
     (upper(btrim(part_number)), upper(btrim(operation_text)), upper(btrim(title)))
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_sow_sub_op_std_part
  ON public.sow_sub_operation_standard (upper(btrim(part_number)))
  WHERE is_active;

COMMENT ON TABLE public.sow_sub_operation_standard IS
  'Standar sub-task per operasi, per part_number. Dicocokkan ke sow lewat '
  '(part_number, operation_text) - BUKAN operation_no, karena nomor operasi bergeser antar '
  'order untuk part yang sama. Instansiasinya masuk ke public.sow_sub_operation.';
COMMENT ON COLUMN public.sow_sub_operation_standard.operation_no IS
  'Referensi/urutan tampilan saja. TIDAK dipakai untuk mencocokkan - lihat komentar tabel.';
COMMENT ON COLUMN public.sow_sub_operation_standard.weight IS
  'Bobot relatif sub-task saat progress digulung ke operasi induk '
  '(recomputeOperationProgress: SUM(progress*weight)/SUM(weight)).';

