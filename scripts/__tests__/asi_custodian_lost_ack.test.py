"""Task29D: real lost-acknowledgement and restart acceptance for technical Custodian.

Unprivileged Linux, disposable filesystem and AF_UNIX only. No real operator
authority, PostgreSQL, production access, provider operations or guest sends.
"""
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

SOURCE = Path(__file__).resolve().parents[1] / "custodian" / "asi_custodian.py"
spec = importlib.util.spec_from_file_location("asi_task29d", SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
RUN = "strig-cust-998877665544"
IDS = ("a" * 32, "b" * 32, "c" * 32)

def packet(op, seq, request_id, result):
    return m.canonical({"kind": m.PROTOCOL, "op": op, "runId": RUN,
                        "seq": seq, "requestId": request_id,
                        "result": result}) + b"\n"


@unittest.skipUnless(sys.platform == "linux" and os.getuid() != 0,
                     "requires an unprivileged Linux runner")
class LostAcknowledgement(unittest.TestCase):
    def setUp(self):
        self.parent = Path(tempfile.mkdtemp(prefix="asi-task29d-lost-ack-"))
        self.root = self.parent / "state"
        self.proc = None
        self.addCleanup(self.cleanup)
        self.assertEqual(m.initialize(str(self.root), RUN, os.getuid(),
                                      os.getgid())["status"], "INITIALIZED")
        self.start()

    def start(self):
        self.proc = subprocess.Popen(
            [sys.executable, "-u", str(SOURCE), "serve",
             "--state-dir", str(self.root)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(100):
            if (self.root / "custodian.sock").is_socket():
                return
            if self.proc.poll() is not None:
                self.fail("Custodian exited before socket startup")
            time.sleep(0.02)
        self.fail("Custodian startup timed out")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.communicate(timeout=3)
                self.fail("Custodian did not terminate")
        if self.proc is not None:
            self.assertEqual(self.proc.returncode, 0)
        self.proc = None

    def cleanup(self):
        self.stop()
        shutil.rmtree(self.parent, ignore_errors=True)

    def lost_ack(self, result="OBSERVED"):
        # A genuine OS socket transport loses the server's eventual reply.
        # No response bytes are received or interpreted by this client.
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(3)
            client.connect(str(self.root / "custodian.sock"))
            client.sendall(packet("append", 1, IDS[0], result))
            client.shutdown(socket.SHUT_WR)
        for _ in range(150):
            if (self.root / "events.ndjson").stat().st_size > 0:
                break
            if self.proc.poll() is not None:
                self.fail("Custodian exited unexpectedly")
            time.sleep(0.02)
        else:
            self.fail("No durable journal write after lost response")
        lines = (self.root / "events.ndjson").read_bytes().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["requestId"], IDS[0])

    def call(self, op, seq, rid, result="NONE"):
        # Actual independently opened Unix-domain socket; no mock server.
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(4)
            client.connect(str(self.root / "custodian.sock"))
            client.sendall(packet(op, seq, rid, result))
            client.shutdown(socket.SHUT_WR)
            data = bytearray()
            while True:
                segment = client.recv(1024)
                if not segment:
                    break
                data.extend(segment)
        return m.strict_json_loads(bytes(data))

    def blocked_authority(self, result):
        for key in ("authorized", "canInstall", "canApprove",
                    "canIssueReceipt", "canSend"):
            self.assertIs(result[key], False, key)
        self.assertEqual(result["phase2"], "BLOCK")

    def test_lost_success_ack_is_durable_and_replay_is_denied_after_restart(self):
        self.lost_ack("OBSERVED")
        self.stop()
        self.start()
        before = self.call("status", 0, IDS[1])
        self.assertEqual((before["seq"], before["state"]), (1, "OPEN"))
        self.blocked_authority(before)
        retry = self.call("append", 1, IDS[0], "OBSERVED")
        self.assertEqual((retry["status"], retry["reason"]), ("HOLD", "REPLAY_OR_GAP"))
        self.blocked_authority(retry)
        self.assertEqual(len((self.root / "events.ndjson").read_bytes().splitlines()), 1)
        # An explicitly fresh, non-authorizing technical observation may follow.
        next_result = self.call("append", 2, IDS[1], "OBSERVED")
        self.assertEqual(next_result["status"], "TECHNICAL_RECORDED")
        self.blocked_authority(next_result)
        self.assertEqual(self.call("status", 0, IDS[2])["seq"], 2)

    def test_lost_unknown_ack_stays_hold_after_restart_without_auto_retry(self):
        self.lost_ack("UNKNOWN")
        self.stop()
        self.start()
        state = self.call("status", 0, IDS[1])
        self.assertEqual((state["seq"], state["state"]), (1, "HOLD"))
        self.blocked_authority(state)
        for seq, rid in ((1, IDS[0]), (2, IDS[1])):
            result = self.call("append", seq, rid, "OBSERVED")
            self.assertEqual(result["status"], "HOLD")
            self.blocked_authority(result)
        self.assertEqual(len((self.root / "events.ndjson").read_bytes().splitlines()), 1)
        self.stop()
        self.assertEqual(m.inspect_journal(self.root, m.read_config(self.root))[3],
                         "HOLD")


if __name__ == "__main__":
    unittest.main(verbosity=2)
