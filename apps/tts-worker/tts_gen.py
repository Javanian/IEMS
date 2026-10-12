import sys, asyncio, subprocess
from pathlib import Path
from datetime import datetime

BASE = Path(__file__).resolve().parent
OUT = BASE / "output"
OUT.mkdir(exist_ok=True)


PIPER_BIN = BASE / "tools" / "piper" / "piper" / "piper.exe"
PIPER_MODEL = BASE / "models" / "id_ID.onnx"
PIPER_CONFIG = BASE / "models" / "id_ID.onnx.json"


EDGE_VOICES = {
    "ardi": ("id-ID-ArdiNeural", "Male", "Edge TTS — laki-laki, jelas"),
    "gadis": ("id-ID-GadisNeural", "Female", "Edge TTS — perempuan, natural"),
}


PIPER_VOICES = {
    "piper-id": (str(PIPER_MODEL), str(PIPER_CONFIG), "Piper — Indonesia news anchor, unisex"),
}


def list_voices():
    print("Edge TTS (MP3 langsung):")
    for k, v in EDGE_VOICES.items():
        print(f"  {k:<12} {v[1]:<8} {v[2]}")
    if PIPER_BIN.exists():
        print(f"\nPiper TTS (WAV, local):")
        for k, v in PIPER_VOICES.items():
            print(f"  {k:<12} {'?' :<8} {v[2]}")


async def tts_edge(text, voice_key):
    voice_id = EDGE_VOICES.get(voice_key, EDGE_VOICES["ardi"])[0]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = "".join(c if c.isalnum() else "_" for c in text[:25])
    out = OUT / f"edge_{safe}_{ts}.mp3"

    cmd = [
        sys.executable,
        "-m",
        "edge_tts",
        "--voice",
        voice_id,
        "--text",
        text,
        "--write-media",
        str(out),
    ]
    proc = await asyncio.create_subprocess_exec(*cmd)
    await proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"edge-tts failed (code {proc.returncode})")
    subprocess.run(["start", str(out)], shell=True)
    return out


def tts_piper(text):
    if not PIPER_BIN.exists():
        raise RuntimeError(f"Piper binary not found: {PIPER_BIN}")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = "".join(c if c.isalnum() else "_" for c in text[:25])
    out = OUT / f"piper_{safe}_{ts}.wav"

    cmd = [
        str(PIPER_BIN),
        "--model",
        str(PIPER_MODEL),
        "--config",
        str(PIPER_CONFIG),
        "--output_file",
        str(out),
    ]
    r = subprocess.run(cmd, input=text, text=True, capture_output=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(f"Piper failed: {r.stderr}")
    subprocess.run(["start", str(out)], shell=True)
    return out


def main():
    if len(sys.argv) < 2 or sys.argv[1] == "--list":
        list_voices()
        return

    text = sys.argv[1]
    engine = "edge"
    voice = "ardi"

    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--engine" and i + 1 < len(args):
            engine = args[i + 1]
            i += 2
        elif args[i] == "--voice" and i + 1 < len(args):
            voice = args[i + 1]
            i += 2
        else:
            i += 1

    try:
        if engine == "piper":
            out = tts_piper(text)
        else:
            out = asyncio.run(tts_edge(text, voice))
        print(f"✅ {out.name} ({out.stat().st_size//1024} KB) [{engine}]")
    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    main()
