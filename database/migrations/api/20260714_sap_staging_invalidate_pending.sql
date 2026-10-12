
CREATE OR REPLACE FUNCTION public.mch_transaction_invalidate_pending_bundles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stale_ids bigint[];
BEGIN

  IF (NEW.order_no, NEW.operation_no, NEW.sn_employee, NEW.confirmation_number,
      NEW.machineid, NEW.status_activitytype, NEW.status_description,
      NEW.startdatetime, NEW.enddatetime)
     IS NOT DISTINCT FROM
     (OLD.order_no, OLD.operation_no, OLD.sn_employee, OLD.confirmation_number,
      OLD.machineid, OLD.status_activitytype, OLD.status_description,
      OLD.startdatetime, OLD.enddatetime)
  THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT s.staging_id)
    INTO stale_ids
    FROM public.sap_staging_source s
    JOIN public.sap_timesheet_staging t ON t.id = s.staging_id
   WHERE s.source_system = 'MCH_HOURS'
     AND s.source_row_id = NEW.proddataid::text
     AND s.posted_at IS NULL
     AND t.status IN ('PENDING', 'FAILED', 'SKIPPED');

  IF stale_ids IS NULL THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.sap_timesheet_staging WHERE id = ANY(stale_ids);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mch_transaction_invalidate_pending ON public.mch_transaction;
CREATE TRIGGER trg_mch_transaction_invalidate_pending
    AFTER UPDATE ON public.mch_transaction
    FOR EACH ROW
    EXECUTE FUNCTION public.mch_transaction_invalidate_pending_bundles();

CREATE INDEX IF NOT EXISTS idx_mch_transaction_sap_eligible
    ON public.mch_transaction (startdatetime)
    WHERE enddatetime IS NOT NULL
      AND NULLIF(BTRIM(sn_employee), '') IS NOT NULL;

