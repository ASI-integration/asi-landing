"""One-time, staged, root-owned no-send guard and restart for old staging.

This file is NOT an independent authority. It may run only through the
main-only, owner-reviewed GitHub staging environment workflow. All paths and
expected service identity are constants; no user-controlled target paths.
No SQL, archive extraction, external provider calls or production operations.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

from staging_no_send_patch import plan, Block

ROOT = Path("/var/www/asi-staging")
ENV = ROOT / "shared/.env.staging.local"
CURRENT = ROOT / "current"
SERVICE = "asi-landing-staging"
HOST = "asi-agent-runner"
OLD = "5c91b27bcde395f01cc078d1fbe454dd7436e1c6"
UNIT_HASH = "9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9"
EXPECTED = {
    "EMAIL_AUTO_SEND": "false",
    "EMAIL_DRAFT_ONLY": "true",
    "DRY_RUN_TELEGRAM_OUTBOUND": "true",
    "ALLOW_REAL_TELEGRAM_SYNTHETIC": "false",
    "YOOKASSA_ENABLED": "false",
    "ASI_APP_ROOT": "/var/www/asi-staging/current",
}
TARGET = "ASI_SYNTHETIC_NO_SEND"
EVIDENCE_ROOT = Path("/root/.asi-strigunov4-nosend")
SHA_RE = re.compile(r"[a-f0-9]{40}\Z")
ID_RE = re.compile(r"[1-9][0-9]{0,19}\Z")


def require(ok, code):
    if not ok:
        raise Block(code)


def checked(*args, timeout=20):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Block("COMMAND_UNAVAILABLE") from None
    require(result.returncode == 0, "COMMAND_FAILED")
    return result.stdout


def props():
    raw = checked("systemctl", "show", SERVICE,
                  "--property=MainPID,User,Group,WorkingDirectory,EnvironmentFiles,DropInPaths,ActiveState")
    return dict(line.split("=", 1) for line in raw.decode().splitlines() if "=" in line)


def process_flags(pid, with_new_flag):
    require(pid.isdecimal() and int(pid) > 1, "INVALID_PROCESS_ID")
    path = Path("/proc") / pid / "environ"
    pairs = path.read_bytes().split(b"\0")
    observed = dict((k.decode(), v) for x in pairs if b"=" in x for k, v in (x.split(b"=", 1),))
    want = dict(EXPECTED)
    if with_new_flag:
        want[TARGET] = "YES"
    for key, value in want.items():
        require(observed.get(key) == value.encode(), "EFFECTIVE_NO_SEND_BLOCK")
    if not with_new_flag:
        require(TARGET not in observed, "UNEXPECTED_FLAG_BASELINE")


def live_status(with_new_flag):
    require(os.geteuid() == 0 and os.uname().nodename == HOST, "TARGET_HOST_AND_UID")
    unit = Path("/etc/systemd/system/asi-landing-staging.service")
    require(hashlib.sha256(unit.read_bytes()).hexdigest() == UNIT_HASH, "SYSTEMD_UNIT_DRIFT")
    p = props()
    require(p.get("ActiveState") == "active"
            and p.get("User") == "asi-runtime" and p.get("Group") == "asi-runtime"
            and p.get("WorkingDirectory") == str(CURRENT)
            and not p.get("DropInPaths")
            and str(ENV) in p.get("EnvironmentFiles", ""), "SYSTEMD_IDENTITY")
    require(CURRENT.is_symlink() and CURRENT.resolve() == ROOT / "releases" / OLD,
            "STAGING_RELEASE_DRIFT")
    for kind in ("health", "version"):
        with urllib.request.urlopen("http://127.0.0.1:3001/api/" + kind, timeout=5) as reply:
            require(reply.status == 200, "HTTP_STATUS")
            raw = reply.read(65537)
            require(len(raw) <= 65536, "HTTP_OVERSIZE")
            result = json.loads(raw)
            require((result.get("ok") is True if kind == "health" else
                     result.get("sha") == OLD), "HTTP_RESULT")
    process_flags(p.get("MainPID", ""), with_new_flag)


def read_env():
    require(not ENV.is_symlink(), "ENV_SYMLINK")
    fd = os.open(ENV, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o640
                and info.st_uid == 1001 and info.st_gid == 1000, "ENV_IDENTITY")
        require(0 < info.st_size <= 131072, "ENV_SIZE")
        content = os.read(fd, info.st_size + 1)
        require(len(content) == info.st_size, "ENV_READ_RACE")
        return content, info
    finally:
        os.close(fd)


def write_private(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                 | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb", closefd=False) as dest:
            dest.write(content)
            dest.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def atomic_env(content, orig, expected_old_bytes):
    fd, name = tempfile.mkstemp(prefix=".strigunov4-nosend-", dir=str(ENV.parent))
    try:
        os.fchmod(fd, 0o640)
        os.fchown(fd, orig.st_uid, orig.st_gid)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(content)
            stream.flush()
            os.fsync(fd)
        os.close(fd)
        fd = -1
        # Verify the file was not changed between read and replacement.
        latest, latest_info = read_env()
        require(latest_info.st_ino == orig.st_ino and latest_info.st_size == orig.st_size
                and hashlib.sha256(latest).digest() == hashlib.sha256(expected_old_bytes).digest(),
                "ENV_CONCURRENT_MODIFICATION")
        os.replace(name, ENV)
        name = None
        directory = os.open(str(ENV.parent), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if fd >= 0:
            os.close(fd)
        if name:
            os.unlink(name)


def verified_restart(expect_new):
    checked("systemctl", "restart", SERVICE, timeout=50)
    for attempt in range(40):
        try:
            live_status(expect_new)
            return
        except (Block, OSError, ValueError, json.JSONDecodeError):
            time.sleep(1)
    raise Block("EFFECTIVE_PROCESS_VERIFICATION_FAILED")


def perform(run_id, source_sha):
    require(ID_RE.fullmatch(run_id) is not None
            and SHA_RE.fullmatch(source_sha) is not None, "RUN_BINDING")
    # The protected main-only GitHub Actions environment approved the workflow.
    # These identifiers are for replay journaling, not an attestation themselves.
    live_status(False)
    original, metadata = read_env()
    result = plan(original)
    require(result["changed"], "FLAG_ALREADY_PRESENT_OR_NOT_EXPECTED")
    os.umask(0o077)
    if EVIDENCE_ROOT.exists():
        require(not EVIDENCE_ROOT.is_symlink() and EVIDENCE_ROOT.is_dir()
                and stat.S_IMODE(EVIDENCE_ROOT.stat().st_mode) == 0o700
                and EVIDENCE_ROOT.stat().st_uid == 0, "EVIDENCE_ROOT")
    else:
        EVIDENCE_ROOT.mkdir(mode=0o700)
    record = EVIDENCE_ROOT / ("run-" + run_id + "-" + source_sha)
    record.mkdir(mode=0o700)  # EEXIST deliberately blocks replays
    backup = record / "original.env.private"
    write_private(backup, original)
    changed = False
    try:
        changed = True
        atomic_env(result["output"], metadata, original)
        after, meta_after = read_env()
        require(after == result["output"]
                and meta_after.st_uid == metadata.st_uid
                and meta_after.st_gid == metadata.st_gid, "POSTWRITE_ENV_FILE")
        verified_restart(True)
        evidence = {"status":"NO_SEND_EFFECTIVE_PASS", "sourceSha":source_sha,
                    "runId":run_id, "beforeSha256":result["input_sha256"],
                    "afterSha256":result["output_sha256"], "effectiveFlags":7,
                    "databaseChanged":False, "releaseSwitched":False}
        write_private(record / "result.json", json.dumps(evidence, sort_keys=True).encode())
        return {"status":"NO_SEND_EFFECTIVE_PASS","effectiveFlags":7,
                "databaseChanged":False, "releaseSwitched":False}
    except (OSError, Block, ValueError, subprocess.TimeoutExpired):
        if changed:
            try:
                current_bytes, current_meta = read_env()
                if current_bytes == original:
                    live_status(False)
                    return {"status":"BLOCK_BEFORE_ACTIVATION"}
                require(current_bytes == result["output"], "UNKNOWN_CONCURRENT_ENV_CHANGE")
                atomic_env(original, current_meta, result["output"])
                verified_restart(False)
                return {"status":"ROLLBACK_PASS_NO_SEND_NOT_ACTIVATED"}
            except Exception:
                return {"status":"BLOCK_MANUAL_RECOVERY_REQUIRED"}
        return {"status":"BLOCK_BEFORE_ACTIVATION"}


def run_locked(run_id, source_sha):
    """Serialize owner-approved config changes and reject concurrent attempts."""
    import fcntl  # Linux staging only, never imported for Windows tests
    require(ID_RE.fullmatch(run_id) is not None
            and SHA_RE.fullmatch(source_sha) is not None, "RUN_BINDING")
    os.umask(0o077)
    if EVIDENCE_ROOT.exists():
        require(not EVIDENCE_ROOT.is_symlink() and EVIDENCE_ROOT.is_dir()
                and stat.S_IMODE(EVIDENCE_ROOT.stat().st_mode) == 0o700
                and EVIDENCE_ROOT.stat().st_uid == 0, "EVIDENCE_ROOT")
    else:
        EVIDENCE_ROOT.mkdir(mode=0o700)
    lock = EVIDENCE_ROOT / "active.lock"
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == 0
                and stat.S_IMODE(s.st_mode) == 0o600, "LOCK_FILE")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Block("ANOTHER_STAGING_CONFIG_ACTION") from None
        return perform(run_id, source_sha)
    finally:
        os.close(fd)


def main():
    try:
        require(len(sys.argv) == 3, "ARGS")
        report = run_locked(sys.argv[1], sys.argv[2])
        print(json.dumps(report, sort_keys=True))
        return 0 if report.get("status") == "NO_SEND_EFFECTIVE_PASS" else 2
    except (Block, OSError, ValueError):
        print('{"status":"BLOCK","releaseSwitched":false,"databaseChanged":false}')
        return 2


if __name__ == "__main__":
    sys.exit(main())
