"""Owner-reviewed, staging-only activation of pinned Strigunov4 G0 release.

This code does not mutate a database. A protected main-only GitHub staging
environment is the external authority boundary, not these local strings.
Before any host mutation, independently authenticate exact 99/7/9 staging
migration history over TLS verify-full with the pinned PostgreSQL17 client.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import backup_export
import g0_release_archive as package
import protected_staging_sql_apply as pg
import tls_guard

REPO="ASI-integration/asi-landing"
WORKFLOW=REPO+"/.github/workflows/strigunov4-protected-g0-activation.yml@refs/heads/main"
OWNER="ASI-integration"
OWNER_ID="207600140"
ROOT=Path(__file__).resolve().parents[2]
FULL_SHA=re.compile(r"[a-f0-9]{40}\Z")
RUN_ID=re.compile(r"[1-9][0-9]{0,19}\Z")


class Gate(ValueError):
    pass


def require(ok,reason):
    if not ok:
        raise Gate(reason)


def context(source):
    pinned={
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":REPO,
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_WORKFLOW_REF":WORKFLOW,
        "GITHUB_ACTOR":OWNER,
        "GITHUB_ACTOR_ID":OWNER_ID,
        "GITHUB_TRIGGERING_ACTOR":OWNER,
        "GITHUB_RUN_ATTEMPT":"1",
        "STAGING_SUPABASE_PROJECT_REF":pg.PROJECT,
        "STAGING_SSH_USER":"project_ayfaar",
    }
    for key,value in pinned.items():
        require(source.get(key)==value,"CONTEXT_"+key)
    sha=source.get("GITHUB_SHA","")
    require(FULL_SHA.fullmatch(sha) is not None and
            sha==source.get("GITHUB_WORKFLOW_SHA") and
            sha==source.get("STAGING_REVIEWED_MAIN_SHA"),
            "MAIN_SHA")
    require(source.get("G0_ACTIVATION_CONFIRM")=="ACTIVATE_STRIGUNOV4_G0_"+sha,
            "OWNER_CONFIRM")
    rid=source.get("GITHUB_RUN_ID","")
    require(RUN_ID.fullmatch(rid) is not None,"RUN_ID")
    url=source.get("STAGING_DATABASE_URL","")
    require(type(url) is str and pg.preflight.target_valid(url),"STAGING_DB_SCOPE")
    host=source.get("STAGING_SSH_HOST","")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}",host) is not None,
            "SSH_HOST")
    try:
        port=int(source.get("STAGING_SSH_PORT") or "22")
    except (TypeError,ValueError):
        raise Gate("SSH_PORT") from None
    require(1<=port<=65535,"SSH_PORT")
    key=source.get("STAGING_SSH_PRIVATE_KEY","")
    require(type(key) is str and len(key)>100,"SSH_KEY")
    return sha,rid,url,host,port


def checked(args,*,env=None,stdin=None,timeout=60,allow_nonzero=False):
    try:
        p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                         input=stdin,env=env,timeout=timeout)
    except (OSError,subprocess.TimeoutExpired):
        raise Gate("COMMAND_UNAVAILABLE") from None
    if p.returncode and not allow_nonzero:
        raise Gate("COMMAND_FAILURE")
    return p


def exact_sql_history(url):
    """Post-migration read-only guard only; never call the SQL apply routine."""
    with tempfile.TemporaryDirectory(prefix="strigunov4-g0-readonly-db-") as folder:
        temp=Path(folder)
        temp.chmod(0o700)
        cert=temp/"roots.pem"
        cert.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()
                         + b"\n"+tls_guard.ca_bytes())
        cert.chmod(0o600)
        clean={k:os.environ[k] for k in ("PATH","HOME","LANG","LC_ALL") if k in os.environ}
        checked(["docker","pull",pg.PG_IMAGE],env=clean,timeout=180)
        env=pg.db_environment(url,cert,True)
        result=checked(pg.postgres_client_command(temp,"postcheck"),
                       env=env,timeout=90).stdout
        require(result.decode("utf-8","strict").strip()=="postgres|17|99|7|9",
                "NINE_SQL_NOT_APPLIED")
    return True


def host_source(root=ROOT):
    audit=(Path(root)/"scripts/strigunov4/g0_release_archive.py").read_text("utf-8")
    worker=(Path(root)/"scripts/strigunov4/g0_activation_host.py").read_text("utf-8")
    require(0<len(audit)<30000 and 0<len(worker)<42000,"PINNED_SOURCE_SIZE")
    namespace=(
        "import sys,types\n"
        "m=types.ModuleType('strigunov_g0_archive')\n"
        "exec(compile("+repr(audit)+",'g0_release_archive.py','exec'),m.__dict__)\n"
        "sys.modules['strigunov_g0_archive']=m\n"
    )
    return (namespace+worker).encode("utf-8")


def activate_host(source,sha,rid,host,port,root=ROOT):
    script=host_source(root)
    with tempfile.TemporaryDirectory(prefix="strigunov4-g0-owner-gate-") as folder:
        temp=Path(folder)
        temp.chmod(0o700)
        known=backup_export.ssh_identity(temp,host,port)
        key=temp/"key"
        key.write_text(source["STAGING_SSH_PRIVATE_KEY"].rstrip("\n")+"\n",
                       encoding="utf-8")
        key.chmod(0o600)
        clean={k:os.environ[k] for k in ("PATH","HOME","LANG","LC_ALL") if k in os.environ}
        command=[
            "ssh","-T","-i",str(key),"-p",str(port),
            "-o","BatchMode=yes","-o","IdentitiesOnly=yes",
            "-o","StrictHostKeyChecking=yes","-o","GlobalKnownHostsFile=none",
            "-o","UserKnownHostsFile="+str(known),"-o","ConnectTimeout=20",
            "project_ayfaar@"+host,"sudo","-n","python3","-",rid,sha
        ]
        r=checked(command,env=clean,stdin=script,timeout=480,allow_nonzero=True)
    try:
        status=json.loads(r.stdout)
    except (ValueError,UnicodeError):
        raise Gate("HOST_RESULT_INVALID") from None
    required={
        "status":"STAGING_G0_ACTIVATION_PASS",
        "releaseSha":package.SHA,
        "effectiveNoSend":True,
        "databaseMutation":False,
        "productionTouched":False,
    }
    if r.returncode != 0 or status != required:
        remote_status = status.get("status") if type(status) is dict else None
        # Only known fixed host statuses enter public CI logs; never echo stderr.
        known = ("APPLICATION_ROLLBACK_PASS",
                 "BLOCK_MANUAL_RECOVERY_REQUIRED", "BLOCK")
        safe_status = remote_status if remote_status in known else "UNKNOWN"
        raise Gate("G0_ACTIVATION_NOT_PROVEN_" + safe_status)
    return status


def run(e):
    sha,rid,url,host,port=context(e)
    actual=checked(["git","-C",str(ROOT),"rev-parse","HEAD"]).stdout.decode().strip()
    require(actual==sha,"EXACT_CHECKOUT")
    # Source package is NOT the release archive; the immutable archive lives
    # on the target and is independently checked by the pinned root worker.
    require(package.ARCHIVE_HASH=="030880c750c8fb28cb61ebfbba85e0e23718279e4c165655fcae6a1c2d07c486",
            "ARCHIVE_SOURCE_PIN")
    exact_sql_history(url)  # no host writes before exact DB readiness
    return activate_host(e,sha,rid,host,port)


def main():
    try:
        report=run(os.environ)
        print(json.dumps(report,sort_keys=True))
        return 0
    except (Gate,pg.Gate,backup_export.GateError,OSError,ValueError) as exc:
        # Only stable uppercase error codes can be shown; external errors stay hidden.
        code = str(exc) if type(exc) is Gate else type(exc).__name__
        reason = code if re.fullmatch(r"[A-Z0-9_]{1,120}",code) else "UNKNOWN"
        print(json.dumps({"status":"BLOCK","reason":reason,
                          "databaseMutation":False,"productionTouched":False},
                         sort_keys=True))
        return 2


if __name__=="__main__":
    sys.exit(main())
