"""Synthetic, credential-free regression for reviewed incident cleanup."""
import contextlib
import io
import json
import re
import unittest
from unittest.mock import patch

import c4_incident_exact_cleanup as c

SHA="a"*40
def valid():
    return {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":c.REPO,
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_WORKFLOW_REF":c.WORKFLOW,
        "GITHUB_ACTOR":"ASI-integration",
        "GITHUB_ACTOR_ID":"207600140",
        "GITHUB_TRIGGERING_ACTOR":"ASI-integration",
        "GITHUB_RUN_ATTEMPT":"1",
        "STAGING_SUPABASE_PROJECT_REF":c.pg.PROJECT,
        "STAGING_SSH_USER":"project_ayfaar",
        "C4_INCIDENT_RUN":c.INCIDENT,
        "GITHUB_SHA":SHA,
        "GITHUB_WORKFLOW_SHA":SHA,
        "C4_REVIEWED_MAIN_SHA":SHA,
        "C4_CONFIRM":"CLEAN_C4_INCIDENT_"+SHA,
        "STAGING_DATABASE_URL":(
            "postgresql://postgres.meeravcldnmocjtlqoeu:FAKE_NOT_REAL"
            "@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"),
        "STAGING_SSH_HOST":"stage.example.invalid",
        "STAGING_SSH_PORT":"22",
        "STAGING_SSH_PRIVATE_KEY":"NOT_AN_SSH_KEY_"+("X"*180),
    }

class IncidentCleanupTests(unittest.TestCase):
    def test_good_format_is_not_approval(self):
        url,host,port=c.validate(valid())
        self.assertEqual(host,"stage.example.invalid")
        self.assertEqual(port,22)
        self.assertIn(c.pg.PROJECT,url)

    def test_every_wrong_owner_branch_workflow_db_denied(self):
        bad={
            "GITHUB_ACTIONS":"false",
            "GITHUB_REPOSITORY":"other/repo",
            "GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_REF":"refs/heads/test",
            "GITHUB_WORKFLOW_REF":"wrong/workflow",
            "GITHUB_ACTOR":"attacker",
            "GITHUB_ACTOR_ID":"42",
            "GITHUB_TRIGGERING_ACTOR":"attacker",
            "GITHUB_RUN_ATTEMPT":"2",
            "STAGING_SUPABASE_PROJECT_REF":"jwinifeienvzejofmbua",
            "STAGING_SSH_USER":"root",
            "C4_INCIDENT_RUN":"39047710116",
            "GITHUB_SHA":"wrong",
            "GITHUB_WORKFLOW_SHA":"b"*40,
            "C4_REVIEWED_MAIN_SHA":"b"*40,
            "C4_CONFIRM":"UNCONFIRMED",
            "STAGING_DATABASE_URL":"postgresql://postgres.jwinifeienvzejofmbua:FAKE@aws.example.invalid:5432/postgres",
            "STAGING_SSH_HOST":"-ProxyCommand=evil",
            "STAGING_SSH_PORT":"0",
            "STAGING_SSH_PRIVATE_KEY":"",
        }
        for key,wrong in bad.items():
            with self.subTest(field=key):
                e=valid();e[key]=wrong
                with self.assertRaises(c.Block):
                    c.validate(e)

    def test_missing_gate_cannot_invoke_process_database_or_host(self):
        with patch.object(c.g0,"checked") as process, \
             patch.object(c.stage,"probe") as host, \
             patch.object(c.g0,"exact_sql_history") as db:
            with self.assertRaises(c.Block):
                c.run({})
            process.assert_not_called()
            host.assert_not_called()
            db.assert_not_called()

    def test_cleanup_is_one_transaction_with_immutable_exact_ids(self):
        sql=c.cleanup_sql()
        self.assertEqual(sql.count("BEGIN TRANSACTION"),1)
        self.assertEqual(sql.count("COMMIT;"),1)
        self.assertEqual(sql.count("SET LOCAL statement_timeout"),1)
        self.assertIn("SERIALIZABLE READ WRITE",sql)
        self.assertIn("C4_BOOKING_SCOPE_DRIFT",sql)
        self.assertIn("C4_DELIVERY_WITNESS",sql)
        self.assertIn("C4_SEND_ATTEMPT_WITNESS",sql)
        self.assertIn("C4_DRAFT_NOT_PRISTINE",sql)
        self.assertIn("booking_ops_communication_deliveries d",sql)
        self.assertIn("booking_ops_communication_auto_send_attempts a",sql)
        self.assertIn("status='draft' AND telegram_chat_id IS NULL",sql)
        self.assertIn("nullif(btrim(telegram_target),'') IS NULL",sql)
        self.assertLess(sql.index("C4_DELIVERY_WITNESS"),
                        sql.index("DELETE FROM public.booking_ops_communication_intents"))
        self.assertLess(sql.index("C4_SEND_ATTEMPT_WITNESS"),
                        sql.index("DELETE FROM public.booking_ops_communication_intents"))
        self.assertNotIn("status IN ('sent','sending')",sql)
        self.assertIn("C4_CONFLICT_FOREIGN_SCOPE",sql)
        self.assertIn("C4_RESIDUE_ROLLBACK",sql)
        for ident in c.audit.OWNED.values():
            self.assertIn(ident,sql)
        for forbidden in ("TRUNCATE","ALTER TABLE","DROP TABLE",
                          "db push", "production", "LIKE 'C4%"):
            self.assertNotIn(forbidden,sql)
        expected_deletes={
            "booking_overbooking_conflict_checks",
            "booking_ops_communication_intents",
            "booking_ops_tasks",
            "booking_ops_telegram_drafts",
            "booking_ops_records",
            "properties",
            "account_members",
            "accounts",
            "users",
        }
        actual=set(re.findall(r"DELETE FROM public\.([a-z_]+)",sql))
        self.assertEqual(actual,expected_deletes)
        for kind in actual:
            self.assertEqual(len(re.findall(r"DELETE FROM public\."+kind+r"\b",sql)),1)
        self.assertLess(sql.index("DELETE FROM public.booking_ops_communication_intents"),
                        sql.index("DELETE FROM public.booking_ops_tasks"))
        self.assertLess(sql.index("DELETE FROM public.booking_ops_telegram_drafts"),
                        sql.index("DELETE FROM public.booking_ops_records"))
        self.assertLess(sql.index("DELETE FROM public.booking_overbooking_conflict_checks"),
                        sql.index("DELETE FROM public.booking_ops_records"))
        self.assertEqual(sql.count("GET DIAGNOSTICS n = ROW_COUNT"),len(actual))

    def test_unknown_cascade_descendants_are_blocked_before_parent_deletes(self):
        sql=c.cleanup_sql()
        tables={
            "booking_cleaning_tasks","booking_linen_tasks","booking_supplies_tasks",
            "booking_maintenance_tickets","booking_physical_readiness",
            "booking_physical_coordination_drafts","guest_lifecycle_events",
            "partner_property_bindings","partner_booking_bindings",
            "partner_communication_inbox","partner_communication_decisions",
        }
        for table in tables:
            with self.subTest(table=table):
                self.assertIn("public."+table,sql)
        for marker in (
            "C4_UNAPPROVED_BOOKING_DESCENDANTS",
            "C4_PARTNER_PROPERTY_BINDING_WITNESS",
            "C4_PARTNER_BOOKING_BINDING_WITNESS",
            "C4_PARTNER_INBOX_WITNESS",
            "C4_PARTNER_DECISION_WITNESS",
        ):
            self.assertLess(sql.index(marker),
                            sql.index("DELETE FROM public.booking_ops_records"))
        self.assertNotIn("DELETE FROM public.partner_",sql)
        self.assertNotIn("DELETE FROM public.booking_cleaning_tasks",sql)

    def test_witness_counts_exact_from_prior_live_readonly_census(self):
        self.assertEqual(c.EXPECTED,{
            "users":1,"accounts":1,"properties":1,"accountMembers":1,
            "bookingExact":1,"bookingOwnedScope":1,"bookingTasks":6,
            "communicationIntents":6,"conflictChecks":2,"holds":0,
            "intakeExact":0,"intakeOwnedScope":0,"telegramDrafts":1,
        })

    def test_no_false_success_from_unexpected_or_stale_mutation_result(self):
        output=io.StringIO()
        with patch.object(c,"run",side_effect=c.Block("C4_PRE_TASKS_CHANGED")), \
             contextlib.redirect_stdout(output):
            self.assertEqual(c.main(),2)
        lines=output.getvalue().splitlines()
        self.assertEqual(len(lines),1)
        record=json.loads(lines[0])
        self.assertEqual(record["status"],"BLOCK")
        self.assertEqual(record["knownFixtureCountsZero"],"NOT_PROVEN")
        self.assertEqual(record["physicalReplayAuthorized"],False)
        self.assertEqual(record["blockCode"],"C4_PRE_TASKS_CHANGED")
        self.assertEqual(record["stagingWrites"],False)


    def test_post_writer_failure_never_claims_zero_staging_writes(self):
        c.STATE["writeAttempted"]=True
        try:
            output=io.StringIO()
            with (patch.object(c,"run",
                               side_effect=c.Block("POSTCOMMIT_COUNTS_UNKNOWN")),
                  contextlib.redirect_stdout(output)):
                self.assertEqual(c.main(),2)
            receipt=json.loads(output.getvalue())
            self.assertEqual(receipt["stagingWrites"],"UNKNOWN")
            self.assertEqual(receipt["blockCode"],"POSTCOMMIT_COUNTS_UNKNOWN")
            self.assertEqual(receipt["knownFixtureCountsZero"],"NOT_PROVEN")
            self.assertFalse(receipt["physicalReplayAuthorized"])
        finally:
            c.STATE["writeAttempted"]=False

    def test_generic_error_never_leaks_database_details(self):
        buffer=io.StringIO()
        with (patch.object(c,"run",
                           side_effect=RuntimeError("postgres secret password")),
              contextlib.redirect_stdout(buffer)):
            self.assertEqual(c.main(),2)
        data=json.loads(buffer.getvalue())
        self.assertEqual(data["blockCode"],"UNEXPECTED_ERROR")
        self.assertNotIn("password",buffer.getvalue())


class PreservationTests(unittest.TestCase):
    def receipt(self, audit=24, physical=4):
        return {"incidentRun":c.INCIDENT,"auditEvents":audit,"physicalRows":physical,
                "missingOptionalRelations":["public.guest_lifecycle_events"]}

    def test_audit_physical_and_empty_graph_all_stop(self):
        for a,p,code in ((24,4,"C4_AUDIT_PRESERVATION_REQUIRED"),
                         (0,4,"C4_PHYSICAL_PRESERVATION_REQUIRED"),
                         (0,0,"C4_DEPENDENCY_POLICY_REQUIRED")):
            with self.subTest(audit=a,physical=p), self.assertRaisesRegex(c.Block,code):
                c.require_preservation(self.receipt(a,p))

    def test_malformed_counts_identity_and_optional_catalog_stop(self):
        for key,value in (("auditEvents",True),("physicalRows",-1),
                          ("physicalRows",None),("incidentRun","other"),
                          ("missingOptionalRelations",["public.users"]),
                          ("missingOptionalRelations",["public.guest_lifecycle_events"]*2)):
            d=self.receipt();d[key]=value
            with self.subTest(key=key,value=value), self.assertRaises(c.Block):
                c.require_preservation(d)

    def test_optional_absence_is_catalog_evidence_not_zero_count(self):
        sql=c.preservation_query()
        self.assertIn("SERIALIZABLE READ ONLY",sql)
        self.assertIn("to_regclass(name) IS NULL",sql)
        self.assertNotIn("FROM public.guest_lifecycle_events",sql)
        self.assertNotIn("FROM public.partner_",sql)
        self.assertNotRegex(sql,r"\b(DELETE|INSERT|UPDATE|ALTER|DROP)\b")

    def test_transaction_barrier_precedes_every_delete_and_optional_reference(self):
        sql=c.cleanup_sql()
        barrier=sql.index("DO $c4preserve$")
        self.assertLess(sql.index("pg_advisory_xact_lock"),barrier)
        self.assertLess(sql.index("C4_DEPENDENCY_POLICY_REQUIRED"),
                        sql.index("DO $c4pre$"))
        for match in re.finditer(r"DELETE FROM",sql):
            self.assertLess(barrier,match.start())
        self.assertLess(sql.index("C4_AUDIT_PRESERVATION_REQUIRED"),
                        sql.index("FROM public.guest_lifecycle_events"))

    def test_actual_run_never_opens_writer_when_preservation_blocks(self):
        import types
        c.STATE["writeAttempted"]=False
        calls=[]
        def checked(cmd,**kwargs):
            calls.append(cmd)
            if cmd[0]=="git":
                return types.SimpleNamespace(stdout=(SHA+"\n").encode())
            if cmd[:2]==["docker","pull"]:
                return types.SimpleNamespace(stdout=b"")
            self.assertIn("READ ONLY",cmd[-1])
            self.assertIn("VERBOSITY=sqlstate",cmd)
            return types.SimpleNamespace(returncode=0,stderr=b"",
                stdout=(json.dumps(self.receipt())+"\n").encode())
        with (patch.object(c.g0,"checked",side_effect=checked),
              patch.object(c.g0,"exact_sql_history"),
              patch.object(c.stage,"probe",return_value={
                  "status":"C4_READONLY_PREFLIGHT_PASS","fullE2E":"NOT_RUN"}),
              patch.object(c.Path,"read_bytes",return_value=b"FAKE_CA"),
              patch.object(c.g0.tls_guard,"ca_bytes",return_value=b"FAKE_CA"),
              patch.object(c,"query_counts",return_value=c.EXPECTED),
              patch.object(c.pg,"db_environment",return_value={
                  "PGOPTIONS":"-c default_transaction_read_only=on"}) as dbenv,
              patch.object(c.pg,"postgres_client_command",return_value=["psql","-c","QUERY"])):
            with self.assertRaisesRegex(c.Block,"C4_AUDIT_PRESERVATION_REQUIRED"):
                c.run(valid())
        self.assertFalse(c.STATE["writeAttempted"])
        self.assertTrue(all(call.args[-1] is True for call in dbenv.call_args_list))
        self.assertTrue(all("--file" not in cmd for cmd in calls))

    def test_permission_failure_is_safe_and_never_enters_writer(self):
        import types
        with (patch.object(c.pg,"db_environment",return_value={
                  "PGOPTIONS":"-c default_transaction_read_only=on"}),
              patch.object(c.pg,"postgres_client_command",return_value=["psql","-c","QUERY"]),
              patch.object(c.g0,"checked",return_value=types.SimpleNamespace(
                  returncode=1,stdout=b"",stderr=b"42501 secret must not leak"))):
            with self.assertRaisesRegex(c.Block,"^PRESERVATION_QUERY_FAILED$"):
                c.check_preservation("fake",None,None)

    def test_census_drift_and_unsafe_host_stop_before_preservation(self):
        import types
        for report,counts,code in (
            ({"status":"C4_READONLY_PREFLIGHT_PASS","fullE2E":"NOT_RUN"},
             {**c.EXPECTED,"bookingTasks":7},"FIXTURE_CENSUS_DRIFT"),
            ({"status":"BLOCK","fullE2E":"NOT_RUN"},c.EXPECTED,"STAGE_PREFLIGHT")):
            with (patch.object(c.g0,"checked",return_value=types.SimpleNamespace(
                      stdout=(SHA+"\n").encode())),
                  patch.object(c.g0,"exact_sql_history"),
                  patch.object(c.stage,"probe",return_value=report),
                  patch.object(c.Path,"read_bytes",return_value=b"FAKE_CA"),
                  patch.object(c.g0.tls_guard,"ca_bytes",return_value=b"FAKE_CA"),
                  patch.object(c,"query_counts",return_value=counts),
                  patch.object(c,"check_preservation") as guard):
                with self.assertRaisesRegex(c.Block,code):
                    c.run(valid())
                guard.assert_not_called()

if __name__=="__main__":
    unittest.main()
