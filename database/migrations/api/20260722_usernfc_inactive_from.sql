
ALTER TABLE public.usernfc
  ADD COLUMN IF NOT EXISTS inactive_from date;

COMMENT ON COLUMN public.usernfc.inactive_from IS
  'First day the operator is NO LONGER counted (resignation effective date). NULL = active. '
  'Historical rule: counted when inactive_from IS NULL OR business_date < inactive_from. '
  'Read-side only — name/attribute resolution (SAP, ETL, history) must not filter on this.';

CREATE INDEX IF NOT EXISTS ix_usernfc_inactive_from
  ON public.usernfc (inactive_from)
  WHERE inactive_from IS NOT NULL;

