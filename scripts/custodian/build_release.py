#!/usr/bin/env python3
"""Deterministic build of the real executable *technical* custodian.

Archive is deliberately NOT an installer, signature or owner authorization.
It must be reviewed and installed only on separately owner-controlled host.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import tarfile

HERE = Path(__file__).resolve().parent
FILES = (
    ("asi-custodian/asi_custodian.py", HERE / "asi_custodian.py", 0o755),
    ("asi-custodian/README.md", HERE / "README.md", 0o600),
)
PACKAGE = "asi-custodian-technical-v0.tar"
AUTH = {"authorized": False, "canInstall": False, "canIssueReceipt": False, "canApprove": False, "canSend": False, "phase2": "BLOCK"}
MAX_ARCHIVE = 128 * 1024


def canonical(obj: dict) -> bytes:
    return (json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n").encode()


def deterministic_info(name: str, blob: bytes, mode: int) -> tarfile.TarInfo:
    meta = tarfile.TarInfo(name)
    meta.size = len(blob)
    meta.mode = mode
    meta.uid = 0
    meta.gid = 0
    meta.mtime = 0
    meta.uname = ""
    meta.gname = ""
    return meta


def make_bytes() -> tuple[bytes, dict]:
    files = [(name, path.read_bytes(), mode) for name, path, mode in FILES]
    manifest = {"schema": 1, "name": "ASI_CUSTODIAN_EXECUTABLE_TECHNICAL_NO_AUTHORITY",
                "files": {name: {"sha256": sha256(blob).hexdigest(), "bytes": len(blob),
                                  "mode": mode} for name, blob, mode in files},
                "ownerSigned": False, "ownerInstalled": False,
                "cloudReady": False, **AUTH}
    manifest_blob = canonical(manifest)
    output = BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for name, blob, mode in files + [("asi-custodian/manifest.json", manifest_blob, 0o600)]:
            tar.addfile(deterministic_info(name, blob, mode), BytesIO(blob))
    data = output.getvalue()
    if len(data) > MAX_ARCHIVE:
        raise ValueError("ARCHIVE_SIZE")
    return data, manifest


def validate_bytes(data: bytes) -> dict:
    if not isinstance(data, bytes) or len(data) > MAX_ARCHIVE:
        raise ValueError("ARCHIVE_SIZE")
    with tarfile.open(fileobj=BytesIO(data), mode="r:") as archive:
        members = archive.getmembers()
        expected = [name for name, _, _ in FILES] + ["asi-custodian/manifest.json"]
        if [x.name for x in members] != expected:
            raise ValueError("FILE_ALLOWLIST")
        blobs = {}
        for entry in members:
            if (not entry.isfile() or entry.linkname or entry.uid != 0 or entry.gid != 0
                    or entry.mtime != 0 or entry.uname or entry.gname
                    or entry.mode != (0o755 if entry.name.endswith(".py") else 0o600)):
                raise ValueError("FILE_METADATA")
            if entry.issparse() or entry.size > MAX_ARCHIVE:
                raise ValueError("FILE_SIZE")
            payload = archive.extractfile(entry)
            if payload is None:
                raise ValueError("NO_PAYLOAD")
            blobs[entry.name] = payload.read()
    if blobs["asi-custodian/manifest.json"] != canonical(make_bytes_manifest(blobs)):
        raise ValueError("MANIFEST_MISMATCH")
    for name, path, _ in FILES:
        if blobs[name] != path.read_bytes():
            raise ValueError("SOURCE_CHANGED")
    if data != make_bytes()[0]:
        raise ValueError("NONCANONICAL_BYTES")
    return {"status": "EXACT_TECHNICAL_RELEASE_BYTES_ONLY", "sha256": sha256(data).hexdigest(),
            "ownerSigned": False, "ownerInstalled": False, **AUTH}


def make_bytes_manifest(blobs: dict) -> dict:
    files = {name: {"sha256": sha256(blobs[name]).hexdigest(), "bytes": len(blobs[name]),
                    "mode": mode} for name, _, mode in FILES}
    return {"schema": 1, "name": "ASI_CUSTODIAN_EXECUTABLE_TECHNICAL_NO_AUTHORITY",
            "files": files, "ownerSigned": False, "ownerInstalled": False,
            "cloudReady": False, **AUTH}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    target = Path(args.out)
    if args.verify:
        answer = validate_bytes(target.read_bytes())
    else:
        data, _ = make_bytes()
        if target.exists():
            raise ValueError("REFUSE_OVERWRITE")
        target.write_bytes(data)
        answer = validate_bytes(target.read_bytes())
    print(json.dumps(answer, sort_keys=True))


if __name__ == "__main__":
    main()
