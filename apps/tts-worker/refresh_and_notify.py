import os
import sys
import logging
from pathlib import Path
import psycopg2
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(ROOT_DIR / ".env")
load_dotenv(BASE_DIR / ".env", override=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("tts")

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "localhost"),
    "port": int(os.environ.get("DB_PORT", 5432)),
    "dbname": os.environ.get("DB_NAME", "ptssb"),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD", ""),
}


def refresh_view(conn):
    log.info("Refreshing mv_order_remaining_hours CONCURRENTLY...")
    with conn.cursor() as cur:
        cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_remaining_hours;")
    log.info("Materialized view refreshed.")


def generate_notifications(conn):
    log.info("Generating notifications from mv_order_remaining_hours...")
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM generate_remaining_hours_notifications();")
        rows = cur.fetchall()
    for row in rows:
        log.info("  Notification: order_no=%s action=%s", row[0], row[1])
    log.info("Generated %d notification(s).", len(rows))


def main():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        refresh_view(conn)
        generate_notifications(conn)
        conn.close()
    except Exception as exc:
        log.exception("TTS worker error: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
