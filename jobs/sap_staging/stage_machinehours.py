from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta

from stage_sap_timesheet import (
    fetch_machine_hour_rows,
    parse_dt,
    previous_completed_hour,
    stage_rows,
)
from sap_staging_common import (
    connect_staging,
    connect_source,
    cursor_initial_from,
    cursor_overlap_minutes,
    ensure_staging_schema,
    get_stage_cursor,
    plant_code,
    setup_logging,
    update_stage_cursor,
    upsert_eligibility_audit,
)

log = setup_logging("stage_machinehours")


def find_next_sap_ready_start(after_ts):
    sql = """
    SELECT min(startdatetime)
    FROM mch_transaction
    WHERE startdatetime > %s
      AND enddatetime IS NOT NULL
      AND enddatetime > startdatetime
      AND confirmation_number IS NOT NULL
      AND confirmation_number <> ''
      AND order_no IS NOT NULL
      AND order_no <> ''
      AND operation_no IS NOT NULL
      AND operation_no <> ''
    """
    with connect_source() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (after_ts,))
            row = cur.fetchone()
    return row[0] if row else None


def floor_hour(value):
    return value.replace(minute=0, second=0, microsecond=0)


def fetch_blocked_today_production_rows() -> list[dict]:
    sql = """
    SELECT
      pd.proddataid,
      pd.machineno,
      pd.jobid,
      pd.statusid,
      pd.startdatetime::date AS source_date,
      pd.startdatetime,
      pd.enddatetime
    FROM mch_productiondata pd
    LEFT JOIN mch_transaction mt
      ON mt.proddataid = pd.proddataid
    WHERE pd.startdatetime::date = now()::date
      AND mt.proddataid IS NULL
    ORDER BY pd.startdatetime DESC, pd.proddataid
    """
    with connect_source() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()

    return [
        {
            "source_system": "MCH_PRODUCTIONDATA",
            "source_key": str(row[0]),
            "source_ref_id": str(row[0]),
            "source_date": row[4],
            "plant": plant_code(),
            "eligibility_status": "BLOCKED",
            "block_reason": "missing_mch_transaction",
            "block_detail": json.dumps(
                {
                    "proddataid": row[0],
                    "machineno": row[1],
                    "jobid": row[2],
                    "statusid": row[3],
                    "startdatetime": row[5].isoformat() if row[5] else None,
                    "enddatetime": row[6].isoformat() if row[6] else None,
                }
            ),
        }
        for row in rows
    ]


def managed_floor():

    with connect_staging() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT min(bucket_start)::date FROM sap_timesheet_staging WHERE source_system = 'MCH_HOURS'"
            )
            row = cur.fetchone()
            return row[0] if row else None


def find_catchup_days(days: int, floor) -> list:

    sql = """
    SELECT DISTINCT m.startdatetime::date AS hari,
           count(*) OVER (PARTITION BY m.startdatetime::date) AS n
    FROM mch_transaction m
    WHERE m.startdatetime >= GREATEST((now() - make_interval(days => %s))::date, %s::date)
      AND m.enddatetime IS NOT NULL
      AND m.enddatetime > m.startdatetime
      AND COALESCE(m.confirmation_number, '') <> ''
      AND COALESCE(m.order_no, '') <> ''
      AND COALESCE(m.operation_no, '') <> ''
      AND NULLIF(BTRIM(m.sn_employee), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sap_staging_source s
        WHERE s.source_system = 'MCH_HOURS'
          AND s.source_row_id = m.proddataid::text
      )
    ORDER BY 1
    """
    with connect_source() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (days, floor))
            return cur.fetchall()


def run_catchup(args: argparse.Namespace) -> None:

    floor = args.catchup_since or managed_floor()
    if floor is None:
        log.info("Catch-up dilewati: antrian kosong, belum ada rentang yang dikelola")
        return

    days = find_catchup_days(args.catchup_days, floor)
    if not days:
        log.info(
            "Catch-up: tidak ada record layak yang tertinggal (sejak %s, %s hari terakhir)",
            floor,
            args.catchup_days,
        )
        return

    total_rows = sum(n for _, n in days)
    log.info(
        "Catch-up sejak %s: %s record layak belum ter-bundle, tersebar di %s hari",
        floor,
        total_rows,
        len(days),
    )
    for day, n in days:
        from_ts = datetime(day.year, day.month, day.day)
        to_ts = from_ts + timedelta(days=1)
        rows = fetch_machine_hour_rows(from_ts, to_ts)
        staged = stage_rows(rows, args.dry_run)
        log.info("  %s: %s record tertinggal -> %s bundel (%s ditulis)", day, n, len(rows), staged)
        corr = fetch_machine_hour_rows(from_ts, to_ts, mode="correction")
        if corr:
            stage_rows(corr, args.dry_run)
            log.info("  %s: %s bundel KOREKSI (post manual dari UI)", day, len(corr))


def run_once(args: argparse.Namespace) -> bool:
    cursor_mode = not (args.from_ts or args.to_ts)

    if args.from_ts and args.to_ts:
        from_ts = parse_dt(args.from_ts)
        to_ts = parse_dt(args.to_ts)
    elif args.from_ts or args.to_ts:
        raise ValueError("--from-ts and --to-ts must be used together")
    else:
        _, to_ts = previous_completed_hour()
        with connect_staging() as staging_conn:
            ensure_staging_schema(staging_conn)
            cursor_value = get_stage_cursor(staging_conn, "MCH_HOURS", plant_code())
        from_ts = cursor_value or cursor_initial_from()
        if args.overlap_minutes > 0:
            from_ts = from_ts - timedelta(minutes=args.overlap_minutes)
        max_to_ts = from_ts + timedelta(hours=args.max_hours)
        if max_to_ts < to_ts:
            to_ts = max_to_ts

    if from_ts >= to_ts:
        log.info("Machine-hour staging skipped: empty window %s..%s", from_ts, to_ts)
        return False

    rows = fetch_machine_hour_rows(from_ts, to_ts)
    inserted = stage_rows(rows, args.dry_run)
    corr = fetch_machine_hour_rows(from_ts, to_ts, mode="correction")
    if corr:
        stage_rows(corr, args.dry_run)
        log.info("Bundel KOREKSI disiapkan: %s (post manual dari UI)", len(corr))
    audited = 0
    if not args.dry_run:
        with connect_staging() as staging_conn:
            ensure_staging_schema(staging_conn)
            audited = upsert_eligibility_audit(staging_conn, fetch_blocked_today_production_rows())
    cursor_to = to_ts
    if cursor_mode and not args.dry_run:
        if not rows and args.fast_forward_empty:
            next_ready = find_next_sap_ready_start(to_ts)
            if next_ready and next_ready > to_ts:
                cursor_to = floor_hour(next_ready)
                log.info(
                    "No SAP-ready rows in window; fast-forward cursor to next ready hour %s",
                    cursor_to,
                )
        with connect_staging() as staging_conn:
            ensure_staging_schema(staging_conn)
            update_stage_cursor(staging_conn, "MCH_HOURS", plant_code(), cursor_to)
            staging_conn.commit()
    log.info(
        "Machine-hour staging window=%s..%s prepared=%s inserted=%s audited=%s cursor_mode=%s",
        from_ts,
        to_ts,
        len(rows),
        inserted,
        audited,
        cursor_mode,
    )
    return cursor_to > from_ts


def run(args: argparse.Namespace) -> None:
    if args.catchup:
        run_catchup(args)
        return

    if not args.loop:
        run_once(args)

        if args.catchup_days > 0:
            run_catchup(args)
        return

    if args.from_ts or args.to_ts:
        raise ValueError("--loop is only for cursor mode; do not use --from-ts/--to-ts")

    for iteration in range(1, args.loop + 1):
        log.info("Loop iteration %s/%s", iteration, args.loop)
        progressed = run_once(args)
        if not progressed:
            log.info("Loop stopped: no more cursor progress")
            break
        if args.loop_sleep_seconds > 0 and iteration < args.loop:
            time.sleep(args.loop_sleep_seconds)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Stage bundled mch_transaction rows to SAP staging. Default: previous completed hour.",
    )
    parser.add_argument("--from-ts", help="Start timestamp, e.g. 2026-06-12T14:00:00")
    parser.add_argument("--to-ts", help="End timestamp, e.g. 2026-06-12T15:00:00")
    parser.add_argument(
        "--overlap-minutes",
        type=int,
        default=cursor_overlap_minutes(30),
        help="Cursor overlap to catch cross-hour updates",
    )
    parser.add_argument(
        "--max-hours", type=int, default=6, help="Maximum catch-up window per run in cursor mode"
    )
    parser.add_argument(
        "--catchup",
        action="store_true",
        help="HANYA jalankan catch-up: stage record yang LAYAK tapi belum ter-bundle "
        "(mis. sn_employee dulu kosong lalu diperbaiki user, sementara cursor sudah lewat).",
    )
    parser.add_argument(
        "--catchup-days",
        type=int,
        default=14,
        help="Berapa hari ke belakang yang disapu catch-up (default 14). 0 = matikan.",
    )
    parser.add_argument(
        "--catchup-since",
        help="Lantai tanggal catch-up (YYYY-MM-DD). Default: bucket paling awal di antrian. "
        "JANGAN turunkan ke bawah rentang yang dikelola — data lama sudah terkirim ke SAP "
        "tanpa provenance, dan men-stage-nya lagi = jam kerja masuk SAP dua kali.",
    )
    parser.add_argument(
        "--loop",
        type=int,
        default=0,
        help="Test/catch-up mode: run cursor batches repeatedly N times",
    )
    parser.add_argument(
        "--loop-sleep-seconds", type=float, default=0.0, help="Sleep between loop iterations"
    )
    parser.add_argument(
        "--no-fast-forward-empty",
        dest="fast_forward_empty",
        action="store_false",
        help="Do not jump over empty cursor windows",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.set_defaults(fast_forward_empty=True)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    run(args)


if __name__ == "__main__":
    main()
