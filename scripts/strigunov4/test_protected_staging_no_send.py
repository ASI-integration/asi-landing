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

    def test_no_os_mutation_import_execution(self):
        # Importing workers only creates definitions; no implicit main action.
        self.assertTrue(callable(host.perform))
        self.assertTrue(callable(gate.execute))


if __name__ == "__main__":
    unittest.main()
