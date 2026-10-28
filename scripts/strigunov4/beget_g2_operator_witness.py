"""Beget G2 read-only witness. Installation and policy require a separate owner gate."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HOST = "pqukibofpo"
UNIT = "asi-beget-g1-staging.service"
POLICY = "/etc/asi-g2-witness-policy.json"
FLAGS = dict(EMAIL_AUTO_SEND="false", EMAIL_DRAFT_ONLY="true",
             DRY_RUN_TELEGRAM_OUTBOUND="true", ALLOW_REAL_TELEGRAM_SYNTHETIC="false",
             YOOKASSA_ENABLED="false", ASI_SYNTHETIC_NO_SEND="YES",
             ASI_APP_ROOT="/var/www/asi-staging/current")
LISTS = ("CRM_OPERATOR_EMAILS", "OPS_ADMIN_EMAILS")
class Block(Exception):
    pass

def require(ok, code):
    if not ok:
        raise Block(code)

def unique(pairs):
    out = {}
    for k, v in pairs:
        require(k not in out, "DUPLICATE_KEY")
        out[k] = v
    return out

def trusted_file(path, private=False):
    # Walk each parent through directory descriptors; do not follow symlinks.
    parts = Path(path).parts
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts[1:-1]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
            s = os.fstat(fd)
            require(s.st_uid == 0 and not s.st_mode & 0o022, "PARENT")
        child = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(child)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == 0
                    and not before.st_mode & 0o022 and before.st_nlink == 1
                    and before.st_size <= 65536, "FILE")
            require(not private or not before.st_mode & 0o077, "POLICY_MODE")
            raw = os.read(child, 65537)
            after = os.fstat(child)
            named = os.stat(parts[-1], dir_fd=fd, follow_symlinks=False)
            fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
            identity = lambda s: tuple(getattr(s, key) for key in fields)
            require(identity(before) == identity(after) == identity(named) and len(raw) == before.st_size, "FILE_RACE")
            return raw
        finally:
            os.close(child)
    finally:
        os.close(fd)

def members(raw):
    require(type(raw) is str and len(raw) <= 16384, "LIST")
    tokens = [s.lower() for s in re.split(r"[,;\s]+", raw) if s]
    require(all(re.fullmatch(r"[^\s@*,;]+@[^\s@*,;]+", s) for s in tokens), "LIST")
    return set(tokens)

def selected_env(raw):
    require(type(raw) is bytes and len(raw) <= 131072 and raw.endswith(b"\0"), "ENV")
    out = {}
    for row in raw.split(b"\0"):
        if not row:
            continue
        k, sep, v = row.partition(b"=")
        require(bool(sep), "ENV")
        name = k.decode("utf8")
        if name in (*FLAGS, *LISTS, "OPERATOR_EMAIL"):
            require(name not in out, "DUPLICATE_KEY")
            out[name] = v.decode("utf8")
    require(set(out) in (set(FLAGS) | set(LISTS), set(FLAGS) | set(LISTS) | {"OPERATOR_EMAIL"}), "ENV_KEYS")
    return out

def validate_policy(policy):
    require(type(policy) is dict and set(policy) == {"pid", "invocation", "crm", "ops", "release", "unitHash"}, "POLICY")
    require(type(policy["pid"]) is int and policy["pid"] > 1
            and type(policy["invocation"]) is str
            and re.fullmatch(r"[0-9a-f]{32}", policy["invocation"]), "POLICY")
    require(type(policy["release"]) is str and re.fullmatch(r"[0-9a-f]{40}", policy["release"])
            and type(policy["unitHash"]) is str and re.fullmatch(r"[0-9a-f]{64}", policy["unitHash"]), "POLICY")
    require(members(policy["crm"]) and members(policy["ops"]), "POLICY")

def evaluate(before, after, env, policy):
    validate_policy(policy)
    expected = {"host": HOST, "unit": UNIT, "release": policy["release"], "unitHash": policy["unitHash"],
                "pid": policy["pid"], "invocation": policy["invocation"]}
    require(before == expected and after == expected
            and all(type(before[k]) is type(v) for k, v in expected.items()), "IDENTITY_OR_RACE")
    require(set(env) in (set(FLAGS) | set(LISTS), set(FLAGS) | set(LISTS) | {"OPERATOR_EMAIL"}), "ENV_KEYS")
    require(all(env[k] == v for k, v in FLAGS.items()), "NO_SEND")
    crm = members(env[LISTS[0]]) | members(env.get("OPERATOR_EMAIL", ""))
    ops = members(env[LISTS[1]])
    require(crm and ops and crm == members(policy["crm"]) and ops == members(policy["ops"]), "MEMBERSHIP")
    return {"schema": "asi.beget.g2.operator.v1", "status": "OPERATOR_FLAGS_OBSERVED",
            "release": policy["release"], "unitHash": policy["unitHash"],
            "pid": expected["pid"], "invocation": expected["invocation"],
            "effectiveLists": 2, "effectiveFlags": 7, "humanLogin": "NOT_PROVEN"}

def validate_receipt(value, policy):
    validate_policy(policy)
    expected = {"schema": "asi.beget.g2.operator.v1", "status": "OPERATOR_FLAGS_OBSERVED",
                "release": policy["release"], "unitHash": policy["unitHash"],
                "pid": policy["pid"], "invocation": policy["invocation"],
                "effectiveLists": 2, "effectiveFlags": 7, "humanLogin": "NOT_PROVEN"}
    require(type(value) is dict and value == expected
            and all(type(value[k]) is type(v) for k, v in expected.items()), "RECEIPT")
    return value

def snapshot(policy):
    validate_policy(policy)
    args = ["systemctl", "show", UNIT, "-pMainPID", "-pInvocationID", "-pActiveState",
            "-pUser", "-pGroup", "-pWorkingDirectory", "-pEnvironmentFiles", "-pNeedDaemonReload", "-pFragmentPath", "-pDropInPaths"]
    raw = subprocess.check_output(args, text=True, timeout=5, stderr=subprocess.DEVNULL)
    props = unique(line.split("=", 1) for line in raw.splitlines())
    require(props["ActiveState"] == "active" and props["User"] == props["Group"] == "asi-staging"
            and props["WorkingDirectory"] == "/var/www/asi-staging/current"
            and props["EnvironmentFiles"] == "/var/www/asi-staging/shared/.env.staging.local (ignore_errors=no)"
            and props["NeedDaemonReload"] == "no", "SERVICE")
    require(props.get("FragmentPath") == "/etc/systemd/system/" + UNIT
            and props.get("DropInPaths") == "", "UNIT_OVERRIDE")
    require(str(Path("/var/www/asi-staging/current").resolve()) ==
            "/var/www/asi-staging/releases/" + policy["release"], "RELEASE")
    return {"host": os.uname().nodename, "unit": UNIT, "release": policy["release"],
            "unitHash": hashlib.sha256(trusted_file("/etc/systemd/system/" + UNIT)).hexdigest(),
            "pid": int(props["MainPID"]), "invocation": props["InvocationID"]}

def observe():
    require(len(sys.argv) == 1 and not os.environ.get("SSH_ORIGINAL_COMMAND"), "ARGS")
    require(os.uname().nodename == HOST, "HOST")
    require(os.geteuid() == 0, "AUTHORIZED_WITNESS_NOT_INSTALLED")
    policy = json.loads(trusted_file(POLICY, private=True), object_pairs_hook=unique)
    validate_policy(policy)
    before = snapshot(policy)
    require(before["pid"] == policy["pid"] and before["invocation"] == policy["invocation"], "PIN")
    fd = os.open("/proc/" + str(before["pid"]) + "/environ", os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, 131073)
        env = selected_env(raw)
        require(raw == os.pread(fd, 131073, 0), "ENV_RACE")
    finally:
        os.close(fd)
    result = evaluate(before, snapshot(policy), env, policy)
    require(json.loads(trusted_file(POLICY, private=True), object_pairs_hook=unique) == policy, "POLICY_RACE")
    return result

if __name__ == "__main__":
    try:
        print(json.dumps(observe(), sort_keys=True))
    except Exception as error:
        code = error.args[0] if type(error) is Block else "UNKNOWN"
        print(json.dumps({"status": "BLOCKED", "reason": code}))
        sys.exit(2)
