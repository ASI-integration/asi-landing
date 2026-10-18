"""One separately authorized staging configuration change, never a booking."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

import staging_no_send_host as io
from c4_operator_patch import Block, KEYS, SAFETY, OPERATOR, members, plan, require

G0 = "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
EVIDENCE = Path("/root/.asi-strigunov4-operator")
CLAIM = "incident-39140030546"
SUCCESS = {"status": "C4_OPERATOR_CONFIG_PASS", "effectiveLists": 2,
           "effectiveFlags": 7, "releaseSwitched": False,
           "databaseClientInvoked": False, "databaseState": "NOT_OBSERVED",
           "humanUI": "NOT_PROVEN"}
BLOCKS = frozenset(("BLOCK", "BLOCK_BEFORE_APPLY", "ROLLBACK_PASS",
                    "BLOCK_MANUAL_RECOVERY_REQUIRED"))


# Only these source-owned labels may cross the SSH/log boundary. Never str(exc).
REASONS = frozenset((
    "ARGS RUN_BINDING HOST PARENT_IDENTITY UNIT SERVICE_IDENTITY ENVIRONMENT_FILES "
    "RELEASE PID DUPLICATE_EFFECTIVE_KEY EFFECTIVE_NO_SEND EFFECTIVE_MEMBERSHIP "
    "HEALTH_HTTP HEALTH_SIZE HEALTH_JSON HEALTH VERSION PID_CHANGED ALREADY_CONFIGURED "
    "CLAIM_EXISTS EVIDENCE LOCK ENV_SYMLINK ENV_IDENTITY ENV_SIZE ENV_READ_RACE "
    "ENV_FORMAT ENV_ENCODING ENV_CONTROL ENV_LINES ENV_ASSIGNMENT ENV_ESCAPE ENV_QUOTING "
    "DUPLICATE_TARGET_OR_SAFETY FILE_NO_SEND MEMBERSHIP_DELTA ALLOWLIST_SIZE "
    "ALLOWLIST_FORMAT COMMAND_UNAVAILABLE COMMAND_FAILED WORKER_DEADLINE_EXCEEDED"
).split())


def failure_code(error):
    """Return a bounded label; hostile messages and exception classes stay private."""
    if type(error) is Block and len(error.args) == 1 and type(error.args[0]) is str:
        if error.args[0] in REASONS:
            return "BLOCK_REASON_" + error.args[0]
    return "BLOCK_REASON_UNKNOWN"


BLOCKS = BLOCKS | {"BLOCK_REASON_" + code for code in REASONS} | {"BLOCK_REASON_UNKNOWN"}


def live(expected_members=None, deadline=None):
    """Pin the existing G0 process and only GET loopback health/version."""
    io.remaining(deadline)
    require(os.geteuid() == 0 and os.uname().nodename == io.HOST, "HOST")
    for path in (io.ROOT, io.ENV.parent):
        require(path.is_dir() and not path.is_symlink(), "PARENT_IDENTITY")
    unit = Path("/etc/systemd/system/asi-landing-staging.service")
    require(not unit.is_symlink() and unit.is_file()
            and hashlib.sha256(unit.read_bytes()).hexdigest() == io.UNIT_HASH, "UNIT")
    meta = io.props(deadline)
    require(meta.get("ActiveState") == "active"
            and meta.get("User") == meta.get("Group") == "asi-runtime"
            and meta.get("WorkingDirectory") == str(io.CURRENT)
            and not meta.get("DropInPaths"),
            "SERVICE_IDENTITY")
    require(meta.get("EnvironmentFiles") == str(io.ENV) + " (ignore_errors=no)",
            "ENVIRONMENT_FILES")
    require(io.CURRENT.is_symlink()
            and io.CURRENT.resolve() == io.ROOT / "releases" / G0, "RELEASE")
    pid = meta.get("MainPID", "")
    require(pid.isdecimal() and int(pid) > 1, "PID")
    pairs = (Path("/proc") / pid / "environ").read_bytes().split(b"\0")
    settings = {}
    for pair in pairs:
        if b"=" not in pair:
            continue
        key, value = pair.split(b"=", 1)
        key = key.decode("utf-8", "strict")
        if key in (*KEYS, *SAFETY):
            require(key not in settings, "DUPLICATE_EFFECTIVE_KEY")
            settings[key] = value.decode("utf-8", "strict")
    require(all(settings.get(k) == v for k, v in SAFETY.items()), "EFFECTIVE_NO_SEND")
    observed = {k: {x.lower() for x in members(settings.get(k, ""))} for k in KEYS}
    if expected_members is not None:
        require(observed == expected_members, "EFFECTIVE_MEMBERSHIP")
    for endpoint in ("health", "version"):
        connection = http.client.HTTPConnection("127.0.0.1", 3001,
                                               timeout=min(5, io.remaining(deadline)))
        try:
            connection.request("GET", "/api/" + endpoint)
            reply = connection.getresponse()
            require(reply.status == 200, "HEALTH_HTTP")
            raw = reply.read(65537)
            require(len(raw) <= 65536, "HEALTH_SIZE")
            data = json.loads(raw)
            require(type(data) is dict, "HEALTH_JSON")
            if endpoint == "health":
                require(data.get("ok") is True, "HEALTH")
            else:
                require(data.get("sha") == G0 and data.get("environment") == "staging"
                        and data.get("resolvedReleasePath") == str(io.ROOT / "releases" / G0),
                        "VERSION")
        finally:
            connection.close()
    require(io.props(deadline).get("MainPID") == pid, "PID_CHANGED")
    io.remaining(deadline)
    return observed


def restart(expected, deadline):
    io.checked("systemctl", "restart", io.SERVICE, timeout=50, deadline=deadline)
    while time.monotonic() < deadline:
        try:
            live(expected, deadline)
            return
        except (Block, OSError, ValueError, http.client.HTTPException):
            budget = deadline - time.monotonic()
            if budget > 0.05:
                time.sleep(min(1, budget))
    raise Block("POST_RESTART_UNPROVEN")


def sync_directory(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def journal(record, name, status):
    io.write_private(record / name, json.dumps(status, sort_keys=True).encode("utf-8"))
    sync_directory(record)


def perform(run_id, sha):
    """Consume the fixed operation claim before any possible env replacement."""
    require(io.ID_RE.fullmatch(run_id) and io.SHA_RE.fullmatch(sha), "RUN_BINDING")
    hard = time.monotonic() + io.WORKER_LIMIT_SECONDS
    activation = hard - io.ROLLBACK_RESERVE_SECONDS
    live(None, activation)
    original, metadata = io.read_env()
    proposal = plan(original)
    live(proposal["before"], activation)
    require(proposal["changed"], "ALREADY_CONFIGURED")
    # A fixed incident claim blocks a second invocation even with another run ID
    # or another main SHA. A crash leaves backup + claim for separate recovery.
    record = EVIDENCE / CLAIM
    try:
        record.mkdir(mode=0o700)
    except FileExistsError:
        raise Block("CLAIM_EXISTS") from None
    sync_directory(EVIDENCE)
    io.write_private(record / "original.env.private", original)
    journal(record, "prepared.json", {"runId": run_id, "sourceSha": sha,
            "status": "PREPARED", "changedLists": proposal["changedLists"]})
    try:
        live(proposal["before"], activation)
        io.atomic_env(proposal["output"], metadata, original)
        current, _ = io.read_env()
        require(current == proposal["output"], "POSTWRITE_BYTES")
        restart(proposal["after"], activation)
        require(io.read_env()[0] == proposal["output"], "POSTRESTART_BYTES")
        io.remaining(activation)
        journal(record, "success.json", SUCCESS)
        return dict(SUCCESS)
    except BaseException:
        # Also recover from catchable interruption. SIGKILL/host loss leave the
        # durable claim and private original; no automatic replay is allowed.
        try:
            current, current_meta = io.read_env()
            if current == original:
                live(proposal["before"], hard)
                result = {"status": "BLOCK_BEFORE_APPLY"}
            else:
                require(current == proposal["output"], "CONCURRENT_CHANGE")
                io.atomic_env(original, current_meta, proposal["output"])
                restart(proposal["before"], hard)
                require(io.read_env()[0] == original, "ROLLBACK_BYTES")
                result = {"status": "ROLLBACK_PASS"}
            journal(record, "recovery.json", result)
            return result
        except BaseException:
            return {"status": "BLOCK_MANUAL_RECOVERY_REQUIRED"}


def run_locked(run_id, sha):
    """Hold a private, nonblocking Linux lock across preflight and recovery."""
    import fcntl
    require(io.ID_RE.fullmatch(run_id) and io.SHA_RE.fullmatch(sha), "RUN_BINDING")
    require(os.geteuid() == 0 and os.uname().nodename == io.HOST, "HOST")
    os.umask(0o077)
    if not EVIDENCE.exists():
        EVIDENCE.mkdir(mode=0o700)
        sync_directory(EVIDENCE.parent)
    info = EVIDENCE.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
            and stat.S_IMODE(info.st_mode) == 0o700, "EVIDENCE")
    fd = os.open(EVIDENCE / "active.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1, "LOCK")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return perform(run_id, sha)
    finally:
        os.close(fd)


def main():
    try:
        require(len(sys.argv) == 3, "ARGS")
        report = run_locked(sys.argv[1], sys.argv[2])
    except BaseException as error:
        report = {"status": failure_code(error)}
    print(json.dumps(report, sort_keys=True))
    return 0 if report == SUCCESS else 2


if __name__ == "__main__":
    sys.exit(main())
