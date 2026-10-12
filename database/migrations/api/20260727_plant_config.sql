
CREATE TABLE IF NOT EXISTS public.plant_config (
  id                 integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  plant_code         text NOT NULL,
  plant_name         text NOT NULL,
  variant            text NOT NULL CHECK (variant IN ('salvaging','manufacturing')),
  timezone           text NOT NULL,
  order_master_table text NOT NULL DEFAULT 'ph3_order',
  plant_filter       text,
  feature_flags      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sap_rules          jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plant_config IS
  'Single-row per-plant config: identitas plant + varian + timezone. Diisi via apps/api/scripts/seed_plant_config.js. Lihat docs/deployment/PLANT_CONFIG_VARIANT_DESIGN.md';

