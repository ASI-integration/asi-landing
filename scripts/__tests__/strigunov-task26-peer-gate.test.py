"""Task26 focused physical Linux kernel peer credential acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "acceptance" / "strigunov-task26-peer-gate.py"
spec = importlib.util.spec_from_file_location("strigunov_task26_peer_gate", MODULE_PATH)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

MANIFEST = "a" * 64
REQUEST = "b" * 32


def packet(**changes):
    fields = {
        "kind": "ASI_TASK26_OBSERVE_V1",
        "sourceSha": gate.SOURCE,
        "manifestSha256": MANIFEST,
        "requestId": REQUEST,
        "operation": "inspect-host",
    }
    fields.update(changes)
    return (json.dumps(fields, separators=(",", ":")) + "\n").encode()


@unittest.skipUnless(sys.platform.startswith("linux") and hasattr(socket, "SO_PEERCRED"), "Linux kernel-only tests")
class PeerGateTests(unittest.TestCase):
    def setUp(self):
        self.fixture = gate.DisposablePeerGate(
            expected_uid=os.getuid(), expected_gid=os.getgid(), manifest_sha256=MANIFEST
        )
        self.fixture.__enter__()
        self.addCleanup(lambda: self.fixture.__exit__(None, None, None))

    def call(self, data):
        return gate.send_observation_request(self.fixture.path, data)

    def block(self, data, reason=None):
        result = self.call(data)
        self.assertEqual(result["status"], "BLOCK", result)
        if reason is not None:
            self.assertEqual(result["reason"], reason)
        for field in ("authorized", "canSend", "canApprove", "canIssueReceipt", "canInstall"):
            self.assertFalse(result[field], field)
        return result

    def test_real_kernel_peer_matched_but_not_authorized(self):
        ans = self.call(packet())
        self.assertEqual(ans["status"], "KERNEL_PEER_MATCH_OBSERVED")
        self.assertEqual(ans["scope"], "DISPOSABLE_KERNEL_OBSERVATION_ONLY")
        self.assertFalse(ans["authorized"])
        self.assertFalse(ans["canSend"])
        self.assertEqual(ans["operation"], "inspect-host")

    def test_socket_and_directory_are_private(self):
        self.assertEqual(stat.S_IMODE(self.fixture.root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.fixture.path.stat().st_mode), 0o600)
        self.assertTrue(self.fixture.path.is_socket())

    def test_another_process_peer_matches_real_kernel_identity(self):
        code = (
            "import importlib.util,json,sys,pathlib;"
            "s=importlib.util.spec_from_file_location('p',sys.argv[1]);"
            "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
            "print(json.dumps(m.send_observation_request(pathlib.Path(sys.argv[2]),sys.argv[3].encode())))"
        )
        child = subprocess.run(
            [sys.executable, "-c", code, str(MODULE_PATH), str(self.fixture.path), packet().decode()],
            timeout=10, text=True, capture_output=True, check=True,
        )
        ans = json.loads(child.stdout)
        self.assertEqual(ans["status"], "KERNEL_PEER_MATCH_OBSERVED")
        self.assertFalse(ans["authorized"])

    def test_mismatched_expected_uid_is_denied_by_real_kernel_observation(self):
        with gate.DisposablePeerGate(
            expected_uid=os.getuid() + 20001, expected_gid=os.getgid(),
            manifest_sha256=MANIFEST
        ) as other:
            ans = gate.send_observation_request(other.path, packet())
            self.assertEqual(ans["status"], "BLOCK")
            self.assertEqual(ans["reason"], "KERNEL_UID_OR_GID_MISMATCH")
            self.assertFalse(ans["canIssueReceipt"])

    def test_mismatched_expected_gid_is_denied(self):
        with gate.DisposablePeerGate(
            expected_uid=os.getuid(), expected_gid=os.getgid() + 20001,
            manifest_sha256=MANIFEST
        ) as other:
            ans = gate.send_observation_request(other.path, packet())
            self.assertEqual(ans["status"], "BLOCK")
            self.assertEqual(ans["reason"], "KERNEL_UID_OR_GID_MISMATCH")

    def test_forged_uid_or_owner_in_json_is_rejected(self):
        for field in ("uid", "gid", "pid", "ownerApproved", "signed", "canSend"):
            with self.subTest(field=field):
                self.block(packet(**{field: True}), "UNKNOWN_FIELDS")

    def test_client_cannot_request_issuer_or_shell_actions(self):
        for action in ("issue-receipt", "approve", "sendGuest", "exec-shell", "CREATE ROLE"):
            with self.subTest(action=action):
                self.block(packet(operation=action), "WRONG_SCOPE_OR_COMMAND")

    def test_exact_read_only_operation_vocabulary(self):
        for action in sorted(gate.OPERATIONS):
            ans = self.call(packet(operation=action))
            self.assertEqual(ans["status"], "KERNEL_PEER_MATCH_OBSERVED")
            self.assertFalse(ans["authorized"])

    def test_wrong_source_and_manifest_are_denied(self):
        for change in (
            {"sourceSha": "c" * 40},
            {"manifestSha256": "c" * 64},
            {"manifestSha256": [MANIFEST]},
            {"sourceSha": [gate.SOURCE]},
        ):
            self.block(packet(**change), "WRONG_SCOPE_OR_COMMAND")

    def test_invalid_request_identifier_type_is_denied(self):
        for val in ([REQUEST], 12345, None, "bad"):
            self.block(packet(requestId=val), "WRONG_SCOPE_OR_COMMAND")

    def test_extra_or_missing_fields_fail_closed(self):
        obj = json.loads(packet())
        del obj["requestId"]
        self.block((json.dumps(obj) + "\n").encode(), "UNKNOWN_FIELDS")
        self.block(packet(unexpected="true"), "UNKNOWN_FIELDS")

    def test_fragmented_valid_request_is_accepted_after_half_close(self):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(3)
            client.connect(str(self.fixture.path))
            data = packet()
            for start in range(0, len(data), 7):
                client.sendall(data[start:start + 7])
            client.shutdown(socket.SHUT_WR)
            raw = client.recv(2048)
            result = json.loads(raw)
            self.assertEqual(result["status"], "KERNEL_PEER_MATCH_OBSERVED")
            self.assertFalse(result["canSend"])

    def test_two_frames_in_one_stream_are_denied(self):
        self.block(packet() + packet(), "NOT_ONE_COMPLETE_FRAME")

    def test_no_newline_or_trailing_bytes_are_denied(self):
        self.block(packet().rstrip(b"\n"), "NOT_ONE_COMPLETE_FRAME")
        self.block(packet() + b"X", "NOT_ONE_COMPLETE_FRAME")

    def test_empty_frame_and_oversized_payload_are_denied(self):
        self.block(b"", "INVALID_BYTES")
        self.block(b"x" * 1200, "INVALID_BYTES")

    def test_invalid_utf8_and_malformed_json_are_denied(self):
        self.block(b"\xff\n", "INVALID_JSON")
        self.block(b"not-json\n", "INVALID_JSON")
        self.block(b"[]\n", "UNKNOWN_FIELDS")

    def test_socket_premature_close_does_not_authorize(self):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(self.fixture.path))
            client.shutdown(socket.SHUT_WR)
            response = json.loads(client.recv(2048))
            self.assertEqual(response["status"], "BLOCK")
            self.assertFalse(response["authorized"])

    def test_invalid_expected_identity_types_are_rejected(self):
        with gate.DisposablePeerGate(
            expected_uid=True, expected_gid=os.getgid(), manifest_sha256=MANIFEST
        ) as other:
            ans = gate.send_observation_request(other.path, packet())
            self.assertEqual(ans["reason"], "UNSAFE_EXPECTED_IDENTITY")
        with gate.DisposablePeerGate(
            expected_uid=os.getuid(), expected_gid=0, manifest_sha256=MANIFEST
        ) as other:
            ans = gate.send_observation_request(other.path, packet())
            self.assertEqual(ans["reason"], "UNSAFE_EXPECTED_IDENTITY")

    def test_no_arbitrary_network_or_privileged_operations(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("subprocess.run(", source)
        self.assertNotIn("subprocess.Popen(", source)
        self.assertNotIn("AF_INET", source)
        self.assertNotIn("sendTelegram", source)
        self.assertNotIn("POSTGRES_PASSWORD", source)
        self.assertNotIn("HETZNER_API_TOKEN", source)


class StructureTests(unittest.TestCase):
    def test_invalid_scope_is_untrusted(self):
        operation, reason = gate.parse_request(packet(), MANIFEST)
        self.assertEqual(operation, "inspect-host")
        self.assertEqual(reason, "STRUCTURE_ONLY")

    def test_all_failure_results_block_every_authority_action(self):
        for reason in ("UNKNOWN", "BAD_CLIENT", "MISSING_KEY"):
            result = gate.denied(reason)
            for key in ("authorized", "canIssueReceipt", "canApprove", "canSend", "canInstall"):
                self.assertFalse(result[key])

    def test_root_is_not_allowed_for_fixture_service(self):
        self.assertIn("NO_ROOT_PROCESS", MODULE_PATH.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
