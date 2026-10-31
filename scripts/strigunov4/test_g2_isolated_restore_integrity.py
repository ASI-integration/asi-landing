"""Synthetic offline tests; no Beget/SQL/network/systemd access."""
import hashlib
import os
from pathlib import Path
import tempfile
import unittest

import g2_isolated_restore_integrity as g2


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.private = tempfile.TemporaryDirectory(prefix="asi-g2-source-only-")
        self.addCleanup(self.private.cleanup)
        self.root = Path(self.private.name)
        self.source = self.root / "source-copy"
        self.restored = self.root / "isolated-restored-copy"
        for folder in (self.source, self.restored):
            (folder / "sub").mkdir(parents=True)
            (folder / "sub" / "file.txt").write_bytes(b"synthetic baseline data")
        self.archive = self.root / "reviewed-backup.tar.gz"
        self.archive.write_bytes(b"synthetic archive fixture only")
        self.pin = hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def verify(self):
        return g2.inspect(self.source, self.restored, self.archive, self.pin)

    def test_identical_synthetic_copies_never_claim_physical(self):
        receipt = self.verify()
        self.assertEqual(receipt["status"], "G2_ISOLATED_COPIES_EQUAL_NOT_PHYSICAL_ACCEPTANCE")
        self.assertEqual(receipt["files"], 1)
        for field in ("authorization", "stageSwitched", "liveBackupProven",
                      "humanLoginProven", "independentWitnessProven"):
            self.assertIs(receipt[field], False)

    def test_changed_restored_byte_blocked(self):
        (self.restored / "sub" / "file.txt").write_bytes(b"changed")
        with self.assertRaisesRegex(g2.Block, "ISOLATED_RESTORE_BYTES_MISMATCH"):
            self.verify()

    def test_directory_permissions_divergence_blocked(self):
        (self.restored / "sub").chmod(0o700)
        with self.assertRaisesRegex(g2.Block, "ISOLATED_RESTORE_BYTES_MISMATCH"):
            self.verify()

    def test_changed_backup_byte_blocked(self):
        self.archive.write_bytes(b"changed backup")
        with self.assertRaisesRegex(g2.Block, "BACKUP_BYTES_MISMATCH"):
            self.verify()

    def test_invalid_or_uppercase_pin_blocked(self):
        for pin in ("", "0" * 63, self.pin.upper(), "not-verified"):
            if pin == self.pin:
                continue
            with self.subTest(pin=pin), self.assertRaisesRegex(g2.Block, "BACKUP_PIN_REQUIRED"):
                g2.inspect(self.source, self.restored, self.archive, pin)

    def test_same_or_nested_copy_blocked(self):
        with self.assertRaisesRegex(g2.Block, "NOT_TWO_ISOLATED_COPIES"):
            g2.inspect(self.source, self.source, self.archive, self.pin)
        with self.assertRaisesRegex(g2.Block, "NOT_TWO_ISOLATED_COPIES"):
            g2.inspect(self.source, self.source / "sub", self.archive, self.pin)

    def test_symlink_in_restored_copy_blocked(self):
        (self.restored / "sub" / "file.txt").unlink()
        (self.restored / "sub" / "file.txt").symlink_to(self.source / "sub" / "file.txt")
        with self.assertRaisesRegex(g2.Block, "NONREGULAR_OR_LINKED_FILE"):
            self.verify()

    def test_symlink_directory_blocked(self):
        (self.restored / "sub" / "file.txt").unlink()
        (self.restored / "sub").rmdir()
        (self.restored / "sub").symlink_to(self.source / "sub", target_is_directory=True)
        with self.assertRaisesRegex(g2.Block, "TREE_SYMLINK_OR_SPECIAL_DIR"):
            self.verify()

    def test_hardlink_blocked(self):
        os.link(self.source / "sub" / "file.txt", self.root / "extra-link")
        with self.assertRaisesRegex(g2.Block, "NONREGULAR_OR_LINKED_FILE"):
            self.verify()

    def test_walk_errors_are_fail_closed(self):
        from unittest.mock import patch
        def denied(_path, **kwargs):
            kwargs["onerror"](PermissionError("fixture"))
            yield None
        with patch.object(g2.os, "walk", side_effect=denied):
            with self.assertRaisesRegex(g2.Block, "TREE_READ_FAILED"):
                self.verify()

    def test_empty_tree_blocked(self):
        (self.restored / "sub" / "file.txt").unlink()
        with self.assertRaisesRegex(g2.Block, "EMPTY_TREE"):
            self.verify()

    def test_archive_inside_source_copy_blocked(self):
        archive = self.source / "backup.tar.gz"
        archive.write_bytes(b"test")
        with self.assertRaisesRegex(g2.Block, "ARCHIVE_INSIDE_COPY"):
            g2.inspect(self.source, self.restored, archive,
                       hashlib.sha256(b"test").hexdigest())

    def test_live_protected_paths_blocked_before_read(self):
        for live in ("/var/www/asi-staging/current", "/etc/asi-g2-witness-policy.json"):
            with self.subTest(live=live), self.assertRaisesRegex(g2.Block, "PROTECTED_INPUT_PATH"):
                g2.inspect(live, self.restored, self.archive, self.pin)

    def test_exit_codes_and_redacted_json(self):
        from unittest.mock import patch
        from io import StringIO
        stream = StringIO()
        with patch("sys.stdout", stream):
            code = g2.main(["--source-copy", str(self.source), "--restored-copy", str(self.restored),
                            "--backup-archive", str(self.archive),
                            "--expected-backup-sha256", "bad"])
        self.assertEqual(code, 2)
        self.assertIn('"status": "BLOCK"', stream.getvalue())
        self.assertNotIn(str(self.source), stream.getvalue())


if __name__ == "__main__":
    unittest.main()
