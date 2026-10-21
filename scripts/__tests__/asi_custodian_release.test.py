"""Physical local release archive tests, no owner authority or installation."""
from hashlib import sha256
from io import BytesIO
import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / "custodian" / "build_release.py"
spec = importlib.util.spec_from_file_location("asi_build_release", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReleaseTests(unittest.TestCase):
    def test_real_python_service_is_packaged_and_manifested(self):
        body, manifest = m.make_bytes()
        self.assertGreater(len(body), 12000)
        self.assertLess(len(body), m.MAX_ARCHIVE)
        r = m.validate_bytes(body)
        self.assertEqual(r["status"], "EXACT_TECHNICAL_RELEASE_BYTES_ONLY")
        for key in ("authorized", "canInstall", "canSend", "canApprove", "canIssueReceipt"):
            self.assertFalse(r[key], key)
        self.assertFalse(manifest["ownerSigned"])
        self.assertFalse(manifest["ownerInstalled"])
        with tarfile.open(fileobj=BytesIO(body)) as tar:
            names = tar.getnames()
            self.assertIn("asi-custodian/asi_custodian.py", names)
            code = tar.extractfile("asi-custodian/asi_custodian.py").read()
            self.assertIn(b"def serve(", code)
            self.assertIn(b"SO_PEERCRED", code)
            self.assertIn(b"os.fsync(fd)", code)
            self.assertEqual(tar.getmember("asi-custodian/asi_custodian.py").mode, 0o755)

    def test_sparse_member_is_rejected_before_extractfile(self):
        body, _ = m.make_bytes()
        # Simulates tarfile reporting a GNU sparse logical file that expands
        # beyond the small archive: never read or expand its contents.
        with patch.object(tarfile.TarInfo, "issparse", return_value=True):
            with patch.object(tarfile.TarFile, "extractfile", side_effect=AssertionError("READ_FORBIDDEN")):
                with self.assertRaisesRegex(ValueError, "FILE_SIZE"):
                    m.validate_bytes(body)

    def test_oversized_logical_member_is_rejected_before_extractfile(self):
        body, _ = m.make_bytes()
        getmembers = tarfile.TarFile.getmembers

        def fake_members(archive):
            members = getmembers(archive)
            members[0].size = m.MAX_ARCHIVE + 1
            return members

        with patch.object(tarfile.TarFile, "getmembers", fake_members):
            with patch.object(tarfile.TarFile, "extractfile", side_effect=AssertionError("READ_FORBIDDEN")):
                with self.assertRaisesRegex(ValueError, "FILE_SIZE"):
                    m.validate_bytes(body)

    def test_build_twice_same_hash_and_bytes(self):
        a, _ = m.make_bytes()
        b, _ = m.make_bytes()
        self.assertEqual(a, b)
        self.assertEqual(sha256(a).hexdigest(), sha256(b).hexdigest())

    def test_manifest_only_describes_the_two_exact_source_files(self):
        _, manifest = m.make_bytes()
        self.assertEqual(set(manifest["files"]), {entry[0] for entry in m.FILES})
        self.assertFalse(manifest["ownerSigned"])
        self.assertFalse(manifest["canSend"])
        self.assertEqual(manifest["phase2"], "BLOCK")

    def test_single_byte_change_fails_closed(self):
        a, _ = m.make_bytes()
        modified = bytearray(a)
        modified[900] ^= 1
        with self.assertRaises(ValueError):
            m.validate_bytes(bytes(modified))

    def test_extra_trailing_content_is_rejected(self):
        a, _ = m.make_bytes()
        with self.assertRaises(ValueError):
            m.validate_bytes(a + b"unexpected")

    def test_fake_signed_manifest_is_rejected(self):
        a, _ = m.make_bytes()
        with tarfile.open(fileobj=BytesIO(a)) as src:
            old_manifest = json.loads(src.extractfile("asi-custodian/manifest.json").read())
            old_manifest["ownerSigned"] = True
            tampered = m.canonical(old_manifest)
            buffer = BytesIO()
            with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as out:
                for entry in src.getmembers():
                    data = tampered if entry.name.endswith("manifest.json") else src.extractfile(entry).read()
                    info = m.deterministic_info(entry.name, data, entry.mode)
                    out.addfile(info, BytesIO(data))
        with self.assertRaises(ValueError):
            m.validate_bytes(buffer.getvalue())

    def test_no_extra_installer_shell_or_network_in_release(self):
        archive, _ = m.make_bytes()
        with tarfile.open(fileobj=BytesIO(archive)) as tar:
            self.assertEqual(len(tar.getmembers()), 3)
            self.assertFalse(any(x.name.endswith(".sh") for x in tar.getmembers()))
        source = FILE.read_text()
        self.assertNotIn("subprocess.run(", source)
        self.assertNotIn("https://", source)

    def test_archive_creation_refuses_overwriting_existing_user_file(self):
        import subprocess
        import sys
        with tempfile.TemporaryDirectory(prefix="asi-custodian-package-it-") as tmp:
            out = Path(tmp) / m.PACKAGE
            cmd = [sys.executable, str(FILE), "--out", str(out)]
            a = subprocess.run(cmd, capture_output=True, timeout=10)
            self.assertEqual(a.returncode, 0, a.stderr.decode()[:250])
            result = json.loads(a.stdout)
            self.assertEqual(result["status"], "EXACT_TECHNICAL_RELEASE_BYTES_ONLY")
            b = subprocess.run(cmd, capture_output=True, timeout=10)
            self.assertNotEqual(b.returncode, 0)
            self.assertTrue(out.exists())
            c = subprocess.run(cmd + ["--verify"], capture_output=True, timeout=10)
            self.assertEqual(c.returncode, 0, c.stderr.decode()[:250])


if __name__ == "__main__":
    unittest.main(verbosity=2)
