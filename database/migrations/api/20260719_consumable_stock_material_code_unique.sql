
ALTER TABLE public.consumable_stock
  ALTER COLUMN material_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.consumable_stock'::regclass
      AND conname = 'consumable_stock_material_code_key'
  ) THEN
    ALTER TABLE public.consumable_stock
      ADD CONSTRAINT consumable_stock_material_code_key UNIQUE (material_code);
  END IF;
END $$;

