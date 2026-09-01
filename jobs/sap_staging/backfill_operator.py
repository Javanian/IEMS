from __future__ import annotations

import argparse
import sys

from sap_staging_common import connect_source, setup_logging

log = setup_logging("backfill_operator")


RESOLVE_CTE = r"""
WITH resolved AS (
    SELECT DISTINCT ON (p.proddataid)
        p.proddataid,
        u.snssb,
        u.full_name
    FROM mch_productiondata p
    JOIN usernfc u
      ON u.nfcid = p.operatorid
      OR (
           p.operatorid ~ '^[0-9A-Fa-f]{8}$'
           AND u.nfcid = (
             ('x' || regexp_replace(p.operatorid, '(..)(..)(..)(..)', '\4\3\2\1'))::bit(32)::bigint
           )::text
         )
    WHERE p.startdatetime >= %(floor)s
      __TO_FILTER__
      AND NULLIF(btrim(u.snssb), '') IS NOT NULL
      __SNSSB_FILTER__
    ORDER BY p.proddataid, (u.nfcid = p.operatorid) DESC, u.idrow
)
"""


def _render_cte(to_filter: str, snssb_filter: str) -> str:

    return RESOLVE_CTE.replace("__TO_FILTER__", to_filter).replace("__SNSSB_FILTER__", snssb_filter)


def managed_floor(conn):

    with conn.cursor() as cur:
        cur.execute(
            "SELECT min(bucket_start)::date FROM sap_timesheet_staging WHERE source_system = 'MCH_HOURS'"
        )
        row = cur.fetchone()
        return row[0] if row else None


def build_filters(args):
    to_filter = ""
    snssb_filter = ""
    params = {"floor": args.floor}

    if args.to_date:
        to_filter = "AND p.startdatetime < (%(to)s::date + 1)"
        params["to"] = args.to_date
    if args.snssb_list:
        snssb_filter = "AND u.snssb = ANY(%(snssb)s::text[])"
        params["snssb"] = args.snssb_list

    return to_filter, snssb_filter, params


def preview(conn, args):

    to_filter, snssb_filter, params = build_filters(args)
    cte = _render_cte(to_filter, snssb_filter)
    sql = cte + """
    SELECT
        r.snssb,
        max(r.full_name) AS full_name,
        count(*) AS akan_terisi,
        count(*) FILTER (
            WHERE m.enddatetime IS NOT NULL AND m.enddatetime > m.startdatetime
              AND COALESCE(m.confirmation_number, '') <> ''
              AND COALESCE(m.order_no, '') <> ''
              AND COALESCE(m.operation_no, '') <> ''
        ) AS jadi_layak_sap
    FROM resolved r
    JOIN mch_transaction m ON m.proddataid = r.proddataid
    WHERE NULLIF(btrim(m.sn_employee), '') IS NULL
    GROUP BY r.snssb
    ORDER BY jadi_layak_sap DESC, r.snssb
    """
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def run_update(conn, args):
    to_filter, snssb_filter, params = build_filters(args)
    cte = _render_cte(to_filter, snssb_filter)

    sql = cte + """
    UPDATE mch_transaction m
       SET sn_employee = r.snssb,
           full_name   = COALESCE(NULLIF(btrim(m.full_name), ''), r.full_name),
           refreshed_at = now()
      FROM resolved r
     WHERE m.proddataid = r.proddataid
       AND NULLIF(btrim(m.sn_employee), '') IS NULL
    RETURNING r.snssb
    """
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    conn.commit()
    counts: dict[str, int] = {}
    for (snssb,) in rows:
        counts[snssb] = counts.get(snssb, 0) + 1
    return counts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill mch_transaction.sn_employee untuk operator yang kartunya baru "
        "beres. Bedah, aman-freeze, alternatif --full-rebuild.",
    )
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument("--snssb", help="SNSSB operator (boleh dipisah koma untuk beberapa).")
    selector.add_argument(
        "--all", action="store_true", help="Semua operator yang barisnya bisa di-resolve."
    )
    parser.add_argument(
        "--since",
        dest="since",
        help="Lantai tanggal YYYY-MM-DD. Default: bucket paling awal di antrian.",
    )
    parser.add_argument("--to", dest="to_date", help="Batas atas tanggal YYYY-MM-DD (inklusif).")
    parser.add_argument("--dry-run", action="store_true", help="Preview saja, tidak menulis.")
    args = parser.parse_args()
    args.snssb_list = (
        [s.strip() for s in args.snssb.split(",") if s.strip()] if args.snssb else None
    )
    return args


def main() -> None:
    args = parse_args()
    conn = connect_source()
    try:
        floor = args.since or managed_floor(conn)
        if floor is None:
            log.error(
                "Antrian kosong, tidak ada lantai terkelola. Tentukan --since YYYY-MM-DD eksplisit."
            )
            sys.exit(1)
        args.floor = floor

        default_floor = managed_floor(conn)
        if args.since and default_floor and str(args.since) < str(default_floor):
            log.warning(
                "--since %s DI BAWAH lantai terkelola (%s). Baris yang terisi di bawah lantai "
                "TIDAK akan di-stage oleh --catchup (managed_floor menjaganya). Lanjut hanya kalau "
                "kamu paham konsekuensinya.",
                args.since,
                default_floor,
            )

        scope = "semua operator" if args.all else f"snssb {', '.join(args.snssb_list)}"
        log.info(
            "Backfill operator: %s | lantai=%s%s%s",
            scope,
            floor,
            f" s/d {args.to_date}" if args.to_date else "",
            " (DRY RUN)" if args.dry_run else "",
        )

        rows = preview(conn, args)
        if not rows:
            log.info(
                "Tidak ada baris sn_employee-kosong yang bisa di-resolve pada rentang ini. Tidak ada yang dikerjakan."
            )
            return

        total_isi = sum(r[2] for r in rows)
        total_layak = sum(r[3] for r in rows)
        log.info(
            "Preview — %s operator, %s baris akan terisi, %s di antaranya jadi LAYAK SAP:",
            len(rows),
            total_isi,
            total_layak,
        )
        for snssb, full_name, akan_terisi, jadi_layak in rows:
            log.info(
                "  %-10s %-24s terisi=%-5s layak_sap=%s",
                snssb,
                (full_name or "?")[:24],
                akan_terisi,
                jadi_layak,
            )

        if args.dry_run:
            log.info("DRY RUN — tidak ada yang ditulis. Jalankan tanpa --dry-run untuk menerapkan.")
            return

        counts = run_update(conn, args)
        applied = sum(counts.values())
        log.info("Selesai — %s baris terisi untuk %s operator.", applied, len(counts))
        log.info(
            "Langkah berikutnya: python stage_machinehours.py --catchup  (lalu review + post_sap_staging.py)"
        )
    except Exception:
        conn.rollback()
        log.exception("Gagal — transaksi di-rollback, tidak ada perubahan.")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
