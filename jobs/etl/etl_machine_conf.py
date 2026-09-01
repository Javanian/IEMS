import argparse
import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
import psycopg2.extras
import pyodbc


def _load_root_env():
    base = Path(__file__).resolve().parent
    for path in [base, *base.parents]:
        env_file = path / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())
            return


_load_root_env()


def _env(*names, default=None, required=False):
    for name in names:
        val = os.environ.get(name)
        if val not in (None, ""):
            return val
    if default is not None:
        return default
    if required:
        raise SystemExit(
            f"Missing required env var {names[0]} — set it in the environment or the repo root .env"
        )
    return None


SQLSERVER_CONFIG = {
    "server": _env("OEE_SQLSERVER_HOST", default="10.169.2.76,61878"),
    "database": _env("OEE_SQLSERVER_DATABASE", default="SSB_OEE"),
    "username": _env("OEE_SQLSERVER_USER", default="tag"),
    "password": _env("OEE_SQLSERVER_PASSWORD", required=True),
    "driver": _env("SQLSERVER_DRIVER", default="ODBC Driver 17 for SQL Server"),
}

POSTGRES_CONFIG = {
    "host": _env("PG_HOST", default="100.86.231.55"),
    "port": int(_env("PG_PORT", default="5433")),
    "dbname": _env("PG_DBNAME", default="ptssb"),
    "user": _env("PG_USER", "DB_USER", default="tag"),
    "password": _env("PG_PASSWORD", "DB_PASSWORD", required=True),
}

BATCH_SIZE = 5000
DEFAULT_FROM_DATE = "2026-01-01"
MCH_TABLE = "mch_productiondata"
MCH_DETAIL_MV = "mv_mch_productiondata_detail"


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("etl_machine_conf")


CREATE_MCH_PRODUCTIONDATA_SQL = """
CREATE TABLE IF NOT EXISTS public.mch_productiondata (
    proddataid int4 NOT NULL,
    startdatetime timestamp NOT NULL,
    enddatetime timestamp NULL,
    machineno int4 NOT NULL,
    statusid int2 NOT NULL,
    previoustatusid int2 NULL,
    duration int4 NULL,
    "Notes" varchar(100) NULL,
    operatorid varchar(100) NULL,
    jobid varchar(100) NULL,
    "JobComplete" bool NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mch_productiondata_proddataid
    ON public.mch_productiondata (proddataid);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_startdatetime
    ON public.mch_productiondata (startdatetime);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_machine_start
    ON public.mch_productiondata (machineno, startdatetime);
"""


UPSERT_MCH_PRODUCTIONDATA_SQL = """
INSERT INTO public.mch_productiondata (
    proddataid,
    startdatetime,
    enddatetime,
    machineno,
    statusid,
    previoustatusid,
    duration,
    "Notes",
    operatorid,
    jobid,
    "JobComplete"
)
VALUES %s
ON CONFLICT (proddataid) DO UPDATE SET
    startdatetime = EXCLUDED.startdatetime,
    enddatetime = EXCLUDED.enddatetime,
    machineno = EXCLUDED.machineno,
    statusid = EXCLUDED.statusid,
    previoustatusid = EXCLUDED.previoustatusid,
    duration = EXCLUDED.duration,
    "Notes" = EXCLUDED."Notes",
    operatorid = EXCLUDED.operatorid,
    jobid = EXCLUDED.jobid,
    "JobComplete" = EXCLUDED."JobComplete"
"""


def connect_sqlserver():
    conn_str = (
        f"DRIVER={{{SQLSERVER_CONFIG['driver']}}};"
        f"SERVER={SQLSERVER_CONFIG['server']};"
        f"DATABASE={SQLSERVER_CONFIG['database']};"
        f"UID={SQLSERVER_CONFIG['username']};"
        f"PWD={SQLSERVER_CONFIG['password']};"
    )
    return pyodbc.connect(conn_str, timeout=30)


def connect_postgres():
    return psycopg2.connect(**POSTGRES_CONFIG)


def fetch_production_data(
    cursor: pyodbc.Cursor, offset: int, from_dt: datetime, to_dt: datetime | None
) -> list[dict]:
    where = [
        "JobID <> ''",
        "(JobID LIKE '1%' OR JobID LIKE '3%')",
        "StartDateTime >= ?",
    ]
    params = [from_dt]
    if to_dt:
        where.append("StartDateTime < ?")
        params.append(to_dt)

    sql = f"""
        SELECT ProdDataID, JobID, StartDateTime
        FROM ProductionData
        WHERE {" AND ".join(where)}
        ORDER BY ProdDataID
        OFFSET ? ROWS
        FETCH NEXT ? ROWS ONLY
    """
    cursor.execute(sql, (*params, offset, BATCH_SIZE))
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def fetch_production_rows_for_postgres(
    cursor: pyodbc.Cursor,
    offset: int,
    from_dt: datetime,
    to_dt: datetime | None,
) -> list[dict]:
    where = ["StartDateTime >= ?"]
    params = [from_dt]
    if to_dt:
        where.append("StartDateTime < ?")
        params.append(to_dt)

    sql = f"""
        SELECT
            ProdDataID,
            StartDateTime,
            EndDateTime,
            MachineNo,
            StatusID,
            PreviousStatusID,
            Duration,
            Notes,
            OperatorID,
            JobID,
            JobComplete
        FROM dbo.ProductionData
        WHERE {" AND ".join(where)}
        ORDER BY ProdDataID
        OFFSET ? ROWS
        FETCH NEXT ? ROWS ONLY
    """
    cursor.execute(sql, (*params, offset, BATCH_SIZE))
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _make_naive(dt):

    if dt is None:
        return None
    if hasattr(dt, "tzinfo") and dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


def bulk_lookup_timesheet(pg_cursor, rows: list[dict]) -> dict:

    if not rows:
        return {}

    job_ids = list({r["JobID"].strip() for r in rows if r.get("JobID")})

    if not job_ids:
        return {}

    sql = """
        SELECT order_no, operation_no, longdate_checkin
        FROM timesheet_transaction
        WHERE order_no = ANY(%s)
          AND longdate_checkin IS NOT NULL
        ORDER BY order_no, longdate_checkin
    """
    pg_cursor.execute(sql, (job_ids,))
    pg_rows = pg_cursor.fetchall()

    by_order: dict[str, list[tuple]] = {}
    for r in pg_rows:
        order_no = (r[0] or "").strip()
        op_no = r[1]
        ts = _make_naive(r[2])
        by_order.setdefault(order_no, []).append((op_no, ts))

    result: dict[int, dict] = {}
    for row in rows:
        pid = row["ProdDataID"]
        order_no = (row["JobID"] or "").strip()
        start_dt = _make_naive(row["StartDateTime"])

        candidates = by_order.get(order_no)
        if not candidates:
            continue

        if start_dt and isinstance(start_dt, datetime):
            target = start_dt
            closest = min(
                candidates,
                key=lambda c: abs((c[1] - target).total_seconds()) if c[1] else float("inf"),
            )
        else:
            closest = candidates[0]

        result[pid] = {"order_no": order_no, "operation_no": closest[0]}

    return result


def _strip_zero(v):

    s = str(v).lstrip("0")
    return s if s else "0"


def bulk_lookup_confirmation(pg_cursor, ts_map: dict[int, dict]) -> dict[int, str]:

    if not ts_map:
        return {}

    pairs = list(
        {
            (v["order_no"], str(v["operation_no"]))
            for v in ts_map.values()
            if v.get("operation_no") is not None
        }
    )

    if not pairs:
        return {}

    values_clause = ", ".join(
        f"({pg_cursor.mogrify('%s', (o,)).decode()}, {pg_cursor.mogrify('%s', (op,)).decode()})"
        for o, op in pairs
    )

    sql = f"""
        SELECT order_no, operation_no, confirmation_number
        FROM ph3_order
        WHERE (LTRIM(order_no, '0'), LTRIM(operation_no, '0')) IN ({values_clause})
    """
    pg_cursor.execute(sql)
    pg_rows = pg_cursor.fetchall()

    confirmation_by_key: dict[tuple, str] = {}
    for r in pg_rows:
        key = (
            _strip_zero(r[0]) if r[0] is not None else "",
            _strip_zero(r[1]) if r[1] is not None else "",
        )
        val = r[2]
        if val:
            confirmation_by_key[key] = str(val)

    result: dict[int, str] = {}
    for pid, ts in ts_map.items():
        key = (
            _strip_zero(ts["order_no"]),
            _strip_zero(ts["operation_no"]) if ts["operation_no"] is not None else "",
        )
        conf = confirmation_by_key.get(key)
        if conf:
            result[pid] = conf

    return result


def update_jobid(cursor: pyodbc.Cursor, prod_data_id: int, new_jobid: str) -> None:
    cursor.execute(
        "UPDATE ProductionData SET JobID = ? WHERE ProdDataID = ?",
        (new_jobid, prod_data_id),
    )


def parse_date_arg(value: str, label: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{label} harus format YYYY-MM-DD") from exc


def make_date_range(args: argparse.Namespace) -> tuple[datetime, datetime | None]:
    from_dt = parse_date_arg(args.from_date, "--from")
    to_dt = None
    if args.to_date:

        to_dt = parse_date_arg(args.to_date, "--to") + timedelta(days=1)
    if to_dt and from_dt >= to_dt:
        raise ValueError("--from tidak boleh lebih besar dari --to")
    return from_dt, to_dt


def ensure_mch_productiondata_table(pg_conn) -> None:
    with pg_conn.cursor() as cursor:
        cursor.execute(CREATE_MCH_PRODUCTIONDATA_SQL)
    pg_conn.commit()


def clip_text(value, max_len: int = 100):
    if value is None:
        return None
    return str(value)[:max_len]


def coerce_bool(value):
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "t", "yes", "y"}:
        return True
    if text in {"0", "false", "f", "no", "n"}:
        return False
    return None


def to_mch_tuple(row: dict) -> tuple:
    return (
        row.get("ProdDataID"),
        row.get("StartDateTime"),
        row.get("EndDateTime"),
        row.get("MachineNo"),
        row.get("StatusID"),
        row.get("PreviousStatusID"),
        row.get("Duration"),
        clip_text(row.get("Notes")),
        clip_text(row.get("OperatorID")),
        clip_text(row.get("JobID")),
        coerce_bool(row.get("JobComplete")),
    )


def sync_productiondata_to_postgres(
    mssql_cursor: pyodbc.Cursor,
    pg_conn,
    from_dt: datetime,
    to_dt: datetime | None,
    dry_run: bool = False,
) -> int:
    if not dry_run:
        ensure_mch_productiondata_table(pg_conn)

    total_synced = 0
    offset = 0
    while True:
        rows = fetch_production_rows_for_postgres(mssql_cursor, offset, from_dt, to_dt)
        if not rows:
            log.info("No more ProductionData rows for Postgres sync at offset %d.", offset)
            break

        values = [to_mch_tuple(row) for row in rows]
        if dry_run:
            log.info(
                "DRY-RUN Postgres sync batch offset=%d count=%d first_proddataid=%s",
                offset,
                len(values),
                values[0][0] if values else "-",
            )
        else:
            with pg_conn.cursor() as pg_cursor:
                psycopg2.extras.execute_values(
                    pg_cursor,
                    UPSERT_MCH_PRODUCTIONDATA_SQL,
                    values,
                    page_size=min(BATCH_SIZE, 1000),
                )
            pg_conn.commit()
            log.info("Synced ProductionData batch offset=%d count=%d", offset, len(values))

        total_synced += len(values)
        offset += BATCH_SIZE

    return total_synced


def refresh_mch_detail_materialized_view(pg_conn) -> None:
    try:
        with pg_conn.cursor() as cursor:
            cursor.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY public.{MCH_DETAIL_MV}")
        pg_conn.commit()
        log.info("Refreshed materialized view public.%s concurrently.", MCH_DETAIL_MV)
    except psycopg2.Error as exc:
        pg_conn.rollback()
        log.warning("Concurrent refresh failed for public.%s: %s", MCH_DETAIL_MV, exc)
        try:
            with pg_conn.cursor() as cursor:
                cursor.execute(f"REFRESH MATERIALIZED VIEW public.{MCH_DETAIL_MV}")
            pg_conn.commit()
            log.info("Refreshed materialized view public.%s.", MCH_DETAIL_MV)
        except psycopg2.Error as retry_exc:
            pg_conn.rollback()
            log.warning(
                "Skip refresh materialized view public.%s: %s. Jalankan migration "
                "database/migrations/api/20260512_create_mch_productiondata_detail_mv.sql dulu jika view belum ada.",
                MCH_DETAIL_MV,
                retry_exc,
            )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ETL: Update ProductionData.JobID then sync ProductionData to PostgreSQL mch_productiondata"
    )
    parser.add_argument(
        "--from",
        dest="from_date",
        default=DEFAULT_FROM_DATE,
        help=f"StartDateTime mulai tanggal YYYY-MM-DD, default {DEFAULT_FROM_DATE}",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        help="StartDateTime sampai tanggal YYYY-MM-DD, inclusive. Jika kosong, sync sampai data terbaru.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview mode, no SQL Server updates and no Postgres inserts",
    )
    parser.add_argument(
        "--sync-only",
        action="store_true",
        help="Skip update JobID, hanya kirim ProductionData ke Postgres",
    )
    parser.add_argument(
        "--skip-refresh-mv",
        action="store_true",
        help="Skip refresh materialized view public.mv_mch_productiondata_detail setelah sync",
    )
    args = parser.parse_args()

    dry_run: bool = args.dry_run
    from_dt, to_dt = make_date_range(args)

    log.info(
        "Starting ETL machine confirmation%s (BATCH_SIZE=%d)",
        " (DRY RUN)" if dry_run else "",
        BATCH_SIZE,
    )
    log.info("SQL Server: %s/%s", SQLSERVER_CONFIG["server"], SQLSERVER_CONFIG["database"])
    log.info(
        "PostgreSQL:  %s:%s/%s",
        POSTGRES_CONFIG["host"],
        POSTGRES_CONFIG["port"],
        POSTGRES_CONFIG["dbname"],
    )
    log.info(
        "Date filter:  StartDateTime >= %s%s",
        from_dt.strftime("%Y-%m-%d"),
        f" and <= {args.to_date}" if args.to_date else "",
    )

    mssql_conn = None
    pg_conn = None
    mssql_cursor = None
    pg_cursor = None
    total_rows = 0
    updated = 0
    skipped_no_timesheet = 0
    skipped_no_confirmation = 0
    failed = 0
    synced_to_postgres = 0

    try:
        mssql_conn = connect_sqlserver()
        mssql_conn.autocommit = False
        pg_conn = connect_postgres()

        mssql_cursor = mssql_conn.cursor()
        pg_cursor = pg_conn.cursor()

        offset = 0
        if args.sync_only:
            log.info("Sync-only mode: skip SQL Server JobID update batch.")
        else:
            while True:
                rows = fetch_production_data(mssql_cursor, offset, from_dt, to_dt)
                if not rows:
                    log.info("No more rows at offset %d.", offset)
                    break

                log.info("Processing batch offset=%d, count=%d ...", offset, len(rows))

                ts_lookup_start = datetime.now()
                ts_map = bulk_lookup_timesheet(pg_cursor, rows)
                ts_elapsed = (datetime.now() - ts_lookup_start).total_seconds()
                log.debug("  timesheet bulk lookup: %.1fs (%d matches)", ts_elapsed, len(ts_map))

                conf_start = datetime.now()
                conf_map = bulk_lookup_confirmation(pg_cursor, ts_map)
                conf_elapsed = (datetime.now() - conf_start).total_seconds()
                log.debug(
                    "  confirmation bulk lookup: %.1fs (%d matches)", conf_elapsed, len(conf_map)
                )

                for row in rows:
                    total_rows += 1
                    prod_id = row["ProdDataID"]
                    job_id = row["JobID"]

                    ts = ts_map.get(prod_id)
                    if not ts:
                        skipped_no_timesheet += 1
                        continue

                    confirmation = conf_map.get(prod_id)
                    if not confirmation:
                        skipped_no_confirmation += 1
                        continue

                    if dry_run:
                        updated += 1
                        log.info(
                            "DRY-RUN ProdDataID=%d JobID %r -> %s  (order_no=%s op=%s)",
                            prod_id,
                            job_id,
                            confirmation,
                            ts["order_no"],
                            ts["operation_no"],
                        )
                    else:
                        try:
                            update_jobid(mssql_cursor, prod_id, confirmation)
                            updated += 1
                            log.info(
                                "UPDATED ProdDataID=%d JobID %r -> %s",
                                prod_id,
                                job_id,
                                confirmation,
                            )
                        except Exception as exc:
                            failed += 1
                            log.error("FAILED ProdDataID=%d JobID=%r: %s", prod_id, job_id, exc)

                if not dry_run:
                    mssql_conn.commit()
                    log.info(
                        "Committed batch offset=%d (updated=%d, skipped_ts=%d, skipped_conf=%d, failed=%d)",
                        offset,
                        updated,
                        skipped_no_timesheet,
                        skipped_no_confirmation,
                        failed,
                    )

                offset += BATCH_SIZE

        log.info("Start syncing ProductionData to public.%s ...", MCH_TABLE)
        synced_to_postgres = sync_productiondata_to_postgres(
            mssql_cursor,
            pg_conn,
            from_dt,
            to_dt,
            dry_run=dry_run,
        )
        if not dry_run and not args.skip_refresh_mv:
            refresh_mch_detail_materialized_view(pg_conn)

    except KeyboardInterrupt:
        log.warning("Interrupted by user.")
    except Exception as exc:
        log.exception("Fatal error: %s", exc)
        sys.exit(1)
    finally:
        if mssql_cursor:
            try:
                mssql_cursor.close()
            except Exception:
                pass
        if pg_cursor:
            try:
                pg_cursor.close()
            except Exception:
                pass
        if mssql_conn:
            try:
                mssql_conn.close()
            except Exception:
                pass
        if pg_conn:
            try:
                pg_conn.close()
            except Exception:
                pass

    log.info("=" * 60)
    log.info("ETL Complete%s", " (DRY RUN)" if dry_run else "")
    log.info("  Total rows processed:        %d", total_rows)
    log.info("  Updated:                     %d", updated)
    log.info("  Skipped (no timesheet):      %d", skipped_no_timesheet)
    log.info("  Skipped (no confirmation):   %d", skipped_no_confirmation)
    log.info("  Failed updates:              %d", failed)
    log.info("  Synced to mch_productiondata:%d", synced_to_postgres)
    log.info("=" * 60)


if __name__ == "__main__":
    main()
