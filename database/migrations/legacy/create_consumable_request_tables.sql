CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS public.consumable_ticket (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cis_no text NOT NULL UNIQUE,
  sn_karyawan text NOT NULL,
  nama_karyawan text NOT NULL,
  workcenter text,
  machineid text,
  comment text,
  status text NOT NULL DEFAULT 'waiting leader',
  person_image text,
  image_person text,
  picked_by_sn text,
  picked_by_name text,
  picked_by_workcenter text,
  picked_by_machineid text,
  picked_by_nfcid text,
  picked_by_role text,
  picked_at timestamp,
  closedate timestamp,
  created timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_consumable_ticket_user
    FOREIGN KEY (sn_karyawan)
    REFERENCES public.usernfc (snssb)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
    NOT VALID
);

CREATE TABLE IF NOT EXISTS public.consumable_item (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  materialcode text NOT NULL,
  materialdescription text NOT NULL,
  quanitty numeric NOT NULL CHECK (quanitty > 0),
  uom text,
  created timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cost_center text,
  cis_no text NOT NULL,
  gl_account text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  rejected_by text,
  rejected_reason text,
  rejected_at timestamp,
  adjusted_by text,
  adjusted_at timestamp,
  code_mm text,
  CONSTRAINT fk_consumable_item_ticket
    FOREIGN KEY (cis_no)
    REFERENCES public.consumable_ticket (cis_no)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.consumable_stock (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  material_code text,
  code_mm text,
  material_description text,
  mrp_type text,
  plant text,
  quantity numeric NOT NULL DEFAULT 0,
  type text,
  uom text
);

DO $$
DECLARE
  next_ticket_id integer;
  next_stock_id integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'consumable_ticket'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.consumable_ticket ADD COLUMN id integer;
    UPDATE public.consumable_ticket
       SET id = numbered.row_no
      FROM (
        SELECT ctid, row_number() OVER (ORDER BY created, cis_no)::integer AS row_no
        FROM public.consumable_ticket
      ) numbered
     WHERE public.consumable_ticket.ctid = numbered.ctid;
    ALTER TABLE public.consumable_ticket ALTER COLUMN id SET NOT NULL;
    SELECT COALESCE(MAX(id), 0) + 1 INTO next_ticket_id FROM public.consumable_ticket;
    ALTER TABLE public.consumable_ticket ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
    EXECUTE format('ALTER TABLE public.consumable_ticket ALTER COLUMN id RESTART WITH %s', next_ticket_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'consumable_stock'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.consumable_stock ADD COLUMN id integer;
    UPDATE public.consumable_stock
       SET id = numbered.row_no
      FROM (
        SELECT ctid, row_number() OVER (ORDER BY material_code, code_mm, material_description)::integer AS row_no
        FROM public.consumable_stock
      ) numbered
     WHERE public.consumable_stock.ctid = numbered.ctid;
    ALTER TABLE public.consumable_stock ALTER COLUMN id SET NOT NULL;
    SELECT COALESCE(MAX(id), 0) + 1 INTO next_stock_id FROM public.consumable_stock;
    ALTER TABLE public.consumable_stock ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
    EXECUTE format('ALTER TABLE public.consumable_stock ALTER COLUMN id RESTART WITH %s', next_stock_id);
  END IF;
END $$;

ALTER TABLE public.consumable_ticket
  ADD COLUMN IF NOT EXISTS image_person text,
  ADD COLUMN IF NOT EXISTS picked_by_sn text,
  ADD COLUMN IF NOT EXISTS picked_by_name text,
  ADD COLUMN IF NOT EXISTS picked_by_workcenter text,
  ADD COLUMN IF NOT EXISTS picked_by_machineid text,
  ADD COLUMN IF NOT EXISTS picked_by_nfcid text,
  ADD COLUMN IF NOT EXISTS picked_by_role text,
  ADD COLUMN IF NOT EXISTS picked_at timestamp;

ALTER TABLE public.consumable_item
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS rejected_by text,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamp,
  ADD COLUMN IF NOT EXISTS adjusted_by text,
  ADD COLUMN IF NOT EXISTS adjusted_at timestamp;

UPDATE public.consumable_item
   SET status = 'active'
 WHERE status IS NULL;

ALTER TABLE public.consumable_item
  DROP CONSTRAINT IF EXISTS fk_consumable_item_ticket;

ALTER TABLE public.consumable_ticket
  DROP CONSTRAINT IF EXISTS consumable_ticket_pkey CASCADE;

ALTER TABLE public.consumable_ticket
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN cis_no SET NOT NULL;

ALTER TABLE public.consumable_ticket
  ADD CONSTRAINT consumable_ticket_pkey PRIMARY KEY (id);

ALTER TABLE public.consumable_ticket
  DROP CONSTRAINT IF EXISTS consumable_ticket_cis_no_key;

ALTER TABLE public.consumable_ticket
  ADD CONSTRAINT consumable_ticket_cis_no_key UNIQUE (cis_no);

ALTER TABLE public.consumable_item
  ADD CONSTRAINT fk_consumable_item_ticket
  FOREIGN KEY (cis_no)
  REFERENCES public.consumable_ticket (cis_no)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'consumable_stock'
      AND constraint_name = 'consumable_stock_pkey'
  ) THEN
    ALTER TABLE public.consumable_stock
      ADD CONSTRAINT consumable_stock_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_consumable_ticket_sn_created
  ON public.consumable_ticket (sn_karyawan, created DESC);

CREATE INDEX IF NOT EXISTS idx_consumable_item_cis_no
  ON public.consumable_item (cis_no);

CREATE INDEX IF NOT EXISTS idx_consumable_item_status
  ON public.consumable_item (status);

CREATE INDEX IF NOT EXISTS idx_consumable_stock_material_code
  ON public.consumable_stock (material_code);

CREATE INDEX IF NOT EXISTS idx_consumable_stock_code_mm
  ON public.consumable_stock (code_mm);

CREATE INDEX IF NOT EXISTS idx_consumable_stock_description_trgm
  ON public.consumable_stock
  USING gin (material_description public.gin_trgm_ops);
