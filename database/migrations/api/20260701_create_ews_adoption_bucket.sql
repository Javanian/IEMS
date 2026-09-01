CREATE SCHEMA IF NOT EXISTS ews;

CREATE TABLE IF NOT EXISTS ews.adoption_bucket_snapshot (
  bucket_start timestamptz NOT NULL,
  bucket_end timestamptz NOT NULL,
  machine_key text NOT NULL,
  operator_key text NOT NULL DEFAULT '',
  operator_name text,
  has_unidentified boolean NOT NULL DEFAULT false,
  has_timesheet_match boolean NOT NULL DEFAULT false,
  machine_event_count integer NOT NULL DEFAULT 0,
  gap_type text,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start, machine_key, operator_key)
);

CREATE INDEX IF NOT EXISTS idx_ews_adoption_bucket_latest
  ON ews.adoption_bucket_snapshot (bucket_start DESC, machine_key, operator_key);

CREATE INDEX IF NOT EXISTS idx_ews_adoption_bucket_gap
  ON ews.adoption_bucket_snapshot (gap_type, bucket_start DESC)
  WHERE gap_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS ews.adoption_summary_snapshot (
  id bigserial PRIMARY KEY,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  grain text NOT NULL DEFAULT 'today',
  expected_bucket_count integer NOT NULL DEFAULT 0,
  covered_bucket_count integer NOT NULL DEFAULT 0,
  missing_bucket_count integer NOT NULL DEFAULT 0,
  unidentified_bucket_count integer NOT NULL DEFAULT 0,
  machine_count integer NOT NULL DEFAULT 0,
  operator_count integer NOT NULL DEFAULT 0,
  adoption_pct numeric(10,4),
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_start, window_end, grain)
);

CREATE INDEX IF NOT EXISTS idx_ews_adoption_summary_latest
  ON ews.adoption_summary_snapshot (grain, window_end DESC, calculated_at DESC);
