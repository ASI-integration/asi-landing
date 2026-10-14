"""Task29B: physical distinct-UID denial on disposable GitHub-hosted Linux only.

The fixture briefly widens socket traversal permissions to exercise the real
kernel SO_PEERCRED comparison. This is intentionally unsafe for a real host:
never copy fixture permission changes into deployment procedures.
No owner authority, guest sending, cloud credentials, or host provisioning.
"""
from __future__ import annotations

import errno
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

SERVICE = Path(__file__).resolve().parents[1] / "custodian" / "asi_custodian.py"
spec = importlib.util.spec_from_file_location("asi_custodian_task29b", SERVICE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

RUN = "strig-cust-fedcba987654"
RID = "b" * 32

# Runs as an unrelated, unprivileged Linux user in a disposable CI runner.
# Test performs NO mutation outside its own temporary state root.
FOREIGN_CLIENT = r"""
import json, socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(4)
try:
    s.connect(sys.argv[1])
except PermissionError as exc:
    print(json.dumps({"status": "FILESYSTEM_DENIED", "errno": exc.errno}))
    sys.exit(0)
except OSError as exc:
    print(json.dumps({"status": "UNEXPECTED_CONNECT_ERROR", "errno": exc.errno}))
    sys.exit(2)
with s:
    payload = json.dumps({
        "kind": "ASI_CUSTODIAN_TECHNICAL_V0", "op": "append",
        "runId": "strig-cust-fedcba987654", "seq": 1,
        "requestId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "result": "OBSERVED"
    }, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    s.sendall(payload)
    s.shutdown(socket.SHUT_WR)
    output = bytearray()
    while True:
        chunk = s.recv(1024)
        if not chunk:
            break
        output.extend(chunk)
    response = json.loads(bytes(output))
    print(json.dumps(response, sort_keys=True))
"""


@unittest.skipUnless(sys.platform == "linux" and os.geteuid() != 0,
                     "requires unprivileged Linux GitHub runner")
class PhysicalPrincipalDenial(unittest.TestCase):
    def setUp(self):
        if shutil.which("sudo") is None:
            self.fail("sudo unavailable: native different-UID proof NOT_RUN")
        who = subprocess.run(["sudo", "-n", "-u", "nobody", "id", "-u"],
                             capture_output=True, text=True, timeout=5, check=True)
        self.other_uid = int(who.stdout.strip())
        self.assertNotEqual(self.other_uid, os.getuid(),
                            "distinct principal required for physical proof")
        self.parent = Path(tempfile.mkdtemp(prefix="asi-task29b-unprivileged-"))
        self.root = self.parent / "state"
        self.process = None
        self.addCleanup(self.cleanup)
        x = m.initialize(str(self.root), RUN, os.getuid(), os.getgid())
        self.assertEqual(x["status"], "INITIALIZED")
        self.process = subprocess.Popen(
            [sys.executable, "-u", str(SERVICE), "serve", "--state-dir", str(self.root)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        for _ in range(100):
            if (self.root / "custodian.sock").is_socket():
                break
            if self.process.poll() is not None:
                self.fail("custodian exited before socket was available")
            time.sleep(0.02)
        else:
            self.fail("custodian did not start")

    def cleanup(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.communicate(timeout=3)
        if hasattr(self, "root") and self.root.exists():
            self.root.chmod(0o700)
            sock = self.root / "custodian.sock"
            if sock.exists():
                sock.chmod(0o600)
        if hasattr(self, "parent") and self.parent.exists():
            self.parent.chmod(0o700)
            shutil.rmtree(self.parent)

    def foreign_attempt(self):
        proc = subprocess.run(
            ["sudo", "-n", "-u", "nobody", sys.executable, "-c",
             FOREIGN_CLIENT, str(self.root / "custodian.sock")],
            capture_output=True, text=True, timeout=8,
        )
        self.assertEqual(proc.returncode, 0,
                         "foreign test client failed: " + proc.stderr[:240])
        return json.loads(proc.stdout)

    def assert_zero_events(self):
        self.assertEqual((self.root / "events.ndjson").read_bytes(), b"",
                         "foreign principal must never append an event")

    def test_default_private_filesystem_denies_distinct_uid(self):
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.root / "custodian.sock").stat().st_mode & 0o777, 0o600)
        x = self.foreign_attempt()
        self.assertEqual(x["status"], "FILESYSTEM_DENIED")
        self.assertIn(x["errno"], (errno.EACCES, errno.EPERM))
        self.assert_zero_events()

    def test_kernel_rejects_distinct_uid_even_if_fixture_socket_is_exposed(self):
        # Deliberately damage *test-owned* permissions AFTER startup. This
        # exercises SO_PEERCRED rather than relying only on filesystem EACCES.
        self.parent.chmod(0o711)
        self.root.chmod(0o711)
        (self.root / "custodian.sock").chmod(0o666)
        x = self.foreign_attempt()
        self.assertEqual(x["status"], "HOLD")
        self.assertEqual(x["reason"], "KERNEL_PEER_DENIED")
        for key in ("authorized", "canInstall", "canApprove", "canIssueReceipt", "canSend"):
            self.assertIs(x[key], False)
        self.assertEqual(x["phase2"], "BLOCK")
        self.assert_zero_events()


if __name__ == "__main__":
    unittest.main(verbosity=2)
