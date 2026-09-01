
BEGIN;

CREATE TABLE IF NOT EXISTS sow_nnva_base (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS sow_nnva_standard (
    id                  SERIAL PRIMARY KEY,
    sow_standard_id     INTEGER NOT NULL REFERENCES sow_standard(id) ON DELETE CASCADE,
    nnva_base_id        INTEGER NOT NULL REFERENCES sow_nnva_base(id) ON DELETE RESTRICT,
    standard_hours      NUMERIC(10,2) DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sow_standard_id, nnva_base_id)
);

CREATE INDEX IF NOT EXISTS idx_nnva_std_sow_id ON sow_nnva_standard(sow_standard_id);
CREATE INDEX IF NOT EXISTS idx_nnva_std_nnva_id ON sow_nnva_standard(nnva_base_id);

CREATE OR REPLACE FUNCTION update_nnva_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nnva_base_updated_at ON sow_nnva_base;
CREATE TRIGGER trg_nnva_base_updated_at
    BEFORE UPDATE ON sow_nnva_base
    FOR EACH ROW EXECUTE FUNCTION update_nnva_updated_at();

DROP TRIGGER IF EXISTS trg_nnva_standard_updated_at ON sow_nnva_standard;
CREATE TRIGGER trg_nnva_standard_updated_at
    BEFORE UPDATE ON sow_nnva_standard
    FOR EACH ROW EXECUTE FUNCTION update_nnva_updated_at();

INSERT INTO sow_nnva_base (name) VALUES
    ('Setting'),
    ('Loading'),
    ('Unloading'),
    ('Measurement')
ON CONFLICT (name) DO NOTHING;

COMMIT;

