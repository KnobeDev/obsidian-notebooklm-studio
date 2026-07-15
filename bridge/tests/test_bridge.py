import contextlib
import io
import json
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import notebooklm_bridge as bridge
from notebooklm_bridge import build_generate_args, download_args, validate_request


class BridgeTests(unittest.TestCase):
    def test_rejects_unknown_artifact(self):
        request = {"protocolVersion": 1, "requestId": "r", "operation": "generate", "artifacts": [{"kind": "evil"}]}
        with self.assertRaises(ValueError):
            validate_request(request)

    def test_audio_generation_is_waited_and_bounded(self):
        prompt = Path(__file__)
        args = build_generate_args("audio", "nb", str(prompt), "en")
        self.assertEqual(args[:2], ["generate", "audio"])
        self.assertIn("--prompt-file", args)
        self.assertIn("--wait", args)
        self.assertIn("1200", args)

    def test_mind_map_uses_its_synchronous_surface(self):
        args = build_generate_args("mind-map", "nb", str(Path(__file__)), "en")
        self.assertIn("--instructions", args)
        self.assertNotIn("--wait", args)

    def test_slide_deck_generation_gets_a_media_scale_timeout(self):
        args = build_generate_args("slide-deck", "nb", str(Path(__file__)), "en")
        self.assertIn("1200", args)

    def test_audio_downloads_as_is_without_a_format_flag(self):
        # NotebookLM returns audio as an M4A/MPEG-4 container and the CLI has no
        # audio --format flag, so the download must preserve the .m4a path verbatim.
        target = Path("/tmp/staging/Topic-audio-overview.m4a")
        args = download_args("audio", "nb", "artifact-1", target)
        self.assertEqual(args[:3], ["download", "audio", str(target)])
        self.assertNotIn("--format", args)
        self.assertTrue(str(target).endswith(".m4a"))

    def test_slide_deck_download_keeps_its_pptx_format_flag(self):
        args = download_args("slide-deck", "nb", "artifact-1", Path("/tmp/staging/deck.pptx"))
        self.assertIn("--format", args)
        self.assertIn("pptx", args)

    def test_run_cli_emits_heartbeats_while_the_cli_is_busy(self):
        class SlowProcess:
            pid = 4321
            returncode = 0

            def communicate(self, timeout=None):
                time.sleep(0.3)
                return ('{"ok": true}', "")

            def poll(self):
                return 0

        original_popen = bridge.subprocess.Popen
        original_interval = bridge.HEARTBEAT_SECONDS
        bridge.subprocess.Popen = lambda *args, **kwargs: SlowProcess()
        bridge.HEARTBEAT_SECONDS = 0.02
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                result = bridge.run_cli("default", ["doctor", "--json"], "r1", "Still generating Slide deck")
        finally:
            bridge.subprocess.Popen = original_popen
            bridge.HEARTBEAT_SECONDS = original_interval
        self.assertEqual(result, {"ok": True})
        events = [json.loads(line) for line in buffer.getvalue().splitlines()]
        heartbeats = [event for event in events if event["type"] == "progress" and "Still generating Slide deck" in event["message"]]
        self.assertGreaterEqual(len(heartbeats), 1)
        self.assertEqual(heartbeats[0]["stage"], "waiting")

    def test_run_cli_stays_silent_without_a_heartbeat_message(self):
        class FastProcess:
            pid = 4321
            returncode = 0

            def communicate(self, timeout=None):
                return ('{"ok": true}', "")

            def poll(self):
                return 0

        original_popen = bridge.subprocess.Popen
        bridge.subprocess.Popen = lambda *args, **kwargs: FastProcess()
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                bridge.run_cli("default", ["doctor", "--json"])
        finally:
            bridge.subprocess.Popen = original_popen
        self.assertEqual(buffer.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
