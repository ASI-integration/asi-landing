"""OFFLINE CANDIDATE: durable file transition, never a server entry point.

No network/systemctl/SSH implementation is present. A future source-owned
adapter must bind fixed staging paths, all existing locks, exact receipt/pins,
fresh approval and a reviewed manager-wide reload policy. The read-only
workflow does not import or transmit this module.
"""
from contextlib import contextmanager
import base64
import fcntl
import json
import os
from pathlib import Path
import signal
import stat
import time
import uuid

import c4_unit_contract as c

LIMIT_SECONDS = 180
ROLLBACK_RESERVE = 90


class Interrupted(BaseException):
    pass


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def time_left(deadline, clock=time.monotonic):
    c.require(deadline - clock() > 0.05, "DEADLINE")
    return deadline - clock()


def private_dir(path):
    s = path.lstat()
    c.require(stat.S_ISDIR(s.st_mode) and s.st_uid == s.st_gid == 0
              and stat.S_IMODE(s.st_mode) == 0o700, "METADATA")
    return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)


def durable_new(fd, name, data):
    c.require(0 < len(data) <= 262144 and "/" not in name and name not in (".", ".."), "SIZE")
    f = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        os.fchmod(f, 0o600)
        view = memoryview(data)
        while view:
            count = os.write(f, view)
            c.require(count > 0, "READ_RACE")
            view = view[count:]
        os.fsync(f)
    finally:
        os.close(f)
    os.fsync(fd)


def read_private(fd, name):
    return c.read_regular(fd, name, private=True, limit=262144)[0]


def checked_lock(path):
    """Existing shared locks only: never truncate, replace or delete a lock."""
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        c.require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_uid == s.st_gid == 0
                  and stat.S_IMODE(s.st_mode) == 0o600, "METADATA")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def locks(paths):
    c.require(bool(paths) and len(paths) == len(set(paths)), "PATH")
    fds = []
    try:
        for path in sorted(paths):
            fds.append(checked_lock(path))
        yield
    finally:
        for fd in reversed(fds):
            os.close(fd)


@contextmanager
def catch_termination():
    previous = {}
    fired = False
    def stop(*_):
        nonlocal fired
        if not fired:
            fired = True
            raise Interrupted()
        # Recovery keeps the original hard deadline; another TERM cannot
        # interrupt a partially restored file a second time.
    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            previous[signum] = signal.signal(signum, stop)
        yield
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def metadata(s, attrs):
    return {"uid": s.st_uid, "gid": s.st_gid, "mode": stat.S_IMODE(s.st_mode),
            "atimeNs": s.st_atime_ns, "mtimeNs": s.st_mtime_ns,
            "xattrs": {k: base64.b64encode(v).decode("ascii") for k, v in attrs.items()}}


def same_metadata(s, attrs, expected):
    return (s.st_uid == expected["uid"] and s.st_gid == expected["gid"]
            and stat.S_IMODE(s.st_mode) == expected["mode"] and s.st_mtime_ns == expected["mtimeNs"]
            and attrs == {k: base64.b64decode(v, validate=True) for k, v in expected["xattrs"].items()})


def validate_metadata(meta):
    c.require(type(meta) is dict and set(meta) == {"uid", "gid", "mode", "atimeNs", "mtimeNs", "xattrs"}, "METADATA")
    c.require(type(meta["uid"]) is int and meta["uid"] == 0 and type(meta["gid"]) is int and meta["gid"] == 0
              and type(meta["mode"]) is int and meta["mode"] in (0o600, 0o640, 0o644), "METADATA")
    c.require(all(type(meta[k]) is int and 0 <= meta[k] < 2**63 for k in ("atimeNs", "mtimeNs")), "METADATA")
    c.require(type(meta["xattrs"]) is dict and len(meta["xattrs"]) <= 32, "METADATA")
    total = 0
    for key, value in meta["xattrs"].items():
        c.require(type(key) is str and 0 < len(key) <= 255 and "\0" not in key and type(value) is str, "METADATA")
        total += len(base64.b64decode(value, validate=True))
    c.require(total <= c.LIMIT, "METADATA")
    return meta


def create_candidate(parent_fd, data, meta):
    validate_metadata(meta)
    name = ".c4-unit-candidate-" + uuid.uuid4().hex
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
    try:
        os.fchown(fd, meta["uid"], meta["gid"])
        os.fchmod(fd, meta["mode"])
        target_attrs = {k: base64.b64decode(v, validate=True) for k, v in meta["xattrs"].items()}
        for key in os.listxattr(fd):
            if key not in target_attrs:
                os.removexattr(fd, key)
        for key, value in target_attrs.items():
            os.setxattr(fd, key, value)
        view = memoryview(data)
        while view:
            count = os.write(fd, view)
            c.require(count > 0, "READ_RACE")
            view = view[count:]
        os.utime(fd, ns=(meta["atimeNs"], meta["mtimeNs"]))
        os.fsync(fd)
        s = os.fstat(fd)
        attrs = {k: os.getxattr(fd, k) for k in os.listxattr(fd)}
        c.require(same_metadata(s, attrs, meta), "METADATA")
    finally:
        os.close(fd)
    os.fsync(parent_fd)
    return name, s


def replace_exact(parent_fd, leaf, expected, expected_sig, candidate, candidate_stat):
    current, info, _ = c.read_regular(parent_fd, leaf)
    c.require(current == expected and c.signature(info) == expected_sig, "READ_RACE")
    candidate_now = os.stat(candidate, dir_fd=parent_fd, follow_symlinks=False)
    c.require(c.signature(candidate_now) == c.signature(candidate_stat), "READ_RACE")
    os.replace(candidate, leaf, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
    os.fsync(parent_fd)


def validate_binding(binding, original):
    c.require(type(binding) is dict and set(binding) == {"sourceSha", "runId", "oldSha256", "newSha256"}, "ARGS")
    c.require(c.SHA.fullmatch(binding["sourceSha"]) and c.RUN.fullmatch(binding["runId"]), "ARGS")
    c.require(type(binding["newSha256"]) is str and c.HEX.fullmatch(binding["newSha256"]), "ARGS")
    proposal = c.plan(original, expected_old=binding["oldSha256"])
    c.require(proposal["removedBytes"] == 1 and proposal["afterSha256"] == binding["newSha256"], "VALUE")
    return proposal


def require_snapshot(value, expected_hash, expected_environment):
    """Only a reviewed adapter may produce this; a JSON input is not authority."""
    expected = {"unitSha256", "environmentFiles", "processToken", "otherStateToken", "noSend", "health"}
    c.require(type(value) is dict and set(value) == expected, "IDENTITY")
    c.require(value["unitSha256"] == expected_hash and value["environmentFiles"] == expected_environment
              and value["noSend"] is True and value["health"] is True, "IDENTITY")
    c.require(type(value["processToken"]) is str and c.HEX.fullmatch(value["processToken"])
              and type(value["otherStateToken"]) is str and c.HEX.fullmatch(value["otherStateToken"]), "IDENTITY")
    return value


def rollback(parent_fd, leaf, record_fd, original, output, meta, owned_inode, baseline,
             observe, reload_manager, isolation, hard_deadline, clock):
    time_left(hard_deadline, clock)
    current, info, _ = c.read_regular(parent_fd, leaf)
    if current != original:
        c.require(current == output and owned_inode == (info.st_dev, info.st_ino), "READ_RACE")
        name, temp_info = create_candidate(parent_fd, original, meta)
        durable_new(record_fd, "rollback-intent.json", json_bytes({"targetSha256": c.digest(original)}))
        replace_exact(parent_fd, leaf, output, c.signature(info), name, temp_info)
    time_left(hard_deadline, clock)
    # Reload outcome may be uncertain after interruption; recovery never assumes
    # the manager has the same state as the restored disk file.
    try:
        os.stat("reload-intent.json", dir_fd=record_fd, follow_symlinks=False)
        reload_possible = True
    except FileNotFoundError:
        reload_possible = False
    if reload_possible:
        isolation(hard_deadline)
        reload_manager(hard_deadline)
    state = require_snapshot(observe(hard_deadline), c.digest(original), "optional")
    c.require(state == baseline, "PROCESS_CHANGED")
    restored, restored_meta, attrs = c.read_regular(parent_fd, leaf)
    c.require(restored == original and same_metadata(restored_meta, attrs, meta), "METADATA")
    time_left(hard_deadline, clock)
    durable_new(record_fd, "recovery.json", json_bytes({"status": "ORIGINAL_BLOCKED_BASELINE_RESTORED"}))
    return "ORIGINAL_BLOCKED_BASELINE_RESTORED"


def apply(unit, record, lock_paths, binding, observe, reload_manager, isolation,
          hook=lambda _: None, clock=time.monotonic):
    """Local kernel test core; never called by a workflow or production adapter."""
    hard = clock() + LIMIT_SECONDS
    activation = hard - ROLLBACK_RESERVE
    unit, record = Path(unit), Path(record)
    c.require(unit.name == "asi-landing-staging.service", "PATH")
    # Tests provide private disposable anchors. Future host adapter MUST open
    # the fixed /etc/systemd/system chain through c.open_parent instead.
    parent_fd = private_dir(unit.parent)
    record_parent_fd = private_dir(record.parent)
    record_fd = None
    try:
        with locks(lock_paths), catch_termination():
            original, old_stat, attrs = c.read_regular(parent_fd, unit.name)
            proposal = validate_binding(binding, original)
            output = proposal["output"]
            baseline = require_snapshot(observe(activation), binding["oldSha256"], "optional")
            isolation(activation)  # MUST raise unless manager-wide reload is sealed.
            time_left(activation, clock)
            os.mkdir(record.name, 0o700, dir_fd=record_parent_fd)  # existing claim => no replay
            os.fsync(record_parent_fd)
            record_fd = private_dir(record)
            meta = metadata(old_stat, attrs)
            durable_new(record_fd, "original.unit.private", original)
            durable_new(record_fd, "metadata.private.json", json_bytes(meta))
            durable_new(record_fd, "prepared.json", json_bytes({"binding": binding, "baseline": baseline}))
            owned_inode = None
            try:
                hook("PREPARED")
                time_left(activation, clock)
                candidate, candidate_stat = create_candidate(parent_fd, output, meta)
                owned_inode = (candidate_stat.st_dev, candidate_stat.st_ino)
                durable_new(record_fd, "apply-intent.json", json_bytes({"ownedInode": owned_inode}))
                hook("APPLY_INTENT")
                replace_exact(parent_fd, unit.name, original, c.signature(old_stat), candidate, candidate_stat)
                hook("REPLACED")
                time_left(activation, clock)
                durable_new(record_fd, "reload-intent.json", json_bytes({"action": "daemon-reload", "restart": False}))
                isolation(activation)
                hook("RELOAD_INTENT")
                reload_manager(activation)
                hook("RELOADED")
                post = require_snapshot(observe(activation), binding["newSha256"], "mandatory")
                c.require(post["processToken"] == baseline["processToken"]
                          and post["otherStateToken"] == baseline["otherStateToken"], "PROCESS_CHANGED")
                raw, info, attributes = c.read_regular(parent_fd, unit.name)
                c.require(raw == output and (info.st_dev, info.st_ino) == owned_inode
                          and same_metadata(info, attributes, meta), "READ_RACE")
                hook("VERIFIED")
                time_left(activation, clock)
                durable_new(record_fd, "success.json", json_bytes({"status": "UNIT_CONTRACT_OBSERVED",
                             "binding": binding, "post": post, "operatorAdmission": "NOT_PROVEN"}))
                # No code may mutate host state after a success receipt.
                return "UNIT_CONTRACT_OBSERVED"
            except BaseException:
                try:
                    # If success finalization was uncertain, recovery evidence
                    # takes priority; a marker alone can never prove success.
                    durable_new(record_fd, "recovery-started.json", json_bytes({"status": "RECOVERY_STARTED"}))
                    return rollback(parent_fd, unit.name, record_fd, original, output, meta, owned_inode,
                                    baseline, observe, reload_manager, isolation, hard, clock)
                except BaseException:
                    try:
                        durable_new(record_fd, "manual-recovery.json", json_bytes({"status": "MANUAL_RECOVERY_REQUIRED"}))
                    except BaseException:
                        pass
                    return "MANUAL_RECOVERY_REQUIRED"
    finally:
        if record_fd is not None:
            os.close(record_fd)
        os.close(record_parent_fd)
        os.close(parent_fd)


def inspect_recovery(unit, record, binding):
    """Read-only classification after loss of process. Never resumes an apply."""
    unit, record = Path(unit), Path(record)
    pfd, rfd = None, None
    try:
        pfd, rfd = private_dir(unit.parent), private_dir(record)
        original = read_private(rfd, "original.unit.private")
        proposal = validate_binding(binding, original)
        prepared = c.strict_json(read_private(rfd, "prepared.json"))
        c.require(set(prepared) == {"binding", "baseline"} and prepared["binding"] == binding, "ARGS")
        raw, s, attrs = c.read_regular(pfd, unit.name)
        meta = validate_metadata(c.strict_json(read_private(rfd, "metadata.private.json")))
        c.require(same_metadata(s, attrs, meta), "METADATA")
        if raw not in (original, proposal["output"]):
            return "CONCURRENT_OR_UNKNOWN_BYTES_MANUAL_ONLY"
        # A byte classification is not a claim about manager/process/history.
        return "OLD_BYTES_REQUIRE_EXPLICIT_RECOVERY" if raw == original else "NEW_BYTES_REQUIRE_EXPLICIT_RECOVERY"
    except (ValueError, OSError, KeyError, TypeError):
        return "EVIDENCE_INCOMPLETE_MANUAL_ONLY"
    finally:
        if rfd is not None:
            os.close(rfd)
        if pfd is not None:
            os.close(pfd)


def recover_explicit(unit, record, lock_paths, binding, recovery_run, observe, reload_manager,
                     isolation, clock=time.monotonic):
    """Separate recovery candidate. No automatic call after a killed process.

    A future protected adapter must validate a NEW owner-approved recovery run
    and exact source before calling this. recovery_run is identity, not authority.
    """
    c.require(type(recovery_run) is str and c.RUN.fullmatch(recovery_run)
              and recovery_run != binding.get("runId"), "ARGS")
    unit, record = Path(unit), Path(record)
    pfd, rfd = None, None
    hard = clock() + ROLLBACK_RESERVE
    try:
        with locks(lock_paths), catch_termination():
            pfd, rfd = private_dir(unit.parent), private_dir(record)
            original = read_private(rfd, "original.unit.private")
            proposal = validate_binding(binding, original)
            prepared = c.strict_json(read_private(rfd, "prepared.json"))
            c.require(set(prepared) == {"binding", "baseline"} and prepared["binding"] == binding, "ARGS")
            baseline = require_snapshot(prepared["baseline"], binding["oldSha256"], "optional")
            meta = validate_metadata(c.strict_json(read_private(rfd, "metadata.private.json")))
            # A completed success is not an abandoned transaction.
            try:
                os.stat("success.json", dir_fd=rfd, follow_symlinks=False)
                os.stat("recovery-started.json", dir_fd=rfd, follow_symlinks=False)
            except FileNotFoundError:
                try:
                    os.stat("success.json", dir_fd=rfd, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise c.Block("IDENTITY") from None
            try:
                intent = c.strict_json(read_private(rfd, "apply-intent.json"))
                c.require(set(intent) == {"ownedInode"} and type(intent["ownedInode"]) is list
                          and len(intent["ownedInode"]) == 2
                          and all(type(x) is int and x > 0 for x in intent["ownedInode"]), "METADATA")
                owned_inode = tuple(intent["ownedInode"])
            except FileNotFoundError:
                owned_inode = None
            isolation(hard)
            time_left(hard, clock)
            durable_new(rfd, "explicit-recovery-request.json", json_bytes({"repairBinding": binding, "recoveryRun": recovery_run}))
            try:
                return rollback(pfd, unit.name, rfd, original, proposal["output"], meta, owned_inode,
                                baseline, observe, reload_manager, isolation, hard, clock)
            except BaseException:
                return "MANUAL_RECOVERY_REQUIRED"
    finally:
        if rfd is not None:
            os.close(rfd)
        if pfd is not None:
            os.close(pfd)


if __name__ == "__main__":
    raise SystemExit("OFFLINE_CANDIDATE_ONLY_NO_SERVER_AUTHORITY")
