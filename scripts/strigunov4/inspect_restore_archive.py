"""Offline preflight for an already decrypted archive. Never extracts or restores.

Run only in the protected recovery environment. Reads no credential/key files.
Output deliberately contains no member names, SQL, data, paths or exception text.
"""
import argparse
import json
from pathlib import Path
import tarfile


class InvalidArchive(Exception):
    pass


def inspect(path, max_bytes):
    if type(max_bytes) is not int or max_bytes <= 0:
        raise InvalidArchive("INVALID_LIMIT")
    expected = {"db.dump", "globals.sql", "toc.txt"}
    seen = set()
    total = 0
    with tarfile.open(path, mode="r|gz") as archive:
        for member in archive:
            if member.name not in expected or member.name in seen:
                raise InvalidArchive("UNEXPECTED_OR_DUPLICATE_MEMBER")
            if not member.isfile() or member.issparse():
                raise InvalidArchive("NONREGULAR_MEMBER")
            if member.size < 50:
                raise InvalidArchive("INCOMPLETE_MEMBER")
            total += member.size
            if total > max_bytes:
                raise InvalidArchive("SIZE_LIMIT")
            seen.add(member.name)
            stream = archive.extractfile(member)
            if stream is None:
                raise InvalidArchive("UNREADABLE_MEMBER")
            with stream:
                first = stream.read(5)
                if member.name == "db.dump" and first != b"PGDMP":
                    raise InvalidArchive("INVALID_DUMP_HEADER")
                remaining = member.size - len(first)
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise InvalidArchive("TRUNCATED_MEMBER")
                    remaining -= len(chunk)
        if seen != expected:
            raise InvalidArchive("MISSING_MEMBER")
    return {"archive_structure": "PASS", "restore": "NOT_RUN", "authorization": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--max-uncompressed-bytes", required=True, type=int)
    args = parser.parse_args()
    try:
        result = inspect(args.archive, args.max_uncompressed_bytes)
    except InvalidArchive as exc:
        result = {"archive_structure": "BLOCK", "reason": str(exc), "restore": "NOT_RUN", "authorization": False}
    except Exception:
        result = {"archive_structure": "BLOCK", "reason": "UNREADABLE_ARCHIVE", "restore": "NOT_RUN", "authorization": False}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["archive_structure"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
