"""
ops_worker.py

Konsumen antrian public.sap_ops_request — permintaan operasi SAP staging yang dipicu
dari UI (halaman "Status Kirim SAP"). API (Node) hanya MENITIP permintaan; worker inilah
yang menjalankan script Python yang SUDAH ada. Satu mesin bundling/posting, bukan dua.

Aksi yang didukung:
  stage_catchup  -> python stage_machinehours.py --catchup
                    (aman: membangun antrian PENDING, TIDAK mengirim ke SAP)
  retry_failed   -> python post_sap_staging.py --failed-only
                    (MENGIRIM baris FAILED ke SAP payroll — hanya FAILED, tidak menyentuh
                     PENDING. Guard anti-double-post di poster tetap berlaku.)

Pakai:
    python ops_worker.py --once
    python ops_worker.py --loop --interval 10

Deploy: jalankan sebagai service compose memakai image yang sama dengan job etl/ews,
working dir jobs/sap_staging. Tanpa worker ini berjalan, tombol di UI hanya menumpuk
permintaan QUEUED yang tidak diproses.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from sap_staging_common import connect_staging, setup_logging

log = setup_logging("ops_worker")

BASE_DIR = Path(__file__).resolve().parent

COMMANDS = {
    "stage_catchup": [sys.executable, "stage_machinehours.py", "--catchup"],
    "retry_failed":  [sys.executable, "post_sap_staging.py", "--failed-only"],
    "post_corrections": [sys.executable, "post_sap_staging.py"],
    "rebuild_pending": [sys.executable, "rebuild_pending.py"],
    "post_bundles":   [sys.executable, "post_sap_staging.py", "--workers", "3"],
    # --limit 1000: posting manual per tanggal/operator harus HABIS dalam satu request
    # (default argparse 50 → cuma 50 bundle terkirim per klik — sisanya tetap PENDING).
    "post_date":      [sys.executable, "post_sap_staging.py", "--workers", "4", "--limit", "1000", "--include-today"],
    "post_operator":  [sys.executable, "post_sap_staging.py", "--workers", "4", "--limit", "1000", "--include-today"],
    "recalc_date":    [sys.executable, "rebuild_machinehours.py"],
}

TIMEOUTS = {
    "stage_catchup": 900,
    "retry_failed": 1800,
    "post_corrections": 1800,
    "rebuild_pending": 3600,
    "post_bundles": 1800,
    "post_date": 1800,
    "post_operator": 1800,
    "recalc_date": 900,
}


def build_command(action: str, params: dict) -> list | None:
    """Perintah untuk sebuah aksi. post_corrections butuh --ids dari params;
    rebuild_pending butuh --from (tanggal mulai); aksi manual UI butuh id/tanggal/pernr."""
    base = COMMANDS.get(action)
    if base is None:
        return None
    if action == "post_corrections":
        ids = [str(int(i)) for i in (params or {}).get("ids", []) if str(i).strip()]
        if not ids:
            return None
        return base + ["--ids", ",".join(ids)]
    if action == "rebuild_pending":
        from_date = str((params or {}).get("from_date", "")).strip()
        if not from_date:
            return None
        return base + ["--from", from_date]
    if action == "post_bundles":
        ids = [str(int(i)) for i in (params or {}).get("ids", []) if str(i).strip()]
        if not ids:
            return None
        return base + ["--ids", ",".join(ids)]
    if action == "post_date":
        date = str((params or {}).get("date", "")).strip()
        if not date:
            return None
        return base + ["--date", date]
    if action == "post_operator":
        pernr = str((params or {}).get("pernr", "")).strip()
        if not pernr:
            return None
        return base + ["--pernr", pernr]
    if action == "recalc_date":
        date = str((params or {}).get("date", "")).strip()
        if not date:
            return None
        from datetime import datetime, timedelta
        to = (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        return base + ["--from", date, "--to", to]
    return base


def claim_one() -> dict | None:
    """Ambil satu permintaan QUEUED tertua MILIK PLANT INI (atau legacy tanpa plant).

    Multi-plant: antrian sap_ops_request SHARED di AWS RDS, tapi tiap plant punya
    sap-ops-worker sendiri; tanpa filter plant, worker BPN dan Cikupa berebut dan
    request bisa dieksekusi worker plant lain. API menulis kolom plant saat insert.
    """
    plant = os.environ.get("PLANT_SSB") or ""
    with connect_staging() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.sap_ops_request
                   SET status = 'RUNNING', started_at = now()
                 WHERE id = (
                   SELECT id FROM public.sap_ops_request
                    WHERE status = 'QUEUED'
                      AND (plant = %s OR plant IS NULL)
                    ORDER BY id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                 )
                RETURNING id, action, params
                """,
                (plant,),
            )
            row = cur.fetchone()
        conn.commit()
    if not row:
        return None
    return {"id": row[0], "action": row[1], "params": row[2]}


def finish(request_id: int, ok: bool, result: str, error: str | None) -> None:
    with connect_staging() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.sap_ops_request
                   SET status = %s, finished_at = now(),
                       result = %s, error = %s
                 WHERE id = %s
                """,
                ("DONE" if ok else "ERROR", result[-4000:] if result else None,
                 error[-4000:] if error else None, request_id),
            )
        conn.commit()


def run_request(req: dict) -> None:
    action = req["action"]
    cmd = build_command(action, req.get("params"))
    if not cmd:
        finish(req["id"], False, "", f"Aksi tak dikenal / params kosong: {action}")
        log.error("Aksi tak dikenal / params kosong id=%s action=%s", req["id"], action)
        return

    log.info("Menjalankan id=%s action=%s: %s", req["id"], action, " ".join(cmd))
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True,
            timeout=TIMEOUTS.get(action, 900),
        )
        output = (proc.stdout or "") + (("\n[stderr]\n" + proc.stderr) if proc.stderr else "")
        if proc.returncode == 0:
            finish(req["id"], True, output, None)
            log.info("Selesai id=%s action=%s (rc=0)", req["id"], action)
        else:
            finish(req["id"], False, output, f"exit code {proc.returncode}")
            log.warning("Gagal id=%s action=%s rc=%s", req["id"], action, proc.returncode)
    except subprocess.TimeoutExpired:
        finish(req["id"], False, "", f"Timeout > {TIMEOUTS.get(action, 900)}s")
        log.error("Timeout id=%s action=%s", req["id"], action)
    except Exception as exc:
        finish(req["id"], False, "", str(exc))
        log.exception("Error id=%s action=%s", req["id"], action)


def drain() -> int:
    """Proses semua yang QUEUED saat ini. Kembalikan jumlah yang diproses."""
    processed = 0
    while True:
        req = claim_one()
        if not req:
            break
        run_request(req)
        processed += 1
    return processed


def startup_diagnostics() -> None:
    """Cetak DB target + bereskan RUNNING yatim dari instance yang mati.

    Kalau tombol UI 'nyangkut' (QUEUED tak pernah diproses), penyebab paling umum adalah
    worker konek ke DB yang BEDA dari yang ditulis aplikasi. Log host/port/db di bawah
    memudahkan verifikasi: harus SAMA dengan DB yang dipakai `api`.
    """
    from sap_staging_common import staging_db_config
    cfg = staging_db_config()
    log.info("ops_worker target DB: host=%s port=%s db=%s user=%s "
             "(HARUS sama dengan DB yang dipakai service api)",
             cfg.get("host"), cfg.get("port"), cfg.get("dbname"), cfg.get("user"))
    try:
        with connect_staging() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE public.sap_ops_request SET status='ERROR', finished_at=now(), "
                    "error='worker restart — RUNNING yatim direset' "
                    "WHERE status='RUNNING' AND started_at < now() - interval '5 minutes'"
                )
                n = cur.rowcount
                cur.execute("SELECT count(*) FROM public.sap_ops_request WHERE status='QUEUED'")
                q = cur.fetchone()[0]
            conn.commit()
        if n:
            log.warning("Reset %s RUNNING yatim.", n)
        log.info("Antrian: %s QUEUED menunggu.", q)
    except Exception:
        log.exception("GAGAL konek ke DB saat startup — cek DB_HOST/DB_PORT di .env yang "
                      "dipakai container ini. Worker tidak akan bisa memproses antrian.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Worker antrian operasi SAP staging (sap_ops_request).")
    parser.add_argument("--once", action="store_true", help="Proses semua QUEUED lalu keluar.")
    parser.add_argument("--loop", action="store_true", help="Daemon: cek antrian terus-menerus.")
    parser.add_argument("--interval", type=float, default=10.0, help="Detik antar polling di mode --loop.")
    args = parser.parse_args()

    if not args.once and not args.loop:
        args.once = True

    startup_diagnostics()

    if args.once:
        n = drain()
        log.info("Selesai satu putaran: %s permintaan diproses.", n)
        return

    log.info("ops_worker daemon mulai (interval %.1fs). Ctrl-C untuk berhenti.", args.interval)
    while True:
        try:
            drain()
        except Exception:
            log.exception("Putaran gagal — lanjut ke berikutnya.")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
