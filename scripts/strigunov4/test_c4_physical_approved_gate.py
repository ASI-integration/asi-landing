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
        "C4_RETENTION_CONFIRM":"RETAIN_C4_PILOT_"+SHA,
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
            "C4_RETENTION_CONFIRM":"RETAIN_ANY",
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
        self.assertIn("INTAKE_SCOPE_UNCERTAIN",source)
        self.assertIn("RETAINED_PHYSICAL_",source)
        self.assertIn("PHYSICAL_FINAL_APPROVAL",source)
        self.assertIn("OLD_BOOKING_SCOPE_DENIED",source)
        self.assertNotIn(".delete()",source)
        self.assertIn("127.0.0.1:3001",source)
        self.assertIn("realExternalEffectsIndependentProof: 'NOT_ESTABLISHED'",source)
        self.assertIn("booking_ops_records",source)
        self.assertIn("fixture.propertyId",source)
        self.assertIn("verifyRetained()",source)
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
                     "booking_overbooking_conflict_checks","RETAINED_AVAILABILITY_SCOPE_"):
            self.assertIn(item,source)
        gate_src=(pathlib.Path(__file__).parent/"c4_physical_approved_gate.py").read_text()
        for item in ("retention.PLAN", "C4_CHILD_TIMEOUT", "safe_receipt",
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

    def test_old_drift_blocks_before_child(self):
        with patch.object(gate.g0,"checked",return_value=types.SimpleNamespace(stdout=SHA.encode())), \
             patch.object(gate.g0,"exact_sql_history"), \
             patch.object(gate.retention,"capture",side_effect=ValueError('TRIGGER_DRIFT')), \
             patch.object(gate,"execute_lifecycle") as child:
            with self.assertRaises(ValueError): gate.run(valid())
            child.assert_not_called()

    def test_error_and_timeout_still_check_old_evidence(self):
        for error in [gate.Gate('C4_CHILD_TIMEOUT'),gate.Gate('WRITE_UNCERTAIN')]:
            with patch.object(gate.g0,"checked",return_value=types.SimpleNamespace(stdout=SHA.encode())), \
                 patch.object(gate.g0,"exact_sql_history"), \
                 patch.object(gate.retention,"capture",side_effect=[{'digest':'old'},{'digest':'old'}]) as capture, \
                 patch.object(gate,"execute_lifecycle",side_effect=error), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(gate.Gate,str(error)): gate.run(valid())
                self.assertEqual(capture.call_count,2)

    def test_changed_old_evidence_blocks_success(self):
        with patch.object(gate.g0,"checked",return_value=types.SimpleNamespace(stdout=SHA.encode())), \
             patch.object(gate.g0,"exact_sql_history"), \
             patch.object(gate.retention,"capture",side_effect=[{'digest':'old'},{'counts':{},'notDeployed':[]},{'digest':'changed'}]), \
             patch.object(gate,"execute_lifecycle",return_value={'status':'C4_PHYSICAL_CORE_PASS','lifecycleReceipt':{'owned':{}}}), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(gate.Gate,'OLD_EVIDENCE_POSTCHECK_BLOCK_RECONCILE'):
                gate.run(valid())

    def test_plan_unique_and_separate_from_old(self):
        from uuid import UUID
        plan=gate.retention.PLAN
        ids=[plan[k] for k in ('userId','accountId','propertyId')]
        self.assertEqual(len(set(ids)),3)
        self.assertTrue(all(UUID(i).version==4 for i in ids))
        self.assertFalse(set(ids)&set(gate.retention.dep.prior.OWNED.values()))
        self.assertEqual(plan['email'],'c4-pilot-'+plan['userId'].replace('-','')+'@asi.local')

    def test_fresh_operator_check_precedes_any_child(self):
        src=pathlib.Path(gate.__file__).read_text()
        self.assertLess(src.index('operator_email=retention.PLAN'),src.index('subprocess.Popen'))
        with self.assertRaises(gate.verified.Block):
            gate.verified.probe({},'unused',22,operator_email="x'; exit()")

    def test_new_scope_rejects_malformed_and_foreign_ids(self):
        owned={k:gate.retention.PLAN[k] for k in ('userId','accountId','propertyId')}
        owned.update(runId='12345',bookingIds=['12121212-1212-4212-8212-121212121212'],intakeIds=['13131313-1313-4313-8313-131313131313'])
        for key,value in [('userId','bad'),('bookingIds',["';DELETE"]),('intakeIds',[]),('runId','1;DROP')]:
            with self.assertRaises(gate.retention.dep.Block):
                gate.retention.scope_new_query('SELECT 1',dict(owned,**{key:value}))

    def test_host_operator_check_is_valid_python_and_exact(self):
        expected={'status':'C4_READONLY_PREFLIGHT_PASS','releaseSha':gate.G0,
                  'noSendFlags':7,'unauthorizedRoutes':5,'stagingWrites':False,'fullE2E':'NOT_RUN'}
        def checked(*args,**kwargs):
            script=kwargs['stdin'].decode()
            compile(script,'remote-probe','exec')
            self.assertIn(repr(gate.retention.PLAN['email']),script)
            self.assertIn('FRESH_OPERATOR_NOT_CONFIGURED',script)
            self.assertIn("r'[,;\\s]+'",script)
            return types.SimpleNamespace(returncode=0,stdout=json.dumps(expected).encode())
        with patch.object(gate.verified.backup_export,'ssh_identity',return_value=pathlib.Path('unused')), \
             patch.object(gate.verified.g0,'checked',side_effect=checked):
            self.assertEqual(gate.verified.probe(valid(),'unused',22,operator_email=gate.retention.PLAN['email']),expected)

if __name__ == "__main__":
    unittest.main()
