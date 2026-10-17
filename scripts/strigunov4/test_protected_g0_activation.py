"""No-network, no-credential tests for protected Strigunov4 G0 activation."""
import contextlib
import io
import json
import os
import tempfile
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch, MagicMock

import g0_release_archive as tar_audit

# The protected remote runner embeds this exact reviewed module from main.
sys.modules.setdefault("strigunov_g0_archive",tar_audit)
import g0_activation_host as host
import protected_staging_g0_activation as gate

SHA="a"*40
def good():
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
        "GITHUB_RUN_ID":"39029289481",
        "GITHUB_SHA":SHA,
        "GITHUB_WORKFLOW_SHA":SHA,
        "STAGING_REVIEWED_MAIN_SHA":SHA,
        "G0_ACTIVATION_CONFIRM":"ACTIVATE_STRIGUNOV4_G0_"+SHA,
        "STAGING_SUPABASE_PROJECT_REF":gate.pg.PROJECT,
        "STAGING_DATABASE_URL":"postgresql://postgres.meeravcldnmocjtlqoeu:FAKE_NOT_SECRET@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        "STAGING_SSH_HOST":"stage.example.invalid",
        "STAGING_SSH_USER":"project_ayfaar",
        "STAGING_SSH_PORT":"22",
        "STAGING_SSH_PRIVATE_KEY":"FAKE_KEY_NOT_SECRET_"+"Z"*120,
    }


class ActivationTests(unittest.TestCase):
    def test_admission_exact_context_only(self):
        self.assertEqual(gate.context(good()),
                         (SHA,"39029289481",good()["STAGING_DATABASE_URL"],
                          "stage.example.invalid",22))

    def test_individual_mutations_block_without_network(self):
        mutations={
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"other/repo",
            "GITHUB_REF":"refs/heads/feature",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_WORKFLOW_REF":gate.WORKFLOW.replace("main","feature"),
            "GITHUB_ACTOR":"other",
            "GITHUB_ACTOR_ID":"1",
            "GITHUB_TRIGGERING_ACTOR":"other",
            "GITHUB_RUN_ATTEMPT":"2",
            "GITHUB_RUN_ID":"0",
            "GITHUB_SHA":"invalid",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "STAGING_REVIEWED_MAIN_SHA":"b"*40,
            "G0_ACTIVATION_CONFIRM":"INSTALL_ANYTHING",
            "STAGING_SUPABASE_PROJECT_REF":"jwinifeienvzejofmbua",
            "STAGING_DATABASE_URL":"postgresql://postgres.jwinifeienvzejofmbua:FAKE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
            "STAGING_SSH_HOST":"-proxy",
            "STAGING_SSH_USER":"root",
            "STAGING_SSH_PORT":"0",
            "STAGING_SSH_PRIVATE_KEY":"",
        }
        for name,bad in mutations.items():
            with self.subTest(name=name):
                env=good();env[name]=bad
                with self.assertRaises(gate.Gate):
                    gate.context(env)

    def test_incomplete_admission_blocks_before_any_subprocess(self):
        with patch.object(gate,"checked") as command, \
             patch.object(gate,"exact_sql_history") as db, \
             patch.object(gate,"activate_host") as remote:
            with self.assertRaises(gate.Gate):
                gate.run({"GITHUB_REPOSITORY":gate.REPO})
            command.assert_not_called()
            db.assert_not_called()
            remote.assert_not_called()

    def test_no_host_writes_before_db_99(self):
        with patch.object(gate,"context",return_value=(
                SHA,"1",good()["STAGING_DATABASE_URL"],
                "stage.example.invalid",22)),\
             patch.object(gate,"checked",return_value=types.SimpleNamespace(stdout=(SHA+"\n").encode())),\
             patch.object(gate,"exact_sql_history",side_effect=gate.Gate("NINE_SQL_NOT_APPLIED")),\
             patch.object(gate,"activate_host") as remote:
            with self.assertRaisesRegex(gate.Gate,"NINE_SQL_NOT_APPLIED"):
                gate.run(good())
            remote.assert_not_called()

    def test_reviewed_host_code_is_pinned_source_not_user_text(self):
        out=gate.host_source()
        self.assertIn(b"strigunov_g0_archive",out)
        self.assertIn(b"safe_copy_unpack",out)
        self.assertIn(b"APPLICATION_ROLLBACK_PASS",out)
        self.assertNotIn(b"supabase db push",out)

    def test_host_requires_root(self):
        with patch.object(host.os,"geteuid",return_value=1001,create=True):
            with self.assertRaisesRegex(host.Block,"ROOT_AND_HOST_IDENTITY"):
                host.service_identity(host.OLD_SHA)

    def test_replay_invalid_id_blocked_early(self):
        with patch.object(host,"activation") as activate:
            for bad in ("","0","01","abc","1;rm","-1"):
                with self.subTest(bad=bad),self.assertRaises(host.Block):
                    host.locked_activation(bad,SHA)
            activate.assert_not_called()

    def test_strict_release_bounds(self):
        self.assertEqual(host.OLD_SHA,"5c91b27bcde395f01cc078d1fbe454dd7436e1c6")
        self.assertEqual(host.NEW.name,tar_audit.SHA)
        self.assertEqual(str(host.ROOT).replace("\\","/"),"/var/www/asi-staging")
        self.assertEqual(len(host.EXPECTED),7)
        self.assertEqual(tar_audit.ARCHIVE_BYTES,229060580)

    def _activation_fakes(self):
        link=MagicMock()
        link.is_symlink.return_value=True
        link.resolve.return_value=host.OLD
        return link

    def test_health_or_start_failure_rolls_back_to_old(self):
        link=self._activation_fakes()
        def wait(sha):
            if sha==tar_audit.SHA:
                raise host.Block("SYNTHETIC_NEW_RELEASE_NOT_HEALTHY")
        with patch.object(host,"service_identity"),\
             patch.object(host,"pinned_quarantine"),\
             patch.object(host,"safe_copy_unpack"),\
             patch.object(host,"CURRENT",link),\
             patch.object(host,"command") as command,\
             patch.object(host,"swap") as swap,\
             patch.object(host,"wait_for",side_effect=wait):
            report=host.activation("1",SHA)
            self.assertEqual(report["status"],"APPLICATION_ROLLBACK_PASS")
            self.assertEqual(swap.call_count,2)
            self.assertEqual(swap.call_args_list[0].args[0],tar_audit.SHA)
            self.assertEqual(swap.call_args_list[1].args[0],host.OLD_SHA)
            self.assertEqual(command.call_count,4)

    def test_success_requires_new_release_effective_health(self):
        link=self._activation_fakes()
        with patch.object(host,"service_identity"),\
             patch.object(host,"pinned_quarantine"),\
             patch.object(host,"safe_copy_unpack"),\
             patch.object(host,"CURRENT",link),\
             patch.object(host,"command") as command,\
             patch.object(host,"swap") as swap,\
             patch.object(host,"wait_for") as wait:
            report=host.activation("1",SHA)
            self.assertEqual(report["status"],"STAGING_G0_ACTIVATION_PASS")
            wait.assert_called_once_with(tar_audit.SHA)
            swap.assert_called_once_with(tar_audit.SHA)
            self.assertEqual(report["databaseMutation"],False)

    def test_worker_fails_closed_without_authorized_invocation(self):
        with patch.object(host.sys,"argv",["worker"]),patch.object(host,"locked_activation") as action:
            buffer=io.StringIO()
            with contextlib.redirect_stdout(buffer):
                result=host.main()
            self.assertEqual(result,2)
            action.assert_not_called()
            self.assertEqual(json.loads(buffer.getvalue())["status"],"BLOCK")

    @unittest.skipUnless(sys.platform.startswith("linux"), "requires Linux renameat2")
    def test_publish_never_overwrites_existing_release(self):
        with tempfile.TemporaryDirectory(prefix="g0-noreplace-") as tmp:
            root=Path(tmp)
            before=root/"existing"
            candidate=root/"candidate"
            before.mkdir()
            candidate.mkdir()
            with patch.object(host,"RELEASES",root),\
                 self.assertRaisesRegex(host.Block,
                                        "RELEASE_TARGET_EXISTS_OR_PUBLISH_FAILED"):
                host.publish_new_dir(candidate,before)
            self.assertTrue(before.is_dir())
            self.assertTrue(candidate.is_dir())

    @unittest.skipUnless(sys.platform.startswith("linux"), "requires Linux renameat2")
    def test_publish_moves_into_absent_path_only(self):
        with tempfile.TemporaryDirectory(prefix="g0-noreplace-") as tmp:
            root=Path(tmp)
            candidate=root/"candidate"
            dest=root/"new"
            candidate.mkdir()
            with patch.object(host,"RELEASES",root):
                host.publish_new_dir(candidate,dest)
            self.assertTrue(dest.is_dir())
            self.assertFalse(candidate.exists())

    def test_host_failure_status_is_retained_but_untrusted_output_is_hidden(self):
        known=("APPLICATION_ROLLBACK_PASS","BLOCK_MANUAL_RECOVERY_REQUIRED","BLOCK")
        for host_status in (*known,"secret:unsafe"):
            with self.subTest(host_status=host_status), \
                 patch.object(gate,"host_source",return_value=b"pass"), \
                 patch.object(gate.backup_export,"ssh_identity",return_value=Path("/tmp/known_hosts")), \
                 patch.object(gate,"checked",return_value=types.SimpleNamespace(
                     returncode=2,stdout=json.dumps({"status":host_status}).encode("utf-8"))):
                safe=host_status if host_status in known else "UNKNOWN"
                with self.assertRaisesRegex(gate.Gate,"G0_ACTIVATION_NOT_PROVEN_"+safe):
                    gate.activate_host(good(),SHA,"123","stage.example.invalid",22)

    def test_main_reports_sanitized_gate_reason(self):
        for error,expected in (
            ("G0_ACTIVATION_NOT_PROVEN_BLOCK_MANUAL_RECOVERY_REQUIRED",
             "G0_ACTIVATION_NOT_PROVEN_BLOCK_MANUAL_RECOVERY_REQUIRED"),
            ("secret:unsafe","UNKNOWN")
        ):
            with self.subTest(error=error), \
                 patch.object(gate,"run",side_effect=gate.Gate(error)):
                stream=io.StringIO()
                with contextlib.redirect_stdout(stream):
                    self.assertEqual(gate.main(),2)
                result=json.loads(stream.getvalue())
                self.assertEqual(result["status"],"BLOCK")
                self.assertEqual(result["reason"],expected)
                self.assertIs(result["databaseMutation"],False)
                self.assertIs(result["productionTouched"],False)

    def test_no_production_or_sentinel_mutations_in_source(self):
        root=Path(host.__file__).read_text(encoding="utf-8")
        self.assertNotIn("systemctl restart asi-landing-production",root)
        self.assertNotIn("/var/www/asi/current",root)
        self.assertNotIn("supabase db push",root)


if __name__=="__main__":
    unittest.main()
