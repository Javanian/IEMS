# Database — Panduan & Penjelasan

Folder ini adalah pusat pengelolaan skema dan data PostgreSQL untuk MPS2. Semua
perubahan struktur database **wajib lewat file migrasi** (bukan edit langsung ke
database produksi), dan setiap batch migrasi diikuti regenerasi dump kanonik.

---

## Daftar Isi

- [1. Struktur Folder](#1-struktur-folder)
- [2. Migration Runner (`migrate.js`)](#2-migration-runner-migratejs)
- [3. Menulis Migrasi Baru](#3-menulis-migrasi-baru)
- [4. Folder `migrations/deferred` (Ditahan)](#4-folder-migrationsdeferred-ditahan)
- [5. Folder `migrations/legacy` (Arsip)](#5-folder-migrationslegacy-arsip)
- [6. Schema Dump Kanonik](#6-schema-dump-kanonik)
- [7. Seeds & Tools Import](#7-seeds--tools-import)
- [8. Alur Kerja yang Disarankan](#8-alur-kerja-yang-disarankan)
- [9. Troubleshooting](#9-troubleshooting)

---

## 1. Struktur Folder

```
database/
├── migrate.js                       # Migration runner (CLI)
├── README.md                        # Panduan ini
├── migrations/
│   ├── api/                         # Migrasi AKTIF — satu-satunya yang dibaca runner
│   ├── deferred/                    # Migrasi DITAHAN (belum di-greenlight)
│   └── legacy/                      # Migrasi lama (era awal / BPN) — arsip
├── schema/
│   ├── schema_prod.sql              # Dump kanonik produksi (struktur, tanpa data)
│   ├── backup_restore.sql           # Skrip bantu backup/restore
│   └── schema_receiving_revised.sql # Referensi skema modul receiving (revisi)
├── seeds/                           # Seed/import SQL ad-hoc + helper script
├── machinehours/                    # Data & tool import machine hours
└── toolsmanagement/                 # Skema + seed data tools (alat ukur, hand/power/tap drill)
```

| Path | Fungsi |
|---|---|
| `migrations/api/` | Migrasi aktif. **Satu-satunya folder yang dipindai `migrate.js`** — file baru yang mau di-apply ditaruh di sini. |
| `migrations/deferred/` | Migrasi yang sengaja ditahan (lihat [bagian 4](#4-folder-migrationsdeferred-ditahan)). |
| `migrations/legacy/` | Migrasi lama yang pernah ada sebelum refactor — arsip, jangan di-apply. |
| `schema/schema_prod.sql` | Dump kanonik struktur produksi — baseline untuk membangun DB baru. |
| `seeds/`, `machinehours/`, `toolsmanagement/` | Data & tool seed/import (lihat [bagian 7](#7-seeds--tools-import)). |

---

## 2. Migration Runner (`migrate.js`)

Runner minimal tanpa dependency tambahan (hanya `pg`). Cara kerjanya:

1. Baca kredensial dari `.env` di root repo (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`).
2. Pastikan tabel ledger `public.schema_migrations` ada (`filename`, `applied_at`, `note`).
3. Pindai `database/migrations/api/*.sql`, urutkan **berdasarkan nama file**, ambil yang belum tercatat di ledger.
4. Apply tiap file **dalam satu transaksi** → sukses = dicatat ke ledger; gagal = ROLLBACK.
5. Berhenti di file pertama yang gagal — file yang sudah OK tidak diulang.

### Cara Pakai

```bash
# Lihat migrasi yang belum di-apply (tanpa menyentuh database)
node database/migrate.js --dry-run

# Apply semua migrasi pending
node database/migrate.js
```

Contoh output:

```
ledger: 81 tercatat | folder: 84 file | pending: 3
  pending: 20260813_sow_draft.sql
  pending: 20260813_sow_saved.sql
  pending: 20260819_sap_config_rules.sql
apply 20260813_sow_draft.sql ... OK
apply 20260813_sow_saved.sql ... OK
apply 20260819_sap_config_rules.sql ... OK
```

### Catatan Penting

- **Urutan = urutan nama file** (format `YYYYMMDD_deskripsi.sql`). Kalau dua migrasi dibuat di hari yang sama, beri suffix huruf (`20260804b_...`, `20260804c_...`) supaya urutannya jelas.
- **Ledger itu sumber kebenaran** — file yang sudah tercatat di `schema_migrations` tidak akan pernah di-apply ulang, meskipun isinya berubah.
- Migrasi yang sudah di-apply ke produksi **tidak boleh diedit**. Perbaikan = buat file migrasi baru.
- Runner membaca **satu environment per eksekusi**. MPS2 berjalan di lebih dari satu database (mis. CKP & BPN) — migrasi wajib di-apply ke **semua environment yang relevan**, dengan urutan yang disepakati. Untuk environment yang memakai *apply selektif* (sengaja melewati migrasi tertentu), catat alasan di kolom `note` ledger.

---

## 3. Menulis Migrasi Baru

Konvensi (sesuai komentar di `migrate.js`, D-R5):

| Aturan | Penjelasan |
|---|---|
| Nama file | `YYYYMMDD_deskripsi.sql` — urutan = urutan nama |
| `BEGIN` / `COMMIT` | **JANGAN ditulis** — runner yang membungkus transaksi |
| Idempotent | Usahakan `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ON CONFLICT` agar aman dijalankan ulang |
| `CREATE INDEX CONCURRENTLY` | Tidak bisa dalam transaksi → tulis baris pertama file: `-- migrate:no-transaction` |
| Edit migrasi ter-apply | Dilarang — buat file baru |
| Setelah batch | Regenerate `schema/schema_prod.sql` dari produksi |

Contoh migrasi sederhana:

```sql
-- database/migrations/api/20260820_add_something.sql
ALTER TABLE public.some_table
  ADD COLUMN IF NOT EXISTS new_column text NOT NULL DEFAULT '';
```

Contoh migrasi tanpa transaksi (index concurrent):

```sql
-- migrate:no-transaction
CREATE INDEX CONCURRENTLY idx_some_table_col
  ON public.some_table (col);
```

> Catatan: seluruh file migrasi di repo ini sudah dibersihkan dari komentar
> (2026-08) — tambahkan komentar hanya kalau benar-benar menjelaskan keputusan
> yang tidak bisa dibaca dari SQL-nya sendiri.

---

## 4. Folder `migrations/deferred` (Ditahan)

Migrasi yang **sengaja ditahan** dan belum di-greenlight diletakkan di sini —
runner **tidak** memindai folder ini, jadi aman dari eksekusi tidak sengaja.

Untuk mengaktifkan salah satu file:

1. Pindahkan file ke `../api/` (mis. `database/migrations/deferred/xxx.sql` → `database/migrations/api/xxx.sql`).
2. Jalankan runner: `node database/migrate.js --dry-run` lalu `node database/migrate.js`.

Isi saat ini (lihat `deferred/README.md` untuk detail):

| File | Konteks |
|---|---|
| `20260722_mch_transaction_no_overlap.sql` | Lapis 2 constraint anti-overlap interval jam mesin (versi awal, NON-deferrable — jangan di-apply sendiri) |
| `20260722_mch_transaction_no_overlap_deferrable.sql` | Perbaikan: `DEFERRABLE` — versi yang benar untuk di-apply |

Konteks penuh normalisasi interval jam mesin: `docs/concepts/mch-interval-normalization.md`
dan `docs/log/2026-07-22-mch-normalisasi-lapis.md`.

---

## 5. Folder `migrations/legacy` (Arsip)

Migrasi lama yang pernah dijalankan sebelum refactor runner (termasuk migrasi BPN
era awal). Folder ini **tidak dipindai runner** — isinya arsip/referensi untuk
memahami riwayat skema. Jangan di-apply ke database baru.

---

## 6. Schema Dump Kanonik

### `schema/schema_prod.sql`

Dump **struktur** (schema-only, tanpa data) dari database produksi. Fungsinya:

- Baseline untuk membangun database baru: restore file ini → jalankan
  `node database/migrate.js` (lihat `docs/deployment/DEPLOYMENT.md`).
- Referensi struktur terkini untuk review & diff.

Regenerate setelah setiap batch migrasi sukses di produksi:

```bash
# Via container database (contoh)
docker exec timesheet-db pg_dump -U <user> -d <db> --schema-only \
  > database/schema/schema_prod.sql
```

### File Lain

- `schema/backup_restore.sql` — skrip bantu backup/restore (referensi).
- `schema/schema_receiving_revised.sql` — skema modul receiving versi revisi
  (referensi; bukan bagian dari jalur migrasi aktif).

---

## 7. Seeds & Tools Import

Data & tool import TIDAK lewat runner migrasi — dijalankan manual per kebutuhan:

| Path | Tool | Fungsi |
|---|---|---|
| `machinehours/import_bpn_production_data.py` | Python | Import `BPN_ProductionData.csv` ke `public.mch_productiondata` |
| `machinehours/ph3_order_seed.js` | Node | Seed data `ph3_order` (mode: `template` / `dry-run` / `apply` / `export`) |
| `machinehours/*.csv` | Data | Sumber data import (BPN ProductionData, Machines, StatusTypes, viewSummary) |
| `toolsmanagement/seed_tools_from_csv.js` | Node | Seed data tools dari `alat ukur.csv`, `hand tool.csv`, `power tools.csv`, `tap drill.csv` |
| `toolsmanagement/tools_management_schema.sql` | SQL | Skema modul tools management |
| `seeds/*.sql` | SQL | Seed/import ad-hoc sekali pakai (mis. `import_machines_data.sql`, `machines_bulk_insert.sql`) |

> File `seeds/` berisi skrip sekali-pakai — baca isinya sebelum dijalankan, dan
> jangan anggap idempotent kecuali tertulis demikian.

---

## 8. Alur Kerja yang Disarankan

1. **Tulis** migrasi baru di `database/migrations/api/` sesuai konvensi (bagian 3).
2. **Cek** dengan `node database/migrate.js --dry-run`.
3. **Apply** ke environment satu per satu (urutan sesuai deploy: mis. CKP → BPN),
   verifikasi hasil (`\d nama_tabel` / query ledger).
4. Untuk environment dengan apply selektif, catat alasan di `note` ledger.
5. **Regenerate** `schema/schema_prod.sql` dari produksi.
6. **Update dokumentasi** (`docs/`) kalau migrasi mengubah perilaku sistem.

---

## 9. Troubleshooting

| Gejala | Penyebab & Solusi |
|---|---|
| `GAGAL: <error>` lalu runner berhenti | File migrasi error → ROLLBACK otomatis. Perbaiki file, jalankan ulang — file yang sudah OK tidak diulang (aman, idempotent). |
| File tidak muncul di `--dry-run` | Pastikan berada di `database/migrations/api/`, nama berakhiran `.sql`, atau sudah tercatat di ledger (`SELECT * FROM schema_migrations`). |
| Perlu apply hanya sebagian migrasi | Runner tidak mendukung seleksi per-file. Opsi: apply manual via `psql` lalu catat ke ledger secara manual (hati-hati, tanggung jawab ada di tangan pelaksana), atau pindahkan file ke folder lain dulu. |
| `CREATE INDEX CONCURRENTLY` gagal | Butuh marker `-- migrate:no-transaction` di baris pertama file (tidak bisa dalam transaksi). |
| Ledger hilang/rusak | Runner membuat `schema_migrations` otomatis (CREATE TABLE IF NOT EXISTS) — tapi riwayat `applied_at` tidak bisa dipulihkan dari file; pastikan backup DB rutin. |

---

## Referensi

- `docs/deployment/DEPLOYMENT.md` — alur deploy & pembangunan DB baru dari dump kanonik.
- `database/migrations/deferred/README.md` — detail migrasi yang ditahan.
- `docs/concepts/` dan `docs/log/` — konsep & keputusan di balik migrasi tertentu.
