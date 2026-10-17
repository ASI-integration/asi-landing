"""No-credential source and fail-closed admission tests for physical C4."""
import pathlib
import types
import unittest
from unittest.mock import patch

import c4_physical_approved_gate as gate

SHA = "a" * 40
def valid():
    return {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":gate.REPO,
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_WORKFLOW_REF":gate.WORKFLOW,
        "GITHUB_ACTOR":"ASI-integration",
        "GITHUB_ACTOR_ID":"207600140",
        "GITHUB_TRIGGERING_ACTOR":"ASI-integration",
        "GITHUB_RUN_ATTEMPT":"1",
        "GITHUB_SHA":SHA,
        "GITHUB_WORKFLOW_SHA":SHA,
        "C4_REVIEWED_MAIN_SHA":SHA,
        "C4_CONFIRM":"RUN_STRIGUNOV4_C4_PHYSICAL_"+SHA,
        "GITHUB_RUN_ID":"39040347972",
        "STAGING_SUPABASE_PROJECT_REF":gate.PROJECT,
        "STAGING_SSH_USER":"project_ayfaar",
        "STAGING_SSH_HOST":"100.116.142.101",
        "STAGING_SSH_PORT":"22",
        "STAGING_SSH_PRIVATE_KEY":"FAKE_NOT_A_REAL_KEY_"+"Y"*130,
        "STAGING_DATABASE_URL":("postgresql://postgres.meeravcldnmocjtlqoeu:FAKE"
                                "@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"),
        "STAGING_SUPABASE_URL":"https://meeravcldnmocjtlqoeu.supabase.co",
        "STAGING_SUPABASE_SERVICE_ROLE_KEY":"FAKE_ROLE_KEY_"+"X"*70,
        "STAGING_SESSION_SECRET":"FAKE_SESSION_SECRET_"+"X"*70,
    }

class PhysicalGateTests(unittest.TestCase):
    def test_accepted_context_is_not_authority_itself(self):
        self.assertEqual(gate.context(valid()),(SHA,"39040347972","100.116.142.101",22))

    def test_each_unauthorized_dimension_denied(self):
        cases={
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"other/repo",
            "GITHUB_REF":"refs/heads/test",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_WORKFLOW_REF":"other/workflow",
            "GITHUB_ACTOR":"another-user",
            "GITHUB_ACTOR_ID":"42",
            "GITHUB_TRIGGERING_ACTOR":"another-user",
            "GITHUB_RUN_ATTEMPT":"2",
            "GITHUB_SHA":"invalid",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "C4_REVIEWED_MAIN_SHA":"b"*40,
            "C4_CONFIRM":"RUN_ANY",
            "GITHUB_RUN_ID":"0",
            "STAGING_SUPABASE_PROJECT_REF":"jwinifeienvzejofmbua",
            "STAGING_SSH_USER":"root",
            "STAGING_SSH_HOST":"-ProxyCommand=evil",
            "STAGING_SSH_PORT":"65536",
            "STAGING_SSH_PRIVATE_KEY":"",
            "STAGING_SUPABASE_URL":"https://jwinifeienvzejofmbua.supabase.co",
            "STAGING_SUPABASE_SERVICE_ROLE_KEY":"",
            "STAGING_SESSION_SECRET":"",
        }
        for key,wrong in cases.items():
            with self.subTest(key=key):
                e=valid();e[key]=wrong
                with self.assertRaises(gate.Gate):
                    gate.context(e)

    def test_missing_approval_prevents_all_subprocesses(self):
        with patch.object(gate.g0,"checked") as command, \
             patch.object(gate.g0,"exact_sql_history") as db, \
             patch.object(gate.verified,"probe") as staging:
            with self.assertRaises(gate.Gate):
                gate.run({"GITHUB_REF":"refs/heads/main"})
            command.assert_not_called()
            db.assert_not_called()
            staging.assert_not_called()

    def test_failed_pg_history_never_touches_staging(self):
        with patch.object(gate.g0,"checked",return_value=types.SimpleNamespace(
                    stdout=(SHA+"\n").encode())), \
             patch.object(gate.g0,"exact_sql_history",
                    side_effect=gate.Gate("NOT_APPLIED")), \
             patch.object(gate.verified,"probe") as staging:
            with self.assertRaises(gate.Gate):
                gate.run(valid())
            staging.assert_not_called()

    def test_physical_source_exact_ids_and_no_claim_of_proven_egress(self):
        source=(pathlib.Path(__file__).parent/"c4_physical_staging_lifecycle.mjs").read_text()
        self.assertIn("C4_PHYSICAL_APPROVED",source)
        self.assertIn("C4_PHYSICAL_CORE_PASS",source)
        self.assertIn("NO_SENT_INTENT_FOR_FIXTURE",source)
        self.assertIn("127.0.0.1:3001",source)
        self.assertIn("realExternalEffectsIndependentProof: 'NOT_ESTABLISHED'",source)
        self.assertIn("booking_ops_records",source)
        self.assertIn("fixture.propertyId",source)
        self.assertIn("cleanupOwned()",source)
        for forbidden in (".like(", ".ilike(", "TRUNCATE", "DELETE FROM",
                          "systemctl restart", "https://api.stripe.com"):
            self.assertNotIn(forbidden,source)

    def test_workflow_must_not_include_public_or_production_secrets(self):
        path=pathlib.Path(__file__).parents[2]/".github/workflows/strigunov4-c4-physical-core.yml"
        source=path.read_text()
        for expected in ("environment: staging","secrets.STAGING_SESSION_SECRET",
                         "secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY",
                         "secrets.STAGING_DATABASE_URL",
                         "RUN_STRIGUNOV4_C4_PHYSICAL_"):
            self.assertIn(expected,source)
        self.assertNotIn("secrets.PRODUCTION",source)
        self.assertNotIn("environment: production",source)

if __name__ == "__main__":
    unittest.main()
