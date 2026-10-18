"""Focused security/transport tests for the fixed dependency census."""
import contextlib
import copy
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import c4_dependency_readonly as c


def environment():
    """Use the existing synthetic URL shape; no credential can reach a database."""
    sha = "a"*40
    return {"GITHUB_ACTIONS":"true", "GITHUB_REPOSITORY":c.prior.REPO,
            "GITHUB_EVENT_NAME":"workflow_dispatch", "GITHUB_REF":"refs/heads/main",
            "GITHUB_WORKFLOW_REF":c.WORKFLOW, "GITHUB_ACTOR":"ASI-integration",
            "GITHUB_ACTOR_ID":"207600140", "GITHUB_TRIGGERING_ACTOR":"ASI-integration",
            "GITHUB_RUN_ATTEMPT":"1", "STAGING_SUPABASE_PROJECT_REF":c.prior.PROJECT,
            "C4_INCIDENT_RUN":c.prior.INCIDENT_RUN, "GITHUB_SHA":sha,
            "GITHUB_WORKFLOW_SHA":sha, "C4_REVIEWED_MAIN_SHA":sha,
            "C4_CONFIRM":"PROVE_C4_DEPENDENCIES_"+sha,
            "STAGING_DATABASE_URL":"postgresql://postgres:fixture@db.meeravcldnmocjtlqoeu.supabase.co:5432/postgres?sslmode=verify-full"}


def catalog():
    """Construct metadata for pure validation tests; real SQL is tested separately."""
    aliases = {"bigint":"int8", "integer":"int4", "int":"int4", "boolean":"bool"}
    return {"tables":{t:{"kind":"r", "inherited":False,
                         "columns":{k:aliases.get(v,v) for k,v in d["columns"].items()},
                         "pk":d["pk"], "triggers":d["triggers"], "rules":0}
                      for t,d in c.TABLES.items()},
            "edges":[dict(e, childSchema="public", update="a", match="s",
                          validated=True, deferrable=False) for e in c.EDGES]}


class DependencyUnitTests(unittest.TestCase):
    def test_context_each_guard(self):
        """Wrong owner, workflow, attempt, SHA or target must stop before subprocess."""
        env = environment()
        with patch.object(c.prior.pg.preflight, "target_valid", return_value=True):
            self.assertEqual(c.validate(env), env["STAGING_DATABASE_URL"])
            for key in env:
                changed = dict(env, **{key:"wrong"})
                if key == "STAGING_DATABASE_URL":
                    continue
                with self.subTest(key=key), self.assertRaises(c.Block):
                    c.validate(changed)

    def test_target_tls_validation_is_required(self):
        """Unverified database target cannot inherit workflow authorization."""
        with patch.object(c.prior.pg.preflight, "target_valid", return_value=False):
            with self.assertRaises(c.Block):
                c.validate(environment())

    def test_catalog_unknown_fk_action_columns_and_primary_key(self):
        """Unknown, reordered or weakened constraints never become accepted edges."""
        original = catalog()
        self.assertEqual(c.schema_check(original), set())
        variants = []
        for field,value in [("childSchema","private"),("child","unreviewed"),
                            ("delete","d"),("columns",["wrong"]),("validated",False),
                            ("deferrable",True),("update","c")]:
            changed = copy.deepcopy(original)
            changed["edges"][0][field] = value
            variants.append(changed)
        changed = copy.deepcopy(original)
        changed["tables"]["users"]["pk"] = ["email"]
        variants.append(changed)
        for changed in variants:
            with self.assertRaises(c.Block):
                c.schema_check(changed)

    def test_missing_core_and_column_type_and_trigger(self):
        """Required relation, type and trigger drift all fail closed."""
        for value in (None, {"kind":"v"}, {"inherited":True}, {"columns":{}},
                      {"triggers":[["unknown",7,"public","unknown"]]}, {"rules":1}):
            changed = catalog()
            if value is None:
                changed["tables"]["users"] = None
            else:
                changed["tables"]["users"].update(value)
            with self.assertRaises(c.Block):
                c.schema_check(changed)

    def test_trigger_drift_reports_all_tables_without_db_trigger_names(self):
        """All trigger drift names originate only in reviewed manifest."""
        changed = catalog()
        changed["tables"]["users"]["triggers"] = [["db_private_name",7,"public","db_function"]]
        changed["tables"]["accounts"]["triggers"] = [["other_db_name",19,"public","function"]]
        with self.assertRaises(c.TriggerMismatch) as ctx:
            c.schema_check(changed)
        self.assertEqual(str(ctx.exception),"TRIGGER_DRIFT")
        details=ctx.exception.details
        self.assertEqual([x["table"] for x in details],["accounts","users"])
        self.assertEqual([x["unexpectedOrChangedCount"] for x in details],[1,1])
        output=io.StringIO()
        with patch.object(c,"run",side_effect=ctx.exception), contextlib.redirect_stdout(output):
            self.assertEqual(c.main(),2)
        receipt=json.loads(output.getvalue())
        self.assertEqual(receipt["blockCode"],"TRIGGER_DRIFT")
        self.assertEqual(receipt["triggerDriftCount"],2)
        self.assertEqual([x["table"] for x in receipt["triggerDriftDetails"]],
                         ["accounts","users"])
        self.assertFalse(receipt["cleanupAuthorized"])
        self.assertFalse(receipt["stagingWrites"])
        self.assertFalse(receipt["physicalReplayAuthorized"])
        self.assertNotIn("db_private_name",output.getvalue())
        self.assertNotIn("db_function",output.getvalue())
        self.assertEqual(len(output.getvalue().splitlines()),1)

    def test_static_identifiers_and_missing_set(self):
        """No workflow input or arbitrary catalog identifier can choose row SQL."""
        for value in ("users; DELETE FROM users", "private.users", "x' OR true", ""):
            with self.assertRaises(c.Block):
                c.ident(value)
        with self.assertRaises(c.Block):
            c.table("not_in_manifest")
        with self.assertRaises(c.Block):
            c.census_sql({"arbitrary_table"})

    def test_sql_readonly_locks_rollback_and_no_mutation(self):
        """Queries retain read-only and snapshot barriers, with no data-writing SQL."""
        sql = c.guarded_sql(catalog(), set())
        for required in ("READ ONLY", "row_security=off", "ACCESS SHARE MODE",
                         "C4_SCHEMA_RACE", "WITH RECURSIVE", "LIMIT 10001", "ROLLBACK"):
            self.assertIn(required, sql)
        import re
        self.assertIsNone(re.search(r"\b(?:DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+public|CREATE\s+TABLE|ALTER\s+TABLE)\b", sql, re.I))

    def test_catalog_payload_cannot_terminate_guard_body(self):
        """Untrusted metadata is encoded data, never raw text inside a DO delimiter."""
        value = catalog()
        hostile = "$guard$; SELECT 'private payload'; --"
        value["tables"]["users"]["columns"][hostile] = "text"
        query = c.guarded_sql(value,set())
        self.assertNotIn(hostile,query)
        self.assertEqual(query.count("$guard$"),2)

    def test_receipt_privacy_limit_identity_and_extra_keys(self):
        """Reject raw data, booleans-as-counts, partial graphs and unknown output."""
        base = {"identities":[1]*5, "nodeLimitExceeded":False,
                "counts":{t:{"incidentLinked":0,"scopeConflicts":0} for t in c.TABLES}}
        result = c.receipt(base,set())
        self.assertFalse(result["cleanupAuthorized"])
        self.assertFalse(result["physicalReplayAuthorized"])
        for change in ({"identities":[True]*5}, {"nodeLimitExceeded":True},
                       {"payload":"private"}, {"counts":{"users":{"incidentLinked":True,"scopeConflicts":0}}}):
            with self.assertRaises(c.Block):
                c.receipt(dict(base,**change),set())

    def test_foreign_conflicts_keep_block(self):
        """Any cross-scope row preserves the unconditional cleanup hold."""
        data = {"identities":[1]*5, "nodeLimitExceeded":False,
                "counts":{t:{"incidentLinked":0,"scopeConflicts":0} for t in c.TABLES}}
        data["counts"]["booking_ops_worker_tasks"] = {"incidentLinked":1,"scopeConflicts":1}
        result = c.receipt(data,set())
        self.assertEqual(result["status"],"BLOCK")
        self.assertEqual(result["preservationPolicy"],"C4_DEPENDENCY_POLICY_REQUIRED")

    def test_error_and_raw_stderr_never_escape(self):
        """A sensitive subprocess error becomes a fixed code, not database contents."""
        output = io.StringIO()
        failed = SimpleNamespace(returncode=1,stdout=b"",stderr=b"password secret guest body")
        with patch.object(c.prior.g0,"checked",return_value=failed):
            with self.assertRaisesRegex(c.Block,"DEPENDENCY_QUERY_FAILED"):
                c.execute(["psql"],{})
        with patch.object(c,"run",side_effect=RuntimeError("secret row body")), contextlib.redirect_stdout(output):
            self.assertEqual(c.main(),2)
        self.assertNotIn("secret",output.getvalue())

    def test_transport_only_readonly_file_no_cli_size_limit(self):
        """Large fixed SQL goes through the read-only bind mount, never a writer."""
        env = environment()
        cat = catalog()
        data = {"identities":[1]*5,"nodeLimitExceeded":False,
                "counts":{t:{"incidentLinked":0,"scopeConflicts":0} for t in c.TABLES}}
        calls = []
        def execute(cmd, db_env):
            calls.append(list(cmd))
            self.assertEqual(cmd[-2:],["--file","/work/dependency.sql"])
            self.assertIn("default_transaction_read_only=on",db_env["PGOPTIONS"])
            return cat if len(calls)==1 else data
        with patch.object(c,"validate",return_value="fixture"), \
             patch.object(c.prior.g0,"checked",return_value=SimpleNamespace(stdout=(env["GITHUB_SHA"]+"\n").encode())), \
             patch.object(c.prior.g0,"exact_sql_history"), \
             patch.object(Path,"read_bytes",return_value=b"fixture"), \
             patch.object(c.prior.tls_guard,"ca_bytes",return_value=b"fixture"), \
             patch.object(c.prior.pg,"db_environment",return_value={"PGOPTIONS":"-c default_transaction_read_only=on"}) as db, \
             patch.object(c.prior.pg,"postgres_client_command",return_value=["psql","-c","placeholder"]), \
             patch.object(c,"execute",side_effect=execute):
            self.assertFalse(c.run(env)["cleanupAuthorized"])
            self.assertIs(db.call_args.args[-1],True)
        self.assertEqual(len(calls),2)


if __name__ == "__main__":
    unittest.main()
