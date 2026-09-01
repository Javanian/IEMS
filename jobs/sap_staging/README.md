# SAP Staging Jobs

Menyiapkan payload timesheet & jam mesin ke `sap_timesheet_staging`, lalu mengirimkannya ke SAP.
Semua script membaca `.env` dari root repo `MPS2/.env`.

> **Ini jalur payroll.** Kesalahan di sini = jam kerja hilang, dobel, atau salah pemilik.
> Baca bagian **[Pengaman](#pengaman-jangan-dilucuti)** dan **[Batas Berbahaya](#-batas-berbahaya)**
> sebelum mengubah apa pun. Latar belakang: `docs/concepts/sap-staging-identity.md`.

---

## Alur

```
SQL Server ──[ETL]──> mch_productiondata ──[ETL]──> mch_transaction
                                  (+ mch_transaction_override)   │
                                                                 │
                          (gerbang kelayakan) ──> bundling per HARI ──┬──> NORMAL   ──> sap_timesheet_staging (PENDING)
                                                                      └──> KOREKSI  ──> sap_timesheet_staging (PENDING, is_correction)
                                                                                             │
                          sap_staging_source (provenance/segmen) <───────────────────────────┤
                                                                                             │
                                                    post_sap_staging.py ──> SAP ──> POSTED / FAILED / SKIPPED
```

- **NORMAL** = kerja baru di hari yang belum ditutup → auto-post begitu hari selesai.
- **KOREKSI** = jam yang baru lengkap **setelah** harinya sudah ter-post → bundel terpisah,
  **tidak** auto-post, admin kirim manual dari UI. Konfirmasi SAP bersifat **aditif**, jadi
  koreksi menambah jam ke order — **tanpa storno**.

---

## Aturan Kelayakan (mch_transaction → staging)

Sebuah baris hanya di-stage bila **semua** benar:

| Syarat | Kenapa |
|---|---|
| `startdatetime`, `enddatetime` ada & `end > start` | durasi valid |
| **`sn_employee` terisi** | tanpa ini PERNR kosong → **jam kerja tanpa pemilik** (gerbang operator, 2026-07-14) |
| `statusid` **bukan** 0, 3, 4 | Off / Downtime / No Job — bukan kerja pada order |
| bila `statusid` = 5 → durasi **≤ 60 detik** | Unidentified singkat = celah antar aktivitas; yang panjang tidak dikirim |
| **salah satu jalur di bawah** | produktif **atau** unproductive |

**Dua jalur kelayakan:**

| Jalur | Syarat tambahan | Butuh `confirmation_number`? |
|---|---|---|
| **Produktif** | `status_activitytype ∈ {M1, M2}` **atau** idle-promotable (`statusid=2 ∧ prev=1 ∧ ≤300 dtk`) | **Ya** — SAP butuh RUECK untuk konfirmasi order |
| **Unproductive** | `status_activitytype` terisi, **bukan** M1/M2, **bukan** idle-promotable | **Tidak** — LSTAR tanpa order; tak ada yang dikonfirmasi |

> ⚠️ **JANGAN pakai kolom `status_record` sebagai gerbang.** Definisinya punya pintu belakang
> (`statusid IN (0,3,4) OR ...`), sehingga baris **tanpa operator tetap lolos**.
> `status_record` = kelengkapan data untuk KPI `accuracy_machine`, **bukan** kelayakan SAP.
> (Kelayakan SAP = dua jalur di atas; kebetulan mirip, tapi bukan kolom yang sama.)

**Filter durasi bundel:** setelah dibundel, bundel dengan `total_seconds < 60` **dibuang** —
SAP menolak konfirmasi < 1 menit. Jadi sekumpulan record sub-menit di hari yang sama bisa
tergabung jadi 1 bundel yang lolos, tapi bundel < 1 menit tidak akan pernah dikirim.

### Peta `statusid` (diverifikasi dari data — 3 & 4 mudah tertukar!)

| id | Deskripsi | id | Deskripsi | id | Deskripsi |
|---|---|---|---|---|---|
| 0 | Off ❌ | 6 | Load (M2) | 13 | Daily PM |
| 1 | Productive (M1) | 7 | Setting (M2) | 14 | Tool Preparation |
| 2 | Idle | 8 | Measure (M2) | 15 | Labour Necessity |
| **3** | **Downtime** ❌ | 9 | Unload (M2) | 16–21 | Jig/Waiting/Wait… |
| **4** | **No Job** ❌ | 11 | Breakdown | | |
| 5 | Unidentified (≤60 dtk saja) | 12 | Coffee Break / Lunch | | |

❌ = tidak masuk staging.

---

## Bentuk Payload

| Jenis | Syarat | ZCONF_TYPE | RUECK | AUFNR/VORNR | LSTAR | ZBARCODEID |
|---|---|---|---|---|---|---|
| **Produktif M1** | `status_activitytype = M1` | `M1` | terisi | terisi | — | **`VA`** |
| **Produktif M2** | `status_activitytype = M2` | `M2` | terisi | terisi | — | teks status (`Setting`, `Measure`, `Load`, `Unload`) |
| **Idle → M2** | `statusid=2` **∧** `previoustatusid=1` **∧** durasi **≤300 dtk** | `M2` | terisi | terisi | — | **`Idle`** |
| **Unproductive** | selain di atas | *(kosong)* | *(kosong)* | **kosong** | activity type | *(kosong)* |

**Idle pendek setelah produksi = micro-stop**, bukan waktu terbuang → diperlakukan sebagai setup (M2).

⚠️ AUFNR/VORNR dikosongkan **di KUNCI bundling juga**, bukan cuma di payload. Kalau hanya di
payload, dua bundel yang cuma beda order akan menghasilkan **payload kembar** dan SAP menerima keduanya.

**Waktu yang dikirim ke SAP bersifat sintetis:** `ISDD/ISDZ` = jangkar ke **start asli paling awal**
di hari itu (`source_min_start`), `IEDD/IEDZ` = jangkar + total durasi. Yang akurat adalah
**durasi**, bukan jendela waktunya.

---

## Bundling — per HARI

Satu baris staging = satu bundel **(hari × operator × order × operasi × mesin × jenis aktivitas)**.
Baris `mch_transaction` yang melintasi tengah malam **dipotong per hari** (event 23:40→00:20 → 2 segmen).

> Dulu bundling **per jam**; sekarang **per hari**. Alasan: bundling per jam membuang record
> yang tiap jam-nya < 1 menit walau total sehari > 1 menit. Per hari, record sub-menit di jam
> berbeda ikut tergabung dan lolos filter ≥ 60 detik.

`norm_key = md5(werks | day_bucket | employee | rueck | aufnr | vornr | flgat | plnfl |
vornr_b | vornr_r | zconf_type | arbpl | lstar | zbarcodeid)`

- **NORMAL**: `source_key = norm_key`, `is_correction = false`.
- **KOREKSI**: `source_key = md5(norm_key | '|KOREKSI|' | seg_hash)`, `is_correction = true`
  (kunci beda supaya koreksi tak bentrok dengan bundel normal hari yang sama).

> 🚨 **Mengubah komposisi md5 ini = SELURUH riwayat berganti kunci.** Lihat [Pengaman](#pengaman-jangan-dilucuti).

---

## Normal vs Koreksi (routing per HARI)

Rutenya ditentukan oleh **apakah harinya sudah punya bundel POSTED**:

| Kondisi hari | Mode | Ke mana | Auto-post? |
|---|---|---|---|
| Belum ada bundel POSTED (hari terbuka) | **NORMAL** | PENDING `is_correction=false` | **Ya** — begitu hari selesai (`bucket_start < hari ini`) |
| Sudah ada ≥1 bundel POSTED (hari ditutup) + record belum punya provenance | **KOREKSI** | PENDING `is_correction=true` | **Tidak** — admin kirim manual dari UI |

Kenapa day-level, bukan key-level: begitu **satu** bundel hari itu ter-post, hari itu dianggap
"ditutup". Record baru/diperbaiki untuk hari itu (operator/order yang belum pernah di-post) →
**koreksi**, supaya masuk antrian review — bukan diam-diam auto-post ke hari yang sudah dilaporkan.

**Guard hari-selesai (di poster):** auto-poster hanya klaim bundel MCH_HOURS dengan
`bucket_start::date < hari ini` (Asia/Makassar). Hari yang masih tumbuh tidak boleh dikunci.
`--include-today` untuk override manual.

**Auto-poster SKIP koreksi:** `claim_rows` memfilter `is_correction = false`. Koreksi hanya
terkirim lewat `--ids` (tombol **Post selected** di UI → aksi `post_corrections` di ops_worker).

---

## Tabel

| Tabel | Isi |
|---|---|
| `sap_timesheet_staging` | Antrian payload. `ztimesheetid` = `id::text` (GENERATED). `is_productive` = `zconf_type IN (M1,M2)` (GENERATED). **`is_correction`** = bundel koreksi (tidak auto-post) |
| **`sap_staging_source`** | **Provenance**: bundel ini dari record sumber mana (segmen: `source_row_id` + `bucket_start` + detik). Jangkar semua pengaman |
| **`mch_transaction_override`** | Koreksi manual admin (job/operator) yang di-apply ETL saat menurunkan `mch_transaction` |
| **`sap_ops_request`** | Antrian aksi dari tombol UI (`stage_catchup`/`retry_failed`/`post_corrections`). Dikonsumsi `ops_worker.py` |
| **`sap_source_change_blocked`** | Log percobaan mengubah record yang sudah terkirim ke SAP (ditolak trigger pembekuan) |
| `sap_stage_cursor` | Posisi terakhir staging job |
| `sap_staging_eligibility_audit` | Audit kenapa source row belum layak |
| `log_timesheet_sap` | Audit tiap kiriman ke SAP (dipakai guard "ZTIMESHEETID terbakar") |

---

## Script

| Script | Fungsi |
|---|---|
| `stage_machinehours.py` | Job rutin jam mesin (cursor) + **catch-up** (menjalankan mode NORMAL **dan** KOREKSI) |
| `stage_timesheet_transaction.py` | Job rutin timesheet operator (cursor) |
| `stage_sap_timesheet.py` | Mesin bundling + tool manual (init-db, stage ad-hoc). Berisi SQL bundling — **inti dari semua aturan di atas**. `mode="normal"` / `mode="correction"` |
| **`rebuild_machinehours.py`** | **Bangun ulang antrian** setelah bentuk payload/aturan berubah |
| **`backfill_operator.py`** | Isi ulang `operatorid` di record lama dari `usernfc` (bedah, `--snssb`/`--all`/`--since`/`--dry-run`) |
| `post_sap_staging.py` | Kirim payload ke SAP (paralel, ber-guard, guard hari-selesai) |
| **`ops_worker.py`** | **Konsumen antrian `sap_ops_request`** — menjalankan script di atas saat tombol UI menitip permintaan |
| `sap_staging_common.py` | Helper: koneksi, DDL, insert staging + provenance, builder payload, cursor |
| `seed_sap_staging_manual.py` | Seed payload manual untuk testing |

---

## Otomatis vs Manual — siapa jalan sendiri, siapa perlu dipicu

> Inti: **bundling & posting hari selesai jalan otomatis**; **koreksi selalu manual** (review admin).

### Yang berjalan OTOMATIS (service compose, tanpa dipegang)

| Service compose | Menjalankan | Tugas |
|---|---|---|
| ETL (`docker-compose.etl.yml`) | `etl_mch_transaction_v3.py` | Turunkan `mch_transaction` + apply `mch_transaction_override` |
| `sap-stage-worker` | loop `stage_machinehours.py --catchup` | Bundling NORMAL + KOREKSI |
| `sap-post-worker` | loop `post_sap_staging.py` | Auto-post PENDING **non-koreksi**, **hari selesai saja** |
| `sap-ops-worker` | `ops_worker.py --loop` | Konsumen antrian tombol UI (lihat bawah) |

Urutan otomatis (berulang tiap interval):

```
ETL  →  sap-stage-worker (bundling)  →  sap-post-worker (post hari selesai)
                                         └─ KOREKSI dilewati, nunggu admin
```

Interval di `.env` (opsional): `SAP_STAGE_INTERVAL` (900s), `SAP_POST_INTERVAL` (1800s),
`SAP_POST_LIMIT` (500), `SAP_POST_WORKERS` (5), `SAP_OPS_INTERVAL` (10s).

### Yang MANUAL (tombol UI → antrian → ops_worker)

`ops_worker.py` **bukan** scheduler dan **tidak** membundel sendiri. Ia menunggu baris di
`sap_ops_request` yang ditulis API saat tombol ditekan (Node tak bisa jalankan Python langsung),
lalu menjalankan script yang dipetakan:

| Tombol UI (halaman SAP-log) | Aksi antrian | Perintah yang dijalankan ops_worker |
|---|---|---|
| **Stage edited records** | `stage_catchup` | `stage_machinehours.py --catchup` |
| **Post selected** (tab Corrections) | `post_corrections` | `post_sap_staging.py --ids <…> --workers 3` |
| **Retry failed** | `retry_failed` | `post_sap_staging.py --failed-only` |

Alur koreksi dari UI (manual, urut):

```
1. Admin edit record di tab Operator Hours (assign Job/Operator)  → tulis mch_transaction_override
2. ETL re-derive mch_transaction (otomatis di run berikut)
3. Klik "Stage edited records"  → ops_worker: stage_catchup  → record hari-tertutup jadi bundel KOREKSI
4. Buka tab Corrections → review → centang → "Post selected"  → ops_worker: post_corrections → SAP
```

---

## Perintah (CLI langsung — untuk operator/debug)

### Staging rutin & catch-up
```bash
cd jobs/sap_staging
python stage_machinehours.py                 # jam terakhir + catch-up otomatis (14 hari)
python stage_machinehours.py --catchup                    # HANYA catch-up (NORMAL + KOREKSI)
python stage_machinehours.py --catchup --catchup-days 20
python stage_machinehours.py --dry-run
python stage_machinehours.py --from-ts 2026-07-01T00:00:00 --to-ts 2026-07-02T00:00:00
```
Catch-up mencari record **layak** yang **belum punya provenance** — mustahil melewatkan apa pun.

**Lantai otomatis:** catch-up tidak menyentuh tanggal sebelum bucket paling awal di antrian.
Tanpa lantai ini, ia menemukan data lama yang **sudah terkirim ke SAP tanpa provenance** dan
mengirimnya lagi. Override `--catchup-since` **hanya** kalau kamu paham konsekuensinya.

### Rebuild — setelah aturan/bentuk payload berubah
```bash
python rebuild_machinehours.py --from 2026-07-01 --to 2026-07-17 --dry-run
python rebuild_machinehours.py --from 2026-07-01 --to 2026-07-17
python rebuild_machinehours.py --full-reset --from 2026-07-01 --to 2026-07-17   # hapus SEMUA + ID→1
```
Hapus baris **BELUM terkirim**, stage ulang dengan aturan terbaru. **Baris POSTED + provenance-nya
tidak pernah disentuh** — itulah ingatan yang mencegah double-post.
`--full-reset` **hanya sah bila SEMUA baris POSTED sudah di-STORNO di SAP.**

### Posting
```bash
python post_sap_staging.py --limit 500 --workers 5           # auto-post: PENDING non-koreksi, hari selesai
python post_sap_staging.py --failed-only --limit 200         # tombol "Retry failed" — HANYA FAILED
python post_sap_staging.py --ids 123,124 --workers 3         # tombol "Post selected" — koreksi tertentu
python post_sap_staging.py --include-today --limit 500       # ikutkan hari berjalan (hati-hati)
python post_sap_staging.py --productive-only --limit 1200 --workers 5   # selagi unproductive ditolak SAP
```

| Flag | Guna |
|---|---|
| `--workers N` | Kiriman paralel. **Paralel ANTAR-ORDER, serial DI DALAM order** (SAP mengunci order). Mulai 4–5 |
| `--failed-only` | Hanya baris FAILED — tidak menyentuh PENDING (tombol "Retry failed") |
| `--include-today` | Ikutkan bundel MCH_HOURS hari berjalan (default: hanya hari selesai) |
| `--ids` / `--ztimesheetids` | Kirim baris tertentu (koreksi via tombol "Post selected") |
| `--productive-only` / `--unproductive-only` | Filter `is_productive` |
| `--retry-failed` | Ikutkan FAILED **bersama** PENDING dalam satu run |
| `--max-retries` (3) | Retry **kegagalan jaringan** & **kunci order**, bukan penolakan bisnis |
| `--retry-backoff` (2.0) | Jeda dasar antar retry (naik linear) |
| `--delay-ms` (100) | Throttle per worker — naikkan kalau CPI memutus koneksi |

**Kinerja:** 13,2 dtk/baris → **1,7 dtk/baris** setelah (a) koneksi DB dipakai ulang per thread,
dan (b) paralel per-order. **Jalankan di server, bukan dari laptop** — koneksi DB di server ~5 ms,
bukan 2.622 ms lewat tunnel Tailscale.

### Backfill operator (record lama tanpa operatorid)
```bash
python backfill_operator.py --dry-run --all
python backfill_operator.py --snssb 0123456789          # satu operator
python backfill_operator.py --since 2026-07-01 --all
```

---

## Deploy service pipeline

Bagian dari stack utama (`timesheet-network` + `DB_HOST=pgbouncer`, sama seperti `api`, supaya
worker melihat antrian yang ditulis aplikasi):

```bash
# kalau sebelumnya pakai compose terpisah, buang container lama dulu:
docker rm -f sap-stage-worker sap-post-worker sap-ops-worker 2>/dev/null

docker compose up -d --build sap-stage-worker sap-post-worker sap-ops-worker
docker logs sap-ops-worker --tail 20   # cari "ops_worker target DB: host=pgbouncer ..."
```

Kode script di-mount (`./jobs/sap_staging:/app`) → perubahan kode cukup `git pull` + restart
container (loop menjalankan script sebagai proses fresh, jadi kode baru terbaca). Rebuild image
(`--build`) hanya perlu kalau `requirements`/Dockerfile berubah.

---

## Pengaman (jangan dilucuti)

### Jebakan yang mendasari semuanya

`ZTIMESHEETID = sap_timesheet_staging.id::text` — **nomor baris, bukan turunan data sumber.**
SAP menolak ZTIMESHEETID ganda, **tapi itu tidak melindungi kita**: begitu `source_key` berubah —
karena **kode** (resep md5 diubah, `PLANT_SSB` diganti) atau karena **data** (order_no diperbaiki) —
lahir baris staging **baru** → `id` baru → ZTIMESHEETID baru → **SAP menerimanya sebagai kiriman
baru** → jam masuk **dua kali**.

**Jangkar yang benar = SEGMEN `(proddataid, bucket_start)`** — tidak berubah walau resep md5,
format, atau plant diubah. Bukan `proddataid` saja: bundling memotong record lintas-hari, jadi satu
proddataid **sah** muncul di beberapa bundel (segmen).

### Lapisan

| # | Pengaman | Letak |
|---|---|---|
| 1 | **Unique index parsial** `WHERE posted_at IS NOT NULL` — satu segmen **mustahil** ter-POST dua kali. Database yang menolak, bukan disiplin manusia | `sap_staging_source` |
| 2 | **Guard poster** — sebelum kirim: segmen sudah ter-POST? `source_key` **sama** → skip (re-run). **Beda** → **KONFLIK** → `SKIPPED` + "butuh storno di SAP" | `post_sap_staging.py` |
| 3 | **Guard hari-selesai** — auto-poster hanya klaim bundel MCH_HOURS `bucket_start < hari ini`; hari yang masih tumbuh tidak dikunci | `post_sap_staging.py` |
| 4 | **Auto-poster SKIP koreksi** — `is_correction=true` tak pernah auto-post; hanya lewat `--ids` (tombol admin) | `post_sap_staging.py` |
| 5 | **Trigger pembekuan** — field kunci record yang **sudah terkirim** tidak bisa diubah; percobaan dicatat ke `sap_source_change_blocked`. ETL tidak putus | `mch_transaction` |
| 6 | **Trigger invalidasi** — record sumber berubah & bundelnya masih PENDING → bundel usang **dihapus** → catch-up men-stage ulang | `mch_transaction` |
| + | **Guard ZTIMESHEETID terbakar** — cek `log_timesheet_sap`: ID ini pernah SUCCESS di SAP? → `SKIPPED` | `post_sap_staging.py` |

### Lingkaran perbaikan data

```
EWS accuracy_machine menunjuk record tak lengkap
   → admin memperbaiki (mch_transaction_override) → ETL re-derive mch_transaction
   → trigger invalidasi hapus bundel PENDING usang
   → catch-up men-stage ulang (NORMAL bila hari terbuka, KOREKSI bila hari sudah ditutup)
   → poster (auto untuk normal / manual untuk koreksi) mengirim
```

---

## ⚠️ Batas Berbahaya

1. **JANGAN ubah komposisi md5 `source_key`** tanpa rencana. Semua riwayat berganti kunci →
   dianggap baru → dikirim ulang ke SAP. (Guard segmen akan menangkapnya, tapi jangan uji nasib.)
2. **JANGAN reset sequence `id`** tanpa storno semua POSTED di SAP dulu. ZTIMESHEETID yang pernah
   diterima SAP akan terpakai ulang → penolakan duplikat pada baris yang sah.
3. **JANGAN rebuild/catch-up tanggal di luar rentang yang dikelola.** Data lama (mis. Juni) sudah
   terkirim ke SAP **tanpa provenance** — men-stage-nya lagi = jam masuk dua kali.
4. **JANGAN pertahankan `status_record` sebagai gerbang** (lihat atas).
5. **JANGAN paksa `--include-today`** pada hari berjalan kecuali kamu memang mau mengunci hari itu —
   record yang masuk setelahnya jadi KOREKSI (harus dikirim manual).
6. **Jangan tulis tanda persen (`%`) di komentar SQL** yang dieksekusi psycopg2 — dibaca sebagai
   placeholder format, seluruh query gagal.

---

## Masalah Terbuka

- **Unproductive ditolak SAP**: *"Enter activity type only in conjunction with cost center"*.
  Payload **tidak punya field KOSTL**, dan `cost_center` di `mch_transaction` hanya terisi ~14%.
  Perbaikan ada **di sisi SAP** (kemungkinan menurunkan KOSTL dari work center/ARBPL).
  Sementara itu: kirim dengan `--productive-only`.
- **Tidak ada STORNO**: guard hanya **mendeteksi** konflik; pembatalan kiriman salah di SAP masih manual.

---

## Membaca Error SAP

| Pesan | Arti | Aksi |
|---|---|---|
| `Order X is already being processed by SAPCI` | Kunci order sementara — dua kiriman untuk order sama bersamaan | Otomatis di-retry. Kalau sering: turunkan `--workers` |
| `User status TECO is active` | Order sudah *technically complete* — tidak bisa menerima konfirmasi | Keputusan bisnis: buka TECO di SAP, atau relakan |
| `Enter activity type only in conjunction with cost center` | Baris unproductive (LSTAR tanpa KOSTL) | Tunggu perbaikan sisi SAP |
| `SSL: UNEXPECTED_EOF` / `read operation timed out` | **Jaringan**, bukan penolakan SAP. Request mungkin sampai, mungkin tidak | Retry **aman** (ID sama → SAP tolak duplikat, tidak dobel) |

---

## Audit Cepat

```sql
-- Bundel ini dari record mana saja?
SELECT source_row_id, seconds FROM sap_staging_source WHERE staging_id = 163449;

-- Record ini sudah pernah ke SAP?
SELECT t.id, t.status, t.posted_at FROM sap_staging_source s
JOIN sap_timesheet_staging t ON t.id = s.staging_id
WHERE s.source_row_id = '501523';

-- Kondisi antrian (normal vs koreksi)
SELECT status, is_correction, is_productive, count(*)
FROM sap_timesheet_staging GROUP BY 1,2,3 ORDER BY 1,2,3;

-- Koreksi menunggu dikirim admin
SELECT bucket_start::date, count(*), round(sum(total_seconds)/60.0,1) AS menit
FROM sap_timesheet_staging WHERE is_correction AND status='PENDING'
GROUP BY 1 ORDER BY 1;

-- Antrian tombol UI
SELECT id, action, status, requested_at, started_at, finished_at
FROM sap_ops_request ORDER BY id DESC LIMIT 20;

-- Perubahan data yang DITOLAK karena sudah terkirim ke SAP
SELECT * FROM sap_source_change_blocked ORDER BY blocked_at DESC LIMIT 20;
```

---

## Env

```text
DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD     # source (mch_transaction, timesheet)
PLANT_SSB TIMEZONE TGT_TABLE
SAP_INBOUND_URL SAP_INBOUND_USERNAME SAP_INBOUND_PASSWORD

SAP_STAGING_DB_HOST SAP_STAGING_DB_PORT ...     # opsional: staging DB terpisah
SAP_STAGE_INITIAL_FROM_TS SAP_STAGE_CURSOR_OVERLAP_MINUTES SAP_STAGE_SAFETY_DELAY_MINUTES

# interval service compose (opsional)
SAP_STAGE_INTERVAL SAP_POST_INTERVAL SAP_POST_LIMIT SAP_POST_WORKERS SAP_OPS_INTERVAL
```
