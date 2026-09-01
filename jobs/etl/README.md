# ETL Jobs

Folder ini berisi job sinkronisasi PostgreSQL lokal, SQL Server machine data, dan transformasi tabel `mch_transaction`.

Script aktif membaca `.env` dari root repo jika tersedia.

## Script Python

| File | Fungsi Singkat | Contoh |
|---|---|---|
| `etl_sync_v2.py` | ETL utama untuk sinkronisasi data order/confirmation dari source PostgreSQL ke satu atau beberapa target PostgreSQL. Mendukung `LISTEN/NOTIFY`, polling berkala, batch processing, retry/backoff, dan update `status_etl`. | `python etl_sync_v2.py` |
| `etl_order.py` | Versi sederhana/awal untuk sync order confirmation dari `SRC_TABLE` ke `TGT_TABLE`, filter per `PLANT_FILTER`, strip leading zero pada nomor tertentu, lalu update `status_etl` dan isi tabel `sow`. | `python etl_order.py` |
| `etl_machinehours.py` | Mengambil data machine hours dari SQL Server `SSB_OEE`, transform hasil validasi machine hour, lalu upsert ke PostgreSQL `public.mch_transaction`. Bisa pakai range tanggal, truncate, batch size, dan dry-run. | `python etl_machinehours.py --dry-run` |
| `etl_machine_conf.py` | Update `ProductionData.JobID` di SQL Server memakai `confirmation_number` dari PostgreSQL, lalu sync `ProductionData` ke PostgreSQL `public.mch_productiondata`. Versi ini juga punya opsi refresh materialized view. | `python etl_machine_conf.py --from 2026-05-01 --dry-run` |
| `etl_machine_conf_ver1.py` | Versi lama dari `etl_machine_conf.py`. Fungsinya sama secara garis besar, tetapi default tanggal dan konfigurasi koneksi berbeda. Simpan sebagai referensi/backup bila perlu membandingkan behavior lama. | `python etl_machine_conf_ver1.py --dry-run` |
| `etl_mch_transaction.py` | Transform incremental dari `public.mch_productiondata` ke `public.mch_transaction`. Mengikuti logic `mv_mch_productiondata_detail` dan memakai lookup timesheet terdekat untuk status tertentu. | `python etl_mch_transaction.py --dry-run` |
| `etl_mch_transaction_v2.py` | Versi baru transform `mch_transaction`. Tidak memakai nearest-time lookup ke `timesheet_transaction`; operator diambil dari `mch_user`, job dari `ph3_order`, dan field SOW dari tabel `sow`. | `python etl_mch_transaction_v2.py --dry-run` |

## File SQL

| File | Fungsi Singkat |
|---|---|
| `etl_trigger.sql` | Script SQL yang dijalankan sekali di database source untuk membuat function dan trigger `pg_notify`. Trigger mengirim notifikasi ke channel `etl_new_row` saat row `ph3_order` dengan `status_etl = 'NEW'` di-insert/update. |

## File Docker dan Dependency

| File | Fungsi Singkat |
|---|---|
| `Dockerfile.etl` | Image Python 3.11 slim untuk menjalankan ETL container. Default command menjalankan `etl_sync_v2.py`. |
| `docker-compose.etl.yml` | Compose service `timesheet_sap_etl` yang build dari `Dockerfile.etl`, membaca `.env` root repo, mount folder ETL ke `/app`, dan restart otomatis. |
| `requirements.txt` | Dependency Python untuk job ETL: `psycopg2-binary`, `python-dotenv`, dan `pyodbc`. |

## Dokumentasi Pendukung

| File | Isi |
|---|---|
| `ETL_SYNC_V2_GUIDE.md` | Panduan detail konfigurasi dan operasional `etl_sync_v2.py`. |
| `etl_mchtransaction.md` | Catatan/panduan untuk proses transformasi `mch_transaction`. |
| `etl_sync_v2_analysis.md` | Analisis implementasi `etl_sync_v2.py`. |
| `task_etl.md` | Catatan task dan requirement historis untuk pekerjaan ETL. |

## Commands Cepat

```powershell
python etl_sync_v2.py
python etl_mch_transaction.py --dry-run
python etl_mch_transaction_v2.py --dry-run
python etl_machinehours.py --dry-run
python etl_machine_conf.py --dry-run
```
