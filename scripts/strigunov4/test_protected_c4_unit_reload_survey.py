"""Offline source-only admission and safe result tests for protected survey."""
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
import unittest

import c4_unit_contract as c
import protected_c4_unit_reload_survey as g
import protected_c4_operator_repair as transport

SHA = "a" * 40
RID = "999000123"


def context():
    return dict(GITHUB_ACTIONS="true", GITHUB_REPOSITORY=g.transport.REPO,
                GITHUB_REF="refs/heads/main", GITHUB_EVENT_NAME="workflow_dispatch",
                GITHUB_WORKFLOW_REF=g.WORKFLOW, GITHUB_WORKFLOW_SHA=SHA,
                GITHUB_ACTOR=transport.OWNER, GITHUB_TRIGGERING_ACTOR=transport.OWNER,
                GITHUB_ACTOR_ID=transport.OWNER_ID, GITHUB_RUN_ATTEMPT="1",
                STAGING_SSH_USER="project_ayfaar", GITHUB_SHA=SHA,
                STAGING_REVIEWED_MAIN_SHA=SHA, C4_OPERATOR_CONFIRM=g.PREFIX + SHA,
                C4_OPERATOR_INCIDENT=c.INCIDENT, GITHUB_RUN_ID=RID,
                STAGING_SSH_HOST="offline-staging.invalid", STAGING_SSH_PORT="22",
                STAGING_SSH_PRIVATE_KEY="offline-placeholder-key" * 10,
                GITHUB_TOKEN="fixture-token-not-used-" * 5)


def api(endpoint, token):
    if endpoint == "branches/main":
        return {"commit": {"sha": SHA}, "protected": True}
    if endpoint == "actions/workflows/" + g.WORKFLOW_FILE:
        return {"path": ".github/workflows/" + g.WORKFLOW_FILE, "state": "active", "id": 999}
    if endpoint.startswith("actions/workflows/" + g.WORKFLOW_FILE + "/runs?"):
        return {"total_count": 1, "workflow_runs": [
            {"id": int(RID), "workflow_id": 999, "run_attempt": 1, "head_sha": SHA,
             "head_branch": "main", "event": "workflow_dispatch"}]}
    if endpoint.startswith("actions/workflows/strigunov4-c4-unit-receipt-once.yml/runs?"):
        return {"total_count": 1, "workflow_runs": [
            {"id": g.PREVIOUS_RUN, "head_sha": g.PREVIOUS_SHA,
             "workflow_id": g.PREVIOUS_WORKFLOW, "run_attempt": 1,
             "head_branch": "main", "event": "workflow_dispatch",
             "status": "completed", "conclusion": "success"}]}
    if endpoint.startswith("actions/runs?"):
        return {"total_count": 0, "workflow_runs": []}
    raise AssertionError("unexpected endpoint")


def receipt():
    return {"status": "READONLY_MANAGER_SURVEY", "unit": "OLD_OPTIONAL_PREFLIGHT_PASS",
            "unitsSeen": 3, "units": "NO_FORBIDDEN_UNIT_NAME_OBSERVED",
            "jobs": "NONE_OBSERVED", "generators": "PRESENT",
            "unitCoverage": "LOADED_ALL_TYPES_ONLY",
            "unitStability": "SAME_LOADED_UNIT_STATES",
            "generatorCoverage": "FIXED_SYSTEM_AND_ENVIRONMENT_DIRS_ONLY",
            "isolation": "MANAGER_WIDE_NOT_PROVEN",
            "daemonReloadAuthorized": False, "snapshot": "NON_ATOMIC_CURRENT_ONLY"}


class ProtectedSurveyTests(unittest.TestCase):
    def test_01_exact_one_shot_admission(self):
        self.assertEqual(g.admit(context(), api), (SHA, RID))
        self.assertNotEqual(g.WORKFLOW_FILE, "strigunov4-c4-unit-receipt-once.yml")

    def test_02_owner_and_sha_mismatches_rejected(self):
        for key in ("GITHUB_ACTOR", "GITHUB_ACTOR_ID", "GITHUB_WORKFLOW_SHA",
                    "GITHUB_SHA", "GITHUB_RUN_ATTEMPT", "C4_OPERATOR_CONFIRM",
                    "C4_OPERATOR_INCIDENT", "GITHUB_REF"):
            with self.subTest(key=key), self.assertRaises(transport.Block):
                g.admit(dict(context(), **{key: "WRONG"}), api)

    def test_03_prior_dispatch_consumes_gate(self):
        for n in (0, 2, True):
            def changed(endpoint, token):
                value = api(endpoint, token)
                if g.WORKFLOW_FILE + "/runs?" in endpoint:
                    value["total_count"] = n
                return value
            with self.subTest(n=n), self.assertRaises(transport.Block):
                g.admit(context(), changed)

    def test_04_prerequisite_run_must_be_exact_success(self):
        for field, wrong in (("id", 1), ("head_sha", "f" * 40),
                             ("run_attempt", 2), ("conclusion", "failure"),
                             ("workflow_id", 9), ("status", "in_progress")):
            def changed(endpoint, token):
                value = api(endpoint, token)
                if "c4-unit-receipt-once.yml/runs?" in endpoint:
                    value["workflow_runs"][0][field] = wrong
                return value
            with self.subTest(field=field), self.assertRaises(transport.Block):
                g.admit(context(), changed)

    def test_05_concurrent_actions_any_event_rejected(self):
        for state in ("queued", "in_progress", "waiting", "pending", "requested"):
            def changed(endpoint, token):
                if endpoint.startswith("actions/runs?") and ("status=" + state) in endpoint:
                    self.assertNotIn("event=", endpoint)
                    return {"total_count": 1, "workflow_runs": [{"id": 123, "event": "push"}]}
                return api(endpoint, token)
            with self.subTest(state=state), self.assertRaises(transport.Block):
                g.admit(context(), changed)

    def test_06_moved_main_and_disabled_workflow_rejected(self):
        for endpoint_type in ("main", "workflow"):
            def changed(endpoint, token):
                value = api(endpoint, token)
                if endpoint_type == "main" and endpoint == "branches/main":
                    value["commit"]["sha"] = "f" * 40
                if endpoint_type == "workflow" and endpoint == "actions/workflows/" + g.WORKFLOW_FILE:
                    value["state"] = "disabled_manually"
                return value
            with self.subTest(endpoint_type=endpoint_type), self.assertRaises(transport.Block):
                g.admit(context(), changed)

    def test_07_closed_result_acceptance(self):
        self.assertEqual(g.decode(json.dumps(receipt()).encode(), 0), receipt())
        for field, value in (("jobs", "UNKNOWN"), ("generators", "CONFIRMED_SAFE"),
                             ("daemonReloadAuthorized", True), ("isolation", "PASS"),
                             ("unitsSeen", -1), ("unitCoverage", "ALL_INSTALLED_UNITS"),
                             ("unitStability", "SAFE"), ("generatorCoverage", "ALL_PROVEN"),
                             ("rawUnit", "SECRET")):
            invalid = dict(receipt(), **{field: value})
            with self.subTest(field=field), self.assertRaises((c.Block, transport.Block)):
                g.decode(json.dumps(invalid).encode(), 0)

    def test_08_nonzero_return_and_duplicate_json_rejected(self):
        with self.assertRaises((c.Block, transport.Block)):
            g.decode(json.dumps(receipt()).encode(), 2)
        with self.assertRaises(ValueError):
            g.decode(b'{"status":"SAFE","status":"OTHER"}', 0)

    def test_09_payload_fixed_modules_source_compiles(self):
        code = g.payload()
        compile(code, "staging-fixed-survey-fixture", "exec")
        self.assertIn(b"c4_unit_reload_survey", code)
        self.assertNotIn(b"c4_unit_transaction.py", code)
        self.assertNotIn(b"c4_operator_host.py", code)

    def test_10_failed_transport_never_prints_raw_exception(self):
        out = io.StringIO()
        with patch.object(g, "admit", return_value=(SHA, RID)), \
             patch.object(g.transport, "execute", side_effect=RuntimeError("SECRET_NEVERSHOW")), \
             redirect_stdout(out):
            self.assertEqual(g.main(), 2)
        self.assertNotIn("SECRET_NEVERSHOW", out.getvalue())
        self.assertEqual(json.loads(out.getvalue()),
                         {"status": "C4_MANAGER_SURVEY_ADMISSION_OR_READ_BLOCK"})

    def test_11_workflow_is_stage_only_no_mutation_job(self):
        root = Path(__file__).resolve().parents[2]
        data = (root / ".github/workflows" / g.WORKFLOW_FILE).read_text()
        for required in ("environment: staging", "cancel-in-progress: false",
                         "GITHUB_RUN_ATTEMPT", "READONLY_C4_RELOAD_SURVEY_",
                         "needs: [isolated_reload_tests]", "persist-credentials: false",
                         "test_protected_c4_unit_reload_survey.py"):
            self.assertIn(required, data)
        for forbidden in ("contents: write", "actions: write", "continue-on-error",
                          "STAGING_DATABASE_URL", "systemctl daemon-reload", "systemctl restart",
                          "c4_unit_transaction.py"):
            self.assertNotIn(forbidden, data)


if __name__ == "__main__":
    unittest.main()
