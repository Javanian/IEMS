
CREATE TABLE IF NOT EXISTS public.device_status (
    device_id       text PRIMARY KEY,
    device_name     text,
    model           text,
    app_version     text,
    android_version text,
    battery_pct     smallint,
    charging        boolean NOT NULL DEFAULT false,
    ip              text,
    interval_sec    integer NOT NULL DEFAULT 60,
    last_seen       timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ews.device_heartbeat_daily (
    work_date    date    NOT NULL,
    device_id    text    NOT NULL,
    beats        bigint  NOT NULL DEFAULT 0,
    interval_sec integer NOT NULL DEFAULT 60,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_date, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_hb_daily_device
    ON ews.device_heartbeat_daily (device_id, work_date DESC);

