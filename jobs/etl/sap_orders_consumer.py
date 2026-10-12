"""
sap_orders_consumer.py

Applies SAP order/operation events from Kafka (sap.orders.v1) to one plant database.

Run one instance per plant database. Each plant uses its own consumer group
(iems-orders-<plant>), so plants read the topic independently: a plant that was offline
continues from its last committed offset, and a new plant starts from the beginning of
the compacted topic.

Batches are written in one transaction with the same upsert as etl_sync_v2.py
(order_sync_core.upsert_orders). Offsets are committed after the database commit; if
the process dies in between, the batch is applied again, which is harmless because every
write is an upsert keyed by confirmation_number or (order_no, operation_no).

Messages that cannot be parsed go to sap.orders.dlq.v1 with the reason in the headers.

Environment:
    TGT_HOST TGT_PORT TGT_DATABASE TGT_USER TGT_PASSWORD
    TGT_TABLE               order table in the plant database (e.g. public.ph3_order)
    TGT_PLANT               plant code this database serves; other plants are ignored
    KAFKA_BOOTSTRAP_SERVERS
    KAFKA_ORDERS_GROUP      override the consumer group (default iems-orders-<TGT_PLANT>)
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from pathlib import Path

import psycopg2
from confluent_kafka import KafkaException
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR.parent / "messaging"))

from iems_kafka import (  # noqa: E402
    EVENT_ORDER_UPSERTED,
    TOPIC_ORDERS,
    TOPIC_ORDERS_DLQ,
    EnvelopeError,
    decode,
    make_consumer,
    make_producer,
    send_to_dlq,
)
from order_sync_core import UPSERT_COLS, prepare_target_rows, quote_table_name, upsert_orders  # noqa: E402

PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(PROJECT_ROOT / ".env")

logging.basicConfig(level=os.environ.get("ETL_LOG_LEVEL", "INFO").upper(), format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("sap_orders_consumer")

_stop = False


def target_dsn() -> dict:
    return {
        "host": os.environ["TGT_HOST"],
        "port": int(os.environ.get("TGT_PORT", 5432)),
        "dbname": os.environ["TGT_DATABASE"],
        "user": os.environ["TGT_USER"],
        "password": os.environ["TGT_PASSWORD"],
        "connect_timeout": int(os.environ.get("CONNECT_TIMEOUT_SECONDS", 5)),
        "application_name": "iems-sap-orders-consumer",
    }


def parse_order(msg) -> dict:
    data = decode(msg.value(), EVENT_ORDER_UPSERTED)["data"]
    missing = [col for col in ("confirmation_number", "order_no", "operation_no") if not data.get(col)]
    if missing:
        raise EnvelopeError(f"order row is missing {', '.join(missing)}")
    return {col: data.get(col) for col in UPSERT_COLS}


class OrderBatchApplier:
    def __init__(self, consumer, producer, group_id: str, plant: str, table_sql: str, page_size: int):
        self.consumer = consumer
        self.producer = producer
        self.group_id = group_id
        self.plant = plant
        self.table_sql = table_sql
        self.page_size = page_size
        self.conn = None

    def _connection(self):
        if self.conn is None or self.conn.closed:
            self.conn = psycopg2.connect(**target_dsn())
            self.conn.autocommit = False
        return self.conn

    def apply(self, messages: list) -> int:
        """Write one polled batch. Returns the number of rows upserted."""
        rows = []
        for msg in messages:
            try:
                row = parse_order(msg)
            except EnvelopeError as exc:
                log.error("Poison message %s[%s]@%s: %s", msg.topic(), msg.partition(), msg.offset(), exc)
                send_to_dlq(self.producer, TOPIC_ORDERS_DLQ, msg, str(exc), self.group_id)
                continue
            if str(row.get("plant_code") or "") == self.plant:
                rows.append(row)

        prepared = prepare_target_rows(self.plant, rows, log)
        if prepared:
            conn = self._connection()
            try:
                with conn.cursor() as cur:
                    upsert_orders(cur, self.table_sql, prepared, self.page_size)
                conn.commit()
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    self.conn = None
                raise
        return len(prepared)


def rewind(consumer, messages: list) -> None:
    """Seek every partition in the batch back to its first offset so the batch is retried."""
    from confluent_kafka import TopicPartition

    first: dict[tuple[str, int], int] = {}
    for msg in messages:
        key = (msg.topic(), msg.partition())
        first[key] = min(first.get(key, msg.offset()), msg.offset())
    for (topic, partition), offset in first.items():
        consumer.seek(TopicPartition(topic, partition, offset))


def _handle_signal(signum, _frame) -> None:
    global _stop
    _stop = True
    log.info("Signal %s received, stopping after this batch", signum)


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    plant = os.environ["TGT_PLANT"].strip()
    table_sql = quote_table_name(os.environ["TGT_TABLE"])
    group_id = os.environ.get("KAFKA_ORDERS_GROUP") or f"iems-orders-{plant}"
    batch_size = int(os.environ.get("BATCH_LIMIT", 500))
    page_size = int(os.environ.get("BATCH_PAGE_SIZE", 500))
    retry_seconds = float(os.environ.get("KAFKA_HANDLER_RETRY_SECONDS", 5))

    consumer = make_consumer(group_id, f"orders-{plant}")
    producer = make_producer(f"orders-{plant}-dlq")
    applier = OrderBatchApplier(consumer, producer, group_id, plant, table_sql, page_size)
    consumer.subscribe([TOPIC_ORDERS])
    log.info("Consuming %s as group %s into %s (plant %s)", TOPIC_ORDERS, group_id, os.environ["TGT_TABLE"], plant)

    try:
        while not _stop:
            messages = [m for m in consumer.consume(num_messages=batch_size, timeout=1.0) if not m.error()]
            if not messages:
                continue
            try:
                applied = applier.apply(messages)
            except Exception:
                log.exception("Batch of %s message(s) failed; retrying in %.0fs", len(messages), retry_seconds)
                rewind(consumer, messages)
                time.sleep(retry_seconds)
                continue
            try:
                consumer.commit(asynchronous=False)
            except KafkaException as exc:
                # Group rebalanced; the new owner re-applies the batch (upserts are idempotent).
                log.warning("Offset commit failed (%s); batch may be applied again", exc)
            if applied:
                log.info("Applied %s order row(s) from %s message(s)", applied, len(messages))
    finally:
        consumer.close()
        producer.flush(10)


if __name__ == "__main__":
    main()
