CREATE TABLE IF NOT EXISTS public.tts_notification_order (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    path_mp3 TEXT NULL,
    ssbr_id TEXT,
    status BOOLEAN NOT NULL DEFAULT false,
    generation_status TEXT NOT NULL DEFAULT 'queued',
    error_message TEXT,
    attempts INT NOT NULL DEFAULT 0,
    log_audio JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_at TIMESTAMPTZ
);

ALTER TABLE public.tts_notification_order
    ALTER COLUMN path_mp3 DROP NOT NULL;

ALTER TABLE public.tts_notification_order
    ADD COLUMN IF NOT EXISTS ssbr_id TEXT;

ALTER TABLE public.tts_notification_order
    ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'queued';

ALTER TABLE public.tts_notification_order
    ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE public.tts_notification_order
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

ALTER TABLE public.tts_notification_order
    ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tts_notification_order_status_created
    ON public.tts_notification_order (status, created_at);

CREATE INDEX IF NOT EXISTS idx_tts_notification_order_generation_status_created
    ON public.tts_notification_order (generation_status, created_at);

UPDATE public.tts_notification_order
SET generation_status = 'ready'
WHERE path_mp3 IS NOT NULL
  AND generation_status = 'queued';
