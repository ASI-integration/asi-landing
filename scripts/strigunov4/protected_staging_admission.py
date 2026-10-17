"""Protected Strigunov4 staging read-only admission.

This is NOT a database migration/app deployment executor. Only a GitHub-hosted
workflow on main, inside the required-reviewer staging environment, supplies
real authority to read protected SSH credentials. Environment strings alone
cannot authenticate local callers and this script does not grant write access.
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

REPO = "ASI-integration/asi-landing"
WORKFLOW = REPO + "/.github/workflows/strigunov4-protected-preflight.yml@refs/heads/main"
EXPECTED_ACTOR = "ASI-integration"
EXPECTED_ACTOR_ID = "207600140"
PROJECT = "meeravcldnmocjtlqoeu"
APP_ROOT = "/var/www/asi-staging"
RUN_CONFIRMATION = "VERIFY_STRIGUNOV4_STAGING_ONLY"
RELEASE_SHA = "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
RELEASE_ARCHIVE_SHA256 = "030880c750c8fb28cb61ebfbba85e0e23718279e4c165655fcae6a1c2d07c486"
RELEASE_ARCHIVE_BYTES = 229060580
HOST_FP = "SHA256:LeYiv/JvQBkIbDBo6J5LtLKOFEQTkf6xxbgWXNcKt3g"
RELEASE_TREE = "0247b7a5a71b89b8d2c034e6d69340e14dae9ac8"
SOURCE_ROOT = Path(__file__).resolve().parents[2]
SQL_FILES = (
    ("scripts/strigunov4/candidates/sql/20260810280000_booking_ops_communication_purpose_constraint_repair.sql", "9e2c2516d07041fa29feab60abb010443d66bf7c0337bb89ab73c191e0d69f7f"),
    ("scripts/strigunov4/candidates/sql/20261003124500_booking_ops_auto_send_account_scope_v1.sql", "fb874f776a01b14fec70314d2c76a9358d7c362d6b6f9d16a4ca4dc2c8148c32"),
    ("scripts/strigunov4/candidates/sql/20261003141500_booking_inbound_intake_account_scope_v1.sql", "05df3a611da0eb52da11331c41b6cb96b79139ac4be34c6983527a200d5d4474"),
    ("scripts/strigunov4/candidates/sql/20261003150000_booking_availability_account_scope_v1.sql", "ba52c412da61cf7912a4c101267ff5110a75778a7a55f43dffa6679e332c00e7"),
    ("scripts/strigunov4/candidates/sql/20261005090000_booking_ops_record_scope_guard_v1.sql", "21c0421d214d34450076bfe271b56fc609f57ab69b041b1a792e1c4e7fbdb9c4"),
    ("scripts/strigunov4/candidates/sql/20261015103000_booking_knowledge_read_contract.sql", "8e41fda68656ab0b551f79e5a968ebd4ef7f7e42d4c521b3c896ac6532411d30"),
    ("scripts/strigunov4/candidates/sql/20261016090000_g0_operator_revision_takeover.sql", "eb91b48dfb4df3ae8bd63118f678573028b4fd53f5f3eeaa916adaf25d1fc3bd"),
    ("supabase/migrations/20261016203000_booking_availability_canonical_lock.sql", "782c83e99c20ef8882f7b6e428ad9287fd5b5d417f92697d98ef79c0da1f878c"),
    ("supabase/migrations/20261016213000_booking_availability_shared_writer_lock.sql", "08975e5a7e7755f80c128bd5c74c5ad1a45633b353b997bfb42c188f7471e27a"),
)

class Block(ValueError):
    pass

def require(ok, reason):
    if not ok:
        raise Block(reason)

def validate_run(env):
    expected = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": WORKFLOW,
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_ACTOR": EXPECTED_ACTOR,
        "GITHUB_ACTOR_ID": EXPECTED_ACTOR_ID,
        "GITHUB_TRIGGERING_ACTOR": EXPECTED_ACTOR,
        "GITHUB_RUN_ATTEMPT": "1",
        "STRIGUNOV_CONFIRM": RUN_CONFIRMATION,
        "STAGING_SUPABASE_PROJECT_REF": PROJECT,
        "STAGING_APP_PATH": APP_ROOT,
        "STAGING_PORT": "3001",
        "STAGING_SSH_USER": "project_ayfaar",
    }
    for key, value in expected.items():
        require(env.get(key) == value, "RUN_CONTEXT_" + key)
    sha = env.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[a-f0-9]{40}", sha) is not None, "MAIN_SHA_FORMAT")
    require(sha == env.get("STRIGUNOV_REVIEWED_MAIN_SHA"), "MAIN_SHA_MISMATCH")
    require(sha == env.get("GITHUB_WORKFLOW_SHA"), "WORKFLOW_SOURCE_SHA")
    run_id = env.get("GITHUB_RUN_ID", "")
    require(run_id.isdecimal() and int(run_id) > 0, "RUN_ID")
    host = env.get("STAGING_SSH_HOST", "")
    require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}", host) is not None
            and not host.startswith("-"), "STAGING_SSH_HOST")
    try:
        port = int(env.get("STAGING_SSH_PORT") or "22")
    except (ValueError, TypeError):
        raise Block("STAGING_SSH_PORT") from None
    require(1 <= port <= 65535, "STAGING_SSH_PORT")
    require(bool(env.get("STAGING_SSH_PRIVATE_KEY")), "STAGING_SSH_PRIVATE_KEY")
    return host, port

def _file_digest(root, name):
    path = Path(root)
    for part in name.split("/"):
        path = path / part
        require(not path.is_symlink(), "SYMLINK_COMPONENT")
    require(path.is_file(), "FILE_MISSING")
    info = path.stat(follow_symlinks=False)
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size < 262144,
            "NOT_REVIEWED_REGULAR_FILE")
    h = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(65536), b""):
            h.update(part)
    return h.hexdigest()

def verify_sql(root=SOURCE_ROOT):
    require(len(SQL_FILES) == 9 and len(set(k for k, _ in SQL_FILES)) == 9, "SQL_FILE_SET")
    for name, expected in SQL_FILES:
        require(_file_digest(root, name) == expected, "SQL_BYTES_MISMATCH")
    return True

def checked(args, *, input_data=None, env=None, timeout=45):
    try:
        p = subprocess.run(args, input=input_data, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired):
        raise Block("COMMAND_UNAVAILABLE") from None
    require(p.returncode == 0, "COMMAND_BLOCK")
    return p.stdout

def run_preflight(env, root=SOURCE_ROOT):
    host, port = validate_run(env)
    # Verifying source files does not grant authority. The protected GitHub
    # environment + exact workflow ref are the external authorization boundary.
    verify_sql(root)
    observed_sha = checked(["git", "-C", str(root), "rev-parse", "HEAD"]).decode().strip()
    require(observed_sha == env["GITHUB_SHA"], "CHECKOUT_HEAD_MISMATCH")
    # GitHub can squash-merge the reviewed PR: ancestry is NOT evidence of
    # the release's bytes. The archived G0 SHA/tree/digest are verified by
    # the independent fixed remote quarantine probe, and every current SQL
    # source byte is verified above. No unreviewed ref is checked out.
    script = Path(__file__).with_name("protected_staging_host_probe.py")
    require(_file_digest(script.parent, script.name) != "", "HOST_PROBE_MISSING")
    with tempfile.TemporaryDirectory(prefix="strigunov4-staging-preflight-") as tmp:
        folder = Path(tmp)
        folder.chmod(0o700)
        known_hosts = folder / "known_hosts"
        scan = checked(["ssh-keyscan", "-T", "12", "-p", str(port), "-t", "ed25519", host], timeout=30)
        lines = [x for x in scan.decode("utf-8").splitlines() if x.strip() and not x.startswith("#")]
        require(len(lines) == 1 and len(lines[0].split()) == 3, "SSH_HOSTKEY_AMBIGUOUS")
        known_hosts.write_text(lines[0] + "\n", encoding="ascii")
        known_hosts.chmod(0o600)
        fp = checked(["ssh-keygen", "-lf", str(known_hosts)]).decode("utf-8", errors="replace")
        require(HOST_FP in fp, "SSH_HOSTKEY_MISMATCH")
        key = folder / "ssh_key"
        key.write_text(env["STAGING_SSH_PRIVATE_KEY"].rstrip("\n") + "\n", encoding="utf-8")
        key.chmod(0o600)
        # No SSH shell expansion of user-controlled strings and no remote writes.
        # Probe stdout contains only named checks; never print arbitrary stderr.
        output = checked(["ssh", "-T", "-i", str(key), "-p", str(port),
                          "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
                          "-o", "StrictHostKeyChecking=yes",
                          "-o", "UserKnownHostsFile=" + str(known_hosts),
                          "-o", "ConnectTimeout=20",
                          "project_ayfaar@" + host, "python3", "-"],
                         input_data=script.read_bytes(), timeout=180)
    try:
        report = json.loads(output)
    except (ValueError, UnicodeError):
        raise Block("INVALID_REMOTE_REPORT") from None
    require(type(report) is dict
            and set(report) == {"status", "reason_codes", "archive_verified", "staging_active",
                                "original_release", "checked_flags", "no_send_ready"},
            "REMOTE_REPORT_SHAPE")
    require(report["original_release"] == "5c91b27bcde395f01cc078d1fbe454dd7436e1c6",
            "REMOTE_SOURCE_RELEASE")
    require(report["archive_verified"] is True and report["staging_active"] is True
            and report["checked_flags"] == 7, "REMOTE_PRECONDITIONS")
    return report

def main():
    try:
        report = run_preflight(os.environ)
        print(json.dumps(report, sort_keys=True))
        return 0 if report["status"] == "PREFLIGHT_PASS" and report["no_send_ready"] is True else 2
    except (Block, OSError):
        print('{"status":"BLOCK","reason_codes":["PROTECTED_PREFLIGHT_NOT_PROVEN"]}')
        return 2

if __name__ == "__main__":
    sys.exit(main())
