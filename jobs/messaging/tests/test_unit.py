"""Unit tests for the Kafka integration that need no broker and no database.

    python -m unittest discover -s jobs/messaging/tests -p "test_unit.py" -v
"""

from __future__ import annotations

import os
import sys
import unittest
from decimal import Decimal
from pathlib import Path

JOBS = Path(__file__).resolve().parents[2]
for sub in ("messaging", "sap_staging", "etl"):
    sys.path.insert(0, str(JOBS / sub))

os.environ.setdefault("KAFKA_BOOTSTRAP_SERVERS", "localhost:9094")

import iems_kafka  # noqa: E402
from iems_kafka import (  # noqa: E402
    EVENT_CONFIRMATION_REQUESTED,
    EnvelopeError,
    OutgoingMessage,
    build_envelope,
    decode,
    encode,
    publish_and_confirm,
)


class FakeProducer:
    """Mimics confluent_kafka.Producer: queues messages, reports delivery on poll/flush."""

    def __init__(self, fail_keys=(), buffer_errors=0, undelivered_keys=()):
        self.fail_keys = set(fail_keys)
        self.undelivered_keys = set(undelivered_keys)
        self.buffer_errors = buffer_errors
        self.queue = []
        self.sent = []

    def produce(self, topic, key, value, headers, on_delivery):
        if self.buffer_errors:
            self.buffer_errors -= 1
            raise BufferError("queue full")
        self.queue.append((topic, key, value, headers, on_delivery))

    def _drain(self):
        while self.queue:
            topic, key, value, headers, cb = self.queue.pop(0)
            decoded_key = key.decode()
            if decoded_key in self.undelivered_keys:
                continue  # never acknowledged
            self.sent.append((topic, decoded_key, value, headers))
            cb("broker error" if decoded_key in self.fail_keys else None, None)

    def poll(self, _timeout=0):
        self._drain()
        return 0

    def flush(self, _timeout=None):
        self._drain()
        return 0


def message(key, ref):
    return OutgoingMessage("t", key, build_envelope("e", {"k": key}, "test"), {"h": "v"}, ref)


class EnvelopeTests(unittest.TestCase):
    def test_round_trip_keeps_data_and_metadata(self):
        env = build_envelope(EVENT_CONFIRMATION_REQUESTED, {"staging_id": 7, "qty": Decimal("1.5")}, "unit")
        parsed = decode(encode(env), EVENT_CONFIRMATION_REQUESTED)
        self.assertEqual(parsed["data"], {"staging_id": 7, "qty": 1.5})
        self.assertEqual(parsed["schema_version"], iems_kafka.SCHEMA_VERSION)
        self.assertEqual(parsed["producer"], "unit")
        self.assertEqual(len(parsed["event_id"]), 36)

    def test_rejects_garbage_wrong_type_and_wrong_version(self):
        with self.assertRaises(EnvelopeError):
            decode(b"not json", EVENT_CONFIRMATION_REQUESTED)
        with self.assertRaises(EnvelopeError):
            decode(None, EVENT_CONFIRMATION_REQUESTED)
        with self.assertRaises(EnvelopeError):
            decode(encode(build_envelope("other.type", {}, "unit")), EVENT_CONFIRMATION_REQUESTED)
        env = build_envelope(EVENT_CONFIRMATION_REQUESTED, {}, "unit")
        env["schema_version"] = 99
        with self.assertRaises(EnvelopeError):
            decode(encode(env), EVENT_CONFIRMATION_REQUESTED)


class PublishTests(unittest.TestCase):
    def test_reports_delivered_and_failed_refs_separately(self):
        producer = FakeProducer(fail_keys={"b"})
        delivered, failed = publish_and_confirm(producer, [message("a", 1), message("b", 2), message("c", 3)])
        self.assertEqual(sorted(delivered), [1, 3])
        self.assertEqual([ref for ref, _ in failed], [2])

    def test_retries_when_local_queue_is_full(self):
        producer = FakeProducer(buffer_errors=2)
        delivered, failed = publish_and_confirm(producer, [message("a", 1)])
        self.assertEqual(delivered, [1])
        self.assertEqual(failed, [])

    def test_unacknowledged_message_counts_as_failed(self):
        producer = FakeProducer(undelivered_keys={"a"})
        delivered, failed = publish_and_confirm(producer, [message("a", 1), message("b", 2)])
        self.assertEqual(delivered, [2])
        self.assertEqual([ref for ref, _ in failed], [1])


class ConsumerLoopTests(unittest.TestCase):
    def test_failed_commit_after_rebalance_does_not_stop_the_loop(self):
        from confluent_kafka import KafkaError, KafkaException

        class Msg:
            def __init__(self, offset):
                self._offset = offset

            def error(self):
                return None

            def topic(self):
                return "t"

            def partition(self):
                return 0

            def offset(self):
                return self._offset

        class Consumer:
            def __init__(self):
                self.messages = [Msg(0), Msg(1)]
                self.commits = 0

            def poll(self, _timeout):
                return self.messages.pop(0) if self.messages else None

            def commit(self, message, asynchronous):
                self.commits += 1
                if message.offset() == 0:
                    raise KafkaException(KafkaError(KafkaError.ILLEGAL_GENERATION))

        consumer = Consumer()
        handled = []
        iems_kafka.run_consumer_loop(consumer, lambda m: handled.append(m.offset()), lambda: not consumer.messages and len(handled) == 2)
        self.assertEqual(handled, [0, 1])
        self.assertEqual(consumer.commits, 2)


class RelayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import sap_kafka_relay

        cls.relay = sap_kafka_relay

    def test_partition_key_is_order_number(self):
        self.assertEqual(self.relay.partition_key({"id": 5, "payload": {"AUFNR": "1000078791"}}), "1000078791")

    def test_rows_without_order_get_their_own_key(self):
        self.assertEqual(self.relay.partition_key({"id": 5, "payload": {"AUFNR": ""}}), "free-5")
        self.assertEqual(self.relay.partition_key({"id": 6, "payload": None}), "free-6")

    def test_payload_hash_ignores_key_order(self):
        self.assertEqual(
            self.relay.payload_sha256({"A": 1, "B": "x"}),
            self.relay.payload_sha256({"B": "x", "A": 1}),
        )
        self.assertNotEqual(self.relay.payload_sha256({"A": 1}), self.relay.payload_sha256({"A": 2}))

    def test_message_carries_reference_not_payload(self):
        row = {
            "id": 42,
            "source_system": "MCH_HOURS",
            "werks": "5071",
            "payload": {"AUFNR": "1000", "VORNR": "0010", "ZTIMESHEETID": "42", "PERNR": "9", "ZCONF_TYPE": "M1"},
        }
        msg = self.relay.build_message(row)
        self.assertEqual(msg.key, "1000")
        self.assertEqual(msg.ref, 42)
        data = msg.envelope["data"]
        self.assertEqual(data["staging_id"], 42)
        self.assertEqual(data["payload_sha256"], self.relay.payload_sha256(row["payload"]))
        self.assertNotIn("payload", data)
        self.assertEqual(msg.headers["werks"], "5071")


class OrderSyncTests(unittest.TestCase):
    def test_prepare_strips_zeros_and_keeps_last_row_per_confirmation(self):
        from order_sync_core import prepare_target_rows

        rows = prepare_target_rows(
            "test",
            [
                {"confirmation_number": "000123", "order_no": "0001000", "operation_no": "0010", "work_center": "A"},
                {"confirmation_number": "000124", "order_no": "0001000", "operation_no": "0020", "work_center": "A"},
                {"confirmation_number": "000123", "order_no": "0001000", "operation_no": "0010", "work_center": "B"},
            ],
        )
        self.assertEqual([r["confirmation_number"] for r in rows], ["123", "124"])
        self.assertEqual(rows[0]["work_center"], "B")
        self.assertEqual(rows[0]["order_no"], "1000")
        self.assertEqual(rows[0]["operation_no"], "10")
        self.assertTrue(all(r["status_etl"] == "UPDATED" for r in rows))

    def test_producer_key_matches_normalized_confirmation(self):
        import sap_orders_producer

        self.assertEqual(sap_orders_producer.message_key({"confirmation_number": "000123"}), "123")
        self.assertEqual(sap_orders_producer.message_key({"confirmation_number": "000"}), "0")

    def test_upsert_query_updates_every_column_except_the_key(self):
        from order_sync_core import UPSERT_COLS, build_upsert_query

        sql = build_upsert_query('"public"."ph3_order"')
        self.assertIn('ON CONFLICT ("confirmation_number")', sql)
        for col in UPSERT_COLS:
            if col != "confirmation_number":
                self.assertIn(f'"{col}" = EXCLUDED."{col}"', sql)


class OpsWorkerTests(unittest.TestCase):
    def test_kafka_transport_swaps_poster_for_relay(self):
        import importlib

        os.environ["SAP_TRANSPORT"] = "kafka"
        try:
            import ops_worker

            ops_worker = importlib.reload(ops_worker)
            cmd = ops_worker.build_command("post_corrections", {"ids": [1, 2]})
            self.assertIn("sap_kafka_relay.py", cmd)
            self.assertNotIn("post_sap_staging.py", cmd)
            self.assertEqual(cmd[-2:], ["--ids", "1,2"])
            self.assertIn("stage_machinehours.py", ops_worker.build_command("stage_catchup", {}))
        finally:
            os.environ.pop("SAP_TRANSPORT")
            importlib.reload(ops_worker)
        self.assertIn("post_sap_staging.py", ops_worker.build_command("retry_failed", {}))


if __name__ == "__main__":
    unittest.main()
