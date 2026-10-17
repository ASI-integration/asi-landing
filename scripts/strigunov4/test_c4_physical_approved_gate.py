"""No-credential source and fail-closed admission tests for physical C4."""
import pathlib
import json
import io
import contextlib
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
        self.assertIn("INTAKE_OWNERSHIP",source)
        self.assertIn("INTAKE_RECEIPT_REMAINS",source)
        self.assertIn("INTAKE_SCOPE_UNCERTAIN",source)
        self.assertIn("INTAKE_ID_NOT_OWNED",source)
        self.assertIn("id,account_id,booking_id",source)
        self.assertIn("await deleteExact('booking_inbound_intake_events', {",source)
        self.assertLess(source.index("await deleteExact('booking_inbound_intake_events', {"),
                        source.index("await deleteExact('booking_ops_records', {"))
        self.assertIn("127.0.0.1:3001",source)
        self.assertIn("realExternalEffectsIndependentProof: 'NOT_ESTABLISHED'",source)
        self.assertIn("booking_ops_records",source)
        self.assertIn("fixture.propertyId",source)
        self.assertIn("cleanupOwned()",source)
        for forbidden in (".like(", ".ilike(", "TRUNCATE", "DELETE FROM",
                          "systemctl restart", "https://api.stripe.com"):
            self.assertNotIn(forbidden,source)

    def test_preserves_only_generated_ownership_on_invalid_child_receipt(self):
        owned = {"userId":"48d6eb17-8f2a-4d76-8812-e3d6762282a4",
                 "accountId":"377268d5-f4d5-4078-8e3e-ae76778ae07c",
                 "propertyId":"555300da-a457-4a59-9e29-95c5a5923722",
                 "runId":"39040347972"}
        report = {"owned":{**owned,
                    "bookingIds":["15e11da2-3b0f-49e8-84ac-ce4cd8366bdf"],
                    "intakeIds":["malicious secret string"]},
                  "reason":"DB_ERROR", "cleanup":"BLOCK",
                  "cleanupReason":"FAIL_CLEANUP", "secret":"NEVER_LOG"}
        safe = gate.safe_receipt(report, owned)
        self.assertEqual(safe["owned"]["accountId"],owned["accountId"])
        self.assertEqual(len(safe["owned"]["bookingIds"]),1)
        self.assertEqual(safe["owned"]["intakeIds"],[])
        self.assertEqual(safe["cleanup"],"BLOCK")
        self.assertEqual(safe["reason"],"DB_ERROR")
        self.assertNotIn("secret",safe)
        report["owned"]["accountId"]="wrong"
        self.assertEqual(gate.safe_receipt(report,owned)["reason"],
                         "OWNERSHIP_RECEIPT_MISMATCH")

    def test_block_prints_only_one_sanitized_receipt(self):
        error = gate.Gate("C4_CHILD_TIMEOUT", {
            "owned":{"userId":"48d6eb17-8f2a-4d76-8812-e3d6762282a4"},
            "cleanup":"UNKNOWN"})
        buffer = io.StringIO()
        with patch.object(gate,"run",side_effect=error),              contextlib.redirect_stdout(buffer):
            self.assertEqual(gate.main(),2)
        lines=buffer.getvalue().splitlines()
        self.assertEqual(len(lines),1)
        payload=json.loads(lines[0])
        self.assertEqual(payload["reason"],"C4_CHILD_TIMEOUT")
        self.assertEqual(payload["lifecycleReceipt"]["cleanup"],"UNKNOWN")

    def test_source_enforces_durable_handoff_availability_and_postflight(self):
        source=(pathlib.Path(__file__).parent/"c4_physical_staging_lifecycle.mjs").read_text()
        for item in ("C4_OWNED_USER_ID","C4_OWNED_ACCOUNT_ID",
                     "C4_OWNED_PROPERTY_ID","booking_availability_holds",
                     "booking_overbooking_conflict_checks","AVAILABILITY_RESIDUE_"):
            self.assertIn(item,source)
        gate_src=(pathlib.Path(__file__).parent/"c4_physical_approved_gate.py").read_text()
        for item in ("uuid.uuid4()", "C4_CHILD_TIMEOUT", "safe_receipt",
                     'post.get("status") == "C4_READONLY_PREFLIGHT_PASS"',
                     '"STAGE_POSTFLIGHT"'):
            self.assertIn(item,gate_src)

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
