import argparse
import logging
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import psycopg2
import psycopg2.extras
import pymssql


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
}

POSTGRES_CONFIG = {
    "host": _env("PG_HOST", default="10.169.1.12"),
    "port": int(_env("PG_PORT", default="5433")),
    "dbname": _env("PG_DBNAME", default="ptssb"),
    "user": _env("PG_USER", "DB_USER", default="tag"),
    "password": _env("PG_PASSWORD", "DB_PASSWORD", required=True),
}

SOURCE_TABLE = "dbo.MachineHeartbeat"
SOURCE_SCHEMA = "dbo"
SOURCE_NAME = "MachineHeartbeat"
TARGET_TABLE = "ews.machine_heartbeat_daily"


INTERVAL_SECONDS = 300
TRAILING_DAYS = 2

SQLSERVER_TO_PG = {
    "bigint": "bigint",
    "int": "integer",
    "smallint": "smallint",
    "tinyint": "smallint",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sync_machine_heartbeat")


def connect_sqlserver():
    host, _, port = SQLSERVER_CONFIG["server"].partition(",")
    return pymssql.connect(
        server=host.strip(),
        port=int(port.strip()) if port.strip() else 1433,
        user=SQLSERVER_CONFIG["username"],
        password=SQLSERVER_CONFIG["password"],
        database=SQLSERVER_CONFIG["database"],
        timeout=120,
        login_timeout=30,
        autocommit=True,
    )


def connect_postgres():
    conn = psycopg2.connect(**POSTGRES_CONFIG)
    conn.autocommit = False
    return conn


def fetch_machineno_pg_type(mssql_cursor) -> str:
    mssql_cursor.execute(
        """
        SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND LOWER(COLUMN_NAME) = 'machineno'
        """,
        (SOURCE_SCHEMA, SOURCE_NAME),
    )
    row = mssql_cursor.fetchone()
    sql_type = str(row[0]).lower() if row else "int"
    return SQLSERVER_TO_PG.get(sql_type, "integer")


def ensure_target_table(pg_conn, machineno_type: str) -> None:
    ddl = f"""
    CREATE SCHEMA IF NOT EXISTS ews;
    CREATE TABLE IF NOT EXISTS {TARGET_TABLE} (
        work_date     date NOT NULL,
        machineno     {machineno_type} NOT NULL,
        pings         bigint NOT NULL DEFAULT 0,
        up_pings      bigint NOT NULL DEFAULT 0,
        uptime_pct    numeric(6,2),
        avg_heartbeat numeric,
        updated_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (work_date, machineno)
    );
    CREATE INDEX IF NOT EXISTS idx_machine_heartbeat_daily_machineno
        ON {TARGET_TABLE} (machineno);
    """
    with pg_conn.cursor() as cur:
        cur.execute(ddl)
    pg_conn.commit()
    log.info("Target table ready: %s (machineno=%s)", TARGET_TABLE, machineno_type)


UPSERT_SQL = f"""
INSERT INTO {TARGET_TABLE}
    (work_date, machineno, pings, up_pings, uptime_pct, avg_heartbeat)
VALUES %s
ON CONFLICT (work_date, machineno) DO UPDATE SET
    pings         = EXCLUDED.pings,
    up_pings      = EXCLUDED.up_pings,
    uptime_pct    = EXCLUDED.uptime_pct,
    avg_heartbeat = EXCLUDED.avg_heartbeat,
    updated_at    = now()
"""


AGGREGATE_SQL = f"""
SELECT
    CAST([CreatedDate] AS date)                             AS work_date,
    [MachineNo]                                             AS machineno,
    COUNT_BIG(*)                                            AS pings,
    SUM(CASE WHEN [Heartbeat] <> 0 THEN 1 ELSE 0 END)       AS up_pings,
    AVG(CAST([Heartbeat] AS float))                         AS avg_heartbeat
FROM {SOURCE_TABLE}
WHERE [CreatedDate] >= %s AND [CreatedDate] < %s
GROUP BY CAST([CreatedDate] AS date), [MachineNo]
"""


def aggregate_source(mssql_cursor, from_ts: datetime, to_ts: datetime) -> list:
    mssql_cursor.execute(AGGREGATE_SQL, (from_ts, to_ts))
    return mssql_cursor.fetchall()


def upsert_daily(pg_conn, rows: list) -> int:
    if not rows:
        return 0
    values = []
    for work_date, machineno, pings, up_pings, avg_heartbeat in rows:
        pings = int(pings or 0)
        up_pings = int(up_pings or 0)
        uptime_pct = round(up_pings * 100.0 / pings, 2) if pings else None
        values.append((work_date, machineno, pings, up_pings, uptime_pct, avg_heartbeat))
    with pg_conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, UPSERT_SQL, values, page_size=1000)
        affected = cur.rowcount
    pg_conn.commit()
    return affected if affected and affected > 0 else len(values)


def refresh_window(mssql_conn, pg_conn, from_ts: datetime, to_ts: datetime) -> int:
    cur = mssql_conn.cursor()
    try:
        rows = aggregate_source(cur, from_ts, to_ts)
    finally:
        cur.close()
    written = upsert_daily(pg_conn, rows)
    log.info(
        "Aggregated %s..%s -> %d (machine,day) row(s) upserted",
        from_ts.date(),
        (to_ts - timedelta(seconds=1)).date(),
        written,
    )
    return written


def trailing_window(days: int) -> tuple[datetime, datetime]:
    today = date.today()
    from_ts = datetime.combine(today - timedelta(days=max(days - 1, 0)), datetime.min.time())
    to_ts = datetime.combine(today + timedelta(days=1), datetime.min.time())
    return from_ts, to_ts


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Sync daily MachineHeartbeat aggregate (per date, per machine) to PostgreSQL."
    )
    p.add_argument(
        "--from",
        dest="from_date",
        help="Backfill start date YYYY-MM-DD (with --to). One-shot, then exit.",
    )
    p.add_argument(
        "--to", dest="to_date", help="Backfill end date YYYY-MM-DD inclusive (with --from)."
    )
    p.add_argument(
        "--once", action="store_true", help="Refresh the trailing window once, then exit."
    )
    p.add_argument(
        "--days",
        type=int,
        default=TRAILING_DAYS,
        help=f"Trailing window size in days (default {TRAILING_DAYS} = today+yesterday).",
    )
    p.add_argument(
        "--interval",
        type=int,
        default=INTERVAL_SECONDS,
        help=f"Daemon refresh interval seconds (default {INTERVAL_SECONDS}).",
    )
    return p


def parse_day(value: str, label: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit(f"{label} harus format YYYY-MM-DD") from exc


def run_backfill(args) -> None:
    if not (args.from_date and args.to_date):
        raise SystemExit("--from and --to must be used together")
    from_d = parse_day(args.from_date, "--from")
    to_d = parse_day(args.to_date, "--to")
    if from_d > to_d:
        raise SystemExit("--from tidak boleh lebih besar dari --to")
    from_ts = datetime.combine(from_d, datetime.min.time())
    to_ts = datetime.combine(to_d + timedelta(days=1), datetime.min.time())

    mssql_conn = connect_sqlserver()
    pg_conn = connect_postgres()
    try:
        ensure_target_table(pg_conn, fetch_machineno_pg_type(mssql_conn.cursor()))
        refresh_window(mssql_conn, pg_conn, from_ts, to_ts)
    finally:
        for c in (mssql_conn, pg_conn):
            try:
                c.close()
            except Exception:
                pass
    log.info("Backfill complete: %s..%s", from_d, to_d)


def run_daemon(args) -> None:
    log.info(
        "MachineHeartbeat DAILY sync: %s/%s -> %s:%s/%s (trailing %dd, every %ds)",
        SQLSERVER_CONFIG["server"],
        SQLSERVER_CONFIG["database"],
        POSTGRES_CONFIG["host"],
        POSTGRES_CONFIG["port"],
        POSTGRES_CONFIG["dbname"],
        args.days,
        args.interval,
    )
    mssql_conn = None
    pg_conn = None
    table_ready = False

    while True:
        try:
            if mssql_conn is None:
                mssql_conn = connect_sqlserver()
            if pg_conn is None or pg_conn.closed:
                pg_conn = connect_postgres()
            if not table_ready:
                probe = mssql_conn.cursor()
                try:
                    machineno_type = fetch_machineno_pg_type(probe)
                finally:
                    probe.close()
                ensure_target_table(pg_conn, machineno_type)
                table_ready = True

            from_ts, to_ts = trailing_window(args.days)
            refresh_window(mssql_conn, pg_conn, from_ts, to_ts)
        except KeyboardInterrupt:
            log.info("Stopped by user.")
            break
        except (pymssql.Error, psycopg2.Error) as exc:
            log.error("Sync error, will reconnect next cycle: %s", exc)
            for conn in (mssql_conn, pg_conn):
                try:
                    if conn:
                        conn.close()
                except Exception:
                    pass
            mssql_conn = None
            pg_conn = None
            table_ready = False
        except Exception as exc:  # noqa: BLE001 - keep the daemon alive
            log.exception("Unexpected error: %s", exc)

        if args.once:
            break
        time.sleep(args.interval)


def main() -> None:
    args = build_parser().parse_args()
    if args.from_date or args.to_date:
        run_backfill(args)
    else:
        run_daemon(args)


if __name__ == "__main__":
    main()
