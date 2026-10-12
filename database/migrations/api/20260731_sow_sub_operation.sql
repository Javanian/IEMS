
CREATE TABLE IF NOT EXISTS public.sow_sub_operation (
    id           bigserial PRIMARY KEY,
    operation_id integer   NOT NULL
                 REFERENCES public.sow(idsow) ON DELETE CASCADE,
    order_no     varchar(100),
    title        text      NOT NULL,
    sort_order   integer   NOT NULL DEFAULT 0,
    weight       numeric(6,2) NOT NULL DEFAULT 1,
    progress     smallint  NOT NULL DEFAULT 0
                 CHECK (progress BETWEEN 0 AND 100),
    status       text      NOT NULL DEFAULT 'NOT_STARTED'
                 CHECK (status IN ('NOT_STARTED','IN_PROGRESS','ON_HOLD','DONE')),
    is_active    boolean   NOT NULL DEFAULT true,
    msp_task_id  uuid,
    created_by   varchar(100),
    created_at   timestamptz DEFAULT now(),
    updated_by   varchar(100),
    updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sow_sub_operation_operation
    ON public.sow_sub_operation (operation_id);

CREATE INDEX IF NOT EXISTS idx_sow_sub_operation_order
    ON public.sow_sub_operation (order_no);

CREATE TABLE IF NOT EXISTS public.sow_sub_operation_progress_history (
    id                bigserial PRIMARY KEY,
    sub_operation_id  bigint    NOT NULL
                      REFERENCES public.sow_sub_operation(id) ON DELETE CASCADE,
    operation_id      integer,
    order_no          varchar(100),
    progress          smallint  NOT NULL
                      CHECK (progress BETWEEN 0 AND 100),
    issue_description text,
    image_path        varchar(500),
    created_at        timestamptz DEFAULT now(),
    created_by        varchar(100)
);

CREATE INDEX IF NOT EXISTS idx_sow_sub_op_prog_hist_sub
    ON public.sow_sub_operation_progress_history (sub_operation_id);

CREATE INDEX IF NOT EXISTS idx_sow_sub_op_prog_hist_created
    ON public.sow_sub_operation_progress_history (created_at DESC);

COMMENT ON TABLE public.sow_sub_operation IS
    'Child-task progress fisik per operasi SOW (varian manufaktur). Roll-up ke sow.progress controller-side; tidak pernah ke SAP.';
COMMENT ON COLUMN public.sow_sub_operation.operation_id IS
    'FK ke sow.idsow (1 operasi SAP). ON DELETE CASCADE.';
COMMENT ON COLUMN public.sow_sub_operation.weight IS
    'Bobot untuk weighted roll-up SUM(progress*weight)/SUM(weight) atas child aktif.';
COMMENT ON COLUMN public.sow_sub_operation.is_active IS
    'Soft-delete: false = dikeluarkan dari roll-up (bukan hapus baris).';
COMMENT ON COLUMN public.sow_sub_operation.msp_task_id IS
    'Opsional: tautan ke ms_project_task; child tetap web-authoritative.';

COMMENT ON TABLE public.sow_sub_operation_progress_history IS
    'Riwayat append-only update progress fisik child-task; foto disimpan ke disk (image_path).';

