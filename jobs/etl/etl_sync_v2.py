from __future__ import annotations

import logging
import os
import select
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

import psycopg2
from dotenv import load_dotenv
from psycopg2 import extras, pool

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(PROJECT_ROOT / ".env")


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value in (None, ""):
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {value!r}") from exc


def quote_identifier(identifier: str) -> str:
    if not identifier:
        raise ValueError("SQL identifier cannot be empty")
    if identifier.startswith('"') and identifier.endswith('"'):
        identifier = identifier[1:-1].replace('""', '"')
    return '"' + identifier.replace('"', '""') + '"'


def quote_table_name(table_name: str) -> str:
    parts = [part.strip() for part in table_name.split(".")]
    if not parts or any(not part for part in parts):
        raise ValueError(f"Invalid SQL table name: {table_name!r}")
    return ".".join(quote_identifier(part) for part in parts)


LOG_LEVEL = os.environ.get("ETL_LOG_LEVEL", "INFO").upper()
LOG_FILE = Path(os.environ.get("ETL_LOG_FILE", BASE_DIR / "logs" / "etl_sync_v2.log"))
LOG_MAX_BYTES = env_int("ETL_LOG_MAX_BYTES", 10 * 1024 * 1024)
LOG_BACKUP_COUNT = env_int("ETL_LOG_BACKUP_COUNT", 7)


def configure_logging() -> logging.Logger:
    level = getattr(logging, LOG_LEVEL, logging.INFO)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s")

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root.addHandler(console_handler)

    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=LOG_MAX_BYTES,
            backupCount=LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except Exception as exc:  # pragma: no cover - last-resort console warning
        root.warning("Cannot open ETL log file %s: %s", LOG_FILE, exc)

    return logging.getLogger(__name__)


log = configure_logging()


SRC_DSN = {
    "host": os.environ["SRC_HOST"],
    "port": int(os.environ.get("SRC_PORT", 5432)),
    "dbname": os.environ["SRC_DATABASE"],
    "user": os.environ["SRC_USER"],
    "password": os.environ["SRC_PASSWORD"],
    "connect_timeout": env_int(
        "SRC_CONNECT_TIMEOUT_SECONDS",
        env_int("CONNECT_TIMEOUT_SECONDS", 5),
    ),
    "application_name": "mps2-etl-source",
}
SRC_TABLE = os.environ["SRC_TABLE"]
SRC_TABLE_SQL = quote_table_name(SRC_TABLE)

POLL_INTERVAL = env_int("POLL_INTERVAL_SECONDS", 5)
RECONNECT_DELAY = env_int("RECONNECT_DELAY_SECONDS", 5)
BATCH_LIMIT = env_int("BATCH_LIMIT", 1000)
BATCH_PAGE_SIZE = env_int("BATCH_PAGE_SIZE", min(BATCH_LIMIT, 500))
SRC_POOL_MIN_CONNECTIONS = env_int("SRC_POOL_MIN_CONNECTIONS", 1)
SRC_POOL_MAX_CONNECTIONS = env_int("SRC_POOL_MAX_CONNECTIONS", 12)
TARGET_POOL_MIN_CONNECTIONS = env_int("TARGET_POOL_MIN_CONNECTIONS", 1)
TARGET_POOL_MAX_CONNECTIONS = env_int("TARGET_POOL_MAX_CONNECTIONS", 4)
TARGET_CONNECT_TIMEOUT = env_int(
    "TARGET_CONNECT_TIMEOUT_SECONDS",
    env_int("CONNECT_TIMEOUT_SECONDS", 5),
)
TARGET_BACKOFF_SECONDS = env_int("TARGET_BACKOFF_SECONDS", 10)
TARGET_MAX_BACKOFF_SECONDS = env_int("TARGET_MAX_BACKOFF_SECONDS", 300)
STATEMENT_TIMEOUT_MS = env_int("ETL_STATEMENT_TIMEOUT_MS", 120_000)
LOCK_TIMEOUT_MS = env_int("ETL_LOCK_TIMEOUT_MS", 10_000)
NOTIFY_CHANNEL = os.environ.get("ETL_NOTIFY_CHANNEL", "etl_new_row")
SRC_POOL_TIMEOUT_SECONDS = env_int("SRC_POOL_TIMEOUT_SECONDS", 30)
TGT_POOL_TIMEOUT_SECONDS = env_int("TGT_POOL_TIMEOUT_SECONDS", 30)

if BATCH_LIMIT < 1:
    raise ValueError("BATCH_LIMIT must be at least 1")
if BATCH_PAGE_SIZE < 1:
    raise ValueError("BATCH_PAGE_SIZE must be at least 1")


_TARGET_DEFS = [
    ("BALIKPAPAN", "_BALIKPAPAN"),
    ("SEBAMBAN", "_SEBAMBAN"),
    ("KUALA_KENCANA", "_KUALA_KENCANA"),
    ("CIKUPA", "_CIKUPA"),
]


@dataclass
class TargetRuntime:
    name: str
    dsn: dict
    table: str
    plant: str
    table_sql: str
    upsert_sql: str = ""
    pool: Optional[pool.ThreadedConnectionPool] = None
    state_lock: threading.Lock = field(default_factory=threading.Lock)
    queued: bool = False
    running: bool = False
    failures: int = 0
    next_attempt_at: float = 0.0
    last_error: Optional[str] = None


@dataclass(frozen=True)
class CycleResult:
    ok: bool
    batch_full: bool = False
    source_rows: int = 0
    target_rows: int = 0
    target_checked: bool = False
    error: Optional[str] = None


def _build_target(name: str, suffix: str) -> TargetRuntime:
    dsn = {
        "host": os.environ[f"TGT_HOST{suffix}"],
        "port": int(os.environ.get(f"TGT_PORT{suffix}", 5432)),
        "dbname": os.environ[f"TGT_DATABASE{suffix}"],
        "user": os.environ[f"TGT_USER{suffix}"],
        "password": os.environ[f"TGT_PASSWORD{suffix}"],
        "connect_timeout": TARGET_CONNECT_TIMEOUT,
        "application_name": f"mps2-etl-{name.lower()}",
    }
    table = os.environ[f"TGT_TABLE{suffix}"]
    return TargetRuntime(
        name=name,
        dsn=dsn,
        table=table,
        plant=os.environ[f"TGT_PLANT{suffix}"],
        table_sql=quote_table_name(table),
    )


TARGETS = [_build_target(name, suffix) for name, suffix in _TARGET_DEFS]


UPSERT_COLS = [
    "confirmation_number",
    "indicator_code",
    "operation_short_text",
    "order_no",
    "operation_no",
    "sequence_category",
    "sequence_number",
    "branch_operation_no",
    "return_operation_no",
    "material_no",
    "material_description",
    "operation_description",
    "work_center",
    "cost_center",
    "plant_code",
    "unit_of_measure",
    "standard_value",
    "order_type",
    "order_description",
    "status_etl",
]
UPDATE_COLS = [col for col in UPSERT_COLS if col != "confirmation_number"]
STRIP_ZERO_COLS = {"confirmation_number", "order_no", "operation_no"}
UPSERT_COL_SQL = ", ".join(quote_identifier(col) for col in UPSERT_COLS)
SELECT_COL_SQL = UPSERT_COL_SQL


def build_upsert_query(table_sql: str) -> str:
    updates = ", ".join(
        f"{quote_identifier(col)} = EXCLUDED.{quote_identifier(col)}" for col in UPDATE_COLS
    )
    return (
        f"INSERT INTO {table_sql} ({UPSERT_COL_SQL}) VALUES %s "
        f"ON CONFLICT ({quote_identifier('confirmation_number')}) "
        f"DO UPDATE SET {updates}"
    )


def build_select_source_query() -> str:
    return (
        f"SELECT {SELECT_COL_SQL} FROM {SRC_TABLE_SQL} "
        f"WHERE {quote_identifier('plant_code')} = %s "
        f"AND {quote_identifier('status_etl')} = 'NEW' "
        f"ORDER BY {quote_identifier('created_at')} ASC "
        f"LIMIT %s"
    )


def build_update_source_query() -> str:
    return (
        f"UPDATE {SRC_TABLE_SQL} "
        f"SET {quote_identifier('status_etl')} = 'UPDATED' "
        f"WHERE {quote_identifier('confirmation_number')} = ANY(%s)"
    )


SELECT_SOURCE_SQL = build_select_source_query()
UPDATE_SOURCE_SQL = build_update_source_query()


_src_pool: Optional[pool.ThreadedConnectionPool] = None
_src_pool_lock = threading.Lock()

_SRC_POOL_ERROR_PAUSE = env_int("SRC_POOL_ERROR_PAUSE_SECONDS", 30)
_SRC_POOL_CONSECUTIVE_FAILURES = 0
_SRC_POOL_LAST_FAILURE_TIME = 0.0


def _close_src_pool() -> None:
    global _src_pool
    with _src_pool_lock:
        p = _src_pool
        _src_pool = None
    if p is not None:
        try:
            p.closeall()
        except Exception as exc:
            log.debug("Failed to close source pool: %s", exc)


def _get_src_pool() -> pool.ThreadedConnectionPool:
    global _src_pool, _SRC_POOL_CONSECUTIVE_FAILURES, _SRC_POOL_LAST_FAILURE_TIME
    if _src_pool is None:
        with _src_pool_lock:
            if _src_pool is None:
                _src_pool = pool.ThreadedConnectionPool(
                    SRC_POOL_MIN_CONNECTIONS,
                    SRC_POOL_MAX_CONNECTIONS,
                    **SRC_DSN,
                )
    return _src_pool


def _get_src_conn():
    src_pool = _get_src_pool()
    try:
        return src_pool.getconn()
    except Exception as exc:
        global _SRC_POOL_CONSECUTIVE_FAILURES, _SRC_POOL_LAST_FAILURE_TIME
        _SRC_POOL_CONSECUTIVE_FAILURES += 1
        now = time.monotonic()
        if (
            _SRC_POOL_CONSECUTIVE_FAILURES >= 3
            and now - _SRC_POOL_LAST_FAILURE_TIME > _SRC_POOL_ERROR_PAUSE
        ):
            log.warning(
                "Source pool exhausted (%d consecutive failures). Resetting pool.",
                _SRC_POOL_CONSECUTIVE_FAILURES,
            )
            _close_src_pool()
            _SRC_POOL_CONSECUTIVE_FAILURES = 0
            _SRC_POOL_LAST_FAILURE_TIME = 0.0
        else:
            _SRC_POOL_LAST_FAILURE_TIME = now
        raise psycopg2.pool.PoolError(
            f"source connection pool exhausted after {_SRC_POOL_CONSECUTIVE_FAILURES} failure(s)"
        ) from exc


def _return_src_conn(conn) -> None:
    src_pool = _get_src_pool()
    _safe_putconn(src_pool, conn, "source")


def _get_tgt_pool(target: TargetRuntime) -> pool.ThreadedConnectionPool:
    if target.pool is None:
        with target.state_lock:
            if target.pool is None:
                target.pool = pool.ThreadedConnectionPool(
                    TARGET_POOL_MIN_CONNECTIONS,
                    TARGET_POOL_MAX_CONNECTIONS,
                    **target.dsn,
                )
    return target.pool


def _get_tgt_conn(target: TargetRuntime):
    tgt_pool = _get_tgt_pool(target)
    try:
        return tgt_pool.getconn()
    except Exception as exc:
        raise psycopg2.pool.PoolError(f"[{target.name}] target connection pool exhausted") from exc


def _return_tgt_conn(target: TargetRuntime, conn) -> None:
    if target.pool is None:
        if conn and not conn.closed:
            try:
                conn.close()
            except Exception:
                pass
        return
    _safe_putconn(target.pool, conn, f"{target.name} target")


def _close_target_pool(target: TargetRuntime) -> None:
    with target.state_lock:
        target_pool = target.pool
        target.pool = None
    if target_pool is not None:
        try:
            target_pool.closeall()
        except Exception as exc:
            log.debug("[%s] Failed to close target pool: %s", target.name, exc)


def _close_all_pools() -> None:
    _close_src_pool()
    for target in TARGETS:
        _close_target_pool(target)


def _safe_putconn(conn_pool, conn, label: str) -> None:
    if conn is None or conn_pool is None:
        return
    try:
        conn_pool.putconn(conn, close=bool(conn.closed))
    except Exception as exc:
        log.debug("Failed to return %s connection to pool: %s", label, exc)
        try:
            conn.close()
        except Exception:
            pass


def _rollback(conn, label: str) -> None:
    if conn is None or conn.closed:
        return
    try:
        conn.rollback()
    except Exception as exc:
        log.debug("Failed to roll back %s transaction: %s", label, exc)


def _apply_transaction_limits(conn) -> None:
    settings = []
    if STATEMENT_TIMEOUT_MS > 0:
        settings.append(("statement_timeout", f"{STATEMENT_TIMEOUT_MS}ms"))
    if LOCK_TIMEOUT_MS > 0:
        settings.append(("lock_timeout", f"{LOCK_TIMEOUT_MS}ms"))
    if not settings:
        return

    with conn.cursor() as cur:
        for name, value in settings:
            cur.execute(f"SET LOCAL {name} = %s", (value,))


def _stage_touched_target(stage: str) -> bool:
    return stage in {"connect target", "upsert target", "commit target"}


def strip_zeros(row: dict) -> dict:
    result = dict(row)
    for col in STRIP_ZERO_COLS:
        value = result.get(col)
        if isinstance(value, str):
            result[col] = value.lstrip("0")
    return result


def prepare_target_rows(target_name: str, raw_rows: list[dict]) -> list[dict]:
    rows_by_confirmation: dict = {}
    order: list = []

    for raw_row in raw_rows:
        row = strip_zeros(raw_row)
        row["status_etl"] = "UPDATED"
        confirmation_number = row.get("confirmation_number")
        if confirmation_number not in rows_by_confirmation:
            order.append(confirmation_number)
        rows_by_confirmation[confirmation_number] = row

    if len(rows_by_confirmation) != len(raw_rows):
        log.warning(
            "[%s] Deduplicated %d source row(s) into %d target upsert row(s).",
            target_name,
            len(raw_rows),
            len(rows_by_confirmation),
        )

    return [rows_by_confirmation[key] for key in order]


def sync_sow(tgt_cur, rows: list[dict]) -> None:
    if not rows:
        return

    order_material: dict = {}
    for row in rows:
        order = row["order_no"]
        if order not in order_material:
            order_material[order] = (
                row.get("material_no"),
                row.get("material_description"),
            )
            continue

        existing_mat, existing_desc = order_material[order]
        order_material[order] = (
            existing_mat or row.get("material_no"),
            existing_desc or row.get("material_description"),
        )

    sow_map: dict = {}
    for row in rows:
        order_no = row["order_no"]
        operation_no = row["operation_no"]
        standard_value = row.get("standard_value")

        try:
            planhours = float(standard_value) if standard_value else None
        except (ValueError, TypeError):
            planhours = None

        part_number, part_name = order_material[order_no]
        sow_map[(order_no, operation_no)] = (
            order_no,
            operation_no,
            row.get("work_center"),
            row.get("confirmation_number"),
            planhours,
            part_number,
            part_name,
            row.get("operation_short_text"),
        )

    extras.execute_values(
        tgt_cur,
        """
        INSERT INTO sow (order_no, operation_no, workcenter, confirmation,
                         planhours, part_number, part_name, operation_text)
        VALUES %s
        ON CONFLICT (order_no, operation_no) DO UPDATE SET
            workcenter     = EXCLUDED.workcenter,
            confirmation   = EXCLUDED.confirmation,
            planhours      = EXCLUDED.planhours,
            part_number    = EXCLUDED.part_number,
            part_name      = EXCLUDED.part_name,
            operation_text = EXCLUDED.operation_text
        """,
        list(sow_map.values()),
        page_size=BATCH_PAGE_SIZE,
    )


def run_cycle(target: TargetRuntime) -> CycleResult:
    started_at = time.monotonic()
    src_conn = None
    tgt_conn = None
    stage = "start"
    should_reset_target_pool = False

    try:
        stage = "connect source"
        src_conn = _get_src_conn()
        src_conn.autocommit = False
        _apply_transaction_limits(src_conn)

        stage = "fetch source rows"
        with src_conn.cursor(cursor_factory=extras.RealDictCursor) as src_cur:
            src_cur.execute(SELECT_SOURCE_SQL, (target.plant, BATCH_LIMIT))
            raw_rows = src_cur.fetchall()

        if not raw_rows:
            src_conn.rollback()
            return CycleResult(ok=True)

        rows = prepare_target_rows(target.name, raw_rows)
        row_tuples = [tuple(row[col] for col in UPSERT_COLS) for row in rows]
        source_confirmation_numbers = [row["confirmation_number"] for row in raw_rows]

        stage = "connect target"
        tgt_conn = _get_tgt_conn(target)
        tgt_conn.autocommit = False
        _apply_transaction_limits(tgt_conn)

        stage = "upsert target"
        with tgt_conn.cursor() as tgt_cur:
            extras.execute_values(
                tgt_cur,
                target.upsert_sql,
                row_tuples,
                page_size=BATCH_PAGE_SIZE,
            )
            sync_sow(tgt_cur, rows)

        stage = "update source status"
        with src_conn.cursor() as src_cur:
            src_cur.execute(UPDATE_SOURCE_SQL, (source_confirmation_numbers,))

        stage = "commit target"
        tgt_conn.commit()

        stage = "commit source"
        src_conn.commit()

        global _SRC_POOL_CONSECUTIVE_FAILURES
        _SRC_POOL_CONSECUTIVE_FAILURES = 0

        elapsed = time.monotonic() - started_at
        batch_full = len(raw_rows) == BATCH_LIMIT
        log.info(
            "[%s] Processed %d source row(s), upserted %d target row(s) in %.2fs%s.",
            target.name,
            len(raw_rows),
            len(rows),
            elapsed,
            " (batch full)" if batch_full else "",
        )
        return CycleResult(
            ok=True,
            batch_full=batch_full,
            source_rows=len(raw_rows),
            target_rows=len(rows),
            target_checked=True,
        )

    except psycopg2.pool.PoolError as exc:
        _rollback(src_conn, "source")
        _rollback(tgt_conn, "target")
        should_reset_target_pool = _stage_touched_target(stage)
        log.error("[%s] Pool exhausted at stage '%s': %s", target.name, stage, exc)
        return CycleResult(ok=False, error=str(exc))

    except psycopg2.Error as exc:
        _rollback(src_conn, "source")
        _rollback(tgt_conn, "target")
        should_reset_target_pool = _stage_touched_target(stage)
        log.exception("[%s] Cycle failed at stage '%s'.", target.name, stage)
        return CycleResult(ok=False, error=str(exc))

    except Exception as exc:
        _rollback(src_conn, "source")
        _rollback(tgt_conn, "target")
        should_reset_target_pool = _stage_touched_target(stage)
        log.exception("[%s] Unexpected cycle failure at stage '%s'.", target.name, stage)
        return CycleResult(ok=False, error=str(exc))

    finally:
        _return_tgt_conn(target, tgt_conn)
        _return_src_conn(src_conn)
        if should_reset_target_pool:
            _close_target_pool(target)


def _mark_target_success(target: TargetRuntime) -> None:
    with target.state_lock:
        previous_failures = target.failures
        target.failures = 0
        target.next_attempt_at = 0.0
        target.last_error = None

    if previous_failures:
        log.info(
            "[%s] Recovered after %d failed cycle(s).",
            target.name,
            previous_failures,
        )


def _mark_target_failure(target: TargetRuntime, error: str) -> None:
    with target.state_lock:
        target.failures += 1
        exponent = min(target.failures - 1, 8)
        delay = min(
            TARGET_BACKOFF_SECONDS * (2**exponent),
            TARGET_MAX_BACKOFF_SECONDS,
        )
        target.next_attempt_at = time.monotonic() + delay
        target.last_error = error
        failures = target.failures

    log.warning(
        "[%s] Paused for %ds after failed cycle #%d: %s",
        target.name,
        delay,
        failures,
        error,
    )


def _drain_target(target: TargetRuntime, reason: str) -> None:
    log.debug("[%s] Drain started (%s).", target.name, reason)
    while True:
        result = run_cycle(target)
        if not result.ok:
            _mark_target_failure(target, result.error or "unknown error")
            return

        if result.target_checked:
            _mark_target_success(target)
        if not result.batch_full:
            return


def _drain_target_safe(target: TargetRuntime, reason: str) -> None:
    with target.state_lock:
        target.queued = False
        target.running = True

    try:
        _drain_target(target, reason)
    except Exception as exc:
        log.exception("[%s] Unhandled worker error.", target.name)
        _mark_target_failure(target, str(exc))
    finally:
        with target.state_lock:
            target.running = False


def _schedule_target(
    executor: ThreadPoolExecutor,
    target: TargetRuntime,
    reason: str,
) -> bool:
    now = time.monotonic()
    with target.state_lock:
        if target.queued or target.running:
            log.debug(
                "[%s] Schedule skipped; worker already queued/running.",
                target.name,
            )
            return False
        if target.next_attempt_at > now:
            remaining = target.next_attempt_at - now
            log.debug(
                "[%s] Schedule skipped; target in backoff for %.1fs.",
                target.name,
                remaining,
            )
            return False
        target.queued = True

    try:
        executor.submit(_drain_target_safe, target, reason)
        return True
    except Exception:
        with target.state_lock:
            target.queued = False
        raise


def _listen_loop(
    targets: list[TargetRuntime],
    listen_conn,
    executor: ThreadPoolExecutor,
) -> None:
    plant_map: dict[str, list[TargetRuntime]] = {}
    for target in targets:
        plant_map.setdefault(target.plant, []).append(target)

    while True:
        ready = select.select([listen_conn], [], [], POLL_INTERVAL)
        if ready[0]:
            listen_conn.poll()
            triggered_plants = set()
            while listen_conn.notifies:
                notify = listen_conn.notifies.pop(0)
                if notify.payload in plant_map:
                    triggered_plants.add(notify.payload)

            for plant in triggered_plants:
                for target in plant_map[plant]:
                    _schedule_target(executor, target, f"notify:{plant}")
            continue

        for target in targets:
            _schedule_target(executor, target, "poll")


def listen_and_process(targets: list[TargetRuntime]) -> None:
    with ThreadPoolExecutor(
        max_workers=len(targets),
        thread_name_prefix="etl",
    ) as executor:
        while True:
            listen_conn = None
            try:
                listen_conn = psycopg2.connect(**SRC_DSN)
                listen_conn.autocommit = True
                with listen_conn.cursor() as cur:
                    cur.execute(f"LISTEN {quote_identifier(NOTIFY_CHANNEL)}")
                log.info("LISTEN/NOTIFY active on channel '%s'.", NOTIFY_CHANNEL)
                _listen_loop(targets, listen_conn, executor)
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                log.exception("Listen connection error: %s", exc)
                time.sleep(RECONNECT_DELAY)
            finally:
                if listen_conn is not None:
                    try:
                        listen_conn.close()
                    except Exception:
                        pass


def main() -> None:
    for target in TARGETS:
        target.upsert_sql = build_upsert_query(target.table_sql)
        log.info(
            "ETL target registered: [%s] %s:%s/%s plant=%s table=%s",
            target.name,
            target.dsn["host"],
            target.dsn["port"],
            target.dsn["dbname"],
            target.plant,
            target.table,
        )

    log.info(
        "ETL started - source=%s.%s, poll=%ds, batch_limit=%d, targets=%d, log=%s",
        SRC_DSN["dbname"],
        SRC_TABLE,
        POLL_INTERVAL,
        BATCH_LIMIT,
        len(TARGETS),
        LOG_FILE,
    )

    try:
        listen_and_process(TARGETS)
    except KeyboardInterrupt:
        log.info("ETL stopped by KeyboardInterrupt.")
    finally:
        _close_all_pools()


if __name__ == "__main__":
    main()
