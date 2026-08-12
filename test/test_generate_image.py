import argparse
import base64
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).parents[1] / "skills" / "tuzi-image-generation" / "scripts" / "generate_image.py"
SPEC = importlib.util.spec_from_file_location("tuzi_generate_image", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
PNG = b"\x89PNG\r\n\x1a\n" + b"test-image"


def arguments(**overrides):
    values = {
        "prompt": "test prompt",
        "size": "1024x1024",
        "quality": "high",
        "output_format": "png",
        "background": "auto",
        "output_dir": "",
        "filename": "",
    }
    values.update(overrides)
    return argparse.Namespace(**values)


class GenerateImageTests(unittest.TestCase):
    def test_payload_is_fixed_to_one_gpt_image_2_request(self):
        payload = MODULE.build_payload(arguments())
        self.assertEqual(payload["model"], "gpt-image-2")
        self.assertEqual(payload["n"], 1)
        self.assertEqual(payload["size"], "1024x1024")

    def test_transparent_jpeg_is_rejected(self):
        with self.assertRaises(MODULE.SkillError):
            MODULE.build_payload(arguments(output_format="jpeg", background="transparent"))

    def test_coding_reads_top_level_codex_key(self):
        with tempfile.TemporaryDirectory() as root:
            pathlib.Path(root, "auth.json").write_text(json.dumps({"auth_mode": "apikey", "OPENAI_API_KEY": "coding-key", "tokens": {"access_token": "ignored"}}), encoding="utf-8")
            with mock.patch.dict(os.environ, {"CODEX_HOME": root}, clear=True):
                key, source = MODULE.load_credential("coding")
        self.assertEqual(key, "coding-key")
        self.assertEqual(source, "codex-auth")

    def test_oauth_session_is_not_treated_as_api_key(self):
        with tempfile.TemporaryDirectory() as root:
            pathlib.Path(root, "auth.json").write_text(json.dumps({"auth_mode": "chatgpt", "OPENAI_API_KEY": "session-token"}), encoding="utf-8")
            with mock.patch.dict(os.environ, {"CODEX_HOME": root}, clear=True):
                with self.assertRaises(MODULE.SkillError):
                    MODULE.load_credential("coding")

    def test_process_api_key_has_precedence(self):
        with tempfile.TemporaryDirectory() as root:
            pathlib.Path(root, "auth.json").write_text(json.dumps({"auth_mode": "apikey", "OPENAI_API_KEY": "stored-key"}), encoding="utf-8")
            with mock.patch.dict(os.environ, {"CODEX_HOME": root, "OPENAI_API_KEY": "current-key"}, clear=True):
                key, source = MODULE.load_credential("coding")
        self.assertEqual(key, "current-key")
        self.assertEqual(source, "process-OPENAI_API_KEY")

    def test_api_channel_never_reuses_codex_key(self):
        with tempfile.TemporaryDirectory() as root:
            pathlib.Path(root, "auth.json").write_text(json.dumps({"OPENAI_API_KEY": "coding-key"}), encoding="utf-8")
            with mock.patch.dict(os.environ, {"CODEX_HOME": root}, clear=True):
                with self.assertRaises(MODULE.SkillError):
                    MODULE.load_credential("api")

    def test_private_download_address_is_rejected(self):
        record = (2, 1, 6, "", ("127.0.0.1", 443))
        with mock.patch.object(MODULE.socket, "getaddrinfo", return_value=[record]):
            with self.assertRaises(MODULE.SkillError):
                MODULE.public_addresses("example.invalid")

    def test_base64_is_streamed_to_a_real_non_overwritten_file(self):
        encoded = base64.b64encode(PNG).decode("ascii")
        with tempfile.TemporaryDirectory() as root:
            output = pathlib.Path(root)
            saved = MODULE.decode_base64_image(encoded, output, "image")
            self.assertEqual(saved.read_bytes(), PNG)
            with self.assertRaises(MODULE.SkillError):
                MODULE.decode_base64_image(encoded, output, "image")

    def test_compatible_base64_field_is_supported(self):
        encoded = base64.b64encode(PNG).decode("ascii")
        with tempfile.TemporaryDirectory() as root:
            args = arguments(output_dir=root, filename="compatible")
            saved = MODULE.save_result({"data": [{"base64": encoded}]}, args)
            self.assertTrue(saved.is_file())


if __name__ == "__main__":
    unittest.main()
