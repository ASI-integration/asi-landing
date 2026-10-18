"""Credential-free admission, privacy and partial-observation regressions."""
import contextlib
import copy
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_retained_readonly as c
import test_c4_dependency_readonly as base

B = "12121212-1212-4212-8212-121212121212"
I = "13131313-1313-4313-8313-131313131313"


def environment():
    """Use a synthetic URL which no unit test is allowed to contact."""
    env = base.environment()
    env.update(GITHUB_WORKFLOW_REF=c.WORKFLOW, C4_INCIDENT_RUN=c.RUN,
               C4_CONFIRM="READONLY_C4_RETAINED_" + env["GITHUB_SHA"])
    env["STAGING_DATABASE_URL"] = env["STAGING_DATABASE_URL"].split("?",1)[0]
    return env


def catalog():
    """Add only independently declared physical-state metadata to the old fixture."""
    data = base.catalog()
    for name in c.STATES: data["tables"][name]["columns"]["status"] = "text"
    data["tables"]["booking_physical_readiness"]["columns"]["final_ready"] = "bool"
    return data


def observation(roots=True, booking=True, intake=True):
    """Build minimal exact-shape observations independently of SQL generation."""
    counts = {t: {"incidentLinked": 0, "scopeConflicts": 0} for t in c.dep.TABLES}
    old = copy.deepcopy(counts)
    for t in c.dep.ROOTS:
        old[t]["incidentLinked"] = int(t != "booking_inbound_intake_events")
    for t in ("booking_cleaning_tasks", "booking_linen_tasks", "booking_supplies_tasks", "booking_physical_readiness"):
        old[t]["incidentLinked"] = 1
    old["booking_ops_events"]["incidentLinked"] = 24
    for t in c.ROOTS:
        counts[t]["incidentLinked"] = int(roots)
    counts["booking_ops_records"]["incidentLinked"] = int(booking)
    counts["booking_inbound_intake_events"]["incidentLinked"] = int(intake)
    states = {name: {state: 0 for state in values + ("unknown",)} for name, values in c.STATES.items()}
    states["booking_inbound_intake_events"]["new"] = int(intake)
    states["booking_physical_readiness"].update(finalReady=0, approvedAndFinalReady=0)
    return {"old": {"counts": old, "identities": [1,1,1,1,0], "identityRoots": [1,1,1,1,0], "nodeLimitExceeded": False},
            "retained": {"counts": counts, "identities": [int(roots)]*3, "identityRoots": [int(roots)]*3,
                         "nodeLimitExceeded": False, "states": states, "bookingIds": [B] if booking else [], "intakeIds": [I] if intake else []}}


class RetainedReadonlyTests(unittest.TestCase):
    def test_exact_admission_and_each_changed_identity_block_before_transport(self):
        """No wrong actor, ref, attempt, run, project or TLS target can connect."""
        env = environment()
        self.assertEqual(c.validate(env), env["STAGING_DATABASE_URL"])
        for key in env:
            changed = dict(env, **{key: "wrong"})
            with self.subTest(key=key), patch.object(c.dep.prior.g0, "checked") as checked:
                with self.assertRaises(c.StageFailure):
                    c.run(changed)
                checked.assert_not_called()

    def test_partial_states_never_authorize_replay(self):
        """Successful observation does not mean a physical booking was accepted."""
        for roots, booking, intake, state in (
                (False,False,False,"NO_ROWS_OBSERVED"), (True,False,False,"ROOTS_ONLY_OBSERVED"),
                (True,True,False,"PARTIAL_FLOW_OBSERVED"), (True,True,True,"BOOKING_AND_INTAKE_OBSERVED")):
            with self.subTest(state=state):
                result = c.receipt(observation(roots,booking,intake), set())
                self.assertEqual(result["status"], "C4_RETAINED_READONLY_OBSERVED")
                self.assertEqual(result["observation"], state)
                self.assertFalse(result["physicalReplayAuthorized"])
                self.assertFalse(result["stagingWrites"])
                self.assertEqual(result["oldIncident"]["fullRowPreservationSinceWriter"], "UNKNOWN")
                self.assertEqual(result["fullPhysicalE2E"], "NOT_YET_PROVEN")

    def test_root_conflict_and_partial_root_suppress_candidate_ids(self):
        """A candidate UUID cannot escape when durable root ownership is incomplete."""
        for field, value in (("identities",[0,1,1]), ("identityRoots",[0,1,1])):
            data = observation()
            if field == "identityRoots":
                data["retained"]["identities"] = value
            data["retained"][field] = value
            result = c.receipt(data,set())
            self.assertEqual(result["status"],"BLOCK")
            self.assertEqual(result["bookingIds"],[])
            self.assertNotIn(B,json.dumps(result))

    def test_cross_scope_and_duplicate_candidates_suppress_ids(self):
        """A full-looking fixture remains blocked on any graph ownership conflict."""
        data = observation()
        data["retained"]["counts"]["booking_ops_records"]["scopeConflicts"] = 1
        self.assertIn("CROSS_SCOPE_ROWS",c.receipt(data,set())["blockCodes"])
        data = observation()
        data["retained"]["bookingIds"].append(I)
        data["retained"]["counts"]["booking_ops_records"]["incidentLinked"] = 2
        result = c.receipt(data,set())
        self.assertIn("MULTIPLE_CANDIDATES",result["blockCodes"])
        self.assertEqual(result["bookingIds"],[])

    def test_untrusted_receipts_reject_noninteger_counts_and_extra_fields(self):
        """Hostile shape/type/string payloads never become diagnostic output."""
        for mutate in (
            lambda d: d["retained"].update(private="secret"),
            lambda d: d["retained"]["counts"]["users"].update(incidentLinked=True),
            lambda d: d["retained"]["counts"]["users"].update(incidentLinked=-1),
            lambda d: d["retained"].update(bookingIds=["postgres://private"]),
            lambda d: d["retained"].update(bookingIds=[]),
            lambda d: d["retained"].update(nodeLimitExceeded="false"),
            lambda d: d["retained"].update(identities=[True,1,1])):
            data = observation(); mutate(data)
            with self.assertRaises(c.Block): c.receipt(data,set())

    def test_old_identity_and_count_drift_are_not_hidden(self):
        """Current old counts cannot be promoted to historical full-row preservation."""
        data = observation()
        data["old"]["identities"] = [0,1,1,1,0]
        result = c.receipt(data,set())
        self.assertEqual(result["status"],"BLOCK")
        self.assertEqual(result["oldIncident"]["identityChecks"][0]["exact"],0)
        data = observation()
        data["old"]["counts"]["booking_ops_events"]["incidentLinked"] = 23
        result = c.receipt(data,set())
        self.assertIn("OLD_EVIDENCE_COUNT_DRIFT",result["blockCodes"])

    def test_optional_absence_is_null_not_zero(self):
        """A relation which is not deployed is never silently counted as empty."""
        missing = {"payments"}
        data = observation()
        for section in data.values(): del section["counts"]["payments"]
        result = c.receipt(data,missing)
        self.assertIsNone(result["tables"]["payments"])
        self.assertIn("payments",result["notDeployed"])

    def test_id_collisions_and_graph_limit_block(self):
        """Old IDs, roots and same-ID booking/intake candidates are never released."""
        for value in (next(iter(c.ROOTS.values())), c.dep.prior.OWNED["booking"], I):
            data = observation(); data["retained"]["bookingIds"] = [value]
            self.assertIn("ID_COLLISION",c.receipt(data,set())["blockCodes"])
        data = observation(); data["retained"]["nodeLimitExceeded"] = True
        self.assertIn("GRAPH_LIMIT",c.receipt(data,set())["blockCodes"])

    def test_fixed_sql_has_readonly_snapshot_and_no_mutation_statement(self):
        """Use the existing guarded schema seam with source-fixed root constants."""
        sql = c.guarded_sql(catalog(),set())
        self.assertIn("REPEATABLE READ READ ONLY",sql)
        self.assertIn("SET LOCAL row_security=off",sql)
        self.assertIn("IN ACCESS SHARE MODE",sql)
        self.assertTrue(sql.endswith("ROLLBACK;"))
        self.assertIn("C4_SCHEMA_RACE",sql)
        self.assertIn(c.RUN,sql)
        for root in c.ROOTS.values(): self.assertIn(root,sql)
        for word in ("INSERT INTO","UPDATE public.","DELETE FROM","TRUNCATE ","CREATE TABLE","DROP TABLE"):
            self.assertNotIn(word,sql)
        self.assertIn("'old',(",sql)
        self.assertIn("'retained',(",sql)

    def test_state_shape_unknown_values_and_column_drift_block(self):
        """Unknown state text is never reflected and untyped columns cannot be read."""
        data = observation()
        data["retained"]["states"]["booking_inbound_intake_events"].update(new=0,unknown=1)
        self.assertIn("UNKNOWN_STATE",c.receipt(data,set())["blockCodes"])
        data["retained"]["states"]["booking_inbound_intake_events"]["private-state"] = 1
        with self.assertRaises(c.Block): c.receipt(data,set())
        cat = catalog(); cat["tables"]["booking_cleaning_tasks"]["columns"]["status"] = "jsonb"
        with self.assertRaises(c.Block): c.schema_check(cat)

    def test_fixed_stage_receipt_never_exposes_exception(self):
        """Report the failed phase without echoing SQL or exception-controlled data."""
        for err, expected in ((RuntimeError("password=private"),"RETAINED_READONLY_UNPROVEN"),
                              (c.StageFailure("CATALOG"),"RETAINED_CATALOG_UNPROVEN")):
            out = io.StringIO()
            with patch.object(c,"run",side_effect=err),contextlib.redirect_stdout(out):
                self.assertEqual(c.main([]),2)
            result = json.loads(out.getvalue())
            self.assertEqual(result["blockCode"],expected)
            self.assertNotIn("private",out.getvalue())

    def test_host_probe_uses_fixed_operator_without_database_or_lifecycle_execution(self):
        """Current host evidence reuses the validated probe, never the writer path."""
        env = environment()
        env.update(STAGING_SSH_HOST="staging.invalid", STAGING_SSH_USER="project_ayfaar",
                   STAGING_SSH_PORT="22", STAGING_SSH_PRIVATE_KEY="synthetic-key-"*20)
        success = {"status":"C4_READONLY_PREFLIGHT_PASS", "releaseSha":c.host_probe.RELEASE,
                   "noSendFlags":7, "unauthorizedRoutes":0, "stagingWrites":False,"fullE2E":"NOT_RUN"}
        with patch.object(c.dep.prior.g0,"checked",return_value=SimpleNamespace(stdout=env["GITHUB_SHA"].encode())), \
             patch.object(c.host_probe,"probe",return_value=success) as probe, \
             patch.object(c.dep,"execute") as database:
            result = c.host_run(env)
            self.assertTrue(result["operatorConfigured"])
            self.assertEqual(probe.call_args.kwargs,{"operator_email":c.EMAIL,"config_only":True})
            self.assertFalse(result["physicalReplayAuthorized"])
            database.assert_not_called()
        for error, code in ((c.host_probe.Block("HOST_FRESH_OPERATOR_NOT_CONFIGURED"),"HOST_FRESH_OPERATOR_NOT_CONFIGURED"),
                            (c.host_probe.Block("password=private"),"HOST_PREFLIGHT_UNPROVEN")):
            with patch.object(c.dep.prior.g0,"checked",return_value=SimpleNamespace(stdout=env["GITHUB_SHA"].encode())), \
                 patch.object(c.host_probe,"probe",side_effect=error):
                result = c.host_run(env)
                self.assertEqual(result["blockCode"],code)
                self.assertNotIn("private",json.dumps(result))
        with patch.object(c.host_probe,"probe") as probe:
            with self.assertRaises(c.StageFailure): c.host_run(dict(env,GITHUB_RUN_ATTEMPT="2"))
            probe.assert_not_called()

    def test_host_config_only_removes_post_and_preserves_default_admission(self):
        """The old physical mode retains five routes; the new reader emits none."""
        scripts = {}
        for config_only in (False, True):
            report = {"status":"C4_READONLY_PREFLIGHT_PASS", "releaseSha":c.host_probe.RELEASE,
                      "noSendFlags":7, "unauthorizedRoutes":0 if config_only else 5,
                      "stagingWrites":False, "fullE2E":"NOT_RUN"}
            with patch.object(c.host_probe.backup_export,"ssh_identity",return_value=Path("known-fixture")), \
                 patch.object(c.host_probe.g0,"checked",return_value=SimpleNamespace(returncode=0,stdout=json.dumps(report).encode())) as checked:
                self.assertEqual(c.host_probe.probe({"STAGING_SSH_PRIVATE_KEY":"fake"},"host.invalid",22,
                    operator_email=c.EMAIL,config_only=config_only),report)
                scripts[config_only] = checked.call_args.kwargs["stdin"].decode()
                compile(scripts[config_only],"host-script","exec")
        self.assertIn('("POST","/api/dashboard/booking-ops/intake/process")',scripts[False])
        self.assertNotIn('"POST"',scripts[True])
        self.assertNotIn('/api/dashboard/',scripts[True])
        self.assertIn('routes=()',scripts[True])
        self.assertEqual(scripts[False].split('    routes=(',1)[0],scripts[True].split('    routes=()',1)[0])
        with patch.object(c.host_probe.backup_export,"ssh_identity") as identity:
            with self.assertRaises(c.host_probe.Block):
                c.host_probe.probe({},"host.invalid",22,config_only=1)
            with patch.object(c.host_probe,"HOST_SCRIPT",c.host_probe.HOST_SCRIPT.replace('    routes=(', '    changed_routes=(')):
                with self.assertRaises(c.host_probe.Block):
                    c.host_probe.probe({},"host.invalid",22,config_only=True)
            identity.assert_not_called()

    def test_workflow_contains_no_unguarded_secret_or_dispatch_on_pr(self):
        """A PR runs only credential-free checks; protected reads need exact main."""
        text = Path(__file__).parents[2].joinpath(".github/workflows/strigunov4-c4-retained-readonly.yml").read_text()
        protected = text.split("  protected_retained_readonly:",1)[1]
        self.assertIn("environment: staging",protected)
        self.assertIn("github.event_name == 'workflow_dispatch'",protected)
        self.assertIn('test "$GITHUB_RUN_ATTEMPT" = "1"',protected)
        self.assertIn('test "$INCIDENT" = "39127850376"',protected)
        self.assertIn("persist-credentials: false",protected)
        self.assertNotIn("secrets.",text.split("  protected_retained_readonly:",1)[0])
        self.assertNotIn("upload-artifact",text)
        self.assertEqual(text.count("environment: staging"),2)
        self.assertEqual(text.count('test "$GITHUB_RUN_ATTEMPT" = "1"'),2)
        self.assertIn("c4_retained_readonly.py --host-only",text)
        for forbidden in ("SERVICE_ROLE_KEY", "SESSION_SECRET", "physical_approved_gate.py"):
            self.assertNotIn(forbidden,text)


if __name__ == "__main__":
    unittest.main()
