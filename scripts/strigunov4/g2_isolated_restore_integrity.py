"""Read-only G2 isolated-copy integrity check; never a release/deploy approval.

Inputs must be independently created disposable copies. This tool never extracts
an archive, reads credential contents into output, or writes to the host.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat

HEX64 = re.compile(r"[0-9a-f]{64}\Z")
MAX_FILES = 50000
MAX_BYTES = 2_000_000_000
FORBIDDEN = (Path("/var/www/asi-staging"), Path("/etc"),
             Path("/opt/asi-engine"), Path("/var/lib/asi-engine"))


class Block(Exception):
    pass


def require(ok, reason):
    if not ok:
        raise Block(reason)


def safe_directory(path):
    p = Path(path).absolute()
    require(p != Path("/") and not any(p == x or x in p.parents for x in FORBIDDEN),
            "PROTECTED_INPUT_PATH")
    st = p.lstat()
    require(stat.S_ISDIR(st.st_mode) and not p.is_symlink(), "COPY_ROOT_NOT_DIRECTORY")
    require(p.resolve() == p, "COPY_PATH_SYMLINK")
    return p


def hash_regular(path, maximum):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1,
            "NONREGULAR_OR_LINKED_FILE")
    require(0 <= before.st_size <= maximum, "FILE_SIZE_LIMIT")
    digest = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                 before.st_ctime_ns) ==
                (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns,
                 opened.st_ctime_ns), "FILE_CHANGED_BEFORE_READ")
        read = 0
        while True:
            block = os.read(fd, min(1024 * 1024, maximum + 1 - read))
            if not block:
                break
            read += len(block)
            require(read <= maximum, "FILE_SIZE_LIMIT")
            digest.update(block)
        after = os.fstat(fd)
        require(read == before.st_size and
                (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns,
                 opened.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                 after.st_ctime_ns), "FILE_CHANGED_DURING_READ")
    finally:
        os.close(fd)
    return digest.hexdigest(), before.st_size, stat.S_IMODE(before.st_mode)


def tree_fingerprint(root):
    root = safe_directory(root)
    files, folders, size = 0, 0, 0
    fingerprint = hashlib.sha256()
    for directory, children, names in os.walk(root, followlinks=False):
        base = Path(directory)
        children.sort()
        names.sort()
        dir_info = base.lstat()
        require(stat.S_ISDIR(dir_info.st_mode) and not base.is_symlink(),
                "TREE_SYMLINK_OR_SPECIAL_DIR")
        rel_dir = base.relative_to(root).as_posix()
        dir_fields = ("D", rel_dir, str(stat.S_IMODE(dir_info.st_mode)))
        for value in dir_fields:
            encoded = value.encode("utf-8")
            fingerprint.update(len(encoded).to_bytes(4, "big"))
            fingerprint.update(encoded)
        folders += 1
        for item in children:
            info = (base / item).lstat()
            require(stat.S_ISDIR(info.st_mode), "TREE_SYMLINK_OR_SPECIAL_DIR")
        for item in names:
            path = base / item
            rel = path.relative_to(root).as_posix()
            require(len(rel.encode("utf-8")) <= 4096, "RELATIVE_PATH_LIMIT")
            remaining = MAX_BYTES - size
            require(files < MAX_FILES and remaining >= 0, "TREE_SIZE_LIMIT")
            digest, nbytes, mode = hash_regular(path, remaining)
            size += nbytes
            files += 1
            # Length-prefix all variable values to prevent concatenation ambiguity.
            for value in ("F", rel, str(mode), str(nbytes), digest):
                encoded = value.encode("utf-8")
                fingerprint.update(len(encoded).to_bytes(4, "big"))
                fingerprint.update(encoded)
    require(files > 0, "EMPTY_TREE")
    return {"inventorySha256": fingerprint.hexdigest(), "files": files,
            "directories": folders, "bytes": size}


def inspect(source_copy, restored_copy, archive, expected_archive_sha256):
    require(type(expected_archive_sha256) is str and
            HEX64.fullmatch(expected_archive_sha256) is not None,
            "BACKUP_PIN_REQUIRED")
    source = safe_directory(source_copy)
    restored = safe_directory(restored_copy)
    require(source != restored and source not in restored.parents
            and restored not in source.parents, "NOT_TWO_ISOLATED_COPIES")
    backup = Path(archive).absolute()
    require(not any(backup == x or x in backup.parents for x in FORBIDDEN),
            "PROTECTED_INPUT_PATH")
    require(backup != source and backup != restored and
            source not in backup.parents and restored not in backup.parents,
            "ARCHIVE_INSIDE_COPY")
    archive_hash, archive_bytes, _ = hash_regular(backup, MAX_BYTES)
    require(archive_hash == expected_archive_sha256, "BACKUP_BYTES_MISMATCH")
    before = tree_fingerprint(source)
    after = tree_fingerprint(restored)
    require(before == after, "ISOLATED_RESTORE_BYTES_MISMATCH")
    return {"status": "G2_ISOLATED_COPIES_EQUAL_NOT_PHYSICAL_ACCEPTANCE",
            "sourceInventorySha256": before["inventorySha256"],
            "restoredInventorySha256": after["inventorySha256"],
            "backupSha256": archive_hash, "backupBytes": archive_bytes,
            "files": before["files"], "directories": before["directories"],
            "bytes": before["bytes"],
            "authorization": False, "stageSwitched": False,
            "liveBackupProven": False, "humanLoginProven": False,
            "independentWitnessProven": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-copy", required=True)
    parser.add_argument("--restored-copy", required=True)
    parser.add_argument("--backup-archive", required=True)
    parser.add_argument("--expected-backup-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        result = inspect(args.source_copy, args.restored_copy,
                         args.backup_archive, args.expected_backup_sha256)
        code = 0
    except (Block, OSError, ValueError, UnicodeError) as error:
        reason = str(error) if type(error) is Block else "IO_OR_INPUT_UNVERIFIED"
        result = {"status": "BLOCK", "reason": reason,
                  "authorization": False, "stageSwitched": False}
        code = 2
    print(json.dumps(result, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
