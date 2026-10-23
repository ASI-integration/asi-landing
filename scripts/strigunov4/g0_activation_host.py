"""Protected staging-only G0 archive preparation and systemd activation.

ONLY reviewed GitHub main + staging environment may invoke over pinned SSH.
The host code never trusts command-line booleans as approval. The external
environment supplies authorization. No database writes, provider sends,
production or Sentinel operations. Existing release remains restorable.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import urllib.error

import strigunov_g0_archive as package

ROOT = Path("/var/www/asi-staging")
RELEASES = ROOT / "releases"
SHARED = ROOT / "shared"
CURRENT = ROOT / "current"
ENV = SHARED / ".env.staging.local"
QUARANTINE = Path("/home/project_ayfaar/.asi-strigunov4-g0-d912aec6-quarantine")
SOURCE = QUARANTINE / ("asi-staging-" + package.SHA + ".tgz")
MANIFEST = QUARANTINE / "artifact-manifest.json"
NEW = RELEASES / package.SHA
OLD_SHA = "5c91b27bcde395f01cc078d1fbe454dd7436e1c6"
OLD = RELEASES / OLD_SHA
SERVICE = "asi-landing-staging"
UNIT_HASH = "6e0ce12922e015738368c89deeef154c195f19b2a0678d72d27d58e5414bf62c"
MANIFEST_SHA = "f903dbf3296f81e5fa02262d7342d32cbbeabc9b9eacfdf4df13b9da1ffcc5be"
EXPECTED = {
    "EMAIL_AUTO_SEND": b"false",
    "EMAIL_DRAFT_ONLY": b"true",
    "DRY_RUN_TELEGRAM_OUTBOUND": b"true",
    "ALLOW_REAL_TELEGRAM_SYNTHETIC": b"false",
    "YOOKASSA_ENABLED": b"false",
    "ASI_SYNTHETIC_NO_SEND": b"YES",
    "ASI_APP_ROOT": b"/var/www/asi-staging/current",
}
GUARD = Path("/root/.asi-strigunov4-g0-activation")


class Block(RuntimeError):
    pass


def require(ok, reason):
    if not ok:
        raise Block(reason)


def command(*args, timeout=75):
    try:
        p = subprocess.run(args, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Block("HOST_COMMAND_UNAVAILABLE") from None
    require(p.returncode == 0, "HOST_COMMAND_FAILED")
    return p.stdout


def props():
    lines = command("systemctl", "show", SERVICE,
                    "--property=MainPID,User,Group,WorkingDirectory,EnvironmentFiles,DropInPaths,ActiveState")
    return dict(s.split("=",1) for s in lines.decode("utf-8","strict").splitlines() if "=" in s)


def process_flags(pid):
    require(pid.isdecimal() and int(pid) > 1, "INVALID_PID")
    raw = (Path("/proc") / pid / "environ").read_bytes()
    fields = dict((key.decode("utf-8","strict"), val)
                  for entry in raw.split(b"\0") if b"=" in entry
                  for key,val in (entry.split(b"=",1),))
    require(all(fields.get(k) == v for k,v in EXPECTED.items()),
            "EFFECTIVE_NO_SEND_BLOCK")


def health(expected):
    for end in ("health", "version"):
        with urllib.request.urlopen("http://127.0.0.1:3001/api/" + end, timeout=5) as resp:
            require(resp.status == 200, "HTTP_STATUS")
            raw = resp.read(65537)
            require(len(raw) <= 65536, "HTTP_BODY_LIMIT")
            info = json.loads(raw)
            require(info.get("ok") is True if end == "health"
                    else info.get("sha") == expected, "HTTP_RESPONSE_MISMATCH")


def service_identity(expected, *, check_http=True):
    require(os.geteuid() == 0 and os.uname().nodename == "asi-agent-runner",
            "ROOT_AND_HOST_IDENTITY")
    require(hashlib.sha256(Path("/etc/systemd/system/asi-landing-staging.service").read_bytes()).hexdigest()
            == UNIT_HASH, "STAGING_UNIT_CHANGED")
    p = props()
    require(p.get("ActiveState") == "active" and p.get("User") == "asi-runtime"
            and p.get("Group") == "asi-runtime"
            and p.get("WorkingDirectory") == str(CURRENT)
            and not p.get("DropInPaths") and str(ENV) in p.get("EnvironmentFiles",""),
            "SYSTEMD_SERVICE_IDENTITY")
    require(CURRENT.is_symlink() and CURRENT.resolve() == RELEASES / expected,
            "CURRENT_RELEASE_MISMATCH")
    require(not ENV.is_symlink() and ENV.is_file()
            and stat.S_IMODE(ENV.stat().st_mode) == 0o640,
            "STAGING_ENV_PERMISSIONS")
    process_flags(p.get("MainPID",""))
    if check_http:
        health(expected)


def pinned_quarantine():
    require(QUARANTINE.is_dir() and not QUARANTINE.is_symlink()
            and stat.S_IMODE(QUARANTINE.stat().st_mode) == 0o700
            and QUARANTINE.stat().st_uid == 1001, "PRIVATE_QUARANTINE")
    for path in (SOURCE, MANIFEST):
        require(path.is_file() and not path.is_symlink()
                and path.stat().st_uid == 1001
                and stat.S_IMODE(path.stat().st_mode) == 0o600,
                "PRIVATE_SOURCE_FILE")
    require(SOURCE.stat().st_size == package.ARCHIVE_BYTES
            and hashlib.sha256(MANIFEST.read_bytes()).hexdigest() == MANIFEST_SHA,
            "ARCHIVE_MANIFEST_BYTES")
    meta = json.loads(MANIFEST.read_bytes())
    require(meta.get("gitSha") == package.SHA
            and meta.get("sourceTreeSha") == package.TREE
            and meta.get("sha256") == package.ARCHIVE_HASH
            and meta.get("bytes") == package.ARCHIVE_BYTES
            and meta.get("activationPerformed") is False,
            "ARCHIVE_MANIFEST")
    return True


def runtime_identity():
    import pwd, grp
    user=pwd.getpwnam("asi-runtime")
    group=grp.getgrnam("asi-runtime")
    require(user.pw_uid >= 100 and group.gr_gid >= 100, "SYSTEM_ACCOUNT_MISSING")
    return user.pw_uid, group.gr_gid


def release_file_checks(directory):
    require((directory / ".next/BUILD_ID").is_file()
            and (directory / "node_modules/next/dist/bin/next").is_file(),
            "NEXTJS_BUILD_INCOMPLETE")
    meta = directory / "release-meta.json"
    require(meta.is_file() and not meta.is_symlink(), "RELEASE_META")
    value=json.loads(meta.read_bytes())
    require(value.get("gitSha") == package.SHA
            and value.get("sourceTreeSha") == package.TREE
            and value.get("environment") == "staging"
            and value.get("g0SourceSha") == package.SOURCE_G0,
            "NEW_RELEASE_IDENTITY")


def publish_new_dir(src, destination):
    """Linux atomic renameat2 RENAME_NOREPLACE: never overwrite a release."""
    import ctypes
    libc=ctypes.CDLL(None,use_errno=True)
    function=getattr(libc,"renameat2",None)
    require(function is not None,"NO_REPLACE_RENAME_UNSUPPORTED")
    function.argtypes=(ctypes.c_int,ctypes.c_char_p,ctypes.c_int,
                       ctypes.c_char_p,ctypes.c_uint)
    function.restype=ctypes.c_int
    AT_FDCWD=-100
    RENAME_NOREPLACE=1
    rc=function(AT_FDCWD,os.fsencode(src),AT_FDCWD,
                os.fsencode(destination),RENAME_NOREPLACE)
    require(rc==0,"RELEASE_TARGET_EXISTS_OR_PUBLISH_FAILED")
    folder=os.open(str(RELEASES),os.O_RDONLY)
    try:
        os.fsync(folder)
    finally:
        os.close(folder)


def safe_copy_unpack():
    """Validate root-owned private copy, data-filter extraction, immutable release."""
    require(not NEW.exists() and not NEW.is_symlink(), "RELEASE_ALREADY_EXISTS")
    require(RELEASES.is_dir() and not RELEASES.is_symlink(), "RELEASE_ROOT")
    require(SHARED.is_dir() and not SHARED.is_symlink(), "SHARED_ROOT")
    uid, gid = runtime_identity()
    require(shutil.disk_usage(RELEASES).free > 3 * 1024**3, "LOW_DISK_SPACE")
    with tempfile.TemporaryDirectory(prefix=".asi-g0-stage-", dir=SHARED) as priv:
        private=Path(priv)
        copy=private / "reviewed.tgz"
        digest=hashlib.sha256()
        with SOURCE.open("rb") as orig, copy.open("xb") as dest:
            for buf in iter(lambda:orig.read(1048576),b""):
                digest.update(buf)
                dest.write(buf)
            dest.flush()
            os.fsync(dest.fileno())
        require(digest.hexdigest() == package.ARCHIVE_HASH
                and copy.stat().st_size == package.ARCHIVE_BYTES,
                "ARCHIVE_COPY_MISMATCH")
        receipt=package.inspect(copy)
        require(receipt["status"] == "G0_TAR_CONTRACT_PASS"
                and receipt["sourceLockVerified"] is True, "ARCHIVE_MEMBER_CONTRACT")
        incoming=Path(tempfile.mkdtemp(prefix=".g0-staged-",dir=RELEASES))
        activated=False
        try:
            with tarfile.open(copy, "r:gz") as data:
                data.extractall(path=incoming, filter="data")
            release_file_checks(incoming)
            for here, dirs, files in os.walk(incoming, topdown=False, followlinks=False):
                for name in files:
                    os.lchown(os.path.join(here,name), uid, gid)
                for name in dirs:
                    os.lchown(os.path.join(here,name), uid, gid)
                os.lchown(here, uid, gid)
            os.chmod(incoming, 0o2750)
            require(not NEW.exists() and not NEW.is_symlink(), "TARGET_RELEASE_RACE")
            publish_new_dir(incoming, NEW)
            activated=True
        finally:
            if not activated and incoming.exists():
                shutil.rmtree(incoming, ignore_errors=True)
    release_file_checks(NEW)
    return True


def swap(to_sha):
    """Atomically update only the staging current symlink; preserve both releases."""
    require(to_sha in (OLD_SHA, package.SHA), "RELEASE_SHA_NOT_ALLOWED")
    tmp=ROOT/(".strigunov4-current-"+str(os.getpid()))
    require(not tmp.exists() and not tmp.is_symlink(), "TEMP_SYMLINK_EXISTS")
    os.symlink(RELEASES / to_sha, tmp)
    os.replace(tmp, CURRENT)


def wait_for(expected):
    for _ in range(35):
        try:
            service_identity(expected)
            return
        except (Block, OSError, ValueError, json.JSONDecodeError,
                urllib.error.URLError, subprocess.TimeoutExpired):
            time.sleep(1)
    raise Block("HEALTH_OR_PROCESS_FLAG_TIMEOUT")


def activation(run_id, main_sha):
    require(run_id.isdecimal() and int(run_id)>0
            and len(main_sha)==40 and all(x in "0123456789abcdef" for x in main_sha),
            "RUN_SCOPE")
    service_identity(OLD_SHA)
    pinned_quarantine()
    safe_copy_unpack()
    # Live service stays on old release until everything is verified.
    swapped=False
    try:
        command("systemctl", "stop", SERVICE, timeout=45)
        require(CURRENT.is_symlink() and CURRENT.resolve()==OLD,
                "PRE_SWITCH_SOURCE_CHANGED")
        swap(package.SHA)
        swapped=True
        command("systemctl","start",SERVICE,timeout=55)
        wait_for(package.SHA)
        return {"status":"STAGING_G0_ACTIVATION_PASS","releaseSha":package.SHA,
                "effectiveNoSend":True,"databaseMutation":False,
                "productionTouched":False}
    except Exception:
        try:
            command("systemctl","stop",SERVICE,timeout=45)
            if swapped:
                swap(OLD_SHA)
            command("systemctl","start",SERVICE,timeout=55)
            wait_for(OLD_SHA)
            return {"status":"APPLICATION_ROLLBACK_PASS","databaseMutation":False}
        except Exception:
            return {"status":"BLOCK_MANUAL_RECOVERY_REQUIRED","databaseMutation":False}


def locked_activation(run_id,main_sha):
    import re
    require(re.fullmatch(r"[1-9][0-9]{0,19}",run_id) is not None
            and re.fullmatch(r"[0-9a-f]{40}",main_sha) is not None, "RUN_CONTEXT")
    import fcntl  # only the authorized Linux host can hold the lock
    os.umask(0o077)
    if GUARD.exists():
        st=GUARD.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid==0
                and stat.S_IMODE(st.st_mode)==0o700, "PRIVATE_GUARD_DIR")
    else:
        GUARD.mkdir(mode=0o700)
    lock=GUARD/"lock"
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|getattr(os,"O_NOFOLLOW",0),0o600)
    try:
        st=os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_uid==0
                and stat.S_IMODE(st.st_mode)==0o600, "PRIVATE_GUARD_LOCK")
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            raise Block("ANOTHER_STAGING_ACTIVATION") from None
        marker=GUARD/("run-"+run_id+"-"+main_sha)
        marker.mkdir(mode=0o700)  # fail on rerun
        result=activation(run_id,main_sha)
        # Root-private status only; never record secrets or env values.
        p=marker/"status.json"
        p.write_text(json.dumps(result,sort_keys=True),encoding="utf-8")
        os.chmod(p,0o600)
        return result
    finally:
        os.close(fd)


def main():
    try:
        require(len(sys.argv)==3,"ARGS")
        result=locked_activation(sys.argv[1],sys.argv[2])
        print(json.dumps(result,sort_keys=True))
        return 0 if result.get("status")=="STAGING_G0_ACTIVATION_PASS" else 2
    except Exception:
        print('{"status":"BLOCK","databaseMutation":false}')
        return 2


if __name__=="__main__":
    sys.exit(main())
