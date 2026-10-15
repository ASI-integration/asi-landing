"""Isolated nonroot Linux tests. Synthetic key is never owner authority."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "custodian"))
import protected_prepare as p
import build_release as release

class Acceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="asi-task32-")
        self.root = Path(self.temp.name)
        self.key = self.root / "issuer"
        self.pub = self.root / "issuer.pub"
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(self.key)], check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(self.key), "-pubout", "-out", str(self.pub)], check=True, capture_output=True)
        self.data, _ = release.make_bytes()
        self.digest = hashlib.sha256(self.data).hexdigest()
        self.archive = self.root / "release.tar"
        self.archive.write_bytes(self.data)
        self.binding = {"host": "ephemeral-ci-only", "archiveSha256": self.digest}
        self.state = self.root / "state"
        self.state.mkdir(mode=0o700)
        self.client = os.getuid() + 1
        self.receipt = dict(scope=p.SCOPE, **self.binding, clientUid=self.client,
                            nonce="a"*64, expires=int(time.time())+50, epoch=1,
                            action="observe_synthetic", liveAuthority=False)
        self.manifest = dict(scope=p.SCOPE, source=p.SOURCE, **self.binding,
                             serviceUid=os.getuid(), clientUid=self.client,
                             ownerUid=self.client+1, expires=int(time.time())+600, liveAuthority=False)

    def tearDown(self):
        self.temp.cleanup()

    def sign(self, value):
        data = p.canonical(value)
        payload = self.root / "payload"
        sig = self.root / "sig"
        payload.write_bytes(data)
        subprocess.run(["openssl", "pkeyutl", "-sign", "-inkey", str(self.key), "-rawin",
                        "-in", str(payload), "-out", str(sig)], check=True, capture_output=True)
        return data, sig.read_bytes()

    def gate(self, enabled=True):
        return p.SyntheticGate(self.state, self.pub, self.binding, enabled)

    def consume(self, value=None, **kw):
        data, sig = self.sign(self.receipt if value is None else value)
        return self.gate().consume(data, sig, self.client, 1, **kw)

    def install(self):
        raw, sig = self.sign(self.manifest)
        (self.root/"manifest").write_bytes(raw)
        (self.root/"manifest.sig").write_bytes(sig)
        return p.prepare(self.archive, self.root/"manifest", self.root/"manifest.sig",
                         self.pub, self.root/"installed", self.binding["host"], True)

    def test_01_reproducible_exact_archive(self):
        self.assertEqual(self.data, release.make_bytes()[0])
        self.assertEqual(release.validate_bytes(self.data)["sha256"], self.digest)

    def test_02_archive_tamper(self):
        with self.assertRaises(Exception):
            release.validate_bytes(self.data[:800]+b"x"+self.data[801:])

    def test_03_prepare_and_permissions(self):
        self.assertEqual(self.install()["status"], "SANDBOX_PREPARED")
        self.assertEqual((self.root/"installed"/"approval.json").stat().st_mode & 0o777, 0o400)

    def test_04_repeat_refused(self):
        self.install()
        with self.assertRaises(p.Denied):
            self.install()

    def test_05_manifest_wrong_host(self):
        self.manifest["host"] = "other"
        with self.assertRaises(p.Denied):
            self.install()
        self.assertFalse((self.root/"installed").exists())

    def test_06_manifest_distinct_uid(self):
        self.manifest["clientUid"] = os.getuid()
        with self.assertRaises(p.Denied):
            self.install()

    def test_07_manifest_expired(self):
        self.manifest["expires"] = 1
        with self.assertRaises(p.Denied):
            self.install()

    def test_08_default_off(self):
        data,sig=self.sign(self.receipt)
        with self.assertRaises(p.Denied):
            self.gate(False).consume(data,sig,self.client,1)

    def test_09_observe_no_authority(self):
        self.assertEqual(self.consume(), {"status":"SYNTHETIC_OBSERVED","authorized":False,"canSend":False})

    def test_10_replay_restart_refused(self):
        self.consume()
        with self.assertRaises(p.Denied):
            self.consume()

    def test_11_expired(self):
        self.receipt["expires"] = 1
        with self.assertRaises(p.Denied):
            self.consume()

    def test_12_revocation_nonce(self):
        with self.assertRaises(p.Denied):
            self.consume(revoked=["a"*64])

    def test_13_revocation_epoch(self):
        self.receipt["epoch"] = 0
        with self.assertRaises(p.Denied):
            self.consume()

    def test_14_wrong_client(self):
        self.receipt["clientUid"] += 1
        with self.assertRaises(p.Denied):
            self.consume()

    def test_15_wrong_scope(self):
        self.receipt["scope"] = "production"
        with self.assertRaises(p.Denied):
            self.consume()

    def test_16_wrong_digest(self):
        self.receipt["archiveSha256"] = "b"*64
        with self.assertRaises(p.Denied):
            self.consume()

    def test_17_live_action_denied(self):
        self.receipt["action"] = "send"
        with self.assertRaises(p.Denied):
            self.consume()

    def test_18_signature_tamper(self):
        data,sig=self.sign(self.receipt)
        with self.assertRaises(p.Denied):
            self.gate().consume(data,sig[:-1]+bytes([sig[-1]^1]),self.client,1)

    def test_19_concurrency_one(self):
        data,sig=self.sign(self.receipt)
        def attempt(_):
            try:
                return self.gate().consume(data,sig,self.client,1)["status"]
            except p.Denied:
                return "DENIED"
        with ThreadPoolExecutor(max_workers=4) as pool:
            result=list(pool.map(attempt,range(4)))
        self.assertEqual(result.count("SYNTHETIC_OBSERVED"),1)

    def test_20_intent_crash_restart_hold(self):
        with self.assertRaises(p.Denied):
            self.consume(fault="after-intent")
        self.receipt["nonce"]="b"*64
        with self.assertRaises(p.Denied):
            self.consume()

    def test_21_commit_crash_restart_hold(self):
        with self.assertRaises(p.Denied):
            self.consume(fault="after-journal")
        self.receipt["nonce"]="b"*64
        with self.assertRaises(p.Denied):
            self.consume()

    def test_22_corrupt_journal(self):
        self.consume()
        with (self.state/"journal").open("ab") as out:
            out.write(b"torn")
        self.receipt["nonce"]="b"*64
        with self.assertRaises(p.Denied):
            self.consume()

    def test_23_state_symlink_denied(self):
        alias=self.root/"alias"
        alias.symlink_to(self.state)
        with self.assertRaises(p.Denied):
            p.SyntheticGate(alias,self.pub,self.binding,True)

    def test_24_unsafe_permissions_denied(self):
        self.state.chmod(0o755)
        with self.assertRaises(p.Denied):
            self.gate()

    def test_25_hash_tamper(self):
        self.consume()
        path=self.state/"journal"
        event=json.loads(path.read_text())
        event["nonce"]="c"*64
        path.write_bytes(p.canonical(event)+b"\n")
        self.receipt["nonce"]="b"*64
        with self.assertRaises(p.Denied):
            self.consume()

if __name__ == "__main__":
    if sys.platform != "linux" or os.getuid() == 0:
        raise SystemExit("Requires isolated NONROOT Linux; no host user changes")
    unittest.main(verbosity=2)
