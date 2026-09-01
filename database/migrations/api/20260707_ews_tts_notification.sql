
BEGIN;

CREATE SCHEMA IF NOT EXISTS ews;

CREATE TABLE IF NOT EXISTS ews.tts_notification (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issue_key          TEXT UNIQUE,
    kpi_type           TEXT,
    severity           TEXT,
    title              TEXT,
    message            TEXT NOT NULL,
    path_mp3           TEXT,
    generation_status  TEXT NOT NULL DEFAULT 'queued',
    error_message      TEXT,
    attempts           INT  NOT NULL DEFAULT 0,
    played             BOOLEAN NOT NULL DEFAULT false,
    log_audio          JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ews_tts_status_created
    ON ews.tts_notification (generation_status, created_at);

CREATE INDEX IF NOT EXISTS idx_ews_tts_ready_unplayed
    ON ews.tts_notification (played, generated_at DESC)
    WHERE generation_status = 'ready';

COMMIT;

