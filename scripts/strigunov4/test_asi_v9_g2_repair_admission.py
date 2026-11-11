"""Synthetic source-only tests for the C4 operator repair admission gate.

These tests call ``validate`` only.  They use no credential, network, SSH,
GitHub, staging, production, payload, or service execution path.
"""
from unittest.mock import patch
import unittest

import protected_c4_operator_repair as repair


SHA = "a" * 40
RUN_ID = "39140030546"
PLACEHOLDER_KEY = "synthetic-placeholder-private-key-not-a-credential-" + "x" * 80


def valid_env():
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": repair.REPO,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_WORKFLOW_REF": repair.WORKFLOW,
        "GITHUB_ACTOR": repair.OWNER,
        "GITHUB_TRIGGERING_ACTOR": repair.OWNER,
        "GITHUB_ACTOR_ID": repair.OWNER_ID,
        "GITHUB_RUN_ATTEMPT": "1",
        "STAGING_SSH_USER": "project_ayfaar",
        "GITHUB_SHA": SHA,
        "GITHUB_WORKFLOW_SHA": SHA,
        "STAGING_REVIEWED_MAIN_SHA": SHA,
        "C4_OPERATOR_CONFIRM": "CONFIGURE_C4_OPERATOR_" + SHA,
        "C4_OPERATOR_INCIDENT": "39140030546",
        "GITHUB_RUN_ID": RUN_ID,
        "STAGING_SSH_HOST": "offline-staging.invalid",
        "STAGING_SSH_PORT": "2222",
        "STAGING_SSH_PRIVATE_KEY": PLACEHOLDER_KEY,
    }


class RepairAdmissionTests(unittest.TestCase):
    def assert_blocked(self, env, code):
        with self.assertRaises(repair.Block) as caught:
            repair.validate(env)
        self.assertEqual(str(caught.exception), code)

    def test_valid_synthetic_context_returns_normalized_identity(self):
        self.assertEqual(
            repair.validate(valid_env()),
            (SHA, RUN_ID, "offline-staging.invalid", 2222),
        )

    def test_repository_is_exact_and_required(self):
        for value in (None, "other/repository", repair.REPO + " "):
            env = valid_env()
            if value is None:
                del env["GITHUB_REPOSITORY"]
            else:
                env["GITHUB_REPOSITORY"] = value
            with self.subTest(value=value):
                self.assert_blocked(env, "ADMISSION_GITHUB_REPOSITORY")

    def test_workflow_ref_is_exact_and_required(self):
        for value in (None, repair.WORKFLOW.replace("@refs/heads/main", "@main"),
                      repair.REPO + "/.github/workflows/other.yml@refs/heads/main"):
            env = valid_env()
            if value is None:
                del env["GITHUB_WORKFLOW_REF"]
            else:
                env["GITHUB_WORKFLOW_REF"] = value
            with self.subTest(value=value):
                self.assert_blocked(env, "ADMISSION_GITHUB_WORKFLOW_REF")

    def test_sha_requires_lowercase_40_hex_and_three_way_equality(self):
        cases = (
            ("GITHUB_SHA", "a" * 39),
            ("GITHUB_SHA", "A" * 40),
            ("GITHUB_SHA", "g" * 40),
            ("GITHUB_WORKFLOW_SHA", "b" * 40),
            ("STAGING_REVIEWED_MAIN_SHA", "b" * 40),
        )
        for name, value in cases:
            with self.subTest(name=name, value=value):
                self.assert_blocked(dict(valid_env(), **{name: value}), "EXACT_MAIN_SHA")

    def test_run_attempt_must_be_literal_first_attempt(self):
        for value in (None, "0", "2", 1):
            env = valid_env()
            if value is None:
                del env["GITHUB_RUN_ATTEMPT"]
            else:
                env["GITHUB_RUN_ATTEMPT"] = value
            with self.subTest(value=value):
                self.assert_blocked(env, "ADMISSION_GITHUB_RUN_ATTEMPT")

    def test_confirmation_is_bound_to_the_exact_sha(self):
        for value in (None, "CONFIGURE_C4_OPERATOR_", "CONFIGURE_C4_OPERATOR_" + "b" * 40,
                      "configure_c4_operator_" + SHA):
            env = valid_env()
            if value is None:
                del env["C4_OPERATOR_CONFIRM"]
            else:
                env["C4_OPERATOR_CONFIRM"] = value
            with self.subTest(value=value):
                self.assert_blocked(env, "OWNER_CONFIRMATION")

    def test_host_requires_a_bounded_dns_style_token(self):
        for value in (None, "", "-host.invalid", "host_name.invalid", "host invalid",
                      "a" * 254):
            env = valid_env()
            if value is None:
                del env["STAGING_SSH_HOST"]
            else:
                env["STAGING_SSH_HOST"] = value
            with self.subTest(value=value):
                self.assert_blocked(env, "SSH_HOST")

    def test_port_is_numeric_and_within_tcp_range(self):
        for value in ("0", "65536", "22.0", "not-a-port", object()):
            with self.subTest(value=value):
                self.assert_blocked(
                    dict(valid_env(), STAGING_SSH_PORT=value),
                    "SSH_PORT",
                )
        env = valid_env()
        del env["STAGING_SSH_PORT"]
        self.assertEqual(repair.validate(env)[3], 22)

    def test_absent_or_short_placeholder_ssh_key_is_rejected(self):
        env = valid_env()
        del env["STAGING_SSH_PRIVATE_KEY"]
        self.assert_blocked(env, "SSH_KEY_MISSING")
        for value in (None, "", "placeholder", b"x" * 200):
            with self.subTest(value=value):
                self.assert_blocked(
                    dict(valid_env(), STAGING_SSH_PRIVATE_KEY=value),
                    "SSH_KEY_MISSING",
                )

    def test_validation_never_enters_payload_transport_or_service_seams(self):
        with patch.object(repair, "payload", side_effect=AssertionError("payload invoked")) as payload, \
             patch.object(repair, "checked", side_effect=AssertionError("checked invoked")) as checked, \
             patch.object(repair.subprocess, "run", side_effect=AssertionError("process invoked")) as run, \
             patch.object(repair.tempfile, "TemporaryDirectory",
                          side_effect=AssertionError("transport invoked")) as temporary:
            self.assertEqual(repair.validate(valid_env())[0], SHA)
        payload.assert_not_called()
        checked.assert_not_called()
        run.assert_not_called()
        temporary.assert_not_called()


if __name__ == "__main__":
    unittest.main()
