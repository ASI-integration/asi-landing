"""Owner-approved, main-only G0 staging activation (no SQL mutations).

A GitHub staging environment approval + protected main checkout supply real
authority, not this Python module or any user-editable JSON receipt. This job
first verifies the exact protected SQL history and real no-send staging state.
It then sends the fixed, SHA-reviewed installer to the pinned SSH host.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import backup_export
import protected_staging_sql_apply as sql_gate
import staging_nine_sql_candidate as sqlbuilder
import tls_guard

REPO = "ASI-integration/asi-landing"
WORKFLOW = REPO + "/.github/workflows/strigunov4-staging-g0-activation.yml@refs/heads/main"
OWNER = "ASI-integration"
OWNER_ID = "207600140"
PROJECT = "meeravcldnmocjtlqoeu"
SOURCE_ROOT = Path(__file__).resolve().parents[2]
RELEASE = "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
SQL_SHA = "ba963872a534fb1a6852f427372ff81e498e115b92f8a98e899ba2f482e5b959"
SHA40 = re.compile(r"[a-f0-9]{40}\Z")
RUN_ID = re.compile(r"[1-9][0-9]{0,19}\Z")


class Block(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise Block(reason)


def validate(env):
    exact = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": WORKFLOW,
        "GITHUB_ACTOR": OWNER,
        "GITHUB_ACTOR_ID": OWNER_ID,
        "GITHUB_TRIGGERING_ACTOR": OWNER,
        "GITHUB_RUN_ATTEMPT": "1",
        "STAGING_SUPABASE_PROJECT_REF": PROJECT,
        "STAGING_SSH_USER": "project_ayfaar",
    }
    for name, value in exact.items():
        require(env.get(name) == value, "GITHUB_CONTEXT_" + name)
    head = env.get("GITHUB_SHA", "")
    require(SHA40.fullmatch(head) is not None
            and head == env.get("GITHUB_WORKFLOW_SHA")
            and head == env.get("STAGING_REVIEWED_MAIN_SHA"), "PINNED_MAIN_SHA")
    require(env.get("STAGING_ACTIVATE_CONFIRM") == "ACTIVATE_STRIGUNOV4_G0_" + head,
            "EXACT_OWNER_CONFIRMATION")
    rid = env.get("GITHUB_RUN_ID", "")
    require(RUN_ID.fullmatch(rid) is not None, "RUN_ID")
    require(sql_gate.preflight.target_valid(env.get("STAGING_DATABASE_URL", "")),
            "STAGING_DATABASE_TARGET")
    ssh_host = env.get("STAGING_SSH_HOST", "")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", ssh_host) is not None,
            "STAGING_SSH_HOST")
    try:
        ssh_port = int(env.get("STAGING_SSH_PORT") or "22")
    except (ValueError, TypeError):
        raise Block("STAGING_SSH_PORT") from None
    require(1 <= ssh_port <= 65535, "STAGING_SSH_PORT")
    require(type(env.get("STAGING_SSH_PRIVATE_KEY")) is str
            and len(env["STAGING_SSH_PRIVATE_KEY"]) > 100, "STAGING_SSH_KEY")
    return head, rid, ssh_host, ssh_port


def checked(argv, *, env=None, data=None, timeout=60):
    try:
        result = subprocess.run(argv, input=data, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Block("EXTERNAL_COMMAND_UNAVAILABLE") from None
    require(result.returncode == 0, "COMMAND_BLOCK")
    return result.stdout


def source_payload(root=SOURCE_ROOT):
    """Embed exactly the three reviewed modules; no arbitrary remote source."""
    paths = [
        "scripts/strigunov4/g0_release_archive.py",
        "scripts/strigunov4/g0_safe_extract.py",
        "scripts/strigunov4/g0_staging_host.py",
    ]
    files = [(Path(root) / rel).read_text(encoding="utf-8") for rel in paths]
    require(0 < len(files[0]) < 20000 and 0 < len(files[1]) < 24000
            and 0 < len(files[2]) < 39000, "PINNED_SOURCE_FILE_SIZE")
    prelude = [
        "import sys,types\n",
        "a=types.ModuleType('g0_release_archive')\n",
        "exec(compile(" + repr(files[0]) + ",'g0_release_archive.py','exec'),a.__dict__)\n",
        "sys.modules['g0_release_archive']=a\n",
        "e=types.ModuleType('g0_safe_extract')\n",
        "exec(compile(" + repr(files[1]) + ",'g0_safe_extract.py','exec'),e.__dict__)\n",
        "sys.modules['g0_safe_extract']=e\n",
    ]
    return ("".join(prelude) + files[2]).encode("utf-8")


def db_read_only_acceptance(url):
    """Require nine SQL versions really committed: postgres|17|99|7|9."""
    from pathlib import Path
    with tempfile.TemporaryDirectory(prefix="strigunov4-g0-db-read-only-") as td:
        folder = Path(td)
        folder.chmod(0o700)
        trusted = folder / "roots.pem"
        trusted.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()
                            + b"\n" + tls_guard.ca_bytes())
        trusted.chmod(0o600)
        clean = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "LC_ALL")
                 if k in os.environ}
        checked(["docker", "pull", sql_gate.PG_IMAGE], env=clean, timeout=180)
        pg_env = sql_gate.db_environment(url, trusted, True)
        query = sql_gate.postgres_client_command(folder, "postcheck")
        raw = checked(query, env=pg_env, timeout=90)
        require(raw.decode("utf-8", "strict").strip() == "postgres|17|99|7|9",
                "NINE_SQL_NOT_APPLIED_OR_HISTORY_DRIFT")


def checked_source(root, github_sha):
    head = checked(["git", "-C", str(root), "rev-parse", "HEAD"]).decode().strip()
    require(head == github_sha, "CHECKOUT_CHANGED")
    raw = sqlbuilder.render(root).encode("utf-8")
    require(len(raw) == 55091
            and hashlib.sha256(raw).hexdigest() == SQL_SHA,
            "APPROVED_SQL_SOURCE_CHANGED")


def remote_activate(env, host, port, run_id, source_sha, root):
    """Call fixed root worker through pinned SSH, suppress arbitrary stderr."""
    worker = source_payload(root)
    with tempfile.TemporaryDirectory(prefix="strigunov4-g0-activate-") as td:
        folder = Path(td)
        folder.chmod(0o700)
        known = backup_export.ssh_identity(folder, host, port)
        private = folder / "id_ed25519"
        private.write_text(env["STAGING_SSH_PRIVATE_KEY"].rstrip("\n") + "\n",
                           encoding="utf-8")
        private.chmod(0o600)
        clean = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "LC_ALL")
                 if k in os.environ}
        args = ["ssh", "-T", "-i", str(private), "-p", str(port),
                "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
                "-o", "StrictHostKeyChecking=yes",
                "-o", "GlobalKnownHostsFile=none",
                "-o", "UserKnownHostsFile=" + str(known),
                "-o", "ConnectTimeout=20",
                "project_ayfaar@" + host, "sudo", "-n", "python3", "-",
                run_id, source_sha]
        try:
            result = subprocess.run(args, input=worker, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, env=clean, timeout=900)
        except (OSError, subprocess.TimeoutExpired):
            raise Block("REMOTE_ACTIVATION_UNKNOWN") from None
    try:
        report = json.loads(result.stdout)
    except (UnicodeError, ValueError):
        raise Block("REMOTE_ACTIVATION_RESULT_UNREADABLE") from None
    if type(report) is not dict:
        raise Block("REMOTE_ACTIVATION_RESULT_SHAPE")
    require(result.returncode == 0
            and report.get("status") == "G0_STAGING_ACTIVATION_PASS"
            and report.get("release") == RELEASE
            and report.get("oldReleasePreserved") is True
            and report.get("noSendFlags") == 7
            and report.get("sqlMigrationPerformed") is False
            and report.get("externalSendsIndependentlyVerified") is False,
            "STAGING_ACTIVATION_NOT_PROVEN")
    return report


def perform(environ=os.environ, root=SOURCE_ROOT):
    sha, rid, host, port = validate(environ)
    checked_source(root, sha)
    # Fail before any app mutation unless the *current* staging process is
    # safe and its independent encrypted backup is exactly the reviewed one.
    sql_gate.check_host(environ, host, port, root=root)
    db_read_only_acceptance(environ["STAGING_DATABASE_URL"])
    return remote_activate(environ, host, port, rid, sha, root)


def main():
    try:
        result = perform()
        print(json.dumps(result, sort_keys=True))
        return 0
    except (Block, sql_gate.Gate, OSError, ValueError):
        print('{"status":"BLOCK_OR_ACTIVATION_REQUIRES_REVIEW","sqlMigrationPerformed":false}')
        return 2
    except Exception:
        print('{"status":"BLOCK_UNEXPECTED","sqlMigrationPerformed":false}')
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
