# Migration yang SENGAJA ditahan (belum di-apply)

`database/migrate.js` hanya memindai `migrations/api/`. File di folder ini **tidak** ikut
`node database/migrate.js` — ditaruh di sini dengan sengaja sampai di-greenlight.

Untuk mengaktifkan salah satu: pindahkan kembali ke `../api/` lalu jalankan runner.

## Isi

### `20260722_mch_transaction_no_overlap*.sql` — Lapis 2 constraint anti-overlap

Bagian dari normalisasi interval jam mesin (lihat
`docs/concepts/mch-interval-normalization.md`). Lapis 1 (kolom `end_effective` + ETL
recompute + konsumen `COALESCE(end_effective, enddatetime)`) harus **stabil lebih dulu**;
constraint ini baru dipasang setelah itu.

Dua file, urut: `no_overlap.sql` (versi awal, NON-deferrable — **jangan** apply sendiri,
bikin ETL gagal acak) lalu `no_overlap_deferrable.sql` (perbaikan: DROP + ADD ulang
`DEFERRABLE`). Kalau nanti di-apply, apply **keduanya** berurutan, atau ganti jadi satu
file DEFERRABLE langsung.

Konteks penuh: `docs/log/2026-07-22-mch-normalisasi-lapis.md`.
