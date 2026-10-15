"""Offline preparation and synthetic receipt verifier. NEVER grants live authority.
No account/service/network changes. Owner issuer and physical installation remain blocked.
Ed25519 verification uses the host OpenSSL binary; no Python third-party packages.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
from io import BytesIO
import tarfile
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import build_release

SCOPE = "ASI_STRIGUNOV_SYNTHETIC_ONLY_V1"
SOURCE = "313d00dc92014fb10866cca3c8e7fec0c2269598"
HEX = re.compile(r"^[0-9a-f]{64}$")


class Denied(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def private(path, directory=False):
    path = Path(path)
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise Denied("PRIVATE_OWNED_PATH_REQUIRED")
    if not directory and info.st_nlink != 1:
        raise Denied("HARDLINK_DENIED")
    if path.absolute() != path.resolve():
        raise Denied("SYMLINK_ANCESTOR_DENIED")
    return path


def write_new(path, data, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        if os.write(fd, data) != len(data):
            raise Denied("SHORT_WRITE")
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def verify_signature(public_key, data, signature):
    # Private key is never accepted by this verifier.
    with tempfile.TemporaryDirectory(prefix="asi-verify-") as temp:
        d = Path(temp)
        write_new(d / "payload", data)
        write_new(d / "signature", signature)
        result = subprocess.run(["openssl", "pkeyutl", "-verify", "-pubin",
                                 "-inkey", str(public_key), "-rawin",
                                 "-in", str(d / "payload"), "-sigfile", str(d / "signature")],
                                capture_output=True, timeout=10)
        if result.returncode:
            raise Denied("SIGNATURE_INVALID")


def validate_manifest(manifest, digest, host, now):
    if set(manifest) != {"scope", "source", "archiveSha256", "host", "serviceUid",
                         "clientUid", "ownerUid", "expires", "liveAuthority"}:
        raise Denied("MANIFEST_FIELDS")
    if (manifest["scope"] != SCOPE or manifest["source"] != SOURCE
            or manifest["archiveSha256"] != digest or not HEX.fullmatch(digest)
            or manifest["host"] != host or not isinstance(host, str) or not host
            or manifest["liveAuthority"] is not False
            or type(manifest["expires"]) is not int or not now < manifest["expires"] <= now + 3600):
        raise Denied("MANIFEST_BINDING")
    ids = [manifest[k] for k in ("serviceUid", "clientUid", "ownerUid")]
    if any(type(uid) is not int or uid <= 0 for uid in ids) or len(set(ids)) != 3:
        raise Denied("DISTINCT_NONROOT_IDENTITIES")


def prepare(archive, manifest_path, signature_path, public_key, target, host, sandbox=False):
    if not sandbox or os.getuid() == 0:
        raise Denied("SYNTHETIC_NONROOT_SANDBOX_ONLY")
    target = Path(target).absolute()
    private(target.parent, directory=True)
    if target.exists() or target.is_symlink():
        raise Denied("REPEATED_INSTALL_REFUSED")
    data = Path(archive).read_bytes()
    provenance = build_release.validate_bytes(data)
    raw = Path(manifest_path).read_bytes()
    if len(raw) > 4096:
        raise Denied("MANIFEST_SIZE")
    manifest = json.loads(raw)
    if canonical(manifest) != raw:
        raise Denied("NONCANONICAL_MANIFEST")
    signature = Path(signature_path).read_bytes()
    verify_signature(public_key, raw, signature)
    validate_manifest(manifest, hashlib.sha256(data).hexdigest(), host, int(time.time()))
    # No tar extraction: allowlisted source payloads only after exact-byte validation.
    target.mkdir(mode=0o700)
    with tarfile.open(fileobj=BytesIO(data), mode="r:") as archive_data:
        for name, _path, _mode in build_release.FILES:
            write_new(target / Path(name).name, archive_data.extractfile(name).read(), 0o400)
    write_new(target / "approval.json", raw, 0o400)
    write_new(target / "approval.sig", signature, 0o400)
    write_new(target / "archive.sha256", provenance["sha256"].encode(), 0o400)
    sync_dir(target)
    sync_dir(target.parent)
    return {"status": "SANDBOX_PREPARED", "archiveSha256": provenance["sha256"],
            "physicalInstall": False, "ownerIssuer": False, "phase2Native": False}


class SyntheticGate:
    """One-use signed synthetic observation. No command execution or live capability.
    Lock spans validation, durable intent and completion. A crash leaves HOLD.
    State rollback by the state owner cannot be detected without an independent
    monotonic checkpoint: physical authority deliberately remains disabled.
    """
    def __init__(self, root, public_key, binding, enabled=False):
        self.root = private(root, directory=True)
        self.key = public_key
        self.binding = binding
        self.enabled = enabled

    def consume(self, receipt, signature, peer_uid, epoch, revoked=(), now=None, fault=None):
        if not self.enabled:
            raise Denied("DEFAULT_OFF")
        supplied_now = now
        now = int(time.time()) if now is None else now
        if os.getuid() == 0 or peer_uid == os.getuid() or peer_uid <= 0:
            raise Denied("DISTINCT_NONROOT_CLIENT")
        if len(receipt) > 4096:
            raise Denied("RECEIPT_SIZE")
        verify_signature(self.key, receipt, signature)
        item = json.loads(receipt)
        expected = {"scope", "host", "archiveSha256", "clientUid", "nonce",
                    "expires", "epoch", "action", "liveAuthority"}
        if set(item) != expected or canonical(item) != receipt:
            raise Denied("RECEIPT_FIELDS")
        if (item["scope"] != SCOPE or item["host"] != self.binding["host"]
                or item["archiveSha256"] != self.binding["archiveSha256"]
                or item["clientUid"] != peer_uid or type(item["clientUid"]) is not int
                or type(item["expires"]) is not int or not now < item["expires"] <= now + 60
                or item["epoch"] != epoch or type(item["epoch"]) is not int
                or item["action"] != "observe_synthetic" or item["liveAuthority"] is not False
                or not isinstance(item["nonce"], str) or not HEX.fullmatch(item["nonce"])
                or item["nonce"] in revoked):
            raise Denied("RECEIPT_BINDING_OR_REVOCATION")
        lock = self.root / "gate.lock"
        fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            private(lock)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fresh_now = int(time.time()) if supplied_now is None else supplied_now
            if not fresh_now < item["expires"] <= fresh_now + 60:
                raise Denied("EXPIRED_AFTER_VERIFICATION")
            journal = self.root / "journal"
            seen = set()
            previous = "0" * 64
            if journal.exists():
                private(journal)
                raw = journal.read_bytes()
                if len(raw) > 1024 * 1024 or not raw.endswith(b"\n"):
                    raise Denied("JOURNAL_HOLD")
                for line in raw.splitlines():
                    event = json.loads(line)
                    digest = event.pop("hash")
                    if event["prev"] != previous or hashlib.sha256(canonical(event)).hexdigest() != digest:
                        raise Denied("JOURNAL_HASH")
                    previous = digest
                    seen.add(event["nonce"])
                    if event["result"] != "OBSERVED":
                        raise Denied("UNKNOWN_OUTCOME_HOLD")
            if item["nonce"] in seen:
                raise Denied("REPLAY")
            # A separate fsync intent persists BEFORE any observation; unresolved intent blocks restart.
            intent = self.root / "pending"
            if intent.exists() or intent.is_symlink():
                raise Denied("UNKNOWN_OUTCOME_HOLD")
            write_new(intent, canonical(item))
            sync_dir(self.root)
            if fault == "after-intent":
                raise Denied("INJECTED_CRASH")
            event = {"nonce": item["nonce"], "result": "OBSERVED", "prev": previous}
            event["hash"] = hashlib.sha256(canonical(event)).hexdigest()
            jfd = os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
            try:
                private(journal)
                blob = canonical(event) + b"\n"
                if os.write(jfd, blob) != len(blob):
                    raise Denied("SHORT_WRITE")
                os.fsync(jfd)
            finally:
                os.close(jfd)
            if fault == "after-journal":
                raise Denied("INJECTED_CRASH")
            intent.unlink()
            sync_dir(self.root)
            return {"status": "SYNTHETIC_OBSERVED", "authorized": False, "canSend": False}
        except BlockingIOError:
            raise Denied("CONCURRENCY_ONE") from None
        finally:
            os.close(fd)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for arg in ("archive", "manifest", "signature", "public-key", "target", "host"):
        parser.add_argument("--" + arg, required=True)
    parser.add_argument("--synthetic-sandbox", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare(args.archive, args.manifest, args.signature, args.public_key,
                             args.target, args.host, args.synthetic_sandbox)))
