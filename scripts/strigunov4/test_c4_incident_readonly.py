"""No-credential exact-ID audit source tests; cannot query staging in PR."""
import contextlib
import io
import json
import re
import types
import unittest
from unittest.mock import patch

import c4_incident_readonly as audit

SHA="a"*40
def valid():
    return {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":audit.REPO,
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_WORKFLOW_REF":audit.WORKFLOW,
        "GITHUB_ACTOR":"ASI-integration",
        "GITHUB_ACTOR_ID":"207600140",
        "GITHUB_TRIGGERING_ACTOR":"ASI-integration",
        "GITHUB_RUN_ATTEMPT":"1",
        "STAGING_SUPABASE_PROJECT_REF":audit.PROJECT,
        "C4_INCIDENT_RUN":audit.INCIDENT_RUN,
        "GITHUB_SHA":SHA,
        "GITHUB_WORKFLOW_SHA":SHA,
        "C4_REVIEWED_MAIN_SHA":SHA,
        "C4_CONFIRM":"READONLY_C4_INCIDENT_"+SHA,
        "STAGING_DATABASE_URL":(
            "postgresql://postgres.meeravcldnmocjtlqoeu:FAKE_NOT_REAL"
            "@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"),
    }

class C4IncidentReadOnlyTests(unittest.TestCase):
    def test_context_valid_format_not_authority(self):
        self.assertEqual(audit.validate(valid()),valid()["STAGING_DATABASE_URL"])

    def test_each_missing_or_wrong_gate_denied(self):
        bad={
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"other/repo",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_REF":"refs/heads/test",
            "GITHUB_WORKFLOW_REF":"not reviewed",
            "GITHUB_ACTOR":"someone",
            "GITHUB_ACTOR_ID":"7",
            "GITHUB_TRIGGERING_ACTOR":"someone",
            "GITHUB_RUN_ATTEMPT":"2",
            "STAGING_SUPABASE_PROJECT_REF":"jwinifeienvzejofmbua",
            "C4_INCIDENT_RUN":"39047710116",
            "GITHUB_SHA":"bad",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "C4_REVIEWED_MAIN_SHA":"b"*40,
            "C4_CONFIRM":"OTHER",
            "STAGING_DATABASE_URL":"postgresql://postgres.jwinifeienvzejofmbua:fake@aws.example.invalid:5432/postgres",
        }
        for key,value in bad.items():
            with self.subTest(key=key):
                cfg=valid()
                cfg[key]=value
                with self.assertRaises(audit.Block):
                    audit.validate(cfg)

    def test_no_auth_no_db_operation(self):
        with patch.object(audit.g0,"checked") as process, \
             patch.object(audit.g0,"exact_sql_history") as read:
            with self.assertRaises(audit.Block):
                audit.reconcile({})
            process.assert_not_called()
            read.assert_not_called()

    def test_query_fixed_uuid_only_read_only(self):
        sql=audit.sql_query()
        self.assertIn("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",sql)
        self.assertIn("COMMIT;",sql)
        for id in audit.OWNED.values():
            self.assertIn(id,sql)
        for table in ("booking_ops_records","booking_inbound_intake_events",
                      "booking_availability_holds","booking_overbooking_conflict_checks",
                      "booking_ops_communication_intents","booking_ops_tasks",
                      "booking_ops_telegram_drafts"):
            self.assertIn(table,sql)
        for prohibited in (r"\bDELETE\b",r"\bUPDATE\b",r"\bINSERT\b",
                           r"\bTRUNCATE\b",r"\bALTER\b",r"\bCREATE\b",
                           r"\bDROP\b",r"\bGRANT\b",r"\bCALL\b",r"\bDO\b"):
            self.assertIsNone(re.search(prohibited,sql,re.I))

    def test_receipt_counts_only_not_guest_details(self):
        record={k:0 for k in (
            "users","accounts","properties","accountMembers","bookingExact",
            "bookingOwnedScope","intakeExact","intakeOwnedScope","holds",
            "conflictChecks","communicationIntents","bookingTasks","telegramDrafts")}
        record["incidentRun"]=audit.INCIDENT_RUN
        def fake_process(command,**kwargs):
            if command[0]=="git":
                return types.SimpleNamespace(stdout=(SHA+"\n").encode())
            self.assertEqual(command[-2],"-c")
            self.assertIn("SELECT jsonb_build_object",command[-1])
            self.assertIn("default_transaction_read_only=on",kwargs["env"]["PGOPTIONS"])
            return types.SimpleNamespace(stdout=("BEGIN\n"+json.dumps(record)+"\nCOMMIT\n").encode())
        with patch.object(audit.g0,"checked",side_effect=fake_process), \
             patch.object(audit.g0,"exact_sql_history",return_value=True), \
             patch.object(audit.pg,"db_environment",return_value={
                 "PGOPTIONS":"-c default_transaction_read_only=on"}), \
             patch.object(audit.pg,"postgres_client_command",return_value=[
                 "docker","run","-c","QUERY"]), \
             patch.object(audit.g0.tls_guard,"ca_bytes",return_value=b"TEST_CA"):
            x=audit.reconcile(valid())
        self.assertEqual(x["status"],"C4_INCIDENT_READONLY_AUDIT")
        self.assertFalse(x["stagingWrites"])
        self.assertFalse(x["physicalReplayAuthorized"])
        self.assertEqual(x["recordCounts"],
                         {key:value for key,value in record.items() if key!="incidentRun"})

    def test_history_and_census_failures_have_distinct_safe_reasons(self):
        for stage in ("CHECKOUT","HISTORY","CENSUS"):
            with self.subTest(stage=stage):
                with self.assertRaises(audit.Block) as ctx:
                    audit.stage_gate(stage,lambda: (_ for _ in ()).throw(
                        audit.g0.Gate("COMMAND_FAILURE")))
                self.assertEqual(str(ctx.exception),stage+"_COMMAND_FAILURE")

    def test_untrusted_error_text_is_not_exposed(self):
        with self.assertRaises(audit.Block) as ctx:
            audit.stage_gate("CENSUS",lambda: (_ for _ in ()).throw(
                audit.g0.Gate("password=never_show_this")))
        self.assertEqual(str(ctx.exception),"CENSUS_FAILED")
        output=io.StringIO()
        with patch.object(audit,"reconcile",
                          side_effect=audit.Block("TABLE bad; password=secret")), \\
             contextlib.redirect_stdout(output):
            self.assertEqual(audit.main(),2)
        self.assertEqual(json.loads(output.getvalue())["reason"],"UNKNOWN_BLOCK")
        self.assertNotIn("password",output.getvalue())

    def test_stage_error_code_appears_in_single_block_receipt(self):
        output=io.StringIO()
        with patch.object(audit,"reconcile",
                          side_effect=audit.Block("HISTORY_COMMAND_FAILURE")), \\
             contextlib.redirect_stdout(output):
            self.assertEqual(audit.main(),2)
        self.assertEqual(json.loads(output.getvalue())["reason"],
                         "HISTORY_COMMAND_FAILURE")
        self.assertEqual(len(output.getvalue().splitlines()),1)

    def test_block_one_sanitized_line(self):
        output=io.StringIO()
        with patch.object(audit,"reconcile",side_effect=audit.Block("NOT_AUTHORIZED")), \
             contextlib.redirect_stdout(output):
            self.assertEqual(audit.main(),2)
        lines=output.getvalue().splitlines()
        self.assertEqual(len(lines),1)
        data=json.loads(lines[0])
        self.assertEqual(data["status"],"BLOCK")
        self.assertFalse(data["stagingWrites"])

if __name__=="__main__":
    unittest.main()
