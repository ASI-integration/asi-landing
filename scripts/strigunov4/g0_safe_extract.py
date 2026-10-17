"""Safe G0 tar materializer: *only* into a new empty private staging directory.

No DB, SSH, systemd, network, or activation logic. Run only after an independent
owner-approved main-only staging gate. The pinned archive contract is the byte
and path authority, and this module adds a symlink-last extraction invariant.
"""
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile

import g0_release_archive as archive_contract


class Block(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise Block(reason)


def _ancestors(relative):
    path = PurePosixPath(relative)
    return ["/".join(path.parts[:i]) for i in range(1, len(path.parts))]


def _is_regular_directory(path):
    info = path.lstat()
    return stat.S_ISDIR(info.st_mode) and not path.is_symlink()


def _parent(root, relative):
    current = root
    require(_is_regular_directory(current), "DESTINATION_ROOT")
    for component in _ancestors(relative):
        current = root / component
        if not current.exists() and not current.is_symlink():
            current.mkdir(mode=0o755)
        require(_is_regular_directory(current), "SYMLINK_OR_NONDIR_PARENT")
    return (root / relative).parent


def _copy_regular(stream, member, destination):
    source = stream.extractfile(member)
    require(source is not None, "TAR_FILE_NO_DATA")
    perm = 0o644 | (member.mode & 0o111)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 getattr(os, "O_NOFOLLOW", 0), perm)
    size = 0
    try:
        os.fchmod(fd, perm)
        with source, os.fdopen(fd, "wb", closefd=False) as output:
            while True:
                data = source.read(1048576)
                if not data:
                    break
                size += len(data)
                require(size <= member.size, "FILE_TOO_LONG")
                output.write(data)
            output.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    require(size == member.size, "FILE_SIZE_MISMATCH")


def extract_into_empty(archive, staging_root):
    """Materialize reviewed regular files/dirs first, *then* relative symlinks.

    Caller owns the private, freshly created staging_root and all its parents.
    This module refuses any existing member, file-as-parent or symlink-as-parent.
    A symlink inside the tar can never redirect a subsequent file write.
    """
    root = Path(staging_root)
    require(root.exists() and _is_regular_directory(root)
            and not list(root.iterdir()), "DESTINATION_NOT_EMPTY")
    # Real deployment requires the exact pinned archive SHA/size, full structure,
    # expected release metadata and package lock digest.
    record = archive_contract.inspect(archive)
    require(record["status"] == "G0_TAR_CONTRACT_PASS", "ARCHIVE_NOT_REVIEWED")
    with tarfile.open(archive, "r:gz") as stream:
        members = stream.getmembers()
        symlinks = {archive_contract.clean_member(m)
                    for m in members if m.issym()}
        names = {archive_contract.clean_member(m) for m in members}
        require(len(names) == len(members), "TAR_DUPLICATE_PATH")
        for name in names:
            require(not any(parent in symlinks for parent in _ancestors(name)),
                    "SYMLINK_CHILD_PATH")
        dirs = 0
        files = 0
        for m in members:
            name = archive_contract.clean_member(m)
            if m.issym():
                continue
            parent = _parent(root, name)
            target = root / name
            require(not target.is_symlink(), "SYMLINK_DESTINATION")
            if m.isdir():
                if target.exists():
                    require(_is_regular_directory(target), "DIRECTORY_COLLISION")
                else:
                    target.mkdir(mode=0o755)
                os.chmod(target, 0o755)
                dirs += 1
            elif m.isreg():
                require(not target.exists(), "FILE_COLLISION")
                _copy_regular(stream, m, target)
                files += 1
            else:
                raise Block("UNSUPPORTED_MEMBER")
        for m in members:
            if not m.issym():
                continue
            name = archive_contract.clean_member(m)
            _parent(root, name)
            target = root / name
            require(not target.exists() and not target.is_symlink(), "SYMLINK_COLLISION")
            resolved_target = os.path.normpath(os.path.join(
                str(target.parent), m.linkname))
            require(os.path.commonpath((str(root.resolve()), resolved_target))
                    == str(root.resolve()), "SYMLINK_ESCAPES_RELEASE")
            os.symlink(m.linkname, target)
        # Resolve complete chains after all links have been materialized.
        # A relative link alone does not prove a symlink chain safe.
        for name in symlinks:
            try:
                resolved = (root / name).resolve(strict=False)
            except (OSError, RuntimeError):
                raise Block("SYMLINK_CHAIN_INVALID") from None
            require(resolved.is_relative_to(root.resolve()), "SYMLINK_CHAIN_ESCAPE")
    require(files == record["files"] and dirs == record["dirs"]
            and len(symlinks) == record["symlinks"], "EXTRACTION_MEMBER_COUNTS")
    must = ("release-meta.json", ".next/BUILD_ID",
            "node_modules/next/dist/bin/next", "package-lock.json")
    require(all((root / name).is_file() for name in must),
            "RELEASE_REQUIRED_FILES")
    return {"status": "G0_EXTRACTION_PASS", "regularFiles": files,
            "directories": dirs, "relativeSymlinks": len(symlinks),
            "activeReleaseChanged": False}
