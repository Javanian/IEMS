
DROP INDEX IF EXISTS public.uq_ms_project_task_project_order_op;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ms_project_task_order_op
  ON public.ms_project_task (ltrim(order_no, '0'), operation_no)
  WHERE is_active
    AND NOT is_summary
    AND order_no IS NOT NULL
    AND operation_no IS NOT NULL;

COMMENT ON INDEX public.uq_ms_project_task_order_op IS
  'Satu operasi SAP (order_no, operation_no) hanya boleh punya SATU task aktif di seluruh '
  'database — bukan sekadar satu per project. Menegakkan aturan owner "order + operation unik" '
  'yang sudah berlaku di public.sow (uq_sow_order_operation). Lihat '
  'docs/log/2026-08-04-duplikat-map-sap-operation.md.';

