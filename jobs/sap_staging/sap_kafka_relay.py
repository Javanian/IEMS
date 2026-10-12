"""
sap_kafka_relay.py

Hands SAP staging rows to Kafka instead of posting them directly.

    PENDING/FAILED row --claim--> QUEUED --publish--> sap.confirmations.v1 (key = AUFNR)
                                                        |
                                    sap_kafka_poster.py consumes, posts to SAP CPI

Row selection, filters and anti-double-post guards are the ones in post_sap_staging.py,
so every CLI flag of the poster works here too (--limit, --failed-only, --ids, --date,
--pernr, --include-today ...). ops_worker.py runs this script instead of the poster when
SAP_TRANSPORT=kafka.

Why the message key is the order number (AUFNR): SAP CPI locks an order while it books a
confirmation, so two confirmations for the same order must not be sent at the same time.
Kafka keeps all messages with the same key in one partition, and one partition is read by
one consumer at a time. Orders are therefore posted serially, different orders in
parallel, without any locking code in the poster.

Delivery safety:
  - Rows are marked QUEUED only after the claim; if the broker does not acknowledge a
    message, its row goes back to the status it came from.
  - The message carries the staging id, not the authority to post. The poster re-reads
    the row and only posts it if it is still QUEUED with the same payload hash.
  - A row left QUEUED longer than --requeue-after-minutes returns to its previous status
    and is published again on the next cycle. A late duplicate message then finds the
    row no longer QUEUED (or already POSTED) and is ignored.

Usage:
    python sap_kafka_relay.py --limit 500                 # one cycle
    python sap_kafka_relay.py --loop --interval 60        # service mode
    python sap_kafka_relay.py --ids 123,124               # admin "Post selected"
"""

from __future__ import annotations

import hashlib
import json
import os
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "messaging"))

from iems_kafka import (  # noqa: E402
    EVENT_CONFIRMATION_REQUESTED,
    TOPIC_CONFIRMATIONS,
    OutgoingMessage,
    build_envelope,
    make_producer,
    publish_and_confirm,
)
from post_sap_staging import apply_guards, build_parser, select_rows  # noqa: E402
from sap_staging_common import connect_staging, setup_logging  # noqa: E402

log = setup_logging("sap_kafka_relay")

PRODUCER_NAME = "sap-kafka-relay"
_stop = False


def payload_sha256(payload: dict | None) -> str:
    canonical = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def partition_key(row: dict) -> str:
    """AUFNR groups confirmations per order. Rows without an order (unproductive LSTAR
    bookings) have nothing to lock in SAP, so each gets its own key and spreads freely."""
    aufnr = str((row.get("payload") or {}).get("AUFNR") or "").strip()
    return aufnr if aufnr else f"free-{row['id']}"


def check_schema() -> None:
    with connect_staging() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conname = 'sap_timesheet_staging_status_ck'
            """
        )
        row = cur.fetchone()
    if not row or "QUEUED" not in row[0]:
        raise SystemExit(
            "sap_timesheet_staging does not accept status QUEUED yet. "
            "Apply database/migrations/api/20261012_sap_staging_kafka_queue.sql first."
        )


def record_queue_origin(rows: list[dict]) -> None:
    """Remember each claimed row's previous status so it can be restored."""
    with connect_staging() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sap_timesheet_staging t
            SET queued_from_status = o.prev_status,
                queued_at = now()
            FROM unnest(%s::bigint[], %s::text[]) AS o(id, prev_status)
            WHERE t.id = o.id AND t.status = 'QUEUED'
            """,
            ([row["id"] for row in rows], [row["status"] for row in rows]),
        )
        conn.commit()


def restore_status(row_ids: list[int], reason: str) -> int:
    if not row_ids:
        return 0
    with connect_staging() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sap_timesheet_staging
            SET status = COALESCE(queued_from_status, 'PENDING'),
                queued_from_status = NULL,
                queued_at = NULL,
                updated_at = now()
            WHERE id = ANY(%s::bigint[]) AND status = 'QUEUED'
            """,
            (row_ids,),
        )
        restored = cur.rowcount
        conn.commit()
    if restored:
        log.warning("Restored %s row(s) from QUEUED: %s", restored, reason)
    return restored


def requeue_stale(minutes: int) -> int:
    """Rows QUEUED for too long (message lost, poster down for hours) go back to where
    they came from. The next cycle publishes them again."""
    with connect_staging() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sap_timesheet_staging
            SET status = COALESCE(queued_from_status, 'PENDING'),
                queued_from_status = NULL,
                queued_at = NULL,
                updated_at = now()
            WHERE status = 'QUEUED'
              AND COALESCE(queued_at, updated_at) < now() - make_interval(mins => %s)
            """,
            (minutes,),
        )
        count = cur.rowcount
        conn.commit()
    if count:
        log.warning("Requeued %s row(s) that stayed QUEUED longer than %s min", count, minutes)
    return count


def build_message(row: dict) -> OutgoingMessage:
    payload = row.get("payload") or {}
    data = {
        "staging_id": row["id"],
        "ztimesheetid": str(payload.get("ZTIMESHEETID") or row["id"]),
        "source_system": row["source_system"],
        "werks": row.get("werks") or payload.get("WERKS") or "",
        "aufnr": payload.get("AUFNR") or "",
        "vornr": payload.get("VORNR") or "",
        "pernr": payload.get("PERNR") or "",
        "zconf_type": payload.get("ZCONF_TYPE") or "",
        "payload_sha256": payload_sha256(payload),
    }
    return OutgoingMessage(
        topic=TOPIC_CONFIRMATIONS,
        key=partition_key(row),
        envelope=build_envelope(EVENT_CONFIRMATION_REQUESTED, data, PRODUCER_NAME),
        headers={"werks": data["werks"], "staging_id": str(row["id"])},
        ref=row["id"],
    )


def relay_once(args, producer) -> dict[str, int]:
    rows = select_rows(args, claim_status="QUEUED")
    if not rows:
        return {"claimed": 0, "published": 0, "skipped": 0, "failed": 0}

    record_queue_origin(rows)
    postable, skipped = apply_guards(rows)

    delivered, failed = publish_and_confirm(producer, [build_message(row) for row in postable])
    if failed:
        for row_id, error in failed[:5]:
            log.error("Publish failed id=%s: %s", row_id, error)
        restore_status([row_id for row_id, _ in failed], "broker did not acknowledge")

    result = {"claimed": len(rows), "published": len(delivered), "skipped": skipped, "failed": len(failed)}
    log.info("Relay cycle claimed=%(claimed)s published=%(published)s skipped=%(skipped)s failed=%(failed)s", result)
    return result


def _handle_signal(signum, _frame) -> None:
    global _stop
    _stop = True
    log.info("Signal %s received, stopping after this cycle", signum)


def main() -> None:
    parser = build_parser()
    parser.description = "Publish SAP staging rows to Kafka (sap.confirmations.v1)"
    parser.add_argument("--loop", action="store_true", help="Run continuously")
    parser.add_argument("--interval", type=int, default=int(os.environ.get("SAP_KAFKA_RELAY_INTERVAL", "60")))
    parser.add_argument(
        "--requeue-after-minutes",
        type=int,
        default=int(os.environ.get("SAP_KAFKA_REQUEUE_AFTER_MINUTES", "360")),
        help="Return rows that stayed QUEUED this long to their previous status",
    )
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    check_schema()
    producer = make_producer("sap-relay")
    try:
        while True:
            requeue_stale(args.requeue_after_minutes)
            result = relay_once(args, producer)
            if not args.loop or _stop:
                break
            # A full batch means there is more work; go again without waiting.
            if result["claimed"] < args.limit:
                for _ in range(args.interval):
                    if _stop:
                        break
                    time.sleep(1)
            if _stop:
                break
    finally:
        producer.flush(10)


if __name__ == "__main__":
    main()
