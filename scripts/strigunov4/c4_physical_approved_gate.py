"""Approved GitHub-only C4 physical staging core, with no server-side credential extraction.

The exact current protected main SHA, owner, first attempt, staging reviewer and
existing pinned SSH+PG read-only gates are mandatory. All write credentials
come ONLY from GitHub's protected staging secrets. No production or Sentinel.
"""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time

import backup_export
import c4_staging_readonly_probe as verified
import protected_staging_g0_activation as g0

REPO = "ASI-integration/asi-landing"
WORKFLOW = REPO + "/.github/workflows/strigunov4-c4-physical-core.yml@refs/heads/main"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
RUN_ID = re.compile(r"[1-9][0-9]{0,19}\Z")
G0 = "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
PROJECT = "meeravcldnmocjtlqoeu"
REQUIRED = (
    "STAGING_DATABASE_URL", "STAGING_SSH_PRIVATE_KEY", "STAGING_SSH_HOST",
    "STAGING_SUPABASE_URL", "STAGING_SUPABASE_SERVICE_ROLE_KEY",
    "STAGING_SESSION_SECRET",
)

class Gate(ValueError):
    pass

def require(condition, reason):
    if not condition:
        raise Gate(reason)

def context(e):
    pinned = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_WORKFLOW_REF": WORKFLOW,
        "GITHUB_ACTOR": "ASI-integration",
        "GITHUB_ACTOR_ID": "207600140",
        "GITHUB_TRIGGERING_ACTOR": "ASI-integration",
        "GITHUB_RUN_ATTEMPT": "1",
        "STAGING_SUPABASE_PROJECT_REF": PROJECT,
        "STAGING_SSH_USER": "project_ayfaar",
    }
    for key, expected in pinned.items():
        require(e.get(key) == expected, "CONTEXT_" + key)
    sha = e.get("GITHUB_SHA", "")
    require(type(sha) is str and HEX40.fullmatch(sha) is not None
            and e.get("GITHUB_WORKFLOW_SHA") == sha
            and e.get("C4_REVIEWED_MAIN_SHA") == sha, "REVIEWED_SHA")
    require(e.get("C4_CONFIRM") == "RUN_STRIGUNOV4_C4_PHYSICAL_" + sha,
            "OWNER_CONFIRM")
    run_id = e.get("GITHUB_RUN_ID", "")
    require(type(run_id) is str and RUN_ID.fullmatch(run_id) is not None, "RUN_ID")
    for key in REQUIRED:
        min_length = 100 if key == "STAGING_SSH_PRIVATE_KEY" else 20 if key != "STAGING_SSH_HOST" else 0
        require(type(e.get(key)) is str and len(e[key]) > min_length, "MISSING_" + key)
    require(e["STAGING_SUPABASE_URL"].rstrip("/") ==
            "https://" + PROJECT + ".supabase.co", "STAGE_URL")
    require(g0.pg.preflight.target_valid(e["STAGING_DATABASE_URL"]), "STAGE_PG")
    host = e["STAGING_SSH_HOST"]
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}",host) is not None,
            "STAGE_HOST")
    try:
        port = int(e.get("STAGING_SSH_PORT") or "22")
    except (ValueError, TypeError):
        raise Gate("STAGE_PORT") from None
    require(1 <= port <= 65535, "STAGE_PORT")
    return sha, run_id, host, port

def run(e):
    sha, run_id, host, port = context(e)
    actual = g0.checked(["git","-C",str(g0.ROOT),"rev-parse","HEAD"]).stdout.decode().strip()
    require(actual == sha, "CHECKOUT_DRIFT")
    # The existing G0 verifier enforces pinned PostgreSQL17 + TLS verify-full.
    g0.exact_sql_history(e["STAGING_DATABASE_URL"])
    # Exact current live staging service, effective no-send + 5 unauthenticated
    # negative routes, via the already-reviewed fingerprint-pinned probe.
    report = verified.probe(e, host, port)
    require(report["status"] == "C4_READONLY_PREFLIGHT_PASS" and
            report["fullE2E"] == "NOT_RUN", "STAGE_PREFLIGHT")
    source = Path(g0.ROOT) / "scripts/strigunov4/c4_physical_staging_lifecycle.mjs"
    js = source.read_bytes()
    require(8000 <= len(js) <= 15000 and b"C4_PHYSICAL_APPROVED" in js
            and b"127.0.0.1:3001" in js and b".like(" not in js,
            "C4_SOURCE_CONTRACT")
    env = {key:os.environ[key] for key in ("PATH","HOME","LANG","LC_ALL")
           if key in os.environ}
    env.update({
        "CI": "true", "C4_PHYSICAL_APPROVED": "YES",
        "C4_RUN_ID":run_id, "C4_REVIEWED_MAIN_SHA":sha,
        "ASI_DEPLOY_ENV":"staging", "ASI_SYNTHETIC_NO_SEND":"YES",
        "NEXT_PUBLIC_SUPABASE_URL":e["STAGING_SUPABASE_URL"],
        "SUPABASE_SERVICE_ROLE_KEY":e["STAGING_SUPABASE_SERVICE_ROLE_KEY"],
        "SESSION_SECRET":e["STAGING_SESSION_SECRET"],
        "OPS_ADMIN_EMAILS":"staging-acceptance@asi.local",
        "CRM_OPERATOR_EMAILS":"staging-acceptance@asi.local",
        "EMAIL_AUTO_SEND":"false", "EMAIL_DRAFT_ONLY":"true",
        "DRY_RUN_TELEGRAM_OUTBOUND":"true",
        "ALLOW_REAL_TELEGRAM_SYNTHETIC":"false",
        "YOOKASSA_ENABLED":"false",
    })
    with tempfile.TemporaryDirectory(prefix="c4-physical-approved-") as directory:
        folder = Path(directory)
        folder.chmod(0o700)
        known = backup_export.ssh_identity(folder, host, port)
        key = folder / "id"
        key.write_text(e["STAGING_SSH_PRIVATE_KEY"].rstrip("\n")+"\n",encoding="utf8")
        key.chmod(0o600)
        common = ["ssh","-T","-N","-i",str(key),"-p",str(port),
                  "-o","BatchMode=yes","-o","IdentitiesOnly=yes",
                  "-o","StrictHostKeyChecking=yes",
                  "-o","GlobalKnownHostsFile=none",
                  "-o","UserKnownHostsFile="+str(known),
                  "-o","ExitOnForwardFailure=yes","-o","ConnectTimeout=20",
                  "-L","127.0.0.1:3001:127.0.0.1:3001",
                  "project_ayfaar@"+host]
        tunnel = None
        try:
            tunnel = subprocess.Popen(common,env={key:env[key] for key in
                      ("PATH","HOME","LANG","LC_ALL") if key in env},
                      stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                      stderr=subprocess.DEVNULL)
            connected = False
            for _ in range(35):
                require(tunnel.poll() is None,"SSH_TUNNEL_EXIT")
                try:
                    with socket.create_connection(("127.0.0.1",3001),timeout=2):
                        connected = True
                        break
                except OSError:
                    time.sleep(.3)
            require(connected,"STAGE_TUNNEL_UNAVAILABLE")
            result = subprocess.run(["node",str(source)],cwd=str(g0.ROOT),
                        env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                        timeout=390)
            require(len(result.stdout) < 16384,"RECEIPT_SIZE")
            try: data = json.loads(result.stdout.decode("utf8","strict"))
            except (ValueError, UnicodeError):
                raise Gate("RESULT_UNREADABLE") from None
            require(type(data) is dict and
                    result.returncode == 0 and
                    data.get("status") == "C4_PHYSICAL_CORE_PASS"
                    and data.get("cleanup") == "PASS"
                    and data.get("realExternalEffectsIndependentProof") == "NOT_ESTABLISHED"
                    and len(data.get("checks",[])) >= 8,
                    "C4_PHYSICAL_CORE_NOT_PROVEN")
        finally:
            if tunnel is not None:
                tunnel.terminate()
                try: tunnel.wait(timeout=6)
                except subprocess.TimeoutExpired: tunnel.kill();tunnel.wait(timeout=3)
    # Safety re-admission after physical activity.
    verified.probe(e,host,port)
    return {"status":"C4_PHYSICAL_CORE_PASS",
            "reviewedSha":sha,"releaseSha":G0,
            "fixtureCleanup":"PASS","stagingTouched":True,
            "externalEffectsObserved":"NOT_INDEPENDENTLY_PROVEN",
            "fullPhysicalE2E":"NOT_YET_PROVEN"}

def main():
    try:
        print(json.dumps(run(os.environ),sort_keys=True))
        return 0
    except Exception:
        # Never print environment, SSH details, guest contents or raw DB errors.
        print('{"status":"BLOCK","fullPhysicalE2E":"NOT_YET_PROVEN"}')
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
