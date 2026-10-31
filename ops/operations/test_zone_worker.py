"""Synthetic unit checks; none of these establish real-model/audio acceptance."""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load("owned_native", ROOT / "apps/fastapi-msproject/tts_announcement.py")
worker = load("owned_worker", ROOT / "apps/tts-worker/zone_worker.py")


class ZoneGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get("PAPERCLIP_RUN_SCRATCH_DIR") or os.environ.get("PAPERCLIP_SCRATCH_DIR"))
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def test_missing_model_and_pin_mismatch_do_not_create_audio(self):
        model, config, output = (self.directory / name for name in ("model.onnx", "config.json", "result.mp3"))
        with patch.object(native, "PIPER_MODEL_PATH", model), patch.object(native, "PIPER_CONFIG_PATH", config):
            with self.assertRaises(native.TtsGenerationError):
                native.generate_zone_announcement_mp3("Synthetic warning", output, expected_model_sha256="a" * 64, expected_config_sha256="b" * 64)
            model.write_bytes(b"SYNTHETIC_NOT_A_MODEL")
            config.write_bytes(b"{}")
            with self.assertRaises(native.TtsGenerationError):
                native.generate_zone_announcement_mp3("Synthetic warning", output, expected_model_sha256="a" * 64, expected_config_sha256="b" * 64)
        self.assertFalse(output.exists())

    def test_generation_error_cleans_only_its_owned_files(self):
        model, config, output = (self.directory / name for name in ("model.onnx", "config.json", "result.mp3"))
        model.write_bytes(b"SYNTHETIC_NOT_A_MODEL")
        config.write_bytes(b"{}")
        with patch.object(native, "PIPER_MODEL_PATH", model), patch.object(native, "PIPER_CONFIG_PATH", config), patch.object(native, "generate_body_audio_with_piper", side_effect=RuntimeError("synthetic generation failure")):
            with self.assertRaises(RuntimeError):
                native.generate_zone_announcement_mp3("Synthetic warning", output, expected_model_sha256=hashlib.sha256(model.read_bytes()).hexdigest(), expected_config_sha256=hashlib.sha256(config.read_bytes()).hexdigest())
        self.assertFalse(output.exists())
        self.assertEqual(list(self.directory.glob("zone_body_*")), [])

    def test_unknown_completion_preserves_artifact_and_never_reports_failure(self):
        job_id, artifact_id = str(uuid.uuid4()), str(uuid.uuid4())
        calls = []

        def api(path, body=None):
            calls.append(path)
            if path.endswith("/generation"):
                return {"data": [{"resourceId": job_id, "version": 1}]}
            if path.endswith("/claim"):
                return {"data": {"version": 2, "artifactId": artifact_id, "text": "Synthetic warning", "workerToken": "synthetic-lease", "model": {"modelSha256": "a" * 64, "configSha256": "b" * 64}}}
            if path.endswith("/generated"):
                raise OSError("synthetic unknown HTTP outcome")
            self.fail("Unexpected endpoint: " + path)

        def fake_generate(text, output, **kwargs):
            output.write_bytes(b"SYNTHETIC_NOT_AUDIO")
            return {"model_sha256": "a" * 64, "config_sha256": "b" * 64, "generation_ms": 1}

        with self.assertRaises(OSError):
            worker.run_once(api, fake_generate, self.directory)
        self.assertTrue((self.directory / (artifact_id + ".mp3")).exists())
        self.assertFalse(any(path.endswith("/failed") for path in calls))


if __name__ == "__main__":
    unittest.main()
