"""Offline candidate digest guard tests, including negative/forged cases."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import verify_candidate_hashes as v


class CandidateDigestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        hashes = {}
        for name in sorted(v.EXPECTED):
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            content = ("verified fixture:" + name).encode()
            file.write_bytes(content)
            hashes[name] = hashlib.sha256(content).hexdigest()
        self.hashes = hashes
        self._dump()

    def _dump(self):
        (self.root / "SHA256SUMS.json").write_text(
            json.dumps(self.hashes, sort_keys=True), encoding="utf-8"
        )

    def test_clean_fixture(self):
        self.assertEqual(v.verify(self.root), 17)

    def test_actual_source_reviewed_digests(self):
        # Fail if any reviewed snapshot file has drifted without a digest update.
        self.assertEqual(v.verify(v.ROOT), 17)

    def test_modified_sql_rejected(self):
        path = next(name for name in self.hashes if name.startswith("sql/"))
        (self.root / path).write_bytes(b"tampered sql")
        with self.assertRaisesRegex(v.IntegrityBlock, "CHECKSUM_MISMATCH"):
            v.verify(self.root)

    def test_missing_expected_entry_rejected(self):
        self.hashes.pop("systemd_candidate.py")
        self._dump()
        with self.assertRaisesRegex(v.IntegrityBlock, "MANIFEST_FILE_SET"):
            v.verify(self.root)

    def test_extra_entry_rejected(self):
        self.hashes["extra.sql"] = hashlib.sha256(b"").hexdigest()
        self._dump()
        with self.assertRaisesRegex(v.IntegrityBlock, "MANIFEST_FILE_SET"):
            v.verify(self.root)

    def test_unlisted_sql_file_rejected_even_when_manifest_unchanged(self):
        # A second matching prefix must never be admitted to the candidate tree.
        extra = self.root / "sql" / "20261003124500_UNREVIEWED.sql"
        extra.write_bytes(b"SELECT 1;")
        with self.assertRaisesRegex(v.IntegrityBlock, "UNLISTED_SQL_FILE"):
            v.verify(self.root)

    def test_unlisted_sql_directory_rejected(self):
        (self.root / "sql" / "unexpected").mkdir()
        with self.assertRaisesRegex(v.IntegrityBlock, "UNLISTED_SQL_FILE"):
            v.verify(self.root)

    def test_renderer_uses_exact_reviewed_names_not_glob(self):
        import build_candidate as builder
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            directory = root / "sql"
            directory.mkdir()
            for name in builder.SQL_NAMES.values():
                (directory / name).write_bytes(b"synthetic")
            # The extra prefix would have been accepted nondeterministically by glob.
            (directory / "20261003124500_UNREVIEWED.sql").write_bytes(b"malicious")
            selected = builder.source_files(builder.ORDER, root)
            self.assertEqual([p.name for p in selected],
                             [builder.SQL_NAMES[version] for version in builder.ORDER])

    def test_forged_approval_bool_rejected(self):
        self.hashes["plan.json"] = True
        self._dump()
        with self.assertRaisesRegex(v.IntegrityBlock, "INVALID_ENTRY"):
            v.verify(self.root)

    def test_bad_hash_rejected(self):
        self.hashes["plan.json"] = "bad"
        self._dump()
        with self.assertRaisesRegex(v.IntegrityBlock, "INVALID_ENTRY"):
            v.verify(self.root)

    def test_duplicate_manifest_key_rejected(self):
        (self.root / "SHA256SUMS.json").write_text(
            '{"a":"1","a":"2"}', encoding="utf-8"
        )
        with self.assertRaises(v.IntegrityBlock):
            v.verify(self.root)

    def test_symlinked_sql_directory_rejected(self):
        with tempfile.TemporaryDirectory() as other:
            target = Path(other) / "original"
            target.mkdir()
            sql_dir = self.root / "sql"
            for entry in sql_dir.iterdir():
                (target / entry.name).write_bytes(entry.read_bytes())
                entry.unlink()
            sql_dir.rmdir()
            try:
                sql_dir.symlink_to(target, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable on this runner")
            with self.assertRaisesRegex(v.IntegrityBlock, "SQL_DIRECTORY_INVALID"):
                v.verify(self.root)

    def test_symlinked_manifest_rejected(self):
        file = self.root / "SHA256SUMS.json"
        data = file.read_bytes()
        file.unlink()
        target = self.root / "outside.json"
        target.write_bytes(data)
        try:
            file.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable on this runner")
        with self.assertRaisesRegex(v.IntegrityBlock, "NONREGULAR_FILE"):
            v.verify(self.root)

    def test_manifest_size_limit(self):
        (self.root / "SHA256SUMS.json").write_bytes(b" " * 16385)
        with self.assertRaisesRegex(v.IntegrityBlock, "MANIFEST_OVERSIZE"):
            v.verify(self.root)


if __name__ == "__main__":
    unittest.main()
