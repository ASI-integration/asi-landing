"""Bounded unit byte contract; no service control, network or write operations."""
import hashlib
import json
import os
from pathlib import PurePosixPath
import re
import stat

OLD_UNIT_SHA256 = "9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9"
UNIT = "/etc/systemd/system/asi-landing-staging.service"
ENV = "/var/www/asi-staging/shared/.env.staging.local"
SERVICE = "asi-landing-staging"
INCIDENT = "39213017307"
LIMIT = 65536
HEX = re.compile(r"[a-f0-9]{64}\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")
RUN = re.compile(r"[1-9][0-9]{0,19}\Z")
REASONS = frozenset("ARGS HOST PATH METADATA SIZE READ_RACE OLD_HASH FORMAT DIRECTIVES VALUE PROPERTIES IDENTITY PROCESS_CHANGED MANAGER_CHANGED DEADLINE COMMAND UNKNOWN".split())


class Block(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise Block(reason)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def plan(raw, expected_old=OLD_UNIT_SHA256):
    """Preserve actual bytes, including CRLF/LF, indentation and final newline.

    A quoted/continued/ambiguous directive is refused, not normalized. An
    already mandatory disk file is reported separately from manager state.
    The protected worker never accepts expected_old from input.
    """
    require(type(raw) is bytes and 0 < len(raw) <= LIMIT, "SIZE")
    require(type(expected_old) is str and HEX.fullmatch(expected_old)
            and digest(raw) == expected_old, "OLD_HASH")
    require(all(b >= 32 or b in (9, 10, 13) for b in raw), "FORMAT")
    try:
        raw.decode("utf-8", "strict")
    except UnicodeError:
        raise Block("FORMAT") from None
    section, offset, targets = None, 0, []
    for line in raw.splitlines(keepends=True):
        body = line[:-2] if line.endswith(b"\r\n") else line[:-1] if line.endswith(b"\n") else line
        require(b"\r" not in body, "FORMAT")
        stripped = body.strip(b" \t")
        # Comments ending in backslash can participate in continuations.
        require(not stripped.endswith(b"\\"), "FORMAT")
        if not stripped or stripped.startswith((b"#", b";")):
            offset += len(line)
            continue
        header = re.fullmatch(rb"\[([A-Za-z]+)\]", stripped)
        if header:
            section = header[1]
        else:
            require(b"=" in body, "FORMAT")
            left, right = body.split(b"=", 1)
            key = left.strip(b" \t")
            require(re.fullmatch(rb"[A-Za-z][A-Za-z0-9]*", key), "FORMAT")
            if key == b"EnvironmentFile":
                require(section == b"Service", "DIRECTIVES")
                start = offset + len(left) + 1 + len(right) - len(right.lstrip(b" \t"))
                targets.append((start, right.strip(b" \t")))
        offset += len(line)
    require(len(targets) == 1, "DIRECTIVES")
    index, value = targets[0]
    require(value in (ENV.encode(), b"-" + ENV.encode()), "VALUE")
    changed = value.startswith(b"-")
    output = raw[:index] + raw[index + 1:] if changed else raw
    require(not changed or (raw[index:index + 1] == b"-" and len(output) == len(raw) - 1), "VALUE")
    return {"output": output, "beforeSha256": digest(raw), "afterSha256": digest(output),
            "unitBytes": len(raw), "removedBytes": int(changed),
            "removedByteOffset": index if changed else None,
            "planState": "REMOVE_ONE_OPTIONAL_BYTE" if changed else "ALREADY_MANDATORY_ON_DISK"}


def open_parent(path):
    """Open a fixed absolute directory chain without following symlinks."""
    parts = PurePosixPath(path).parts
    require(parts and parts[0] == "/" and ".." not in parts, "PATH")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            s = os.fstat(fd)
            require(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022, "METADATA")
        return fd
    except BaseException:
        os.close(fd)
        raise


def signature(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def read_regular(parent_fd, name, *, limit=LIMIT, private=False):
    """One bounded regular file through a trusted directory fd; never raw output."""
    require(type(name) is str and name not in ("", ".", "..") and "/" not in name, "PATH")
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
    try:
        before = os.fstat(fd)
        mode = stat.S_IMODE(before.st_mode)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and before.st_uid == 0 and before.st_gid == 0
                and mode in ((0o600,) if private else (0o600, 0o640, 0o644)), "METADATA")
        require(0 < before.st_size <= limit, "SIZE")
        chunks, size = [], 0
        while size <= before.st_size:
            chunk = os.read(fd, min(8192, before.st_size + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        raw = b"".join(chunks)
        require(len(raw) == before.st_size, "READ_RACE")
        names = os.listxattr(fd)
        require(len(names) <= 32, "METADATA")
        attrs = {name: os.getxattr(fd, name) for name in names}
        require(sum(len(v) for v in attrs.values()) <= LIMIT, "METADATA")
        after = os.fstat(fd)
        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        require(signature(before) == signature(after) == signature(current), "READ_RACE")
        return raw, before, attrs
    finally:
        os.close(fd)


def strict_json(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("duplicate")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("constant")))


def validate_receipt(data, source_sha, run_id):
    require(type(source_sha) is str and SHA.fullmatch(source_sha)
            and type(run_id) is str and RUN.fullmatch(run_id), "ARGS")
    fixed = {"status": "C4_UNIT_OBSERVED", "incidentRun": INCIDENT,
             "sourceSha": source_sha, "runId": run_id,
             "beforeSha256": OLD_UNIT_SHA256, "rawUnitExported": False,
             "serverWrites": False, "replayAllowed": False,
             "historicalWrite": "UNKNOWN", "snapshot": "NON_ATOMIC_CURRENT_ONLY",
             "metadata": "ROOT_CONTROLLED_SINGLE_LINK", "process": "STABLE_ACROSS_TWO_READS"}
    extra = {"afterSha256", "unitBytes", "removedBytes", "planState", "environmentFiles", "needDaemonReload"}
    require(type(data) is dict and set(data) == set(fixed) | extra, "FORMAT")
    require(all(type(data[k]) is type(v) and data[k] == v for k, v in fixed.items()), "FORMAT")
    require(type(data["afterSha256"]) is str and HEX.fullmatch(data["afterSha256"]), "FORMAT")
    require(type(data["unitBytes"]) is int and 0 < data["unitBytes"] <= LIMIT, "SIZE")
    require(type(data["removedBytes"]) is int and data["removedBytes"] in (0, 1), "FORMAT")
    require(type(data["needDaemonReload"]) is str and data["needDaemonReload"] in ("yes", "no"), "FORMAT")
    require(type(data["environmentFiles"]) is str and data["environmentFiles"] in ("EXACT_EXPECTED_OPTIONAL", "EXACT_EXPECTED"), "FORMAT")
    if data["removedBytes"] == 1:
        require(data["planState"] == "REMOVE_ONE_OPTIONAL_BYTE" and data["afterSha256"] != OLD_UNIT_SHA256, "FORMAT")
    else:
        require(data["planState"] == "ALREADY_MANDATORY_ON_DISK" and data["afterSha256"] == OLD_UNIT_SHA256, "FORMAT")
    return data
