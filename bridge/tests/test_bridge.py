import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from notebooklm_bridge import build_generate_args, validate_request


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


if __name__ == "__main__":
    unittest.main()
