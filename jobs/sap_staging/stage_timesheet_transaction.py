from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta

import psycopg2.extras

from sap_staging_common import (
    app_timezone,
    connect_source,
    connect_staging,
    cursor_initial_from,
    cursor_overlap_minutes,
    cursor_safety_delay_minutes,
    ensure_staging_schema,
    get_stage_cursor,
    insert_staging_rows,
    load_sap_rules,
    load_sap_rules_default,
    ph3_order_table,
    plant_code,
    quote_table_name,
    setup_logging,
    update_stage_cursor,
    upsert_eligibility_audit,
)

log = setup_logging("stage_timesheet_transaction")


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def cursor_window(conn, overlap_minutes: int, safety_delay_minutes: int) -> tuple[datetime, datetime]:
    plant = plant_code()
    cursor_value = get_stage_cursor(conn, "TIMESHEET", plant)
    start = cursor_value or cursor_initial_from()
    if overlap_minutes > 0:
        start = start - timedelta(minutes=overlap_minutes)
    end = datetime.now().replace(microsecond=0) - timedelta(minutes=safety_delay_minutes)
    return start, end


def fetch_rows(from_ts: datetime, to_ts: datetime, limit: int) -> list[dict]:
    ph3_table = quote_table_name(ph3_order_table())
    timezone = app_timezone()

    
    try:
        with connect_source() as conn:
            rules = load_sap_rules(conn)
    except Exception as exc:
        log.warning("fetch_rows: load_sap_rules gagal, pakai default (%s)", exc)
        rules = load_sap_rules_default()
    break_windows_json = json.dumps(rules.get("break_windows", []))
    max_record = rules.get("max_record_minutes") or {}
    
    max_record_ts_json = json.dumps(max_record.get("timesheet") or {})
    
    
    fallback = rules.get("max_record_fallback") or {}
    fb_va = fallback.get("va")
    fb_nva = fallback.get("nva")

    sql = f"""
    WITH cap_cfg AS (
      SELECT %s::jsonb AS ts
    ),
    break_windows AS (
      SELECT
        (bw ->> 'start')::time AS start_t,
        (bw ->> 'end')::time AS end_t,
        d.day::int AS dow
      FROM jsonb_array_elements(%s::jsonb) AS bw
      CROSS JOIN LATERAL jsonb_array_elements_text(bw -> 'days') AS d(day)
    ),
    -- Durasi EFEKTIF per record:
    --   • record PRODUKTIF (activitytype kosong) -> dihitung PENUH (break bukan
    --     exclusion window untuk productive activity; cap = timesheet[''])
    --   • record NON-PRODUKTIF (activitytype terisi) -> overlap jam istirahat
    --     DIKURANGI; record yang SELURUHNYA di jam istirahat (efektif <= 0)
    --     dianggap tidak valid dan diabaikan; cap = timesheet[activitytype]
    -- (Koreksi 2026-08-19: sebelumnya break memotong productive — SALAH.
    --  Per-jenis 2026-08-30: cap dibaca dari map per activitytype; null = No Limit;
    --  kode yang belum diatur memakai fallback kategori config lama.)
    -- IEDD/IEDZ jadi SINTETIS = checkin + durasi efektif (filosofi MCH: yang
    -- akurat adalah durasi, bukan jendela waktu aslinya).
    base AS (
      SELECT
        t.*,
        un.employee_category,
        po.confirmation_number,
        po.sequence_category,
        po.sequence_number,
        po.branch_operation_no,
        po.return_operation_no,
        EXTRACT(EPOCH FROM (t.longdate_checkout - t.longdate_checkin))::bigint AS raw_seconds,
        COALESCE(b.break_seconds, 0)::bigint AS break_seconds,
        CASE
          WHEN jsonb_typeof(cc.ts -> BTRIM(COALESCE(t.activitytype, ''))) = 'null' THEN NULL
          WHEN (cc.ts ->> BTRIM(COALESCE(t.activitytype, ''))) ~ '^[0-9]+$'
            THEN (cc.ts ->> BTRIM(COALESCE(t.activitytype, '')))::int
          WHEN BTRIM(COALESCE(t.activitytype, '')) = '' THEN %s::int
          ELSE %s::int
        END AS cap_minutes
      FROM timesheet_transaction t
      CROSS JOIN cap_cfg cc
      LEFT JOIN {ph3_table} po
        ON LTRIM(COALESCE(po.order_no, ''), '0') = t.order_no
       AND LTRIM(COALESCE(po.operation_no, ''), '0') = t.operation_no::text
      LEFT JOIN LATERAL (
        SELECT employee_category
        FROM usernfc u
        WHERE upper(regexp_replace(COALESCE(u.snssb, ''), '\\s+', '', 'g'))
            = upper(regexp_replace(COALESCE(t.serialnumber, ''), '\\s+', '', 'g'))
        LIMIT 1
      ) un ON TRUE
      LEFT JOIN LATERAL (
        -- Overlap record dengan break windows, per hari (record bisa lintas tengah
        -- malam — night shift 23:00-07:00). Hanya untuk record NON-PRODUKTIF
        -- (activitytype terisi); productive tidak pernah dipotong break.
        SELECT SUM(EXTRACT(EPOCH FROM (
          LEAST(seg_end, day_bucket + bw.end_t)
            - GREATEST(seg_start, day_bucket + bw.start_t)
        ))::bigint)::bigint AS break_seconds
        FROM generate_series(
          date_trunc('day', t.longdate_checkin AT TIME ZONE %s),
          date_trunc('day', t.longdate_checkout AT TIME ZONE %s),
          interval '1 day'
        ) AS g(day_bucket)
        CROSS JOIN LATERAL (
          SELECT
            GREATEST(t.longdate_checkin AT TIME ZONE %s, g.day_bucket) AS seg_start,
            LEAST(t.longdate_checkout AT TIME ZONE %s, g.day_bucket + interval '1 day') AS seg_end
        ) seg
        CROSS JOIN break_windows bw
        WHERE EXTRACT(DOW FROM g.day_bucket) = bw.dow
          AND COALESCE(t.activitytype, '') <> ''
          AND seg.seg_start < g.day_bucket + bw.end_t
          AND seg.seg_end > g.day_bucket + bw.start_t
      ) b ON TRUE
      WHERE t.longdate_checkin IS NOT NULL
        AND t.longdate_checkout IS NOT NULL
        AND t.longdate_checkout > t.longdate_checkin
        AND t.longdate_checkout >= (%s::timestamp AT TIME ZONE %s)
        AND t.longdate_checkout <  (%s::timestamp AT TIME ZONE %s)
        AND COALESCE(t.state_flag, 0) <> 5
        AND COALESCE(t.activitytype, '') <> '0000'
        AND NOT EXISTS (
          SELECT 1 FROM public.sap_staging_exclusion ex
          WHERE ex.source_system = 'TIMESHEET'
            AND ex.source_row_id = t.tsnumber::text
        )
    ),
    effective AS (
      SELECT
        *,
        -- cap_minutes NULL = No Limit: LEAST mengabaikan NULL sehingga durasi
        -- (setelah potongan break untuk non-produktif) lolos utuh.
        LEAST(
          GREATEST(raw_seconds - break_seconds, 0),
          cap_minutes::bigint * 60
        ) AS effective_seconds
      FROM base
    )
    SELECT
      'TIMESHEET' AS source_system,
      COALESCE(plant, '') || ':' || tsnumber::text AS source_key,
      tsnumber::text AS source_ref_id,
      COALESCE(plant, '') AS werks,
      CASE
        WHEN COALESCE(employee_category, '') ILIKE '%%Outsource%%' THEN '11009413'
        ELSE LPAD(COALESCE(serialnumber, ''), 8, '0')
      END AS pernr,
      LPAD(COALESCE(serialnumber, ''), 8, '0') AS pernr_origin,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(confirmation_number, '') END AS rueck,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE LPAD(COALESCE(order_no, ''), 12, '0') END AS aufnr,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE LPAD(COALESCE(operation_no::text, ''), 4, '0') END AS vornr,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(sequence_category, '') END AS flgat,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(sequence_number, '') END AS plnfl,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(branch_operation_no, '') END AS vornr_b,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(return_operation_no, '') END AS vornr_r,
      CASE
        WHEN COALESCE(activitytype, '') <> '' THEN ''
        WHEN COALESCE(workcentercode, '') LIKE '%%OT' THEN 'OV'
        WHEN COALESCE(order_no, '') LIKE '32%%' THEN 'RW'
        ELSE 'RG'
      END AS zconf_type,
      COALESCE(workcentercode, '') AS arbpl,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN activitytype ELSE '' END AS lstar,
      TO_CHAR(longdate_checkin AT TIME ZONE %s, 'YYYYMMDD') AS isdd,
      TO_CHAR(longdate_checkin AT TIME ZONE %s, 'HH24MISS') AS isdz,
      -- IEDD/IEDZ SINTETIS: checkin + durasi efektif (non-produktif dipotong
      -- istirahat; produktif tetap penuh; keduanya di-cap).
      TO_CHAR((longdate_checkin AT TIME ZONE %s) + (effective_seconds || ' seconds')::interval, 'YYYYMMDD') AS iedd,
      TO_CHAR((longdate_checkin AT TIME ZONE %s) + (effective_seconds || ' seconds')::interval, 'HH24MISS') AS iedz,
      '' AS aueru,
      '' AS zbarcodeid,
      NULL::timestamp AS bucket_start,
      NULL::timestamp AS synthetic_start,
      NULL::timestamp AS synthetic_end,
      effective_seconds AS total_seconds,
      1::integer AS source_row_count,
      longdate_checkin AT TIME ZONE %s AS source_min_start,
      longdate_checkin AT TIME ZONE %s + (effective_seconds || ' seconds')::interval AS source_max_end
    FROM effective
    WHERE effective_seconds > 0
    ORDER BY longdate_checkout, tsnumber
    LIMIT %s
    """

    params = [
        max_record_ts_json,
        break_windows_json,
        fb_va, fb_nva,
        timezone, timezone, timezone, timezone,
        from_ts, timezone, to_ts, timezone,
        timezone, timezone, timezone, timezone, timezone, timezone,
        limit,
    ]
    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]


def dedupe_audit_rows(rows: list[dict]) -> list[dict]:
    
    seen: set[tuple] = set()
    result = []
    for row in rows:
        key = (row.get("source_system"), row.get("source_key"))
        if key in seen:
            continue
        seen.add(key)
        result.append(row)
    return result


def audit_rows_for_staged(rows: list[dict]) -> list[dict]:
    return [
        {
            "source_system": row["source_system"],
            "source_key": row["source_key"],
            "source_ref_id": row.get("source_ref_id"),
            "source_date": row.get("source_min_start").date() if row.get("source_min_start") else None,
            "plant": row.get("werks") or plant_code(),
            "eligibility_status": "STAGED",
            "block_reason": None,
            "block_detail": json.dumps({"staged_to": "sap_timesheet_staging"}),
        }
        for row in rows
    ]


def fetch_blocked_today_rows() -> list[dict]:
    ph3_table = quote_table_name(ph3_order_table())
    timezone = app_timezone()

    sql = f"""
    WITH base AS (
      SELECT
        t.tsnumber,
        t.plant,
        (t.longdate_checkin AT TIME ZONE %s)::date AS source_date,
        t.activitytype,
        t.order_no,
        t.operation_no,
        EXISTS (
          SELECT 1
          FROM {ph3_table} po
          WHERE LTRIM(COALESCE(po.order_no, ''), '0') = LTRIM(COALESCE(t.order_no, ''), '0')
            AND LTRIM(COALESCE(po.operation_no, ''), '0') = t.operation_no::text
        ) AS has_sow_match
      FROM timesheet_transaction t
      WHERE t.longdate_checkin IS NOT NULL
        AND t.longdate_checkin >= (date_trunc('day', now() AT TIME ZONE %s) AT TIME ZONE %s)
        AND t.longdate_checkin <  (date_trunc('day', now() AT TIME ZONE %s) AT TIME ZONE %s) + interval '1 day'
        AND COALESCE(t.state_flag, 0) <> 5
        AND COALESCE(t.activitytype, '') <> '0000'
    ),
    flags AS (
      SELECT
        *,
        (NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NULL) AS missing_order,
        (NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL AND operation_no IS NULL) AS missing_operation,
        (
          NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL
          AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
          AND operation_no IS NOT NULL
          AND NOT has_sow_match
        ) AS sow_no_match
      FROM base
    )
    SELECT *
    FROM flags
    WHERE missing_order OR missing_operation OR sow_no_match
    ORDER BY tsnumber
    """

    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (timezone, timezone, timezone, timezone, timezone))
            rows = [dict(row) for row in cur.fetchall()]

    audit_rows = []
    for row in rows:
        reasons = []
        if row.get("missing_order"):
            reasons.append("missing_order")
        if row.get("missing_operation"):
            reasons.append("missing_operation")
        if row.get("sow_no_match"):
            reasons.append("sow_no_match")

        audit_rows.append({
            "source_system": "TIMESHEET",
            "source_key": f"{row.get('plant') or ''}:{row['tsnumber']}",
            "source_ref_id": str(row["tsnumber"]),
            "source_date": row.get("source_date"),
            "plant": row.get("plant") or plant_code(),
            "eligibility_status": "BLOCKED",
            "block_reason": ",".join(reasons),
            "block_detail": json.dumps({
                "missing_order": bool(row.get("missing_order")),
                "missing_operation": bool(row.get("missing_operation")),
                "sow_no_match": bool(row.get("sow_no_match")),
                "order_no": row.get("order_no"),
                "operation_no": row.get("operation_no"),
            }),
        })
    return audit_rows


def run_once(args: argparse.Namespace) -> bool:
    cursor_mode = not (args.from_ts or args.to_ts)

    if args.from_ts and args.to_ts:
        from_ts = parse_dt(args.from_ts)
        to_ts = parse_dt(args.to_ts)
    elif args.from_ts or args.to_ts:
        raise ValueError("--from-ts and --to-ts must be used together")
    else:
        with connect_staging() as staging_conn:
            ensure_staging_schema(staging_conn)
            from_ts, to_ts = cursor_window(staging_conn, args.overlap_minutes, args.safety_delay_minutes)

    if from_ts >= to_ts:
        log.info("Timesheet staging skipped: empty window %s..%s", from_ts, to_ts)
        return False

    rows = fetch_rows(from_ts, to_ts, args.limit)
    if args.dry_run:
        log.info("Dry run: window=%s..%s prepared=%s inserted=0", from_ts, to_ts, len(rows))
        return bool(rows)

    cursor_to = to_ts
    with connect_staging() as conn:
        ensure_staging_schema(conn)
        inserted = insert_staging_rows(conn, rows)
        audited = upsert_eligibility_audit(conn, dedupe_audit_rows([
            *audit_rows_for_staged(rows),
            *fetch_blocked_today_rows(),
        ]))
        if cursor_mode:
            cursor_to = max((row["source_max_end"] for row in rows), default=to_ts)
            update_stage_cursor(conn, "TIMESHEET", plant_code(), cursor_to)
            conn.commit()

    log.info(
        "Timesheet staging window=%s..%s prepared=%s inserted=%s audited=%s cursor_mode=%s",
        from_ts,
        to_ts,
        len(rows),
        inserted,
        audited,
        cursor_mode,
    )
    return cursor_to > from_ts


def run(args: argparse.Namespace) -> None:
    if not args.loop:
        run_once(args)
        return

    if args.from_ts or args.to_ts:
        raise ValueError("--loop is only for cursor mode; do not use --from-ts/--to-ts")

    for iteration in range(1, args.loop + 1):
        log.info("Loop iteration %s/%s", iteration, args.loop)
        progressed = run_once(args)
        if not progressed:
            log.info("Loop stopped: no more cursor progress")
            break
        if args.loop_sleep_seconds > 0 and iteration < args.loop:
            time.sleep(args.loop_sleep_seconds)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Stage completed timesheet_transaction rows to SAP staging. Default: cursor catch-up by checkout time.",
    )
    parser.add_argument("--from-ts", help="Start checkout timestamp, e.g. 2026-06-14T21:00:00")
    parser.add_argument("--to-ts", help="End checkout timestamp, e.g. 2026-06-14T21:10:00")
    parser.add_argument("--overlap-minutes", type=int, default=cursor_overlap_minutes(30), help="Cursor overlap to catch late updates")
    parser.add_argument("--safety-delay-minutes", type=int, default=cursor_safety_delay_minutes(1), help="Do not process the most recent N minutes")
    parser.add_argument("--limit", type=int, default=5000, help="Maximum source rows to stage per run")
    parser.add_argument("--loop", type=int, default=0, help="Test/catch-up mode: run cursor batches repeatedly N times")
    parser.add_argument("--loop-sleep-seconds", type=float, default=0.0, help="Sleep between loop iterations")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    run(args)


if __name__ == "__main__":
    main()
