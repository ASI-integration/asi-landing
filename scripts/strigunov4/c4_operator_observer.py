"""Fixed incident observer: no mutation, restart, SQL, login or claim creation."""
import hashlib
import errno
import json
import os
import re
import stat
import time
from pathlib import Path

import c4_operator_host as host
from c4_operator_patch import Block, KEYS, OPERATOR, plan, require

FAILED_RUN = "39145734946"
FAILED_SHA = "c3d02873c4810e4d2f585292db80b1a9ef9c04a6"
FIELDS = ("claim", "backup", "prepared", "success", "recovery")
MARKER_STATES = frozenset(("NOT_OBSERVED", "ABSENT", "PRESENT", "INVALID", "BOUND_TO_FAILED_RUN", "OTHER_BINDING", "RECORDED_SUCCESS", "RECORDED_ROLLBACK", "RECORDED_BEFORE_APPLY"))
FIELD_STATES = {
    "claim": {"NOT_OBSERVED", "ABSENT", "PRESENT", "INVALID"},
    "backup": {"NOT_OBSERVED", "ABSENT", "PRESENT", "INVALID"},
    "prepared": {"NOT_OBSERVED", "ABSENT", "INVALID", "BOUND_TO_FAILED_RUN", "OTHER_BINDING"},
    "success": {"NOT_OBSERVED", "ABSENT", "INVALID", "RECORDED_SUCCESS"},
    "recovery": {"NOT_OBSERVED", "ABSENT", "INVALID", "RECORDED_ROLLBACK", "RECORDED_BEFORE_APPLY"},
}
LOCK_STATES = frozenset(("NOT_OBSERVED", "ABSENT", "INVALID", "UNKNOWN", "HELD",
                         "VALID_METADATA_NO_HOLDER_OBSERVED"))
LOCKS_LIMIT = 262144



def strict_json(raw):
    """Reject duplicate JSON keys rather than accepting an ambiguous marker."""
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError("DUPLICATE_JSON_KEY")
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=unique)


def safe_directory(path=None, *, name=None, parent=None):
    """Open an existing root-private directory without following a symlink."""
    fd = os.open(str(path) if path is not None else name,
                 os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        info = os.fstat(fd)
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
                and stat.S_IMODE(info.st_mode) == 0o700, "EVIDENCE")
        return fd
    except BaseException:
        os.close(fd)
        raise


def marker(fd, name, kind):
    """Read only fixed, bounded JSON markers; never read the private env backup."""
    try:
        child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except FileNotFoundError:
        return "ABSENT"
    try:
        before = os.fstat(child)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0
                or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != 1):
            return "INVALID"
        if kind == "backup":
            return "PRESENT" if 0 < before.st_size <= 131072 else "INVALID"
        if not 0 < before.st_size <= 4096:
            return "INVALID"
        raw = os.read(child, 4097)
        after = os.fstat(child)
        if len(raw) != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            return "INVALID"
        data = strict_json(raw)
        if type(data) is not dict:
            return "INVALID"
        if kind == "prepared":
            if (set(data) != {"runId", "sourceSha", "status", "changedLists"}
                    or data.get("status") != "PREPARED" or type(data.get("changedLists")) is not int
                    or data["changedLists"] not in (1, 2)
                    or type(data.get("runId")) is not str or not host.io.ID_RE.fullmatch(data["runId"])
                    or type(data.get("sourceSha")) is not str or not host.io.SHA_RE.fullmatch(data["sourceSha"])):
                return "INVALID"
            return "BOUND_TO_FAILED_RUN" if data.get("runId") == FAILED_RUN and data.get("sourceSha") == FAILED_SHA else "OTHER_BINDING"
        if kind == "success":
            exact = (data == host.SUCCESS and
                     all(type(data[k]) is type(v) for k, v in host.SUCCESS.items()))
            return "RECORDED_SUCCESS" if exact else "INVALID"
        if data == {"status": "ROLLBACK_PASS"}:
            return "RECORDED_ROLLBACK"
        if data == {"status": "BLOCK_BEFORE_APPLY"}:
            return "RECORDED_BEFORE_APPLY"
        return "INVALID"
    except (ValueError, UnicodeError, OSError):
        return "INVALID"
    finally:
        os.close(child)


def lock_records(raw, info):
    """Classify a bounded current PID-namespace snapshot, never lock availability."""
    if len(raw) > LOCKS_LIMIT or (raw and not raw.endswith(b"\n")):
        return "UNKNOWN"
    held, uncertain = False, False
    for line in raw.decode("ascii", "strict").splitlines():
        fields = line.split()
        waiting = len(fields) > 1 and fields[1] == "->"
        if waiting:
            del fields[1]
        # Reject truncated, unfamiliar or malformed records, even for another
        # inode: silently dropping one must not manufacture a no-holder result.
        if (len(line) > 512 or len(fields) != 8
                or not re.fullmatch(r"[0-9]+:", fields[0])
                or fields[1] not in {"FLOCK", "POSIX", "OFDLCK", "LEASE"}
                or fields[2] not in {"ADVISORY", "MANDATORY", "ACTIVE", "BREAKING"}
                or fields[3] not in {"READ", "WRITE", "UNLCK"}
                or not re.fullmatch(r"-?[0-9]+", fields[4])
                or not re.fullmatch(r"[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9]+", fields[5])
                or not re.fullmatch(r"[0-9]+", fields[6])
                or not re.fullmatch(r"(?:[0-9]+|EOF)", fields[7])):
            return "UNKNOWN"
        kinds = {"FLOCK": {"ADVISORY"}, "POSIX": {"ADVISORY", "MANDATORY"},
                 "OFDLCK": {"ADVISORY"}, "LEASE": {"ACTIVE", "BREAKING"}}
        if (fields[2] not in kinds[fields[1]]
                or (fields[3] == "UNLCK" and fields[1] != "LEASE")
                or (int(fields[4]) != -1 if fields[1] == "OFDLCK" else int(fields[4]) <= 0)
                or (fields[7] != "EOF" and int(fields[6]) > int(fields[7]))
                or (fields[1] in {"FLOCK", "LEASE"} and fields[6:] != ["0", "EOF"])):
            return "UNKNOWN"
        major, minor, inode = fields[5].split(":")
        if (int(major, 16), int(minor, 16), int(inode)) != (
                os.major(info.st_dev), os.minor(info.st_dev), info.st_ino):
            continue
        if (fields[1:3] == ["FLOCK", "ADVISORY"] and fields[3] in {"READ", "WRITE"}
                and fields[6:] == ["0", "EOF"] and not waiting):
            held = True
        else:
            uncertain = True
    # Other lock classes/waiters on this inode may have filesystem-specific
    # interactions. We neither acquire flock nor infer future availability.
    return "HELD" if held else "UNKNOWN" if uncertain else "VALID_METADATA_NO_HOLDER_OBSERVED"


def lock_identity(info):
    """Compare the opened inode with the fixed pathname before reporting it."""
    return tuple(getattr(info, name) for name in (
        "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
        "st_size", "st_mtime_ns", "st_ctime_ns"))


def lock_snapshot(root):
    """Inspect the existing lock only; never create, write, read contents or flock."""
    try:
        child = os.open("active.lock", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                        dir_fd=root)
    except FileNotFoundError:
        return "ABSENT"
    except OSError as error:
        return "INVALID" if error.errno == errno.ELOOP else "UNKNOWN"
    result = "UNKNOWN"
    try:
        info = os.fstat(child)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            result = "INVALID"
        else:
            # No PID, path, lock contents or unrelated record leaves this worker.
            with open("/proc/locks", "rb") as stream:
                raw = stream.read(LOCKS_LIMIT + 1)
            result = lock_records(raw, info)
            after = os.fstat(child)
            named = os.stat("active.lock", dir_fd=root, follow_symlinks=False)
            if lock_identity(info) != lock_identity(after) or lock_identity(info) != lock_identity(named):
                result = "UNKNOWN"
    except (OSError, ValueError, UnicodeError):
        result = "UNKNOWN"
    finally:
        try:
            os.close(child)
        except OSError:
            # Do not retry close (the fd may have been released and reused).
            result = "UNKNOWN"
    return result


def claim_snapshot():
    """Observe only the fixed claim; absence never authorizes another attempt."""
    out = dict.fromkeys(FIELDS, "NOT_OBSERVED")
    out["lock"] = "NOT_OBSERVED"
    try:
        root = safe_directory(host.EVIDENCE)
    except FileNotFoundError:
        out["claim"] = "ABSENT"
        out["lock"] = "ABSENT"
        return out
    except (OSError, Block):
        out["claim"] = "INVALID"
        return out
    try:
        out["lock"] = lock_snapshot(root)
        try:
            record = safe_directory(name=host.CLAIM, parent=root)
        except FileNotFoundError:
            out["claim"] = "ABSENT"
            return out
        except (OSError, Block):
            out["claim"] = "INVALID"
            return out
        try:
            out["claim"] = "PRESENT"
            for field, name in (("backup", "original.env.private"), ("prepared", "prepared.json"), ("success", "success.json"), ("recovery", "recovery.json")):
                try:
                    out[field] = marker(record, name, field)
                except OSError:
                    out[field] = "INVALID"
        finally:
            os.close(record)
    finally:
        os.close(root)
    return out


def identity():
    """Refuse any other host, path or unit before reading private incident evidence."""
    io = host.io
    require(os.geteuid() == 0 and os.uname().nodename == io.HOST, "HOST")
    for path in (io.ROOT, io.ENV.parent):
        require(path.is_dir() and not path.is_symlink(), "PARENT_IDENTITY")
    unit = Path("/etc/systemd/system/asi-landing-staging.service")
    require(not unit.is_symlink() and unit.is_file()
            and hashlib.sha256(unit.read_bytes()).hexdigest() == io.UNIT_HASH, "UNIT")


def observe():
    """Return current checks independently, not a historical write-outcome claim."""
    identity()
    deadline = time.monotonic() + 60
    out = {"status": "C4_OPERATOR_OBSERVED", "incidentRun": FAILED_RUN,
           "snapshot": "NON_ATOMIC_CURRENT_ONLY", "historicalWrite": "UNKNOWN",
           "replayAllowed": False, "databaseState": "NOT_OBSERVED",
           "environmentFiles": "NOT_OBSERVED", "live": "NOT_OBSERVED",
           "envPlan": "NOT_OBSERVED", "membership": "NOT_OBSERVED"}
    out.update(claim_snapshot())
    try:
        value = host.io.props(deadline).get("EnvironmentFiles", "")
        expected = str(host.io.ENV)
        out["environmentFiles"] = ("EXACT_EXPECTED" if value == expected + " (ignore_errors=no)"
                                   else "EXACT_EXPECTED_OPTIONAL" if value == expected + " (ignore_errors=yes)"
                                   else "EXPECTED_PATH_ONLY" if value == expected
                                   else "EXPECTED_PATH_OTHER_FORMAT" if expected in value else "OTHER")
    except BaseException as error:
        out["environmentFiles"] = host.failure_code(error)
    observed = None
    try:
        observed = host.live(None, deadline)
        out["live"] = "PASS"
    except BaseException as error:
        out["live"] = host.failure_code(error)
    try:
        raw, _ = host.io.read_env()
        proposal = plan(raw)
        out["envPlan"] = "CHANGE_NEEDED" if proposal["changed"] else "ALREADY_CONFIGURED"
        if observed is not None:
            out["membership"] = ("PROCESS_FILE_MISMATCH" if observed != proposal["before"] else
                                 "FIXED_OPERATOR_PRESENT" if all(OPERATOR in observed[k] for k in KEYS)
                                 else "FIXED_OPERATOR_MISSING")
    except BaseException as error:
        out["envPlan"] = host.failure_code(error)
    return out


def main():
    """Never expose raw exceptions or accept command-line target overrides."""
    try:
        import sys
        require(len(sys.argv) == 3 and host.io.ID_RE.fullmatch(sys.argv[1])
                and host.io.SHA_RE.fullmatch(sys.argv[2]), "ARGS")
        result = observe()
    except BaseException as error:
        result = {"status": host.failure_code(error)}
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("status") == "C4_OPERATOR_OBSERVED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
