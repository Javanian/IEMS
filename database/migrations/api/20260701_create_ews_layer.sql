CREATE SCHEMA IF NOT EXISTS ews;

CREATE TABLE IF NOT EXISTS ews.kpi_snapshot (
  id bigserial PRIMARY KEY,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  grain text NOT NULL DEFAULT '15m',
  scope_type text NOT NULL DEFAULT 'system',
  scope_key text NOT NULL DEFAULT 'ALL',
  shift_id bigint NOT NULL DEFAULT 0,
  uptime_pct numeric(10,4),
  accuracy_pct numeric(10,4),
  adoption_pct numeric(10,4),
  oee_pct numeric(10,4),
  ole_pct numeric(10,4),
  overall_score numeric(10,4),
  overall_status text NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_start, window_end, grain, scope_type, scope_key, shift_id)
);

CREATE INDEX IF NOT EXISTS idx_ews_kpi_snapshot_latest
  ON ews.kpi_snapshot (grain, scope_type, scope_key, window_end DESC);

CREATE INDEX IF NOT EXISTS idx_ews_kpi_snapshot_status
  ON ews.kpi_snapshot (overall_status, window_end DESC);

CREATE TABLE IF NOT EXISTS ews.alert_log (
  id bigserial PRIMARY KEY,
  alert_timestamp timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz,
  window_end timestamptz,
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  machine_id text,
  operator_id text,
  kpi_type text NOT NULL,
  kpi_value numeric(10,4),
  threshold_value numeric(10,4),
  severity text NOT NULL,
  alert_status text NOT NULL DEFAULT 'OPEN',
  alert_message text NOT NULL,
  suggested_action text,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ews_alert_open
  ON ews.alert_log (alert_status, severity, alert_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_ews_alert_scope
  ON ews.alert_log (scope_type, scope_key, kpi_type, alert_timestamp DESC);

CREATE TABLE IF NOT EXISTS ews.action_table (
  action_id bigserial PRIMARY KEY,
  alert_id bigint REFERENCES ews.alert_log(id),
  kpi_type text NOT NULL,
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  machine_id text,
  status_reason text,
  action_taken text,
  pic text NOT NULL,
  action_status text NOT NULL DEFAULT 'Open',
  due_at timestamptz,
  action_date timestamptz NOT NULL DEFAULT now(),
  last_updated timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX IF NOT EXISTS idx_ews_action_status
  ON ews.action_table (action_status, due_at, last_updated DESC);

CREATE TABLE IF NOT EXISTS ews.action_history (
  id bigserial PRIMARY KEY,
  action_id bigint REFERENCES ews.action_table(action_id),
  old_status text,
  new_status text,
  changed_by text,
  notes text,
  change_timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ews.kpi_threshold (
  kpi_type text PRIMARY KEY,
  normal_min numeric(10,4),
  warning_min numeric(10,4),
  critical_below numeric(10,4),
  owner text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ews.kpi_threshold (kpi_type, normal_min, warning_min, critical_below, owner)
VALUES
  ('uptime', 98, 95, 95, 'IT'),
  ('accuracy', 97, 95, 95, 'Foreman'),
  ('adoption', 95, 90, 90, 'Spv'),
  ('oee', 65, 50, 50, 'PPIC'),
  ('ole', 85, 70, 70, 'Spv')
ON CONFLICT (kpi_type) DO UPDATE
SET normal_min = EXCLUDED.normal_min,
    warning_min = EXCLUDED.warning_min,
    critical_below = EXCLUDED.critical_below,
    owner = EXCLUDED.owner,
    updated_at = now();

CREATE OR REPLACE FUNCTION ews.notify_source_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'ews_source_changed',
    jsonb_build_object(
      'schema', TG_TABLE_SCHEMA,
      'table', TG_TABLE_NAME,
      'op', TG_OP,
      'at', clock_timestamp()
    )::text
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION ews.notify_snapshot_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'ews_snapshot_ready',
    jsonb_build_object(
      'snapshot_id', NEW.id,
      'grain', NEW.grain,
      'scope_type', NEW.scope_type,
      'scope_key', NEW.scope_key,
      'window_end', NEW.window_end,
      'calculated_at', NEW.calculated_at
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ews_snapshot_ready ON ews.kpi_snapshot;
CREATE TRIGGER trg_ews_snapshot_ready
AFTER INSERT OR UPDATE ON ews.kpi_snapshot
FOR EACH ROW
EXECUTE FUNCTION ews.notify_snapshot_ready();

DO $$
DECLARE
  source_name text;
  source_table regclass;
  source_tables text[] := ARRAY[
    'public.timesheet_transaction',
    'public.mch_transaction',
    'public.mch_machine_ping_log',
    'public.sap_timesheet_staging',
    'public.processcontroldata',
    'ews.action_table',
    'ews.kpi_threshold'
  ];
BEGIN
  FOREACH source_name IN ARRAY source_tables LOOP
    source_table := to_regclass(source_name);
    IF source_table IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_ews_source_changed ON %s', source_table);
      EXECUTE format(
        'CREATE TRIGGER trg_ews_source_changed AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION ews.notify_source_changed()',
        source_table
      );
    END IF;
  END LOOP;
END;
$$;
