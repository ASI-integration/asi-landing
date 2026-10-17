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
        self.assertIn("C4_SENT_INTENT_WITNESS",sql)
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

if __name__=="__main__":
    unittest.main()
