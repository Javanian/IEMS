import argparse
import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
import psycopg2.extras

BATCH_SIZE = 5000
DEFAULT_FROM_DATE = "2026-01-01"
TARGET_TABLE = "public.mch_transaction"
SOURCE_TABLE = "public.mch_productiondata"
TIMESHEET_LOOKUP_STATUS_IDS = (1, 6, 7, 8, 9)
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
ENV_PATH = PROJECT_ROOT / ".env"
CANDIDATE_TABLE = "pg_temp.mch_transaction_etl_candidates"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("etl_mch_transaction")


UPSERT_SQL = """
INSERT INTO public.mch_transaction (
    proddataid,
    startdatetime,
    enddatetime,
    work_date,
    start_time,
    end_time,
    source_duration,
    duration_seconds,
    duration_hours,
    machineno,
    sitemachineno,
    machinegroupid,
    machine_plantid,
    machinetypeid,
    machineid,
    machinename,
    statusid,
    previoustatusid,
    status_description,
    status_activitytype,
    previous_status_description,
    confirmation_number,
    order_no,
    operation_no,
    operation_short_text,
    operation_description,
    sequence_category,
    sequence_number,
    branch_operation_no,
    return_operation_no,
    cost_center,
    material_no,
    material_description,
    ssbr_id,
    full_name,
    sn_employee,
    workcentercode,
    tsnumber,
    checkin,
    refreshed_at
)
VALUES %s
ON CONFLICT (proddataid) DO UPDATE SET
    startdatetime = EXCLUDED.startdatetime,
    enddatetime = EXCLUDED.enddatetime,
    work_date = EXCLUDED.work_date,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    source_duration = EXCLUDED.source_duration,
    duration_seconds = EXCLUDED.duration_seconds,
    duration_hours = EXCLUDED.duration_hours,
    machineno = EXCLUDED.machineno,
    sitemachineno = EXCLUDED.sitemachineno,
    machinegroupid = EXCLUDED.machinegroupid,
    machine_plantid = EXCLUDED.machine_plantid,
    machinetypeid = EXCLUDED.machinetypeid,
    machineid = EXCLUDED.machineid,
    machinename = EXCLUDED.machinename,
    statusid = EXCLUDED.statusid,
    previoustatusid = EXCLUDED.previoustatusid,
    status_description = EXCLUDED.status_description,
    status_activitytype = EXCLUDED.status_activitytype,
    previous_status_description = EXCLUDED.previous_status_description,
    confirmation_number = EXCLUDED.confirmation_number,
    order_no = EXCLUDED.order_no,
    operation_no = EXCLUDED.operation_no,
    operation_short_text = EXCLUDED.operation_short_text,
    operation_description = EXCLUDED.operation_description,
    sequence_category = EXCLUDED.sequence_category,
    sequence_number = EXCLUDED.sequence_number,
    branch_operation_no = EXCLUDED.branch_operation_no,
    return_operation_no = EXCLUDED.return_operation_no,
    cost_center = EXCLUDED.cost_center,
    material_no = EXCLUDED.material_no,
    material_description = EXCLUDED.material_description,
    ssbr_id = EXCLUDED.ssbr_id,
    full_name = EXCLUDED.full_name,
    sn_employee = EXCLUDED.sn_employee,
    workcentercode = EXCLUDED.workcentercode,
    tsnumber = EXCLUDED.tsnumber,
    checkin = EXCLUDED.checkin,
    refreshed_at = EXCLUDED.refreshed_at
"""


def connect_postgres():
    return psycopg2.connect(**load_postgres_config())


def parse_env_file(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    if not os.path.exists(path):
        return values

    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    return values


def load_postgres_config() -> dict:
    env_values = parse_env_file(ENV_PATH)
    return {
        "host": env_values.get("DB_HOST", "localhost"),
        "port": int(env_values.get("DB_PORT", "5432")),
        "dbname": env_values.get("DB_NAME", "ptssb"),
        "user": env_values.get("DB_USER", "postgres"),
        "password": env_values.get("DB_PASSWORD", ""),
    }


def parse_date_arg(value: str, label: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{label} harus format YYYY-MM-DD") from exc


def make_date_range(args: argparse.Namespace) -> tuple[datetime, datetime | None]:
    from_dt = parse_date_arg(args.from_date, "--from")
    to_dt = None
    if args.to_date:
        to_dt = parse_date_arg(args.to_date, "--to") + timedelta(days=1)
    if to_dt and from_dt >= to_dt:
        raise ValueError("--from tidak boleh lebih besar dari --to")
    return from_dt, to_dt


def build_source_query(
    full_rebuild: bool, from_dt: datetime, to_dt: datetime | None
) -> tuple[str, list]:
    base_filters = ["p.startdatetime >= %s"]
    params: list = [from_dt]

    if to_dt:
        base_filters.append("p.startdatetime < %s")
        params.append(to_dt)

    base_filter_sql = " AND ".join(base_filters)

    if full_rebuild:
        query = f"""
            SELECT
                p.proddataid,
                p.startdatetime,
                p.enddatetime,
                p.duration,
                p.machineno,
                p.statusid,
                p.previoustatusid,
                p.jobid
            FROM {SOURCE_TABLE} p
            WHERE {base_filter_sql}
            ORDER BY p.proddataid
            LIMIT %s OFFSET %s
        """
        return query, params

    query = f"""
        SELECT
            p.proddataid,
            p.startdatetime,
            p.enddatetime,
            p.duration,
            p.machineno,
            p.statusid,
            p.previoustatusid,
            p.jobid
        FROM {SOURCE_TABLE} p
        JOIN {CANDIDATE_TABLE} c
          ON c.proddataid = p.proddataid
        ORDER BY p.proddataid
        LIMIT %s OFFSET %s
    """
    return query, []


def prepare_incremental_candidates(cursor, from_dt: datetime, to_dt: datetime | None) -> int:
    base_filters = ["p.startdatetime >= %s"]
    params: list = [from_dt]

    if to_dt:
        base_filters.append("p.startdatetime < %s")
        params.append(to_dt)

    base_filter_sql = " AND ".join(base_filters)

    cursor.execute("DROP TABLE IF EXISTS mch_transaction_etl_candidates")
    cursor.execute("""
        CREATE TEMP TABLE mch_transaction_etl_candidates (
            proddataid integer PRIMARY KEY
        ) ON COMMIT PRESERVE ROWS
        """)
    cursor.execute(
        f"""
        INSERT INTO {CANDIDATE_TABLE} (proddataid)
        SELECT p.proddataid
        FROM {SOURCE_TABLE} p
        LEFT JOIN {TARGET_TABLE} t
          ON t.proddataid = p.proddataid
        WHERE {base_filter_sql}
          AND t.proddataid IS NULL
        UNION
        SELECT p.proddataid
        FROM {SOURCE_TABLE} p
        JOIN {TARGET_TABLE} t
          ON t.proddataid = p.proddataid
        WHERE {base_filter_sql}
          AND t.enddatetime IS NULL
        """,
        params + params,
    )
    cursor.execute(f"SELECT COUNT(*) FROM {CANDIDATE_TABLE}")
    return cursor.fetchone()[0]


def fetch_source_rows(
    cursor, full_rebuild: bool, from_dt: datetime, to_dt: datetime | None, offset: int
) -> list[dict]:
    query, params = build_source_query(full_rebuild, from_dt, to_dt)
    cursor.execute(query, (*params, BATCH_SIZE, offset))
    columns = [col.name for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def fetch_machine_maps(cursor, machine_nos: list[int]) -> dict[int, dict]:
    if not machine_nos:
        return {}
    cursor.execute(
        """
        SELECT machineno, sitemachineno, machinegroupid, plantid, machinetypeid, machineid, machinename
        FROM public.mch_machines
        WHERE machineno = ANY(%s)
        """,
        (machine_nos,),
    )
    return {
        row[0]: {
            "sitemachineno": row[1],
            "machinegroupid": row[2],
            "machine_plantid": row[3],
            "machinetypeid": row[4],
            "machineid": row[5],
            "machinename": row[6],
        }
        for row in cursor.fetchall()
    }


def fetch_status_maps(cursor, status_ids: list[int]) -> dict[int, dict]:
    if not status_ids:
        return {}
    cursor.execute(
        """
        SELECT statusid, description, activitytype
        FROM public.mch_statustypes
        WHERE statusid = ANY(%s)
        """,
        (status_ids,),
    )
    return {
        row[0]: {
            "description": row[1],
            "activitytype": row[2],
        }
        for row in cursor.fetchall()
    }


def normalize_confirmation_lookup(value) -> str | None:
    text = str(value).strip()
    if not text or not text.isdigit() or not text.startswith("0"):
        return None
    normalized = text.lstrip("0")
    return normalized or "0"


def fetch_latest_ph3_by_confirmation(cursor, job_ids: list[str]) -> dict[str, dict]:
    if not job_ids:
        return {}
    lookup_ids = sorted(
        {
            lookup_id
            for job_id in job_ids
            for lookup_id in (str(job_id).strip(), normalize_confirmation_lookup(job_id))
            if lookup_id
        }
    )
    cursor.execute(
        """
        SELECT DISTINCT ON (confirmation_number)
            confirmation_number,
            order_no,
            operation_no,
            operation_short_text,
            operation_description,
            sequence_category,
            sequence_number,
            branch_operation_no,
            return_operation_no,
            cost_center,
            material_no,
            material_description
        FROM public.ph3_order
        WHERE confirmation_number = ANY(%s)
        ORDER BY confirmation_number, id DESC
        """,
        (lookup_ids,),
    )
    rows_by_confirmation = {}
    for row in cursor.fetchall():
        rows_by_confirmation[str(row[0])] = {
            "confirmation_number": row[0],
            "order_no": row[1],
            "operation_no": row[2],
            "operation_short_text": row[3],
            "operation_description": row[4],
            "sequence_category": row[5],
            "sequence_number": row[6],
            "branch_operation_no": row[7],
            "return_operation_no": row[8],
            "cost_center": row[9],
            "material_no": row[10],
            "material_description": row[11],
        }

    result = {}
    for job_id in job_ids:
        exact_key = str(job_id).strip()
        normalized_key = normalize_confirmation_lookup(job_id)
        ph3 = rows_by_confirmation.get(exact_key)
        if ph3 is None and normalized_key:
            ph3 = rows_by_confirmation.get(normalized_key)
        if ph3:
            result[job_id] = ph3
    return result


def fetch_timesheet_matches(
    cursor, source_rows: list[dict], ph3_map: dict[str, dict]
) -> dict[int, dict]:
    candidates = []
    for row in source_rows:
        if row["statusid"] not in TIMESHEET_LOOKUP_STATUS_IDS:
            continue
        ph3 = ph3_map.get(row.get("jobid"))
        if not ph3:
            continue
        op_text = ph3.get("operation_no")
        if not op_text or not str(op_text).isdigit():
            continue
        candidates.append(
            (
                row["proddataid"],
                row["startdatetime"],
                ph3["order_no"],
                int(op_text),
            )
        )

    if not candidates:
        return {}

    values_sql = ",".join(["(%s, %s, %s, %s)"] * len(candidates))
    query = f"""
        WITH src(proddataid, startdatetime, order_no, operation_no) AS (
            VALUES {values_sql}
        ),
        ranked AS (
            SELECT
                src.proddataid,
                t.ssbr_id,
                t.full_name,
                t.serialnumber,
                t.workcentercode,
                t.tsnumber,
                t.longdate_checkin,
                ROW_NUMBER() OVER (
                    PARTITION BY src.proddataid
                    ORDER BY
                        ABS(EXTRACT(EPOCH FROM ((t.longdate_checkin AT TIME ZONE 'Asia/Makassar') - src.startdatetime))) ASC,
                        t.tsnumber DESC
                ) AS rn
            FROM src
            JOIN public.timesheet_transaction t
              ON t.order_no = src.order_no
             AND t.operation_no = src.operation_no
             AND t.longdate_checkin IS NOT NULL
             AND t.longdate_checkin >= ((src.startdatetime - interval '1 day') AT TIME ZONE 'Asia/Makassar')
             AND t.longdate_checkin < ((src.startdatetime + interval '1 day') AT TIME ZONE 'Asia/Makassar')
        )
        SELECT
            proddataid,
            ssbr_id,
            full_name,
            serialnumber,
            workcentercode,
            tsnumber,
            longdate_checkin
        FROM ranked
        WHERE rn = 1
    """
    flat_params = [item for candidate in candidates for item in candidate]
    cursor.execute(query, flat_params)

    result = {}
    for row in cursor.fetchall():
        result[row[0]] = {
            "ssbr_id": row[1],
            "full_name": row[2],
            "serialnumber": row[3],
            "workcentercode": row[4],
            "tsnumber": row[5],
            "checkin": row[6],
        }
    return result


def compute_duration_seconds(startdatetime, enddatetime) -> int:
    if startdatetime is None or enddatetime is None:
        return 0
    return max(int((enddatetime - startdatetime).total_seconds()), 0)


def build_target_tuple(
    row: dict, machine_map: dict, status_map: dict, ph3_map: dict, timesheet_map: dict
) -> tuple:
    machine = machine_map.get(row["machineno"], {})
    status = status_map.get(row["statusid"], {})
    prev_status = status_map.get(row["previoustatusid"], {})
    ph3 = ph3_map.get(row.get("jobid"), {})
    ts = timesheet_map.get(row["proddataid"], {})

    duration_seconds = compute_duration_seconds(row["startdatetime"], row["enddatetime"])
    duration_hours = round(duration_seconds / 3600.0, 4)

    return (
        row["proddataid"],
        row["startdatetime"],
        row["enddatetime"],
        row["startdatetime"].date() if row["startdatetime"] else None,
        row["startdatetime"].strftime("%H:%M:%S") if row["startdatetime"] else None,
        row["enddatetime"].strftime("%H:%M:%S") if row["enddatetime"] else None,
        row["duration"],
        duration_seconds,
        duration_hours,
        row["machineno"],
        machine.get("sitemachineno"),
        machine.get("machinegroupid"),
        machine.get("machine_plantid"),
        machine.get("machinetypeid"),
        machine.get("machineid") or "",
        machine.get("machinename") or "",
        row["statusid"],
        row["previoustatusid"],
        status.get("description") or "Unknown",
        status.get("activitytype") or "",
        prev_status.get("description"),
        ph3.get("confirmation_number"),
        ph3.get("order_no"),
        ph3.get("operation_no"),
        ph3.get("operation_short_text"),
        ph3.get("operation_description"),
        ph3.get("sequence_category"),
        ph3.get("sequence_number"),
        ph3.get("branch_operation_no"),
        ph3.get("return_operation_no"),
        ph3.get("cost_center"),
        ph3.get("material_no"),
        ph3.get("material_description"),
        ts.get("ssbr_id"),
        ts.get("full_name"),
        ts.get("serialnumber"),
        ts.get("workcentercode"),
        ts.get("tsnumber"),
        ts.get("checkin"),
        datetime.now(),
    )


def upsert_batch(cursor, values: list[tuple]) -> None:
    psycopg2.extras.execute_values(
        cursor,
        UPSERT_SQL,
        values,
        page_size=min(BATCH_SIZE, 1000),
    )


def run_etl(
    pg_conn, from_dt: datetime, to_dt: datetime | None, full_rebuild: bool, dry_run: bool
) -> int:
    total_upserted = 0
    offset = 0

    if not full_rebuild:
        with pg_conn.cursor() as cursor:
            candidate_count = prepare_incremental_candidates(cursor, from_dt, to_dt)
        pg_conn.commit()
        log.info("Prepared incremental candidate rows: %d", candidate_count)

    while True:
        with pg_conn.cursor() as cursor:
            source_rows = fetch_source_rows(cursor, full_rebuild, from_dt, to_dt, offset)

        if not source_rows:
            log.info("No more source rows at offset %d.", offset)
            break

        machine_nos = sorted(
            {row["machineno"] for row in source_rows if row["machineno"] is not None}
        )
        status_ids = sorted(
            {
                status_id
                for row in source_rows
                for status_id in (row["statusid"], row["previoustatusid"])
                if status_id is not None
            }
        )
        job_ids = sorted({row["jobid"] for row in source_rows if row.get("jobid")})

        with pg_conn.cursor() as cursor:
            machine_map = fetch_machine_maps(cursor, machine_nos)
            status_map = fetch_status_maps(cursor, status_ids)
            ph3_map = fetch_latest_ph3_by_confirmation(cursor, job_ids)
            timesheet_map = fetch_timesheet_matches(cursor, source_rows, ph3_map)

        values = [
            build_target_tuple(row, machine_map, status_map, ph3_map, timesheet_map)
            for row in source_rows
        ]

        lookup_status_count = sum(
            1 for row in source_rows if row["statusid"] in TIMESHEET_LOOKUP_STATUS_IDS
        )
        log.info(
            "Prepared batch offset=%d count=%d timesheet_lookup_candidates=%d timesheet_matches=%d",
            offset,
            len(values),
            lookup_status_count,
            len(timesheet_map),
        )

        if dry_run:
            total_upserted += len(values)
        else:
            with pg_conn.cursor() as cursor:
                upsert_batch(cursor, values)
            pg_conn.commit()
            total_upserted += len(values)
            log.info("Committed batch offset=%d count=%d", offset, len(values))

        offset += BATCH_SIZE

    return total_upserted


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Incremental ETL from public.mch_productiondata into public.mch_transaction"
    )
    parser.add_argument(
        "--from",
        dest="from_date",
        default=DEFAULT_FROM_DATE,
        help=f"StartDateTime mulai tanggal YYYY-MM-DD, default {DEFAULT_FROM_DATE}",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        help="StartDateTime sampai tanggal YYYY-MM-DD, inclusive. Jika kosong, sync sampai data terbaru.",
    )
    parser.add_argument(
        "--full-rebuild",
        action="store_true",
        help="Ignore watermark mch_transaction dan proses ulang semua source row pada rentang tanggal.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview mode, no INSERT/UPDATE to mch_transaction",
    )
    args = parser.parse_args()

    from_dt, to_dt = make_date_range(args)
    pg_conn = None

    try:
        pg_config = load_postgres_config()
        log.info(
            "Starting mch_transaction ETL%s (BATCH_SIZE=%d)",
            " (DRY RUN)" if args.dry_run else "",
            BATCH_SIZE,
        )
        log.info(
            "Date filter: StartDateTime >= %s%s",
            from_dt.strftime("%Y-%m-%d"),
            f" and <= {args.to_date}" if args.to_date else "",
        )
        log.info("PostgreSQL: %s:%s/%s", pg_config["host"], pg_config["port"], pg_config["dbname"])
        log.info(
            "Mode: %s",
            (
                "full rebuild"
                if args.full_rebuild
                else "incremental by proddataid + reprocess target rows with enddatetime IS NULL"
            ),
        )
        log.info("Source status filter: all statusid values")
        log.info("Timesheet lookup scope: rows with statusid in %s", TIMESHEET_LOOKUP_STATUS_IDS)

        pg_conn = psycopg2.connect(**pg_config)
        processed = run_etl(pg_conn, from_dt, to_dt, args.full_rebuild, args.dry_run)

        log.info("=" * 60)
        log.info("ETL Complete%s", " (DRY RUN)" if args.dry_run else "")
        log.info("  Upserted rows: %d", processed)
        log.info("=" * 60)
    except KeyboardInterrupt:
        log.warning("Interrupted by user.")
    except Exception as exc:
        if pg_conn:
            pg_conn.rollback()
        log.exception("Fatal error: %s", exc)
        sys.exit(1)
    finally:
        if pg_conn:
            try:
                pg_conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
