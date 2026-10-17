"""Offline tests for safe extraction of an already reviewed immutable G0 tar."""
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import g0_safe_extract as extract


REQUIRED = (
    "release-meta.json", ".next/BUILD_ID",
    "node_modules/next/dist/bin/next", "package-lock.json",
)


def tarball(path, extra=(), symlink_target=None):
    with tarfile.open(path, "w:gz") as tf:
        for name in REQUIRED:
            raw = ("test-only:" + name).encode()
            item = tarfile.TarInfo(name)
            item.size = len(raw)
            item.mode = 0o755 if name.endswith("/next") else 0o644
            tf.addfile(item, io.BytesIO(raw))
        for name, kind, data in extra:
            item = tarfile.TarInfo(name)
            if kind == "file":
                item.size = len(data)
                item.mode = 0o644
                tf.addfile(item, io.BytesIO(data))
            elif kind == "dir":
                item.type = tarfile.DIRTYPE
                tf.addfile(item)
            elif kind == "link":
                item.type = tarfile.SYMTYPE
                item.linkname = data
                tf.addfile(item)
            elif kind == "hardlink":
                item.type = tarfile.LNKTYPE
                item.linkname = data
                tf.addfile(item)
    return path


class ExtractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "fresh"
        self.target.mkdir()
        self.archive = self.root / "synthetic.tgz"

    def run_checked(self, extra=(), *, expected_files=4, expected_dirs=0, expected_symlinks=0):
        tarball(self.archive, extra=extra)
        receipt = dict(status="G0_TAR_CONTRACT_PASS", files=expected_files,
                       dirs=expected_dirs, symlinks=expected_symlinks)
        with patch.object(extract.archive_contract, "inspect", return_value=receipt) as checker:
            result = extract.extract_into_empty(self.archive, self.target)
        checker.assert_called_once_with(self.archive)
        return result

    def test_only_new_empty_directory(self):
        self.target.joinpath("existing.txt").write_text("leave intact")
        with self.assertRaisesRegex(extract.Block, "DESTINATION_NOT_EMPTY"):
            self.run_checked()

    def test_synthetic_complete_release(self):
        receipt = self.run_checked()
        self.assertEqual(receipt["status"], "G0_EXTRACTION_PASS")
        self.assertFalse(receipt["activeReleaseChanged"])
        for item in REQUIRED:
            self.assertTrue((self.target / item).is_file())
        if __import__("os").name != "nt":
            self.assertTrue((self.target / "node_modules/next/dist/bin/next").stat().st_mode & 0o111)

    def test_symlink_last_and_relative_only(self):
        items = [("node_modules/.bin/next", "link", "../next/dist/bin/next")]
        try:
            receipt = self.run_checked(items, expected_symlinks=1)
        except OSError:
            self.skipTest("Host does not permit creating symlinks")
        self.assertTrue((self.target / "node_modules/.bin/next").is_symlink())
        self.assertEqual(receipt["relativeSymlinks"], 1)

    def test_nested_directories_and_regular_files(self):
        extra = [("public", "dir", b""), ("public/asset.txt", "file", b"safe")]
        self.run_checked(extra, expected_files=5, expected_dirs=1)
        self.assertEqual((self.target / "public/asset.txt").read_bytes(), b"safe")

    def test_escape_symlink_rejected(self):
        items = [("node_modules/.bin/escape", "link", "../../../../outside")]
        with self.assertRaises(extract.archive_contract.Block):
            self.run_checked(items, expected_symlinks=1)

    def test_symlink_parent_path_rejected_before_extraction(self):
        extra = [("public/folder", "link", "../private"),
                 ("public/folder/file.txt", "file", b"must never be written")]
        with self.assertRaisesRegex(extract.Block, "SYMLINK_CHILD_PATH"):
            self.run_checked(extra, expected_files=5, expected_symlinks=1)
        self.assertEqual(list(self.target.iterdir()), [])

    def test_absolute_and_parent_paths_rejected(self):
        for path in ("/etc/sensitive", "../outside", "public/../outside"):
            with self.subTest(path=path):
                with self.assertRaises(extract.archive_contract.Block):
                    self.run_checked([(path, "file", b"nope")], expected_files=5)
                self.assertEqual(list(self.target.iterdir()), [])

    def test_hardlinks_rejected(self):
        with self.assertRaises(extract.archive_contract.Block):
            self.run_checked([("evil", "hardlink", "release-meta.json")])

    def test_duplicate_path_rejected(self):
        with self.assertRaisesRegex(extract.Block, "TAR_DUPLICATE_PATH"):
            self.run_checked([("package-lock.json", "file", b"other")], expected_files=5)

    def test_wrong_archive_review_receipt_rejected(self):
        tarball(self.archive)
        with patch.object(extract.archive_contract, "inspect",
                          return_value={"status":"BLOCK"}):
            with self.assertRaisesRegex(extract.Block,"ARCHIVE_NOT_REVIEWED"):
                extract.extract_into_empty(self.archive,self.target)

    def test_mismatched_member_count_fails(self):
        with self.assertRaisesRegex(extract.Block, "EXTRACTION_MEMBER_COUNTS"):
            self.run_checked(expected_files=7)

    def test_symlink_as_target_directory_rejected(self):
        other = self.root / "elsewhere"
        other.mkdir()
        self.target.rmdir()
        try:
            self.target.symlink_to(other, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("Host does not permit creating symlinks")
        with self.assertRaises(extract.Block):
            self.run_checked()


if __name__ == "__main__":
    unittest.main()
