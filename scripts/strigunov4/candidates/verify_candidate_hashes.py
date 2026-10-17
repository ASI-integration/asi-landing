"""Fail-closed integrity verification for the reviewed Strigunov4 candidate files.

No credentials, SQL execution, network requests, or authorization side effects.
The recorded hashes are historical reviewed source bytes, not staging permission.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys

ROOT = Path(__file__).resolve().parent
EXPECTED = frozenset((
    "README.md", "build_candidate.py", "catalog-baseline.json",
    "data_preflight.sql", "plan.json", "rehearse.sql",
    "sql/20260810280000_booking_ops_communication_purpose_constraint_repair.sql",
    "sql/20261003124500_booking_ops_auto_send_account_scope_v1.sql",
    "sql/20261003141500_booking_inbound_intake_account_scope_v1.sql",
    "sql/20261003150000_booking_availability_account_scope_v1.sql",
    "sql/20261005090000_booking_ops_record_scope_guard_v1.sql",
    "sql/20261005095000_booking_ops_record_scope_guard_privileges_v1.sql",
    "sql/20261015103000_booking_knowledge_read_contract.sql",
    "sql/20261016090000_g0_operator_revision_takeover.sql",
    "systemd_candidate.py", "test_candidate_safety.py", "test_systemd.py",
))
DIGEST = re.compile(r"[0-9a-f]{64}", re.ASCII)


class IntegrityBlock(ValueError):
    pass


def _object_unique(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise IntegrityBlock("DUPLICATE_KEY")
        out[k] = v
    return out


def _regular_file(path):
    # Reject symbolic links to both files and directories before reading any bytes.
    if path.is_symlink() or not path.is_file():
        raise IntegrityBlock("NONREGULAR_FILE")
    if not stat.S_ISREG(path.stat(follow_symlinks=False).st_mode):
        raise IntegrityBlock("NONREGULAR_FILE")


def verify(root=ROOT):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise IntegrityBlock("ROOT_INVALID")
    manifest = root / "SHA256SUMS.json"
    _regular_file(manifest)
    if manifest.stat().st_size > 16384:
        raise IntegrityBlock("MANIFEST_OVERSIZE")
    try:
        pairs = json.loads(manifest.read_bytes(), object_pairs_hook=_object_unique)
    except (UnicodeError, ValueError, RecursionError) as e:
        raise IntegrityBlock("MANIFEST_PARSE") from e
    if type(pairs) is not dict or set(pairs) != EXPECTED:
        raise IntegrityBlock("MANIFEST_FILE_SET")
    # An unlisted SQL file can affect legacy prefix-based candidate selection.
    # Reject unknown files AND directories, including symlinks, before any hashes.
    sql_dir = root / "sql"
    if sql_dir.is_symlink() or not sql_dir.is_dir():
        raise IntegrityBlock("SQL_DIRECTORY_INVALID")
    permitted = {PurePosixPath(entry).name for entry in EXPECTED if entry.startswith("sql/")}
    observed = {entry.name for entry in sql_dir.iterdir()}
    if observed != permitted:
        raise IntegrityBlock("UNLISTED_SQL_FILE")
    for relative, expected in pairs.items():
        # Rooted in a literal source allowlist, but still verify the path form.
        if (type(relative) is not str or "\\" in relative or
                PurePosixPath(relative).is_absolute() or
                ".." in PurePosixPath(relative).parts or
                type(expected) is not str or not DIGEST.fullmatch(expected)):
            raise IntegrityBlock("INVALID_ENTRY")
        file = root
        for part in PurePosixPath(relative).parts:
            file = file / part
            if file.is_symlink():
                raise IntegrityBlock("SYMLINK_COMPONENT")
        _regular_file(file)
        sha = hashlib.sha256()
        with file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                sha.update(chunk)
        if sha.hexdigest() != expected:
            raise IntegrityBlock("CHECKSUM_MISMATCH")
    return len(pairs)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=ROOT)
    args = p.parse_args()
    try:
        count = verify(args.root)
    except (IntegrityBlock, OSError):
        print("CANDIDATE_INTEGRITY_BLOCK")
        return 2
    print(f"CANDIDATE_INTEGRITY_PASS files={count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
