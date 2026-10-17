"""Offline tests of exact protected GitHub and fixed staging target admission."""
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import protected_staging_no_send as gate
import staging_no_send_host as host


def example():
    return {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":gate.REPO,
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_WORKFLOW_REF":gate.WORKFLOW,
        "GITHUB_ACTOR":gate.OWNER,
        "GITHUB_TRIGGERING_ACTOR":gate.OWNER,
        "GITHUB_ACTOR_ID":gate.OWNER_ID,
        "GITHUB_RUN_ATTEMPT":"1",
        "GITHUB_RUN_ID":"39023529319",
        "GITHUB_SHA":"a"*40,
        "GITHUB_WORKFLOW_SHA":"a"*40,
        "STAGING_REVIEWED_MAIN_SHA":"a"*40,
        "STAGING_NO_SEND_CONFIRM":"CONFIGURE_STRIGUNOV4_NO_SEND_"+"a"*40,
        "STAGING_SSH_USER":"project_ayfaar",
        "STAGING_SSH_HOST":"stage.example.invalid",
        "STAGING_SSH_PORT":"22",
        "STAGING_SSH_PRIVATE_KEY":"SYNTHETIC_TEST_KEY_NOT_SECRET_"+"x"*120,
    }


class ProtectedStagingNoSendTests(unittest.TestCase):
    def test_valid_identity_format_never_provides_authority(self):
        self.assertEqual(gate.validate(example()),
                         ("a"*40,"39023529319","stage.example.invalid",22))

    def test_all_context_mismatches_rejected(self):
        cases = {
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"another-repository",
            "GITHUB_REF":"refs/heads/development",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_WORKFLOW_REF":gate.WORKFLOW.replace("main","feature"),
            "GITHUB_ACTOR":"imposter",
            "GITHUB_TRIGGERING_ACTOR":"imposter",
            "GITHUB_ACTOR_ID":"21",
            "GITHUB_RUN_ATTEMPT":"2",
            "GITHUB_RUN_ID":"0",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "STAGING_REVIEWED_MAIN_SHA":"b"*40,
            "STAGING_NO_SEND_CONFIRM":"INSTALL_EVERYTHING",
            "STAGING_SSH_USER":"root",
            "STAGING_SSH_HOST":"-proxy",
            "STAGING_SSH_PORT":"0",
            "STAGING_SSH_PRIVATE_KEY":"",
        }
        for name, value in cases.items():
            with self.subTest(name=name):
                e=example()
                e[name]=value
                with self.assertRaises(gate.Block):
                    gate.validate(e)

    def test_preflight_rejects_before_any_subprocess(self):
        with patch.object(gate,"checked") as command:
            with self.assertRaises(gate.Block):
                gate.execute({"GITHUB_REF":"refs/heads/main"})
            command.assert_not_called()

    def test_verified_worker_source_is_embedded_without_execution(self):
        raw=gate.payload()
        self.assertIn(b"staging_no_send_patch",raw)
        self.assertIn(b"def run_locked",raw)
        self.assertIn(b"NO_SEND_EFFECTIVE_PASS",raw)
        self.assertNotIn(b"systemctl stop asi",raw)
        self.assertNotIn(b"supabase db push",raw)

    def test_root_worker_does_not_default_to_execution(self):
        with patch.object(host.sys,"argv",["worker"]), patch.object(host,"run_locked") as actual:
            out=io.StringIO()
            with patch("sys.stdout",out):
                self.assertEqual(host.main(),2)
            actual.assert_not_called()
            self.assertIn('"status":"BLOCK"',out.getvalue())

    def test_worker_rejects_run_id_formats_before_state_access(self):
        with patch.object(host,"live_status") as live:
            for bad in ("","0","01","1;rm","two","-1"):
                with self.subTest(value=bad):
                    with self.assertRaises(host.Block):
                        host.perform(bad,"a"*40)
            live.assert_not_called()

    def test_only_expected_service_and_stage_paths(self):
        self.assertEqual(host.ENV.as_posix(), "/var/www/asi-staging/shared/.env.staging.local")
        self.assertEqual(host.SERVICE,"asi-landing-staging")
        self.assertEqual(host.OLD,"5c91b27bcde395f01cc078d1fbe454dd7436e1c6")
        self.assertNotIn("/var/www/asi/", host.ENV.as_posix())

    def test_metadata_flags_coverage(self):
        self.assertEqual(len(host.EXPECTED),6)
        self.assertEqual(host.TARGET,"ASI_SYNTHETIC_NO_SEND")

    def test_remote_failure_status_survives_nonzero_exit(self):
        for status in sorted(gate.REMOTE_BLOCK_CODES):
            with self.subTest(status=status):
                with self.assertRaises(gate.RemoteOutcome) as err:
                    gate.decode_remote_result(json.dumps({"status": status}).encode(), 2)
                self.assertEqual(err.exception.status, status)

    def test_success_requires_exact_fixed_receipt(self):
        expected = {"status": "NO_SEND_EFFECTIVE_PASS", "effectiveFlags": 7,
                    "databaseChanged": False, "releaseSwitched": False}
        self.assertEqual(gate.decode_remote_result(json.dumps(expected).encode(), 0), expected)
        forged = dict(expected, databaseChanged=True)
        with self.assertRaises(gate.RemoteOutcome) as result:
            gate.decode_remote_result(json.dumps(forged).encode(), 0)
        self.assertEqual(result.exception.status, "BLOCK_MANUAL_RECOVERY_REQUIRED")
        with self.assertRaises(gate.RemoteOutcome):
            gate.decode_remote_result(json.dumps(expected).encode(), 2)

    def test_untrusted_worker_receipt_never_becomes_approval(self):
        for raw in (b"", b"not-json", b'{"status":"READY_TO_DEPLOY"}'):
            with self.subTest(raw=raw[:20]):
                with self.assertRaises((gate.Block, gate.RemoteOutcome)):
                    gate.decode_remote_result(raw, 2)

    def test_malformed_or_oversized_remote_result_requires_recovery(self):
        invalid = (
            b"",
            b"not-json",
            b"null",
            b"[]",
            b"{" + b"x" * 5000 + b"}",
            b'{"status":"NO_SEND_EFFECTIVE_PASS"}',
        )
        for raw in invalid:
            with self.subTest(length=len(raw)):
                with self.assertRaises(gate.RemoteOutcome) as result:
                    gate.decode_remote_result(raw, 0)
                self.assertEqual(result.exception.status,
                                 "BLOCK_MANUAL_RECOVERY_REQUIRED")

    def test_main_preserves_manual_recovery_status(self):
        with patch.object(gate, "execute", side_effect=gate.RemoteOutcome(
                "BLOCK_MANUAL_RECOVERY_REQUIRED")):
            out = io.StringIO()
            with patch("sys.stdout", out):
                self.assertEqual(gate.main(), 2)
            self.assertEqual(json.loads(out.getvalue())["status"],
                             "BLOCK_MANUAL_RECOVERY_REQUIRED")

    def test_worker_deadline_blocks_expired_subprocess(self):
        import time
        with patch.object(host.subprocess, "run") as sp:
            with self.assertRaisesRegex(host.Block, "WORKER_DEADLINE_EXCEEDED"):
                host.checked("systemctl", "show", deadline=time.monotonic() - 1)
            sp.assert_not_called()
        self.assertLess(host.WORKER_LIMIT_SECONDS, gate.REMOTE_TOTAL_TIMEOUT)
        self.assertLess(gate.REMOTE_TOTAL_TIMEOUT, 600)
        self.assertGreater(host.ROLLBACK_RESERVE_SECONDS, 100)

    def test_worker_retries_transient_http_and_attribute_errors(self):
        import time
        import http.client
        with patch.object(host, "checked") as command, \
             patch.object(host, "live_status",
                          side_effect=[AttributeError("temporary"),
                                       http.client.IncompleteRead(b""),
                                       None]) as live, \
             patch.object(host.time, "sleep"):
            host.verified_restart(True, time.monotonic() + 20)
            self.assertEqual(live.call_count, 3)
            command.assert_called_once()

    def test_unexpected_exception_after_change_enters_rollback(self):
        from unittest.mock import MagicMock
        import tempfile
        import os
        original = (b"EMAIL_AUTO_SEND=false\n")
        patched = original + host.plan(original)["output"][len(original):]
        stat_info = MagicMock(st_uid=1001, st_gid=1000)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "evidence"
            with patch.object(host, "EVIDENCE_ROOT", root), \
                 patch.object(host, "live_status"), \
                 patch.object(host, "read_env",
                              side_effect=[(original, stat_info),
                                           (patched, stat_info),
                                           (patched, stat_info)]), \
                 patch.object(host, "write_private"), \
                 patch.object(host, "atomic_env") as atomic, \
                 patch.object(host, "verified_restart",
                              side_effect=[AttributeError("unexpected"),
                                           None]) as restart:
                outcome = host.perform("12345", "a"*40)
                self.assertEqual(outcome["status"],
                                 "ROLLBACK_PASS_NO_SEND_NOT_ACTIVATED")
                self.assertEqual(atomic.call_count, 2)
                self.assertEqual(restart.call_count, 2)

    def test_no_os_mutation_import_execution(self):
        # Importing workers only creates definitions; no implicit main action.
        self.assertTrue(callable(host.perform))
        self.assertTrue(callable(gate.execute))


if __name__ == "__main__":
    unittest.main()
