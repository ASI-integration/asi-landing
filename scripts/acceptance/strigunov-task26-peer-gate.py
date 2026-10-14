"""Task26: isolated Linux peer-credential observation only.

No subprocess/SQL/cloud/network listener, no issuer, no guest sending.
Kernel SO_PEERCRED is a local identity signal, not independent owner custody.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import tempfile
import threading

SOURCE = "9bc8175aa772e92366c7a2363e26900a042fc3ce"
OPERATIONS = frozenset({"inspect-host", "inspect-journal", "inspect-revocation"})
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
KEYS = frozenset({"kind", "sourceSha", "manifestSha256", "requestId", "operation"})
MAX_REQUEST_BYTES = 1024
PEERCRED_SIZE = struct.calcsize("3i")


def denied(reason: str) -> dict:
    return {
        "status": "BLOCK",
        "reason": reason,
        "scope": "DISPOSABLE_KERNEL_OBSERVATION_ONLY",
        "authorized": False,
        "canIssueReceipt": False,
        "canApprove": False,
        "canSend": False,
        "canInstall": False,
    }


def parse_request(payload: bytes, expected_manifest: str) -> tuple[str | None, str]:
    if not isinstance(payload, bytes) or not payload or len(payload) > MAX_REQUEST_BYTES:
        return None, "INVALID_BYTES"
    if not payload.endswith(b"\n") or payload.count(b"\n") != 1:
        return None, "NOT_ONE_COMPLETE_FRAME"
    try:
        obj = json.loads(payload[:-1].decode("utf-8", errors="strict"))
    except (UnicodeError, ValueError):
        return None, "INVALID_JSON"
    if not isinstance(obj, dict) or frozenset(obj.keys()) != KEYS:
        return None, "UNKNOWN_FIELDS"
    if (
        obj.get("kind") != "ASI_TASK26_OBSERVE_V1"
        or obj.get("sourceSha") != SOURCE
        or not isinstance(obj.get("manifestSha256"), str)
        or not HEX64.fullmatch(obj["manifestSha256"])
        or obj["manifestSha256"] != expected_manifest
        or not isinstance(obj.get("requestId"), str)
        or not HEX32.fullmatch(obj["requestId"])
        or not isinstance(obj.get("operation"), str)
        or obj["operation"] not in OPERATIONS
    ):
        return None, "WRONG_SCOPE_OR_COMMAND"
    return obj["operation"], "STRUCTURE_ONLY"


def inspect_peer(sock: socket.socket, expected_uid: int, expected_gid: int) -> dict:
    """Compare a kernel observation with test-supplied expectations.

    The test fixture's expectations are NOT a trusted owner policy.
    """
    if os.name != "posix" or not hasattr(socket, "SO_PEERCRED"):
        return denied("SO_PEERCRED_UNAVAILABLE")
    if (
        not isinstance(expected_uid, int)
        or isinstance(expected_uid, bool)
        or not isinstance(expected_gid, int)
        or isinstance(expected_gid, bool)
        or expected_uid < 1
        or expected_gid < 1
    ):
        return denied("UNSAFE_EXPECTED_IDENTITY")
    try:
        raw = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, PEERCRED_SIZE)
        pid, uid, gid = struct.unpack("3i", raw)
    except (OSError, struct.error):
        return denied("KERNEL_CREDENTIALS_UNAVAILABLE")
    if pid <= 0 or uid < 1 or gid < 1:
        return denied("INVALID_KERNEL_PRINCIPAL")
    if uid != expected_uid or gid != expected_gid:
        return denied("KERNEL_UID_OR_GID_MISMATCH")
    return {
        "status": "KERNEL_PEER_MATCH_OBSERVED",
        "reason": "TEST_EXPECTATION_MATCH_ONLY",
        "scope": "DISPOSABLE_KERNEL_OBSERVATION_ONLY",
        "authorized": False,
        "canIssueReceipt": False,
        "canApprove": False,
        "canSend": False,
        "canInstall": False,
    }


class DisposablePeerGate:
    """A local, single-purpose Unix socket fixture for a GitHub-hosted runner.

    No live operation executes, and this process is not a protected service.
    """

    def __init__(self, *, expected_uid: int, expected_gid: int, manifest_sha256: str):
        if os.name != "posix" or not hasattr(socket, "SO_PEERCRED"):
            raise RuntimeError("LINUX_ONLY")
        if os.getuid() == 0:
            raise RuntimeError("NO_ROOT_PROCESS")
        if not isinstance(manifest_sha256, str) or not HEX64.fullmatch(manifest_sha256):
            raise ValueError("INVALID_MANIFEST")
        self.expected_uid = expected_uid
        self.expected_gid = expected_gid
        self.manifest_sha256 = manifest_sha256
        self._temp = None
        self._listener = None
        self._worker = None
        self._stop = threading.Event()
        self.path = None
        self.root = None

    def __enter__(self):
        try:
            self._temp = tempfile.TemporaryDirectory(prefix="asi-task26-")
            self.root = Path(self._temp.name)
            info = self.root.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
                raise RuntimeError("ROOT_OWNERSHIP")
            os.chmod(self.root, 0o700)
            self.path = self.root / "kernel-peer.sock"
            if self.path.exists() or self.path.is_symlink():
                raise RuntimeError("SOCKET_ALREADY_EXISTS")
            self._listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self._listener.bind(str(self.path))
            os.chmod(self.path, 0o600)
            self._listener.listen(8)
            self._listener.settimeout(0.15)
            self._worker = threading.Thread(target=self._serve, daemon=True)
            self._worker.start()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def _serve(self):
        while not self._stop.is_set():
            try:
                conn, _ = self._listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            with conn:
                conn.settimeout(1.5)
                peer = inspect_peer(conn, self.expected_uid, self.expected_gid)
                if peer["status"] != "KERNEL_PEER_MATCH_OBSERVED":
                    answer = peer
                else:
                    data = b""
                    try:
                        while len(data) <= MAX_REQUEST_BYTES:
                            chunk = conn.recv(512)
                            if not chunk:
                                break
                            data += chunk
                    except socket.timeout:
                        answer = denied("FRAME_TIMEOUT")
                    except OSError:
                        answer = denied("TRANSPORT_FAILED")
                    else:
                        operation, reason = parse_request(data, self.manifest_sha256)
                        if operation is None:
                            answer = denied(reason)
                        else:
                            answer = {
                                **peer,
                                "operation": operation,
                                "reason": "KERNEL_IDENTITY_MATCHED_NOT_OWNER_AUTHORIZED",
                            }
                try:
                    conn.sendall((json.dumps(answer, sort_keys=True) + "\n").encode("utf-8"))
                except OSError:
                    pass

    def __exit__(self, *_):
        self._stop.set()
        if self._listener is not None:
            self._listener.close()
        if self._worker is not None:
            self._worker.join(timeout=3)
            if self._worker.is_alive():
                raise RuntimeError("PEER_FIXTURE_NOT_STOPPED")
        if self.path is not None and self.path.is_socket():
            self.path.unlink()
        if self._temp is not None:
            self._temp.cleanup()


def send_observation_request(path: Path, data: bytes) -> dict:
    """One local call, no RPC permissions, no retry and no external endpoint."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(3)
        sock.connect(str(path))
        sock.sendall(data)
        sock.shutdown(socket.SHUT_WR)
        chunks = []
        while True:
            chunk = sock.recv(1024)
            if not chunk:
                break
            chunks.append(chunk)
        answer = b"".join(chunks)
        if len(answer) > 2048:
            return denied("RESPONSE_TOO_LARGE")
        try:
            parsed = json.loads(answer)
        except (UnicodeError, ValueError):
            return denied("INVALID_FIXTURE_RESPONSE")
        return parsed if isinstance(parsed, dict) else denied("INVALID_FIXTURE_RESPONSE")
