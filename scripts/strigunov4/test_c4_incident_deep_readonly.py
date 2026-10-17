"""C4 incident deep read-only witness: no credentials, no staging writes."""
import contextlib
import io
import json
import re
import types
import unittest
from unittest.mock import patch

import c4_incident_deep_readonly as deep

SHA = "a"*40
def valid():
    return {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":deep.REPO,
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_WORKFLOW_REF":deep.WORKFLOW,
        "GITHUB_ACTOR":deep.OWNER,
        "GITHUB_ACTOR_ID":"207600140",
        "GITHUB_TRIGGERING_ACTOR":deep.OWNER,
        "GITHUB_RUN_ATTEMPT":"1",
        "STAGING_SUPABASE_PROJECT_REF":deep.pg.PROJECT,
        "C4_INCIDENT_RUN":deep.INCIDENT,
        "GITHUB_SHA":SHA,
        "GITHUB_WORKFLOW_SHA":SHA,
        "C4_REVIEWED_MAIN_SHA":SHA,
        "C4_CONFIRM":"DIAGNOSE_C4_INCIDENT_"+SHA,
        "STAGING_DATABASE_URL":(
            "postgresql://postgres.meeravcldnmocjtlqoeu:FAKE_NOT_REAL"
            "@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
        )
    }

class DeepReadOnlyTests(unittest.TestCase):
    def test_valid_context_is_only_format_not_auth(self):
        self.assertEqual(deep.validate(valid()),valid()["STAGING_DATABASE_URL"])

    def test_reject_all_wrong_dimensions_before_db(self):
        wrong={
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"other/repo",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_REF":"refs/heads/feature",
            "GITHUB_WORKFLOW_REF":"other/workflow",
            "GITHUB_ACTOR":"attacker",
            "GITHUB_ACTOR_ID":"10",
            "GITHUB_TRIGGERING_ACTOR":"attacker",
            "GITHUB_RUN_ATTEMPT":"2",
            "STAGING_SUPABASE_PROJECT_REF":"jwinifeienvzejofmbua",
            "C4_INCIDENT_RUN":"0001",
            "GITHUB_SHA":"INVALID",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "C4_REVIEWED_MAIN_SHA":"b"*40,
            "C4_CONFIRM":"WRONG",
            "STAGING_DATABASE_URL":"postgresql://postgres.jwinifeienvzejofmbua:FAKE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
        }
        for k,val in wrong.items():
            with self.subTest(field=k):
                env=valid()
                env[k]=val
                with self.assertRaises(deep.Block):
                    deep.validate(env)

    def test_unauthorized_never_accesses_database_or_host(self):
        with patch.object(deep.g0,"checked") as cmd, \
             patch.object(deep.g0,"exact_sql_history") as history:
            with self.assertRaises(deep.Block):
                deep.run({})
            cmd.assert_not_called()
            history.assert_not_called()

    def test_query_is_exact_id_read_only_and_has_extended_witnesses(self):
        sql=deep.read_query()
        self.assertIn("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",sql)
        self.assertIn("COMMIT;",sql)
        for ident in deep.prior.OWNED.values():
            self.assertIn(ident,sql)
        for table in [
            "booking_ops_events","booking_cleaning_tasks","booking_linen_tasks",
            "booking_supplies_tasks","booking_maintenance_tickets",
            "booking_physical_readiness","booking_physical_coordination_drafts",
            "guest_lifecycle_events","booking_ops_communication_deliveries",
            "booking_ops_communication_auto_send_attempts",
            "partner_account_bindings","partner_property_bindings",
            "partner_booking_bindings","partner_communication_inbox",
            "partner_communication_sessions","partner_communication_turns",
            "partner_communication_handoffs","partner_communication_actions",
            "partner_communication_decisions"
        ]:
            self.assertIn("public."+table,sql)
        self.assertIn("pg_catalog.pg_constraint",sql)
        self.assertIn("con.confdeltype='c'",sql)
        for prohibited in (r"\bDELETE\b",r"\bINSERT\b",r"\bUPDATE\b",
                           r"\bTRUNCATE\b",r"\bALTER\b",r"\bDROP\b",
                           r"\bCREATE\b",r"\bGRANT\b",r"\bCALL\b"):
            self.assertIsNone(re.search(prohibited,sql,re.I))

    def test_counts_and_schema_only_in_receipt(self):
        obj={k:0 for k in deep.COUNT_KEYS}
        obj.update({"incidentRun":deep.INCIDENT,
                    "cascadeChildTables":["booking_ops_events","partner_booking_bindings"]})
        def checked(cmd,**kwargs):
            if cmd[0]=="git":
                return types.SimpleNamespace(stdout=(SHA+"\n").encode())
            self.assertIn("default_transaction_read_only=on",kwargs["env"]["PGOPTIONS"])
            self.assertEqual(cmd[-2],"-c")
            self.assertIn("READ ONLY",cmd[-1])
            return types.SimpleNamespace(stdout=("BEGIN\n"+json.dumps(obj)+"\nCOMMIT\n").encode())
        with patch.object(deep.g0,"checked",side_effect=checked), \
             patch.object(deep.g0,"exact_sql_history",return_value=True), \
             patch.object(deep.pg,"db_environment",
                          return_value={"PGOPTIONS":"-c default_transaction_read_only=on"}), \
             patch.object(deep.pg,"postgres_client_command",
                          return_value=["docker","psql","-c","QUERY"]), \
             patch.object(deep.g0.tls_guard,"ca_bytes",return_value=b"FAKE_CA"):
            report=deep.run(valid())
        self.assertEqual(report["status"],"C4_DEEP_READONLY_DIAG_PASS")
        self.assertEqual(report["counts"]["bookingOpsEvents"],0)
        self.assertEqual(len(report["counts"]),len(deep.COUNT_KEYS))
        self.assertEqual(report["cascadeChildTables"],obj["cascadeChildTables"])
        self.assertIs(report["stagingWrites"],False)
        self.assertIs(report["cleanupAttempted"],False)
        self.assertIs(report["physicalReplayAuthorized"],False)

    def test_invalid_receipts_fail_closed(self):
        buf=io.StringIO()
        with patch.object(deep,"run",side_effect=deep.Block("HISTORY_COMMAND_FAILURE")), \
             contextlib.redirect_stdout(buf):
            self.assertEqual(deep.main(),2)
        j=json.loads(buf.getvalue())
        self.assertEqual(j["blockCode"],"HISTORY_COMMAND_FAILURE")
        self.assertFalse(j["cleanupAttempted"])
        self.assertEqual(len(buf.getvalue().splitlines()),1)

if __name__=="__main__":
    unittest.main()
