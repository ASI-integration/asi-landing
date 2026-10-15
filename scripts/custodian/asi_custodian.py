#!/usr/bin/env python3
"""ASI custodian technical service v0: real executable, zero operator authority.

Linux-only, stdlib Unix socket + SO_PEERCRED + fsync journal. Does NOT issue
credentials, grants, receipts, real guest consent, or production messages.
The operator-supplied peer UID is *not* independent owner attestation.
"""
from __future__ import annotations

import argparse
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import struct
import sys
import time

POLICY_PROTOCOL = "ASI_CUSTODIAN_POLICY_CONSULT_V1"

SOURCE_BASE = "9bc8175aa772e92366c7a2363e26900a042fc3ce"
SCOPE = "ASI_CUSTODIAN_TECHNICAL_NO_AUTHORITY_V0"
PROTOCOL = "ASI_CUSTODIAN_TECHNICAL_V0"
MAX_REQUEST = 2048
MAX_JOURNAL = 1024 * 1024
MAX_EVENTS = 1000
REQ_KEYS = frozenset(("kind", "op", "runId", "seq", "requestId", "result"))
CONFIG_KEYS = frozenset(("schema", "scope", "sourceBase", "runId", "peerUid", "peerGid",
                         "operatorAuthority", "guestSend"))
EVENT_KEYS = frozenset(("v", "runId", "seq", "requestId", "result", "prev", "hash"))
RUN_RE = re.compile(r"^strig-cust-[0-9a-f]{12}$")
ID_RE = re.compile(r"^[0-9a-f]{32}$")
ZERO = "0" * 64


class Unsafe(Exception):
    """Fail closed without printing data, paths, secrets or the raw request."""


def response(status: str, reason: str, **extra: object) -> dict:
    """All API replies are non-authorizing, including technical success."""
    return {"status": status, "reason": reason, "scope": SCOPE,
            "authorized": False, "canInstall": False, "canIssueReceipt": False,
            "canApprove": False, "canSend": False, "phase2": "BLOCK",
            "ownerAuthority": "UNAVAILABLE", "rollbackProtection": "NOT_ACCEPTED",
            "trustedTime": "NOT_ACCEPTED", **extra}


def require_private_regular(path: Path) -> None:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
        raise Unsafe("FILE_NOT_OWNED_REGULAR")
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise Unsafe("FILE_ACCESS_TOO_BROAD")


def safe_dir(raw: str) -> Path:
    if not isinstance(raw, str) or not raw:
        raise Unsafe("INVALID_ROOT")
    root = Path(raw).absolute()
    if root.is_symlink() or not root.is_dir() or root.resolve() != root:
        raise Unsafe("ROOT_NOT_REAL_DIR")
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise Unsafe("ROOT_NOT_OWNED")
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise Unsafe("ROOT_ACCESS_TOO_BROAD")
    return root


def sync_dir(root: Path) -> None:
    fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def exclusive_bytes(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as out:
            out.write(data)
            out.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def initialize(raw: str, run_id: str, peer_uid: int, peer_gid: int) -> dict:
    if sys.platform != "linux" or os.getuid() == 0:
        raise Unsafe("LINUX_NONROOT_ONLY")
    if not isinstance(run_id, str) or not RUN_RE.fullmatch(run_id):
        raise Unsafe("RUN_ID")
    if type(peer_uid) is not int or type(peer_gid) is not int or peer_uid < 1 or peer_gid < 1:
        raise Unsafe("PEER_IDS")
    root = Path(raw).absolute()
    # Prevent overwrite, symlink traversal and silently reusing another project.
    if root.is_symlink() or root.exists():
        raise Unsafe("ROOT_NOT_FRESH")
    if not root.parent.exists() or root.parent.is_symlink():
        raise Unsafe("PARENT_NOT_REAL")
    root.mkdir(mode=0o700)
    try:
        safe_dir(str(root))
        config = {"schema": 1, "scope": SCOPE, "sourceBase": SOURCE_BASE,
                  "runId": run_id, "peerUid": peer_uid, "peerGid": peer_gid,
                  "operatorAuthority": False, "guestSend": False}
        exclusive_bytes(root / "config.json", canonical(config) + b"\n")
        exclusive_bytes(root / "events.ndjson", b"")
        sync_dir(root)
    except BaseException:
        # Do not silently delete partially initialized state.
        raise
    return response("INITIALIZED", "TECHNICAL_NO_AUTHORITY")


def read_config(root: Path) -> dict:
    file = root / "config.json"
    require_private_regular(file)
    if file.stat().st_size > 1500:
        raise Unsafe("CONFIG_SIZE")
    try:
        config = json.loads(file.read_bytes())
    except (ValueError, UnicodeError):
        raise Unsafe("CONFIG_CORRUPT") from None
    if (type(config) is not dict or frozenset(config) != CONFIG_KEYS or
        config["schema"] != 1 or config["scope"] != SCOPE or
        config["sourceBase"] != SOURCE_BASE or
        type(config["runId"]) is not str or not RUN_RE.fullmatch(config["runId"]) or
        type(config["peerUid"]) is not int or config["peerUid"] < 1 or
        type(config["peerGid"]) is not int or config["peerGid"] < 1 or
        config["operatorAuthority"] is not False or config["guestSend"] is not False):
        raise Unsafe("CONFIG_NOT_SAFE")
    return config


def inspect_journal(root: Path, config: dict) -> tuple[int, str, set[str], str]:
    file = root / "events.ndjson"
    require_private_regular(file)
    if file.stat().st_size > MAX_JOURNAL:
        raise Unsafe("JOURNAL_SIZE")
    raw = file.read_bytes()
    if raw and not raw.endswith(b"\n"):
        raise Unsafe("TORN_JOURNAL")
    lines = raw.splitlines()
    if len(lines) > MAX_EVENTS:
        raise Unsafe("JOURNAL_FULL")
    last = ZERO
    ids: set[str] = set()
    status = "OPEN"
    for index, line in enumerate(lines, start=1):
        try:
            ev = json.loads(line)
        except (ValueError, UnicodeError):
            raise Unsafe("JOURNAL_CORRUPT") from None
        if (type(ev) is not dict or frozenset(ev) != EVENT_KEYS or
            ev["v"] != 1 or ev["runId"] != config["runId"] or
            type(ev["seq"]) is not int or ev["seq"] != index or
            type(ev["requestId"]) is not str or not ID_RE.fullmatch(ev["requestId"]) or
            ev["requestId"] in ids or ev["result"] not in ("OBSERVED", "UNKNOWN") or
            ev["prev"] != last or type(ev["hash"]) is not str or
            not re.fullmatch(r"[0-9a-f]{64}", ev["hash"]) or status != "OPEN"):
            raise Unsafe("JOURNAL_CHAIN_INVALID")
        claimed = ev.pop("hash")
        if sha256(canonical(ev)).hexdigest() != claimed:
            raise Unsafe("JOURNAL_HASH_MISMATCH")
        ids.add(ev["requestId"])
        last = claimed
        if ev["result"] == "UNKNOWN":
            status = "HOLD"
    return len(lines), last, ids, status


def parse_request(raw: bytes, config: dict) -> dict:
    if not raw or len(raw) > MAX_REQUEST or raw.count(b"\n") != 1 or not raw.endswith(b"\n"):
        raise Unsafe("REQUEST_FRAME")
    try:
        value = json.loads(raw[:-1].decode("utf-8", errors="strict"))
    except (ValueError, UnicodeError):
        raise Unsafe("REQUEST_JSON") from None
    if (type(value) is not dict or frozenset(value) != REQ_KEYS or
        value["kind"] != PROTOCOL or value["op"] not in ("status", "append") or
        value["runId"] != config["runId"] or
        type(value["seq"]) is not int or value["seq"] < 0 or
        type(value["requestId"]) is not str or not ID_RE.fullmatch(value["requestId"]) or
        type(value["result"]) is not str or
        value["result"] not in ("NONE", "OBSERVED", "UNKNOWN")):
        raise Unsafe("REQUEST_UNSAFE")
    if value["op"] == "status" and (value["seq"] != 0 or value["result"] != "NONE"):
        raise Unsafe("STATUS_FIELDS")
    if value["op"] == "append" and value["result"] == "NONE":
        raise Unsafe("APPEND_FIELDS")
    return value


def apply(root: Path, config: dict, request: dict) -> dict:
    # One process intentionally handles only ONE connection at a time;
    # journal is fsync'ed before reporting success. No auto-reconciliation.
    journal_identity = (root / "events.ndjson").lstat()
    seq, prev, seen, state = inspect_journal(root, config)
    if request["op"] == "status":
        return response("TECHNICAL_READBACK", "NOT_OWNER_ATTESTED", seq=seq, state=state, lastHash=prev)
    if state != "OPEN":
        return response("HOLD", "UNKNOWN_COMMIT_OR_CORRUPTION", seq=seq, state=state)
    if seq >= MAX_EVENTS:
        return response("HOLD", "JOURNAL_FULL", seq=seq, state=state)
    if request["seq"] != seq + 1 or request["requestId"] in seen:
        return response("HOLD", "REPLAY_OR_GAP", seq=seq)
    event = {"v": 1, "runId": config["runId"], "seq": request["seq"],
             "requestId": request["requestId"], "result": request["result"], "prev": prev}
    event["hash"] = sha256(canonical(event)).hexdigest()
    file = root / "events.ndjson"
    # O_NOFOLLOW and fstat before append, to reject symlink swaps.
    fd = os.open(file, os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
            raise Unsafe("JOURNAL_REPLACED")
        if (stat.S_IMODE(info.st_mode) & 0o077 or
                (info.st_dev, info.st_ino) != (journal_identity.st_dev, journal_identity.st_ino)):
            raise Unsafe("JOURNAL_REPLACED")
        body = canonical(event) + b"\n"
        if os.write(fd, body) != len(body):
            raise Unsafe("SHORT_WRITE")
        os.fsync(fd)
    finally:
        os.close(fd)
    if request["result"] == "UNKNOWN":
        return response("HOLD", "UNRESOLVED_AFTER_FSYNC", seq=request["seq"], state="HOLD")
    return response("TECHNICAL_RECORDED", "FSYNC_ONLY_NOT_AUTHORITY", seq=request["seq"], state="OPEN")


def kernel_peer(conn: socket.socket, config: dict) -> bool:
    try:
        pid, uid, gid = struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    except (OSError, struct.error):
        return False
    return pid > 0 and uid > 0 and gid > 0 and uid == config["peerUid"] and gid == config["peerGid"]


def safe_ipc_dir(raw: str, state: Path, peer_gid: int) -> Path:
    """Separately provisioned socket namespace, never the private state tree.

    setgid preserves the approved client group on the socket without granting
    that group access to config/journal or permission to replace socket paths.
    This group is local technical configuration, not owner attestation.
    """
    path = Path(raw).absolute()
    if path == state or state in path.parents or path in state.parents:
        raise Unsafe("IPC_STATE_OVERLAP")
    if path.is_symlink() or path.resolve() != path:
        raise Unsafe("IPC_NOT_REAL_DIR")
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or info.st_gid != peer_gid or stat.S_IMODE(info.st_mode) != 0o2710):
        raise Unsafe("IPC_PERMISSIONS")
    return path


def serve(raw: str, enable_technical_append: bool = False, ipc_dir: str | None = None,
          enable_synthetic_policy_consult: bool = False) -> None:
    if sys.platform != "linux" or os.getuid() == 0:
        raise Unsafe("LINUX_NONROOT_ONLY")
    root = safe_dir(raw)
    lock_path = root / "serve.lock"
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        require_private_regular(lock_path)
        if (info.st_dev, info.st_ino) != (lock_path.stat().st_dev, lock_path.stat().st_ino):
            raise Unsafe("LOCK_REPLACED")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _serve_locked(raw, enable_technical_append, fd, root.stat(), ipc_dir, enable_synthetic_policy_consult)
    finally:
        os.close(fd)


def _serve_locked(raw: str, enable_technical_append: bool, lock_fd: int, root_info,
                  ipc_dir: str | None = None, enable_synthetic_policy_consult: bool = False) -> None:
    if sys.platform != "linux" or os.getuid() == 0 or not hasattr(socket, "SO_PEERCRED"):
        raise Unsafe("LINUX_NONROOT_ONLY")
    root = safe_dir(raw)
    config = read_config(root)
    inspect_journal(root, config)
    consultation = None
    policy_errors = ()
    frame_limit = MAX_REQUEST
    if enable_synthetic_policy_consult:
        try:
            import durable_policy
            from policy_ipc import Consultation, MAX_FRAME
        except ImportError:
            raise Unsafe("POLICY_MODULE_UNAVAILABLE") from None
        policy_errors = (durable_policy.Hold,)
        try:
            consultation = Consultation(root)
        except (durable_policy.Hold, OSError, ValueError, TypeError):
            raise Unsafe("POLICY_CONFIG_UNAVAILABLE") from None
        frame_limit = MAX_FRAME
    ipc_root = safe_ipc_dir(ipc_dir, root, config["peerGid"]) if ipc_dir else root
    ipc_identity = ipc_root.stat()
    sock_path = ipc_root / "custodian.sock"
    if sock_path.exists() or sock_path.is_symlink():
        raise Unsafe("STALE_SOCKET_MANUAL_REVIEW")
    halt = False

    def stop(_sig: int, _frame: object) -> None:
        nonlocal halt
        halt = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    owned_socket = None
    try:
        listener.bind(str(sock_path))
        owned_socket = sock_path.lstat()
        os.chmod(sock_path, 0o660 if ipc_dir else 0o600)
        if ipc_dir and sock_path.stat().st_gid != config["peerGid"]:
            raise Unsafe("SOCKET_GROUP")
        listener.listen(8)
        listener.settimeout(0.2)
        while not halt:
            try:
                conn, _ = listener.accept()
            except socket.timeout:
                continue
            with conn:
                conn.settimeout(0.25)
                peer_ok = kernel_peer(conn, config)
                collected = b""
                deadline = time.monotonic() + 2.0
                failure = None
                while not halt and time.monotonic() < deadline and len(collected) <= frame_limit:
                    try:
                        chunk = conn.recv(512)
                    except socket.timeout:
                        continue
                    except OSError:
                        failure = "RECV_FAILED"
                        break
                    if not chunk:
                        break
                    collected += chunk
                if halt:
                    continue
                if failure:
                    answer = response("HOLD", failure)
                elif len(collected) > frame_limit or time.monotonic() >= deadline:
                    answer = response("HOLD", "FRAME_SIZE_OR_TIMEOUT")
                elif not peer_ok:
                    answer = response("HOLD", "KERNEL_PEER_DENIED")
                else:
                    try:
                        current_root = safe_dir(raw).stat()
                        # Config changes invalidate the running instance, including
                        # UID/GID changes. Restart is explicit; never silently reload.
                        if read_config(root) != config:
                            raise Unsafe("CONFIG_CHANGED_RESTART_REQUIRED")
                        if ipc_dir:
                            current_ipc = safe_ipc_dir(ipc_dir, root, config["peerGid"]).stat()
                            if ((current_ipc.st_dev, current_ipc.st_ino) !=
                                    (ipc_identity.st_dev, ipc_identity.st_ino)):
                                raise Unsafe("IPC_REPLACED")
                        lock_path = root / "serve.lock"
                        require_private_regular(lock_path)
                        lock_info = os.fstat(lock_fd)
                        if ((current_root.st_dev, current_root.st_ino) != (root_info.st_dev, root_info.st_ino) or
                            (lock_path.stat().st_dev, lock_path.stat().st_ino) != (lock_info.st_dev, lock_info.st_ino)):
                            raise Unsafe("STATE_REPLACED")
                        # Routing only; each protocol then validates its own exact schema.
                        envelope = json.loads(collected)
                        if isinstance(envelope, dict) and envelope.get("kind") == POLICY_PROTOCOL:
                            if consultation is None:
                                answer = response("HOLD", "POLICY_CONSULT_DISABLED")
                            else:
                                result = consultation.consume(conn, collected, config["runId"])
                                # Deliberately do not forward arbitrary boundary fields.
                                answer = response(result["status"], "SYNTHETIC_CONSULTATION_ONLY", seq=result["seq"])
                        else:
                            request = parse_request(collected, config)
                            answer = (response("HOLD", "APPEND_DISABLED")
                                      if request["op"] == "append" and not enable_technical_append
                                      else apply(root, config, request))
                    except (Unsafe, OSError, ValueError, TypeError, RecursionError) + policy_errors:
                        answer = response("HOLD", "INVALID_REQUEST_OR_JOURNAL")
                try:
                    conn.sendall(canonical(answer) + b"\n")
                except OSError:
                    pass
    finally:
        listener.close()
        if owned_socket is not None and sock_path.is_socket():
            current = sock_path.lstat()
            if (current.st_dev, current.st_ino) == (owned_socket.st_dev, owned_socket.st_ino):
                sock_path.unlink()


def request_client(root: str, operation: str, seq: int, request_id: str, result: str) -> dict:
    # CLI helper is only for local technical probes, no production endpoint.
    config = read_config(safe_dir(root))
    msg = {"kind": PROTOCOL, "op": operation, "seq": seq,
           "runId": config["runId"], "requestId": request_id, "result": result}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(3)
        conn.connect(str(Path(root) / "custodian.sock"))
        conn.sendall(canonical(msg) + b"\n")
        conn.shutdown(socket.SHUT_WR)
        output = bytearray()
        while len(output) <= 2048:
            part = conn.recv(1024)
            if not part:
                break
            output.extend(part)
    if len(output) > 2048:
        raise Unsafe("RESPONSE_SIZE")
    return json.loads(output)


def main() -> int:
    parser = argparse.ArgumentParser(description="ASI technical custodian (NO AUTHORITY, NO GUEST SEND)")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("--state-dir", required=True)
    init.add_argument("--run-id", required=True)
    init.add_argument("--peer-uid", type=int, required=True)
    init.add_argument("--peer-gid", type=int, required=True)
    daemon = sub.add_parser("serve")
    daemon.add_argument("--state-dir", required=True)
    daemon.add_argument("--enable-technical-append", action="store_true")
    daemon.add_argument("--ipc-dir", help="Explicit separate pre-provisioned technical socket directory")
    daemon.add_argument("--enable-synthetic-policy-consult", action="store_true",
                        help="Default-off signed synthetic receipt consultation; never real authority")
    call = sub.add_parser("client")
    call.add_argument("--state-dir", required=True)
    call.add_argument("--op", choices=("status", "append"), required=True)
    call.add_argument("--seq", type=int, required=True)
    call.add_argument("--id", required=True)
    call.add_argument("--result", choices=("NONE", "OBSERVED", "UNKNOWN"), required=True)
    args = parser.parse_args()
    try:
        if args.command == "init":
            value = initialize(args.state_dir, args.run_id, args.peer_uid, args.peer_gid)
        elif args.command == "serve":
            serve(args.state_dir, args.enable_technical_append, args.ipc_dir, args.enable_synthetic_policy_consult)
            return 0
        else:
            value = request_client(args.state_dir, args.op, args.seq, args.id, args.result)
    except (Unsafe, OSError, ValueError, TypeError):
        value = response("HOLD", "LOCAL_TECHNICAL_ERROR")
    print(json.dumps(value, sort_keys=True))
    return 0 if value["status"] in ("INITIALIZED", "TECHNICAL_READBACK", "TECHNICAL_RECORDED") else 1


if __name__ == "__main__":
    raise SystemExit(main())
