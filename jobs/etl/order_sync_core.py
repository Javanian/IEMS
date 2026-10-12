"""
order_sync_core.py

How SAP order/operation rows (ph3_order) are written into a plant database. Shared by
the direct ETL (etl_sync_v2.py) and the Kafka consumer (sap_orders_consumer.py), so both
transports produce identical rows in ph3_order and sow.

No environment is read here; callers pass table names and page sizes.
"""

from __future__ import annotations

import logging
from typing import Optional

from psycopg2 import extras

log = logging.getLogger(__name__)


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


def strip_zeros(row: dict) -> dict:
    result = dict(row)
    for col in STRIP_ZERO_COLS:
        value = result.get(col)
        if isinstance(value, str):
            result[col] = value.lstrip("0")
    return result


def prepare_target_rows(target_name: str, raw_rows: list[dict], logger: Optional[logging.Logger] = None) -> list[dict]:
    """Strip leading zeros, mark UPDATED, keep the last row per confirmation_number."""
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
        (logger or log).warning(
            "[%s] Deduplicated %d source row(s) into %d target upsert row(s).",
            target_name,
            len(raw_rows),
            len(rows_by_confirmation),
        )

    return [rows_by_confirmation[key] for key in order]


def row_tuples(rows: list[dict]) -> list[tuple]:
    return [tuple(row.get(col) for col in UPSERT_COLS) for row in rows]


def sync_sow(tgt_cur, rows: list[dict], page_size: int = 500) -> None:
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
        page_size=page_size,
    )


def upsert_orders(tgt_cur, table_sql: str, rows: list[dict], page_size: int = 500) -> None:
    """Write prepared rows to the order table and the sow table in the caller's transaction."""
    if not rows:
        return
    extras.execute_values(tgt_cur, build_upsert_query(table_sql), row_tuples(rows), page_size=page_size)
    sync_sow(tgt_cur, rows, page_size)
