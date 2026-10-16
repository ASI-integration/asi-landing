"""Staging-only encrypted export. A successful export is NOT a proven full restore."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import urlparse, unquote

from preflight import PROJECT, target_valid
from tls_guard import ca_bytes

EXPECTED_HOST_FP = "SHA256:LeYiv/JvQBkIbDBo6J5LtLKOFEQTkf6xxbgWXNcKt3g"
RECIPIENT_FP = "6A:FA:98:2F:3E:07:37:E1:56:7E:13:BF:DB:85:8D:9E:EF:00:ED:E8:6B:48:1A:69:D7:58:A7:F3:E1:07:A7:33"
PG_IMAGE = "postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3"
WORKFLOW = "ASI-integration/asi-landing/.github/workflows/strigunov4-staging-secure-backup.yml@refs/heads/main"

class GateError(Exception):
    pass

def checked(argv, *, env=None, input_data=None, category="COMMAND", timeout=240):
    try:
        p = subprocess.run(argv, env=env, input=input_data,
                           text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise GateError(category + "_UNAVAILABLE") from None
    if p.returncode:
        raise GateError(category + "_FAILED")
    return p.stdout

def guard(source):
    expected = {
        "GITHUB_REPOSITORY": "ASI-integration/asi-landing",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": WORKFLOW,
        "STAGING_SUPABASE_PROJECT_REF": PROJECT,
        "STAGING_APP_PATH": "/var/www/asi-staging",
        "STAGING_PORT": "3001",
    }
    for key, value in expected.items():
        if source.get(key) != value:
            raise GateError("ADMISSION_" + key)
    url = source.get("STAGING_DATABASE_URL", "")
    if not target_valid(url):
        raise GateError("DATABASE_IDENTITY")
    for key in ("STAGING_SSH_HOST", "STAGING_SSH_USER", "STAGING_SSH_PRIVATE_KEY"):
        if not source.get(key):
            raise GateError("MISSING_" + key)
    host = source["STAGING_SSH_HOST"]
    user = source["STAGING_SSH_USER"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", host):
        raise GateError("INVALID_SSH_HOST")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,31}", user):
        raise GateError("INVALID_SSH_USER")
    try:
        port = int(source.get("STAGING_SSH_PORT") or "22")
    except ValueError:
        raise GateError("INVALID_SSH_PORT") from None
    if not 1 <= port <= 65535:
        raise GateError("INVALID_SSH_PORT")
    return url, host, user, port

def build_pg_env(source, url, ca_file):
    parsed = urlparse(url)
    # Pass only the CLI essentials, never inherited staging SSH secrets or hostile libpq defaults.
    e = {k: os.environ[k] for k in ('PATH', 'HOME', 'LANG', 'LC_ALL') if k in os.environ}
    e.update(
        PGHOST=parsed.hostname,
        PGPORT=str(parsed.port or 5432),
        PGUSER=unquote(parsed.username),
        PGPASSWORD=unquote(parsed.password or ""),
        PGDATABASE="postgres",
        PGSSLMODE="verify-full",
        PGSSLROOTCERT="/work/roots.pem",
        PGCONNECT_TIMEOUT="15",
        PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=3000",
    )
    for key in ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE"):
        e.pop(key, None)
    return e

def fingerprint_recipient(cert):
    output = checked(["openssl", "x509", "-in", str(cert), "-noout",
                      "-fingerprint", "-sha256"], category="CERT")
    if output.strip().split("=")[-1].upper() != RECIPIENT_FP:
        raise GateError("RECIPIENT_CERTIFICATE_FINGERPRINT")

def ssh_identity(tmp, host, port):
    raw = checked(["ssh-keyscan", "-T", "12", "-p", str(port),
                   "-t", "ed25519", host], category="SSH_HOSTSCAN")
    lines = [s.strip() for s in raw.splitlines() if s and not s.startswith("#")]
    if len(lines) != 1 or len(lines[0].split()) < 3:
        raise GateError("SSH_HOSTKEY_AMBIGUOUS")
    keyfile = tmp / "known_hosts"
    keyfile.write_text(lines[0] + "\n", encoding="ascii")
    keyfile.chmod(0o600)
    fingerprint = checked(["ssh-keygen", "-lf", str(keyfile)],
                          category="SSH_HOSTKEY_FINGERPRINT")
    if EXPECTED_HOST_FP not in fingerprint:
        raise GateError("SSH_HOSTKEY_MISMATCH")
    return keyfile

def remote_setup_command(name):
    if not re.fullmatch(r"strigunov4-staging-[0-9]+-[0-9]+\.tar\.gz\.cms", name):
        raise GateError("INVALID_BACKUP_NAME")
    return ('set -eu; umask 077; test ! -L "$HOME/.strigunov4-staging-backups"; '
                     'mkdir -p "$HOME/.strigunov4-staging-backups"; '
                     'chmod 700 "$HOME/.strigunov4-staging-backups"; '
                     'test ! -L "$HOME/.strigunov4-staging-backups/{0}"; '
                     'test ! -e "$HOME/.strigunov4-staging-backups/{0}"; '
                     'test ! -L "$HOME/.strigunov4-staging-backups/.{0}.part"; '
                     'test ! -e "$HOME/.strigunov4-staging-backups/.{0}.part"').format(name)

def export(source):
    url, host, user, port = guard(source)
    cert = Path(__file__).with_name("backup-recipient.crt")
    fingerprint_recipient(cert)
    run_id = source.get("GITHUB_RUN_ID", "")
    attempt = source.get("GITHUB_RUN_ATTEMPT", "")
    if not run_id.isdigit() or not attempt.isdigit():
        raise GateError("MISSING_RUN_ID")
    name = "strigunov4-staging-{}-{}.tar.gz.cms".format(run_id, attempt)
    with tempfile.TemporaryDirectory(prefix="strigunov4-backup-") as td:
        tmp = Path(td)
        tmp.chmod(0o700)
        root = tmp / "roots.pem"
        root.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()
                         + b"\n" + ca_bytes())
        root.chmod(0o600)
        env = build_pg_env(source, url, root)
        clean = {k: env[k] for k in ("PATH", "HOME", "LANG", "LC_ALL") if k in env}
        checked(["docker", "pull", PG_IMAGE], env=clean, category="CLIENT_IMAGE_PULL")
        docker = [
            "docker", "run", "--rm", "--pull=never", "--network", "host",
            "--user", "{}:{}".format(os.getuid(), os.getgid()),
            "--mount", "type=bind,src={},dst=/work".format(tmp),
        ]
        for var in ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD",
                    "PGDATABASE", "PGSSLMODE", "PGSSLROOTCERT",
                    "PGCONNECT_TIMEOUT", "PGOPTIONS"):
            docker += ["-e", var]
        docker.append(PG_IMAGE)
        checked(docker + ["sh", "-ec",
                "umask 077; pg_dump --format=custom --file=/work/db.dump;"
                " pg_dumpall --globals-only --no-role-passwords --file=/work/globals.sql;"
                " pg_restore --list /work/db.dump > /work/toc.txt"],
                env=env, category="STAGING_EXPORT", timeout=900)
        for fn in ("db.dump", "globals.sql", "toc.txt"):
            if not (tmp / fn).is_file() or (tmp / fn).stat().st_size < 50:
                raise GateError("EXPORT_INCOMPLETE")
        toc = (tmp / "toc.txt").read_text(errors="replace")
        if "ACL" not in toc or "TABLE" not in toc:
            raise GateError("RESTORE_CATALOG_MISSING_ACL_OR_TABLE")
        with tarfile.open(tmp / "plaintext.tar.gz", "w:gz") as tf:
            for f in ("db.dump", "globals.sql", "toc.txt"):
                tf.add(tmp / f, arcname=f, recursive=False)
        archive = tmp / name
        checked(["openssl", "cms", "-encrypt", "-binary", "-aes256",
                 "-in", str(tmp / "plaintext.tar.gz"), "-out", str(archive),
                 "-outform", "DER", "-recip", str(cert)], category="ENCRYPTION")
        if not archive.exists() or archive.stat().st_size < 500:
            raise GateError("ENCRYPTION_OUTPUT_MISSING")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        for fn in ("db.dump", "globals.sql", "toc.txt", "plaintext.tar.gz"):
            (tmp / fn).unlink()
        # Host-key trust established from an independently accepted SSH
        # fingerprint of the same VPS over Tailscale; do not use TOFU.
        known = ssh_identity(tmp, host, port)
        key = tmp / "ssh_key"
        key.write_text(source["STAGING_SSH_PRIVATE_KEY"].rstrip("\n") + "\n")
        key.chmod(0o600)
        common = ["-i", str(key), "-p", str(port),
                  "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
                  "-o", "StrictHostKeyChecking=yes",
                  "-o", "UserKnownHostsFile=" + str(known),
                  "-o", "ConnectTimeout=20"]
        remote = user + "@" + host
        folder = ".strigunov4-staging-backups"
        cmd_setup = remote_setup_command(name)
        checked(["ssh"] + common + [remote, cmd_setup], category="REMOTE_STORAGE_PREP")
        # SCP uses -P for port, not SSH's lowercase -p.
        scp = [("-P" if v == "-p" else v) for v in common]
        checked(["scp", "-q"] + scp + [str(archive),
                 remote + ":" + folder + "/." + name + ".part"],
                category="CIPHERTEXT_TRANSFER")
        cmd_commit = (
            'set -eu; umask 077; '
            'test "$(sha256sum "$HOME/.strigunov4-staging-backups/.{}.part" | cut -d" " -f1)" = "{}"; '
            'test ! -e "$HOME/.strigunov4-staging-backups/{}"; '
            'mv "$HOME/.strigunov4-staging-backups/.{}.part" '
            '"$HOME/.strigunov4-staging-backups/{}"; '
            'chmod 600 "$HOME/.strigunov4-staging-backups/{}"'
        ).format(name, digest, name, name, name, name)
        checked(["ssh"] + common + [remote, cmd_commit], category="REMOTE_SHA256")
        print("STAGING_ENCRYPTED_BACKUP_TRANSFER_PASS")
        print("ENCRYPTED_SHA256=" + digest)
        print("ENCRYPTED_BYTES=" + str(archive.stat().st_size))
        print("PRIVATE_STORAGE=REMOTE_STAGING_SSH_HOME")
        print("ROLE_SQL_ENCRYPTED=YES")
        print("ROLE_PASSWORDS=NOT_EXPORTED_RESTORE_REQUIRES_SEPARATE_CREDENTIALS")
        print("ACL_ENTRIES_PRESENT=YES")
        print("SECURITY_COMPLETE_RESTORE=NOT_RUN")
        print("MIGRATIONS_OR_DEPLOY=NOT_RUN")

if __name__ == "__main__":
    try:
        export(os.environ)
    except GateError as err:
        print("BLOCK: " + str(err))
        sys.exit(97)
    except Exception:
        # Do not print environment, secrets, URLs, SQL or table data.
        print("BLOCK: UNCLASSIFIED_BACKUP_ERROR")
        sys.exit(97)

