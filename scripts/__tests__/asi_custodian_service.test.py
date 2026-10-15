"""Real executable service integration, not operator-authorization acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SERVICE = Path(__file__).resolve().parents[1] / "custodian" / "asi_custodian.py"
spec = importlib.util.spec_from_file_location("asi_real_custodian", SERVICE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
RUN = "strig-cust-123456789abc"
ONE = "a" * 32
TWO = "b" * 32
THREE = "c" * 32


def make(op, seq, rid, result="NONE", **alter):
    d = {"kind": m.PROTOCOL, "op": op, "runId": RUN, "seq": seq,
         "requestId": rid, "result": result}
    d.update(alter)
    return m.canonical(d) + b"\n"


@unittest.skipUnless(sys.platform == "linux" and os.getuid() != 0, "nonroot Linux-only")
class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.parent = Path(tempfile.mkdtemp(prefix="asi-custodian-it-"))
        self.root = self.parent / "state"
        self.addCleanup(lambda: shutil.rmtree(self.parent, ignore_errors=True))
        value = m.initialize(str(self.root), RUN, os.getuid(), os.getgid())
        self.assertEqual(value["status"], "INITIALIZED")
        self.process = None
        self.start()
        self.addCleanup(self.stop)

    def start(self):
        self.process = subprocess.Popen(
            [sys.executable, "-u", str(SERVICE), "serve", "--state-dir", str(self.root)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        for _ in range(100):
            if (self.root / "custodian.sock").is_socket():
                return
            if self.process.poll() is not None:
                stdout, stderr = self.process.communicate(timeout=2)
                self.fail("server exited before IPC ready: " + stderr.decode()[:150])
            time.sleep(0.02)
        self.fail("server never exposed private socket")

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.communicate(timeout=4)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.communicate(timeout=3)
                self.fail("server did not stop promptly")
        if self.process:
            self.assertEqual(self.process.returncode, 0)

    def raw(self, data):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(4)
            s.connect(str(self.root / "custodian.sock"))
            s.sendall(data)
            s.shutdown(socket.SHUT_WR)
            body = b""
            while True:
                part = s.recv(1024)
                if not part:
                    break
                body += part
        return json.loads(body)

    def blocked(self, x):
        self.assertFalse(x["canSend"])
        self.assertFalse(x["authorized"])
        self.assertFalse(x["canApprove"])
        self.assertFalse(x["canIssueReceipt"])
        self.assertEqual(x["phase2"], "BLOCK")

    def test_at_capacity_append_is_refused_without_poisoning_restart(self):
        self.assertEqual(
            self.raw(make("append", 1, ONE, "OBSERVED"))["status"],
            "TECHNICAL_RECORDED",
        )
        before = (self.root / "events.ndjson").read_bytes()
        config = m.read_config(self.root)
        next_request = m.parse_request(make("append", 2, TWO, "OBSERVED"), config)
        # Use a tiny limit to exercise the *real* persisted journal at its
        # exact boundary without making CI perform 1000 slow IPC round trips.
        with patch.object(m, "MAX_EVENTS", 1):
            result = m.apply(self.root, config, next_request)
        self.assertEqual(result["status"], "HOLD")
        self.assertEqual(result["reason"], "JOURNAL_FULL")
        self.assertEqual(result["seq"], 1)
        self.assertEqual((self.root / "events.ndjson").read_bytes(), before)
        self.stop()
        self.start()
        state = self.raw(make("status", 0, THREE))
        self.assertEqual(state["status"], "TECHNICAL_READBACK")
        self.assertEqual(state["seq"], 1)
        self.assertEqual(state["state"], "OPEN")

    def test_actual_process_and_socket_mode(self):
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.root / "custodian.sock").stat().st_mode), 0o600)
        self.assertIsNone(self.process.poll())

    def test_status_is_read_only_and_does_not_grant(self):
        x = self.raw(make("status", 0, ONE))
        self.assertEqual(x["status"], "TECHNICAL_READBACK")
        self.assertEqual(x["seq"], 0)
        self.assertEqual(x["state"], "OPEN")
        self.blocked(x)

    def test_real_append_then_readback_then_duplicate_denied(self):
        a = self.raw(make("append", 1, ONE, "OBSERVED"))
        self.assertEqual(a["status"], "TECHNICAL_RECORDED")
        self.blocked(a)
        b = self.raw(make("status", 0, TWO))
        self.assertEqual(b["seq"], 1)
        self.assertEqual(b["state"], "OPEN")
        self.assertEqual(self.raw(make("append", 1, ONE, "OBSERVED"))["status"], "HOLD")
        self.assertEqual(self.raw(make("status", 0, THREE))["seq"], 1)

    def test_restart_is_real_and_retains_journal(self):
        self.raw(make("append", 1, ONE, "OBSERVED"))
        self.stop()
        self.start()
        a = self.raw(make("status", 0, TWO))
        self.assertEqual(a["seq"], 1)
        self.assertEqual(a["state"], "OPEN")
        self.assertEqual(self.raw(make("append", 1, ONE, "OBSERVED"))["status"], "HOLD")
        self.assertEqual(self.raw(make("append", 2, TWO, "OBSERVED"))["status"], "TECHNICAL_RECORDED")
        self.assertEqual(self.raw(make("status", 0, THREE))["seq"], 2)

    def test_uncertain_commit_persists_hold_across_restart(self):
        first = self.raw(make("append", 1, ONE, "UNKNOWN"))
        self.assertEqual(first["status"], "HOLD")
        self.stop()
        self.start()
        status = self.raw(make("status", 0, TWO))
        self.assertEqual(status["seq"], 1)
        self.assertEqual(status["state"], "HOLD")
        self.assertEqual(self.raw(make("append", 2, TWO, "OBSERVED"))["status"], "HOLD")

    def test_kernel_peer_mismatch_denies_every_command(self):
        self.stop()
        conf = self.root / "config.json"
        c = json.loads(conf.read_text())
        c["peerUid"] = os.getuid() + 10000
        conf.write_bytes(m.canonical(c) + b"\n")
        self.start()
        self.assertEqual(self.raw(make("status", 0, ONE))["reason"], "KERNEL_PEER_DENIED")
        self.assertEqual(self.raw(make("append", 1, ONE, "OBSERVED"))["reason"], "KERNEL_PEER_DENIED")
        self.stop()
        self.assertEqual(m.inspect_journal(self.root, m.read_config(self.root))[0], 0)

    def test_identity_forgery_or_malformed_frame_is_denied(self):
        for data in (
            make("append", 1, ONE, "OBSERVED", ownerApproved=True),
            make("append", 1, ONE, "OBSERVED", canSend=True),
            make("exec-shell", 1, ONE),
            make("issue-receipt", 1, ONE),
            make("append", 1, ONE, "OBSERVED") + make("append", 1, ONE, "OBSERVED"),
            make("append", 1, ONE, "OBSERVED") + b"tail",
            b"not-json\n",
            b"[]" + b"\n",
            b"x" * 2400,
            b"",
        ):
            with self.subTest(sample=repr(data[:35])):
                x = self.raw(data)
                self.assertEqual(x["status"], "HOLD")
                self.blocked(x)
        self.assertEqual(self.raw(make("status", 0, TWO))["seq"], 0)

    def test_invalid_sequence_types_rejected(self):
        for seq in (True, "1", [1], None, 0, 3):
            x = self.raw(make("append", seq, ONE, "OBSERVED"))
            self.assertEqual(x["status"], "HOLD")
        self.assertEqual(self.raw(make("status", 0, TWO))["seq"], 0)

    def test_corrupted_journal_stops_server_from_starting(self):
        self.stop()
        with (self.root / "events.ndjson").open("ab") as f:
            f.write(b'{"broken":')
        proc = subprocess.run(
            [sys.executable, str(SERVICE), "serve", "--state-dir", str(self.root)],
            timeout=4, capture_output=True
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertNotIn(b"secret", proc.stdout.lower())
        self.assertFalse((self.root / "custodian.sock").exists())

    def test_client_cli_real_subprocess_returns_non_authorizing(self):
        p = subprocess.run(
            [sys.executable, str(SERVICE), "client", "--state-dir", str(self.root),
             "--op", "status", "--seq", "0", "--id", ONE, "--result", "NONE"],
            timeout=4, capture_output=True, check=True
        )
        result = json.loads(p.stdout)
        self.assertEqual(result["status"], "TECHNICAL_READBACK")
        self.blocked(result)

    def test_delayed_incomplete_request_does_not_append(self):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(4)
            s.connect(str(self.root / "custodian.sock"))
            s.sendall(make("append", 1, ONE, "OBSERVED")[:19])
            time.sleep(0.4)
            s.shutdown(socket.SHUT_WR)
            out = b""
            while True:
                fragment = s.recv(1024)
                if not fragment:
                    break
                out += fragment
            self.assertEqual(json.loads(out)["status"], "HOLD")
        self.assertEqual(self.raw(make("status", 0, TWO))["seq"], 0)

    def test_unauthorized_config_modification_triggers_stop(self):
        self.stop()
        c = json.loads((self.root / "config.json").read_text())
        c["operatorAuthority"] = True
        (self.root / "config.json").write_bytes(m.canonical(c) + b"\n")
        proc = subprocess.run([sys.executable, str(SERVICE), "serve",
                               "--state-dir", str(self.root)], capture_output=True, timeout=4)
        self.assertNotEqual(proc.returncode, 0)


class SafetyTests(unittest.TestCase):
    def test_true_authority_not_present_in_source(self):
        source = SERVICE.read_text()
        self.assertNotIn("sendGuest(", source)
        self.assertNotIn("https://", source)
        self.assertNotIn("HETZNER_API_TOKEN", source)
        self.assertNotIn("CREATE ROLE", source)
        for value in ("canSend", "canApprove", "canIssueReceipt"):
            self.assertIn(f'"{value}": False', source)

    def test_status_has_no_authority(self):
        x = m.response("TECHNICAL_READBACK", "TEST")
        self.assertFalse(x["canSend"])
        self.assertFalse(x["authorized"])

    def test_strict_parser_rejects_extra_fields(self):
        config = {"runId": RUN}
        with self.assertRaises(m.Unsafe):
            m.parse_request(make("append", 1, ONE, "OBSERVED", token="X"), config)

    def test_unknown_unsafe_request_never_reconciles(self):
        v = m.response("HOLD", "UNKNOWN")
        self.assertFalse(v["authorized"])
        self.assertEqual(v["phase2"], "BLOCK")


if __name__ == "__main__":
    unittest.main(verbosity=2)
