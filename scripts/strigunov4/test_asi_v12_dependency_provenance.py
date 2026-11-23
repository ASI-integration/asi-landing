"""Offline regressions: dependency absence and byte binding grant no authority.

Only pure validation/SQL generation is exercised; no operational entry point runs.
"""
import copy
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import c4_dependency_readonly as dependency
import execution_manifest as binding


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class ExecutionBindingRegressionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="asi-binding-test-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.relative = "supabase/migrations/20261016090000_fixture.sql"
        self.path = self.root / self.relative
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(b"SELECT 1;\n")
        self.archive = self.root / ("asi-staging-" + "a" * 40 + ".tgz")
        self.archive.write_bytes(b"offline bytes, never extracted")
        self.manifest = {
            "schemaVersion": binding.SCHEMA, "repository": binding.REPOSITORY,
            "target": {"environment": "staging", "projectRef": "meeravcldnmocjtlqoeu",
                       "service": "asi-landing-staging", "releaseRoot": "/var/www/asi-staging/releases"},
            "release": {"gitSha": "a" * 40, "sourceTreeSha": "b" * 40,
                        "archive": self.archive.name, "sha256": digest(self.archive.read_bytes()),
                        "bytes": self.archive.stat().st_size, "sourceLockSha256": "c" * 64},
            "migrations": [{"path": self.relative, "sha256": digest(self.path.read_bytes())}],
            "provenance": {"taskId": "offline", "taskCycle": "regression",
                           "requestedAction": "staging_migration",
                           "workflowRef": binding.REPOSITORY + "/.github/workflows/fixture.yml@refs/heads/main",
                           "workflowSha": "d" * 40, "runId": 1, "runAttempt": 1,
                           "artifactId": 2, "reviewReference": "synthetic-only"},
        }
        self.expected = copy.deepcopy(self.manifest)
        self.package = dict(self.manifest["release"], g0SourceSha="e" * 40,
                            environment="staging", appVersion="fixture", activationPerformed=False)
        # Bytes and metadata must survive both successful and failed validations.
        self.before = self.snapshot()
        self.addCleanup(self.assert_inputs_unchanged)

    def snapshot(self):
        return {str(p.relative_to(self.root)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.root.rglob("*") if p.is_file()}

    def assert_inputs_unchanged(self):
        self.assertEqual(self.snapshot(), self.before)

    def validate(self, *, sql=None, archive=None):
        if sql is None:
            sql = {self.relative: binding.sql_file(self.root, self.relative).read_bytes()}
        with io.BytesIO(self.archive.read_bytes() if archive is None else archive) as stream:
            return binding.validate_manifest(self.manifest, self.expected, self.package, sql, stream)

    def test_matching_files_bind_without_authorizing_mutation(self):
        result = self.validate()
        self.assertEqual(result["status"], "BOUND_NOT_AUTHORIZED")
        self.assertEqual(result["migrationCount"], 1)
        for field in ("authorization", "mutationAllowed", "provenanceAuthenticated"):
            self.assertIs(result[field], False)
        self.assertEqual((self.manifest, self.package),
                         (self.expected, dict(self.expected["release"], g0SourceSha="e" * 40,
                          environment="staging", appVersion="fixture", activationPerformed=False)))

    def test_traversal_and_absolute_paths_are_rejected(self):
        for relative in ("../fixture.sql", "/" + self.relative,
                         "supabase/migrations/../20261016090000_fixture.sql"):
            with self.subTest(relative=relative):
                with self.assertRaisesRegex(binding.BindingError, "^MIGRATION_PATH$"):
                    binding.sql_file(self.root, relative)
                manifest = copy.deepcopy(self.manifest)
                manifest["migrations"][0]["path"] = relative
                with self.assertRaisesRegex(binding.BindingError, "^MIGRATION_PATH$"):
                    binding.validate_shape(manifest)

    def test_symlink_component_cannot_redirect_sql_lookup(self):
        alias = self.root / "alias"
        alias.mkdir()
        (alias / "supabase").symlink_to(self.root / "supabase", target_is_directory=True)
        with self.assertRaisesRegex(binding.BindingError, "^SQL_SYMLINK$"):
            binding.sql_file(alias, self.relative)
        (alias / "supabase").unlink()
        alias.rmdir()

    def test_same_size_hash_corruption_and_absent_sql_fail_closed(self):
        raw = self.path.read_bytes()
        with self.assertRaisesRegex(binding.BindingError, "^SQL_BYTES_MISMATCH$"):
            self.validate(sql={self.relative: b"X" + raw[1:]})
        raw = self.archive.read_bytes()
        with self.assertRaisesRegex(binding.BindingError, "^ARCHIVE_BYTES_MISMATCH$"):
            self.validate(archive=b"X" + raw[1:])
        with self.assertRaisesRegex(binding.BindingError, "^SQL_FILE_SET$"):
            self.validate(sql={})
        with self.assertRaisesRegex(binding.BindingError, "^SQL_FILE_MISSING$"):
            binding.sql_file(self.root, "supabase/migrations/20261016090001_absent.sql")

    def test_provenance_and_package_identity_must_match_reviewed_binding(self):
        self.manifest["provenance"]["artifactId"] += 1
        with self.assertRaisesRegex(binding.BindingError, "^EXPECTED_BINDING_MISMATCH$"):
            self.validate()
        self.manifest = copy.deepcopy(self.expected)
        self.package["sourceTreeSha"] = "f" * 40
        with self.assertRaisesRegex(binding.BindingError, "^PACKAGE_BINDING_MISMATCH$"):
            self.validate()


class DependencyRegressionTests(unittest.TestCase):
    def catalog(self):
        aliases = {"bigint": "int8", "integer": "int4", "int": "int4", "boolean": "bool"}
        return {
            "optionalModule": {"historyContract": True, "versionRows": 0, "hardeningRows": 0,
                               "functionCount": 0, "functionMatches": 0, "defaultConfigCount": 0,
                               "hardenedConfigCount": 0, "triggerShapeMatches": 0},
            "tables": {name: {"kind": "r", "inherited": False, "rules": 0,
                              "columns": {k: aliases.get(v, v) for k, v in spec["columns"].items()},
                              "pk": copy.deepcopy(spec["pk"]),
                              "triggers": [copy.deepcopy(t) for t in spec["triggers"]
                                           if name != dependency.OPTIONAL_TABLE or t != dependency.OPTIONAL_TRIGGER]}
                       for name, spec in dependency.TABLES.items()},
            "edges": [dict(copy.deepcopy(e), childSchema="public", update="a", match="s",
                           validated=True, deferrable=False) for e in dependency.EDGES],
        }

    def absent_catalog(self):
        catalog = self.catalog()
        catalog["tables"][dependency.OPTIONAL_TABLE] = None
        catalog["edges"] = [e for e in catalog["edges"]
                            if dependency.OPTIONAL_TABLE not in (e["child"], e["parent"])]
        return catalog

    def receipt(self, missing):
        return {"identities": [1, 1, 1, 1, 0], "identityRoots": [1, 1, 1, 1, 0],
                "nodeLimitExceeded": False,
                "counts": {t: {"incidentLinked": 0, "scopeConflicts": 0}
                           for t in dependency.TABLES if t not in missing}}

    def test_absent_optional_dependency_is_reported_without_authority(self):
        catalog = self.absent_catalog()
        before = copy.deepcopy(catalog)
        missing = dependency.schema_check(catalog)
        self.assertEqual(missing, {dependency.OPTIONAL_TABLE})
        self.assertEqual(dependency.optional_module_witness(catalog["optionalModule"])["state"], "NOT_DEPLOYED")
        data = self.receipt(missing)
        original = copy.deepcopy(data)
        result = dependency.receipt(data, missing)
        self.assertEqual(result["status"], "C4_DEPENDENCY_READONLY_SCOPED_PASS")
        self.assertEqual(result["notDeployed"], [dependency.OPTIONAL_TABLE])
        self.assertIsNone(result["tables"][dependency.OPTIONAL_TABLE])
        for field in ("stagingWrites", "cleanupAuthorized", "physicalReplayAuthorized"):
            self.assertIs(result[field], False)
        self.assertEqual((catalog, data), (before, original))
        sql = dependency.guarded_sql(catalog, missing)
        self.assertTrue(sql.startswith("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;"))
        self.assertTrue(sql.endswith("ROLLBACK;"))
        self.assertIn("IN ACCESS SHARE MODE;", sql)
        self.assertIn("C4_SCHEMA_RACE", sql)

    def test_missing_required_dependency_and_false_absence_are_blocked(self):
        catalog = self.catalog()
        self.assertEqual(dependency.schema_check(catalog), set())
        catalog["tables"]["users"] = None
        with self.assertRaisesRegex(dependency.Block, "^MISSING_REQUIRED_RELATION$"):
            dependency.schema_check(catalog)
        catalog = self.absent_catalog()
        catalog["optionalModule"]["versionRows"] = 1
        with self.assertRaisesRegex(dependency.OptionalModuleMismatch, "^OPTIONAL_MODULE_HISTORY_OBJECT_DRIFT$"):
            dependency.schema_check(catalog)

    def test_present_id_with_wrong_identity_is_not_an_absent_fixture(self):
        data = self.receipt(set())
        data["identities"][0] = 0
        original = copy.deepcopy(data)
        with self.assertRaisesRegex(dependency.IncidentIdentityMismatch, "^INCIDENT_IDENTITY$") as caught:
            dependency.receipt(data, set())
        self.assertEqual(caught.exception.details[0],
                         {"category": "user", "exact": 0, "presentById": 1})
        self.assertEqual(data, original)


if __name__ == "__main__":
    unittest.main()
