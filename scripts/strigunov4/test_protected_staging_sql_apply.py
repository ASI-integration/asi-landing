"""Offline, synthetic-only admission and SQL source security regression."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

# Host probe is supplied by source-pinned stdin on staging, never installed
# as an independent module on the repository runner.
sys.modules.setdefault("strigunov_reviewed_probe", types.SimpleNamespace(
    archive_verified=lambda:False, stage_state=lambda:["MISSING_NO_SEND"]
))

import staging_sql_host_admission as host
import protected_staging_sql_apply as m

SHA="a"*40

def sample():
    return {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":m.REPO,
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_WORKFLOW_REF":m.WORKFLOW,
        "GITHUB_ACTOR":m.OWNER,
        "GITHUB_ACTOR_ID":m.OWNER_ID,
        "GITHUB_TRIGGERING_ACTOR":m.OWNER,
        "GITHUB_RUN_ATTEMPT":"1",
        "GITHUB_RUN_ID":"39027482780",
        "GITHUB_SHA":SHA,
        "GITHUB_WORKFLOW_SHA":SHA,
        "STAGING_REVIEWED_MAIN_SHA":SHA,
        "STAGING_SQL_CONFIRM":"APPLY_STRIGUNOV4_NINE_SQL_"+SHA,
        "STAGING_SUPABASE_PROJECT_REF":m.PROJECT,
        "STAGING_DATABASE_URL":(
            "postgresql://postgres.meeravcldnmocjtlqoeu:FAKE_NOT_A_SECRET"
            "@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"),
        "STAGING_SSH_HOST":"stage.example.invalid",
        "STAGING_SSH_PORT":"22",
        "STAGING_SSH_USER":"project_ayfaar",
        "STAGING_SSH_PRIVATE_KEY":"THIS_IS_NOT_A_VALID_SSH_KEY_"+"X"*120,
    }


class ProtectedStagingSqlTests(unittest.TestCase):
    def test_format_only_validates_without_creating_authority(self):
        e=sample()
        sha,rid,url,host_name,port=m.validate_context(e)
        self.assertEqual(sha,SHA)
        self.assertEqual(rid,"39027482780")
        self.assertTrue(m.preflight.target_valid(url))
        self.assertEqual(port,22)

    def test_wrong_context_blocks_each_dimension(self):
        cases={
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"ASI-integration/other",
            "GITHUB_REF":"refs/heads/dev",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_WORKFLOW_REF":m.WORKFLOW.replace("main","development"),
            "GITHUB_ACTOR":"other",
            "GITHUB_ACTOR_ID":"999",
            "GITHUB_TRIGGERING_ACTOR":"other",
            "GITHUB_RUN_ATTEMPT":"2",
            "GITHUB_RUN_ID":"0",
            "GITHUB_SHA":"bad",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "STAGING_REVIEWED_MAIN_SHA":"b"*40,
            "STAGING_SQL_CONFIRM":"APPLY_NOW",
            "STAGING_SUPABASE_PROJECT_REF":"jwinifeienvzejofmbua",
            "STAGING_DATABASE_URL":"postgresql://postgres.jwinifeienvzejofmbua"
              ":FAKE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
            "STAGING_SSH_HOST":"-malicious",
            "STAGING_SSH_USER":"root",
            "STAGING_SSH_PORT":"0",
            "STAGING_SSH_PRIVATE_KEY":"",
        }
        for field,bad in cases.items():
            with self.subTest(field=field):
                ctx=sample()
                ctx[field]=bad
                with self.assertRaises(m.Gate):
                    m.validate_context(ctx)

    def test_no_incomplete_admission_reaches_network(self):
        with patch.object(m,"call") as command, patch.object(m,"check_host") as host_probe:
            with patch.dict(m.os.environ,{"GITHUB_REPOSITORY":m.REPO},clear=True):
                self.assertEqual(m.main(),2)
            command.assert_not_called()
            host_probe.assert_not_called()

    def test_source_bytes_pinned_before_network(self):
        with patch.object(m.sqlbuilder,"render",return_value="SELECT 1;"):
            with self.assertRaisesRegex(m.Gate,"NINE_SQL_SOURCE_DRIFT"):
                m.build_candidate()

    def test_same_sql_package_and_backup_identity(self):
        self.assertEqual(m.SQL_BYTES,55091)
        self.assertEqual(len(m.SQL_SHA256),64)
        self.assertEqual(m.LATEST_BACKUP_RUN,39023529319)
        self.assertEqual(m.LATEST_BACKUP_SHA256,host.BACKUP_SHA256)
        self.assertEqual(m.PROJECT,"meeravcldnmocjtlqoeu")
        self.assertEqual(len(m.SELECTED),9)
        self.assertEqual(len(m.PRESERVED),7)

    def test_host_script_contains_readonly_source(self):
        b=m.host_script()
        self.assertIn(b"strigunov_reviewed_probe",b)
        self.assertIn(b"STAGING_SQL_ADMISSION_PASS",b)
        self.assertNotIn(b"systemctl restart",b)
        self.assertNotIn(b"sudo -n psql",b)

    def test_host_fail_closed_if_no_send_missing(self):
        with patch.object(host.os,"getuid",return_value=1001,create=True), \
             patch.object(host.os,"uname",return_value=types.SimpleNamespace(nodename="asi-agent-runner"),create=True), \
             patch.object(host,"confirm_backup",return_value=True), \
             patch.object(host.probe,"archive_verified",return_value=True), \
             patch.object(host.probe,"stage_state",return_value=["NO_SEND_MISSING"]):
            b=io.StringIO()
            with contextlib.redirect_stdout(b):
                self.assertEqual(host.main(),2)
            report=json.loads(b.getvalue())
            self.assertEqual(report["status"],"BLOCK")
            self.assertFalse(report["no_send_ready"])

    def test_host_success_only_all_four_verified(self):
        with patch.object(host.os,"getuid",return_value=1001,create=True), \
             patch.object(host.os,"uname",return_value=types.SimpleNamespace(nodename="asi-agent-runner"),create=True), \
             patch.object(host,"confirm_backup",return_value=True), \
             patch.object(host.probe,"archive_verified",return_value=True), \
             patch.object(host.probe,"stage_state",return_value=[]):
            b=io.StringIO()
            with contextlib.redirect_stdout(b):
                self.assertEqual(host.main(),0)
            r=json.loads(b.getvalue())
            self.assertEqual(r["status"],"STAGING_SQL_ADMISSION_PASS")

    def test_db_url_is_staging_and_tls_verify_full(self):
        url=sample()["STAGING_DATABASE_URL"]
        readonly=m.db_environment(url,Path("roots.pem"),True)
        write=m.db_environment(url,Path("roots.pem"),False)
        self.assertEqual(readonly["PGSSLMODE"],"verify-full")
        self.assertEqual(readonly["PGDATABASE"],"postgres")
        self.assertIn("default_transaction_read_only=on",readonly["PGOPTIONS"])
        self.assertIn("default_transaction_read_only=off",write["PGOPTIONS"])
        self.assertNotIn("PGSERVICE",readonly)
        with self.assertRaises(m.Gate):
            m.db_environment("postgresql://postgres:FAKE@db.jwinifeienvzejofmbua.supabase.co:5432/postgres",
                             Path("roots.pem"),True)

    def test_docker_command_one_selected_sql_and_only_pg_secrets(self):
        uid = patch.object(m.os,"getuid",return_value=1001,create=True)
        gid = patch.object(m.os,"getgid",return_value=1001,create=True)
        uid.start(); gid.start()
        self.addCleanup(uid.stop); self.addCleanup(gid.stop)
        with patch.object(m.os,"getuid",return_value=1001,create=True), \
             patch.object(m.os,"getgid",return_value=1001,create=True):
            cmd=m.postgres_client_command(Path("/tmp/test"),"apply","/work/nine.sql")
        self.assertIn("--network",cmd)
        self.assertIn("host",cmd)
        self.assertIn("--read-only",cmd)
        self.assertIn("no-new-privileges",cmd)
        self.assertIn(m.PG_IMAGE,cmd)
        self.assertEqual(cmd[-2:],["--file","/work/nine.sql"])
        self.assertNotIn("PGPASSWORD=FAKE_NOT_A_SECRET",cmd)
        with self.assertRaisesRegex(m.Gate,"REVIEWED_APPLY_FILE_ONLY"):
            m.postgres_client_command(Path("/tmp/test"),"apply","/work/all.sql")
        for action in ("preflight","postcheck"):
            ro=m.postgres_client_command(Path("/tmp/test"),action)
            self.assertIn("-c",ro)
            self.assertIn("schema_migrations",ro[-1])

    def test_unknown_action_is_rejected(self):
        with self.assertRaises(m.Gate):
            m.postgres_client_command(Path("/tmp/test"),"drop_database")

    def test_no_sql_run_without_host_preconditions(self):
        with patch.object(m,"validate_context",return_value=(SHA,"1",
                sample()["STAGING_DATABASE_URL"],"stage.example.invalid",22)), \
             patch.object(m,"call",return_value=(SHA+"\n").encode()), \
             patch.object(m,"build_candidate",return_value=b"correct_pinned_bytes"), \
             patch.object(m,"check_host",side_effect=m.Gate("HOST_NO_SEND_OR_BACKUP_BLOCK")), \
             patch.object(m,"postgres_stage") as apply:
            with patch.dict(m.os.environ,{},clear=True):
                self.assertEqual(m.main(),2)
            apply.assert_not_called()

    def test_exact_postcommit_readback_pass(self):
        self.assertTrue(m.verified_postcommit_readback(
            lambda: b"postgres|17|99|7|9\n"))

    def test_postcommit_failures_require_manual_reconciliation(self):
        failures = (
            lambda: b"postgres|17|90|7|0\n",
            lambda: b"postgres|17|99|7|8\n",
            lambda: b"\xff",
            lambda: None,
            lambda: (_ for _ in ()).throw(m.Gate("COMMAND_FAILED")),
            lambda: (_ for _ in ()).throw(TimeoutError("synthetic timeout")),
            lambda: (_ for _ in ()).throw(RuntimeError("bad parse")),
        )
        for read in failures:
            with self.subTest(kind=str(read)):
                with self.assertRaisesRegex(
                        m.Gate,"POST_APPLY_HISTORY_REQUIRES_REVIEW"):
                    m.verified_postcommit_readback(read)

    def test_main_distinguishes_started_sql_from_preflight_failure(self):
        for reason, expect in (
            ("SQL_APPLY_RESULT_UNKNOWN_OR_REJECTED",
             "SQL_STATE_REQUIRES_RECONCILIATION"),
            ("POST_APPLY_HISTORY_REQUIRES_REVIEW",
             "SQL_STATE_REQUIRES_RECONCILIATION"),
            ("HOST_BACKUP_OR_NO_SEND_BLOCK","BLOCK"),
        ):
            with self.subTest(reason=reason), \
                 patch.object(m,"validate_context",return_value=(
                     SHA,"1",sample()["STAGING_DATABASE_URL"],
                     "stage.example.invalid",22)), \
                 patch.object(m,"call",return_value=(SHA+"\n").encode()), \
                 patch.object(m,"build_candidate",return_value=b"synthetic"), \
                 patch.object(m,"check_host",return_value=True), \
                 patch.object(m,"postgres_stage",side_effect=m.Gate(reason)), \
                 patch.dict(m.os.environ,{},clear=True):
                out=io.StringIO()
                with contextlib.redirect_stdout(out):
                    status=m.main()
                self.assertEqual(status,2)
                result=json.loads(out.getvalue())
                self.assertEqual(result["status"],expect)
                self.assertEqual(result["reason"],reason)

    def test_no_credentials_echoed_by_source(self):
        source=Path(m.__file__).read_text(encoding="utf-8")
        self.assertNotIn("print(url)",source)
        self.assertNotIn("print(os.environ)",source)
        self.assertNotIn("supabase db push",source)
        self.assertNotIn("production-migration-approval",source)


if __name__=="__main__":
    unittest.main()
