"""
rebuild_machinehours.py — bangun ulang antrian staging jam mesin dari nol.

Dipakai saat BENTUK PAYLOAD berubah (mis. AUFNR/VORNR dikosongkan untuk unproductive,
ZBARCODEID='VA' untuk M1). Perubahan itu mengubah source_key (md5), sehingga baris
staging lama menjadi USANG: payload-nya format lama, dan re-stage biasa hanya menambah
baris baru tanpa membuang yang lama.

YANG DILAKUKAN:
  1. HAPUS baris staging yang BELUM terkirim (PENDING/FAILED/SKIPPED) pada rentang tanggal.
  2. Baris POSTED **TIDAK PERNAH DISENTUH** — beserta provenance-nya. Itulah ingatan
     sistem bahwa segmen tsb sudah ada di SAP; menghapusnya = membuka jalan double-post.
  3. Reset cursor MCH_HOURS ke awal rentang.
  4. Stage ulang jam demi jam dengan bundling/payload terbaru.

Baris baru yang ternyata memuat segmen yang SUDAH ter-post akan otomatis ditolak
guard di post_sap_staging (status SKIPPED) — jadi rebuild aman dijalankan berulang.

Pakai:
    python rebuild_machinehours.py --from 2026-07-01 --to 2026-07-14 --dry-run
    python rebuild_machinehours.py --from 2026-07-01 --to 2026-07-14

Lalu kirim yang produktif saja (unproductive masih ditolak SAP sampai cost center beres):
    python post_sap_staging.py --productive-only --limit 200
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from sap_staging_common import (
    connect_staging,
    ensure_staging_schema,
    plant_code,
    setup_logging,
    update_stage_cursor,
)
from stage_sap_timesheet import fetch_machine_hour_rows, stage_rows

log = setup_logging("rebuild_machinehours")


def parse_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d")


def purge_unposted(from_ts: datetime, to_ts: datetime, dry_run: bool) -> int:

    sql_count = """
    SELECT
      count(*) FILTER (WHERE status <> 'POSTED') AS akan_dihapus,
      count(*) FILTER (WHERE status = 'POSTED')  AS dipertahankan
    FROM sap_timesheet_staging
    WHERE source_system = 'MCH_HOURS'
      AND bucket_start >= %s AND bucket_start < %s
    """
    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor() as cur:
            cur.execute(sql_count, (from_ts, to_ts))
            to_delete, keep = cur.fetchone()
            log.info(
                "Rentang %s..%s: %s baris akan dihapus, %s POSTED dipertahankan",
                from_ts.date(),
                to_ts.date(),
                to_delete,
                keep,
            )
            if dry_run:
                return 0

            cur.execute(
                """
                DELETE FROM sap_timesheet_staging
                WHERE source_system = 'MCH_HOURS'
                  AND bucket_start >= %s AND bucket_start < %s
                  AND status <> 'POSTED'
                """,
                (from_ts, to_ts),
            )
            deleted = cur.rowcount
        conn.commit()
    return deleted


def restage(from_ts: datetime, to_ts: datetime, dry_run: bool) -> int:

    total = 0
    cursor = from_ts
    while cursor < to_ts:
        day_end = min(cursor + timedelta(days=1), to_ts)
        rows = fetch_machine_hour_rows(cursor, day_end)
        if rows:
            staged = stage_rows(rows, dry_run)
            total += len(rows)
            log.info("%s -> %s bundel (%s ditulis)", cursor.date(), len(rows), staged)
        else:
            log.info("%s -> tidak ada data", cursor.date())

        corr = fetch_machine_hour_rows(cursor, day_end, mode="correction")
        if corr:
            stage_rows(corr, dry_run)
            total += len(corr)
            log.info("%s -> %s bundel KOREKSI", cursor.date(), len(corr))
        cursor = day_end
    return total


def full_reset(dry_run: bool) -> None:

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*), count(*) FILTER (WHERE status='POSTED') FROM sap_timesheet_staging"
            )
            total, posted = cur.fetchone()
            log.warning(
                "FULL RESET: %s baris dihapus (%s di antaranya POSTED — pastikan sudah distorno di SAP)",
                total,
                posted,
            )
            if dry_run:
                log.info("(dry-run: sequence akan di-reset ke 1)")
                return

            cur.execute("TRUNCATE TABLE sap_timesheet_staging RESTART IDENTITY CASCADE")
            cur.execute("DELETE FROM sap_stage_cursor WHERE source_system = 'MCH_HOURS'")
        conn.commit()
    log.warning("Antrian dikosongkan, sequence ID kembali ke 1")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--from", dest="from_date", required=True, help="Tanggal mulai, mis. 2026-07-01"
    )
    parser.add_argument(
        "--to", dest="to_date", required=True, help="Tanggal akhir (eksklusif), mis. 2026-07-15"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Tampilkan rencana, jangan ubah apa pun"
    )
    parser.add_argument(
        "--full-reset",
        action="store_true",
        help="HAPUS SELURUH antrian (termasuk POSTED) + reset ID ke 1. "
        "Hanya sah bila semua POSTED sudah distorno di SAP.",
    )
    args = parser.parse_args()

    from_ts = parse_date(args.from_date)
    to_ts = parse_date(args.to_date)
    if from_ts >= to_ts:
        raise SystemExit("--from harus lebih awal dari --to")

    if args.full_reset:
        full_reset(args.dry_run)
        deleted = 0
    else:
        deleted = purge_unposted(from_ts, to_ts, args.dry_run)
    if not args.dry_run and not args.full_reset:
        log.info("%s baris belum-terkirim dihapus", deleted)

    prepared = restage(from_ts, to_ts, args.dry_run)

    if not args.dry_run:
        with connect_staging() as conn:
            ensure_staging_schema(conn)
            update_stage_cursor(conn, "MCH_HOURS", plant_code(), to_ts)
            conn.commit()
        log.info("Cursor MCH_HOURS di-set ke %s", to_ts)

    log.info(
        "Rebuild selesai: %s bundel disiapkan%s", prepared, " (DRY RUN)" if args.dry_run else ""
    )
    if not args.dry_run:
        log.info("Berikutnya: python post_sap_staging.py --productive-only --limit 200")


if __name__ == "__main__":
    main()
