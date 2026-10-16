"""Offline admission/command-plan builder; never invokes Docker, SQL or decrypt.

Image paths and extension availability are intentionally required evidence, not
guessed defaults. Output is preparation, never restore authorization or PASS.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

RUN = "38942690625"
DIGEST = "23f293fa6699061906823a6d28d1c7293c1e3e5d4fd147ae067437db4a6b6291"
SIZE = 339054
LABEL = "org.asi.strigunov4.restore-run"
EXTENSIONS = {"plpgsql": "1.0", "pg_stat_statements": "1.11",
              "uuid-ossp": "1.1", "pgcrypto": "1.3", "supabase_vault": "0.3.1"}


class Block(Exception):
    pass


def absolute_binary(value):
    if not isinstance(value, str) or not re.fullmatch(r"/[A-Za-z0-9_./-]+", value):
        raise Block("IMAGE_BINARY_PATH_MISSING")
    if ".." in PurePosixPath(value).parts:
        raise Block("IMAGE_BINARY_PATH_INVALID")
    return value


def build_plan(manifest, parent, ciphertext):
    """Validate caller evidence and build argv only. Caller evidence is untrusted.

    A trusted executor must separately inspect image/runtime and confirm identity
    immediately before execution. This function cannot establish those facts.
    """
    if manifest.get("run_id") != RUN or manifest.get("cipher_sha256") != DIGEST:
        raise Block("WRONG_RUN_OR_CIPHERTEXT")
    runtime = manifest.get("runtime")
    if runtime not in ("podman", "docker"):
        raise Block("CONTAINER_RUNTIME_REQUIRED")
    uid, gid = manifest.get("postgres_uid"), manifest.get("postgres_gid")
    if type(uid) is not int or type(gid) is not int or not 1 <= uid < 2**31 or not 1 <= gid < 2**31:
        raise Block("VERIFIED_NONROOT_POSTGRES_ID_REQUIRED")
    if manifest.get("reviewed_memory_budget_mib") != 512:
        raise Block("REVIEWED_MEMORY_BUDGET_REQUIRED")
    image = manifest.get("image", "")
    if not re.fullmatch(r"(?:[A-Za-z0-9.-]+(?::[0-9]+)?/)?[A-Za-z0-9_./-]+@sha256:[0-9a-f]{64}", image):
        raise Block("PINNED_IMAGE_REQUIRED")
    if manifest.get("postgres_major") != 17 or manifest.get("extensions") != EXTENSIONS:
        raise Block("EXACT_EXTENSION_INVENTORY_REQUIRED")
    # Reject a supplied URL/host/container/name: target is created only by executor.
    if any(k in manifest for k in ("database_url", "host", "container", "container_name", "volumes", "network", "ports")):
        raise Block("EXISTING_OR_EXTERNAL_TARGET_FORBIDDEN")
    binaries = manifest.get("binaries", {})
    bins = {n: absolute_binary(binaries.get(n)) for n in ("initdb", "pg_ctl", "psql", "pg_restore")}
    if manifest.get("database_services_disabled") is not True:
        raise Block("BACKGROUND_SERVICES_UNREVIEWED")
    if manifest.get("blank_cluster_bootstrap_reviewed") is not True:
        raise Block("BLANK_CLUSTER_BOOTSTRAP_UNREVIEWED")
    reconciliation = manifest.get("bootstrap_reconciliation", {})
    if not isinstance(reconciliation, dict) or reconciliation.get("source_bootstrap_role") != "supabase_admin" or reconciliation.get("source_bootstrap_oid") != 10:
        raise Block("SOURCE_BOOTSTRAP_IDENTITY_REQUIRED")
    if reconciliation.get("reviewed") is not True or reconciliation.get("create_role_replacement_count") != 1:
        raise Block("BOOTSTRAP_RECONCILIATION_REVIEW_REQUIRED")
    if reconciliation.get("original_globals_sha256") != "f708fb1cdccf47d0675e80b8b550edebb32b41ecad1a51337b4b8c5a9948b27c":
        raise Block("ORIGINAL_GLOBALS_HASH_REQUIRED")
    if not re.fullmatch(r"[0-9a-f]{64}", reconciliation.get("execution_globals_sha256", "")) or not re.fullmatch(r"[0-9a-f]{64}", reconciliation.get("exact_diff_sha256", "")):
        raise Block("BOOTSTRAP_DERIVED_COPY_EVIDENCE_REQUIRED")
    if reconciliation.get("all_other_statements_unchanged") is not True or reconciliation.get("oid10_assertion_replaces_create") is not True:
        raise Block("BOOTSTRAP_DIFF_CONTRACT_REQUIRED")
    if manifest.get("vault_binary_root_key_behavior_reviewed") is not True:
        raise Block("VAULT_BOOTSTRAP_UNREVIEWED")
    # The caller must point at a dedicated private directory, never root/home.
    parent = Path(parent)
    if not parent.is_absolute() or parent.is_symlink() or not parent.is_dir() or parent.resolve() != parent:
        raise Block("PRIVATE_PARENT_REQUIRED")
    import os
    st = parent.stat()
    if st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise Block("PRIVATE_PARENT_OWNER_OR_MODE")
    if parent.name != "strigunov4-restore-private":
        raise Block("PRIVATE_PARENT_NAME")
    ciphertext = Path(ciphertext)
    if ciphertext.is_symlink() or not ciphertext.is_file() or ciphertext.stat().st_size != SIZE:
        raise Block("CIPHERTEXT_FILE_INVALID")
    if hashlib.sha256(ciphertext.read_bytes()).hexdigest() != DIGEST:
        raise Block("CIPHERTEXT_HASH_MISMATCH")
    nonce = manifest.get("nonce", "")
    if not re.fullmatch(r"[0-9a-f]{32}", nonce):
        raise Block("FRESH_NONCE_REQUIRED")
    work = parent / ("restore-" + nonce)
    if work.exists() or work.is_symlink():
        raise Block("TARGET_ALREADY_EXISTS")
    name = "asi-restore-" + RUN + "-" + nonce
    bootstrap = "supabase_admin"
    # No shell, no arbitrary supplied SQL and no host networking. A future
    # executor creates work exclusively, verifies Docker name absence and mounts
    # only that directory. Secrets/owner key never enter the container mount.
    docker = [runtime, "run", "--name", name, "--label", LABEL + "=" + RUN,
              "--label", "org.asi.restore-nonce=" + nonce,
              "--network=none", "--read-only", "--cap-drop=ALL",
              "--security-opt=no-new-privileges", "--pids-limit=128",
              "--memory=512m", "--cpus=1", "--user", f"{uid}:{gid}",
              "--mount", f"type=bind,src={work},dst=/restore",
              "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
              "--entrypoint", bins["initdb"], image,
              "-D", "/restore/data", "-U", bootstrap,
              "--auth-local=trust", "--auth-host=reject", "--no-instructions"]
    # Plans contain no actual key/password values and never imply SQL succeeded.
    return {
        "status": "PREFLIGHT_CANDIDATE_ONLY", "authorization": False,
        "restore": "NOT_RUN", "container_name": name, "bootstrap_role": bootstrap,
        "initdb_argv": docker,
        "globals_restore_argv": [bins["psql"], "-X", "-h", "/restore/socket",
            "-U", bootstrap, "-d", "postgres", "--set", "ON_ERROR_STOP=1",
            "--single-transaction", "--file", "/restore/globals.bootstrap.sql"],
        "database_restore_argv": [bins["pg_restore"], "-h", "/restore/socket",
            "-U", bootstrap, "-d", "postgres", "--exit-on-error",
            "--single-transaction", "/restore/db.dump"],
        "mandatory_executor_steps": [
            "verify pinned image ID, architecture, binaries and extension inventory independently",
            "verify container name absent; create owned work dir exclusively mode0700",
            "verify image postgres UID/GID against image metadata; never run initdb as root",
            "verify ciphertext; decrypt owner key outside mount; strict archive inspection",
            "extract only db.dump and untouched globals.sql into private mount; delete plaintext tar",
            "retain immutable original globals.sql; derive globals.bootstrap.sql by exactly one reviewed CREATE ROLE supabase_admin replacement with supabase_admin OID10 assertion; hash original execution copy and exact diff; preserve every ALTER ROLE membership and GRANTED BY statement",
            "chown only newly created exact work directory and its own extracted files to verified image postgres UID/GID; keep private parent owner-only and unchanged; never recursive-chown existing paths",
            "run initdb command; inspect stopped container labels/mounts before any reuse",
            "start separate database-only container with network none and exact same identity guards",
            "disable all background outbound workers; unix socket only; reviewed extension bootstrap",
            "restore reviewed globals.bootstrap.sql execution copy and untouched archive with captured private stdout/stderr; reject any error; preserve immutable original globals.sql",
            "run independent owners ACL RLS data credentials Vault checks; never infer PASS from exit0",
            "finally stop/remove only containers with exact labels and owned work directory; preserve encrypted backup"
        ],
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("manifest", type=Path)
    p.add_argument("--private-parent", required=True)
    p.add_argument("--ciphertext", required=True)
    args = p.parse_args()
    try:
        result = build_plan(json.loads(args.manifest.read_text()), args.private_parent, args.ciphertext)
    except Block as exc:
        result = {"status": "BLOCK", "reason": str(exc), "restore": "NOT_RUN", "authorization": False}
    except Exception:
        result = {"status": "BLOCK", "reason": "INVALID_INPUT", "restore": "NOT_RUN", "authorization": False}
    print(json.dumps(result, indent=2))
    return 2 if result["status"] == "BLOCK" else 0


if __name__ == "__main__":
    raise SystemExit(main())
