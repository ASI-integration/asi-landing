"""Offline tests for GitHub-owned, main-only G0 staging systemd activation."""
import io
import os
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import protected_staging_g0_activation as gate


def synthetic_env():
    return {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":gate.REPO,
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_WORKFLOW_REF":gate.WORKFLOW,
        "GITHUB_ACTOR":gate.OWNER,
        "GITHUB_ACTOR_ID":gate.OWNER_ID,
        "GITHUB_TRIGGERING_ACTOR":gate.OWNER,
        "GITHUB_RUN_ATTEMPT":"1",
        "GITHUB_SHA":"a"*40,
        "GITHUB_WORKFLOW_SHA":"a"*40,
        "STAGING_REVIEWED_MAIN_SHA":"a"*40,
        "STAGING_ACTIVATE_CONFIRM":"ACTIVATE_STRIGUNOV4_G0_"+"a"*40,
        "GITHUB_RUN_ID":"39031172658",
        "STAGING_SUPABASE_PROJECT_REF":gate.PROJECT,
        "STAGING_DATABASE_URL":"postgresql://postgres.meeravcldnmocjtlqoeu:synthetic@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        "STAGING_SSH_HOST":"host.example.invalid",
        "STAGING_SSH_PORT":"22",
        "STAGING_SSH_USER":"project_ayfaar",
        "STAGING_SSH_PRIVATE_KEY":"TEST_NOT_A_REAL_KEY_"+"a"*130,
    }


class OwnerProtectedTests(unittest.TestCase):
    def test_valid_context_is_not_auth(self):
        self.assertEqual(gate.validate(synthetic_env()),
                         ("a"*40,"39031172658","host.example.invalid",22))

    def test_mismatches_block_all_context_dimensions(self):
        updates = {
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"another",
            "GITHUB_REF":"refs/heads/feature",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_WORKFLOW_REF":gate.WORKFLOW.replace("main","feature"),
            "GITHUB_ACTOR":"wrong-owner",
            "GITHUB_ACTOR_ID":"3",
            "GITHUB_TRIGGERING_ACTOR":"someone-else",
            "GITHUB_RUN_ATTEMPT":"2",
            "GITHUB_SHA":"ab",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "STAGING_REVIEWED_MAIN_SHA":"b"*40,
            "STAGING_ACTIVATE_CONFIRM":"ACTIVATE_G0_EARLY",
            "GITHUB_RUN_ID":"0",
            "STAGING_SUPABASE_PROJECT_REF":"jwinifeienvzejofmbua",
            "STAGING_DATABASE_URL":"postgresql://postgres.jwinifeienvzejofmbua:test@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
            "STAGING_SSH_HOST":"-danger",
            "STAGING_SSH_PORT":"100000",
            "STAGING_SSH_USER":"root",
            "STAGING_SSH_PRIVATE_KEY":"",
        }
        for key, value in updates.items():
            with self.subTest(key=key):
                env=synthetic_env()
                env[key]=value
                with self.assertRaises(gate.Block):
                    gate.validate(env)

    def test_untrusted_context_stops_before_subprocess(self):
        with patch.object(gate, "checked") as command, \
             patch.object(gate, "db_read_only_acceptance") as db, \
             patch.object(gate, "remote_activate") as remote:
            with self.assertRaises(gate.Block):
                gate.perform({"GITHUB_REF":"refs/heads/main"})
            command.assert_not_called()
            db.assert_not_called()
            remote.assert_not_called()

    def test_protected_payload_only_local_reviewed_code(self):
        program=gate.source_payload()
        self.assertIn(b"g0_release_archive",program)
        self.assertIn(b"g0_safe_extract",program)
        self.assertIn(b"NO_SEND_EFFECTIVE_BLOCK",program)
        compile(program, "<fixed-reviewed-g0-payload>", "exec")

    def test_release_and_db_are_exactly_bound(self):
        self.assertEqual(gate.RELEASE,"d912aec6663de90e5ca4293cc5a69e2e0ed9ff94")
        self.assertEqual(gate.SQL_SHA,"ba963872a534fb1a6852f427372ff81e498e115b92f8a98e899ba2f482e5b959")
        self.assertEqual(gate.PROJECT,"meeravcldnmocjtlqoeu")
        with patch.object(gate.sql_gate.os,"getuid",create=True,return_value=1000), \
             patch.object(gate.sql_gate.os,"getgid",create=True,return_value=1000):
            cmd=gate.sql_gate.postgres_client_command(Path("/tmp/test"),"postcheck")
        self.assertNotIn("--file",cmd)
        self.assertEqual(cmd[-2],"-c")
        self.assertIn("supabase_migrations.schema_migrations",cmd[-1])

    def test_no_deploy_until_host_and_db_accepted(self):
        with patch.object(gate, "checked_source"), \
             patch.object(gate.sql_gate, "check_host", side_effect=gate.sql_gate.Gate("NO_SEND_BLOCK")), \
             patch.object(gate, "db_read_only_acceptance") as db, \
             patch.object(gate, "remote_activate") as remote:
            with self.assertRaises(gate.sql_gate.Gate):
                gate.perform(synthetic_env())
            db.assert_not_called()
            remote.assert_not_called()

    def test_no_deploy_if_nine_sql_not_committed(self):
        with patch.object(gate, "checked_source"), \
             patch.object(gate.sql_gate, "check_host", return_value=True), \
             patch.object(gate, "db_read_only_acceptance", side_effect=gate.Block("NOT_99")):
            with patch.object(gate, "remote_activate") as remote:
                with self.assertRaises(gate.Block):
                    gate.perform(synthetic_env())
                remote.assert_not_called()

    def test_no_automatic_filesystem_side_effect_on_import(self):
        self.assertTrue(callable(gate.perform))
        self.assertTrue(callable(gate.remote_activate))
        self.assertNotIn("os.system(", Path(gate.__file__).read_text())

    def test_db_read_only_uses_pinned_postcommit_shape(self):
        import inspect
        source=inspect.getsource(gate.db_read_only_acceptance)
        self.assertIn("postcheck",source)
        self.assertIn("postgres|17|99|7|9",source)
        self.assertNotIn('"apply"',source)

    def test_remote_failure_statuses_stay_visible_without_secrets(self):
        import contextlib
        for status in (
            "BLOCK_BEFORE_ACTIVATION",
            "ACTIVATION_FAILED_APP_ROLLBACK_PASS",
            "ACTIVATION_FAILED_MANUAL_RECOVERY",
        ):
            with self.subTest(status=status), \
                 patch.object(gate,"source_payload",return_value=b"fixed"), \
                 patch.object(gate.backup_export,"ssh_identity",return_value=Path("known_hosts")), \
                 patch.object(gate.subprocess,"run") as run:
                run.return_value.returncode=2
                run.return_value.stdout=json.dumps({
                    "status":status,"secret":"private-canary-never-display"
                }).encode()
                run.return_value.stderr=b"other sensitive canary"
                sink=io.StringIO()
                with contextlib.redirect_stderr(sink), self.assertRaises(gate.Block):
                    gate.remote_activate(synthetic_env(),"host.example.invalid",22,
                                         "39031172658","a"*40,gate.SOURCE_ROOT)
                notice=json.loads(sink.getvalue())
                self.assertEqual(notice, {"remoteStatus":status})
                self.assertNotIn("canary",sink.getvalue())
                self.assertNotIn("other sensitive",sink.getvalue())

    def test_disallow_unsafe_status_from_remote(self):
        # The remote result must never count as a pass without verified bits.
        with patch.object(gate, "source_payload", return_value=b"fixed"), \
             patch.object(gate.backup_export, "ssh_identity") as pinned, \
             patch.object(gate.subprocess, "run") as run:
            pinned.return_value=Path("known_hosts")
            run.return_value.returncode=0
            run.return_value.stdout=b'{"status":"G0_STAGING_ACTIVATION_PASS"}'
            with self.assertRaises(gate.Block):
                gate.remote_activate(synthetic_env(),"host.example.invalid",22,
                                     "39031172658","a"*40,gate.SOURCE_ROOT)


if os.name != "nt":
    import g0_staging_host as worker

    class LinuxHostTests(unittest.TestCase):
        def _record_and_fd(self):
            fd=os.open(os.devnull,os.O_RDONLY)
            return fd,Path("/private-test-receipt")

        def test_activation_rollback_on_service_failure(self):
            with patch.object(worker, "journal_start", side_effect=lambda *_:self._record_and_fd()), \
                 patch.object(worker, "runtime", return_value={"noSendFlags":7}), \
                 patch.object(worker, "releases_scope"), \
                 patch.object(worker, "verify_quarantine",
                              return_value=(Path("/private/test.tgz"),{"status":"G0_TAR_CONTRACT_PASS"})), \
                 patch.object(worker, "prepare_release",return_value=worker.RELEASES/worker.NEW), \
                 patch.object(worker,"atomic_current") as swap, \
                 patch.object(worker,"checked", side_effect=[worker.Block("RESTART_FAILED"),b""]) as restart, \
                 patch.object(worker,"wait_runtime",return_value={"noSendFlags":7}), \
                 patch.object(worker,"log_result"):
                report=worker.activate("1","a"*40)
                self.assertEqual(report["status"],"ACTIVATION_FAILED_APP_ROLLBACK_PASS")
                self.assertEqual(swap.call_count,2)
                self.assertEqual(restart.call_count,2)

        def test_owner_only_old_release_is_pinned(self):
            self.assertEqual(worker.OLD,"5c91b27bcde395f01cc078d1fbe454dd7436e1c6")
            self.assertEqual(worker.SERVICE,"asi-landing-staging")
            self.assertEqual(len(worker.EXPECTED_ENV),7)
            self.assertEqual(worker.NEW,gate.RELEASE)


if __name__=="__main__":
    unittest.main()
