import logging
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

log = logging.getLogger("tts_announcement")

GAP_AFTER_HEADER_MS = 100
GAP_BEFORE_FOOTER_MS = 500
MAX_SSBR_ID_LENGTH = 64

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ROOT_DIR = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parents[1] if len(BASE_DIR.parents) > 1 else BASE_DIR,
)
ROOT_DIR = Path(os.getenv("PROJECT_ROOT", DEFAULT_ROOT_DIR))
TTS_SERVICE_DIR = Path(os.getenv("TTS_SERVICE_DIR", ROOT_DIR / "apps" / "tts-worker"))
DEFAULT_HEADER_FILE = TTS_SERVICE_DIR / "header.mp3"
DEFAULT_FOOTER_FILE = TTS_SERVICE_DIR / "footer.mp3"
PIPER_BIN = os.getenv("PIPER_BIN", "piper")
PIPER_MODEL_PATH = Path(os.getenv("PIPER_MODEL_PATH", TTS_SERVICE_DIR / "models" / "id_ID.onnx"))
PIPER_CONFIG_PATH = Path(
    os.getenv("PIPER_CONFIG_PATH", TTS_SERVICE_DIR / "models" / "id_ID.onnx.json")
)
PIPER_TIMEOUT_SECONDS = int(os.getenv("PIPER_TIMEOUT_SECONDS", "30"))


class TtsGenerationError(RuntimeError):
    def __init__(
        self, public_detail: str, technical_detail: str | None = None, status_code: int = 500
    ):
        super().__init__(technical_detail or public_detail)
        self.public_detail = public_detail
        self.technical_detail = technical_detail or public_detail
        self.status_code = status_code


def spaced_ssbr_id(ssbr_id: str) -> str:
    cleaned = "".join(str(ssbr_id or "").split())
    return " ".join(cleaned)


def validate_ssbr_id(ssbr_id: str) -> str:
    cleaned = str(ssbr_id or "").strip()
    if not cleaned:
        raise TtsGenerationError("ssbr_id wajib diisi", status_code=400)
    if len(cleaned) > MAX_SSBR_ID_LENGTH:
        raise TtsGenerationError(f"ssbr_id maksimal {MAX_SSBR_ID_LENGTH} karakter", status_code=400)
    return cleaned


def make_announcement_text(ssbr_id: str) -> str:
    spaced = spaced_ssbr_id(ssbr_id)
    return f"Perhatian. Order dengan nomor Aiden {spaced}. Mohon segera dipindahkan ke mesin selanjutnya."


def safe_filename_part(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or "").strip())
    return safe.strip("_") or "order"


def make_announcement_filename(ssbr_id: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    suffix = uuid.uuid4().hex[:10]
    return f"announcement_{safe_filename_part(ssbr_id)}_{stamp}_{suffix}.mp3"


def ensure_audio_tooling_available() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if not shutil.which(tool)]
    if missing:
        raise TtsGenerationError(
            "Gagal generate audio. Cek log server.",
            "Audio merge membutuhkan ffmpeg/ffprobe. "
            f"Tidak ditemukan di PATH: {', '.join(missing)}",
        )


def ensure_piper_available() -> str:
    piper_bin = shutil.which(PIPER_BIN)
    if not piper_bin:
        raise TtsGenerationError(
            "Gagal generate audio dengan Piper. Cek log server.",
            f"Piper binary tidak ditemukan di PATH: {PIPER_BIN}",
        )
    return piper_bin


def ensure_piper_model_available() -> None:
    missing = [str(path) for path in (PIPER_MODEL_PATH, PIPER_CONFIG_PATH) if not path.exists()]
    if missing:
        raise TtsGenerationError(
            "Model Piper belum tersedia. Cek log server.",
            f"File model/config Piper tidak ditemukan: {', '.join(missing)}",
        )


def generate_body_audio_with_piper(text: str, output_path: str | Path) -> dict:
    piper_bin = ensure_piper_available()
    ensure_piper_model_available()

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        piper_bin,
        "--model",
        str(PIPER_MODEL_PATH),
        "--config",
        str(PIPER_CONFIG_PATH),
        "--output_file",
        str(output),
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
        raise TtsGenerationError(
            "Generate audio timeout. Cek log server.",
            f"Piper timeout setelah {PIPER_TIMEOUT_SECONDS} detik",
        ) from exc

    if result.returncode != 0:
        log.error(
            "Piper failed. returncode=%s model=%s config=%s output=%s text_length=%s stdout=%s stderr=%s",
            result.returncode,
            PIPER_MODEL_PATH,
            PIPER_CONFIG_PATH,
            output,
            len(text),
            result.stdout,
            result.stderr,
        )
        raise TtsGenerationError(
            "Gagal generate audio dengan Piper. Cek log server.",
            f"Piper returncode={result.returncode}",
        )

    if not output.exists() or output.stat().st_size <= 0:
        log.error(
            "Piper produced empty output. model=%s config=%s output=%s text_length=%s stdout=%s stderr=%s",
            PIPER_MODEL_PATH,
            PIPER_CONFIG_PATH,
            output,
            len(text),
            result.stdout,
            result.stderr,
        )
        raise TtsGenerationError(
            "Gagal generate audio dengan Piper. Cek log server.",
            "Piper menghasilkan file output kosong",
        )

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


def merge_announcement_audio(
    body_path: str | Path,
    output_path: str | Path,
    header_path: str | Path = DEFAULT_HEADER_FILE,
    footer_path: str | Path = DEFAULT_FOOTER_FILE,
    gap_after_header_ms: int = GAP_AFTER_HEADER_MS,
    gap_before_footer_ms: int = GAP_BEFORE_FOOTER_MS,
) -> dict:
    body = Path(body_path)
    output = Path(output_path)
    header = Path(header_path)
    footer = Path(footer_path)

    missing = [str(path) for path in (header, body, footer) if not path.exists()]
    if missing:
        raise TtsGenerationError(
            "Gagal merge audio. Cek log server.",
            f"Audio source tidak ditemukan: {', '.join(missing)}",
        )

    ensure_audio_tooling_available()
    from pydub import AudioSegment

    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        header_audio = AudioSegment.from_file(header)
    except Exception as exc:
        raise TtsGenerationError(
            "Gagal merge audio. Cek log server.",
            f"Gagal decode header audio {header}: {exc}",
        ) from exc

    try:
        body_audio = AudioSegment.from_file(body)
    except Exception as exc:
        raise TtsGenerationError(
            "Gagal merge audio. Cek log server.",
            f"Gagal decode generated body audio {body}: {exc}",
        ) from exc

    try:
        footer_audio = AudioSegment.from_file(footer)
    except Exception as exc:
        raise TtsGenerationError(
            "Gagal merge audio. Cek log server.",
            f"Gagal decode footer audio {footer}: {exc}",
        ) from exc

    final_audio = (
        header_audio
        + AudioSegment.silent(duration=gap_after_header_ms)
        + body_audio
        + AudioSegment.silent(duration=gap_before_footer_ms)
        + footer_audio
    )
    try:
        final_audio.export(output, format="mp3")
    except Exception as exc:
        raise TtsGenerationError(
            "Gagal export audio final. Cek log server.",
            f"Gagal export final MP3 {output}: {exc}",
        ) from exc

    return {
        "header_file": str(header),
        "footer_file": str(footer),
        "body_file": str(body),
        "gap_after_header_ms": gap_after_header_ms,
        "gap_before_footer_ms": gap_before_footer_ms,
        "duration_ms": len(final_audio),
        "merged": True,
    }


def generate_announcement_mp3(
    ssbr_id: str,
    output_path: str | Path,
) -> dict:
    ssbr_id = validate_ssbr_id(ssbr_id)
    text = make_announcement_text(ssbr_id)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_body_path = None
    piper_log = {}

    try:
        with tempfile.NamedTemporaryFile(
            prefix=f"announcement_body_{safe_filename_part(ssbr_id)}_",
            suffix=".wav",
            delete=False,
            dir=output.parent,
        ) as temp_body:
            temp_body_path = Path(temp_body.name)

        piper_log = generate_body_audio_with_piper(text, temp_body_path)
        merge_log = merge_announcement_audio(temp_body_path, output)
    except TtsGenerationError:
        raise
    except Exception as exc:
        log.exception(
            "Unexpected TTS generation error. ssbr_id=%s output=%s text_length=%s",
            ssbr_id,
            output,
            len(text),
        )
        raise TtsGenerationError("Gagal generate audio. Cek log server.", str(exc)) from exc
    finally:
        if temp_body_path and temp_body_path.exists():
            try:
                temp_body_path.unlink()
            except OSError:
                pass

    return {
        "ssbr_id": ssbr_id,
        "ssbr_id_spaced": spaced_ssbr_id(ssbr_id),
        "text": text,
        "file": str(output),
        **piper_log,
        **merge_log,
    }
