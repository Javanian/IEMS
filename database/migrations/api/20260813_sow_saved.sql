
CREATE TABLE IF NOT EXISTS sow_saved (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  component_id INTEGER,
  payload      JSONB NOT NULL,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sow_saved_name ON sow_saved (lower(name));

