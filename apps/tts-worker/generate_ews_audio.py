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

from speech_normalize import normalize_for_speech

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
log = logging.getLogger("ews_tts_worker")

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "dbname": os.getenv("DB_NAME", "ptssb"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
    "application_name": "mps2-ews-tts-worker",
}

TTS_UPLOAD_ROOT = Path(os.getenv("TTS_UPLOAD_ROOT", ROOT_DIR / "apps" / "api" / "uploads"))
EWS_TTS_DIR = TTS_UPLOAD_ROOT / "ews-tts"
PUBLIC_EWS_TTS_PREFIX = "/uploads/ews-tts"


TTS_SERVICE_DIR = Path(os.getenv("TTS_SERVICE_DIR", BASE_DIR))
PIPER_BIN = os.getenv("PIPER_BIN", "piper")
PIPER_MODEL_PATH = Path(os.getenv("PIPER_MODEL_PATH", TTS_SERVICE_DIR / "models" / "id_ID.onnx"))
PIPER_CONFIG_PATH = Path(
    os.getenv("PIPER_CONFIG_PATH", TTS_SERVICE_DIR / "models" / "id_ID.onnx.json")
)
PIPER_TIMEOUT_SECONDS = int(os.getenv("PIPER_TIMEOUT_SECONDS", "30"))

POLL_INTERVAL_SECONDS = float(os.getenv("EWS_TTS_POLL_SECONDS", "3"))
STUCK_PROCESSING_SECONDS = int(os.getenv("EWS_TTS_STUCK_SECONDS", "120"))
MAX_ATTEMPTS = int(os.getenv("EWS_TTS_MAX_ATTEMPTS", "3"))


class TtsWorkerError(RuntimeError):
    pass


def connect_db():
    return psycopg2.connect(**DB_CONFIG)


def recover_stuck_jobs(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ews.tts_notification
            SET generation_status = CASE WHEN attempts >= %s THEN 'error' ELSE 'queued' END,
                error_message = CASE WHEN attempts >= %s THEN 'worker timeout' ELSE NULL END,
                updated_at = now()
            WHERE generation_status = 'processing'
              AND updated_at < now() - make_interval(secs => %s)
            """,
            (MAX_ATTEMPTS, MAX_ATTEMPTS, STUCK_PROCESSING_SECONDS),
        )
    conn.commit()


def claim_job(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, message, attempts
            FROM ews.tts_notification
            WHERE generation_status = 'queued'
              AND COALESCE(message, '') <> ''
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
            UPDATE ews.tts_notification
            SET generation_status = 'processing', attempts = attempts + 1,
                error_message = NULL, updated_at = now()
            WHERE id = %s
            RETURNING id, message, attempts
            """,
            (row[0],),
        )
        claimed = cur.fetchone()
    conn.commit()
    return {"id": claimed[0], "message": claimed[1], "attempts": claimed[2]}


def make_output_filename(job_id: int) -> str:
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    return f"ews_{job_id}_{stamp}_{uuid.uuid4().hex[:8]}.mp3"


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def generate_mp3(text: str, output_path: Path) -> dict:
    return generate_mp3_piper(text, output_path)


def generate_mp3_piper(text: str, output_path: Path) -> dict:
    if not shutil.which("ffmpeg"):
        raise TtsWorkerError("ffmpeg tidak ditemukan di PATH")
    piper_bin = shutil.which(PIPER_BIN)
    if not piper_bin:
        raise TtsWorkerError(f"Piper binary tidak ditemukan di PATH: {PIPER_BIN}")
    missing = [str(p) for p in (PIPER_MODEL_PATH, PIPER_CONFIG_PATH) if not p.exists()]
    if missing:
        raise TtsWorkerError(f"File model tidak ditemukan: {', '.join(missing)}")
    with tempfile.NamedTemporaryFile(
        prefix="ews_body_", suffix=".wav", delete=False, dir=output_path.parent
    ) as tmp:
        wav_path = Path(tmp.name)
    try:
        cmd = [
            piper_bin,
            "--model",
            str(PIPER_MODEL_PATH),
            "--config",
            str(PIPER_CONFIG_PATH),
            "--output_file",
            str(wav_path),
        ]
        result = subprocess.run(
            cmd,
            input=text,
            text=True,
            capture_output=True,
            timeout=PIPER_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            raise TtsWorkerError(
                f"Piper returncode={result.returncode} stderr={result.stderr[:300]}"
            )
        if not wav_path.exists() or wav_path.stat().st_size <= 0:
            raise TtsWorkerError("Piper menghasilkan file kosong")
        from pydub import AudioSegment

        AudioSegment.from_file(wav_path).export(output_path, format="mp3")
    finally:
        if wav_path.exists():
            try:
                wav_path.unlink()
            except OSError:
                pass
    return {
        "tts_engine": "piper",
        "model_path": str(PIPER_MODEL_PATH),
        "text": text,
        "generated_at": datetime.now().isoformat(),
    }


def process_job(conn, job: dict) -> None:

    text = normalize_for_speech(clean_text(job["message"]))
    if not text:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE ews.tts_notification SET generation_status='error', error_message='message kosong', updated_at=now() WHERE id=%s",
                (job["id"],),
            )
        conn.commit()
        return

    output_filename = make_output_filename(job["id"])
    output_path = EWS_TTS_DIR / output_filename
    public_path = f"{PUBLIC_EWS_TTS_PREFIX}/{output_filename}"
    try:
        EWS_TTS_DIR.mkdir(parents=True, exist_ok=True)
        log_audio = generate_mp3(text, output_path)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ews.tts_notification
                SET generation_status='ready', path_mp3=%s, log_audio=%s,
                    error_message=NULL, generated_at=now(), updated_at=now()
                WHERE id=%s
                """,
                (public_path, psycopg2.extras.Json(log_audio), job["id"]),
            )
        conn.commit()
        log.info("Generated EWS TTS job id=%s path=%s", job["id"], public_path)
    except Exception as exc:
        if output_path.exists():
            try:
                output_path.unlink()
            except OSError:
                pass
        log.exception("Failed EWS TTS job id=%s: %s", job["id"], exc)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE ews.tts_notification SET generation_status='error', error_message=%s, updated_at=now() WHERE id=%s",
                (str(exc)[:1000], job["id"]),
            )
        conn.commit()


def run_once(conn) -> bool:
    recover_stuck_jobs(conn)
    job = claim_job(conn)
    if not job:
        return False
    process_job(conn, job)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate EWS issue-log TTS audio")
    parser.add_argument("--once", action="store_true", help="Process one job then exit")
    args = parser.parse_args()

    voice_info = f"piper:{PIPER_MODEL_PATH}"
    log.info("Starting EWS TTS worker. poll=%ss engine=%s", POLL_INTERVAL_SECONDS, voice_info)
    conn = connect_db()
    try:
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
