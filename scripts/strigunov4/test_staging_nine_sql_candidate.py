"""Source-only tests for the nine-migration transactional staging SQL bundle."""
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
import contextlib

import protected_staging_admission as gate
import staging_nine_sql_candidate as s


class NineSqlCandidateTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.sources = []
        for i, version in enumerate(s.VERSIONS):
            path = f"sql/{version}_synthetic_fixture.sql"
            file = self.root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            body = ("BEGIN;\n" if i == 6 else "") + f"SELECT {i+1};\n" + ("COMMIT;\n" if i == 6 else "")
            file.write_bytes(body.encode())
            self.sources.append((path, hashlib.sha256(body.encode()).hexdigest()))

    def render(self):
        return s.render(self.root, self.sources)

    def test_one_transaction_nine_ordered_history_rows(self):
        result = self.render()
        self.assertEqual(len(re.findall(r"(?m)^BEGIN;$", result)), 1)
        self.assertEqual(len(re.findall(r"(?m)^COMMIT;$", result)), 1)
        self.assertFalse(re.search(r"(?m)^ROLLBACK;$", result))
        self.assertEqual(result.count("VERIFIED_SOURCE_SHA256"), 9)
        self.assertEqual(result.count("ARRAY[]::text[]"), 9)
        self.assertLess(result.index(s.VERSIONS[0]), result.index(s.VERSIONS[-1]))
        self.assertIn("strigunov_preserved_history", result)
        self.assertIn("runtime_bridge_changed", result)
        self.assertIn("EXCEPT SELECT * FROM strigunov_runtime_functions", result)
        self.assertIn("UNION ALL", result)
        self.assertIn("unnest(ARRAY['anon','authenticated'])", result)
        self.assertIn("has_function_privilege(r.role,f.sig,'EXECUTE')", result)
        self.assertIn("unsafe_send_scope", result)
        self.assertIn("nine_history_rows_missing", result)
        self.assertIn("migration_history_column_contract", result)
        self.assertIn("purpose_constraint_baseline_missing", result)
        self.assertIn("source_schema_drift_booking_ops_records_automation_paused", result)
        self.assertIn("source_schema_drift_tg_property_knowledge_emergency_contacts", result)

    def test_determinism(self):
        self.assertEqual(self.render(), self.render())
        self.assertEqual(hashlib.sha256(self.render().encode()).hexdigest(),
                         hashlib.sha256(self.render().encode()).hexdigest())

    def test_byte_corruption_blocks(self):
        path = self.root / self.sources[0][0]
        path.write_bytes(b"ALTER ROLE postgres SUPERUSER;")
        with self.assertRaisesRegex(gate.Block, "SOURCE_DIGEST"):
            self.render()

    def test_unreviewed_embedded_commit_blocks(self):
        path, _ = self.sources[0]
        body = b"SELECT 1;\nCOMMIT;\n"
        (self.root / path).write_bytes(body)
        self.sources[0] = (path, hashlib.sha256(body).hexdigest())
        with self.assertRaisesRegex(gate.Block, "EMBEDDED_TRANSACTION"):
            self.render()

    def test_g0_transaction_required_exactly_once(self):
        path, _ = self.sources[6]
        body = b"SELECT 7;\n"
        (self.root / path).write_bytes(body)
        self.sources[6] = (path, hashlib.sha256(body).hexdigest())
        with self.assertRaisesRegex(gate.Block, "G0_TRANSACTION_SHAPE"):
            self.render()

    def test_order_and_number_cannot_change(self):
        reversed_files = self.sources[::-1]
        with self.assertRaisesRegex(gate.Block, "MIGRATION_ORDER"):
            s.render(self.root, reversed_files)
        with self.assertRaisesRegex(gate.Block, "FILE_COUNT"):
            s.render(self.root, self.sources[:8])

    def test_psql_meta_commands_in_source_block(self):
        path, _ = self.sources[0]
        body = b"SELECT 1;\n\\i ../../other.sql\n"
        (self.root / path).write_bytes(body)
        self.sources[0] = (path, hashlib.sha256(body).hexdigest())
        with self.assertRaisesRegex(gate.Block, "PSQL_META_IN_SOURCE"):
            self.render()

    def test_rollback_in_source_blocks(self):
        path, _ = self.sources[3]
        body = b"SELECT 4;\nROLLBACK;\n"
        (self.root / path).write_bytes(body)
        self.sources[3] = (path, hashlib.sha256(body).hexdigest())
        with self.assertRaisesRegex(gate.Block, "EMBEDDED_ROLLBACK"):
            self.render()

    def test_no_database_io_by_candidate(self):
        text = Path(s.__file__).read_text()
        self.assertNotIn("import psycopg", text)
        self.assertNotIn("subprocess.run", text)
        self.assertNotIn("psql -", text)
        self.assertNotIn("execute_sql(", text)

    def test_fail_closed_main_on_bad_unavailable_sources(self):
        with patch.object(s, "render", side_effect=gate.Block("NO_SOURCE")):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = s.main()
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(output.getvalue())["status"], "BLOCK")


if __name__ == "__main__":
    unittest.main()
