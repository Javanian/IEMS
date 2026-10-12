import os
import time
import logging
from pathlib import Path
from psycopg2 import pool, extras
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(PROJECT_ROOT / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


SRC_DSN = {
    "host": os.environ["SRC_HOST"],
    "port": int(os.environ.get("SRC_PORT", 5432)),
    "dbname": os.environ["SRC_DATABASE"],
    "user": os.environ["SRC_USER"],
    "password": os.environ["SRC_PASSWORD"],
}
TGT_DSN = {
    "host": os.environ["TGT_HOST"],
    "port": int(os.environ.get("TGT_PORT", 5432)),
    "dbname": os.environ["TGT_DATABASE"],
    "user": os.environ["TGT_USER"],
    "password": os.environ["TGT_PASSWORD"],
}
SRC_TABLE = os.environ["SRC_TABLE"]
TGT_TABLE = os.environ["TGT_TABLE"]
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", 5))
PLANT_FILTER = os.environ.get("PLANT_FILTER", "5051")


src_pool = pool.SimpleConnectionPool(1, 4, **SRC_DSN)
tgt_pool = pool.SimpleConnectionPool(1, 4, **TGT_DSN)


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
UPDATE_COLS = [c for c in UPSERT_COLS if c != "confirmation_number"]


STRIP_ZERO_COLS = {"confirmation_number", "order_no", "operation_no"}


def strip_zeros(row: dict) -> dict:

    result = dict(row)
    for col in STRIP_ZERO_COLS:
        val = result.get(col)
        if isinstance(val, str):
            result[col] = val.lstrip("0")
    return result


def build_upsert_query(table: str) -> str:
    col_list = ", ".join(UPSERT_COLS)
    placeholder = ", ".join(["%s"] * len(UPSERT_COLS))
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in UPDATE_COLS)
    return (
        f"INSERT INTO {table} ({col_list}) VALUES ({placeholder}) "
        f"ON CONFLICT (confirmation_number) DO UPDATE SET {updates}"
    )


def sync_sow(tgt_cur, rows: list) -> None:

    order_material: dict = {}
    for row in rows:
        order = row["order_no"]
        if order not in order_material:
            order_material[order] = (row.get("material_no"), row.get("material_description"))
        else:

            existing_mat, existing_desc = order_material[order]
            mat = existing_mat or row.get("material_no")
            desc = existing_desc or row.get("material_description")
            order_material[order] = (mat, desc)

    for row in rows:
        order_no = row["order_no"]
        operation_no = row["operation_no"]
        work_center = row.get("work_center")
        confirmation = row.get("confirmation_number")
        standard_val = row.get("standard_value")
        operation_text = row.get("operation_short_text")
        part_number, part_name = order_material[order_no]

        try:
            planhours = float(standard_val) if standard_val else None
        except (ValueError, TypeError):
            planhours = None

        tgt_cur.execute(
            "SELECT 1 FROM sow WHERE order_no = %s AND operation_no = %s",
            (order_no, operation_no),
        )
        exists = tgt_cur.fetchone() is not None

        if exists:
            tgt_cur.execute(
                """
                UPDATE sow
                   SET workcenter      = %s,
                       confirmation    = %s,
                       planhours       = %s,
                       part_number     = %s,
                       part_name       = %s,
                       operation_text  = %s
                 WHERE order_no = %s AND operation_no = %s
                """,
                (
                    work_center,
                    confirmation,
                    planhours,
                    part_number,
                    part_name,
                    operation_text,
                    order_no,
                    operation_no,
                ),
            )
        else:
            tgt_cur.execute(
                """
                INSERT INTO sow
                  (order_no, operation_no, workcenter, confirmation,
                   planhours, part_number, part_name, operation_text)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    order_no,
                    operation_no,
                    work_center,
                    confirmation,
                    planhours,
                    part_number,
                    part_name,
                    operation_text,
                ),
            )


def run_cycle(upsert_sql: str) -> None:
    src_conn = src_pool.getconn()
    tgt_conn = tgt_pool.getconn()
    try:
        src_conn.autocommit = False
        tgt_conn.autocommit = False

        with src_conn.cursor(cursor_factory=extras.RealDictCursor) as src_cur:
            src_cur.execute(
                f"SELECT {', '.join(UPSERT_COLS)} FROM {SRC_TABLE} "
                f"WHERE plant_code = %s AND status_etl = 'NEW' "
                f"ORDER BY created_at ASC",
                (PLANT_FILTER,),
            )
            raw_rows = src_cur.fetchall()

        if not raw_rows:
            src_conn.rollback()
            tgt_conn.rollback()
            return

        rows = [strip_zeros(r) for r in raw_rows]

        src_confirmation_numbers = [r["confirmation_number"] for r in raw_rows]

        tgt_confirmation_numbers = [r["confirmation_number"] for r in rows]

        row_tuples = [tuple(r[c] for c in UPSERT_COLS) for r in rows]

        with tgt_conn.cursor() as tgt_cur:

            extras.execute_batch(tgt_cur, upsert_sql, row_tuples)

            sync_sow(tgt_cur, rows)

            tgt_cur.execute(
                f"UPDATE {TGT_TABLE} SET status_etl = 'UPDATED' "
                f"WHERE confirmation_number = ANY(%s)",
                (tgt_confirmation_numbers,),
            )

        with src_conn.cursor() as src_cur:
            src_cur.execute(
                f"UPDATE {SRC_TABLE} SET status_etl = 'UPDATED' "
                f"WHERE confirmation_number = ANY(%s)",
                (src_confirmation_numbers,),
            )

        tgt_conn.commit()
        src_conn.commit()
        log.info("Processed %d row(s).", len(rows))

    except Exception as exc:
        src_conn.rollback()
        tgt_conn.rollback()
        log.error("Cycle failed, rolled back: %s", exc)
    finally:
        src_pool.putconn(src_conn)
        tgt_pool.putconn(tgt_conn)


def main() -> None:
    log.info(
        "ETL started — source=%s.%s → target=%s.%s, poll=%ds",
        SRC_DSN["dbname"],
        SRC_TABLE,
        TGT_DSN["dbname"],
        TGT_TABLE,
        POLL_INTERVAL,
    )
    upsert_sql = build_upsert_query(TGT_TABLE)
    while True:
        run_cycle(upsert_sql)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
