
CREATE TABLE IF NOT EXISTS sow_draft (
  id         BIGSERIAL PRIMARY KEY,
  user_key   TEXT NOT NULL,
  context    TEXT NOT NULL,
  ref_key    TEXT NOT NULL DEFAULT '',
  payload    JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_key, context, ref_key)
);

CREATE INDEX IF NOT EXISTS idx_sow_draft_user_updated
  ON sow_draft (user_key, updated_at DESC);

