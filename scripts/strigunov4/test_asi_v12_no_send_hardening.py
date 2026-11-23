"""Offline regressions for pure no-send planning and admission helpers.

Only synthetic in-memory inputs are used; no execution or mutation entrypoint
is called. Run with PYTHONDONTWRITEBYTECODE=1 to avoid import artifacts.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


def load_module(name):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).resolve().with_name(name + ".py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


patch = load_module("staging_no_send_patch")
protected = load_module("protected_staging_no_send")


class NoSendHardeningTests(unittest.TestCase):
    CONFIG = (
        b"# synthetic fixture only\nEMAIL_AUTO_SEND=false\n"
        b"EMAIL_DRAFT_ONLY=true\nDRY_RUN_TELEGRAM_OUTBOUND=true\n"
        b"ALLOW_REAL_TELEGRAM_SYNTHETIC=false\nYOOKASSA_ENABLED=false\n"
        b"ASI_APP_ROOT=/synthetic/app\nUNRELATED='keep  spaces'\n\n"
    )

    def test_plan_appends_only_flag_and_reports_exact_digests(self):
        result = patch.plan(self.CONFIG)
        expected = self.CONFIG + b"ASI_SYNTHETIC_NO_SEND=YES\n"
        self.assertEqual(result["output"], expected)
        self.assertIs(result["changed"], True)
        self.assertEqual(result["bytes_written"], len(expected) - len(self.CONFIG))
        self.assertEqual(result["input_sha256"], hashlib.sha256(self.CONFIG).hexdigest())
        self.assertEqual(result["output_sha256"], hashlib.sha256(expected).hexdigest())

    def test_existing_exact_flag_is_idempotent_and_preserves_every_byte(self):
        raw = self.CONFIG + b"ASI_SYNTHETIC_NO_SEND=YES\n# keep trailing comment\n"
        result = patch.plan(raw)
        self.assertEqual(result["output"], raw)
        self.assertIs(result["changed"], False)
        self.assertEqual(result["bytes_written"], 0)
        self.assertEqual(result["input_sha256"], result["output_sha256"])

    def test_unsafe_or_noncanonical_flags_are_rejected(self):
        for entry in (
            b"ASI_SYNTHETIC_NO_SEND=NO\n",
            b"ASI_SYNTHETIC_NO_SEND=false\n",
            b"ASI_SYNTHETIC_NO_SEND=\n",
            b"export ASI_SYNTHETIC_NO_SEND=YES\n",
            b"ASI_SYNTHETIC_NO_SEND = YES\n",
            b"ASI_SYNTHETIC_NO_SEND='YES'\n",
        ):
            with self.subTest(entry=entry):
                raw = self.CONFIG + entry
                before = bytes(raw)
                with self.assertRaisesRegex(patch.Block, "^CONFLICTING_SAFETY_FLAG$"):
                    patch.plan(raw)
                self.assertEqual(raw, before)

    def test_duplicate_flags_are_rejected_even_when_both_are_safe(self):
        for second in (b"YES", b"NO"):
            with self.subTest(second=second):
                raw = self.CONFIG + b"ASI_SYNTHETIC_NO_SEND=YES\nASI_SYNTHETIC_NO_SEND=" + second + b"\n"
                with self.assertRaisesRegex(patch.Block, "^DUPLICATE_SAFETY_FLAG$"):
                    patch.plan(raw)

    def test_malformed_configuration_inputs_fail_closed(self):
        cases = (
            ("KEY=value\n", "INVALID_FILE_SIZE"),
            (bytearray(b"KEY=value\n"), "INVALID_FILE_SIZE"),
            (b"", "INVALID_FILE_SIZE"),
            (b"x" * 131072 + b"\n", "INVALID_FILE_SIZE"),
            (b"KEY=value", "UNSAFE_FILE_FORMAT"),
            (b"KEY=value\r\n", "UNSAFE_FILE_FORMAT"),
            (b"KEY=\0\n", "UNSAFE_FILE_FORMAT"),
            (b"\n" * 2501, "UNSAFE_LINE_COUNT"),
            (b"KEY=value\\\n\n", "UNTERMINATED_CONTINUATION"),
        )
        for raw, code in cases:
            with self.subTest(code=code, input_type=type(raw).__name__):
                with self.assertRaisesRegex(patch.Block, "^" + code + "$"):
                    patch.plan(raw)

    def test_comments_and_similar_names_do_not_count_as_the_flag(self):
        raw = self.CONFIG + (
            b"# ASI_SYNTHETIC_NO_SEND=NO\n"
            b"ASI_SYNTHETIC_NO_SEND_EXTRA=NO\n"
        )
        self.assertEqual(patch.plan(raw)["output"], raw + patch.FLAG)

    def admission_fixture(self):
        sha = "a" * 40
        return {
            "GITHUB_ACTIONS": "true",
            "GITHUB_REPOSITORY": "ASI-integration/asi-landing",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_WORKFLOW_REF": "ASI-integration/asi-landing/.github/workflows/strigunov4-protected-no-send.yml@refs/heads/main",
            "GITHUB_ACTOR": "ASI-integration",
            "GITHUB_TRIGGERING_ACTOR": "ASI-integration",
            "GITHUB_ACTOR_ID": "207600140",
            "GITHUB_RUN_ATTEMPT": "1",
            "STAGING_SSH_USER": "project_ayfaar",
            "GITHUB_SHA": sha, "GITHUB_WORKFLOW_SHA": sha,
            "STAGING_REVIEWED_MAIN_SHA": sha,
            "STAGING_NO_SEND_CONFIRM": "CONFIGURE_STRIGUNOV4_NO_SEND_" + sha,
            "GITHUB_RUN_ID": "123",
            "STAGING_SSH_HOST": "synthetic.invalid",
            "STAGING_SSH_PORT": "22",
            "STAGING_SSH_PRIVATE_KEY": "synthetic-not-a-key-" * 10,
            "UNRELATED": "preserve me",
        }

    def test_admission_accepts_synthetic_valid_input_without_mutation(self):
        env = self.admission_fixture()
        before = copy.deepcopy(env)
        self.assertEqual(protected.validate(env), ("a" * 40, "123", "synthetic.invalid", 22))
        self.assertEqual(env, before)

    def test_admission_rejects_unexpected_variants_without_mutation(self):
        for key, value, code in (
            ("GITHUB_RUN_ATTEMPT", "2", "ADMISSION_GITHUB_RUN_ATTEMPT"),
            ("GITHUB_EVENT_NAME", "pull_request", "ADMISSION_GITHUB_EVENT_NAME"),
            ("GITHUB_WORKFLOW_SHA", "b" * 40, "EXACT_MAIN_SHA"),
            ("STAGING_NO_SEND_CONFIRM", "yes", "OWNER_CONFIRMATION"),
            ("GITHUB_RUN_ID", "01", "RUN_ID"),
            ("STAGING_SSH_HOST", "host;command", "SSH_HOST"),
            ("STAGING_SSH_PORT", "65536", "SSH_PORT"),
            ("STAGING_SSH_PORT", "bad", "SSH_PORT"),
        ):
            with self.subTest(key=key, value=value):
                env = self.admission_fixture()
                env[key] = value
                before = copy.deepcopy(env)
                with self.assertRaisesRegex(protected.Block, "^" + code + "$"):
                    protected.validate(env)
                self.assertEqual(env, before)

    def test_receipt_requires_all_safety_evidence_and_zero_exit(self):
        receipt = {"status": "NO_SEND_EFFECTIVE_PASS", "effectiveFlags": 7,
                   "databaseChanged": False, "releaseSwitched": False}
        self.assertEqual(protected.decode_remote_result(json.dumps(receipt).encode(), 0), receipt)
        for changes in ({"effectiveFlags": 6}, {"databaseChanged": True},
                        {"releaseSwitched": True}, {"unexpected": "field"}):
            with self.subTest(changes=changes):
                raw = json.dumps(dict(receipt, **changes)).encode()
                with self.assertRaises(protected.RemoteOutcome) as caught:
                    protected.decode_remote_result(raw, 0)
                self.assertEqual(str(caught.exception), "BLOCK_MANUAL_RECOVERY_REQUIRED")
        for raw, code in ((json.dumps(receipt).encode(), 1), (b"[]", 0),
                          (b"not-json", 0), (b"\xff", 0), (b"x" * 4097, 0)):
            with self.subTest(code=code, size=len(raw)):
                with self.assertRaises(protected.RemoteOutcome) as caught:
                    protected.decode_remote_result(raw, code)
                self.assertEqual(caught.exception.status, "BLOCK_MANUAL_RECOVERY_REQUIRED")


if __name__ == "__main__":
    unittest.main()
