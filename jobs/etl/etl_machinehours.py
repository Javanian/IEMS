from __future__ import annotations

import argparse
import logging
import os
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
import pyodbc
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(PROJECT_ROOT / ".env")


def _require_env(*names: str) -> str:
    for name in names:
        val = os.getenv(name)
        if val not in (None, ""):
            return val
    raise SystemExit(
        f"Missing required env var {names[0]} — set it in the environment or the repo root .env"
    )


SQLSERVER_CONFIG = {
    "server": os.getenv("SQLSERVER_HOST", "10.169.13.13"),
    "port": int(os.getenv("SQLSERVER_PORT", "57970")),
    "database": os.getenv("SQLSERVER_DATABASE", "SSB_OEE"),
    "username": os.getenv("SQLSERVER_USER", "bsa"),
    "password": _require_env("SQLSERVER_PASSWORD"),
    "driver": os.getenv("SQLSERVER_DRIVER", "ODBC Driver 17 for SQL Server"),
}

POSTGRES_CONFIG = {
    "host": os.getenv("PG_HOST", "10.169.1.12"),
    "port": int(os.getenv("PG_PORT", "5433")),
    "dbname": os.getenv("PG_DBNAME", "ptssb"),
    "user": os.getenv("PG_USER") or os.getenv("DB_USER") or "tag",
    "password": _require_env("PG_PASSWORD", "DB_PASSWORD"),
}

DEFAULT_DAYS = 7
DEFAULT_BATCH_SIZE = 5000
DEFAULT_SCHEMA = "public"
TABLE_NAME = "mch_transaction"


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("etl_machinehours")


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS {schema}.mch_transaction (
  record_key text PRIMARY KEY,
  proddataid bigint NOT NULL,
  work_date date,
  machineno integer,
  machineid text,
  machinename text,
  machine_description text,
  plantid text,
  statusid integer,
  status_description text,
  activitytype text,
  operatorid text,
  jobid text,
  order_no text,
  operation_no text,
  sequence_category text,
  sequence_number text,
  ph3_sequence_number text,
  branch_operation_no text,
  return_operation_no text,
  work_center text,
  operation_short_text text,
  event_count integer NOT NULL DEFAULT 1,
  open_event_count integer NOT NULL DEFAULT 0,
  first_startdatetime timestamp,
  last_enddatetime timestamp,
  duration_seconds bigint NOT NULL DEFAULT 0,
  duration_hours numeric(18,4) NOT NULL DEFAULT 0,
  source_created_at timestamptz NOT NULL DEFAULT now(),
  source_updated_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mch_transaction_work_date
  ON {schema}.mch_transaction (work_date DESC);

CREATE INDEX IF NOT EXISTS idx_mch_transaction_machine_date
  ON {schema}.mch_transaction (machineno, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_mch_transaction_jobid
  ON {schema}.mch_transaction (jobid);

CREATE INDEX IF NOT EXISTS idx_mch_transaction_status
  ON {schema}.mch_transaction (statusid);
"""


UPSERT_SQL = """
INSERT INTO {schema}.mch_transaction (
  record_key,
  proddataid,
  work_date,
  machineno,
  machineid,
  machinename,
  machine_description,
  plantid,
  statusid,
  status_description,
  activitytype,
  operatorid,
  jobid,
  order_no,
  operation_no,
  sequence_category,
  sequence_number,
  ph3_sequence_number,
  branch_operation_no,
  return_operation_no,
  work_center,
  operation_short_text,
  event_count,
  open_event_count,
  first_startdatetime,
  last_enddatetime,
  duration_seconds,
  duration_hours,
  synced_at
)
VALUES %s
ON CONFLICT (record_key) DO UPDATE SET
  proddataid = EXCLUDED.proddataid,
  work_date = EXCLUDED.work_date,
  machineno = EXCLUDED.machineno,
  machineid = EXCLUDED.machineid,
  machinename = EXCLUDED.machinename,
  machine_description = EXCLUDED.machine_description,
  plantid = EXCLUDED.plantid,
  statusid = EXCLUDED.statusid,
  status_description = EXCLUDED.status_description,
  activitytype = EXCLUDED.activitytype,
  operatorid = EXCLUDED.operatorid,
  jobid = EXCLUDED.jobid,
  order_no = EXCLUDED.order_no,
  operation_no = EXCLUDED.operation_no,
  sequence_category = EXCLUDED.sequence_category,
  sequence_number = EXCLUDED.sequence_number,
  ph3_sequence_number = EXCLUDED.ph3_sequence_number,
  branch_operation_no = EXCLUDED.branch_operation_no,
  return_operation_no = EXCLUDED.return_operation_no,
  work_center = EXCLUDED.work_center,
  operation_short_text = EXCLUDED.operation_short_text,
  event_count = EXCLUDED.event_count,
  open_event_count = EXCLUDED.open_event_count,
  first_startdatetime = EXCLUDED.first_startdatetime,
  last_enddatetime = EXCLUDED.last_enddatetime,
  duration_seconds = EXCLUDED.duration_seconds,
  duration_hours = EXCLUDED.duration_hours,
  source_updated_at = now(),
  synced_at = now()
"""


def quote_ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def connect_sqlserver() -> pyodbc.Connection:
    server = SQLSERVER_CONFIG["server"]
    port = SQLSERVER_CONFIG.get("port")
    server_with_port = f"{server},{port}" if port else str(server)
    conn_str = (
        f"DRIVER={{{SQLSERVER_CONFIG['driver']}}};"
        f"SERVER={server_with_port};"
        f"DATABASE={SQLSERVER_CONFIG['database']};"
        f"UID={SQLSERVER_CONFIG['username']};"
        f"PWD={SQLSERVER_CONFIG['password']};"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str, timeout=30)


def connect_postgres() -> psycopg2.extensions.connection:
    return psycopg2.connect(**POSTGRES_CONFIG)


def make_date_range(args: argparse.Namespace) -> tuple[date, date]:
    if args.from_date:
        start = datetime.strptime(args.from_date, "%Y-%m-%d").date()
    else:
        start = date.today() - timedelta(days=args.days)

    if args.to_date:
        end = datetime.strptime(args.to_date, "%Y-%m-%d").date()
    else:
        end = date.today()

    if start > end:
        raise ValueError("--from tidak boleh lebih besar dari --to")
    return start, end


def build_source_sql() -> str:
    return """
    SELECT
      CONCAT(
        CAST(p.proddataid AS varchar(32)), '|',
        CAST(p.machineno AS varchar(32)), '|',
        CONVERT(varchar(19), p.startdatetime, 120)
      ) AS record_key,
      p.proddataid,
      CONVERT(varchar(10), CAST(DATEADD(HOUR, -8, p.startdatetime) AS DATE), 23) AS work_date,
      p.machineno,
      COALESCE(m.machineid, '') AS machineid,
      COALESCE(m.machinename, '') AS machinename,
      COALESCE(NULLIF(m.description, ''), m.machinename, CONCAT('Machine ', p.machineno)) AS machine_description,
      CAST(m.plantid AS varchar(64)) AS plantid,
      p.statusid,
      COALESCE(st.description, 'Unknown') AS status_description,
      '' AS activitytype,
      COALESCE(p.operatorid, '') AS operatorid,
      COALESCE(p.jobid, '') AS jobid,
      '' AS order_no,
      '' AS operation_no,
      '' AS sequence_category,
      '' AS sequence_number,
      '' AS ph3_sequence_number,
      '' AS branch_operation_no,
      '' AS return_operation_no,
      COALESCE(m.machineid, '') AS work_center,
      1 AS event_count,
      CASE WHEN p.enddatetime IS NULL THEN 1 ELSE 0 END AS open_event_count,
      DATEADD(HOUR, -8, p.startdatetime) AS first_startdatetime,
      DATEADD(HOUR, -8, p.enddatetime) AS last_enddatetime,
      CASE
        WHEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime) > 1
          THEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
        ELSE 0
      END AS duration_seconds,
      ROUND(
        CAST(
          CASE
            WHEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime) > 1
              THEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
            ELSE 0
          END AS NUMERIC(18, 4)
        ) / 3600.0,
        4
      ) AS duration_hours
    FROM dbo.ProductionData p
    LEFT JOIN dbo.Machines m ON m.machineno = p.machineno
    LEFT JOIN dbo.StatusTypes st ON st.statusid = p.statusid
    WHERE p.startdatetime IS NOT NULL
      AND (p.enddatetime IS NULL OR DATEDIFF(SECOND, p.startdatetime, p.enddatetime) > 1)
      AND p.statusid <> 2
      AND CAST(DATEADD(HOUR, -8, p.startdatetime) AS DATE) >= ?
      AND CAST(DATEADD(HOUR, -8, p.startdatetime) AS DATE) <= ?
    ORDER BY p.startdatetime ASC, p.proddataid ASC
    """


def normalize_activity_type(status_description: Any) -> str:
    value = str(status_description or "").strip().lower()
    normalized = " ".join("".join(ch if ch.isalnum() else " " for ch in value).split())
    if normalized == "productive":
        return "M1"
    if normalized in {
        "load",
        "loading",
        "setting",
        "measure",
        "meassure",
        "unload",
        "unloading",
        "preventive",
    }:
        return "M2"
    return ""


def strip_zero(value: Any) -> str:
    text = str(value or "").lstrip("0")
    return text or "0"


def bulk_lookup_operation_text(pg_cursor, jobids: list[str]) -> dict[str, str]:
    if not jobids:
        return {}
    stripped = sorted({strip_zero(jobid) for jobid in jobids if jobid})
    if not stripped:
        return {}

    try:
        pg_cursor.execute(
            """
            SELECT confirmation_number, operation_short_text
            FROM public.ph3_order
            WHERE LTRIM(confirmation_number::text, '0') = ANY(%s)
            """,
            (stripped,),
        )
    except psycopg2.Error as exc:
        pg_cursor.connection.rollback()
        log.warning("Skip operation_short_text lookup: %s", exc)
        return {}

    result: dict[str, str] = {}
    for confirmation_number, operation_short_text in pg_cursor.fetchall():
        key = strip_zero(confirmation_number)
        if key and key not in result:
            result[key] = operation_short_text or ""
    return result


def row_to_dict(cursor: pyodbc.Cursor, row) -> dict[str, Any]:
    columns = [col[0] for col in cursor.description]
    return dict(zip(columns, row))


def to_pg_tuple(row: dict[str, Any], operation_short_text: str) -> tuple:
    duration_seconds = int(row.get("duration_seconds") or 0)
    duration_hours = row.get("duration_hours")
    if duration_hours is None:
        duration_hours = Decimal(duration_seconds) / Decimal(3600)

    return (
        row.get("record_key"),
        row.get("proddataid"),
        row.get("work_date"),
        row.get("machineno"),
        row.get("machineid") or "",
        row.get("machinename") or "",
        row.get("machine_description") or "",
        row.get("plantid") or "",
        row.get("statusid"),
        row.get("status_description") or "",
        normalize_activity_type(row.get("status_description")),
        row.get("operatorid") or "",
        row.get("jobid") or "",
        row.get("order_no") or "",
        row.get("operation_no") or "",
        row.get("sequence_category") or "",
        row.get("sequence_number") or "",
        row.get("ph3_sequence_number") or "",
        row.get("branch_operation_no") or "",
        row.get("return_operation_no") or "",
        row.get("work_center") or row.get("machineid") or "",
        operation_short_text or "",
        int(row.get("event_count") or 1),
        int(row.get("open_event_count") or 0),
        row.get("first_startdatetime"),
        row.get("last_enddatetime"),
        duration_seconds,
        duration_hours,
        datetime.now(),
    )


def ensure_target_table(pg_conn, schema: str) -> None:
    schema_ident = quote_ident(schema)
    with pg_conn.cursor() as cur:
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_ident}")
        cur.execute(CREATE_TABLE_SQL.format(schema=schema_ident))
    pg_conn.commit()


def truncate_target(pg_conn, schema: str) -> None:
    with pg_conn.cursor() as cur:
        cur.execute(f"TRUNCATE TABLE {quote_ident(schema)}.{quote_ident(TABLE_NAME)}")
    pg_conn.commit()


def sync_machine_hours(args: argparse.Namespace) -> None:
    schema = args.schema
    schema_ident = quote_ident(schema)
    start_date, end_date = make_date_range(args)
    source_sql = build_source_sql()

    log.info(
        "SQL Server: %s:%s/%s",
        SQLSERVER_CONFIG["server"],
        SQLSERVER_CONFIG["port"],
        SQLSERVER_CONFIG["database"],
    )
    log.info(
        "PostgreSQL:  %s:%s/%s",
        POSTGRES_CONFIG["host"],
        POSTGRES_CONFIG["port"],
        POSTGRES_CONFIG["dbname"],
    )
    log.info("Target:      %s.%s", schema, TABLE_NAME)
    log.info("Range:       %s to %s", start_date, end_date)

    sql_conn = None
    pg_conn = None
    sql_cursor = None
    total = 0
    batches = 0

    try:
        sql_conn = connect_sqlserver()
        sql_cursor = sql_conn.cursor()
        pg_conn = connect_postgres()
        ensure_target_table(pg_conn, schema)

        if args.truncate:
            if args.dry_run:
                log.info("DRY RUN: would truncate %s.%s", schema, TABLE_NAME)
            else:
                log.warning("Truncating %s.%s", schema, TABLE_NAME)
                truncate_target(pg_conn, schema)

        sql_cursor.execute(source_sql, (start_date, end_date))

        while True:
            fetched = sql_cursor.fetchmany(args.batch_size)
            if not fetched:
                break

            rows = [row_to_dict(sql_cursor, row) for row in fetched]
            jobids = [row.get("jobid") for row in rows if row.get("jobid")]
            with pg_conn.cursor() as pg_cursor:
                op_map = bulk_lookup_operation_text(pg_cursor, jobids)

            values = [
                to_pg_tuple(row, op_map.get(strip_zero(row.get("jobid")), "")) for row in rows
            ]

            if args.dry_run:
                log.info(
                    "DRY RUN: fetched batch rows=%d first_record=%s",
                    len(values),
                    values[0][0] if values else "-",
                )
            else:
                with pg_conn.cursor() as pg_cursor:
                    psycopg2.extras.execute_values(
                        pg_cursor,
                        UPSERT_SQL.format(schema=schema_ident),
                        values,
                        page_size=min(args.batch_size, 1000),
                    )
                pg_conn.commit()

            total += len(values)
            batches += 1
            log.info("Batch %d done, total rows=%d", batches, total)

        log.info("Done. rows=%d batches=%d%s", total, batches, " (dry-run)" if args.dry_run else "")

    except Exception:
        if pg_conn:
            pg_conn.rollback()
        raise
    finally:
        if sql_cursor:
            sql_cursor.close()
        if sql_conn:
            sql_conn.close()
        if pg_conn:
            pg_conn.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ETL SQL Server machine hours into PostgreSQL mch_transaction"
    )
    parser.add_argument("--from", dest="from_date", help="Start work date YYYY-MM-DD")
    parser.add_argument("--to", dest="to_date", help="End work date YYYY-MM-DD")
    parser.add_argument(
        "--days", type=int, default=DEFAULT_DAYS, help="Default range: today minus N days"
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--schema", default=DEFAULT_SCHEMA)
    parser.add_argument(
        "--truncate", action="store_true", help="Truncate target table before loading"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Fetch and prepare rows without inserting"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sync_machine_hours(args)


if __name__ == "__main__":
    main()
