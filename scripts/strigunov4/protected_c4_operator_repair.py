"""Strict owner-reviewed staging-only fixed operator repair admission.

This source can mutate ONLY when run from an approved GitHub Actions
main-branch staging environment with access to its staging SSH key.
Repo/owner/workflow/source SHA/run attempt and host key are pinned; it does
not touch SQL, payments, OTA, production, Sentinel or release symlinks.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

REPO = "ASI-integration/asi-landing"
WORKFLOW = REPO + "/.github/workflows/strigunov4-c4-operator-repair.yml@refs/heads/main"
OWNER = "ASI-integration"
OWNER_ID = "207600140"
HOSTKEY_FP = "SHA256:LeYiv/JvQBkIbDBo6J5LtLKOFEQTkf6xxbgWXNcKt3g"
SOURCE = Path(__file__).resolve().parents[2]
MAIN_SHA = re.compile(r"[a-f0-9]{40}\Z")
RUN_ID = re.compile(r"[1-9][0-9]{0,19}\Z")


class Block(ValueError):
    pass


class RemoteOutcome(Block):
    """One of only the predeclared nonsecret results from the root worker."""
    def __init__(self, status):
        super().__init__(status)
        self.status = status


REMOTE_TOTAL_TIMEOUT = 465
REMOTE_BLOCK_CODES = frozenset({
    "BLOCK", "BLOCK_BEFORE_APPLY",
    "ROLLBACK_PASS", "BLOCK_MANUAL_RECOVERY_REQUIRED",
})


def decode_remote_result(raw, returncode):
    """Never treat a nonzero remote worker as success or echo its raw stdout."""
    if type(raw) is not bytes or len(raw) > 4096:
        raise RemoteOutcome("BLOCK_MANUAL_RECOVERY_REQUIRED")
    try:
        receipt = json.loads(raw)
    except (ValueError, UnicodeError):
        raise RemoteOutcome("BLOCK_MANUAL_RECOVERY_REQUIRED") from None
    if type(receipt) is not dict:
        raise RemoteOutcome("BLOCK_MANUAL_RECOVERY_REQUIRED")
    from c4_operator_host import SUCCESS
    expected_success = SUCCESS
    if returncode == 0:
        if receipt != expected_success:
            raise RemoteOutcome("BLOCK_MANUAL_RECOVERY_REQUIRED")
        return receipt
    status = receipt.get("status")
    # Ignore all remote-provided fields except a fixed status label. Unknown
    # statuses and receipt structures are never elevated to an approval.
    if status in REMOTE_BLOCK_CODES:
        raise RemoteOutcome(status)
    raise RemoteOutcome("BLOCK_MANUAL_RECOVERY_REQUIRED")


def require(ok, code):
    if not ok:
        raise Block(code)


def validate(env):
    exact = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_WORKFLOW_REF": WORKFLOW,
        "GITHUB_ACTOR": OWNER,
        "GITHUB_TRIGGERING_ACTOR": OWNER,
        "GITHUB_ACTOR_ID": OWNER_ID,
        "GITHUB_RUN_ATTEMPT": "1",
        "STAGING_SSH_USER": "project_ayfaar",
    }
    for name, want in exact.items():
        require(env.get(name) == want, "ADMISSION_" + name)
    sha = env.get("GITHUB_SHA", "")
    require(MAIN_SHA.fullmatch(sha) is not None
            and sha == env.get("GITHUB_WORKFLOW_SHA")
            and sha == env.get("STAGING_REVIEWED_MAIN_SHA"), "EXACT_MAIN_SHA")
    require(env.get("C4_OPERATOR_CONFIRM") == "CONFIGURE_C4_OPERATOR_" + sha,
            "OWNER_CONFIRMATION")
    require(env.get("C4_OPERATOR_INCIDENT") == "39140030546", "INCIDENT")
    rid = env.get("GITHUB_RUN_ID", "")
    require(RUN_ID.fullmatch(rid) is not None, "RUN_ID")
    host = env.get("STAGING_SSH_HOST", "")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", host) is not None,
            "SSH_HOST")
    try:
        port = int(env.get("STAGING_SSH_PORT") or "22")
    except (TypeError, ValueError):
        raise Block("SSH_PORT") from None
    require(1 <= port <= 65535, "SSH_PORT")
    require(type(env.get("STAGING_SSH_PRIVATE_KEY")) is str
            and len(env.get("STAGING_SSH_PRIVATE_KEY", "")) > 100, "SSH_KEY_MISSING")
    return sha, rid, host, port


def checked(argv, *, input_bytes=None, env=None, timeout=35):
    try:
        result = subprocess.run(argv, input=input_bytes, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired):
        raise Block("TRANSPORT_UNAVAILABLE") from None
    require(result.returncode == 0, "TRANSPORT_OR_REMOTE_BLOCK")
    return result.stdout


def payload(root=SOURCE):
    """Send only exact main-checked source bytes through protected SSH stdin."""
    modules = ("staging_no_send_patch", "staging_no_send_host", "c4_operator_patch")
    parts = ["import sys,types\n"]
    for name in modules:
        source = (Path(root) / ("scripts/strigunov4/" + name + ".py")).read_text("utf-8")
        require(0 < len(source) < 40000, "SOURCE_SIZE")
        parts.append("m=types.ModuleType(" + repr(name) + ")\n")
        parts.append("exec(compile(" + repr(source) + "," + repr(name) + ",'exec'),m.__dict__)\n")
        parts.append("sys.modules[" + repr(name) + "]=m\n")
    worker = (Path(root) / "scripts/strigunov4/c4_operator_host.py").read_text("utf-8")
    require(0 < len(worker) < 40000, "SOURCE_SIZE")
    return ("".join(parts) + worker).encode("utf-8")


def execute(env, root=SOURCE):
    sha, rid, host, port = validate(env)
    head = checked(["git", "-C", str(root), "rev-parse", "HEAD"]).decode().strip()
    require(head == sha, "CHECKOUT_SHA")
    # No executable data is taken from untrusted PR refs or user-supplied files.
    program = payload(root)
    with tempfile.TemporaryDirectory(prefix="asi-stage-nosend-gh-") as temp:
        td = Path(temp)
        td.chmod(0o700)
        known = td / "known_hosts"
        clean = {k: env[k] for k in ("PATH", "HOME", "LANG", "LC_ALL") if k in env}
        scan = checked(["ssh-keyscan", "-T", "12", "-t", "ed25519", "-p", str(port), host],
                       env=clean, timeout=30).decode()
        lines = [line for line in scan.splitlines() if line and not line.startswith("#")]
        require(len(lines) == 1 and len(lines[0].split()) == 3, "SSH_HOSTKEY_AMBIGUOUS")
        known.write_text(lines[0] + "\n", encoding="ascii")
        known.chmod(0o600)
        fingerprint = checked(["ssh-keygen", "-lf", str(known)], env=clean).decode(errors="replace")
        require(HOSTKEY_FP in fingerprint, "SSH_HOSTKEY_MISMATCH")
        key = td / "ssh_key"
        key.write_text(env["STAGING_SSH_PRIVATE_KEY"].rstrip("\n") + "\n", encoding="utf-8")
        key.chmod(0o600)
        try:
            remote = subprocess.run(
                ["ssh", "-T", "-i", str(key), "-p", str(port),
                 "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
                 "-o", "StrictHostKeyChecking=yes",
                 "-o", "GlobalKnownHostsFile=none",
                 "-o", "UserKnownHostsFile=" + str(known),
                 "-o", "ConnectTimeout=20",
                 "project_ayfaar@" + host,
                 "sudo", "-n", "python3", "-", rid, sha],
                input=program, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env=clean, timeout=REMOTE_TOTAL_TIMEOUT,
            )
        except (OSError, subprocess.TimeoutExpired):
            # After a lost SSH connection we cannot prove whether the stage
            # already changed. Refuse retries and surface manual recovery.
            raise RemoteOutcome("BLOCK_MANUAL_RECOVERY_REQUIRED") from None
    return decode_remote_result(remote.stdout, remote.returncode)


def main():
    try:
        report = execute(os.environ)
        print(json.dumps(report, sort_keys=True))
        return 0
    except RemoteOutcome as failure:
        print(json.dumps({"status": failure.status}, sort_keys=True))
        return 2
    except (Block, OSError, ValueError):
        print('{"status":"BLOCK","message":"Owner or execution admission did not pass"}')
        return 2


if __name__ == "__main__":
    sys.exit(main())
