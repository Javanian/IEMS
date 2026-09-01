from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Iterable

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
ENV_PATH = PROJECT_ROOT / ".env"

load_dotenv(ENV_PATH)

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"


def setup_logging(name: str) -> logging.Logger:
    logging.basicConfig(level=os.getenv("SAP_STAGING_LOG_LEVEL", "INFO"), format=LOG_FORMAT)
    return logging.getLogger(name)


def env_value(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return default if value in (None, "") else value.strip().strip("'").strip('"')


def env_int(name: str, default: int) -> int:
    value = env_value(name)
    if not value:
        return default
    return int(value)


def source_db_config() -> dict:
    return {
        "host": env_value("DB_HOST"),
        "port": env_int("DB_PORT", 5432),
        "dbname": env_value("DB_NAME"),
        "user": env_value("DB_USER"),
        "password": env_value("DB_PASSWORD"),
    }


def staging_db_config() -> dict:
    # Prioritas: SAP_STAGING_DB_* (eksplisit) -> AWS_PG* (kredensial AWS yang
    # sudah ada di .env) -> DB_* (lokal, untuk staging lokal).
    return {
        "host": env_value("SAP_STAGING_DB_HOST", env_value("AWS_PGhost", env_value("DB_HOST"))),
        "port": env_int("SAP_STAGING_DB_PORT", env_int("AWS_PGport", env_int("DB_PORT", 5432))),
        "dbname": env_value("SAP_STAGING_DB_NAME", env_value("AWS_PGDb", env_value("DB_NAME"))),
        "user": env_value("SAP_STAGING_DB_USER", env_value("AWS_PGuser", env_value("DB_USER"))),
        "password": env_value("SAP_STAGING_DB_PASSWORD", env_value("AWS_PGpass", env_value("DB_PASSWORD"))),
    }


def connect_source():
    return psycopg2.connect(**source_db_config())


def connect_staging():
    return psycopg2.connect(**staging_db_config())


def plant_code() -> str:
    return env_value("PLANT_SSB")


MAX_RECORD_CATEGORIES = ("va", "nnva", "nva")
MAX_RECORD_DEFAULT_MINUTES = 90
NOT_STAGED_STATUSIDS = (0, 3, 4)
STATUS_CATEGORY_OVERRIDES = {2: "nnva", 10: "nva"}


def _parse_minutes(value):
    """Menit valid (integer >= 1) atau None kalau bukan angka yang masuk akal."""
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return None
    return minutes if minutes >= 1 else None


def _normalize_type_map(raw, key_pattern) -> dict:
    """Map per jenis aktivitas: nilai menit integer, atau None = NO LIMIT.

    Key tidak valid / nilai sampah DIBUANG (bukan diganti default) supaya tidak
    lahir cap yang tidak pernah diminta.
    """
    if not isinstance(raw, dict):
        return {}
    result = {}
    for key, value in raw.items():
        text = str(key)
        if not re.fullmatch(key_pattern, text):
            continue
        if value is None:
            result[text] = None
            continue
        minutes = _parse_minutes(value)
        if minutes is not None:
            result[text] = minutes
    return result


def legacy_category_minutes(raw):
    """Nilai kategori lama ({va,nnva,nva} atau angka tunggal) atau None.

    Dipakai HANYA untuk mengekspansi config lama ke map per jenis aktivitas.
    """
    if raw is None:
        return None
    if isinstance(raw, dict):
        present = [k for k in MAX_RECORD_CATEGORIES if raw.get(k) is not None]
        if not present:
            return None
        return {
            key: (_parse_minutes(raw.get(key)) or MAX_RECORD_DEFAULT_MINUTES)
            for key in MAX_RECORD_CATEGORIES
        }
    minutes = _parse_minutes(raw)
    if minutes is None:
        return None
    return {key: minutes for key in MAX_RECORD_CATEGORIES}


def category_of_activitytype(activitytype) -> str:
    value = str(activitytype or "").strip().upper()
    if value == "M1":
        return "va"
    if value == "M2":
        return "nnva"
    return "nva"


def normalize_max_record_minutes(raw) -> dict:
    """Cap per JENIS aktivitas.

    Struktur:
      "max_record_minutes": {
        "mch":       {"1": 300, "2": 150, "12": 30, "20": None},
        "timesheet": {"": 300, "1510": 150, "1670": None}
      }
    - "mch" key = mch_statustypes.statusid, "timesheet" key = activitytype
      ("" = productive/kerja order).
    - nilai = menit (>= 1) atau None = NO LIMIT (tidak pernah dipotong).
    - jenis yang TIDAK ada di map = tanpa cap (No Limit).
    Struktur lama (angka tunggal / {va,nnva,nva}) TIDAK dibuang di sini — lihat
    expand_legacy_into_type_maps yang mengekspansinya lewat katalog DB.
    """
    src = raw if isinstance(raw, dict) else {}
    return {
        "mch": _normalize_type_map(src.get("mch"), r"\d+"),
        "timesheet": _normalize_type_map(src.get("timesheet"), r"\d*"),
    }


def load_activity_catalog(conn) -> dict:
    """Jenis aktivitas dari master DB (mch_statustypes + ews.activity_type_ref)."""
    mch = []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT statusid, activitytype FROM public.mch_statustypes ORDER BY statusid"
        )
        for statusid, activitytype in cur.fetchall():
            mch.append(
                {
                    "statusid": int(statusid),
                    "category": STATUS_CATEGORY_OVERRIDES.get(
                        int(statusid), category_of_activitytype(activitytype)
                    ),
                }
            )
    timesheet = [{"activitytype": "", "category": "va"}]
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT activitytype FROM ews.activity_type_ref ORDER BY activitytype"
            )
            for (activitytype,) in cur.fetchall():
                timesheet.append(
                    {"activitytype": str(activitytype or "").strip(), "category": "nva"}
                )
    except Exception as exc:
        logging.getLogger("sap_staging").warning(
            "load_activity_catalog: ews.activity_type_ref tidak terbaca (%s)", exc
        )
    return {"mch": mch, "timesheet": timesheet}


def expand_legacy_into_type_maps(max_record: dict, legacy, catalog) -> dict:
    """Isi jenis yang belum ada di map dengan nilai kategori lama.

    Idempoten: entry yang sudah ada (termasuk None = No Limit) tidak ditimpa.
    Tanpa ini, config lama ({va,nnva,nva}) akan terbaca sebagai "tidak ada cap"
    dan seluruh record lolos tanpa potongan — perubahan perilaku yang berbahaya.
    """
    if not legacy or not catalog:
        return max_record
    mch = dict(max_record.get("mch") or {})
    timesheet = dict(max_record.get("timesheet") or {})
    for row in catalog.get("mch", []):
        key = str(row["statusid"])
        if key not in mch:
            mch[key] = legacy.get(row["category"], MAX_RECORD_DEFAULT_MINUTES)
    for row in catalog.get("timesheet", []):
        key = str(row.get("activitytype") or "")
        if key not in timesheet:
            timesheet[key] = legacy.get(row["category"], MAX_RECORD_DEFAULT_MINUTES)
    return {"mch": mch, "timesheet": timesheet}


def load_sap_rules(conn) -> dict:
    """Rules SAP dari plant_config.sap_rules (kolom JSONB, diatur dari halaman
    Configuration Rules). Fallback ke default bila baris/kunci belum ada.

    Struktur:
      {
        "break_windows": [ {"start": "12:00", "end": "13:00", "days": [1,2,3,4,5,6,0]}, ... ],
        "max_record_minutes": {"mch": {"1": 300, ...}, "timesheet": {"": 300, ...}},
        "max_record_fallback": {"va": 300, "nnva": 150, "nva": 150} | None
      }
    `days` = DOW Postgres (0=Sunday..6=Saturday). break windows TIDAK dihitung
    dari durasi record PRODUKTIF; max_record_minutes membatasi durasi SATU record
    source PER JENIS aktivitas (statusid untuk MCH, activitytype untuk TIMESHEET;
    None = No Limit). `max_record_fallback` = nilai kategori dari config LAMA,
    dipakai hanya untuk jenis yang tidak ada di map (None kalau config sudah
    per-jenis) — pengaman supaya config lama berperilaku sama persis.
    """
    DEFAULT_RULES = {
        "break_windows": [
            {"start": "12:00", "end": "13:00", "days": [1, 2, 3, 4, 5, 6, 0]},
            {"start": "00:00", "end": "01:00", "days": [1, 2, 3, 4, 5]},
            {"start": "18:30", "end": "19:00", "days": [6, 0]},
            {"start": "22:00", "end": "22:30", "days": [6, 0]},
        ],
        "max_record_minutes": {"mch": {}, "timesheet": {}},
        "max_record_fallback": {
            key: MAX_RECORD_DEFAULT_MINUTES for key in MAX_RECORD_CATEGORIES
        },
    }
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sap_rules FROM public.plant_config WHERE id = 1 LIMIT 1"
            )
            row = cur.fetchone()
        raw = (row[0] if row else None) or {}
        rules = dict(DEFAULT_RULES)
        rules.update({k: v for k, v in raw.items() if v is not None})
        if not isinstance(rules.get("break_windows"), list):
            rules["break_windows"] = list(DEFAULT_RULES["break_windows"])
        raw_max = raw.get("max_record_minutes")
        max_record = normalize_max_record_minutes(raw_max)
        legacy = legacy_category_minutes(raw_max)
        if legacy:
            try:
                max_record = expand_legacy_into_type_maps(
                    max_record, legacy, load_activity_catalog(conn)
                )
            except Exception as exc:
                logging.getLogger("sap_staging").warning(
                    "load_sap_rules: katalog aktivitas gagal dibaca, pakai fallback kategori (%s)",
                    exc,
                )
        rules["max_record_minutes"] = max_record
        rules["max_record_fallback"] = legacy
        return rules
    except Exception as exc:  # plant_config belum ada / tak bisa dibaca -> default aman
        logging.getLogger("sap_staging").warning(
            "load_sap_rules fallback ke default (%s)", exc
        )
        return dict(DEFAULT_RULES)


def load_sap_rules_default() -> dict:
    """Default rules tanpa koneksi DB (dipakai saat load_sap_rules gagal)."""
    return {
        "break_windows": [
            {"start": "12:00", "end": "13:00", "days": [1, 2, 3, 4, 5, 6, 0]},
            {"start": "00:00", "end": "01:00", "days": [1, 2, 3, 4, 5]},
            {"start": "18:30", "end": "19:00", "days": [6, 0]},
            {"start": "22:00", "end": "22:30", "days": [6, 0]},
        ],
        "max_record_minutes": {"mch": {}, "timesheet": {}},
        "max_record_fallback": {
            key: MAX_RECORD_DEFAULT_MINUTES for key in MAX_RECORD_CATEGORIES
        },
    }


def app_timezone() -> str:
    # Configured once in the root .env (TIMEZONE). The default must match the rest of the
    # codebase (apps/api/config/timezone.js) — a divergent default silently shifts day
    # boundaries by an hour between WITA and WIB.
    return env_value("TIMEZONE", "Asia/Makassar")


def ph3_order_table() -> str:
    return env_value("TGT_TABLE", "ph3_order")


def quote_identifier(identifier: str) -> str:
    if not identifier:
        raise ValueError("SQL identifier cannot be empty")
    return '"' + identifier.replace('"', '""') + '"'


def quote_table_name(table_name: str) -> str:
    return ".".join(quote_identifier(part.strip()) for part in table_name.split(".") if part.strip())


DDL = """
CREATE TABLE IF NOT EXISTS sap_timesheet_staging (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ztimesheetid text GENERATED ALWAYS AS (id::text) STORED,

  source_system text NOT NULL,
  source_key text NOT NULL,
  is_correction boolean NOT NULL DEFAULT false,
  source_ref_id text,

  werks text NOT NULL DEFAULT '',
  pernr text NOT NULL DEFAULT '',
  pernr_origin text NOT NULL DEFAULT '',
  rueck text NOT NULL DEFAULT '',
  aufnr text NOT NULL DEFAULT '',
  vornr text NOT NULL DEFAULT '',
  flgat text NOT NULL DEFAULT '',
  plnfl text NOT NULL DEFAULT '',
  vornr_b text NOT NULL DEFAULT '',
  vornr_r text NOT NULL DEFAULT '',
  zconf_type text NOT NULL DEFAULT '',
  arbpl text NOT NULL DEFAULT '',
  lstar text NOT NULL DEFAULT '',
  isdd text NOT NULL DEFAULT '',
  isdz text NOT NULL DEFAULT '',
  iedd text NOT NULL DEFAULT '',
  iedz text NOT NULL DEFAULT '',
  aueru text NOT NULL DEFAULT '',
  zbarcodeid text NOT NULL DEFAULT '',

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  bucket_start timestamp without time zone,
  synthetic_start timestamp without time zone,
  synthetic_end timestamp without time zone,
  total_seconds bigint,

  source_row_count integer NOT NULL DEFAULT 1,
  source_min_start timestamp without time zone,
  source_max_end timestamp without time zone,

  status text NOT NULL DEFAULT 'PENDING',
  sap_response jsonb,
  sap_response_text text,
  sap_error text,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sap_timesheet_staging_source_uk UNIQUE (source_system, source_key),
  CONSTRAINT sap_timesheet_staging_status_ck CHECK (
    status IN ('PENDING', 'POSTING', 'POSTED', 'FAILED', 'SKIPPED')
  ),
  CONSTRAINT sap_timesheet_staging_source_system_ck CHECK (
    source_system IN ('TIMESHEET', 'MCH_HOURS')
  )
);

-- Idempotent upgrade for pre-existing tables (CREATE TABLE IF NOT EXISTS above
-- won't add new columns to a table that already exists).
ALTER TABLE sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS pernr_origin text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS sap_timesheet_staging_status_idx
  ON sap_timesheet_staging (status, created_at);

CREATE INDEX IF NOT EXISTS sap_timesheet_staging_source_idx
  ON sap_timesheet_staging (source_system, source_ref_id);

CREATE INDEX IF NOT EXISTS sap_timesheet_staging_bucket_idx
  ON sap_timesheet_staging (source_system, bucket_start);

CREATE TABLE IF NOT EXISTS sap_stage_cursor (
  source_system text NOT NULL,
  plant text NOT NULL,
  last_processed_at timestamp without time zone NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, plant),
  CONSTRAINT sap_stage_cursor_source_system_ck CHECK (
    source_system IN ('TIMESHEET', 'MCH_HOURS')
  )
);

CREATE TABLE IF NOT EXISTS sap_staging_eligibility_audit (
  source_system text NOT NULL,
  source_key text NOT NULL,
  source_ref_id text,
  source_date date,
  plant text NOT NULL DEFAULT '',
  eligibility_status text NOT NULL,
  block_reason text,
  block_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_key)
);

CREATE INDEX IF NOT EXISTS sap_staging_eligibility_audit_date_idx
  ON sap_staging_eligibility_audit (source_system, source_date, eligibility_status);
"""


STAGING_COLUMNS = [
    "source_system",
    "source_key",
    "is_correction",
    "source_ref_id",
    "werks",
    "pernr",
    "pernr_origin",
    "rueck",
    "aufnr",
    "vornr",
    "flgat",
    "plnfl",
    "vornr_b",
    "vornr_r",
    "zconf_type",
    "arbpl",
    "lstar",
    "isdd",
    "isdz",
    "iedd",
    "iedz",
    "aueru",
    "zbarcodeid",
    "bucket_start",
    "synthetic_start",
    "synthetic_end",
    "total_seconds",
    "source_row_count",
    "source_min_start",
    "source_max_end",
]


PAYLOAD_UPDATE_SQL = """
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
WHERE payload = '{}'::jsonb
  AND source_system = ANY(%s)
  AND source_key = ANY(%s)
"""


def ensure_staging_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()


def get_stage_cursor(conn, source_system: str, plant: str):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT last_processed_at
            FROM sap_stage_cursor
            WHERE source_system = %s
              AND plant = %s
            """,
            (source_system, plant),
        )
        row = cur.fetchone()
    return row[0] if row else None


def update_stage_cursor(conn, source_system: str, plant: str, last_processed_at) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sap_stage_cursor (source_system, plant, last_processed_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (source_system, plant)
            DO UPDATE SET
              last_processed_at = GREATEST(
                sap_stage_cursor.last_processed_at,
                EXCLUDED.last_processed_at
              ),
              updated_at = now()
            """,
            (source_system, plant, last_processed_at),
        )


def cursor_initial_from():
    from datetime import datetime

    raw = env_value("SAP_STAGE_INITIAL_FROM_TS", "2026-01-01T00:00:00")
    return datetime.fromisoformat(raw)


def cursor_overlap_minutes(default: int = 30) -> int:
    return env_int("SAP_STAGE_CURSOR_OVERLAP_MINUTES", default)


def cursor_safety_delay_minutes(default: int = 1) -> int:
    return env_int("SAP_STAGE_SAFETY_DELAY_MINUTES", default)


def insert_staging_rows(conn, rows: list[dict]) -> int:
    if not rows:
        return 0

    values = [
        [row.get(column) if column != "is_correction" else row.get("is_correction", False) for column in STAGING_COLUMNS]
        for row in rows
    ]
    columns_sql = ", ".join(STAGING_COLUMNS)
    # Refresh rows that are still PENDING so corrected source data (e.g. fixed machine-hour
    # durations) flows through on a re-stage. Rows already handed to SAP
    # (POSTING/POSTED/FAILED/SKIPPED) are left frozen. payload is reset to '{}' so the
    # PAYLOAD_UPDATE_SQL pass below rebuilds it from the refreshed columns.
    data_columns = [c for c in STAGING_COLUMNS if c not in ("source_system", "source_key")]
    set_sql = ", ".join(f"{c} = EXCLUDED.{c}" for c in data_columns)
    conflict_sql = (
        "ON CONFLICT (source_system, source_key) DO UPDATE SET "
        f"{set_sql}, payload = '{{}}'::jsonb, updated_at = now() "
        "WHERE sap_timesheet_staging.status = 'PENDING'"
    )

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            f"""
            INSERT INTO sap_timesheet_staging ({columns_sql})
            VALUES %s
            {conflict_sql}
            """,
            values,
            page_size=1000,
        )
        inserted = cur.rowcount

        source_systems = sorted({row["source_system"] for row in rows})
        source_keys = [row["source_key"] for row in rows]
        cur.execute(PAYLOAD_UPDATE_SQL, (source_systems, source_keys))

        insert_provenance(cur, rows)

    conn.commit()
    return max(inserted, 0)


# Provenance (migration 20260714): catat SEGMEN sumber tiap bundel ke
# sap_staging_source. Jangkar identitasnya (source_row_id, bucket_start) —
# tidak berubah walau resep source_key (md5) diubah atau data sumber dikoreksi,
# sehingga guard di post_sap_staging bisa menolak double-post. Baris yang sudah
# ter-POST tidak disentuh (unique index parsial menjaganya di level DB).
PROVENANCE_INSERT_SQL = """
INSERT INTO sap_staging_source (staging_id, source_system, source_row_id, bucket_start, seconds)
VALUES %s
ON CONFLICT (staging_id, source_system, source_row_id, bucket_start) DO UPDATE
  SET seconds = EXCLUDED.seconds
  WHERE sap_staging_source.posted_at IS NULL
"""


def insert_provenance(cur, rows: list[dict]) -> int:
    """Tulis segmen sumber untuk baris yang punya `segments` (MCH_HOURS)."""
    keyed = {
        (row["source_system"], row["source_key"]): row
        for row in rows
        if row.get("segments")
    }
    if not keyed:
        return 0

    # Ambil id staging untuk tiap (source_system, source_key). Dilakukan lewat SELECT
    # (bukan RETURNING) karena ON CONFLICT ... WHERE status='PENDING' tidak mengembalikan
    # baris yang sudah POSTED/FAILED — padahal provenance-nya tetap perlu ada.
    cur.execute(
        """
        SELECT id, source_system, source_key, bucket_start
        FROM sap_timesheet_staging
        WHERE source_system = ANY(%s) AND source_key = ANY(%s)
        """,
        (
            sorted({sys_ for sys_, _ in keyed}),
            [key for _, key in keyed],
        ),
    )
    values = []
    for staging_id, source_system, source_key, bucket_start in cur.fetchall():
        row = keyed.get((source_system, source_key))
        if not row:
            continue
        for seg in row["segments"]:
            seconds = int(seg.get("sec") or 0)
            if seconds <= 0:
                continue
            values.append((staging_id, source_system, str(seg["id"]), bucket_start, seconds))

    if not values:
        return 0
    psycopg2.extras.execute_values(cur, PROVENANCE_INSERT_SQL, values, page_size=1000)
    return len(values)


def upsert_eligibility_audit(conn, rows: list[dict]) -> int:
    if not rows:
        return 0

    columns = [
        "source_system",
        "source_key",
        "source_ref_id",
        "source_date",
        "plant",
        "eligibility_status",
        "block_reason",
        "block_detail",
    ]
    values = [[row.get(column) for column in columns] for row in rows]
    columns_sql = ", ".join(columns)

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            f"""
            INSERT INTO sap_staging_eligibility_audit ({columns_sql})
            VALUES %s
            ON CONFLICT (source_system, source_key)
            DO UPDATE SET
              source_ref_id = EXCLUDED.source_ref_id,
              source_date = EXCLUDED.source_date,
              plant = EXCLUDED.plant,
              eligibility_status = EXCLUDED.eligibility_status,
              block_reason = EXCLUDED.block_reason,
              block_detail = EXCLUDED.block_detail,
              observed_at = now(),
              updated_at = now()
            """,
            values,
            template="(%s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
            page_size=1000,
        )
        count = cur.rowcount

    conn.commit()
    return max(count, 0)


def parse_csv_ints(value: str | None) -> list[int]:
    if not value:
        return []
    return [int(part.strip()) for part in value.split(",") if part.strip()]


def sap_credentials() -> tuple[str, str, str]:
    return (
        env_value("SAP_INBOUND_URL"),
        env_value("SAP_INBOUND_USERNAME"),
        env_value("SAP_INBOUND_PASSWORD"),
    )


def as_json(value) -> dict | list | str | int | float | bool | None:
    if value is None:
        return None
    if isinstance(value, (dict, list, str, int, float, bool)):
        return value
    return json.loads(json.dumps(value, default=str))


def mark_local_timesheet_rejected(tsnumbers: Iterable[str | int], sap_message: str) -> None:
    ids = [int(value) for value in tsnumbers if str(value).strip().isdigit()]
    if not ids:
        return
    with connect_source() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE timesheet_transaction
                SET state_flag = 3,
                    validation_date = NULL
                WHERE tsnumber = ANY(%s::int[])
                """,
                (ids,),
            )
        conn.commit()
