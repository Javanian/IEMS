BEGIN;

ALTER TABLE public.sow_templates
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone NOT NULL DEFAULT now();

UPDATE public.sow_templates
SET template_key = COALESCE(NULLIF(TRIM(template_key), ''), template_id::text)
WHERE template_key IS NULL OR TRIM(template_key) = '';

ALTER TABLE public.sow_templates
  ALTER COLUMN template_key SET NOT NULL;

ALTER TABLE public.sow_template_lines
  ADD COLUMN IF NOT EXISTS line_order integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_templates_component_key
  ON public.sow_templates (component_id, template_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_template_lines_template_standard
  ON public.sow_template_lines (template_id, standard_id);

CREATE INDEX IF NOT EXISTS idx_sow_templates_component_active
  ON public.sow_templates (component_id, is_active, sort_order, template_name);

COMMIT;
