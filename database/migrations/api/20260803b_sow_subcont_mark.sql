
CREATE TABLE IF NOT EXISTS public.sow_subcont_mark (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_no            text        NOT NULL,
  operation_no        integer     NOT NULL,
  original_workcenter text,
  note                text,
  marked_by           text,
  marked_at           timestamptz NOT NULL DEFAULT now(),
  unmarked_by         text,
  unmarked_at         timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_subcont_mark_active
  ON public.sow_subcont_mark (ltrim(order_no, '0'), operation_no)
  WHERE unmarked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sow_subcont_mark_order
  ON public.sow_subcont_mark (ltrim(order_no, '0'))
  WHERE unmarked_at IS NULL;

COMMENT ON TABLE public.sow_subcont_mark IS
  'Penanda operasi SOW dikerjakan subcont (D4): jadwal start/finish TETAP ada, tapi jamnya '
  'dikeluarkan dari agregasi beban internal lewat predikat NOT EXISTS ber-ltrim. '
  'Tabel TERPISAH dari sow dan TANPA FK ke sow(idsow) secara sengaja: saveSowOrderRevision '
  'melakukan DELETE+INSERT dengan whitelist 33 kolom EDITABLE_SOW_COLUMNS '
  '(sowController.js:27-61), jadi kolom baru apa pun di sow dijamin hilang saat Create Revision '
  '(anomali A-01, docs/MFG_PLAN_AREA_PLAN.md) dan idsow berganti tiap revisi. '
  'Kunci logis = (ltrim(order_no,''0''), operation_no), bertahan lintas revisi.';

COMMENT ON COLUMN public.sow_subcont_mark.order_no IS
  'Nomor order SAP apa adanya saat ditandai. Pencocokan SELALU lewat ltrim(order_no,''0'') — '
  'konsisten dengan seluruh kodebase (getSowOrderOperations, listBaySchedules, dll).';

COMMENT ON COLUMN public.sow_subcont_mark.original_workcenter IS
  'Salinan sow.workcenter saat penandaan, untuk audit & pelaporan jam subcont per workcenter '
  'asal. HANYA salinan: sow.workcenter TIDAK PERNAH diubah (ETL etl_sync_v2.py:504-513 '
  'menimpanya tanpa syarat, jadi menaruh penanda di sana akan hilang diam-diam).';

COMMENT ON COLUMN public.sow_subcont_mark.unmarked_at IS
  'Soft-unmark: NULL = tanda AKTIF (dipakai predikat eksklusi & index parsial). Baris tidak '
  'pernah dihapus supaya riwayat siapa menandai/membatalkan tetap ada.';

COMMENT ON COLUMN public.sow_subcont_mark.marked_by IS
  'Aktor dari header sesi x-user-name / x-user-id, BUKAN dari body request.';

