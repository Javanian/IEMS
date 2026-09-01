import argparse
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(ROOT_DIR / ".env")
load_dotenv(BASE_DIR / ".env", override=True)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("tts_worker")

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "dbname": os.getenv("DB_NAME", "ptssb"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
}

TTS_UPLOAD_ROOT = Path(os.getenv("TTS_UPLOAD_ROOT", ROOT_DIR / "apps" / "api" / "uploads"))
ANNOUNCEMENT_DIR = TTS_UPLOAD_ROOT / "announcement"
PUBLIC_ANNOUNCEMENT_PREFIX = "/uploads/announcement"

TTS_SERVICE_DIR = Path(os.getenv("TTS_SERVICE_DIR", BASE_DIR))
HEADER_FILE = TTS_SERVICE_DIR / "header.mp3"
FOOTER_FILE = TTS_SERVICE_DIR / "footer.mp3"

PIPER_BIN = os.getenv("PIPER_BIN", "piper")
PIPER_MODEL_PATH = Path(os.getenv("PIPER_MODEL_PATH", TTS_SERVICE_DIR / "models" / "id_ID.onnx"))
PIPER_CONFIG_PATH = Path(
    os.getenv("PIPER_CONFIG_PATH", TTS_SERVICE_DIR / "models" / "id_ID.onnx.json")
)
PIPER_TIMEOUT_SECONDS = int(os.getenv("PIPER_TIMEOUT_SECONDS", "30"))

POLL_INTERVAL_SECONDS = float(os.getenv("TTS_WORKER_POLL_SECONDS", "3"))
STUCK_PROCESSING_SECONDS = int(os.getenv("TTS_WORKER_STUCK_SECONDS", "120"))
MAX_ATTEMPTS = int(os.getenv("TTS_WORKER_MAX_ATTEMPTS", "3"))
MAX_SSBR_ID_LENGTH = 64
GAP_AFTER_HEADER_MS = 400
GAP_BEFORE_FOOTER_MS = 500


class TtsWorkerError(RuntimeError):
    pass


def connect_db():
    return psycopg2.connect(**DB_CONFIG)


def ensure_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.tts_notification_order (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                path_mp3 TEXT NULL,
                ssbr_id TEXT,
                status BOOLEAN NOT NULL DEFAULT false,
                generation_status TEXT NOT NULL DEFAULT 'queued',
                error_message TEXT,
                attempts INT NOT NULL DEFAULT 0,
                log_audio JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                generated_at TIMESTAMPTZ
            )
            """)
        cur.execute("ALTER TABLE public.tts_notification_order ALTER COLUMN path_mp3 DROP NOT NULL")
        cur.execute(
            "ALTER TABLE public.tts_notification_order ADD COLUMN IF NOT EXISTS ssbr_id TEXT"
        )
        cur.execute(
            "ALTER TABLE public.tts_notification_order "
            "ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'queued'"
        )
        cur.execute(
            "ALTER TABLE public.tts_notification_order ADD COLUMN IF NOT EXISTS error_message TEXT"
        )
        cur.execute(
            "ALTER TABLE public.tts_notification_order ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0"
        )
        cur.execute(
            "ALTER TABLE public.tts_notification_order ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ"
        )
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_tts_notification_order_generation_status_created
            ON public.tts_notification_order (generation_status, created_at)
            """)
        cur.execute("""
            UPDATE public.tts_notification_order
            SET generation_status = 'ready'
            WHERE path_mp3 IS NOT NULL
              AND generation_status = 'queued'
            """)
    conn.commit()


def recover_stuck_jobs(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET generation_status = CASE
                    WHEN attempts >= %s THEN 'error'
                    ELSE 'queued'
                END,
                error_message = CASE
                    WHEN attempts >= %s THEN 'worker timeout'
                    ELSE NULL
                END,
                updated_at = now()
            WHERE generation_status = 'processing'
              AND updated_at < now() - make_interval(secs => %s)
            RETURNING id, generation_status, attempts
            """,
            (MAX_ATTEMPTS, MAX_ATTEMPTS, STUCK_PROCESSING_SECONDS),
        )
        rows = cur.fetchall()
    conn.commit()
    for row in rows:
        log.warning("Recovered stuck job id=%s status=%s attempts=%s", row[0], row[1], row[2])


def claim_job(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, ssbr_id, attempts
            FROM public.tts_notification_order
            WHERE generation_status = 'queued'
              AND COALESCE(ssbr_id, '') <> ''
              AND attempts < %s
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """,
            (MAX_ATTEMPTS,),
        )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None

        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET generation_status = 'processing',
                attempts = attempts + 1,
                error_message = NULL,
                updated_at = now()
            WHERE id = %s
            RETURNING id, ssbr_id, attempts
            """,
            (row[0],),
        )
        claimed = cur.fetchone()
    conn.commit()
    return {"id": claimed[0], "ssbr_id": claimed[1], "attempts": claimed[2]}


def spaced_ssbr_id(ssbr_id: str) -> str:
    cleaned = "".join(str(ssbr_id or "").split())
    return " ".join(cleaned)


def validate_ssbr_id(ssbr_id: str) -> str:
    cleaned = str(ssbr_id or "").strip()
    if not cleaned:
        raise TtsWorkerError("ssbr_id wajib diisi")
    if len(cleaned) > MAX_SSBR_ID_LENGTH:
        raise TtsWorkerError(f"ssbr_id maksimal {MAX_SSBR_ID_LENGTH} karakter")
    return cleaned


def make_text(ssbr_id: str) -> str:
    return f"Perhatian. Order dengan nomor Aiden, {spaced_ssbr_id(ssbr_id)}. Mohon segera dipindahkan ke mesin selanjutnya."


def safe_filename_part(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or "").strip())
    return safe.strip("_") or "order"


def make_output_filename(ssbr_id: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    return f"{safe_filename_part(ssbr_id)}_{stamp}_{uuid.uuid4().hex[:10]}.mp3"


def ensure_tooling() -> str:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if not shutil.which(tool)]
    if missing:
        raise TtsWorkerError(f"ffmpeg/ffprobe tidak ditemukan di PATH: {', '.join(missing)}")

    piper_bin = shutil.which(PIPER_BIN)
    if not piper_bin:
        raise TtsWorkerError(f"Piper binary tidak ditemukan di PATH: {PIPER_BIN}")

    missing_files = [
        str(path)
        for path in (PIPER_MODEL_PATH, PIPER_CONFIG_PATH, HEADER_FILE, FOOTER_FILE)
        if not path.exists()
    ]
    if missing_files:
        raise TtsWorkerError(f"File TTS tidak ditemukan: {', '.join(missing_files)}")

    return piper_bin


def generate_body_wav(text: str, output_path: Path) -> dict:
    piper_bin = ensure_tooling()
    cmd = [
        piper_bin,
        "--model",
        str(PIPER_MODEL_PATH),
        "--config",
        str(PIPER_CONFIG_PATH),
        "--output_file",
        str(output_path),
    ]

    try:
        result = subprocess.run(
            cmd,
            input=text,
            text=True,
            capture_output=True,
            timeout=PIPER_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        log.error(
            "Piper timeout after %ss. model=%s config=%s text_length=%s stdout=%r stderr=%r",
            PIPER_TIMEOUT_SECONDS,
            PIPER_MODEL_PATH,
            PIPER_CONFIG_PATH,
            len(text),
            exc.stdout,
            exc.stderr,
        )
        raise TtsWorkerError(f"Piper timeout setelah {PIPER_TIMEOUT_SECONDS} detik") from exc

    if result.returncode != 0:
        log.error(
            "Piper failed. returncode=%s model=%s config=%s output=%s text_length=%s stdout=%s stderr=%s",
            result.returncode,
            PIPER_MODEL_PATH,
            PIPER_CONFIG_PATH,
            output_path,
            len(text),
            result.stdout,
            result.stderr,
        )
        raise TtsWorkerError(f"Piper returncode={result.returncode}")

    if not output_path.exists() or output_path.stat().st_size <= 0:
        log.error(
            "Piper produced empty output. model=%s config=%s output=%s text_length=%s stdout=%s stderr=%s",
            PIPER_MODEL_PATH,
            PIPER_CONFIG_PATH,
            output_path,
            len(text),
            result.stdout,
            result.stderr,
        )
        raise TtsWorkerError("Piper menghasilkan file output kosong")

    if result.stderr:
        log.info("Piper stderr: %s", result.stderr)

    return {
        "tts_engine": "piper",
        "piper_bin": piper_bin,
        "model_path": str(PIPER_MODEL_PATH),
        "config_path": str(PIPER_CONFIG_PATH),
        "body_format": "wav",
        "piper_timeout_seconds": PIPER_TIMEOUT_SECONDS,
    }


def merge_audio(body_path: Path, output_path: Path) -> dict:
    from pydub import AudioSegment

    try:
        header_audio = AudioSegment.from_file(HEADER_FILE)
        body_audio = AudioSegment.from_file(body_path)
        footer_audio = AudioSegment.from_file(FOOTER_FILE)
    except Exception as exc:
        raise TtsWorkerError(f"Gagal decode source audio: {exc}") from exc

    final_audio = (
        header_audio
        + AudioSegment.silent(duration=GAP_AFTER_HEADER_MS)
        + body_audio
        + AudioSegment.silent(duration=GAP_BEFORE_FOOTER_MS)
        + footer_audio
    )

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        final_audio.export(output_path, format="mp3")
    except Exception as exc:
        raise TtsWorkerError(f"Gagal export final MP3 {output_path}: {exc}") from exc

    return {
        "header_file": str(HEADER_FILE),
        "footer_file": str(FOOTER_FILE),
        "body_file": str(body_path),
        "gap_after_header_ms": GAP_AFTER_HEADER_MS,
        "gap_before_footer_ms": GAP_BEFORE_FOOTER_MS,
        "duration_ms": len(final_audio),
        "merged": True,
    }


def update_job_ready(conn, job_id: int, path_mp3: str, log_audio: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET generation_status = 'ready',
                path_mp3 = %s,
                log_audio = %s,
                error_message = NULL,
                generated_at = now(),
                updated_at = now()
            WHERE id = %s
            """,
            (path_mp3, psycopg2.extras.Json(log_audio), job_id),
        )
    conn.commit()


def update_job_error(conn, job_id: int, message: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET generation_status = 'error',
                error_message = %s,
                updated_at = now()
            WHERE id = %s
            """,
            (message[:1000], job_id),
        )
    conn.commit()


def process_job(conn, job: dict) -> None:
    ssbr_id = validate_ssbr_id(job["ssbr_id"])
    text = make_text(ssbr_id)
    output_filename = make_output_filename(ssbr_id)
    output_path = ANNOUNCEMENT_DIR / output_filename
    public_path = f"{PUBLIC_ANNOUNCEMENT_PREFIX}/{output_filename}"
    temp_body_path = None

    try:
        ANNOUNCEMENT_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix=f"announcement_body_{safe_filename_part(ssbr_id)}_",
            suffix=".wav",
            delete=False,
            dir=ANNOUNCEMENT_DIR,
        ) as temp_body:
            temp_body_path = Path(temp_body.name)

        piper_log = generate_body_wav(text, temp_body_path)
        merge_log = merge_audio(temp_body_path, output_path)
        log_audio = {
            "ssbr_id": ssbr_id,
            "ssbr_id_spaced": spaced_ssbr_id(ssbr_id),
            "text": text,
            "file": str(output_path),
            "path_mp3": public_path,
            **piper_log,
            **merge_log,
        }
        update_job_ready(conn, job["id"], public_path, log_audio)
        log.info("Generated TTS job id=%s ssbr_id=%s path=%s", job["id"], ssbr_id, public_path)
    except Exception as exc:
        if output_path.exists():
            try:
                output_path.unlink()
            except OSError:
                pass
        log.exception("Failed TTS job id=%s ssbr_id=%s: %s", job["id"], job.get("ssbr_id"), exc)
        update_job_error(conn, job["id"], str(exc))
    finally:
        if temp_body_path and temp_body_path.exists():
            try:
                temp_body_path.unlink()
            except OSError:
                pass


def run_once(conn) -> bool:
    recover_stuck_jobs(conn)
    job = claim_job(conn)
    if not job:
        return False
    process_job(conn, job)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate pending TTS announcement audio")
    parser.add_argument("--once", action="store_true", help="Process one available job then exit")
    args = parser.parse_args()

    log.info(
        "Starting TTS worker. poll=%ss stuck=%ss max_attempts=%s",
        POLL_INTERVAL_SECONDS,
        STUCK_PROCESSING_SECONDS,
        MAX_ATTEMPTS,
    )
    conn = connect_db()
    try:
        ensure_table(conn)
        while True:
            processed = run_once(conn)
            if args.once:
                break
            if not processed:
                time.sleep(POLL_INTERVAL_SECONDS)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
