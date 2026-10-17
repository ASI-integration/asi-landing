"""Protected staging-only G0 systemd activation worker (Linux).

The owner-reviewed main-only GitHub environment is the *external* authority.
This worker never modifies production, Sentinel, DB, payment/OTA settings,
or external communications. It is not independently invokable authorization.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.request

import g0_release_archive as archive_contract
import g0_safe_extract

ROOT = Path("/var/www/asi-staging")
RELEASES = ROOT / "releases"
CURRENT = ROOT / "current"
ENV = ROOT / "shared/.env.staging.local"
SERVICE = "asi-landing-staging"
OLD = "5c91b27bcde395f01cc078d1fbe454dd7436e1c6"
NEW = archive_contract.SHA
HOST = "asi-agent-runner"
UNIT_SHA = "9072dd1a276c7bea2bb7d17031a51b250177e28028c0a8a01d9"
QUARANTINE = Path("/home/project_ayfaar/.asi-strigunov4-g0-d912aec6-quarantine")
MANIFEST_SHA = "f903dbf3296f81e5fa02262d7342d32cbbeabc9b9eacfdf4df13b9da1ffcc5be"
STATE = Path("/root/.asi-strigunov4-g0-activation")
EXPECTED_ENV = {
    "EMAIL_AUTO_SEND": "false", "EMAIL_DRAFT_ONLY": "true",
    "DRY_RUN_TELEGRAM_OUTBOUND": "true",
    "ALLOW_REAL_TELEGRAM_SYNTHETIC": "false",
    "YOOKASSA_ENABLED": "false",
    "ASI_SYNTHETIC_NO_SEND": "YES",
    "ASI_APP_ROOT": "/var/www/asi-staging/current",
}


class Block(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise Block(reason)


def checked(*argv, timeout=35):
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Block("COMMAND_UNAVAILABLE") from None
    require(p.returncode == 0, "COMMAND_FAILED")
    return p.stdout


def json_http(name):
    with urllib.request.urlopen("http://127.0.0.1:3001/api/" + name,
                                timeout=5) as response:
        require(response.status == 200, "HTTP_STATUS")
        raw = response.read(65537)
        require(len(raw) <= 65536, "HTTP_OVERSIZE")
        return json.loads(raw)


def runtime(expected):
    require(os.geteuid() == 0 and os.uname().nodename == HOST, "HOST_IDENTITY")
    unit = Path("/etc/systemd/system/asi-landing-staging.service")
    require(hashlib.sha256(unit.read_bytes()).hexdigest() == UNIT_SHA, "UNIT_CHANGED")
    envstat = ENV.lstat()
    require(stat.S_ISREG(envstat.st_mode) and not ENV.is_symlink()
            and stat.S_IMODE(envstat.st_mode) == 0o640
            and envstat.st_uid == 1001 and envstat.st_gid == 1000,
            "STAGING_ENV_IDENTITY")
    props = dict(x.split("=", 1) for x in checked(
        "systemctl", "show", SERVICE,
        "--property=User,Group,WorkingDirectory,EnvironmentFiles,DropInPaths,MainPID,ActiveState"
    ).decode().splitlines() if "=" in x)
    require(props.get("User") == "asi-runtime"
            and props.get("Group") == "asi-runtime"
            and props.get("WorkingDirectory") == str(CURRENT)
            and props.get("DropInPaths") == ""
            and str(ENV) in props.get("EnvironmentFiles", "")
            and props.get("ActiveState") == "active", "SYSTEMD_IDENTITY")
    require(CURRENT.is_symlink() and CURRENT.resolve() == RELEASES / expected,
            "RELEASE_SYMLINK_DRIFT")
    pid = props.get("MainPID", "")
    require(pid.isdecimal() and int(pid) > 1, "MAINPID")
    environ = (Path("/proc") / pid / "environ").read_bytes()
    actual = dict(x.split(b"=", 1) for x in environ.split(b"\0") if b"=" in x)
    require(all(actual.get(k.encode()) == v.encode() for k, v in EXPECTED_ENV.items()),
            "NO_SEND_EFFECTIVE_BLOCK")
    require(json_http("health").get("ok") is True
            and json_http("version").get("sha") == expected,
            "HEALTH_OR_VERSION")
    bound = checked("ss", "-ltnH", "sport", "=", ":3001").decode().splitlines()
    require(len(bound) == 1 and bound[0].split()[3] == "127.0.0.1:3001",
            "STAGING_PORT")
    return {"status":"STAGING_EFFECTIVE_PASS","release":expected,"noSendFlags":7}


def wait_runtime(expected):
    for _ in range(40):
        try:
            return runtime(expected)
        except (OSError, Block, ValueError, KeyError, json.JSONDecodeError):
            time.sleep(1)
    raise Block("NEW_RELEASE_NOT_READY")


def verify_quarantine():
    require(not QUARANTINE.is_symlink() and QUARANTINE.is_dir(),
            "QUARANTINE_DIRECTORY")
    folder = QUARANTINE.stat(follow_symlinks=False)
    require(folder.st_uid == 1001 and stat.S_IMODE(folder.st_mode) == 0o700,
            "QUARANTINE_PERMISSIONS")
    archive = QUARANTINE / ("asi-staging-" + NEW + ".tgz")
    manifest = QUARANTINE / "artifact-manifest.json"
    for file in (archive, manifest):
        s = file.lstat()
        require(stat.S_ISREG(s.st_mode) and not file.is_symlink()
                and s.st_uid == 1001 and stat.S_IMODE(s.st_mode) == 0o600,
                "QUARANTINE_FILE")
    require(hashlib.sha256(manifest.read_bytes()).hexdigest() == MANIFEST_SHA,
            "MANIFEST_INTEGRITY")
    return archive, archive_contract.inspect(archive)


def releases_scope():
    for p in (ROOT, RELEASES, ENV.parent):
        meta = p.lstat()
        require(stat.S_ISDIR(meta.st_mode) and not p.is_symlink()
                and not meta.st_mode & stat.S_IWOTH,
                "STAGING_PATH_DRIFT")
    require(CURRENT.is_symlink(), "MISSING_LIVE_SYMLINK")
    require(shutil.disk_usage(RELEASES).free >= 2200 * 1024 * 1024,
            "STAGING_DISK_SPACE")


def atomic_current(release, run_id):
    # Parent and target are fixed. tmp symlink must not already exist.
    tmp = ROOT / (".strigunov4-switch-" + run_id)
    require(not tmp.exists() and not tmp.is_symlink(), "SWITCH_TEMP_EXISTS")
    os.symlink(str(release), tmp)
    try:
        os.replace(tmp, CURRENT)
    finally:
        if tmp.is_symlink():
            tmp.unlink()


def prepare_release(archive, receipt, run_id):
    release = RELEASES / NEW
    require(not release.exists() and not release.is_symlink(),
            "TARGET_RELEASE_ALREADY_EXISTS")
    temp = RELEASES / (".strigunov4-unpacked-" + run_id)
    require(not temp.exists() and not temp.is_symlink(), "STAGING_TEMP_EXISTS")
    temp.mkdir(mode=0o700)
    try:
        result = g0_safe_extract.extract_into_empty(archive, temp)
        require(result["status"] == "G0_EXTRACTION_PASS"
                and result["regularFiles"] == receipt["files"]
                and result["directories"] == receipt["dirs"]
                and result["relativeSymlinks"] == receipt["symlinks"],
                "EXTRACTION_DIFFERENCE")
        require((temp / "release-meta.json").is_file()
                and (temp / ".next/BUILD_ID").is_file()
                and (temp / "node_modules/next/dist/bin/next").is_file(),
                "RELEASE_CONTENT")
        # Owner is root, but runtime user can read and execute files (0644/0755).
        os.chmod(temp, 0o755)
        require(not release.exists() and not release.is_symlink(),
                "TARGET_RELEASE_RACE")
        os.rename(temp, release)
    except Exception:
        if temp.exists() and not temp.is_symlink():
            shutil.rmtree(temp)
        raise
    return release


def journal_start(run_id, source_sha):
    require(re.fullmatch(r"[1-9][0-9]{0,19}", run_id) is not None
            and re.fullmatch(r"[0-9a-f]{40}", source_sha) is not None,
            "RUN_BINDING")
    os.umask(0o077)
    if not STATE.exists():
        STATE.mkdir(mode=0o700)
    s = STATE.lstat()
    require(stat.S_ISDIR(s.st_mode) and not STATE.is_symlink()
            and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o700,
            "JOURNAL_ROOT")
    fd = os.open(STATE / "active.lock", os.O_RDWR | os.O_CREAT |
                 getattr(os, "O_NOFOLLOW", 0), 0o600)
    info = os.fstat(fd)
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
            and stat.S_IMODE(info.st_mode) == 0o600, "JOURNAL_LOCK")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise Block("ANOTHER_DEPLOYMENT_RUNNING") from None
    folder = STATE / ("run-" + run_id + "-" + source_sha)
    folder.mkdir(mode=0o700)  # fail on replay without weakening the lock
    return fd, folder


def log_result(folder, report):
    path = folder / "result.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        raw = json.dumps(report, sort_keys=True).encode() + b"\n"
        os.write(fd, raw)
        os.fsync(fd)
    finally:
        os.close(fd)


def activate(run_id, sha):
    fd = None
    journal = None
    swapped = False
    try:
        fd, journal = journal_start(run_id, sha)
        runtime(OLD)
        releases_scope()
        archive, reviewed = verify_quarantine()
        new_release = prepare_release(archive, reviewed, run_id)
        # The old release is preserved intact. The switchover is one symlink
        # replacement and a restart of *only* asi-landing-staging.
        atomic_current(new_release, run_id)
        swapped = True
        checked("systemctl", "restart", SERVICE, timeout=65)
        final = wait_runtime(NEW)
        result = {"status":"G0_STAGING_ACTIVATION_PASS",
                  "release":NEW,"oldReleasePreserved":True,
                  "noSendFlags":final["noSendFlags"],
                  "sqlMigrationPerformed":False,
                  "externalSendsIndependentlyVerified":False}
        log_result(journal, result)
        return result
    except Exception:
        if swapped:
            try:
                atomic_current(RELEASES / OLD, run_id)
                checked("systemctl", "restart", SERVICE, timeout=65)
                wait_runtime(OLD)
                result = {"status":"ACTIVATION_FAILED_APP_ROLLBACK_PASS",
                          "sqlMigrationPerformed":False}
            except Exception:
                result = {"status":"ACTIVATION_FAILED_MANUAL_RECOVERY",
                          "sqlMigrationPerformed":False}
        else:
            result = {"status":"BLOCK_BEFORE_ACTIVATION","sqlMigrationPerformed":False}
        if journal is not None:
            try:
                log_result(journal, result)
            except Exception:
                pass
        return result
    finally:
        if fd is not None:
            os.close(fd)


def main():
    try:
        require(len(sys.argv) == 3, "ARGUMENTS")
        result = activate(sys.argv[1], sys.argv[2])
        print(json.dumps(result, sort_keys=True))
        return 0 if result["status"] == "G0_STAGING_ACTIVATION_PASS" else 2
    except (OSError, ValueError, Block):
        print('{"status":"BLOCK","databaseChanged":false}')
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
