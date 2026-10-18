"""Fixed incident observer: no mutation, restart, SQL, login or claim creation."""
import hashlib
import json
import os
import stat
import time
from pathlib import Path

import c4_operator_host as host
from c4_operator_patch import Block, KEYS, OPERATOR, plan, require

FAILED_RUN = "39145734946"
FAILED_SHA = "c3d02873c4810e4d2f585292db80b1a9ef9c04a6"
FIELDS = ("claim", "backup", "prepared", "success", "recovery")
MARKER_STATES = frozenset(("NOT_OBSERVED", "ABSENT", "PRESENT", "INVALID", "BOUND_TO_FAILED_RUN", "OTHER_BINDING", "RECORDED_SUCCESS", "RECORDED_ROLLBACK", "RECORDED_BEFORE_APPLY"))



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
                    or data["changedLists"] not in (1, 2)):
                return "INVALID"
            return "BOUND_TO_FAILED_RUN" if data.get("runId") == FAILED_RUN and data.get("sourceSha") == FAILED_SHA else "OTHER_BINDING"
        if kind == "success":
            return "RECORDED_SUCCESS" if data == host.SUCCESS else "INVALID"
        if data == {"status": "ROLLBACK_PASS"}:
            return "RECORDED_ROLLBACK"
        if data == {"status": "BLOCK_BEFORE_APPLY"}:
            return "RECORDED_BEFORE_APPLY"
        return "INVALID"
    except (ValueError, UnicodeError, OSError):
        return "INVALID"
    finally:
        os.close(child)


def claim_snapshot():
    """Observe only the fixed claim; absence never authorizes another attempt."""
    out = dict.fromkeys(FIELDS, "NOT_OBSERVED")
    try:
        root = safe_directory(host.EVIDENCE)
    except FileNotFoundError:
        out["claim"] = "ABSENT"
        return out
    except (OSError, Block):
        out["claim"] = "INVALID"
        return out
    try:
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
