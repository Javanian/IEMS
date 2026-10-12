"""Rebuild antrian PENDING setelah rules config (break hours / max record) berubah.

Menjalankan dua langkah dari tanggal mulai (--from) sampai HARI INI:
  1. MCH_HOURS : purge baris PENDING + re-stage bundel (rebuild_machinehours.py)
  2. TIMESHEET : re-stage window (stage_timesheet_transaction.py --from-ts/--to-ts)

Baris yang sudah POSTED/SKIPPED/FAILED TIDAK disentuh (ingatan anti-double-post
tetap utuh). Dipicu dari halaman Configuration Rules -> tombol "Rebuild pending"
-> sap_ops_request (aksi rebuild_pending) -> ops_worker.py.

Contoh:
    python rebuild_pending.py --from 2026-08-01
    python rebuild_pending.py --from 2026-08-01 --dry-run
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime, timedelta

from sap_staging_common import setup_logging

log = setup_logging("rebuild_pending")


def parse_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d")


def run(cmd: list[str], dry_run: bool) -> int:
    log.info("> %s", " ".join(cmd))
    if dry_run:
        return 0
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        log.error("Gagal (rc=%s): %s", proc.returncode, " ".join(cmd))
    return proc.returncode


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--from",
        dest="from_date",
        required=True,
        help="Tanggal mulai rebuild (YYYY-MM-DD), inklusif",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Tampilkan rencana, jangan jalankan apa pun"
    )
    args = parser.parse_args()

    from_date = parse_date(args.from_date)
    to_excl = (datetime.now() + timedelta(days=1)).date()

    failures = 0

    failures += run(
        [
            sys.executable,
            "rebuild_machinehours.py",
            "--from",
            from_date.strftime("%Y-%m-%d"),
            "--to",
            to_excl.strftime("%Y-%m-%d"),
        ]
        + (["--dry-run"] if args.dry_run else []),
        dry_run=args.dry_run,
    )

    from_ts = f"{from_date.strftime('%Y-%m-%d')}T00:00:00"
    to_ts = f"{to_excl.strftime('%Y-%m-%d')}T00:00:00"
    failures += run(
        [sys.executable, "stage_timesheet_transaction.py", "--from-ts", from_ts, "--to-ts", to_ts]
        + (["--dry-run"] if args.dry_run else []),
        dry_run=args.dry_run,
    )

    if failures:
        log.error("Rebuild selesai DENGAN ERROR (%s langkah gagal)", failures)
        sys.exit(1)
    log.info(
        "Rebuild selesai: %s..%s%s",
        from_date.strftime("%Y-%m-%d"),
        to_excl,
        " (DRY RUN)" if args.dry_run else "",
    )


if __name__ == "__main__":
    main()
