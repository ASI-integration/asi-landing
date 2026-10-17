"""Credential-free negative acceptance for protected stage C4 read-only gate."""
import contextlib
import io
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import c4_staging_readonly_probe as c4

SHA="a"*40
def good():
    return {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":c4.REPO,
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_WORKFLOW_REF":c4.WORKFLOW,
        "GITHUB_ACTOR":c4.OWNER,
        "GITHUB_ACTOR_ID":"207600140",
        "GITHUB_TRIGGERING_ACTOR":c4.OWNER,
        "GITHUB_RUN_ATTEMPT":"1",
        "GITHUB_SHA":SHA,
        "GITHUB_WORKFLOW_SHA":SHA,
        "C4_REVIEWED_MAIN_SHA":SHA,
        "C4_CONFIRM":"RUN_STRIGUNOV4_C4_PREFLIGHT_"+SHA,
        "STAGING_SUPABASE_PROJECT_REF":c4.pg.PROJECT,
        "STAGING_DATABASE_URL":"postgresql://postgres.meeravcldnmocjtlqoeu:FAKE_NOT_SECRET@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        "STAGING_SSH_HOST":"stage.example.invalid",
        "STAGING_SSH_USER":"project_ayfaar",
        "STAGING_SSH_PORT":"22",
        "STAGING_SSH_PRIVATE_KEY":"FAKE_NO_SECRET_"+"X"*140,
    }

class ProtectedC4ReadOnlyTests(unittest.TestCase):
    def test_healthy_context(self):
        self.assertEqual(c4.validate(good()),(SHA,"stage.example.invalid",22))

    def test_each_wrong_context_denied(self):
        cases={
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"other/repo",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_REF":"refs/heads/feature",
            "GITHUB_WORKFLOW_REF":"bad/workflow",
            "GITHUB_ACTOR":"stranger",
            "GITHUB_ACTOR_ID":"1",
            "GITHUB_TRIGGERING_ACTOR":"someone",
            "GITHUB_RUN_ATTEMPT":"2",
            "GITHUB_SHA":"bad",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "C4_REVIEWED_MAIN_SHA":"b"*40,
            "C4_CONFIRM":"RUN_ANY",
            "STAGING_SUPABASE_PROJECT_REF":"jwinifeienvzejofmbua",
            "STAGING_DATABASE_URL":"postgresql://postgres.jwinifeienvzejofmbua:FAKE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
            "STAGING_SSH_HOST":"-e command",
            "STAGING_SSH_USER":"root",
            "STAGING_SSH_PORT":"0",
            "STAGING_SSH_PRIVATE_KEY":"",
        }
        for key,wrong in cases.items():
            with self.subTest(key=key):
                env=good();env[key]=wrong
                with self.assertRaises(c4.Block):
                    c4.validate(env)

    def test_missing_admission_never_touches_db_or_server(self):
        with patch.object(c4.g0,"checked") as process, \
             patch.object(c4.g0,"exact_sql_history") as database, \
             patch.object(c4,"probe") as remote:
            with self.assertRaises(c4.Block):
                c4.run({"GITHUB_ACTIONS":"true"})
            process.assert_not_called()
            database.assert_not_called()
            remote.assert_not_called()

    def test_readonly_db_block_precedes_ssh(self):
        with patch.object(c4,"validate",return_value=(SHA,"stage.example.invalid",22)), \
             patch.object(c4.g0,"checked",return_value=types.SimpleNamespace(stdout=(SHA+"\n").encode())), \
             patch.object(c4.g0,"exact_sql_history",side_effect=c4.Block("HISTORY")), \
             patch.object(c4,"probe") as remote:
            with self.assertRaises(c4.Block):
                c4.run(good())
            remote.assert_not_called()

    def test_fixed_host_probe_is_readonly_and_checks_real_no_send(self):
        source=c4.HOST_SCRIPT
        for fragment in ("MainPID","/proc","environ","EFFECTIVE_NO_SEND",
                         "resolvedReleasePath","/api/dashboard/booking-ops/intake/process",
                         "urllib.error.HTTPError","STAGING_G0","401"):
            if fragment=="STAGING_G0": continue
            self.assertIn(fragment,source)
        self.assertNotIn("DELETE FROM",source)
        self.assertNotIn("db push",source)
        self.assertNotIn("systemctl restart",source)
        self.assertNotIn("exec(",source)
        self.assertNotIn("subprocess.Popen",source)

    def test_host_success_receipt_and_reject_extra_fields(self):
        expected={"status":"C4_READONLY_PREFLIGHT_PASS","releaseSha":c4.RELEASE,
                  "noSendFlags":7,"unauthorizedRoutes":5,
                  "stagingWrites":False,"fullE2E":"NOT_RUN"}
        for mutation in [None,{"extra":"not-reviewed"},{"noSendFlags":6}]:
            receipt=dict(expected)
            if mutation:receipt.update(mutation)
            with self.subTest(mutation=mutation), \
                 patch.object(c4.backup_export,"ssh_identity",return_value=Path("/tmp/hosts")), \
                 patch.object(c4.g0,"checked",return_value=types.SimpleNamespace(returncode=0,stdout=json.dumps(receipt).encode())):
                if mutation:
                    with self.assertRaises(c4.Block):
                        c4.probe(good(),"stage.example.invalid",22)
                else:
                    self.assertEqual(c4.probe(good(),"stage.example.invalid",22),expected)

    def test_main_distinguishes_block_from_full_e2e(self):
        output=io.StringIO()
        with patch.object(c4,"run",side_effect=c4.Block("NO_REAL_APPROVAL")),\
             contextlib.redirect_stdout(output):
            self.assertEqual(c4.main(),2)
        self.assertEqual(json.loads(output.getvalue()),
                         {"status":"BLOCK","fullE2E":"NOT_RUN"})

if __name__=="__main__":
    unittest.main()
