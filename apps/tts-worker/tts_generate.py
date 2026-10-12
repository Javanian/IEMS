import sys
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


DEFAULT_VOICE = "id-ID-ArdiNeural"


async def generate_tts(text: str, output_path: Path, voice: str = DEFAULT_VOICE):

    cmd = [
        sys.executable,
        "-m",
        "edge_tts",
        "--voice",
        voice,
        "--text",
        text,
        "--write-media",
        str(output_path),
    ]
    proc = await asyncio.create_subprocess_exec(*cmd)
    await proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"edge-tts failed with code {proc.returncode}")
    size_kb = output_path.stat().st_size / 1024
    print(f"✅ Generated: {output_path.name} ({size_kb:.0f} KB)")
    return output_path


def main():
    if len(sys.argv) < 2:
        print("Usage: python tts_generate.py <teks indonesia> [--voice id-ID-GadisNeural]")
        print()
        print("Contoh:")
        print('  python tts_generate.py "Perhatian. Order nomor 10024567 selesai."')
        print('  python tts_generate.py "Halo selamat pagi" --voice id-ID-GadisNeural')
        print()
        print("Voice options:")
        print("  id-ID-ArdiNeural  — laki-laki (default)")
        print("  id-ID-GadisNeural — perempuan")
        return

    text = sys.argv[1]
    voice = DEFAULT_VOICE

    if len(sys.argv) >= 4 and sys.argv[2] == "--voice":
        voice = sys.argv[3]

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = "".join(c if c.isalnum() else "_" for c in text[:30])
    filename = f"tts_{safe_name}_{ts}.mp3"
    output_path = OUTPUT_DIR / filename

    asyncio.run(generate_tts(text, output_path, voice))

    subprocess.run(["start", str(output_path)], shell=True)


if __name__ == "__main__":
    main()
