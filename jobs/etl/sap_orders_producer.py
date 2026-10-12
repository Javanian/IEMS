"""
sap_orders_producer.py

Publishes new SAP order/operation rows to Kafka (sap.orders.v1).

    SAP ──> source PostgreSQL (ph3_order, status_etl = 'NEW', pg_notify 'etl_new_row')
        ──> this producer ──> sap.orders.v1 (key = confirmation_number, compacted)
        ──> sap_orders_consumer.py, one consumer group per plant ──> plant database

This replaces the fan-out in etl_sync_v2.py, where one process wrote into every plant
database itself and a slow or offline plant had to be retried by that process. With Kafka
the source is read once, and each plant catches up from the topic at its own pace. Because
the topic is compacted by confirmation_number, a new plant database can be filled by
replaying it from the beginning.

A source row is marked status_etl = 'UPDATED' only after the broker acknowledged its
message. If the process stops between the two, the row is published again on restart;
consumers upsert by confirmation_number, so the duplicate changes nothing.

Run either this producer or etl_sync_v2.py against a source table, not both.

Environment:
    SRC_HOST SRC_PORT SRC_DATABASE SRC_USER SRC_PASSWORD SRC_TABLE
    SAP_ORDER_PLANTS        comma-separated plant codes to publish (empty = all)
    KAFKA_BOOTSTRAP_SERVERS
    POLL_INTERVAL_SECONDS   fallback polling when no NOTIFY arrives (default 5)
    BATCH_LIMIT             rows per publish batch (default 1000)
"""

from __future__ import annotations

import logging
import os
import select
import signal
import sys
import time
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from psycopg2 import extras

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR.parent / "messaging"))

from iems_kafka import (  # noqa: E402
    EVENT_ORDER_UPSERTED,
    TOPIC_ORDERS,
    OutgoingMessage,
    build_envelope,
    make_producer,
    publish_and_confirm,
)
from order_sync_core import SELECT_COL_SQL, quote_identifier, quote_table_name  # noqa: E402

PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(PROJECT_ROOT / ".env")

logging.basicConfig(level=os.environ.get("ETL_LOG_LEVEL", "INFO").upper(), format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("sap_orders_producer")

PRODUCER_NAME = "sap-orders-producer"
_stop = False


def source_dsn() -> dict:
    return {
        "host": os.environ["SRC_HOST"],
        "port": int(os.environ.get("SRC_PORT", 5432)),
        "dbname": os.environ["SRC_DATABASE"],
        "user": os.environ["SRC_USER"],
        "password": os.environ["SRC_PASSWORD"],
        "connect_timeout": int(os.environ.get("CONNECT_TIMEOUT_SECONDS", 5)),
        "application_name": "iems-sap-orders-producer",
    }


def configured_plants() -> list[str]:
    return [p.strip() for p in os.environ.get("SAP_ORDER_PLANTS", "").split(",") if p.strip()]


def message_key(row: dict) -> str:
    """Same normalization as the consumer (leading zeros stripped), so the compacted
    topic keeps one record per confirmation regardless of how SAP padded it."""
    return str(row["confirmation_number"]).lstrip("0") or "0"


def publish_new_rows(conn, producer, table_sql: str, plants: list[str], batch_limit: int) -> int:
    plant_filter = f"AND {quote_identifier('plant_code')} = ANY(%s)" if plants else ""
    sql = (
        f"SELECT {SELECT_COL_SQL} FROM {table_sql} "
        f"WHERE {quote_identifier('status_etl')} = 'NEW' {plant_filter} "
        f"ORDER BY {quote_identifier('created_at')} ASC LIMIT %s "
        f"FOR UPDATE SKIP LOCKED"
    )
    params = ([plants] if plants else []) + [batch_limit]
    try:
        with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            conn.rollback()
            return 0

        messages = [
            OutgoingMessage(
                topic=TOPIC_ORDERS,
                key=message_key(row),
                envelope=build_envelope(EVENT_ORDER_UPSERTED, row, PRODUCER_NAME),
                headers={"plant": str(row.get("plant_code") or "")},
                ref=row["confirmation_number"],
            )
            for row in rows
        ]
        delivered, failed = publish_and_confirm(producer, messages)
        if delivered:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {table_sql} SET {quote_identifier('status_etl')} = 'UPDATED' "
                    f"WHERE {quote_identifier('confirmation_number')} = ANY(%s)",
                    (delivered,),
                )
        conn.commit()
        if failed:
            log.error("%s row(s) not acknowledged by Kafka; they stay NEW. First error: %s", len(failed), failed[0][1])
        log.info("Published %s order row(s) to %s", len(delivered), TOPIC_ORDERS)
        return len(delivered)
    except Exception:
        conn.rollback()
        raise


def _handle_signal(signum, _frame) -> None:
    global _stop
    _stop = True
    log.info("Signal %s received, stopping", signum)


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    table_sql = quote_table_name(os.environ["SRC_TABLE"])
    plants = configured_plants()
    poll_interval = int(os.environ.get("POLL_INTERVAL_SECONDS", 5))
    batch_limit = int(os.environ.get("BATCH_LIMIT", 1000))
    channel = os.environ.get("ETL_NOTIFY_CHANNEL", "etl_new_row")
    producer = make_producer("sap-orders")
    log.info("Publishing %s -> %s (plants=%s)", os.environ["SRC_TABLE"], TOPIC_ORDERS, plants or "all")

    while not _stop:
        listen_conn = work_conn = None
        try:
            listen_conn = psycopg2.connect(**source_dsn())
            listen_conn.autocommit = True
            with listen_conn.cursor() as cur:
                cur.execute(f"LISTEN {quote_identifier(channel)}")
            work_conn = psycopg2.connect(**source_dsn())

            while not _stop:
                # Drain everything that is waiting, then sleep until NOTIFY or timeout.
                while publish_new_rows(work_conn, producer, table_sql, plants, batch_limit) == batch_limit:
                    pass
                if select.select([listen_conn], [], [], poll_interval)[0]:
                    listen_conn.poll()
                    listen_conn.notifies.clear()
        except Exception as exc:
            log.exception("Producer loop failed: %s", exc)
            time.sleep(int(os.environ.get("RECONNECT_DELAY_SECONDS", 5)))
        finally:
            for conn in (listen_conn, work_conn):
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass
    producer.flush(10)


if __name__ == "__main__":
    main()
