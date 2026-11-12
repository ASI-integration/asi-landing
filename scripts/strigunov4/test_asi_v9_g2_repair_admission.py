"""Synthetic G2 admission regressions; all process/transport boundaries denied."""
import json
import unittest
from unittest.mock import patch

import c4_operator_host as host
import c4_operator_patch as config
import protected_c4_operator_repair as gate


def context():
    sha = "a" * 40
    return dict(GITHUB_ACTIONS="true", GITHUB_REPOSITORY=gate.REPO,
                GITHUB_REF="refs/heads/main", GITHUB_EVENT_NAME="workflow_dispatch",
                GITHUB_WORKFLOW_REF=gate.WORKFLOW, GITHUB_ACTOR=gate.OWNER,
                GITHUB_TRIGGERING_ACTOR=gate.OWNER, GITHUB_ACTOR_ID=gate.OWNER_ID,
                GITHUB_RUN_ATTEMPT="1", STAGING_SSH_USER="project_ayfaar",
                GITHUB_SHA=sha, GITHUB_WORKFLOW_SHA=sha, STAGING_REVIEWED_MAIN_SHA=sha,
                C4_OPERATOR_CONFIRM="CONFIGURE_C4_OPERATOR_" + sha,
                C4_OPERATOR_INCIDENT="39140030546", GITHUB_RUN_ID="123",
                STAGING_SSH_HOST="synthetic.invalid", STAGING_SSH_PORT="22",
                STAGING_SSH_PRIVATE_KEY="synthetic-not-a-private-key" * 8)


def retained_bytes():
    values = dict(config.SAFETY, CRM_OPERATOR_EMAILS="retained@example.invalid",
                  OPS_ADMIN_EMAILS="admin@example.invalid")
    return "".join(k + "=" + v + "\n" for k, v in values.items()).encode()


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        # A test mistake must fail locally rather than launch git, SSH or a worker.
        self.process = patch.object(gate.subprocess, "run",
                                    side_effect=AssertionError("process forbidden")).start()
        self.addCleanup(patch.stopall)

    def denied(self, env, code):
        with patch.object(gate, "checked") as checked, patch.object(gate, "payload") as payload:
            with self.assertRaises(gate.Block) as raised:
                gate.execute(env)
            self.assertEqual(str(raised.exception), code)
            checked.assert_not_called()
            payload.assert_not_called()
        self.process.assert_not_called()

    def test_valid_synthetic_admission_only(self):
        self.assertEqual(gate.validate(context()), ("a" * 40, "123", "synthetic.invalid", 22))
        self.process.assert_not_called()

    def test_invalid_credentials_never_reach_transport(self):
        for value in (None, "", "x" * 100, b"x" * 200):
            with self.subTest(value_type=type(value).__name__):
                self.denied(context() | {"STAGING_SSH_PRIVATE_KEY": value}, "SSH_KEY_MISSING")
        env = context()
        del env["STAGING_SSH_PRIVATE_KEY"]
        self.denied(env, "SSH_KEY_MISSING")

    def test_rejected_operator_authorization(self):
        for key in ("GITHUB_ACTOR", "GITHUB_TRIGGERING_ACTOR", "GITHUB_ACTOR_ID"):
            for value in ("outsider", "", None):
                with self.subTest(key=key, value=value):
                    self.denied(context() | {key: value}, "ADMISSION_" + key)
        for key, value, code in (("C4_OPERATOR_CONFIRM", "CONFIGURE_C4_OPERATOR_" + "b" * 40, "OWNER_CONFIRMATION"),
                                 ("C4_OPERATOR_INCIDENT", "other-incident", "INCIDENT")):
            self.denied(context() | {key: value}, code)

    def test_wrong_execution_scope(self):
        changes = dict(GITHUB_ACTIONS="false", GITHUB_REPOSITORY="other/repo",
                       GITHUB_REF="refs/heads/topic", GITHUB_EVENT_NAME="pull_request",
                       GITHUB_WORKFLOW_REF=gate.WORKFLOW.replace("main", "topic"),
                       GITHUB_RUN_ATTEMPT="2", STAGING_SSH_USER="root")
        for key, value in changes.items():
            with self.subTest(key=key):
                self.denied(context() | {key: value}, "ADMISSION_" + key)

    def test_reviewed_source_identity_mismatch(self):
        for key in ("GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "STAGING_REVIEWED_MAIN_SHA"):
            for value in ("b" * 40, "a" * 39, "a" * 40 + "\n", ""):
                with self.subTest(key=key, value=value):
                    self.denied(context() | {key: value}, "EXACT_MAIN_SHA")

    def test_invalid_run_and_transport_scope(self):
        for key, values, code in (
                ("GITHUB_RUN_ID", ("0", "-1", "123\n", "1" * 21), "RUN_ID"),
                ("STAGING_SSH_HOST", ("-option", "host/path", "host\nother", ""), "SSH_HOST"),
                ("STAGING_SSH_PORT", ("0", "65536", "invalid"), "SSH_PORT")):
            for value in values:
                with self.subTest(key=key, value=value):
                    self.denied(context() | {key: value}, code)

    def test_checkout_mismatch_prevents_payload_and_ssh(self):
        with patch.object(gate, "checked", return_value=b"b" * 40) as checked, \
                patch.object(gate, "payload") as payload:
            with self.assertRaisesRegex(gate.Block, "^CHECKOUT_SHA$"):
                gate.execute(context())
            self.assertEqual(checked.call_count, 1)
            self.assertEqual(checked.call_args.args[0][0], "git")
            payload.assert_not_called()
        self.process.assert_not_called()

    def test_retained_membership_mismatch_blocks_before_claim_or_write(self):
        original = retained_bytes()
        with patch.object(host, "live", side_effect=[None, config.Block("EFFECTIVE_MEMBERSHIP")]) as live, \
                patch.object(host.io, "read_env", return_value=(original, object())), \
                patch.object(host.Path, "mkdir") as mkdir, \
                patch.object(host.io, "write_private") as write, \
                patch.object(host.io, "atomic_env") as replace, \
                patch.object(host, "restart") as restart:
            with self.assertRaisesRegex(config.Block, "^EFFECTIVE_MEMBERSHIP$"):
                host.perform("123", "a" * 40)
            self.assertEqual(live.call_args.args[0], config.plan(original)["before"])
            mkdir.assert_not_called()
            write.assert_not_called()
            replace.assert_not_called()
            restart.assert_not_called()

    def test_retained_no_send_flags_cannot_be_repaired_away(self):
        for key, value in config.SAFETY.items():
            raw = retained_bytes().replace((key + "=" + value + "\n").encode(),
                                           (key + "=unsafe\n").encode())
            with self.subTest(key=key), self.assertRaisesRegex(config.Block, "^FILE_NO_SEND$"):
                config.plan(raw)

    def test_plan_preserves_retained_state_and_only_adds_fixed_operator(self):
        raw = retained_bytes() + b"UNRELATED=synthetic-retained-value\n"
        proposal = config.plan(raw)
        for key in config.KEYS:
            self.assertEqual(proposal["after"][key], proposal["before"][key] | {config.OPERATOR})
        self.assertIn(b"UNRELATED=synthetic-retained-value\n", proposal["output"])
        self.assertEqual(config.decode(raw)[1] | {k: config.decode(proposal["output"])[1][k]
                                                for k in config.KEYS},
                         config.decode(proposal["output"])[1])
        self.assertFalse(config.plan(proposal["output"])["changed"])


class ReceiptTests(unittest.TestCase):
    def reject(self, raw, code=0):
        with self.assertRaises(gate.RemoteOutcome) as raised:
            gate.decode_remote_result(raw, code)
        self.assertEqual(raised.exception.status, "BLOCK_MANUAL_RECOVERY_REQUIRED")

    def test_exact_success(self):
        self.assertEqual(gate.decode_remote_result(json.dumps(host.SUCCESS).encode(), 0), host.SUCCESS)

    def test_numeric_boolean_and_float_impersonation_rejected(self):
        for key, value in host.SUCCESS.items():
            if type(value) in (bool, int):
                replacement = int(value) if type(value) is bool else float(value)
                with self.subTest(key=key):
                    self.reject(json.dumps(host.SUCCESS | {key: replacement}).encode())

    def test_duplicate_receipt_fields_rejected_even_if_last_value_is_valid(self):
        good = json.dumps(host.SUCCESS)
        for prefix in ('"releaseSwitched":true,', '"status":"BLOCK",', '"effectiveFlags":7,'):
            with self.subTest(prefix=prefix):
                self.reject(("{" + prefix + good[1:]).encode())
        self.reject(b'{"status":"BLOCK","status":"ROLLBACK_PASS"}', 2)

    def test_retained_safety_receipt_mismatch_rejected(self):
        for change in ({"releaseSwitched": True}, {"databaseClientInvoked": True},
                       {"effectiveLists": 1}, {"effectiveFlags": 6},
                       {"databaseState": "OBSERVED"}, {"humanUI": "PASS"},
                       {"extra": "synthetic"}):
            with self.subTest(change=change):
                self.reject(json.dumps(host.SUCCESS | change).encode())
        for key in host.SUCCESS:
            self.reject(json.dumps({k: v for k, v in host.SUCCESS.items() if k != key}).encode())

    def test_malformed_and_nonzero_success_rejected(self):
        for raw in (b"not-json", b"[]", b"null", b"\xff", b"x" * 4097,
                    b'{"status":[]}', "not-bytes"):
            with self.subTest(raw_type=type(raw).__name__):
                self.reject(raw)
        self.reject(json.dumps(host.SUCCESS).encode(), 2)

    def test_operator_rejection_remains_failure_for_every_known_reason(self):
        for status in host.BLOCKS:
            with self.subTest(status=status), self.assertRaises(gate.RemoteOutcome) as raised:
                gate.decode_remote_result(json.dumps({"status": status}).encode(), 2)
            self.assertEqual(raised.exception.status, status)
            self.reject(json.dumps({"status": status}).encode(), 0)


if __name__ == "__main__":
    unittest.main()
