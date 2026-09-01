from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta

import psycopg2.extras

from sap_staging_common import (
    app_timezone,
    connect_source,
    connect_staging,
    ensure_staging_schema,
    insert_staging_rows,
    load_sap_rules,
    load_sap_rules_default,
    parse_csv_ints,
    ph3_order_table,
    plant_code,
    quote_table_name,
    setup_logging,
)

log = setup_logging("stage_sap_timesheet")


def previous_completed_hour() -> tuple[datetime, datetime]:
    end = datetime.now().replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(hours=1)
    return start, end


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def fetch_timesheet_rows(tsnumbers: list[int], from_date: str | None, to_date: str | None) -> list[dict]:
    if not tsnumbers and not (from_date and to_date):
        raise ValueError("timesheet staging needs --tsnumbers or both --from-date and --to-date")

    params: list = [app_timezone()]
    filters = [
        "t.longdate_checkin IS NOT NULL",
        "t.longdate_checkout IS NOT NULL",
        "t.longdate_checkout > t.longdate_checkin",
        "COALESCE(t.state_flag, 0) <> 5",
    ]

    if tsnumbers:
        params.append(tsnumbers)
        filters.append(f"t.tsnumber = ANY(%s::int[])")
    else:
        params.extend([from_date, to_date])
        filters.append("t.longdate_checkin >= %s::date")
        filters.append("t.longdate_checkin < (%s::date + interval '1 day')")

    ph3_table = quote_table_name(ph3_order_table())
    where_sql = " AND ".join(filters)

    sql = f"""
    SELECT
      'TIMESHEET' AS source_system,
      t.tsnumber::text AS source_key,
      t.tsnumber::text AS source_ref_id,
      COALESCE(t.plant, '') AS werks,
      CASE
        WHEN COALESCE(un.employee_category, '') ILIKE '%%Outsource%%' THEN '11009413'
        ELSE LPAD(COALESCE(t.serialnumber, ''), 8, '0')
      END AS pernr,
      LPAD(COALESCE(t.serialnumber, ''), 8, '0') AS pernr_origin,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.confirmation_number, '') END AS rueck,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE LPAD(COALESCE(t.order_no, ''), 12, '0') END AS aufnr,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE LPAD(COALESCE(t.operation_no::text, ''), 4, '0') END AS vornr,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.sequence_category, '') END AS flgat,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.sequence_number, '') END AS plnfl,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.branch_operation_no, '') END AS vornr_b,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.return_operation_no, '') END AS vornr_r,
      CASE
        WHEN COALESCE(t.activitytype, '') <> '' THEN ''
        WHEN COALESCE(t.workcentercode, '') LIKE '%%OT' THEN 'OV'
        WHEN COALESCE(t.order_no, '') LIKE '32%%' THEN 'RW'
        ELSE 'RG'
      END AS zconf_type,
      COALESCE(t.workcentercode, '') AS arbpl,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN t.activitytype ELSE '' END AS lstar,
      TO_CHAR(t.longdate_checkin AT TIME ZONE %s, 'YYYYMMDD') AS isdd,
      TO_CHAR(t.longdate_checkin AT TIME ZONE %s, 'HH24MISS') AS isdz,
      TO_CHAR(t.longdate_checkout AT TIME ZONE %s, 'YYYYMMDD') AS iedd,
      TO_CHAR(t.longdate_checkout AT TIME ZONE %s, 'HH24MISS') AS iedz,
      '' AS aueru,
      '' AS zbarcodeid,
      NULL::timestamp AS bucket_start,
      NULL::timestamp AS synthetic_start,
      NULL::timestamp AS synthetic_end,
      NULL::bigint AS total_seconds,
      1::integer AS source_row_count,
      t.longdate_checkin AT TIME ZONE %s AS source_min_start,
      t.longdate_checkout AT TIME ZONE %s AS source_max_end
    FROM timesheet_transaction t
    LEFT JOIN {ph3_table} po
      ON LTRIM(po.order_no, '0') = t.order_no
     AND LTRIM(po.operation_no, '0') = t.operation_no::text
    LEFT JOIN LATERAL (
      SELECT employee_category
      FROM usernfc u
      WHERE upper(regexp_replace(COALESCE(u.snssb, ''), '\\s+', '', 'g'))
          = upper(regexp_replace(COALESCE(t.serialnumber, ''), '\\s+', '', 'g'))
      LIMIT 1
    ) un ON TRUE
    WHERE {where_sql}
    ORDER BY t.tsnumber
    """

    tz = params[0]
    query_params = [tz, tz, tz, tz, tz, tz, *params[1:]]
    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, query_params)
            return [dict(row) for row in cur.fetchall()]


def fetch_machine_hour_rows(from_ts: datetime, to_ts: datetime, mode: str = "normal") -> list[dict]:
    
    werks = plant_code()
    if not werks:
        raise ValueError("PLANT_SSB is required for machine-hour staging")

    
    rules = {}
    try:
        with connect_source() as conn:
            rules = load_sap_rules(conn)
    except Exception as exc:  # pragma: no cover — fallback aman ke default
        log.warning("fetch_machine_hour_rows: load_sap_rules gagal, pakai default (%s)", exc)
        rules = load_sap_rules_default()
    break_windows_json = json.dumps(rules.get("break_windows", []))
    max_record = rules.get("max_record_minutes") or {}
    
    max_record_mch_json = json.dumps(max_record.get("mch") or {})
    
    
    fallback = rules.get("max_record_fallback") or {}
    fb_va = fallback.get("va")
    fb_nnva = fallback.get("nnva")
    fb_nva = fallback.get("nva")

    sql = """
    WITH cap_cfg AS (
      SELECT %s::jsonb AS mch
    ),
    source_rows AS (
      SELECT
        proddataid,
        startdatetime,
        -- CAP PER RECORD per JENIS AKTIVITAS (rules config, 2026-08-30): 1 record
        -- mch_transaction maksimal N menit sesuai statusid-nya (cc.mch, key =
        -- statusid). Nilai json null = NO LIMIT -> cap NULL -> LEAST mengabaikan
        -- NULL sehingga durasi asli lolos utuh. statusid yang TIDAK ada di map
        -- memakai fallback kategori dari config lama (M1=VA, M2/idle-promotable=
        -- NNVA, selain itu NVA); kalau fallback juga tidak ada -> tanpa cap.
        -- Lebih dari cap: ekor record DIPOTONG di start + N menit.
        LEAST(
          COALESCE(end_effective, enddatetime),
          startdatetime + (
            CASE
              WHEN jsonb_typeof(cc.mch -> statusid::text) = 'null' THEN NULL
              WHEN (cc.mch ->> statusid::text) ~ '^[0-9]+$'
                THEN (cc.mch ->> statusid::text)::int
              WHEN status_activitytype = 'M1' THEN %s::int
              WHEN status_activitytype = 'M2'
                OR (statusid = 2 AND previoustatusid = 1
                    AND COALESCE(duration_seconds, EXTRACT(EPOCH FROM (enddatetime - startdatetime))) <= 300)
                THEN %s::int
              ELSE %s::int
            END || ' minutes'
          )::interval
        ) AS enddatetime,
        -- LAPIS 1B — pakai akhir interval yang SUDAH dinormalisasi, bukan enddatetime mentah.
        -- end_effective = LEAST(enddatetime, start baris berikutnya di mesin yang sama), diisi
        -- oleh etl_mch_transaction_v3.recompute_end_effective. Tanpa ini, baris "nyangkut"
        -- (HMI putus -> baris tak pernah ditutup, lalu ditutup proses lain dengan stempel now())
        -- mengirim jam yang sebenarnya sudah diklaim baris lain. Contoh nyata: proddataid
        -- 518505 mengirim 4,96 jam Setting padahal 4,18 jam di antaranya dipakai baris
        -- Productive milik mesin yang sama. Lihat docs/concepts/mch-interval-normalization.md.
        --
        -- COALESCE-nya penting: baris yang BARU di-upsert ETL punya end_effective NULL sampai
        -- recompute di akhir run selesai. Fallback ke enddatetime = perilaku lama, jadi jendela
        -- sempit itu tak pernah lebih buruk dari sebelum lapis ini ada.
        --
        -- Alias tetap `enddatetime` supaya seluruh CTE di bawah (split per hari, segments,
        -- bundling) ikut memakai nilai terpotong tanpa perlu disentuh satu per satu.
        -- (CATATAN: LEAST(end_effective, enddatetime) yang dulu ada di sini TIDAK dihapus —
        --  diganti LEAST dengan cap di atas, yang juga memotong end_effective bila melebihi cap.)
        sn_employee,
        un.employee_category,
        confirmation_number,
        order_no,
        operation_no,
        sequence_category,
        sequence_number,
        branch_operation_no,
        return_operation_no,
        machineid,
        status_description,
        -- IDLE PENDEK SETELAH PRODUKSI DIANGGAP SETUP (M2) — aturan owner 2026-07-14.
        -- statusid 2 (Idle) yang datang TEPAT setelah statusid 1 (Productive) dan hanya
        -- berlangsung <= 300 detik = micro-stop di tengah produksi, bukan waktu terbuang.
        -- Diperlakukan sebagai M2: RUECK + ZCONF_TYPE terisi, ZBARCODEID = 'Idle'.
        -- Terukur 1-14 Juli: 1.964 dari 2.315 baris Idle memenuhi syarat ini.
        CASE
          WHEN statusid = 2
           AND previoustatusid = 1
           AND COALESCE(duration_seconds, EXTRACT(EPOCH FROM (enddatetime - startdatetime))) <= 300
            THEN 'M2'
          ELSE COALESCE(status_activitytype, '')
        END AS status_activitytype,
        CASE
          WHEN statusid = 2
           AND previoustatusid = 1
           AND COALESCE(duration_seconds, EXTRACT(EPOCH FROM (enddatetime - startdatetime))) <= 300
            THEN 'Idle'
          WHEN status_activitytype = 'M2' THEN COALESCE(status_description, '')
          WHEN status_activitytype = 'M1' THEN 'VA'
          ELSE ''
        END AS zbarcode_src
      FROM mch_transaction
      CROSS JOIN cap_cfg cc
      LEFT JOIN LATERAL (
        SELECT employee_category
        FROM usernfc u
        WHERE upper(regexp_replace(COALESCE(u.snssb, ''), '\\s+', '', 'g'))
            = upper(regexp_replace(COALESCE(mch_transaction.sn_employee, ''), '\\s+', '', 'g'))
        LIMIT 1
      ) un ON TRUE
      WHERE startdatetime IS NOT NULL
        -- WHERE membaca KOLOM tabel, bukan alias di SELECT (aturan SQL), jadi COALESCE-nya
        -- harus ditulis ulang di sini. Kalau tidak, baris yang seluruh isinya terpotong
        -- habis (end_effective = startdatetime) tetap lolos ke bundling dan baru mati
        -- diam-diam di filter segment_end > segment_start.
        AND COALESCE(end_effective, enddatetime) IS NOT NULL
        AND COALESCE(end_effective, enddatetime) > startdatetime
        -- KELAYAKAN SAP (aturan owner 2026-07-15): productive vs unproductive beda syarat.
        --   • PRODUCTIVE (M1/M2, termasuk idle pendek yang dipromosikan ke M2): butuh
        --     order + operasi + confirmation — dibukukan ke order.
        --   • UNPRODUCTIVE (punya activity type/LSTAR, bukan M1/M2): TANPA confirmation —
        --     dibukukan ke cost center / activity type.
        -- status_activitytype di WHERE = kolom MENTAH (alias promosi di SELECT tak terlihat
        -- di sini). Idle-promotable (statusid 2 + prev 1 + <=300s) diarahkan ke jalur
        -- productive supaya, kalau tak punya order, TETAP tersaring (tidak lahir bundel M2
        -- tanpa AUFNR) — persis perilaku lama.
        AND (
          (
            (
              status_activitytype IN ('M1', 'M2')
              OR (statusid = 2 AND previoustatusid = 1
                  AND COALESCE(duration_seconds, EXTRACT(EPOCH FROM (enddatetime - startdatetime))) <= 300)
            )
            AND confirmation_number IS NOT NULL AND confirmation_number <> ''
            AND order_no IS NOT NULL AND order_no <> ''
            AND operation_no IS NOT NULL AND operation_no <> ''
          )
          OR (
            NULLIF(BTRIM(status_activitytype), '') IS NOT NULL
            AND status_activitytype NOT IN ('M1', 'M2')
            AND NOT (statusid = 2 AND previoustatusid = 1
                     AND COALESCE(duration_seconds, EXTRACT(EPOCH FROM (enddatetime - startdatetime))) <= 300)
          )
        )
        -- GERBANG OPERATOR (2026-07-14). Tanpa ini, baris tanpa sn_employee di-stage dan
        -- dikirim ke SAP dengan PERNR KOSONG — jam kerja tanpa pemilik. Terukur pada
        -- 1-14 Juli: 1.490 baris (554 bundel, seperlima antrian) akan bocor.
        -- (Jangan tulis tanda persen di komentar SQL ini: psycopg2 membacanya sebagai
        --  placeholder format dan seluruh query gagal.)
        --
        -- CATATAN: gerbang ini kini SEJALAN dengan kolom status_record (migration
        -- 20260715_status_record_unproductive) — logika productive/unproductive yang sama.
        -- Bedanya hanya: status_record menandai statusid 0/3/4 = TRUE (sah tanpa job) untuk
        -- accuracy_machine, sementara staging tetap MENGECUALIKAN 0/3/4 di bawah.
        AND NULLIF(BTRIM(sn_employee), '') IS NOT NULL
        -- TIDAK DIKIRIM KE SAP (aturan owner 2026-07-14): bukan waktu kerja pada order.
        --   0 = Off, 3 = Downtime, 4 = No Job
        -- (Catatan: 3 dan 4 mudah tertukar. Verifikasi dari data: 3=Downtime, 4=No Job.)
        AND statusid NOT IN (0, 3, 4)
        -- statusid 5 (Unidentified) BOLEH masuk, TAPI hanya yang <= 60 detik: celah singkat
        -- di antara aktivitas, bukan waktu hilang yang sesungguhnya. Terukur 1-14 Juli pada
        -- baris yang layak SAP: 1.128 dari 1.136 berdurasi <= 60 dtk; yang lebih panjang
        -- hanya 8 baris (terpanjang 18 menit, total 0,7 jam) dan tidak dikirim.
        AND (
          statusid <> 5
          OR COALESCE(duration_seconds, EXTRACT(EPOCH FROM (enddatetime - startdatetime))) <= 60
        )
        AND startdatetime < %s
        AND COALESCE(end_effective, enddatetime) > %s
        -- EXCLUDED (soft delete per record, 2026-08-27): record yang ditandai lewat UI
        -- tidak pernah ikut di-bundle/dikirim. Berlaku juga saat rebuild (tabel exclusion
        -- terpisah dari provenance, jadi bertahan). Un-exclude = hapus baris dari tabel.
        AND NOT EXISTS (
          SELECT 1 FROM public.sap_staging_exclusion ex
          WHERE ex.source_system = 'MCH_HOURS'
            AND ex.source_row_id = mch_transaction.proddataid::text
        )
        __SEGMENT_PROVENANCE_FILTER__
    ),
    -- BREAK WINDOWS (rules config, 2026-08-19): jam istirahat menentukan aktivitas
    -- NON-PRODUKTIF yang terjadi di dalam break = INVALID (tidak dihitung).
    -- `days` = DOW Postgres (0=Sunday..6=Saturday).
    --   • segmen PRODUKTIF (M1/M2) yang overlap break -> TETAP dihitung penuh (VALID)
    --   • segmen NON-produktif yang overlap break -> bagian break dikurangi;
    --     segmen yang habis (<= 0) dianggap tidak valid dan diabaikan
    -- (Koreksi 2026-08-19: sebelumnya break memotong productive — SALAH terhadap
    --  requirement bisnis. Break BUKAN exclusion window untuk productive activity.)
    break_windows AS (
      SELECT
        (bw ->> 'start')::time AS start_t,
        (bw ->> 'end')::time AS end_t,
        d.day::int AS dow
      FROM jsonb_array_elements(%s::jsonb) AS bw
      CROSS JOIN LATERAL jsonb_array_elements_text(bw -> 'days') AS d(day)
    ),
    -- BUNDLING PER HARI (aturan owner 2026-07-16): dulu per JAM, tapi pemecahan per jam
    -- melahirkan pecahan sub-menit di batas jam yang ditolak SAP (< 1 menit) dan terbuang.
    -- Per hari, segmen-segmen itu MENYATU ke total harian -> tidak ada detik terbuang.
    -- Waktu konfirmasi (ISDD/ISDZ) di-anchor ke aktivitas PERTAMA hari itu (source_min_start),
    -- IEDD/IEDZ = + total durasi. Sama filosofinya dengan sintetis-per-jam yang sudah
    -- diterima SAP, cuma jendelanya harian.
    split_rows AS (
      SELECT
        s.*,
        h.day_bucket,
        GREATEST(s.startdatetime, h.day_bucket, %s::timestamp) AS segment_start,
        LEAST(s.enddatetime, h.day_bucket + interval '1 day', %s::timestamp) AS segment_end
      FROM source_rows s
      CROSS JOIN LATERAL generate_series(
        date_trunc('day', GREATEST(s.startdatetime, %s::timestamp)),
        date_trunc('day', LEAST(s.enddatetime, %s::timestamp) - interval '1 microsecond'),
        interval '1 day'
      ) AS h(day_bucket)
    ),
    segments AS (
      SELECT
        s.*,
        -- Durasi mentah segmen.
        EXTRACT(EPOCH FROM (segment_end - segment_start))::bigint AS segment_seconds,
        -- Potongan jam istirahat (rules config): overlap segmen dengan break window
        -- pada hari itu, HANYA untuk segmen NON-PRODUKTIF (bukan M1/M2).
        -- Segmen PRODUKTIF (M1/M2, termasuk idle-pendek yang dipromosikan ke M2 di
        -- source_rows) TIDAK dipotong walau overlap break — break bukan exclusion
        -- window untuk productive activity (koreksi requirement 2026-08-19).
        COALESCE((
          SELECT SUM(EXTRACT(EPOCH FROM (
            LEAST(s.segment_end, s.day_bucket + bw.end_t)
              - GREATEST(s.segment_start, s.day_bucket + bw.start_t)
          ))::bigint)
          FROM break_windows bw
          WHERE EXTRACT(DOW FROM s.day_bucket) = bw.dow
            AND s.status_activitytype NOT IN ('M1', 'M2')
            -- overlap positif: segmen menyentuh window break
            AND s.segment_start < s.day_bucket + bw.end_t
            AND s.segment_end > s.day_bucket + bw.start_t
        ), 0)::bigint AS break_seconds
      FROM split_rows s
      WHERE segment_end > segment_start
    ),
    -- Segmen NON-PRODUKTIF yang SELURUHNYA berada di jam istirahat (durasi efektif
    -- <= 0) dianggap tidak valid dan diabaikan. Segmen produktif tidak pernah kena
    -- potongan (break_seconds = 0), jadi selalu lolos.
    valid_segments AS (
      SELECT
        *,
        (segment_seconds - break_seconds)::bigint AS effective_seconds
      FROM segments
      WHERE segment_seconds - break_seconds > 0
    ),
    bundled AS (
      SELECT
        day_bucket AS bucket_start,
        COALESCE(sn_employee, '') AS employee_key,
        CASE
          WHEN COALESCE(employee_category, '') ILIKE '%%Outsource%%' THEN '11009413'
          ELSE COALESCE(sn_employee, '')
        END AS pernr,
        COALESCE(confirmation_number, '') AS rueck_raw,
        -- UNPRODUCTIVE (bukan M1/M2): order & operasi TIDAK dikirim ke SAP — posting-nya
        -- alokasi aktivitas (LSTAR), bukan konfirmasi order. Dikosongkan di KUNCI juga,
        -- bukan cuma di payload: kalau hanya di payload, dua bundel yang cuma beda order
        -- akan menghasilkan payload KEMBAR (SAP menerima keduanya). Efek nyata pada data
        -- 1 Juli: 96 bundel unproductive -> 90.
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN COALESCE(order_no, '')
          ELSE ''
        END AS aufnr_raw,
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN COALESCE(operation_no, '')
          ELSE ''
        END AS vornr_raw,
        COALESCE(sequence_category, '') AS flgat,
        COALESCE(sequence_number, '') AS plnfl,
        COALESCE(branch_operation_no, '') AS vornr_b,
        COALESCE(return_operation_no, '') AS vornr_r,
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN status_activitytype
          ELSE ''
        END AS zconf_type,
        COALESCE(machineid, '') AS arbpl,
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN ''
          ELSE COALESCE(status_activitytype, '')
        END AS lstar,
        -- Sudah dihitung di source_rows: M1 -> 'VA', M2 -> teks status ('Setting'/'Measure'/
        -- ...), idle-pendek-setelah-produktif -> 'Idle', selain itu kosong.
        zbarcode_src AS zbarcodeid,
        COUNT(*)::integer AS source_row_count,
        MIN(segment_start) AS source_min_start,
        MAX(segment_end) AS source_max_end,
        -- Durasi bundel = jumlah durasi EFEKTIF (segmen non-produktif sudah
        -- dipotong jam istirahat; segmen produktif tetap penuh).
        SUM(effective_seconds)::bigint AS total_seconds,
        -- Provenance: segmen sumber pembentuk bundel ini (proddataid + detik).
        -- Ditulis ke sap_staging_source; jangkar guard anti-double-post — lihat
        -- migration 20260714_sap_staging_provenance.sql.
        jsonb_agg(jsonb_build_object(
          'id', proddataid,
          'sec', effective_seconds
        ) ORDER BY proddataid) AS segments
      FROM valid_segments
      GROUP BY
        day_bucket,
        COALESCE(sn_employee, ''),
        CASE
          WHEN COALESCE(employee_category, '') ILIKE '%%Outsource%%' THEN '11009413'
          ELSE COALESCE(sn_employee, '')
        END,
        COALESCE(confirmation_number, ''),
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN COALESCE(order_no, '')
          ELSE ''
        END,
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN COALESCE(operation_no, '')
          ELSE ''
        END,
        COALESCE(sequence_category, ''),
        COALESCE(sequence_number, ''),
        COALESCE(branch_operation_no, ''),
        COALESCE(return_operation_no, ''),
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN status_activitytype
          ELSE ''
        END,
        COALESCE(machineid, ''),
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN ''
          ELSE COALESCE(status_activitytype, '')
        END,
        zbarcode_src
    )
    SELECT
      'MCH_HOURS' AS source_system,
      -- MODE: normal -> norm_key. correction -> md5(norm_key|KOREKSI|seg_hash) supaya bundel
      -- koreksi TIDAK menabrak bundel POSTED yang kuncinya sama (segmen datang belakangan).
      __SOURCE_KEY_EXPR__ AS source_key,
      __IS_CORRECTION_EXPR__ AS is_correction,
      NULL::text AS source_ref_id,
      f.werks, f.pernr, f.pernr_origin, f.rueck, f.aufnr, f.vornr,
      f.flgat, f.plnfl, f.vornr_b, f.vornr_r, f.zconf_type, f.arbpl, f.lstar,
      f.isdd, f.isdz, f.iedd, f.iedz, f.aueru, f.zbarcodeid,
      f.bucket_start, f.synthetic_start, f.synthetic_end,
      f.total_seconds, f.source_row_count, f.source_min_start, f.source_max_end, f.segments
    FROM (
      SELECT
        md5(concat_ws('|',
          %s, bucket_start::text, employee_key, rueck_raw, aufnr_raw, vornr_raw,
          flgat, plnfl, vornr_b, vornr_r, zconf_type, arbpl, lstar, zbarcodeid
        )) AS norm_key,
        -- hash himpunan proddataid -> kunci koreksi stabil per himpunan, anti-tabrak antar ronde
        md5(COALESCE((SELECT string_agg((e->>'id'), ',' ORDER BY (e->>'id')::bigint)
                      FROM jsonb_array_elements(segments) e), '')) AS seg_hash,
        %s AS werks,
        pernr,
        employee_key AS pernr_origin,
        CASE WHEN zconf_type IN ('M1', 'M2') THEN LPAD(rueck_raw, 10, '0') ELSE '' END AS rueck,
        -- LPAD('', 12, '0') = '000000000000', BUKAN string kosong. Unproductive harus
        -- mengirim AUFNR/VORNR benar-benar kosong, bukan nol berjajar.
        CASE WHEN aufnr_raw = '' THEN '' ELSE LPAD(aufnr_raw, 12, '0') END AS aufnr,
        CASE WHEN vornr_raw = '' THEN '' ELSE LPAD(vornr_raw, 4, '0')  END AS vornr,
        flgat, plnfl, vornr_b, vornr_r, zconf_type, arbpl, lstar,
        -- Waktu di-anchor ke aktivitas PERTAMA hari itu (source_min_start). IEDD/IEDZ =
        -- + total durasi, supaya durasi konfirmasi = jam kerja nyata tanpa menghitung jeda.
        TO_CHAR(source_min_start, 'YYYYMMDD') AS isdd,
        TO_CHAR(source_min_start, 'HH24MISS') AS isdz,
        TO_CHAR(source_min_start + (total_seconds || ' seconds')::interval, 'YYYYMMDD') AS iedd,
        TO_CHAR(source_min_start + (total_seconds || ' seconds')::interval, 'HH24MISS') AS iedz,
        '' AS aueru,
        zbarcodeid,
        bucket_start,
        source_min_start AS synthetic_start,
        source_min_start + (total_seconds || ' seconds')::interval AS synthetic_end,
        total_seconds, source_row_count, source_min_start, source_max_end, segments
      FROM bundled
      -- SAP menolak konfirmasi < 1 menit. Per hari, sub-menit nyaris nol.
      WHERE total_seconds >= 60
    ) f
    -- MODE: normal -> HANYA kunci yang BELUM ter-post (yang sudah ter-post dilewati supaya
    -- tidak menabrak+nyangkut). correction -> HANYA kunci yang SUDAH ter-post (segmen baru).
    WHERE __POSTED_KEY_FILTER__
    ORDER BY f.bucket_start, f.arbpl, f.aufnr, f.vornr, f.zconf_type, f.lstar, f.zbarcodeid
    """

    
    
    
    
    
    
    if mode == "correction":
        seg_filter = ("AND NOT EXISTS (SELECT 1 FROM public.sap_staging_source ss "
                      "WHERE ss.source_system = 'MCH_HOURS' AND ss.source_row_id = mch_transaction.proddataid::text)")
        source_key_expr = "md5(f.norm_key || '|KOREKSI|' || f.seg_hash)"
        is_correction_expr = "true"
        posted_key_filter = ("EXISTS (SELECT 1 FROM public.sap_timesheet_staging p "
                             "WHERE p.bucket_start = f.bucket_start AND p.status = 'POSTED')")
    else:  
        seg_filter = ("AND NOT EXISTS (SELECT 1 FROM public.sap_staging_source ss "
                      "WHERE ss.source_system = 'MCH_HOURS' AND ss.source_row_id = mch_transaction.proddataid::text "
                      "AND ss.posted_at IS NOT NULL)")
        source_key_expr = "f.norm_key"
        is_correction_expr = "false"
        posted_key_filter = ("NOT EXISTS (SELECT 1 FROM public.sap_timesheet_staging p "
                             "WHERE p.bucket_start = f.bucket_start AND p.status = 'POSTED')")

    sql = (sql
           .replace("__SEGMENT_PROVENANCE_FILTER__", seg_filter)
           .replace("__SOURCE_KEY_EXPR__", source_key_expr)
           .replace("__IS_CORRECTION_EXPR__", is_correction_expr)
           .replace("__POSTED_KEY_FILTER__", posted_key_filter))

    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql,
                (max_record_mch_json, fb_va, fb_nnva, fb_nva, to_ts, from_ts, break_windows_json,
                 from_ts, to_ts, from_ts, to_ts, werks, werks),
            )
            return [dict(row) for row in cur.fetchall()]


def stage_rows(rows: list[dict], dry_run: bool) -> int:
    if dry_run:
        log.info("Dry run: %s rows prepared, nothing inserted", len(rows))
        return 0
    with connect_staging() as conn:
        ensure_staging_schema(conn)
        return insert_staging_rows(conn, rows)


def cmd_init_db(_: argparse.Namespace) -> None:
    with connect_staging() as conn:
        ensure_staging_schema(conn)
    log.info("SAP staging schema is ready")


def cmd_timesheet(args: argparse.Namespace) -> None:
    rows = fetch_timesheet_rows(parse_csv_ints(args.tsnumbers), args.from_date, args.to_date)
    inserted = stage_rows(rows, args.dry_run)
    log.info("Timesheet staging prepared=%s inserted=%s", len(rows), inserted)


def cmd_mchours(args: argparse.Namespace) -> None:
    if args.from_ts and args.to_ts:
        from_ts = parse_dt(args.from_ts)
        to_ts = parse_dt(args.to_ts)
    elif args.from_ts or args.to_ts:
        raise ValueError("--from-ts and --to-ts must be used together")
    else:
        from_ts, to_ts = previous_completed_hour()

    rows = fetch_machine_hour_rows(from_ts, to_ts)
    inserted = stage_rows(rows, args.dry_run)
    log.info("Machine-hour staging window=%s..%s prepared=%s inserted=%s", from_ts, to_ts, len(rows), inserted)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Stage local timesheet data to AWS SAP staging table",
        epilog=(
            "Examples:\n"
            "  python stage_sap_timesheet.py init-db\n"
            "  python stage_sap_timesheet.py timesheet --tsnumbers 97179,97180\n"
            "  python stage_sap_timesheet.py timesheet --from-date 2026-06-14 --to-date 2026-06-14\n"
            "  python stage_sap_timesheet.py mchours\n"
            "  python stage_sap_timesheet.py mchours --from-ts 2026-06-12T14:00:00 --to-ts 2026-06-12T15:00:00"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    init_db = sub.add_parser("init-db", help="Create/upgrade SAP staging table")
    init_db.set_defaults(func=cmd_init_db)

    timesheet = sub.add_parser("timesheet", help="Stage timesheet_transaction rows")
    timesheet.add_argument("--tsnumbers", help="Comma-separated tsnumber list, e.g. 97179,97180")
    timesheet.add_argument("--from-date", help="Check-in start date YYYY-MM-DD")
    timesheet.add_argument("--to-date", help="Check-in end date YYYY-MM-DD")
    timesheet.add_argument("--dry-run", action="store_true")
    timesheet.set_defaults(func=cmd_timesheet)

    mchours = sub.add_parser("mchours", help="Stage bundled mch_transaction rows")
    mchours.add_argument("--from-ts", help="Start timestamp, e.g. 2026-06-14T14:00:00")
    mchours.add_argument("--to-ts", help="End timestamp, e.g. 2026-06-14T15:00:00")
    mchours.add_argument("--dry-run", action="store_true")
    mchours.set_defaults(func=cmd_mchours)

    return parser


def main() -> None:
    parser = build_parser()
    if len(sys.argv) == 1:
        parser.print_help()
        return
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
