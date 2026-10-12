-- SAP posting over Kafka: a staging row handed to Kafka is QUEUED until the Kafka
-- poster claims it (QUEUED -> POSTING -> POSTED/FAILED/SKIPPED).
--
-- QUEUED rows are invisible to the polling poster (it only claims PENDING/FAILED),
-- so both transports can run side by side without posting a row twice.

ALTER TABLE public.sap_timesheet_staging
  DROP CONSTRAINT IF EXISTS sap_timesheet_staging_status_ck;

ALTER TABLE public.sap_timesheet_staging
  ADD CONSTRAINT sap_timesheet_staging_status_ck CHECK (
    status IN ('PENDING', 'QUEUED', 'POSTING', 'POSTED', 'FAILED', 'SKIPPED')
  );

-- Where a QUEUED row came from (PENDING, FAILED ...). The relay restores this status
-- if a row stays QUEUED too long, so nothing is stranded and nothing is promoted
-- (a FAILED row never turns into an auto-posted PENDING row).
ALTER TABLE public.sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS queued_from_status text,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz;

CREATE INDEX IF NOT EXISTS sap_timesheet_staging_queued_idx
  ON public.sap_timesheet_staging (queued_at)
  WHERE status = 'QUEUED';

-- A QUEUED bundle has not reached SAP yet, so it is invalidated like a PENDING one when
-- its source record changes. The Kafka poster then finds no row for the message and
-- drops it; catch-up stages the corrected data again.
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
     AND t.status IN ('PENDING', 'QUEUED', 'FAILED', 'SKIPPED');

  IF stale_ids IS NULL THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.sap_timesheet_staging WHERE id = ANY(stale_ids);

  RETURN NEW;
END;
$$;
