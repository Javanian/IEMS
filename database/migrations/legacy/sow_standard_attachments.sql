
CREATE TABLE IF NOT EXISTS public.sow_standard_attachments (
    id            bigserial PRIMARY KEY,
    standard_id   bigint NOT NULL REFERENCES public.sow_standard(id) ON DELETE CASCADE,
    filename      text NOT NULL,
    original_name text NOT NULL,
    file_path     text NOT NULL,
    file_size     integer,
    uploaded_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sow_std_attach_standard_id
    ON public.sow_standard_attachments(standard_id);

