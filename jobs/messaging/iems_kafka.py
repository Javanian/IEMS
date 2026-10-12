"""
iems_kafka.py

Shared Kafka helpers for the SAP integration workers.

Two flows use Kafka:

  inbound   SAP order/operation master (ph3_order) -> sap.orders.v1 -> one consumer
            group per plant -> plant database (ph3_order + sow)
  outbound  sap_timesheet_staging -> sap.confirmations.v1 (key = AUFNR) -> poster
            -> SAP CPI -> sap.confirmations.results.v1

PostgreSQL stays the source of truth in both flows. Kafka is the transport: it
decouples producers from slow or offline consumers, keeps per-key ordering, and
lets every plant replay what it missed. Every consumer is idempotent, so the
at-least-once delivery that Kafka gives is enough.

Messages use one JSON envelope:

  {
    "event_id":       "uuid4",
    "event_type":     "sap.confirmation.requested",
    "schema_version": 1,
    "occurred_at":    "2026-10-12T08:00:00+00:00",
    "producer":       "sap-kafka-relay",
    "data":           { ... }
  }
"""

from __future__ import annotations

import json
import logging
import os
import socket
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional

log = logging.getLogger("iems_kafka")

SCHEMA_VERSION = 1

TOPIC_ORDERS = os.environ.get("KAFKA_TOPIC_ORDERS", "sap.orders.v1")
TOPIC_ORDERS_DLQ = os.environ.get("KAFKA_TOPIC_ORDERS_DLQ", "sap.orders.dlq.v1")
TOPIC_CONFIRMATIONS = os.environ.get("KAFKA_TOPIC_CONFIRMATIONS", "sap.confirmations.v1")
TOPIC_CONFIRMATION_RESULTS = os.environ.get(
    "KAFKA_TOPIC_CONFIRMATION_RESULTS", "sap.confirmations.results.v1"
)
TOPIC_CONFIRMATIONS_DLQ = os.environ.get("KAFKA_TOPIC_CONFIRMATIONS_DLQ", "sap.confirmations.dlq.v1")

EVENT_ORDER_UPSERTED = "sap.order.upserted"
EVENT_CONFIRMATION_REQUESTED = "sap.confirmation.requested"
EVENT_CONFIRMATION_RESULT = "sap.confirmation.result"


@dataclass(frozen=True)
class TopicSpec:
    name: str
    partitions: int
    config: dict[str, str] = field(default_factory=dict)


def topic_specs() -> list[TopicSpec]:
    """Topics and their settings. Partition counts can be raised later, never lowered."""
    partitions = int(os.environ.get("KAFKA_DEFAULT_PARTITIONS", "6"))
    retention_ms = str(int(os.environ.get("KAFKA_RETENTION_DAYS", "14")) * 24 * 3600 * 1000)
    dlq_retention_ms = str(int(os.environ.get("KAFKA_DLQ_RETENTION_DAYS", "30")) * 24 * 3600 * 1000)
    return [
        # Compacted: the latest state of every confirmation_number is kept forever,
        # so a new or rebuilt plant database can be filled by replaying the topic.
        TopicSpec(TOPIC_ORDERS, partitions, {"cleanup.policy": "compact", "min.compaction.lag.ms": "3600000"}),
        TopicSpec(TOPIC_ORDERS_DLQ, 1, {"retention.ms": dlq_retention_ms}),
        TopicSpec(TOPIC_CONFIRMATIONS, partitions, {"retention.ms": retention_ms}),
        TopicSpec(TOPIC_CONFIRMATION_RESULTS, partitions, {"retention.ms": retention_ms}),
        TopicSpec(TOPIC_CONFIRMATIONS_DLQ, 1, {"retention.ms": dlq_retention_ms}),
    ]


# ── Envelope ────────────────────────────────────────────────────────────────


class EnvelopeError(ValueError):
    """Message that cannot be parsed. Goes to a dead-letter topic, never retried."""


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    # Decimal and other numeric types from psycopg2
    try:
        return float(value)
    except (TypeError, ValueError):
        return str(value)


def build_envelope(event_type: str, data: dict[str, Any], producer: str) -> dict[str, Any]:
    return {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "schema_version": SCHEMA_VERSION,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "producer": producer,
        "data": data,
    }


def encode(envelope: dict[str, Any]) -> bytes:
    return json.dumps(envelope, default=_json_default, separators=(",", ":")).encode("utf-8")


def decode(raw: Optional[bytes], expected_type: str) -> dict[str, Any]:
    if raw is None:
        raise EnvelopeError("empty message value")
    try:
        envelope = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EnvelopeError(f"invalid JSON: {exc}") from exc
    if not isinstance(envelope, dict):
        raise EnvelopeError("envelope is not an object")
    if envelope.get("event_type") != expected_type:
        raise EnvelopeError(f"unexpected event_type {envelope.get('event_type')!r}, expected {expected_type!r}")
    if envelope.get("schema_version") != SCHEMA_VERSION:
        raise EnvelopeError(f"unsupported schema_version {envelope.get('schema_version')!r}")
    if not isinstance(envelope.get("data"), dict):
        raise EnvelopeError("envelope.data is not an object")
    return envelope


def header_value(headers: Optional[list[tuple[str, bytes]]], name: str) -> Optional[str]:
    for key, value in headers or []:
        if key == name and value is not None:
            return value.decode("utf-8", errors="replace")
    return None


# ── Client configuration ────────────────────────────────────────────────────


def base_config(client_suffix: str) -> dict[str, Any]:
    bootstrap = os.environ.get("KAFKA_BOOTSTRAP_SERVERS")
    if not bootstrap:
        raise RuntimeError("KAFKA_BOOTSTRAP_SERVERS is required")
    config: dict[str, Any] = {
        "bootstrap.servers": bootstrap,
        "client.id": f"{os.environ.get('KAFKA_CLIENT_ID', 'iems')}-{client_suffix}-{socket.gethostname()}",
    }
    # Optional SASL/TLS for a managed cluster (Confluent Cloud, MSK, Aiven ...).
    protocol = os.environ.get("KAFKA_SECURITY_PROTOCOL")
    if protocol:
        config["security.protocol"] = protocol
    mechanism = os.environ.get("KAFKA_SASL_MECHANISM")
    if mechanism:
        config["sasl.mechanism"] = mechanism
        config["sasl.username"] = os.environ.get("KAFKA_SASL_USERNAME", "")
        config["sasl.password"] = os.environ.get("KAFKA_SASL_PASSWORD", "")
    return config


def make_producer(client_suffix: str):
    from confluent_kafka import Producer

    config = base_config(client_suffix)
    config.update(
        {
            # Idempotent producer: broker drops duplicates caused by producer retries,
            # and ordering per partition is kept even with retries in flight.
            "enable.idempotence": True,
            "acks": "all",
            "compression.type": "lz4",
            "linger.ms": 20,
            "delivery.timeout.ms": int(os.environ.get("KAFKA_DELIVERY_TIMEOUT_MS", "60000")),
        }
    )
    return Producer(config)


def make_consumer(group_id: str, client_suffix: str):
    from confluent_kafka import Consumer

    config = base_config(client_suffix)
    config.update(
        {
            "group.id": group_id,
            # Offsets are committed by hand, only after the database work is committed.
            "enable.auto.commit": False,
            "auto.offset.reset": "earliest",
            # Posting one confirmation to SAP can take several seconds with retries.
            "max.poll.interval.ms": int(os.environ.get("KAFKA_MAX_POLL_INTERVAL_MS", "900000")),
            "partition.assignment.strategy": "cooperative-sticky",
        }
    )
    return Consumer(config)


def make_admin():
    from confluent_kafka.admin import AdminClient

    return AdminClient(base_config("admin"))


def ensure_topics(admin=None, timeout: float = 30.0) -> list[str]:
    """Create missing topics. Returns the names that were created."""
    from confluent_kafka.admin import NewTopic

    admin = admin or make_admin()
    existing = set(admin.list_topics(timeout=timeout).topics)
    replication = int(os.environ.get("KAFKA_REPLICATION_FACTOR", "1"))
    missing = [
        NewTopic(spec.name, num_partitions=spec.partitions, replication_factor=replication, config=spec.config)
        for spec in topic_specs()
        if spec.name not in existing
    ]
    if not missing:
        return []
    created = []
    for name, future in admin.create_topics(missing, operation_timeout=timeout).items():
        try:
            future.result()
            created.append(name)
        except Exception as exc:  # TOPIC_ALREADY_EXISTS when two services race
            if "TOPIC_ALREADY_EXISTS" not in str(exc):
                raise
    return created


# ── Publishing ──────────────────────────────────────────────────────────────


@dataclass
class OutgoingMessage:
    topic: str
    key: str
    envelope: dict[str, Any]
    headers: dict[str, str] = field(default_factory=dict)
    ref: Any = None  # caller's handle, e.g. the staging row id


def publish_and_confirm(producer, messages: Iterable[OutgoingMessage], flush_timeout: float = 60.0) -> tuple[list, list]:
    """Publish messages and wait for the broker to acknowledge each one.

    Returns (delivered_refs, failed) where failed is a list of (ref, error). A message
    counts as delivered only when its delivery report arrived without an error, so the
    caller can safely mark exactly those rows as handed over.
    """
    delivered: list = []
    failed: list = []
    pending: dict[int, OutgoingMessage] = {}

    def on_delivery(err, _msg, message: OutgoingMessage) -> None:
        pending.pop(id(message), None)
        if err is None:
            delivered.append(message.ref)
        else:
            failed.append((message.ref, str(err)))

    for message in messages:
        pending[id(message)] = message
        while True:
            try:
                producer.produce(
                    message.topic,
                    key=message.key.encode("utf-8"),
                    value=encode(message.envelope),
                    headers=[(k, v.encode("utf-8")) for k, v in message.headers.items()],
                    on_delivery=lambda err, msg, m=message: on_delivery(err, msg, m),
                )
                break
            except BufferError:
                # Local queue full: let delivery reports drain, then retry this message.
                producer.poll(0.5)
        producer.poll(0)

    remaining = producer.flush(flush_timeout)
    if remaining:
        log.error("%s message(s) not acknowledged within %.0fs", remaining, flush_timeout)
    for message in list(pending.values()):
        failed.append((message.ref, "not acknowledged before flush timeout"))
    return delivered, failed


def send_to_dlq(producer, dlq_topic: str, msg, error: str, consumer_group: str) -> None:
    """Copy a message that cannot be processed to its dead-letter topic, with the reason."""
    headers = list(msg.headers() or [])
    headers += [
        ("dlq.error", error[:2000].encode("utf-8")),
        ("dlq.source.topic", msg.topic().encode("utf-8")),
        ("dlq.source.partition", str(msg.partition()).encode("utf-8")),
        ("dlq.source.offset", str(msg.offset()).encode("utf-8")),
        ("dlq.consumer.group", consumer_group.encode("utf-8")),
        ("dlq.failed_at", datetime.now(timezone.utc).isoformat().encode("utf-8")),
    ]
    producer.produce(dlq_topic, key=msg.key(), value=msg.value(), headers=headers)
    remaining = producer.flush(30)
    if remaining:
        raise RuntimeError(f"could not write to dead-letter topic {dlq_topic}")


def commit_message(consumer, msg) -> bool:
    """Commit the offset after `msg`. Returns False if the group rebalanced meanwhile.

    After a rebalance the partition may belong to another consumer, which then receives
    the message again. That is safe because every handler is idempotent, so a failed
    commit is logged and the loop carries on instead of crashing the worker.
    """
    from confluent_kafka import KafkaException

    try:
        consumer.commit(message=msg, asynchronous=False)
        return True
    except KafkaException as exc:
        log.warning("Offset commit for %s[%s]@%s failed (%s); the message may be redelivered",
                    msg.topic(), msg.partition(), msg.offset(), exc)
        return False


def run_consumer_loop(
    consumer,
    handle: Callable[[Any], None],
    should_stop: Callable[[], bool],
    poll_timeout: float = 1.0,
) -> None:
    """Poll, hand each message to `handle`, commit its offset after `handle` returns.

    `handle` must be idempotent and must raise only for errors worth retrying from the
    same offset (database down, broker down). Poison messages are the handler's job:
    it sends them to a DLQ and returns normally so the offset moves on.
    """
    from confluent_kafka import KafkaError, TopicPartition

    while not should_stop():
        msg = consumer.poll(poll_timeout)
        if msg is None:
            continue
        if msg.error():
            if msg.error().code() == KafkaError._PARTITION_EOF:
                continue
            log.error("Consumer error: %s", msg.error())
            continue
        try:
            handle(msg)
        except Exception:
            # Rewind this partition to the failed offset so the message is retried
            # instead of being skipped by the next poll.
            log.exception("Handler failed at %s[%s]@%s; retrying", msg.topic(), msg.partition(), msg.offset())
            consumer.seek(TopicPartition(msg.topic(), msg.partition(), msg.offset()))
            if should_stop():
                return
            import time

            time.sleep(float(os.environ.get("KAFKA_HANDLER_RETRY_SECONDS", "5")))
            continue
        commit_message(consumer, msg)
