from __future__ import annotations

import argparse
import base64
import json
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import psycopg2.extras

from sap_staging_common import (
    app_timezone,
    as_json,
    connect_source,
    connect_staging,
    ensure_staging_schema,
    mark_local_timesheet_rejected,
    plant_code,
    sap_credentials,
    setup_logging,
)

log = setup_logging("post_sap_staging")


_tl = threading.local()


def _conn(kind: str):
    conn = getattr(_tl, kind, None)
    if conn is None or conn.closed:
        conn = connect_staging() if kind == "staging" else connect_source()
        setattr(_tl, kind, conn)
    return conn


def _reset_conn(kind: str) -> None:
    """Koneksi rusak (jaringan putus) -> buang, biar dibuat ulang."""
    conn = getattr(_tl, kind, None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        setattr(_tl, kind, None)


def _close_thread_conns() -> None:
    for kind in ("staging", "source"):
        _reset_conn(kind)


def parse_sap_status(response_text: str) -> tuple[str, str]:
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        return "", response_text

    body = parsed.get("n0:ABM_CPP_223_MT_Timesheet_Res") or {}
    return str(body.get("STATUS") or ""), str(body.get("MESSAGE") or response_text)


def post_payload(payload: dict[str, Any], timeout: int) -> tuple[int, str]:
    url, username, password = sap_credentials()
    if not url or not username or not password:
        raise RuntimeError("SAP_INBOUND_URL, SAP_INBOUND_USERNAME, and SAP_INBOUND_PASSWORD are required")

    basic_auth = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Basic {basic_auth}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def claim_rows(
    limit: int,
    include_failed: bool,
    source_system: str | None,
    plant: str | None,
    productive: bool | None = None,
    failed_only: bool = False,
    include_today: bool = False,
    date_filter: str | None = None,
    pernr_filter: str | None = None,
) -> list[dict]:
    if failed_only:
        statuses = ["FAILED"]
    elif include_failed:
        statuses = ["PENDING", "FAILED"]
    else:
        statuses = ["PENDING"]
    filters = ["status = ANY(%s)", "is_correction = false"]
    params: list[Any] = [statuses]

    if not include_today:
        filters.append("(source_system <> 'MCH_HOURS' OR bucket_start::date < (now() AT TIME ZONE %s)::date)")
        params.append(app_timezone())

    if source_system:
        filters.append("source_system = %s")
        params.append(source_system)
    if plant:
        filters.append("werks = %s")
        params.append(plant)
    if productive is not None:
        filters.append("is_productive = %s")
        params.append(productive)

    # TIMESHEET tidak punya bucket_start (NULL — satu baris per tsnumber) sehingga
    # filter tanggal harus lewat payload ISDD (tanggal kerja dari checkin).
    if date_filter:
        filters.append("(bucket_start::date = %s OR (source_system = 'TIMESHEET' AND payload->>'ISDD' = %s))")
        params.extend([date_filter, date_filter.replace("-", "")])
    if pernr_filter:
        filters.append("(pernr = %s OR pernr_origin = %s)")
        params.extend([pernr_filter, pernr_filter])

    filters.append("""
      NOT EXISTS (
        SELECT 1 FROM public.sap_staging_source ss
        JOIN public.sap_staging_exclusion ex
          ON ex.source_system = ss.source_system AND ex.source_row_id = ss.source_row_id
        WHERE ss.staging_id = public.sap_timesheet_staging.id
      )
    """)

    where_sql = " AND ".join(filters)
    sql = f"""
    SELECT id, source_system, source_ref_id, werks, payload
    FROM sap_timesheet_staging
    WHERE {where_sql}
    ORDER BY id
    LIMIT %s
    FOR UPDATE SKIP LOCKED
    """
    params.append(limit)

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = [dict(row) for row in cur.fetchall()]
            if rows:
                cur.execute(
                    """
                    UPDATE sap_timesheet_staging
                    SET status = 'POSTING',
                        updated_at = now()
                    WHERE id = ANY(%s::bigint[])
                    """,
                    ([row["id"] for row in rows],),
                )
        conn.commit()
    return rows


def parse_csv_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def claim_selected_rows(ids: list[str], ztimesheetids: list[str], allow_posted: bool, plant: str | None = None) -> list[dict]:
    filters = []
    params: list[Any] = []

    if ids:
        filters.append("id = ANY(%s::bigint[])")
        params.append([int(value) for value in ids])
    if ztimesheetids:
        filters.append("ztimesheetid = ANY(%s::text[])")
        params.append(ztimesheetids)
    if not filters:
        return []

    # Per-plant: posting dari MPS satu plant hanya menyentuh werks-nya sendiri.
    plant_filter = ""
    if plant:
        plant_filter = "AND werks = %s"
        params.append(plant)

    status_filter = "" if allow_posted else "AND status <> 'POSTED'"
    where_sql = " OR ".join(f"({item})" for item in filters)
    sql = f"""
    SELECT id, source_system, source_ref_id, werks, payload
    FROM sap_timesheet_staging
    WHERE ({where_sql})
      {status_filter}
      {plant_filter}
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    """

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = [dict(row) for row in cur.fetchall()]
            if rows:
                cur.execute(
                    """
                    UPDATE sap_timesheet_staging
                    SET status = 'POSTING',
                        updated_at = now()
                    WHERE id = ANY(%s::bigint[])
                    """,
                    ([row["id"] for row in rows],),
                )
        conn.commit()
    return rows


def update_result(row_id: int, ok: bool, status_code: int, response_text: str, message: str) -> None:
    try:
        parsed_response = json.loads(response_text)
    except json.JSONDecodeError:
        parsed_response = None

    try:
        conn = _conn("staging")
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET status = %s,
                    sap_response = %s,
                    sap_response_text = %s,
                    sap_error = %s,
                    posted_at = CASE WHEN %s THEN now() ELSE posted_at END,
                    updated_at = now()
                WHERE id = %s
                """,
                (
                    "POSTED" if ok else "FAILED",
                    psycopg2.extras.Json(as_json(parsed_response)),
                    response_text,
                    None if ok else f"HTTP {status_code}: {message}",
                    ok,
                    row_id,
                ),
            )
        conn.commit()
    except Exception:
        _reset_conn("staging")
        conn = _conn("staging")
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET status = %s, sap_response = %s, sap_response_text = %s, sap_error = %s,
                    posted_at = CASE WHEN %s THEN now() ELSE posted_at END, updated_at = now()
                WHERE id = %s
                """,
                (
                    "POSTED" if ok else "FAILED",
                    psycopg2.extras.Json(as_json(parsed_response)),
                    response_text,
                    None if ok else f"HTTP {status_code}: {message}",
                    ok,
                    row_id,
                ),
            )
        conn.commit()


def log_timesheet_sap(payload: dict[str, Any], response_text: str) -> None:
    try:
        status, message = parse_sap_status(response_text)
        sap_response = f"{'SUCCESS' if status == 'S' else 'ERROR'} : {message}" if status else response_text
        conn = _conn("source")
        if True:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO log_timesheet_sap (
                      ztimesheetid, pernr, confirmation_number, order_no, operation_no,
                      sequence_category, sequence_number, branch_operation_no, return_operation_no,
                      zconf_type, work_center, activity_type,
                      start_date, start_time, end_date, end_time, plant_code, final_completed_indicator,
                      zbarcodeid, sap_response
                    ) VALUES (
                      %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                      %s,%s,%s,%s,%s,%s,%s,%s
                    )
                    """,
                    (
                        payload.get("ZTIMESHEETID", ""),
                        payload.get("PERNR", ""),
                        payload.get("RUECK", ""),
                        payload.get("AUFNR", ""),
                        payload.get("VORNR", ""),
                        payload.get("FLGAT", ""),
                        payload.get("PLNFL", ""),
                        payload.get("VORNR_B", ""),
                        payload.get("VORNR_R", ""),
                        payload.get("ZCONF_TYPE", ""),
                        payload.get("ARBPL", ""),
                        payload.get("LSTAR", ""),
                        payload.get("ISDD", ""),
                        payload.get("ISDZ", ""),
                        payload.get("IEDD", ""),
                        payload.get("IEDZ", ""),
                        payload.get("WERKS", ""),
                        payload.get("AUERU", ""),
                        payload.get("ZBARCODEID", ""),
                        sap_response,
                    ),
                )
            conn.commit()
    except Exception as exc:
        _reset_conn("source")
        log.warning("Could not write local log_timesheet_sap: %s", exc)


def find_posted_conflicts(row_ids: list[int]) -> dict[int, str]:
    if not row_ids:
        return {}
    sql = """
    SELECT
      s.staging_id,
      string_agg(DISTINCT prev.staging_id::text || ':' || prev.source_key, ', ') AS posted_in,
      bool_or(prev.source_key IS DISTINCT FROM cur.source_key) AS key_changed
    FROM sap_staging_source s
    JOIN sap_timesheet_staging cur ON cur.id = s.staging_id
    JOIN sap_staging_source prev
      ON  prev.source_system = s.source_system
      AND prev.source_row_id = s.source_row_id
      AND prev.bucket_start  = s.bucket_start
      AND prev.posted_at IS NOT NULL
      AND prev.staging_id <> s.staging_id
    JOIN sap_timesheet_staging prev_t ON prev_t.id = prev.staging_id
    WHERE s.staging_id = ANY(%s::bigint[])
    GROUP BY s.staging_id
    """
    sql = sql.replace("prev.source_key", "prev_t.source_key")
    with connect_staging() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (row_ids,))
            return {
                int(staging_id): (
                    f"Source segment already POSTED in bundle {posted_in}"
                    + (" with a DIFFERENT source_key (source data changed — needs storno in SAP"
                       " before this correction is sent)" if key_changed else " (duplicate)")
                )
                for staging_id, posted_in, key_changed in cur.fetchall()
            }


def find_burned_ztimesheetids(ztimesheetids: list[str]) -> dict[str, str]:
    if not ztimesheetids:
        return {}
    with connect_source() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ztimesheetid, min(created_at)::date, min(start_date)
                FROM log_timesheet_sap
                WHERE ztimesheetid = ANY(%s)
                  AND sap_response LIKE 'SUCCESS%%'
                GROUP BY ztimesheetid
                """,
                (ztimesheetids,),
            )
            return {
                str(zid): (
                    f"ZTIMESHEETID {zid} was already accepted by SAP (sent {sent}, "
                    f"work date {work_date}). Sequence ID was reset to 1 on 2026-07-14, "
                    "so this number is reused. Storno in SAP first, or shift the sequence."
                )
                for zid, sent, work_date in cur.fetchall()
            }


def mark_skipped(row_id: int, reason: str) -> None:
    with connect_staging() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET status = 'SKIPPED', sap_error = %s, updated_at = now()
                WHERE id = %s
                """,
                (reason, row_id),
            )
        conn.commit()


def post_one(row: dict, args: argparse.Namespace) -> str:
    """Kirim SATU baris ke SAP. Dipanggil paralel oleh ThreadPoolExecutor.

    Retry hanya untuk kegagalan JARINGAN (mis. SSL UNEXPECTED_EOF — CPI memutus koneksi),
    BUKAN untuk penolakan SAP. Retry aman karena ID-nya sama: kalau ternyata SAP sudah
    menerima kiriman pertama, retry ditolak sebagai ZTIMESHEETID duplikat (terlihat),
    bukan dihitung dua kali.
    """
    row_id = row["id"]
    zid = (row["payload"] or {}).get("ZTIMESHEETID")
    payload = row["payload"] or {}
    if not payload:
        update_result(row_id, False, 0, "empty payload", "empty payload")
        return "failed"

    last_error = None
    last_message = None
    for attempt in range(1, args.max_retries + 1):
        try:
            status_code, response_text = post_payload(payload, args.timeout)
        except Exception as exc:
            last_error = str(exc)
            if attempt < args.max_retries:
                backoff = args.retry_backoff * attempt
                log.warning("Jaringan gagal id=%s (percobaan %s/%s), ulang dalam %.1fs: %s",
                            row_id, attempt, args.max_retries, backoff, exc)
                time.sleep(backoff)
                continue
            update_result(row_id, False, 0, last_error, last_error)
            log.warning("SAP ERROR id=%s ztimesheetid=%s error=%s", row_id, zid, last_error)
            if row["source_system"] == "TIMESHEET" and row.get("source_ref_id"):
                mark_local_timesheet_rejected([row["source_ref_id"]], last_error)
            return "failed"

        sap_status, sap_message = parse_sap_status(response_text)
        ok = sap_status == "S"

        if not ok and "already being processed" in sap_message.lower() and attempt < args.max_retries:
            backoff = args.retry_backoff * attempt
            log.warning("Order terkunci id=%s (percobaan %s/%s), ulang dalam %.1fs: %s",
                        row_id, attempt, args.max_retries, backoff, sap_message)
            last_message = sap_message
            time.sleep(backoff)
            continue

        update_result(row_id, ok, status_code, response_text, sap_message)
        log_timesheet_sap(payload, response_text)

        if args.delay_ms > 0:
            time.sleep(args.delay_ms / 1000)

        if ok:
            log.info("SAP OK id=%s ztimesheetid=%s", row_id, zid)
            return "success"

        log.warning("SAP FAILED id=%s ztimesheetid=%s message=%s", row_id, zid, sap_message)
        if row["source_system"] == "TIMESHEET" and row.get("source_ref_id"):
            mark_local_timesheet_rejected([row["source_ref_id"]], sap_message)
        return "failed"

    msg = last_message or last_error or "gagal setelah retry"
    update_result(row_id, False, 0, msg, msg)
    return "failed"


def post_order_group(rows: list[dict], args: argparse.Namespace) -> list[str]:
    """Kirim semua baris untuk SATU order — SERIAL.

    SAP CPI MENGUNCI sebuah order selama memproses konfirmasinya: dua kiriman untuk
    order yang sama secara bersamaan -> yang kedua ditolak
    ("Order X is already being processed by SAPCI"). Terbukti live: paralel acak 5 worker
    membuat 6 dari 10 baris gagal, 4 di antaranya menabrak order yang sama.
    Jadi paralelismenya ADA DI ANTAR-ORDER, bukan di dalam satu order.
    """
    return [post_one(row, args) for row in rows]


def process_rows(args: argparse.Namespace) -> None:
    selected_ids = parse_csv_values(args.ids)
    selected_ztimesheetids = parse_csv_values(args.ztimesheetids)
    if selected_ids or selected_ztimesheetids:
        plant = None if args.all_plants else (args.plant or plant_code())
        rows = claim_selected_rows(selected_ids, selected_ztimesheetids, args.allow_posted, plant)
    else:
        plant = None if args.all_plants else (args.plant or plant_code())
        productive = None
        if args.productive_only:
            productive = True
        elif args.unproductive_only:
            productive = False
        rows = claim_rows(args.limit, args.retry_failed, args.source_system, plant, productive, args.failed_only, args.include_today, args.date, args.pernr)
    if not rows:
        log.info("No staging rows to post")
        return

    conflicts = find_posted_conflicts([row["id"] for row in rows])
    if conflicts:
        log.warning("Guard: %s bundel dilewati karena segmennya sudah ter-POST", len(conflicts))

    burned = find_burned_ztimesheetids([str(row["id"]) for row in rows])
    if burned:
        log.warning("Guard: %s bundel dilewati — ZTIMESHEETID-nya sudah dipakai di SAP", len(burned))
    for row in rows:
        reason = burned.get(str(row["id"]))
        if reason and row["id"] not in conflicts:
            conflicts[row["id"]] = reason

    success_count = 0
    fail_count = 0
    skipped_count = 0

    postable = []
    for row in rows:
        conflict = conflicts.get(row["id"])
        if conflict:
            mark_skipped(row["id"], conflict)
            skipped_count += 1
            log.warning("SKIPPED id=%s — %s", row["id"], conflict)
        else:
            postable.append(row)

    groups: dict[str, list[dict]] = {}
    for row in postable:
        aufnr = (row["payload"] or {}).get("AUFNR") or ""
        key = aufnr if aufnr else f"__free_{row['id']}"
        groups.setdefault(key, []).append(row)

    started = time.perf_counter()
    results: list[str] = []
    if args.workers > 1 and len(groups) > 1:
        log.info("Mengirim %s baris / %s order dengan %s worker (paralel antar-order, serial di dalam order)",
                 len(postable), len(groups), args.workers)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(post_order_group, grp, args) for grp in groups.values()]
            for fut in as_completed(futures):
                results.extend(fut.result())
    else:
        for grp in groups.values():
            results.extend(post_order_group(grp, args))
    _close_thread_conns()

    for outcome in results:
        if outcome == "success":
            success_count += 1
        else:
            fail_count += 1

    elapsed = time.perf_counter() - started
    if postable:
        log.info("Selesai dalam %.1f dtk (%.1f dtk/baris)", elapsed, elapsed / len(postable))

    log.info(
        "SAP posting done success=%s failed=%s skipped=%s",
        success_count, fail_count, skipped_count,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Post SAP payloads from sap_timesheet_staging")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--delay-ms", type=int, default=100)
    parser.add_argument("--retry-failed", action="store_true", help="Also retry rows with status FAILED")
    parser.add_argument("--failed-only", action="store_true", help="HANYA baris FAILED (dipakai tombol 'kirim ulang gagal' di UI — tidak menyentuh PENDING)")
    parser.add_argument("--include-today", action="store_true", help="Ikutkan bundel MCH_HOURS hari BERJALAN (default: hanya hari selesai). Hati-hati: mengunci hari yang masih tumbuh.")
    parser.add_argument("--source-system", choices=["TIMESHEET", "MCH_HOURS"], help="Only post one source system")
    parser.add_argument(
        "--workers", type=int, default=1,
        help="Jumlah kiriman paralel ke SAP (default 1 = serial). SAP ~7 dtk/kiriman, "
             "jadi paralel adalah satu-satunya cara mempercepat batch besar. Mulai dari 4-5; "
             "kalau error jaringan/TLS mulai sering, TURUNKAN (tanda rate-limit CPI).",
    )
    parser.add_argument(
        "--max-retries", type=int, default=3,
        help="Percobaan ulang untuk kegagalan JARINGAN saja (bukan penolakan SAP). "
             "Aman: ID sama -> SAP menolak duplikat, tidak dobel.",
    )
    parser.add_argument("--retry-backoff", type=float, default=2.0, help="Detik jeda dasar antar retry (naik linear)")
    productive_group = parser.add_mutually_exclusive_group()
    productive_group.add_argument(
        "--productive-only", action="store_true",
        help="Hanya kirim baris PRODUKTIF (zconf_type M1/M2 — konfirmasi order). "
             "Pakai ini untuk posting massal selagi baris unproductive masih ditolak SAP.",
    )
    productive_group.add_argument(
        "--unproductive-only", action="store_true",
        help="Hanya kirim baris UNPRODUCTIVE (LSTAR). Jalankan setelah fix cost center di SAP.",
    )
    parser.add_argument("--plant", help="Only post one plant. Defaults to PLANT_SSB")
    parser.add_argument("--all-plants", action="store_true", help="Ignore plant filter")
    parser.add_argument("--ids", help="Comma-separated staging id list to post for manual testing")
    parser.add_argument("--ztimesheetids", help="Comma-separated ZTIMESHEETID list to post for manual testing")
    parser.add_argument("--allow-posted", action="store_true", help="Allow selected --ids/--ztimesheetids even if already POSTED")
    parser.add_argument("--date", help="Posting manual per tanggal bucket (YYYY-MM-DD) via UI")
    parser.add_argument("--pernr", help="Posting manual per operator (PERNR) via UI")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    process_rows(args)


if __name__ == "__main__":
    main()
