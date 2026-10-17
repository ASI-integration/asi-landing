"""Offline tests for staging read-only admission; never connect to staging."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import protected_staging_admission as a
import protected_staging_host_probe as host


def good():
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": a.REPO,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": a.WORKFLOW,
        "GITHUB_WORKFLOW_SHA": "a" * 40,
        "GITHUB_SHA": "a" * 40,
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_ACTOR": "ASI-integration",
        "GITHUB_ACTOR_ID": "207600140",
        "GITHUB_TRIGGERING_ACTOR": "ASI-integration",
        "GITHUB_RUN_ATTEMPT": "1",
        "GITHUB_RUN_ID": "39012932870",
        "STRIGUNOV_CONFIRM": a.RUN_CONFIRMATION,
        "STRIGUNOV_REVIEWED_MAIN_SHA": "a" * 40,
        "STAGING_SUPABASE_PROJECT_REF": a.PROJECT,
        "STAGING_APP_PATH": a.APP_ROOT,
        "STAGING_PORT": "3001",
        "STAGING_SSH_HOST": "staging.example.invalid",
        "STAGING_SSH_USER": "project_ayfaar",
        "STAGING_SSH_PORT": "22",
        "STAGING_SSH_PRIVATE_KEY": "TEST_ONLY_DO_NOT_USE",
    }


class ProtectedAdmissionTests(unittest.TestCase):
    def test_good_context_is_format_admissible_not_an_authorization(self):
        self.assertEqual(a.validate_run(good()), ("staging.example.invalid", 22))

    def test_each_identity_dimension_rejects_tampering(self):
        for name, value in {
            "GITHUB_REPOSITORY": "ASI-integration/other",
            "GITHUB_REF": "refs/heads/feature",
            "GITHUB_WORKFLOW_REF": a.WORKFLOW.replace("main", "dev"),
            "GITHUB_WORKFLOW_SHA": "b" * 40,
            "GITHUB_EVENT_NAME": "pull_request",
            "GITHUB_ACTOR": "other",
            "GITHUB_ACTOR_ID": "7",
            "GITHUB_TRIGGERING_ACTOR": "other",
            "GITHUB_RUN_ATTEMPT": "2",
            "GITHUB_RUN_ID": "0",
            "STRIGUNOV_CONFIRM": "DEPLOY_NOW",
            "STRIGUNOV_REVIEWED_MAIN_SHA": "b" * 40,
            "STAGING_SUPABASE_PROJECT_REF": "jwinifeienvzejofmbua",
            "STAGING_APP_PATH": "/var/www/asi",
            "STAGING_PORT": "3000",
            "STAGING_SSH_USER": "root",
            "STAGING_SSH_HOST": "-proxy",
            "STAGING_SSH_PORT": "0",
            "STAGING_SSH_PRIVATE_KEY": "",
        }.items():
            with self.subTest(name=name):
                changed = good()
                changed[name] = value
                with self.assertRaises(a.Block):
                    a.validate_run(changed)

    def test_missing_context_blocks_without_running_commands(self):
        with patch.object(a, "checked") as command, patch.object(a, "verify_sql") as sql:
            with self.assertRaises(a.Block):
                a.run_preflight({"GITHUB_REPOSITORY": a.REPO})
            command.assert_not_called()
            sql.assert_not_called()

    def test_exact_sources_positive_and_corrupt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            src = [("one.sql", "1"), ("two.sql", "2")]
            import hashlib
            pinned = []
            for file, data in src:
                (root / file).write_text(data)
                pinned.append((file, hashlib.sha256(data.encode()).hexdigest()))
            with patch.object(a, "SQL_FILES", tuple(pinned)):
                with self.assertRaisesRegex(a.Block, "SQL_FILE_SET"):
                    a.verify_sql(root)
            # Nine distinct source paths are required.
            for i in range(7):
                file = f"file_{i}.sql"
                (root / file).write_bytes(str(i).encode())
                pinned.append((file, hashlib.sha256(str(i).encode()).hexdigest()))
            with patch.object(a, "SQL_FILES", tuple(pinned)):
                self.assertTrue(a.verify_sql(root))
                (root / "one.sql").write_text("CORRUPTED")
                with self.assertRaisesRegex(a.Block, "SQL_BYTES_MISMATCH"):
                    a.verify_sql(root)

    def test_missing_and_symlinked_source_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(a.Block):
                a._file_digest(root, "missing.sql")
            origin = root / "trusted.sql"
            origin.write_text("trusted")
            link = root / "link.sql"
            try:
                link.symlink_to(origin)
            except (OSError, NotImplementedError):
                self.skipTest("OS denies local symlink creation")
            with self.assertRaisesRegex(a.Block, "SYMLINK_COMPONENT"):
                a._file_digest(root, "link.sql")

    def test_no_mutation_before_remote_probe(self):
        with patch.object(a, "validate_run", side_effect=a.Block("NO_AUTH")), \
             patch.object(a, "checked") as command, \
             patch.object(a, "verify_sql") as source:
            with self.assertRaisesRegex(a.Block, "NO_AUTH"):
                a.run_preflight(good())
            command.assert_not_called()
            source.assert_not_called()

    def test_host_reports_missing_no_send_as_block_not_pass(self):
        with patch.object(host, "archive_verified", return_value=True), \
             patch.object(host, "stage_state", return_value=["MISSING_OR_MISMATCH_ASI_SYNTHETIC_NO_SEND"]):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(host.main(), 0)
            report = json.loads(out.getvalue())
            self.assertEqual(report["status"], "BLOCK")
            self.assertFalse(report["no_send_ready"])
            self.assertEqual(report["checked_flags"], 7)
            self.assertNotIn("password", out.getvalue().lower())

    def test_host_only_claims_pass_with_full_checks(self):
        with patch.object(host, "archive_verified", return_value=True), \
             patch.object(host, "stage_state", return_value=[]):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(host.main(), 0)
            report = json.loads(out.getvalue())
            self.assertEqual(report["status"], "PREFLIGHT_PASS")
            self.assertTrue(report["no_send_ready"])

    def test_host_never_fabricates_success_on_exception(self):
        with patch.object(host, "archive_verified", side_effect=RuntimeError("secret hidden")):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(host.main(), 0)
            report = json.loads(out.getvalue())
            self.assertEqual(report["status"], "BLOCK")
            self.assertNotIn("secret hidden", out.getvalue())

    def test_source_only_rejects_operational_control(self):
        paths = [Path(a.__file__), Path(host.__file__)]
        for path in paths:
            text = path.read_text()
            self.assertNotIn("merge-base", text)
            self.assertNotIn("systemctl stop", text)
            self.assertNotIn("systemctl restart", text)
            self.assertNotIn("pg_restore", text)
            self.assertNotIn("supabase db push", text)


if __name__ == "__main__":
    unittest.main()
