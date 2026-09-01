
CREATE TABLE IF NOT EXISTS public.sap_ops_request (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action       text        NOT NULL,
    params       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    status       text        NOT NULL DEFAULT 'QUEUED',
    requested_by text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz,
    result       text,
    error        text,
    CONSTRAINT sap_ops_request_action_ck
      CHECK (action IN ('stage_catchup', 'retry_failed')),
    CONSTRAINT sap_ops_request_status_ck
      CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'ERROR'))
);

CREATE INDEX IF NOT EXISTS idx_sap_ops_request_status
    ON public.sap_ops_request (status, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_ops_request_active
    ON public.sap_ops_request (action)
    WHERE status IN ('QUEUED', 'RUNNING');

