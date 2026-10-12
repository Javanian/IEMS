"""End-to-end tests against a real Kafka broker and a disposable PostgreSQL database.

SAP CPI is replaced by a local HTTP server that records every call and fails if two
confirmations for the same order are in flight at once (what SAP does in production).

Required environment (the test is skipped without it):
    KAFKA_BOOTSTRAP_SERVERS   e.g. localhost:9094
    IEMS_TEST_DB_HOST IEMS_TEST_DB_PORT IEMS_TEST_DB_NAME IEMS_TEST_DB_USER IEMS_TEST_DB_PASSWORD

The database must be disposable: the test creates and drops its own tables.

    python -m unittest discover -s jobs/messaging/tests -p "test_integration.py" -v
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import unittest
import uuid
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

JOBS = Path(__file__).resolve().parents[2]
REPO = JOBS.parent
RUN_ID = uuid.uuid4().hex[:8]

REQUIRED = ["KAFKA_BOOTSTRAP_SERVERS", "IEMS_TEST_DB_HOST", "IEMS_TEST_DB_NAME", "IEMS_TEST_DB_USER"]
ENABLED = all(os.environ.get(name) for name in REQUIRED)

if ENABLED:
    # Isolated topics per run, set before the modules read them.
    for var, base in [
        ("KAFKA_TOPIC_ORDERS", "sap.orders.v1"),
        ("KAFKA_TOPIC_ORDERS_DLQ", "sap.orders.dlq.v1"),
        ("KAFKA_TOPIC_CONFIRMATIONS", "sap.confirmations.v1"),
        ("KAFKA_TOPIC_CONFIRMATION_RESULTS", "sap.confirmations.results.v1"),
        ("KAFKA_TOPIC_CONFIRMATIONS_DLQ", "sap.confirmations.dlq.v1"),
    ]:
        os.environ[var] = f"it-{RUN_ID}.{base}"
    os.environ.update(
        {
            "DB_HOST": os.environ["IEMS_TEST_DB_HOST"],
            "DB_PORT": os.environ.get("IEMS_TEST_DB_PORT", "5432"),
            "DB_NAME": os.environ["IEMS_TEST_DB_NAME"],
            "DB_USER": os.environ["IEMS_TEST_DB_USER"],
            "DB_PASSWORD": os.environ.get("IEMS_TEST_DB_PASSWORD", ""),
            "PLANT_CODE": "5071",
            "KAFKA_HANDLER_RETRY_SECONDS": "1",
        }
    )
    for sub in ("messaging", "sap_staging", "etl"):
        sys.path.insert(0, str(JOBS / sub))


class FakeSap:
    """Accepts confirmations like SAP CPI. Records calls and order-lock violations."""

    def __init__(self, reject_ids=()):
        self.reject_ids = set(reject_ids)
        self.calls: list[dict] = []
        self.in_flight: dict[str, int] = defaultdict(int)
        self.overlaps: list[str] = []
        self.lock = threading.Lock()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                aufnr = payload.get("AUFNR") or ""
                with fake.lock:
                    if aufnr and fake.in_flight[aufnr]:
                        fake.overlaps.append(aufnr)
                    fake.in_flight[aufnr] += 1
                time.sleep(0.05)  # SAP is slow; makes overlapping calls observable
                with fake.lock:
                    fake.in_flight[aufnr] -= 1
                    fake.calls.append(payload)
                zid = payload.get("ZTIMESHEETID")
                status, message = ("E", f"User status TECO is active for order {aufnr}") if zid in fake.reject_ids else ("S", "Confirmation saved")
                body = json.dumps({"n0:CPI_MT_Timesheet_Res": {"STATUS": status, "MESSAGE": message}}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/cpi/timesheet"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def count(self, zid: str) -> int:
        return sum(1 for call in self.calls if call.get("ZTIMESHEETID") == zid)


def db():
    import psycopg2

    return psycopg2.connect(
        host=os.environ["DB_HOST"], port=os.environ["DB_PORT"], dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
    )


def execute(sql: str, params=None, fetch=False):
    with db() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if fetch else None


def wait_until(predicate, timeout=60.0, interval=0.25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


@unittest.skipUnless(ENABLED, "set KAFKA_BOOTSTRAP_SERVERS and IEMS_TEST_DB_* to run")
class OutboundConfirmationTests(unittest.TestCase):
    """sap_timesheet_staging -> relay -> Kafka -> poster -> SAP."""

    @classmethod
    def setUpClass(cls):
        import iems_kafka
        from sap_staging_common import connect_staging, ensure_staging_schema

        execute(
            "DROP TABLE IF EXISTS sap_staging_source, sap_staging_exclusion, log_timesheet_sap, "
            "sap_timesheet_staging CASCADE"
        )
        with connect_staging() as conn:
            ensure_staging_schema(conn)
        migrations = REPO / "database" / "migrations" / "api"
        # Provenance table and its "segment posted" trigger. The rest of that migration
        # backfills from and guards mch_transaction, which this test does not need.
        provenance = (migrations / "20260714_sap_staging_provenance.sql").read_text(encoding="utf-8")
        execute(provenance.split("INSERT INTO public.sap_staging_source (staging_id")[0])
        for name in ("20261012_sap_staging_exclusion.sql", "20261012_sap_staging_kafka_queue.sql"):
            execute((migrations / name).read_text(encoding="utf-8"))
        execute(
            """
            CREATE TABLE log_timesheet_sap (
              id integer GENERATED ALWAYS AS IDENTITY, ztimesheetid text, pernr text,
              confirmation_number text, order_no text, operation_no text, sequence_category text,
              sequence_number text, branch_operation_no text, return_operation_no text,
              zconf_type text, work_center text, activity_type text, start_date text,
              start_time text, end_date text, end_time text, plant_code text,
              final_completed_indicator text, zbarcodeid text, sap_response text,
              created_at timestamptz DEFAULT now())
            """
        )
        iems_kafka.ensure_topics()

    def insert_row(self, key: str, aufnr: str, werks: str = "5071") -> int:
        rows = execute(
            """
            INSERT INTO sap_timesheet_staging (source_system, source_key, werks, aufnr, zconf_type, bucket_start)
            VALUES ('MCH_HOURS', %s, %s, %s, 'M1', date_trunc('day', now()) - interval '1 day')
            RETURNING id
            """,
            (f"{RUN_ID}-{key}", werks, aufnr),
            fetch=True,
        )
        row_id = rows[0][0]
        payload = {"ZTIMESHEETID": str(row_id), "AUFNR": aufnr, "VORNR": "0010", "WERKS": werks, "PERNR": "1001", "ZCONF_TYPE": "M1"}
        execute("UPDATE sap_timesheet_staging SET payload = %s WHERE id = %s", (json.dumps(payload), row_id))
        execute(
            "INSERT INTO sap_staging_source (staging_id, source_system, source_row_id, bucket_start, seconds) "
            "VALUES (%s, 'MCH_HOURS', %s, date_trunc('day', now()) - interval '1 day', 600)",
            (row_id, f"{RUN_ID}-{key}"),
        )
        return row_id

    def status(self, row_id: int) -> str:
        return execute("SELECT status FROM sap_timesheet_staging WHERE id = %s", (row_id,), fetch=True)[0][0]

    def relay_args(self, *extra):
        from post_sap_staging import build_parser

        return build_parser().parse_args(["--limit", "500", "--include-today", *extra])

    def start_posters(self, count: int, sap: FakeSap):
        from iems_kafka import make_consumer, make_producer, run_consumer_loop, TOPIC_CONFIRMATIONS
        from sap_kafka_poster import ConfirmationHandler

        os.environ["SAP_INBOUND_URL"] = sap.url
        os.environ["SAP_INBOUND_USERNAME"] = "test"
        os.environ["SAP_INBOUND_PASSWORD"] = "test"
        args = self.relay_args("--max-retries", "2", "--retry-backoff", "0.1", "--delay-ms", "0")
        stop = threading.Event()
        group = f"it-{RUN_ID}-poster-{uuid.uuid4().hex[:4]}"
        threads = []
        for i in range(count):
            consumer = make_consumer(group, f"it-poster-{i}")
            producer = make_producer(f"it-poster-{i}")
            consumer.subscribe([TOPIC_CONFIRMATIONS])
            handler = ConfirmationHandler(args, producer, group, "5071")

            def run(c=consumer, h=handler):
                try:
                    run_consumer_loop(c, h, stop.is_set, poll_timeout=0.5)
                finally:
                    c.close()

            thread = threading.Thread(target=run, daemon=True)
            thread.start()
            threads.append(thread)
        return stop, threads

    def test_end_to_end_posting(self):
        from iems_kafka import make_producer, TOPIC_CONFIRMATIONS
        from sap_kafka_relay import build_message, relay_once, requeue_stale

        ids_by_order = {aufnr: [self.insert_row(f"{aufnr}-{n}", aufnr) for n in range(4)] for aufnr in ("4001", "4002", "4003")}
        free_id = self.insert_row("free", "")
        other_plant_id = self.insert_row("other-plant", "4009", werks="5051")

        # Segment already POSTED in an earlier bundle -> guard must SKIP the new bundle.
        guarded_id = self.insert_row("guarded", "4004")
        earlier_id = self.insert_row("earlier", "4004")
        execute(
            "UPDATE sap_staging_source SET source_row_id = %s WHERE staging_id = %s",
            (f"{RUN_ID}-guarded", earlier_id),
        )
        execute("UPDATE sap_timesheet_staging SET status = 'POSTED', posted_at = now() WHERE id = %s", (earlier_id,))

        rejected_id = ids_by_order["4003"][1]
        sap = FakeSap(reject_ids={str(rejected_id)})
        producer = make_producer("it-relay")

        result = relay_once(self.relay_args("--plant", "5071"), producer)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(self.status(guarded_id), "SKIPPED")
        self.assertEqual(self.status(other_plant_id), "PENDING", "relay must only claim its own plant")
        queued = [i for ids in ids_by_order.values() for i in ids] + [free_id]
        self.assertTrue(all(self.status(i) == "QUEUED" for i in queued))

        stop, threads = self.start_posters(3, sap)
        try:
            done = wait_until(lambda: all(self.status(i) in ("POSTED", "FAILED") for i in queued), timeout=90)
            self.assertTrue(done, "posters did not finish in time")

            for i in queued:
                expected = "FAILED" if i == rejected_id else "POSTED"
                self.assertEqual(self.status(i), expected, f"staging id {i}")
                self.assertEqual(sap.count(str(i)), 1, f"staging id {i} must reach SAP exactly once")
            self.assertEqual(sap.overlaps, [], "two confirmations for one order were in flight at once")

            # Within one order, SAP received the rows in staging order.
            for aufnr, ids in ids_by_order.items():
                sent = [int(c["ZTIMESHEETID"]) for c in sap.calls if c.get("AUFNR") == aufnr]
                self.assertEqual(sent, ids)

            # Redelivery of an old message for a POSTED row is dropped.
            replay_id = ids_by_order["4001"][0]
            row = {"id": replay_id, "source_system": "MCH_HOURS", "werks": "5071",
                   "payload": {"ZTIMESHEETID": str(replay_id), "AUFNR": "4001", "VORNR": "0010", "WERKS": "5071", "PERNR": "1001", "ZCONF_TYPE": "M1"}}
            msg = build_message(row)
            producer.produce(TOPIC_CONFIRMATIONS, key=msg.key.encode(), value=__import__("iems_kafka").encode(msg.envelope))
            producer.produce(TOPIC_CONFIRMATIONS, key=b"4001", value=b"{not json")
            producer.flush(10)
            time.sleep(3)
            self.assertEqual(sap.count(str(replay_id)), 1, "replayed message must not post again")
            self.assertTrue(all(t.is_alive() for t in threads), "a poster stopped (rebalance or poison message)")
        finally:
            stop.set()
            for t in threads:
                t.join(10)

        # Results topic received one event per processed row.
        results = self.read_topic(os.environ["KAFKA_TOPIC_CONFIRMATION_RESULTS"], expected=len(queued))
        by_id = {r["data"]["staging_id"]: r["data"]["status"] for r in results}
        self.assertEqual(by_id[rejected_id], "FAILED")
        self.assertEqual(by_id[free_id], "POSTED")

        # The unparsable message went to the dead-letter topic with its reason.
        dlq = self.read_topic(os.environ["KAFKA_TOPIC_CONFIRMATIONS_DLQ"], expected=1, raw=True)
        self.assertEqual(len(dlq), 1)
        self.assertIn("invalid JSON", dict(dlq[0].headers())["dlq.error"].decode())

        # A row stuck in QUEUED returns to the status it came from.
        stuck = self.insert_row("stuck", "4005")
        execute(
            "UPDATE sap_timesheet_staging SET status='QUEUED', queued_from_status='FAILED', "
            "queued_at = now() - interval '2 hours' WHERE id = %s",
            (stuck,),
        )
        self.assertGreaterEqual(requeue_stale(60), 1)
        self.assertEqual(self.status(stuck), "FAILED")

    def test_unacknowledged_publish_restores_status(self):
        from sap_kafka_relay import relay_once

        row_id = self.insert_row("broker-down", "4100")

        class DeadProducer:
            def produce(self, *a, on_delivery=None, **k):
                self.cb = on_delivery

            def poll(self, *_):
                return 0

            def flush(self, *_):
                self.cb("broker down", None)
                return 0

        relay_once(self.relay_args("--ids", str(row_id)), DeadProducer())
        self.assertEqual(self.status(row_id), "PENDING")

    def test_selected_rows_in_flight_are_not_queued_again(self):
        from sap_kafka_relay import relay_once

        posting = self.insert_row("in-flight", "4200")
        execute("UPDATE sap_timesheet_staging SET status = 'POSTING' WHERE id = %s", (posting,))

        class NoProducer:
            def produce(self, *a, **k):
                raise AssertionError("nothing should be published")

            def poll(self, *_):
                return 0

            def flush(self, *_):
                return 0

        result = relay_once(self.relay_args("--ids", str(posting)), NoProducer())
        self.assertEqual(result["claimed"], 0)
        self.assertEqual(self.status(posting), "POSTING")

    def read_topic(self, topic: str, expected: int, raw: bool = False, timeout: float = 30):
        from iems_kafka import make_consumer

        consumer = make_consumer(f"it-{RUN_ID}-reader-{uuid.uuid4().hex[:4]}", "it-reader")
        consumer.subscribe([topic])
        out = []
        deadline = time.time() + timeout
        try:
            while time.time() < deadline and len(out) < expected:
                msg = consumer.poll(0.5)
                if msg is None or msg.error():
                    continue
                out.append(msg if raw else json.loads(msg.value()))
        finally:
            consumer.close()
        return out


@unittest.skipUnless(ENABLED, "set KAFKA_BOOTSTRAP_SERVERS and IEMS_TEST_DB_* to run")
class InboundOrderTests(unittest.TestCase):
    """source ph3_order -> producer -> Kafka -> per-plant consumer -> plant tables."""

    COLUMNS_SQL = """
        confirmation_number text PRIMARY KEY, indicator_code text, operation_short_text text,
        order_no text, operation_no text, sequence_category text, sequence_number text,
        branch_operation_no text, return_operation_no text, material_no text,
        material_description text, operation_description text, work_center text,
        cost_center text, plant_code text, unit_of_measure text, standard_value text,
        order_type text, order_description text, status_etl text
    """

    @classmethod
    def setUpClass(cls):
        import iems_kafka

        execute("DROP TABLE IF EXISTS it_src_ph3_order, it_ph3_order, sow CASCADE")
        execute(f"CREATE TABLE it_src_ph3_order ({cls.COLUMNS_SQL}, created_at timestamptz DEFAULT now())")
        execute(f"CREATE TABLE it_ph3_order ({cls.COLUMNS_SQL})")
        execute(
            """
            CREATE TABLE sow (order_no text, operation_no text, workcenter text, confirmation text,
                              planhours numeric, part_number text, part_name text, operation_text text,
                              PRIMARY KEY (order_no, operation_no))
            """
        )
        iems_kafka.ensure_topics()

    def test_orders_flow_to_the_right_plant(self):
        from iems_kafka import TOPIC_ORDERS, make_consumer, make_producer
        from sap_orders_consumer import OrderBatchApplier
        from sap_orders_producer import publish_new_rows

        rows = [
            ("000777001", "0001000777", "0010", "5071", "2.5", "WC-A"),
            ("000777002", "0001000777", "0020", "5071", "1.0", "WC-B"),
            ("000888001", "0001000888", "0010", "5051", "3.0", "WC-C"),
        ]
        for conf, order, op, plant, std, wc in rows:
            execute(
                "INSERT INTO it_src_ph3_order (confirmation_number, order_no, operation_no, plant_code, "
                "standard_value, work_center, material_no, operation_short_text, status_etl) "
                "VALUES (%s,%s,%s,%s,%s,%s,'MAT-1','Machining','NEW')",
                (conf, order, op, plant, std, wc),
            )

        producer = make_producer("it-orders")
        with db() as conn:
            published = publish_new_rows(conn, producer, '"public"."it_src_ph3_order"', [], 100)
        self.assertEqual(published, 3)
        statuses = execute("SELECT DISTINCT status_etl FROM it_src_ph3_order", fetch=True)
        self.assertEqual(statuses, [("UPDATED",)])

        # Edit one operation in SAP: newer event for the same key wins.
        execute("UPDATE it_src_ph3_order SET work_center='WC-Z', status_etl='NEW' WHERE confirmation_number='000777001'")
        with db() as conn:
            self.assertEqual(publish_new_rows(conn, producer, '"public"."it_src_ph3_order"', [], 100), 1)
        producer.produce(TOPIC_ORDERS, key=b"bad", value=b'{"event_type":"sap.order.upserted","schema_version":1,"data":{}}')
        producer.flush(10)

        os.environ.update({"TGT_HOST": os.environ["DB_HOST"], "TGT_PORT": os.environ["DB_PORT"], "TGT_DATABASE": os.environ["DB_NAME"],
                           "TGT_USER": os.environ["DB_USER"], "TGT_PASSWORD": os.environ["DB_PASSWORD"]})
        group = f"it-{RUN_ID}-orders-5071"
        consumer = make_consumer(group, "it-orders-5071")
        consumer.subscribe([TOPIC_ORDERS])
        applier = OrderBatchApplier(consumer, make_producer("it-orders-dlq"), group, "5071", '"public"."it_ph3_order"', 100)
        seen = 0
        deadline = time.time() + 30
        while time.time() < deadline and seen < 5:
            batch = [m for m in consumer.consume(num_messages=100, timeout=1.0) if not m.error()]
            if batch:
                applier.apply(batch)
                consumer.commit(asynchronous=False)
                seen += len(batch)
        consumer.close()
        self.assertEqual(seen, 5)

        target = execute("SELECT confirmation_number, order_no, operation_no, work_center FROM it_ph3_order ORDER BY 1", fetch=True)
        self.assertEqual(target, [("777001", "1000777", "10", "WC-Z"), ("777002", "1000777", "20", "WC-B")])
        sow = execute("SELECT order_no, operation_no, planhours FROM sow ORDER BY 2", fetch=True)
        self.assertEqual([(o, op, float(h)) for o, op, h in sow], [("1000777", "10", 2.5), ("1000777", "20", 1.0)])


if __name__ == "__main__":
    unittest.main()
