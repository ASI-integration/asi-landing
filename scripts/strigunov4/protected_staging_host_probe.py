"""Read-only, secret-free remote staging probe. Executed from approved Actions.

No file creation, deployment, SQL, service control or outgoing guest traffic.
Outputs fixed categories only, not process environment or credentials.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import urllib.request

OLD = "5c91b27bcde395f01cc078d1fbe454dd7436e1c6"
G0 = "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
ARCHIVE_HASH = "030880c750c8fb28cb61ebfbba85e0e23718279e4c165655fcae6a1c2d07c486"
MANIFEST_HASH = "f903dbf3296f81e5fa02262d7342d32cbbeabc9b9eacfdf4df13b9da1ffcc5be"
APP_BASE = Path("/var/www/asi-staging")
QUARANTINE = Path("/home/project_ayfaar/.asi-strigunov4-g0-d912aec6-quarantine")
UNIT_HASH = "9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9"
FLAGS = {
    "EMAIL_AUTO_SEND": "false",
    "EMAIL_DRAFT_ONLY": "true",
    "DRY_RUN_TELEGRAM_OUTBOUND": "true",
    "ALLOW_REAL_TELEGRAM_SYNTHETIC": "false",
    "YOOKASSA_ENABLED": "false",
    "ASI_SYNTHETIC_NO_SEND": "YES",
    "ASI_APP_ROOT": "/var/www/asi-staging/current",
}

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()

def command(*args):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       timeout=15)
    if p.returncode:
        raise RuntimeError("COMMAND_FAILED")
    return p.stdout

def http_json(resource):
    request = urllib.request.Request("http://127.0.0.1:3001/api/" + resource)
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status != 200:
            raise RuntimeError("HTTP_STATUS")
        body = response.read(65537)
        if len(body) > 65536:
            raise RuntimeError("HTTP_SIZE")
        return json.loads(body)

def stat_checked(path, mode, own_uid=None):
    if path.is_symlink() or not path.is_file() and not path.is_dir():
        raise RuntimeError("PATH_TYPE")
    info = path.stat(follow_symlinks=False)
    if info.st_mode & 0o777 != mode or (
        own_uid is not None and info.st_uid != own_uid
    ):
        raise RuntimeError("PATH_PERMISSIONS")
    return info

def archive_verified():
    if not QUARANTINE.is_dir() or QUARANTINE.is_symlink():
        return False
    stat_checked(QUARANTINE, 0o700, os.getuid())
    archive = QUARANTINE / ("asi-staging-" + G0 + ".tgz")
    manifest = QUARANTINE / "artifact-manifest.json"
    a = stat_checked(archive, 0o600, os.getuid())
    m = stat_checked(manifest, 0o600, os.getuid())
    if not stat.S_ISREG(a.st_mode) or not stat.S_ISREG(m.st_mode):
        return False
    if a.st_size != 229060580 or m.st_size > 16384 or m.st_size < 100:
        return False
    if digest(archive) != ARCHIVE_HASH or digest(manifest) != MANIFEST_HASH:
        return False
    parsed = json.loads(manifest.read_bytes())
    return (type(parsed) is dict and parsed.get("gitSha") == G0
            and parsed.get("sourceTreeSha") == "0247b7a5a71b89b8d2c034e6d69340e14dae9ac8"
            and parsed.get("environment") == "staging"
            and parsed.get("sha256") == ARCHIVE_HASH
            and parsed.get("bytes") == 229060580
            and parsed.get("activationPerformed") is False)

def stage_state():
    if command("hostname").decode().strip() != "asi-agent-runner":
        raise RuntimeError("HOST_IDENTITY")
    if os.getuid() == 0:
        raise RuntimeError("ROOT_LOGIN_NOT_ACCEPTED")
    if digest(Path("/etc/systemd/system/asi-landing-staging.service")) != UNIT_HASH:
        raise RuntimeError("SERVICE_UNIT_CHANGED")
    properties = command(
        "systemctl", "show", "asi-landing-staging",
        "--property=MainPID,User,Group,WorkingDirectory,EnvironmentFiles,DropInPaths,ActiveState"
    ).decode().splitlines()
    props = dict(x.split("=", 1) for x in properties if "=" in x)
    if (props.get("ActiveState") != "active" or props.get("User") != "asi-runtime"
            or props.get("Group") != "asi-runtime"
            or props.get("WorkingDirectory") != "/var/www/asi-staging/current"
            or props.get("DropInPaths") or
            "/var/www/asi-staging/shared/.env.staging.local" not in
            props.get("EnvironmentFiles", "")):
        raise RuntimeError("SYSTEMD_DRIFT")
    current = APP_BASE / "current"
    if not current.is_symlink() or current.resolve() != APP_BASE / "releases" / OLD:
        raise RuntimeError("LIVE_RELEASE_CHANGED")
    stat_checked(APP_BASE / "shared/.env.staging.local", 0o640)
    if http_json("version").get("sha") != OLD or http_json("health").get("ok") is not True:
        raise RuntimeError("HEALTH_OR_VERSION")
    raw_pid = props.get("MainPID", "")
    if not raw_pid.isdecimal() or int(raw_pid) < 1:
        raise RuntimeError("SERVICE_PID")
    # Read effective environment only via sudo. This never prints any values.
    environ = command("sudo", "-n", "cat", "/proc/" + raw_pid + "/environ")
    values = {}
    for pair in environ.split(b"\0"):
        if b"=" in pair:
            k, v = pair.split(b"=", 1)
            values[k] = v
    failed = []
    for key, expected in FLAGS.items():
        if values.get(key.encode()) != expected.encode():
            failed.append("MISSING_OR_MISMATCH_" + key)
    return failed

def main():
    result = {
        "status": "BLOCK", "reason_codes": [], "archive_verified": False,
        "staging_active": False, "original_release": OLD,
        "checked_flags": len(FLAGS), "no_send_ready": False,
    }
    try:
        result["archive_verified"] = archive_verified()
        if not result["archive_verified"]:
            result["reason_codes"].append("QUARANTINE_BYTES")
        failures = stage_state()
        result["staging_active"] = True
        result["no_send_ready"] = not failures
        result["reason_codes"].extend(failures)
        if not result["reason_codes"]:
            result["status"] = "PREFLIGHT_PASS"
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired):
        result["reason_codes"].append("HOST_RUNTIME_NOT_VERIFIED")
    print(json.dumps(result, sort_keys=True))
    # Diagnostic script exits zero even on a semantic BLOCK to preserve the
    # sanitized reason; caller must reject non-PREFLIGHT_PASS.
    return 0

if __name__ == "__main__":
    sys.exit(main())
