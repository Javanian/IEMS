ALTER TABLE ews.action_table
  ADD COLUMN IF NOT EXISTS issue_key text,
  ADD COLUMN IF NOT EXISTS issue_description text,
  ADD COLUMN IF NOT EXISTS error_type text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'Watch',
  ADD COLUMN IF NOT EXISTS solved_date timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_level text NOT NULL DEFAULT 'PIC Monitor',
  ADD COLUMN IF NOT EXISTS detail_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE ews.action_table
SET issue_description = COALESCE(issue_description, status_reason),
    error_type = COALESCE(error_type, kpi_type),
    solved_date = COALESCE(solved_date, CASE WHEN action_status = 'Closed' THEN last_updated END),
    escalation_level = CASE
      WHEN action_status = 'Closed' THEN 'Closed'
      WHEN severity = 'Critical' AND action_date < now() - interval '3 hours' THEN 'Plant Manager'
      WHEN severity = 'Critical' AND action_date < now() - interval '1 hour' THEN 'Supervisor/Foreman'
      ELSE COALESCE(escalation_level, 'PIC Monitor')
    END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ews_action_issue_key
  ON ews.action_table (issue_key)
  WHERE issue_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ews_action_kpi_status
  ON ews.action_table (kpi_type, action_status, action_date DESC);

CREATE INDEX IF NOT EXISTS idx_ews_action_escalation
  ON ews.action_table (severity, action_status, action_date DESC);
