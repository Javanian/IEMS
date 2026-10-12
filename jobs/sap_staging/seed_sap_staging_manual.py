from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg2.extras

from sap_staging_common import connect_staging, ensure_staging_schema, plant_code, setup_logging

log = setup_logging("seed_sap_staging_manual")

PAYLOAD_FIELDS = [
    "PERNR",
    "RUECK",
    "AUFNR",
    "VORNR",
    "FLGAT",
    "PLNFL",
    "VORNR_B",
    "VORNR_R",
    "ZCONF_TYPE",
    "ARBPL",
    "LSTAR",
    "ISDD",
    "ISDZ",
    "IEDD",
    "IEDZ",
    "WERKS",
    "AUERU",
    "ZBARCODEID",
]


def read_payload_file(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    with Path(path).open("r", encoding="utf-8") as file:
        payload = json.load(file)
    if not isinstance(payload, dict):
        raise ValueError("JSON file must contain one payload object")
    return payload


def build_payload(args: argparse.Namespace) -> dict[str, str]:
    payload = {field: "" for field in PAYLOAD_FIELDS}
    payload.update(
        {key: str(value or "") for key, value in read_payload_file(args.payload_file).items()}
    )

    cli_values = {
        "PERNR": args.pernr,
        "RUECK": args.rueck,
        "AUFNR": args.aufnr,
        "VORNR": args.vornr,
        "FLGAT": args.flgat,
        "PLNFL": args.plnfl,
        "VORNR_B": args.vornr_b,
        "VORNR_R": args.vornr_r,
        "ZCONF_TYPE": args.zconf_type,
        "ARBPL": args.arbpl,
        "LSTAR": args.lstar,
        "ISDD": args.isdd,
        "ISDZ": args.isdz,
        "IEDD": args.iedd,
        "IEDZ": args.iedz,
        "WERKS": args.werks,
        "AUERU": args.aueru,
        "ZBARCODEID": args.zbarcodeid,
    }
    for key, value in cli_values.items():
        if value is not None:
            payload[key] = str(value)

    if not payload["WERKS"]:
        payload["WERKS"] = plant_code()
    if payload["AUERU"] is None:
        payload["AUERU"] = ""

    return {key: str(payload.get(key, "") or "") for key in PAYLOAD_FIELDS}


def manual_source_key(source_system: str, provided: str | None) -> str:
    if provided:
        return provided
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    return f"MANUAL:{source_system}:{stamp}:{uuid.uuid4().hex[:8]}"


def insert_manual_payload(args: argparse.Namespace, payload: dict[str, str]) -> int:
    source_key = manual_source_key(args.source_system, args.source_key)
    source_ref_id = args.source_ref_id or source_key

    if args.dry_run:
        print(
            json.dumps(
                {"source_system": args.source_system, "source_key": source_key, "payload": payload},
                indent=2,
            )
        )
        return 0

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO sap_timesheet_staging (
                  source_system, source_key, source_ref_id,
                  werks, pernr, rueck, aufnr, vornr, flgat, plnfl, vornr_b, vornr_r,
                  zconf_type, arbpl, lstar, isdd, isdz, iedd, iedz, aueru, zbarcodeid,
                  source_row_count
                ) VALUES (
                  %(source_system)s, %(source_key)s, %(source_ref_id)s,
                  %(werks)s, %(pernr)s, %(rueck)s, %(aufnr)s, %(vornr)s, %(flgat)s, %(plnfl)s, %(vornr_b)s, %(vornr_r)s,
                  %(zconf_type)s, %(arbpl)s, %(lstar)s, %(isdd)s, %(isdz)s, %(iedd)s, %(iedz)s, %(aueru)s, %(zbarcodeid)s,
                  1
                )
                RETURNING id
                """,
                {
                    "source_system": args.source_system,
                    "source_key": source_key,
                    "source_ref_id": source_ref_id,
                    "werks": payload["WERKS"],
                    "pernr": payload["PERNR"],
                    "rueck": payload["RUECK"],
                    "aufnr": payload["AUFNR"],
                    "vornr": payload["VORNR"],
                    "flgat": payload["FLGAT"],
                    "plnfl": payload["PLNFL"],
                    "vornr_b": payload["VORNR_B"],
                    "vornr_r": payload["VORNR_R"],
                    "zconf_type": payload["ZCONF_TYPE"],
                    "arbpl": payload["ARBPL"],
                    "lstar": payload["LSTAR"],
                    "isdd": payload["ISDD"],
                    "isdz": payload["ISDZ"],
                    "iedd": payload["IEDD"],
                    "iedz": payload["IEDZ"],
                    "aueru": payload["AUERU"],
                    "zbarcodeid": payload["ZBARCODEID"],
                },
            )
            row = cur.fetchone()
            staging_id = int(row["id"])
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET payload = jsonb_build_object(
                  'ZTIMESHEETID', ztimesheetid,
                  'PERNR', pernr,
                  'RUECK', rueck,
                  'AUFNR', aufnr,
                  'VORNR', vornr,
                  'FLGAT', flgat,
                  'PLNFL', plnfl,
                  'VORNR_B', vornr_b,
                  'VORNR_R', vornr_r,
                  'ZCONF_TYPE', zconf_type,
                  'ARBPL', arbpl,
                  'LSTAR', lstar,
                  'ISDD', isdd,
                  'ISDZ', isdz,
                  'IEDD', iedd,
                  'IEDZ', iedz,
                  'WERKS', werks,
                  'AUERU', aueru,
                  'ZBARCODEID', zbarcodeid
                ),
                updated_at = now()
                WHERE id = %s
                """,
                (staging_id,),
            )
        conn.commit()
    return staging_id


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Seed one manual SAP payload into sap_timesheet_staging for testing."
    )
    parser.add_argument("--source-system", choices=["TIMESHEET", "MCH_HOURS"], default="TIMESHEET")
    parser.add_argument(
        "--source-key", help="Custom unique source_key. Default is MANUAL:<source>:timestamp:uuid"
    )
    parser.add_argument("--source-ref-id", help="Optional source_ref_id for tracing")
    parser.add_argument("--payload-file", help="JSON file containing payload values")
    parser.add_argument("--dry-run", action="store_true")

    parser.add_argument("--pernr")
    parser.add_argument("--rueck")
    parser.add_argument("--aufnr")
    parser.add_argument("--vornr")
    parser.add_argument("--flgat", default=None)
    parser.add_argument("--plnfl", default=None)
    parser.add_argument("--vornr-b", dest="vornr_b", default=None)
    parser.add_argument("--vornr-r", dest="vornr_r", default=None)
    parser.add_argument("--zconf-type", dest="zconf_type", default=None)
    parser.add_argument("--arbpl")
    parser.add_argument("--lstar")
    parser.add_argument("--isdd")
    parser.add_argument("--isdz")
    parser.add_argument("--iedd")
    parser.add_argument("--iedz")
    parser.add_argument("--werks")
    parser.add_argument("--aueru", default=None)
    parser.add_argument("--zbarcodeid")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    payload = build_payload(args)
    staging_id = insert_manual_payload(args, payload)
    if staging_id:
        log.info(
            "Manual payload seeded id=%s. Test post with: python post_sap_staging.py --ids %s",
            staging_id,
            staging_id,
        )


if __name__ == "__main__":
    main()
