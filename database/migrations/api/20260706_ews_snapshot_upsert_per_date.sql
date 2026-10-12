
BEGIN;

LOCK TABLE ews.kpi_snapshot IN ACCESS EXCLUSIVE MODE;

DELETE FROM ews.kpi_snapshot k
USING (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY window_start, grain, scope_type, scope_key, shift_id
      ORDER BY window_end DESC, calculated_at DESC, id DESC
    ) AS rn
  FROM ews.kpi_snapshot
) d
WHERE k.id = d.id
  AND d.rn > 1;

ALTER TABLE ews.kpi_snapshot
  DROP CONSTRAINT kpi_snapshot_window_start_window_end_grain_scope_type_scope_key;

ALTER TABLE ews.kpi_snapshot
  ADD CONSTRAINT kpi_snapshot_date_key
  UNIQUE (window_start, grain, scope_type, scope_key, shift_id);

ALTER TABLE ews.kpi_snapshot
  ALTER COLUMN shift_id SET DEFAULT 0;

COMMIT;

