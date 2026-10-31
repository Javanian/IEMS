"""Owned zone generation worker. No database migration or playback publication."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid


def request(base, origin, session, path, body=None):
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=payload,
        headers={"Origin": origin, "Cookie": "portfolio_session=" + session, "Content-Type": "application/json", "Accept": "application/json"},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def run_once(api, generate, directory):
    jobs = api("/api/operations/voice/generation")["data"]
    if not jobs:
        return False
    job = jobs[0]
    root = "/api/operations/voice/jobs/" + str(uuid.UUID(job["resourceId"]))
    claim = api(root + "/claim", {"expectedVersion": job["version"], "idempotencyKey": f'{job["resourceId"]}-claim-{job["version"]}'})["data"]
    artifact_id = str(uuid.UUID(claim["artifactId"]))
    target = directory / (artifact_id + ".mp3")
    temporary = directory / (artifact_id + ".pending.mp3")
    model = claim["model"]
    lock_path = directory / (artifact_id + ".lock")
    lock = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(lock)
    try:
        if target.exists() or temporary.exists():
            raise RuntimeError("Owned artifact already exists; reconcile its generation lease")
        try:
            proof = generate(claim["text"], temporary, expected_model_sha256=model["modelSha256"], expected_config_sha256=model["configSha256"])
            # A hard link publishes the complete bytes once; an older attempt cannot overwrite them.
            os.link(temporary, target)
            temporary.unlink()
        except Exception:
            temporary.unlink(missing_ok=True)
            api(root + "/failed", {"expectedVersion": claim["version"], "idempotencyKey": f'{job["resourceId"]}-failed-{claim["version"]}', "workerToken": claim["workerToken"]})
            raise
        # An uncertain completion leaves this owned artifact and lease for explicit reconciliation.
        api(root + "/generated", {"expectedVersion": claim["version"], "idempotencyKey": f'{job["resourceId"]}-generated-{claim["version"]}', "workerToken": claim["workerToken"], "artifactId": artifact_id, "modelSha256": proof["model_sha256"], "configSha256": proof["config_sha256"], "generationMs": proof["generation_ms"]})
    finally:
        lock_path.unlink(missing_ok=True)
    return True


def main():
    parser = argparse.ArgumentParser(description="Generate an owned zone job with a pinned real model")
    parser.add_argument("--loop", action="store_true", help="Explicitly run the single owned worker loop")
    args = parser.parse_args()
    base, origin, session = (os.environ[name] for name in ("IEMS_VOICE_API_BASE", "IEMS_VOICE_ORIGIN", "IEMS_VOICE_SESSION"))
    directory = Path(os.environ["IEMS_VOICE_ARTIFACT_DIR"]).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).resolve().parents[1] / "fastapi-msproject" / "tts_announcement.py"
    spec = importlib.util.spec_from_file_location("iems_zone_tts", source)
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    api = lambda path, body=None: request(base, origin, session, path, body)
    while True:
        processed = run_once(api, native.generate_zone_announcement_mp3, directory)
        if not args.loop:
            break
        if not processed:
            time.sleep(3)


if __name__ == "__main__":
    try:
        main()
    except (urllib.error.URLError, OSError, ValueError, KeyError):
        raise SystemExit("Zone worker stopped. Inspect the private runtime configuration and owned job state.") from None
