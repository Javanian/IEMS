
BEGIN;

CREATE SCHEMA IF NOT EXISTS ews;

CREATE TABLE IF NOT EXISTS ews.issue_log (
  id            bigserial PRIMARY KEY,
  issue_key     text NOT NULL UNIQUE,
  category      text NOT NULL,
  business_date date NOT NULL,
  scope_type    text,
  entity_id     text,
  entity_name   text,
  severity      text NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  title         text,
  description   text,
  metric_value  numeric,
  detail        jsonb,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ews_issue_log_category_status
  ON ews.issue_log (category, status, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_ews_issue_log_created
  ON ews.issue_log (created_at DESC);

COMMENT ON TABLE ews.issue_log IS
  'Central EWS issue log across all KPI categories. Generated backend-side; dedup by issue_key per (category, business_date, entity).';

COMMIT;

