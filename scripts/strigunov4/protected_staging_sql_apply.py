"""Protected staging-only nine-SQL apply. NEVER run outside owner-reviewed main.

The external GitHub 'staging' environment approval is the authority boundary.
This script enforces source, host, DB TLS, backup, replay and rollback guards.
It does not deploy an application, touch production or execute guest messages.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlparse

import backup_export
import preflight
import staging_nine_sql_candidate as sqlbuilder
import tls_guard

REPO="ASI-integration/asi-landing"
WORKFLOW=REPO+"/.github/workflows/strigunov4-staging-sql-apply.yml@refs/heads/main"
OWNER="ASI-integration"
OWNER_ID="207600140"
PROJECT="meeravcldnmocjtlqoeu"
MAIN40=re.compile("[0-9a-f]{40}\\Z")
RUNID=re.compile("[1-9][0-9]{0,19}\\Z")
SQL_SHA256="ba963872a534fb1a6852f427372ff81e498e115b92f8a98e899ba2f482e5b959"
SQL_BYTES=55091
LATEST_BACKUP_SHA256="e72aea476efabd3625566759748d6d819c4cea22f12ee0ec483948b41dc5afef"
LATEST_BACKUP_RUN=39023529319
PG_IMAGE=backup_export.PG_IMAGE
ROOT=Path(__file__).resolve().parents[2]
PRESERVED=tuple(sqlbuilder.PRESERVE)
SELECTED=tuple(sqlbuilder.VERSIONS)

class Gate(Exception):
    pass

def require(ok, code):
    if not ok: raise Gate(code)

def validate_context(e):
    values={
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":REPO,
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_WORKFLOW_REF":WORKFLOW,
        "GITHUB_ACTOR":OWNER,
        "GITHUB_ACTOR_ID":OWNER_ID,
        "GITHUB_TRIGGERING_ACTOR":OWNER,
        "GITHUB_RUN_ATTEMPT":"1",
        "STAGING_SUPABASE_PROJECT_REF":PROJECT,
        "STAGING_SSH_USER":"project_ayfaar",
    }
    for key,want in values.items():
        require(e.get(key)==want, "CONTEXT_"+key)
    sha=e.get("GITHUB_SHA","")
    require(MAIN40.fullmatch(sha) is not None
            and sha==e.get("GITHUB_WORKFLOW_SHA")
            and sha==e.get("STAGING_REVIEWED_MAIN_SHA"),"MAIN_SHA")
    require(e.get("STAGING_SQL_CONFIRM")=="APPLY_STRIGUNOV4_NINE_SQL_"+sha,"CONFIRM")
    rid=e.get("GITHUB_RUN_ID","")
    require(RUNID.fullmatch(rid) is not None,"RUN_ID")
    url=e.get("STAGING_DATABASE_URL","")
    require(type(url) is str and preflight.target_valid(url),"STAGING_DATABASE_IDENTITY")
    host=e.get("STAGING_SSH_HOST","")
    require(re.fullmatch("[A-Za-z0-9][A-Za-z0-9.-]{0,252}",host) is not None,"SSH_HOST")
    try: port=int(e.get("STAGING_SSH_PORT") or "22")
    except (ValueError,TypeError): raise Gate("SSH_PORT") from None
    require(1<=port<=65535,"SSH_PORT")
    require(type(e.get("STAGING_SSH_PRIVATE_KEY")) is str
            and len(e.get("STAGING_SSH_PRIVATE_KEY",""))>100,"SSH_SECRET_MISSING")
    return sha,rid,url,host,port

def call(args, *, env=None, input_data=None,timeout=60):
    try:
        result=subprocess.run(args,env=env,input=input_data,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                              timeout=timeout)
    except (OSError,subprocess.TimeoutExpired):
        raise Gate("COMMAND_UNAVAILABLE_OR_TIMED_OUT") from None
    require(result.returncode==0,"COMMAND_FAILED")
    return result.stdout

def build_candidate(root=ROOT):
    sql=sqlbuilder.render(root)
    raw=sql.encode("utf-8")
    require(len(raw)==SQL_BYTES
            and hashlib.sha256(raw).hexdigest()==SQL_SHA256
            and raw.rstrip().endswith(b"COMMIT;"),"NINE_SQL_SOURCE_DRIFT")
    return raw

def host_script(root=ROOT):
    reviewed=(Path(root)/"scripts/strigunov4/protected_staging_host_probe.py").read_text(encoding="utf-8")
    precheck=(Path(root)/"scripts/strigunov4/staging_sql_host_admission.py").read_text(encoding="utf-8")
    require(0<len(reviewed)<=20000 and 0<len(precheck)<=18000,"HOST_SCRIPT_SIZE")
    # The reviewed probe is imported under a non-main name, without its CLI.
    prelude=(
        "import sys,types\n"
        "m=types.ModuleType('strigunov_reviewed_probe')\n"
        "exec(compile("+repr(reviewed)+",'strigunov_reviewed_probe.py','exec'),m.__dict__)\n"
        "sys.modules['strigunov_reviewed_probe']=m\n"
    )
    return (prelude+precheck).encode()

def check_host(e,host,port,root=ROOT):
    script=host_script(root)
    with tempfile.TemporaryDirectory(prefix="strigunov4-sql-host-admission-") as temp:
        folder=Path(temp)
        folder.chmod(0o700)
        known=backup_export.ssh_identity(folder,host,port)
        key=folder/"id_ed25519"
        key.write_text(e["STAGING_SSH_PRIVATE_KEY"].rstrip("\n")+"\n",encoding="utf-8")
        key.chmod(0o600)
        clean={k:os.environ[k] for k in ("PATH","HOME","LANG","LC_ALL") if k in os.environ}
        raw=call(["ssh","-T","-i",str(key),"-p",str(port),
                  "-o","BatchMode=yes","-o","IdentitiesOnly=yes",
                  "-o","StrictHostKeyChecking=yes",
                  "-o","GlobalKnownHostsFile=none",
                  "-o","UserKnownHostsFile="+str(known),
                  "-o","ConnectTimeout=20",
                  "project_ayfaar@"+host,"python3","-"],
                 env=clean,input_data=script,timeout=180)
    try: report=json.loads(raw)
    except (ValueError,UnicodeError): raise Gate("HOST_RESULT_INVALID") from None
    require(report=={"status":"STAGING_SQL_ADMISSION_PASS",
                      "backup_verified":True,"archive_verified":True,
                      "no_send_ready":True,"old_release_verified":True},
            "HOST_BACKUP_OR_NO_SEND_BLOCK")
    return True

def db_environment(url, rootfile, read_only):
    parsed=urlparse(url)
    require(parsed.hostname and parsed.username and parsed.password,"DATABASE_SECRET_URL")
    clean={k:os.environ[k] for k in ("PATH","HOME","LANG","LC_ALL") if k in os.environ}
    clean.update({
        "PGHOST":parsed.hostname,
        "PGPORT":str(parsed.port or 5432),
        "PGUSER":unquote(parsed.username),
        "PGPASSWORD":unquote(parsed.password),
        "PGDATABASE":"postgres",
        "PGSSLMODE":"verify-full",
        "PGSSLROOTCERT":"/work/roots.pem",
        "PGCONNECT_TIMEOUT":"15",
        "PGOPTIONS":("-c default_transaction_read_only=on -c statement_timeout=30000"
                     " -c lock_timeout=3000" if read_only else
                     "-c default_transaction_read_only=off -c statement_timeout=650000"
                     " -c lock_timeout=5000"),
    })
    require("jwinifeienvzejofmbua" not in clean["PGHOST"]
            and PROJECT in url,"WRONG_DB_PROJECT")
    return clean

def postgres_client_command(work, operation, sqlfile=None):
    require(operation in ("preflight","apply","postcheck"),"UNKNOWN_DB_ACTION")
    uid=os.getuid()
    gid=os.getgid()
    cmd=["docker","run","--rm","--pull=never","--network","host",
         "--user",f"{uid}:{gid}","--read-only","--cap-drop=ALL",
         "--security-opt","no-new-privileges","--tmpfs","/tmp:rw,nosuid,noexec,size=16m",
         "--mount",f"type=bind,src={str(work)},dst=/work,readonly"]
    for k in ("PGHOST","PGPORT","PGUSER","PGPASSWORD","PGDATABASE",
              "PGSSLMODE","PGSSLROOTCERT","PGCONNECT_TIMEOUT","PGOPTIONS"):
        cmd+=["-e",k]
    cmd+=[PG_IMAGE,"psql","-X","--no-psqlrc","-A","-t","--set","ON_ERROR_STOP=1"]
    if operation=="apply":
        require(sqlfile=="/work/nine.sql","REVIEWED_APPLY_FILE_ONLY")
        cmd+=["-q","--file",sqlfile]
    else:
        preserve=",".join("'"+v+"'" for v in PRESERVED)
        selected=",".join("'"+v+"'" for v in SELECTED)
        expected="99" if operation=="postcheck" else "90"
        result="9" if operation=="postcheck" else "0"
        query=("SELECT current_database()||'|'||"
               "(current_setting('server_version_num')::int/10000)::text||'|'||"
               "(SELECT count(*) FROM supabase_migrations.schema_migrations)::text||'|'||"
               f"(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ({preserve}))::text||'|'||"
               f"(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ({selected}))::text;")
        cmd+=["-c",query]
    return cmd

def postgres_stage(e,url,source):
    # Source must be pinned before *any* DB connection.
    require(len(source)==SQL_BYTES and hashlib.sha256(source).hexdigest()==SQL_SHA256,
            "SQL_SOURCE_NOT_PINNED")
    with tempfile.TemporaryDirectory(prefix="strigunov4-protected-sql-") as temp:
        work=Path(temp)
        work.chmod(0o700)
        cert=work/"roots.pem"
        cert.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()
                         + b"\n" + tls_guard.ca_bytes())
        cert.chmod(0o600)
        sqlfile=work/"nine.sql"
        sqlfile.write_bytes(source)
        sqlfile.chmod(0o600)
        clean={k:os.environ[k] for k in ("PATH","HOME","LANG","LC_ALL") if k in os.environ}
        call(["docker","pull",PG_IMAGE],env=clean,timeout=180)
        read_env=db_environment(url,cert,True)
        before=call(postgres_client_command(work,"preflight"),env=read_env,timeout=75)
        require(before.decode().strip()=="postgres|17|90|7|0","LIVE_CATALOG_OR_HISTORY_DRIFT")
        write_env=db_environment(url,cert,False)
        try:
            call(postgres_client_command(work,"apply","/work/nine.sql"),
                 env=write_env,timeout=700)
        except Gate:
            raise Gate("SQL_APPLY_RESULT_UNKNOWN_OR_REJECTED") from None
        after=call(postgres_client_command(work,"postcheck"),env=read_env,timeout=75)
        require(after.decode().strip()=="postgres|17|99|7|9","POST_APPLY_HISTORY_REQUIRES_REVIEW")
    return {"status":"STAGING_NINE_SQL_APPLIED","registered":9,
            "sourceSha256":SQL_SHA256,"backupRun":LATEST_BACKUP_RUN,
            "hostNoSendVerified":True,"applicationDeployed":False}

def main():
    try:
        e=os.environ
        sha,rid,url,host,port=validate_context(e)
        head=call(["git","-C",str(ROOT),"rev-parse","HEAD"]).decode().strip()
        require(head==sha,"CHECKOUT_HEAD")
        source=build_candidate()
        check_host(e,host,port)
        result=postgres_stage(e,url,source)
        result.update({"reviewedMainSha":sha,"runId":rid})
        print(json.dumps(result,sort_keys=True))
        return 0
    except Gate as error:
        print(json.dumps({"status":"BLOCK","reason":str(error),
                          "applicationDeployed":False},sort_keys=True))
        return 2
    except Exception:
        print('{"status":"BLOCK","reason":"PROTECTED_SQL_APPLY_UNEXPECTED","applicationDeployed":false}')
        return 2

if __name__=="__main__":
    sys.exit(main())
