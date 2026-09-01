
BEGIN;

UPDATE ms_project SET status = 'DRAFT'  WHERE upper(coalesce(status, '')) = 'TRIAL';
UPDATE ms_project SET status = upper(status) WHERE status IS NOT NULL AND status <> upper(status);
UPDATE ms_project SET status = 'ACTIVE' WHERE status IS NULL OR status NOT IN ('DRAFT', 'ACTIVE', 'ARCHIVED');

ALTER TABLE ms_project ALTER COLUMN status SET DEFAULT 'ACTIVE';
ALTER TABLE ms_project ALTER COLUMN status SET NOT NULL;

ALTER TABLE ms_project DROP CONSTRAINT IF EXISTS chk_ms_project_status;
ALTER TABLE ms_project ADD CONSTRAINT chk_ms_project_status
  CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'));

COMMIT;

