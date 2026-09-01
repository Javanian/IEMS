
CREATE UNIQUE INDEX IF NOT EXISTS uq_ms_project_task_project_order_op
  ON public.ms_project_task (project_id, ltrim(order_no, '0'), operation_no)
  WHERE is_active
    AND NOT is_summary
    AND order_no IS NOT NULL
    AND operation_no IS NOT NULL;

COMMENT ON INDEX public.uq_ms_project_task_project_order_op IS
  'Satu operasi SAP (order_no, operation_no) hanya boleh dipetakan sekali per project. '
  'Mencegah Map SAP Operation yang dijalankan berulang menggandakan task — lihat migrasi '
  '20260804 dan docs/log/2026-08-04-duplikat-map-sap-operation.md.';

