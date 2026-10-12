"""
sap_kafka_poster.py

Consumes sap.confirmations.v1 and posts each confirmation to SAP CPI.

For every message:
  1. Parse the envelope. A message that cannot be parsed goes to sap.confirmations.dlq.v1.
  2. Claim the staging row: QUEUED -> POSTING, in one UPDATE. If the row is gone
     (invalidated), not QUEUED any more (requeued, already posted) or its payload hash
     changed, the message is stale and is dropped. This is what makes redelivery safe.
  3. Run the same anti-double-post guards as post_sap_staging.py (segment already
     POSTED, ZTIMESHEETID already accepted by SAP). A hit marks the row SKIPPED.
  4. Post with post_sap_staging.post_one: network retries, order-lock retries, result
     written to sap_timesheet_staging and log_timesheet_sap.
  5. Publish the outcome to sap.confirmations.results.v1 and commit the offset.

The offset is committed only after the database has the result. If the process dies in
between, the message is delivered again and step 2 drops it because the row is no longer
QUEUED.

Ordering: messages are keyed by AUFNR, so confirmations for one order arrive in one
partition and are posted one after another. Run more replicas (up to the partition count)
to post more orders in parallel:

    docker compose --profile kafka up -d --scale sap-kafka-poster=3

Usage:
    python sap_kafka_poster.py                 # posts rows of PLANT_CODE
    python sap_kafka_poster.py --all-plants
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "messaging"))

import psycopg2.extras  # noqa: E402

from iems_kafka import (  # noqa: E402
    EVENT_CONFIRMATION_REQUESTED,
    EVENT_CONFIRMATION_RESULT,
    TOPIC_CONFIRMATION_RESULTS,
    TOPIC_CONFIRMATIONS,
    TOPIC_CONFIRMATIONS_DLQ,
    EnvelopeError,
    OutgoingMessage,
    build_envelope,
    decode,
    make_consumer,
    make_producer,
    publish_and_confirm,
    run_consumer_loop,
    send_to_dlq,
)
from post_sap_staging import apply_guards, build_parser, post_one  # noqa: E402
from sap_kafka_relay import payload_sha256, restore_status  # noqa: E402
from sap_staging_common import connect_staging, plant_code, setup_logging  # noqa: E402

log = setup_logging("sap_kafka_poster")

PRODUCER_NAME = "sap-kafka-poster"
_stop = False


def claim_queued(staging_id: int) -> dict | None:
    with connect_staging() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET status = 'POSTING', updated_at = now()
                WHERE id = %s AND status = 'QUEUED'
                RETURNING id, source_system, source_ref_id, werks, payload
                """,
                (staging_id,),
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row) if row else None


def release_claim(staging_id: int) -> None:
    """Undo step 2 when the payload no longer matches: back to QUEUED, then restored by
    restore_status so the relay publishes the current version."""
    with connect_staging() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE sap_timesheet_staging SET status = 'QUEUED' WHERE id = %s AND status = 'POSTING'",
            (staging_id,),
        )
        conn.commit()
    restore_status([staging_id], "payload changed after it was queued")


def final_state(staging_id: int) -> dict:
    with connect_staging() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT status, sap_error, posted_at FROM sap_timesheet_staging WHERE id = %s",
                (staging_id,),
            )
            row = cur.fetchone()
    return dict(row) if row else {"status": "MISSING", "sap_error": None, "posted_at": None}


class ConfirmationHandler:
    def __init__(self, args: argparse.Namespace, producer, group_id: str, plant: str | None):
        self.args = args
        self.producer = producer
        self.group_id = group_id
        self.plant = plant

    def publish_result(self, msg, data: dict, status: str, error: str | None = None, posted_at=None) -> None:
        result = {
            "staging_id": data["staging_id"],
            "ztimesheetid": data.get("ztimesheetid"),
            "werks": data.get("werks"),
            "aufnr": data.get("aufnr"),
            "status": status,
            "sap_error": error,
            "posted_at": posted_at,
        }
        message = OutgoingMessage(
            topic=TOPIC_CONFIRMATION_RESULTS,
            key=msg.key().decode("utf-8") if msg.key() else str(data["staging_id"]),
            envelope=build_envelope(EVENT_CONFIRMATION_RESULT, result, PRODUCER_NAME),
            headers={"werks": data.get("werks") or ""},
            ref=data["staging_id"],
        )
        _, failed = publish_and_confirm(self.producer, [message], flush_timeout=30)
        if failed:
            # The SAP result is already in PostgreSQL; the results topic is for observers.
            log.warning("Could not publish result for staging_id=%s: %s", data["staging_id"], failed[0][1])

    def __call__(self, msg) -> None:
        try:
            envelope = decode(msg.value(), EVENT_CONFIRMATION_REQUESTED)
            data = envelope["data"]
            staging_id = int(data["staging_id"])
            expected_hash = str(data["payload_sha256"])
        except (EnvelopeError, KeyError, TypeError, ValueError) as exc:
            log.error("Poison message %s[%s]@%s: %s", msg.topic(), msg.partition(), msg.offset(), exc)
            send_to_dlq(self.producer, TOPIC_CONFIRMATIONS_DLQ, msg, str(exc), self.group_id)
            return

        if self.plant and data.get("werks") and data["werks"] != self.plant:
            return  # another plant's poster owns this row

        row = claim_queued(staging_id)
        if row is None:
            log.info("Stale message for staging_id=%s (row not QUEUED); dropped", staging_id)
            return

        if payload_sha256(row.get("payload")) != expected_hash:
            log.warning("Payload of staging_id=%s changed after queueing; not posting", staging_id)
            release_claim(staging_id)
            return

        postable, skipped = apply_guards([row])
        if skipped:
            state = final_state(staging_id)
            self.publish_result(msg, data, state["status"], state["sap_error"])
            return

        outcome = post_one(postable[0], self.args)
        state = final_state(staging_id)
        log.info("staging_id=%s aufnr=%s outcome=%s status=%s", staging_id, data.get("aufnr"), outcome, state["status"])
        self.publish_result(msg, data, state["status"], state["sap_error"], state["posted_at"])


def _handle_signal(signum, _frame) -> None:
    global _stop
    _stop = True
    log.info("Signal %s received, finishing current message", signum)


def main() -> None:
    parser = build_parser()
    parser.description = "Consume sap.confirmations.v1 and post to SAP"
    parser.add_argument("--group", help="Consumer group id (default: iems-sap-poster-<plant>)")
    args = parser.parse_args()

    plant = None if args.all_plants else (args.plant or plant_code())
    group_id = args.group or os.environ.get("KAFKA_POSTER_GROUP") or f"iems-sap-poster-{plant or 'all'}"

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    consumer = make_consumer(group_id, "sap-poster")
    producer = make_producer("sap-poster")
    consumer.subscribe([TOPIC_CONFIRMATIONS])
    log.info("Consuming %s as group %s (plant=%s)", TOPIC_CONFIRMATIONS, group_id, plant or "all")
    try:
        run_consumer_loop(consumer, ConfirmationHandler(args, producer, group_id, plant), lambda: _stop)
    finally:
        consumer.close()
        producer.flush(10)


if __name__ == "__main__":
    main()
