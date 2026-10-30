import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import types
import unittest
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[2] / "apps/fastapi-msproject/tts_announcement.py"
spec = importlib.util.spec_from_file_location("foundation_tts_under_test", MODULE)
tts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tts)


def pcm_wav(path):
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x00\x00" * 160)


def piper_output(command):
    return Path(command[command.index("--output_file") + 1])


class ArtifactFaultInjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(
            prefix="foundation-tts-", dir=os.environ.get("PAPERCLIP_RUN_SCRATCH_DIR")
        )
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(patch.stopall)
        patch.object(tts, "ensure_piper_available", return_value="synthetic-piper").start()
        patch.object(tts, "ensure_piper_model_available").start()
        patch.object(tts, "log").start()

    def test_success_without_new_native_output_rejects_stale_wav(self):
        output = self.root / "body.wav"
        pcm_wav(output)
        previous = output.read_bytes()
        with patch.object(tts.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")):
            with self.assertRaises(tts.TtsGenerationError):
                tts.generate_body_audio_with_piper("synthetic", output)
        self.assertEqual(output.read_bytes(), previous)
        self.assertEqual(list(self.root.iterdir()), [output])

    def test_nonempty_corrupt_native_output_is_not_success(self):
        output = self.root / "body.wav"

        def corrupt(command, **kwargs):
            piper_output(command).write_bytes(b"not a WAV")
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(tts.subprocess, "run", side_effect=corrupt):
            with self.assertRaises(tts.TtsGenerationError):
                tts.generate_body_audio_with_piper("synthetic", output)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_truncated_pcm_frames_are_rejected(self):
        output = self.root / "body.wav"

        def truncated(command, **kwargs):
            staged = piper_output(command)
            pcm_wav(staged)
            staged.write_bytes(staged.read_bytes()[:-2])
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(tts.subprocess, "run", side_effect=truncated):
            with self.assertRaises(tts.TtsGenerationError):
                tts.generate_body_audio_with_piper("synthetic", output)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_timeout_discards_partial_output_and_next_attempt_recovers(self):
        output = self.root / "body.wav"

        def timeout(command, **kwargs):
            piper_output(command).write_bytes(b"partial")
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])

        with patch.object(tts.subprocess, "run", side_effect=timeout):
            with self.assertRaises(tts.TtsGenerationError):
                tts.generate_body_audio_with_piper("synthetic", output)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.iterdir()), [])

        def recover(command, **kwargs):
            pcm_wav(piper_output(command))
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(tts.subprocess, "run", side_effect=recover) as native:
            result = tts.generate_body_audio_with_piper("synthetic", output)
        self.assertEqual(native.call_count, 1)
        self.assertEqual(result["body_format"], "wav")
        with wave.open(str(output), "rb") as audio:
            self.assertEqual(audio.getnframes(), 160)
        self.assertEqual(list(self.root.iterdir()), [output])

    def test_native_nonzero_preserves_previously_published_body(self):
        output = self.root / "body.wav"
        pcm_wav(output)
        previous = output.read_bytes()

        def failed(command, **kwargs):
            piper_output(command).write_bytes(b"partial")
            return subprocess.CompletedProcess(command, 1, "", "synthetic failure")

        with patch.object(tts.subprocess, "run", side_effect=failed):
            with self.assertRaises(tts.TtsGenerationError):
                tts.generate_body_audio_with_piper("synthetic", output)
        self.assertEqual(output.read_bytes(), previous)
        self.assertEqual(list(self.root.iterdir()), [output])

    def test_later_failed_writer_cannot_overwrite_concurrent_success(self):
        output = self.root / "body.wav"
        published = Event()

        def concurrent(command, **kwargs):
            if kwargs["input"] == "failure":
                if not published.wait(5):
                    raise AssertionError("successful writer did not complete")
                piper_output(command).write_bytes(b"partial from failed writer")
                return subprocess.CompletedProcess(command, 1, "", "failed")
            pcm_wav(piper_output(command))
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(tts.subprocess, "run", side_effect=concurrent), ThreadPoolExecutor(max_workers=2) as writers:
            failure = writers.submit(tts.generate_body_audio_with_piper, "failure", output)
            try:
                writers.submit(tts.generate_body_audio_with_piper, "success", output).result(5)
                previous = output.read_bytes()
            finally:
                published.set()
            with self.assertRaises(tts.TtsGenerationError):
                failure.result(5)
        self.assertEqual(output.read_bytes(), previous)
        self.assertEqual(list(self.root.iterdir()), [output])

    def test_real_synthetic_child_timeout_then_recovery(self):
        output = self.root / "body.wav"
        real_run = subprocess.run
        script = """
import pathlib, sys, time, wave
path = pathlib.Path(sys.argv[2])
if sys.argv[1] == 'timeout':
    path.write_bytes(b'partial')
    time.sleep(10)
else:
    with wave.open(str(path), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b'\\x00\\x00' * 160)
"""

        def child(command, **kwargs):
            return real_run([sys.executable, "-c", script, kwargs["input"], str(piper_output(command))], **kwargs)

        with patch.object(tts.subprocess, "run", side_effect=child), patch.object(tts, "PIPER_TIMEOUT_SECONDS", 0.5):
            with self.assertRaises(tts.TtsGenerationError):
                tts.generate_body_audio_with_piper("timeout", output)
            self.assertEqual(list(self.root.iterdir()), [])
            tts.generate_body_audio_with_piper("recover", output)
        with wave.open(str(output), "rb") as audio:
            self.assertEqual(audio.getnframes(), 160)
        self.assertEqual(list(self.root.iterdir()), [output])

    def fake_audio(self, export):
        class Segment:
            @classmethod
            def from_file(cls, path):
                return cls()

            @classmethod
            def silent(cls, duration):
                return cls()

            def __add__(self, other):
                return self

            def __len__(self):
                return 100

            def export(self, path, format):
                return export(Path(path))

        module = types.ModuleType("pydub")
        module.AudioSegment = Segment
        return module

    def sources(self):
        paths = [self.root / name for name in ["header.mp3", "body.wav", "footer.mp3"]]
        for path in paths:
            path.write_bytes(b"synthetic source")
        return paths

    def test_failed_export_preserves_published_mp3_and_cleans_attempt(self):
        header, body, footer = self.sources()
        output = self.root / "announcement.mp3"
        output.write_bytes(b"previous publication")

        def partial(path):
            path.write_bytes(b"partial")
            raise OSError("synthetic encoder failure")

        with patch.dict(sys.modules, {"pydub": self.fake_audio(partial)}), patch.object(tts, "ensure_audio_tooling_available"):
            with self.assertRaises(tts.TtsGenerationError):
                tts.merge_announcement_audio(body, output, header, footer)
        self.assertEqual(output.read_bytes(), b"previous publication")
        self.assertEqual(set(self.root.iterdir()), {header, body, footer, output})

    def test_export_without_bytes_cannot_report_merged(self):
        header, body, footer = self.sources()
        output = self.root / "announcement.mp3"
        with patch.dict(sys.modules, {"pydub": self.fake_audio(lambda path: io.BytesIO())}), patch.object(tts, "ensure_audio_tooling_available"):
            with self.assertRaises(tts.TtsGenerationError):
                tts.merge_announcement_audio(body, output, header, footer)
        self.assertFalse(output.exists())

    def test_success_preserves_public_result_and_closes_export_handle(self):
        header, body, footer = self.sources()
        output = self.root / "announcement.mp3"
        handles = []

        def exported(path):
            handle = path.open("wb")
            handle.write(b"synthetic encoded MP3")
            handles.append(handle)
            return handle

        def generated(command, **kwargs):
            pcm_wav(piper_output(command))
            return subprocess.CompletedProcess(command, 0, "", "")

        merge = tts.merge_announcement_audio
        with patch.dict(sys.modules, {"pydub": self.fake_audio(exported)}), patch.object(tts, "ensure_audio_tooling_available"), patch.object(tts.subprocess, "run", side_effect=generated), patch.object(tts, "merge_announcement_audio", side_effect=lambda wav, target: merge(wav, target, header, footer)):
            result = tts.generate_announcement_mp3("  AB12  ", output)
        self.assertEqual(result["crn_id"], "AB12")
        self.assertEqual(result["crn_id_spaced"], "A B 1 2")
        self.assertEqual(result["file"], str(output))
        self.assertEqual(result["tts_engine"], "piper")
        self.assertTrue(result["merged"])
        self.assertEqual(result["gap_after_header_ms"], tts.GAP_AFTER_HEADER_MS)
        self.assertEqual(result["gap_before_footer_ms"], tts.GAP_BEFORE_FOOTER_MS)
        self.assertTrue(all(handle.closed for handle in handles))
        self.assertEqual(set(self.root.iterdir()), {header, body, footer, output})


if __name__ == "__main__":
    unittest.main()
