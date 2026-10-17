"""Synthetic fail-closed archive contract tests, no deployment side effects."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

import g0_release_archive as v


def add_file(tar, name, raw):
    item=tarfile.TarInfo(name)
    item.mode=0o644
    item.size=len(raw)
    tar.addfile(item,io.BytesIO(raw))


def fixture(path, *, extra=None, omit=(), tamper_meta=False, tamper_lock=False):
    lock=b'{"lockfileVersion":3}\n'
    meta=dict(gitSha=v.SHA,sourceTreeSha=v.TREE,
              g0SourceSha=v.SOURCE_G0,environment="staging",
              appVersion="0.1.0")
    if tamper_meta:
        meta["gitSha"]="a"*40
    files={
        "release-meta.json":json.dumps(meta).encode(),
        ".next/BUILD_ID":b"synthetic-only-build-id",
        "node_modules/next/dist/bin/next":b"#!/usr/bin/env node\n",
        "package.json":b'{"name":"synthetic"}\n',
        "package-lock.json":b"tampered lock" if tamper_lock else lock,
    }
    with tarfile.open(path,"w:gz") as tar:
        for name,raw in files.items():
            if name not in omit:
                add_file(tar,name,raw)
        for item in extra or ():
            tar.addfile(item)
    data=Path(path).read_bytes()
    return hashlib.sha256(data).hexdigest(),len(data),hashlib.sha256(lock).hexdigest()


class SourceOnlyArchiveTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path=Path(temp.name)/"synthetic.tar.gz"

    def check(self, **kwargs):
        sha,size,lock=fixture(self.path,**kwargs)
        return v.inspect(self.path,expected_sha=sha,expected_size=size,
                         expected_lock=lock)

    def test_minimal_reviewed_shape_pass(self):
        result=self.check()
        self.assertEqual(result["status"],"G0_TAR_CONTRACT_PASS")
        self.assertEqual(result["files"],5)
        self.assertFalse(result["extractionPerformed"])
        self.assertFalse(result["activationPerformed"])

    def test_unknown_or_traversal_entry_blocks(self):
        for path in ("/etc/passwd","../escape", "node_modules/../../escape", "./dot"):
            with self.subTest(path=path):
                item=tarfile.TarInfo(path)
                item.size=0
                item.mode=0o644
                with self.assertRaises(v.Block):
                    self.check(extra=[item])

    def test_absolute_symlink_blocks(self):
        item=tarfile.TarInfo("link")
        item.type=tarfile.SYMTYPE
        item.linkname="/etc/shadow"
        with self.assertRaisesRegex(v.Block,"TAR_SYMLINK_IDENTITY"):
            self.check(extra=[item])

    def test_parent_symlink_escape_blocks(self):
        item=tarfile.TarInfo("node_modules/link")
        item.type=tarfile.SYMTYPE
        item.linkname="../../etc/shadow"
        with self.assertRaisesRegex(v.Block,"TAR_SYMLINK_ESCAPE"):
            self.check(extra=[item])

    def test_regular_relative_symlink_allowed(self):
        item=tarfile.TarInfo("node_modules/sibling")
        item.type=tarfile.SYMTYPE
        item.linkname="next"
        result=self.check(extra=[item])
        self.assertEqual(result["symlinks"],1)

    def test_hardlink_denied(self):
        item=tarfile.TarInfo("hardlink")
        item.type=tarfile.LNKTYPE
        item.linkname="package.json"
        with self.assertRaisesRegex(v.Block,"TAR_UNSUPPORTED_TYPE"):
            self.check(extra=[item])

    def test_duplicate_member_denied(self):
        item=tarfile.TarInfo("package.json")
        item.size=0
        with self.assertRaisesRegex(v.Block,"TAR_DUPLICATE_PATH"):
            self.check(extra=[item])

    def test_wrong_meta_and_source_lock_denied(self):
        with self.assertRaisesRegex(v.Block,"RELEASE_METADATA_IDENTITY"):
            self.check(tamper_meta=True)
        with self.assertRaisesRegex(v.Block,"SOURCE_LOCK_DIGEST"):
            self.check(tamper_lock=True)

    def test_missing_required_file_denied(self):
        with self.assertRaisesRegex(v.Block,"RELEASE_REQUIRED_FILES"):
            self.check(omit={"node_modules/next/dist/bin/next"})

    def test_compressed_archive_digest_denied(self):
        self.check()
        with self.assertRaisesRegex(v.Block,"ARCHIVE_DIGEST"):
            v.inspect(self.path,expected_sha="0"*64,
                      expected_size=self.path.stat().st_size,
                      expected_lock=hashlib.sha256(b'{"lockfileVersion":3}\n').hexdigest())


if __name__=="__main__":
    unittest.main()
