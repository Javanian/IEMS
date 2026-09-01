ALTER TABLE ews.adoption_summary_snapshot
  ADD COLUMN IF NOT EXISTS adoption_source text NOT NULL DEFAULT 'all';

ALTER TABLE ews.adoption_summary_snapshot
  DROP CONSTRAINT IF EXISTS adoption_summary_snapshot_window_start_window_end_grain_key;

ALTER TABLE ews.adoption_summary_snapshot
  ADD CONSTRAINT adoption_summary_snapshot_window_grain_source_key
  UNIQUE (window_start, window_end, grain, adoption_source);

CREATE INDEX IF NOT EXISTS idx_ews_adoption_summary_source_latest
  ON ews.adoption_summary_snapshot (grain, adoption_source, window_end DESC, calculated_at DESC);
