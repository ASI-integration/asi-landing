"""Task27 release verifier: focused physical OS temp and malicious archive tests."""
import importlib.util
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import stat
import tarfile
import tempfile
import unittest

F = Path(__file__).resolve().parents[1] / "acceptance" / "strigunov-task27-release.py"
spec = importlib.util.spec_from_file_location("strigunov_task27_release", F)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.root = m.own_fixture_dir()
        self.addCleanup(lambda: shutil.rmtree(self.root, ignore_errors=True))

    def pack(self):
        result = m.build_fixture(self.root)
        self.assertEqual(result["status"], "BUNDLE_BUILT_FOR_REVIEW_ONLY", result)
        return result["sha256"]

    def file(self):
        return self.root / m.FILE_NAME

    def replace(self, content: bytes):
        self.file().write_bytes(content)
        return sha256(content).hexdigest()

    def check(self, digest=None):
        return m.inspect_bundle(self.root, digest or sha256(self.file().read_bytes()).hexdigest())

    def deny(self, r):
        self.assertEqual(r["status"], "HOLD", r)
        self.assertFalse(r["authorized"])
        self.assertFalse(r["canInstall"])
        self.assertFalse(r["canSend"])
        self.assertFalse(r["canIssueReceipt"])
        self.assertEqual(r["phase2"], "BLOCK")

    def rewrite_archive(self, mutator):
        original = [m.manifest_bytes(), m.STUB, m.CONF]
        buffer = BytesIO()
        with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as out:
            for n, payload in zip(m.MEMBERS, original, strict=True):
                info = m.tar_item(n, payload)
                name, payload, info = mutator(n, payload, info)
                info.name = name
                info.size = len(payload)
                out.addfile(info, BytesIO(payload))
        return self.replace(buffer.getvalue())

    def test_default_bundle_verifies_exact_bytes_but_not_trust(self):
        digest = self.pack()
        result = self.check(digest)
        self.assertEqual(result["status"], "EXACT_BUNDLE_BYTES_MATCHED_ONLY")
        self.assertEqual(result["sha256"], digest)
        self.assertEqual(result["files"], 3)
        self.assertFalse(result["authorized"])
        self.assertFalse(result["canInstall"])
        self.assertFalse(result["canSend"])

    def test_identical_bundles_are_byte_reproducible(self):
        digest = self.pack()
        second = m.own_fixture_dir()
        try:
            other = m.build_fixture(second)
            self.assertEqual(other["sha256"], digest)
            self.assertEqual(self.file().read_bytes(), (second / m.FILE_NAME).read_bytes())
        finally:
            shutil.rmtree(second)

    def test_private_directory_and_archive_modes(self):
        self.pack()
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(self.file().stat().st_mode), 0o600)

    def test_manifest_live_permits_explicit_false_only(self):
        doc = json.loads(m.manifest_bytes())
        self.assertIs(doc["hostInstalled"], False)
        self.assertIs(doc["ownerApprovalPresent"], False)
        self.assertIs(doc["cloudServerAttached"], False)
        self.assertIs(doc["canInstall"], False)
        self.assertIs(doc["canSend"], False)
        self.assertEqual(doc["phase2"], "BLOCK")

    def test_rebuild_cannot_overwrite_existing_release(self):
        self.pack()
        self.deny(m.build_fixture(self.root))
        self.assertEqual(self.check()["status"], "EXACT_BUNDLE_BYTES_MATCHED_ONLY")

    def test_preexisting_user_file_blocks_build(self):
        (self.root / "unrelated.txt").write_text("do not touch")
        self.deny(m.build_fixture(self.root))
        self.assertEqual((self.root / "unrelated.txt").read_text(), "do not touch")

    def test_missing_file_is_denied(self):
        self.deny(m.inspect_bundle(self.root, "a" * 64))

    def test_fake_expected_hash_is_denied(self):
        self.pack()
        self.deny(self.check("f" * 64))

    def test_missing_or_non_string_expected_digest_is_denied(self):
        self.pack()
        for digest in (None, "", [], 4, True, "A" * 64, "bad"):
            self.deny(m.inspect_bundle(self.root, digest))

    def test_one_changed_byte_is_detected(self):
        self.pack()
        old = self.file().read_bytes()
        self.replace(old[:100] + bytes([old[100] ^ 1]) + old[101:])
        self.deny(m.inspect_bundle(self.root, sha256(old).hexdigest()))

    def test_rehashed_fake_program_is_rejected(self):
        self.pack()
        digest = self.rewrite_archive(
            lambda name, body, info: (name, b"modified\n" if name == m.MEMBERS[1] else body, info)
        )
        self.deny(self.check(digest))

    def test_rehashed_fake_manifest_with_send_flag_is_rejected(self):
        self.pack()
        fake = json.loads(m.manifest_bytes())
        fake["canSend"] = True
        new = (json.dumps(fake, sort_keys=True, separators=(",", ":")) + "\n").encode()
        digest = self.rewrite_archive(
            lambda name, body, info: (name, new if name == "manifest.json" else body, info)
        )
        self.deny(self.check(digest))

    def test_rehashed_fake_config_is_rejected(self):
        self.pack()
        digest = self.rewrite_archive(
            lambda name, body, info: (name, body.replace(b'false', b'true') if name.endswith(".json") and name.startswith("config/") else body, info)
        )
        self.deny(self.check(digest))

    def test_archive_member_traversal_path_is_rejected(self):
        self.pack()
        digest = self.rewrite_archive(
            lambda name, body, info: ("../outside.txt" if name == m.MEMBERS[1] else name, body, info)
        )
        self.deny(self.check(digest))
        self.assertFalse((self.root.parent / "outside.txt").exists())

    def test_archive_absolute_member_path_is_rejected(self):
        self.pack()
        digest = self.rewrite_archive(
            lambda name, body, info: ("/etc/passwd" if name == m.MEMBERS[1] else name, body, info)
        )
        self.deny(self.check(digest))

    def test_archive_unknown_extra_member_is_rejected(self):
        self.pack()
        buffer = BytesIO()
        with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as tar:
            for name, body in zip(m.MEMBERS, (m.manifest_bytes(), m.STUB, m.CONF), strict=True):
                tar.addfile(m.tar_item(name, body), BytesIO(body))
            extra = b"shell"
            tar.addfile(m.tar_item("bin/extra.sh", extra), BytesIO(extra))
        self.deny(self.check(self.replace(buffer.getvalue())))

    def test_duplicate_archive_entry_is_rejected(self):
        self.pack()
        buffer = BytesIO()
        with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as tar:
            for name, body in zip(m.MEMBERS, (m.manifest_bytes(), m.STUB, m.CONF), strict=True):
                tar.addfile(m.tar_item(name, body), BytesIO(body))
            tar.addfile(m.tar_item(m.MEMBERS[1], m.STUB), BytesIO(m.STUB))
        self.deny(self.check(self.replace(buffer.getvalue())))

    def test_archive_uid_or_mode_or_mtime_change_rejected(self):
        for edit in (
            lambda info: setattr(info, "uid", 1),
            lambda info: setattr(info, "mode", 0o755),
            lambda info: setattr(info, "mtime", 100),
        ):
            with self.subTest(edit=edit):
                if self.file().exists():
                    self.file().unlink()
                self.pack()
                digest = self.rewrite_archive(lambda n, b, i: (n, b, (edit(i) or i) if n == m.MEMBERS[1] else i))
                self.deny(self.check(digest))

    def test_archive_symlink_entry_is_rejected(self):
        self.pack()
        def evil(n, b, info):
            if n == m.MEMBERS[1]:
                info.type = tarfile.SYMTYPE
                info.linkname = "/tmp/other"
                return n, b"", info
            return n, b, info
        self.deny(self.check(self.rewrite_archive(evil)))

    def test_truncated_and_nontar_bytes_are_rejected(self):
        self.pack()
        original = self.file().read_bytes()
        self.deny(self.check(self.replace(original[:700])))
        self.deny(self.check(self.replace(b"not-a-tar-archive")))

    def test_noncanonical_appended_trailing_data_is_rejected(self):
        self.pack()
        body = self.file().read_bytes()
        self.deny(self.check(self.replace(body + b"extra")))

    def test_archive_over_size_limit_is_denied(self):
        self.pack()
        with self.file().open("ab") as handle:
            handle.write(b"x" * 17000)
        self.deny(self.check())

    @unittest.skipIf(os.name != "posix", "POSIX permission test")
    def test_overly_open_directory_permissions_are_denied(self):
        self.pack()
        os.chmod(self.root, 0o777)
        try:
            self.deny(self.check())
        finally:
            os.chmod(self.root, 0o700)

    @unittest.skipIf(os.name != "posix", "POSIX permission test")
    def test_overly_open_archive_permissions_are_denied(self):
        self.pack()
        os.chmod(self.file(), 0o644)
        try:
            self.deny(self.check())
        finally:
            os.chmod(self.file(), 0o600)

    @unittest.skipIf(os.name != "posix", "POSIX symlink test")
    def test_archive_symlink_is_refused_without_reading_target(self):
        self.pack()
        self.file().rename(self.root / "saved.tar")
        self.file().symlink_to(self.root / "saved.tar")
        self.deny(self.check("f" * 64))

    def test_foreign_or_unexpected_path_refused(self):
        self.pack()
        for path in (Path(tempfile.gettempdir()), Path("/"), self.root / "subdir", self.root.parent):
            self.deny(m.build_fixture(path))
            self.deny(m.inspect_bundle(path, "a" * 64))

    def test_never_extracts_or_executes_bundle(self):
        text = F.read_text()
        for danger in ("extractall(", "extract(", "subprocess.", "os.system(", "Popen(", "https://", "sendGuest"):
            self.assertNotIn(danger, text)

    def test_run_specific_state_is_synthetic_only(self):
        self.assertEqual(m.SOURCE_BASE, "9bc8175aa772e92366c7a2363e26900a042fc3ce")
        self.assertEqual(m.STUB, b"ASI-TASK27-SYNTHETIC-NONEXECUTABLE-STUB\n")
        self.assertIn(b'"phase2":"BLOCK"', m.manifest_bytes())


if __name__ == "__main__":
    unittest.main(verbosity=2)
