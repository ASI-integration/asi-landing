"""Task27: deterministic synthetic release bundle and offline verifier.

STRICTLY a test-only release candidate / source review aid. The reviewer-
supplied digest is NOT an owner signature; no secret, cloud access, service,
credential, operator permission, real executable or guest send is created.
"""
from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re
import stat
import tarfile
import tempfile

SOURCE_BASE = "9bc8175aa772e92366c7a2363e26900a042fc3ce"
MEMBERS = (
    "manifest.json",
    "bin/custodian-placeholder.txt",
    "config/custodian-placeholder.json",
)
STUB = b"ASI-TASK27-SYNTHETIC-NONEXECUTABLE-STUB\n"
CONF = (
    b'{"canApprove":false,"canSend":false,"cloud":false,'
    b'"phase2":"BLOCK","scope":"OFFLINE_SYNTHETIC"}\n'
)
MAX_ARCHIVE = 16384
HASH = re.compile(r"^[a-f0-9]{64}$")
DIR = re.compile(r"^asi-task27-[a-f0-9]{12}$")
FILE_NAME = "synthetic-owner-handoff.tar"


def denied(reason: str, **extra: object) -> dict:
    return {
        "status": "HOLD",
        "reason": reason,
        "scope": "OFFLINE_NON_AUTHORIZING_RELEASE_PROOF",
        "authorized": False,
        "canInstall": False,
        "canIssueReceipt": False,
        "canApprove": False,
        "canSend": False,
        "realOperator": False,
        "phase2": "BLOCK",
        **extra,
    }


def own_fixture_dir() -> Path:
    """Make exactly one new private directory, owned by this test process."""
    root = Path(tempfile.gettempdir()).resolve()
    for _ in range(8):
        new = root / ("asi-task27-" + os.urandom(6).hex())
        try:
            new.mkdir(mode=0o700)
            return new
        except FileExistsError:
            continue
    raise RuntimeError("UNIQUE_FIXTURE_ROOT_NOT_CREATED")


def assert_test_root(root: Path) -> Path:
    """Guard against path replacement and writes outside dedicated OS tmp."""
    if not isinstance(root, Path):
        raise ValueError("INVALID_ROOT")
    canonical = root.absolute()
    tmp = Path(tempfile.gettempdir()).resolve()
    if (
        not DIR.fullmatch(root.name)
        or canonical.parent != tmp
        or canonical.is_symlink()
        or not canonical.is_dir()
        or canonical.resolve() != canonical
    ):
        raise ValueError("FOREIGN_ROOT")
    info = canonical.stat()
    if os.name == "posix" and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError("UNSAFE_DIRECTORY_PERMISSIONS")
    return canonical


def manifest_bytes() -> bytes:
    """Identical bytes across OS, independent of shell locale or local clock."""
    content = {
        "schema": 1,
        "kind": "TASK27_SYNTHETIC_HANDOFF_ONLY",
        "sourceBaseSha": SOURCE_BASE,
        "hostInstalled": False,
        "ownerApprovalPresent": False,
        "cloudServerAttached": False,
        "canInstall": False,
        "canSend": False,
        "phase2": "BLOCK",
        "files": {
            MEMBERS[1]: {"sha256": sha256(STUB).hexdigest(), "length": len(STUB)},
            MEMBERS[2]: {"sha256": sha256(CONF).hexdigest(), "length": len(CONF)},
        },
    }
    return (json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def tar_item(name: str, payload: bytes) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.size = len(payload)
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mode = 0o600
    info.mtime = 0
    info.type = tarfile.REGTYPE
    return info


def canonical_tar(parts: tuple[bytes, bytes, bytes]) -> bytes:
    output = BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for name, body in zip(MEMBERS, parts, strict=True):
            tar.addfile(tar_item(name, body), BytesIO(body))
    return output.getvalue()


def build_fixture(root: Path) -> dict:
    try:
        directory = assert_test_root(root)
        if list(directory.iterdir()):
            return denied("ROOT_NOT_EMPTY")
        body = canonical_tar((manifest_bytes(), STUB, CONF))
        target = directory / FILE_NAME
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(target, flags, 0o600)
        try:
            with os.fdopen(fd, "wb", closefd=False) as stream:
                stream.write(body)
                stream.flush()
                os.fsync(fd)
        finally:
            os.close(fd)
        if os.name == "posix":
            dfd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        return {
            **denied("OWNER_APPROVAL_NOT_INSTALLED"),
            "status": "BUNDLE_BUILT_FOR_REVIEW_ONLY",
            "sha256": sha256(body).hexdigest(),
            "bytes": len(body),
        }
    except (OSError, ValueError, tarfile.TarError) as exc:
        return denied("BUILD_FAILED", errorType=type(exc).__name__)


def inspect_bundle(root: Path, expected_sha256: str) -> dict:
    """Read only an exact task-owned file; never unpack/execute or grant authority.

    Expected hash supplied by an agent is not an independent owner approval.
    """
    if type(expected_sha256) is not str or not HASH.fullmatch(expected_sha256):
        return denied("EXPECTED_HASH_INVALID")
    try:
        directory = assert_test_root(root)
        target = directory / FILE_NAME
        info = target.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_ARCHIVE:
            return denied("FILE_NOT_REGULAR_OR_OVERSIZED")
        if os.name == "posix" and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077):
            return denied("FILE_PERMISSIONS_UNSAFE")
        body = target.read_bytes()
        if sha256(body).hexdigest() != expected_sha256:
            return denied("EXACT_DIGEST_MISMATCH")
        with tarfile.open(fileobj=BytesIO(body), mode="r:") as tar:
            entries = tar.getmembers()
            if tuple(e.name for e in entries) != MEMBERS:
                return denied("ARCHIVE_MEMBER_ALLOWLIST")
            data = []
            for entry in entries:
                if (
                    not entry.isfile() or entry.linkname
                    or entry.uid != 0 or entry.gid != 0
                    or entry.uname or entry.gname
                    or entry.mode != 0o600 or entry.mtime != 0
                    or entry.size > 4096
                ):
                    return denied("ARCHIVE_METADATA")
                f = tar.extractfile(entry)
                if f is None:
                    return denied("ARCHIVE_CONTENT_MISSING")
                data.append(f.read())
        man, stub, config = data
        if man != manifest_bytes() or stub != STUB or config != CONF:
            return denied("MANIFEST_OR_PAYLOAD_MISMATCH")
        if canonical_tar((man, stub, config)) != body:
            return denied("NONCANONICAL_ARCHIVE")
        return {
            **denied("INDEPENDENT_OWNER_APPROVAL_MISSING"),
            "status": "EXACT_BUNDLE_BYTES_MATCHED_ONLY",
            "sha256": expected_sha256,
            "files": len(MEMBERS),
        }
    except (OSError, ValueError, tarfile.TarError):
        return denied("READBACK_OR_PARSE_FAILURE")
