import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

from speech_normalize import normalize_for_speech

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = next(
    (p for p in [BASE_DIR, *BASE_DIR.parents] if (p / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(ROOT_DIR / ".env")


KPI_LABEL_ID = {
    "uptime_tablet": "Uptime Tablet",
    "uptime_hmi": "Uptime HMI",
    "accuracy_labour": "Akurasi Labour",
    "accuracy_machine": "Akurasi Mesin",
    "adoption_labour": "Adopsi Labour",
    "adoption_machine": "Adopsi Mesin",
    "oee": "O E E",
    "ole": "O L E",
}


def build_message(kpi_type: str, severity: str, description: str, pic: str | None = None) -> str:

    kpi_name = KPI_LABEL_ID.get(kpi_type, kpi_type or "Indikator")
    severity_word = "kritis" if str(severity or "").lower() == "critical" else "perlu diperhatikan"
    parts = ["Perhatian.", f"Indikator {kpi_name} berstatus {severity_word}."]
    if description:
        parts.append(f"{description}.")
    if pic:
        parts.append(f"Mohon ditindaklanjuti oleh {pic}.")
    msg = " ".join(parts)
    msg = re.sub(r"\.\.+", ".", msg)
    msg = re.sub(r"\s+", " ", msg).strip()
    return msg


def slug(text: str, maxlen: int = 28) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", str(text or "")).strip("_")
    return (s[:maxlen] or "item").lower()


def fetch_issues(cur, critical_only: bool):
    sev = "AND severity = 'critical'" if critical_only else ""
    cur.execute(f"""
        SELECT category, severity, entity_name, description
        FROM ews.issue_log
        WHERE business_date = current_date AND status = 'open' {sev}
        ORDER BY (severity = 'critical') DESC, category, entity_name
        """)
    out = []
    for cat, sever, name, desc in cur.fetchall():
        out.append(
            {
                "kpi_type": cat,
                "severity": sever,
                "entity": name,
                "message": build_message(cat, sever, desc),
            }
        )
    return out


def fetch_notifications(cur, critical_only: bool):
    sev = "AND severity = 'Critical'" if critical_only else ""
    cur.execute(f"""
        SELECT kpi_type, severity, title, message
        FROM ews.tts_notification
        WHERE created_at::date = current_date AND COALESCE(message,'') <> '' {sev}
        ORDER BY id
        """)
    out = []
    for cat, sever, title, message in cur.fetchall():
        out.append(
            {
                "kpi_type": cat,
                "severity": sever,
                "entity": title,
                "message": message,
            }
        )
    return out


def synth(text: str, out_path: Path) -> None:

    piper_bin = shutil.which(os.getenv("PIPER_BIN", "piper"))
    if not piper_bin:
        raise RuntimeError(
            "Piper binary tidak ditemukan di PATH — pip install piper-tts atau unduh binary piper"
        )
    model = Path(os.getenv("PIPER_MODEL_PATH", BASE_DIR / "models" / "id_ID.onnx"))
    config = Path(os.getenv("PIPER_CONFIG_PATH", BASE_DIR / "models" / "id_ID.onnx.json"))
    missing = [str(p) for p in (model, config) if not p.exists()]
    if missing:
        raise RuntimeError(f"Model Piper tidak ditemukan: {', '.join(missing)}")
    with tempfile.NamedTemporaryFile(prefix="ews_preview_", suffix=".wav", delete=False) as tmp:
        wav_path = Path(tmp.name)
    try:
        result = subprocess.run(
            [
                piper_bin,
                "--model",
                str(model),
                "--config",
                str(config),
                "--output_file",
                str(wav_path),
            ],
            input=text,
            text=True,
            capture_output=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Piper returncode={result.returncode} stderr={result.stderr[:300]}")
        if not wav_path.exists() or wav_path.stat().st_size <= 0:
            raise RuntimeError("Piper menghasilkan file kosong")
        from pydub import AudioSegment

        AudioSegment.from_file(wav_path).export(out_path, format="mp3")
    finally:
        if wav_path.exists():
            try:
                wav_path.unlink()
            except OSError:
                pass


def main() -> None:
    ap = argparse.ArgumentParser(description="Preview EWS issue-log TTS locally")
    ap.add_argument("--host", default=os.getenv("DB_HOST", "127.0.0.1"))
    ap.add_argument("--port", default=os.getenv("DB_PORT", "5434"))
    ap.add_argument("--user", default=os.getenv("DB_USER", "tag"))
    ap.add_argument("--password", default=os.getenv("DB_PASSWORD", ""))
    ap.add_argument("--dbname", default=os.getenv("DB_NAME", "ptssb"))
    ap.add_argument(
        "--source",
        choices=["issue", "notification"],
        default="issue",
        help="issue = susun ulang dari ews.issue_log (default); notification = teks persis yang diantrikan server",
    )
    ap.add_argument(
        "--critical-only",
        action="store_true",
        help="Hanya isu critical (perilaku produksi saat ini)",
    )
    ap.add_argument("--out", default=str(BASE_DIR / "ews_tts_preview"))
    ap.add_argument(
        "--no-briefing", action="store_true", help="Jangan buat file gabungan _briefing_all.mp3"
    )
    ap.add_argument(
        "--no-individual", action="store_true", help="Jangan buat MP3 per-isu (briefing saja)"
    )
    ap.add_argument(
        "--no-normalize",
        action="store_true",
        help="Suarakan teks apa adanya (campur Inggris) untuk perbandingan",
    )
    ap.add_argument("--limit", type=int, default=0, help="Batasi jumlah isu (0 = semua)")
    args = ap.parse_args()

    import psycopg2

    conn = psycopg2.connect(
        host=args.host,
        port=int(args.port),
        user=args.user,
        password=args.password,
        dbname=args.dbname,
        application_name="mps2-ews-tts-preview",
    )
    with conn, conn.cursor() as cur:
        items = (
            fetch_notifications(cur, args.critical_only)
            if args.source == "notification"
            else fetch_issues(cur, args.critical_only)
        )
    conn.close()

    if args.limit and len(items) > args.limit:
        items = items[: args.limit]

    if not items:
        print("Tidak ada isu untuk hari ini (mungkin belum ada snapshot / semua sudah resolved).")
        return

    if not args.no_normalize:
        for it in items:
            it["message"] = normalize_for_speech(it["message"])

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for old in out_dir.glob("*.mp3"):
        try:
            old.unlink()
        except OSError:
            pass

    print(
        f"{len(items)} isu | source={args.source} | piper:{os.getenv('PIPER_MODEL_PATH', BASE_DIR / 'models' / 'id_ID.onnx')}"
    )
    print(f"Output: {out_dir}\n")

    if not args.no_individual:
        for i, it in enumerate(items, 1):
            fname = f"{i:02d}_{slug(it['kpi_type'],18)}_{slug(it['entity'])}.mp3"
            fpath = out_dir / fname
            try:
                synth(it["message"], fpath)
                print(f"  [{i:02d}] {it['severity']:8} {it['kpi_type']:16} {it['entity']}")
            except Exception as exc:
                print(
                    f"  [{i:02d}] GAGAL ({exc}) — cek piper/ffmpeg sudah terpasang", file=sys.stderr
                )

    if not args.no_briefing:
        _bulan = [
            "",
            "Januari",
            "Februari",
            "Maret",
            "April",
            "Mei",
            "Juni",
            "Juli",
            "Agustus",
            "September",
            "Oktober",
            "November",
            "Desember",
        ]
        _now = datetime.now()
        today = f"{_now.day} {_bulan[_now.month]} {_now.year}"
        n_crit = sum(1 for it in items if str(it["severity"]).lower() == "critical")
        header = (
            f"Ringkasan isu E W S hari ini, tanggal {today}. "
            f"Total {len(items)} isu, {n_crit} di antaranya kritis."
        )
        body = "\n\n".join(it["message"] for it in items)
        brief_path = out_dir / "_briefing_all.mp3"
        try:
            synth(header + "\n\n" + body, brief_path)
            print(f"\n  Briefing gabungan: {brief_path}")
        except Exception as exc:
            print(f"\n  Briefing GAGAL ({exc})", file=sys.stderr)

    print("\nSelesai. Putar file .mp3 di folder di atas (double-click).")


if __name__ == "__main__":
    main()
