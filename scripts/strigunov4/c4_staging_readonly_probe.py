"""C4 staging PHYSICAL READ-ONLY preflight; never the booking E2E itself.

Protected workflow only. Its output is deliberately different from C4_FULL_E2E_PASS.
No stage DB writes, record cleanup, messages, real bookings or provider traffic.
"""
import json
import os
from pathlib import Path
import re
import tempfile

import backup_export
import protected_staging_g0_activation as g0
import protected_staging_sql_apply as pg
import g0_release_archive as package

REPO = "ASI-integration/asi-landing"
WORKFLOW = REPO + "/.github/workflows/strigunov4-c4-e2e-acceptance.yml@refs/heads/main"
OWNER = "ASI-integration"
RELEASE = "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
SOURCE_SHA = re.compile(r"[0-9a-f]{40}\Z")
HOST_SCRIPT = r"""
import hashlib,json,os,stat,subprocess,sys,urllib.request,urllib.error
from pathlib import Path
def check(ok,why):
    if not ok: raise RuntimeError(why)
def cmd(*a):
    r=subprocess.run(a,capture_output=True,timeout=12)
    check(r.returncode==0,"SERVICE_READ")
    return r.stdout.decode("utf-8","strict")
try:
    sha=sys.argv[1]
    check(sha=="d912aec6663de90e5ca4293cc5a69e2e0ed9ff94","SOURCE")
    check(os.geteuid()==0 and os.uname().nodename=="asi-agent-runner","HOST")
    root=Path("/var/www/asi-staging")
    link=root/"current"
    current=root/"releases"/sha
    check(link.is_symlink() and link.resolve()==current,"RELEASE_LINK")
    unit=Path("/etc/systemd/system/asi-landing-staging.service")
    check(hashlib.sha256(unit.read_bytes()).hexdigest()=="9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9","UNIT")
    meta=dict(x.split("=",1) for x in cmd("systemctl","show","asi-landing-staging","--property=MainPID,User,Group,WorkingDirectory,EnvironmentFiles,DropInPaths,ActiveState").splitlines() if "=" in x)
    envfile=root/"shared"/".env.staging.local"
    check(meta.get("ActiveState")=="active" and meta.get("User")=="asi-runtime" and meta.get("Group")=="asi-runtime" and meta.get("WorkingDirectory")==str(link) and not meta.get("DropInPaths") and str(envfile) in meta.get("EnvironmentFiles",""),"SERVICE_IDENTITY")
    check(envfile.is_file() and not envfile.is_symlink() and stat.S_IMODE(envfile.stat().st_mode)==0o640,"ENV_PERMISSIONS")
    pid=meta.get("MainPID","")
    check(pid.isdecimal() and int(pid)>1,"PID")
    raw=(Path("/proc")/pid/"environ").read_bytes()
    settings=dict((a.decode("utf8","strict"),b) for i in raw.split(b"\0") if b"=" in i for a,b in [i.split(b"=",1)])
    expected={
        "EMAIL_AUTO_SEND":b"false",
        "EMAIL_DRAFT_ONLY":b"true",
        "DRY_RUN_TELEGRAM_OUTBOUND":b"true",
        "ALLOW_REAL_TELEGRAM_SYNTHETIC":b"false",
        "YOOKASSA_ENABLED":b"false",
        "ASI_SYNTHETIC_NO_SEND":b"YES",
        "ASI_APP_ROOT":b"/var/www/asi-staging/current",
    }
    check(all(settings.get(k)==v for k,v in expected.items()),"EFFECTIVE_NO_SEND")
    base="http://127.0.0.1:3001"
    for endpoint in ("health","version"):
        with urllib.request.urlopen(base+"/api/"+endpoint,timeout=8) as r:
            check(r.status==200,"HEALTH_HTTP")
            data=r.read(65537);check(len(data)<=65536,"HEALTH_SIZE")
            info=json.loads(data)
            if endpoint=="health":check(info.get("ok") is True,"HEALTH")
            else:
                check(info.get("sha")==sha and info.get("environment")=="staging" and info.get("resolvedReleasePath")==str(current),"VERSION")
    routes=(
        ("GET","/api/dashboard/crm/queue"),
        ("GET","/api/dashboard/booking-ops"),
        ("GET","/api/dashboard/booking-ops/alerts"),
        ("POST","/api/dashboard/booking-ops/intake/process"),
        ("POST","/api/dashboard/booking-ops"),
    )
    for method,path in routes:
        data=b"[" if method=="POST" else None
        req=urllib.request.Request(base+path,data=data,method=method,
                                   headers={"Content-Type":"application/json"} if data else {})
        try:
            with urllib.request.urlopen(req,timeout=8) as r: code=r.status
        except urllib.error.HTTPError as e: code=e.code
        check(code==401,"UNAUTHENTICATED_ROUTE")
    print(json.dumps({"status":"C4_READONLY_PREFLIGHT_PASS","releaseSha":sha,
                      "noSendFlags":7,"unauthorizedRoutes":len(routes),
                      "stagingWrites":False,"fullE2E":"NOT_RUN"},sort_keys=True))
except (Exception,) as e:
    # Only report a fixed status; suppress untrusted data and host secrets.
    print('{"status":"BLOCK","fullE2E":"NOT_RUN"}')
    sys.exit(2)
"""

class Block(ValueError):
    pass

def require(ok, name):
    if not ok:
        raise Block(name)

def validate(source):
    pinned = {
        "GITHUB_ACTIONS":"true",
        "GITHUB_REPOSITORY":REPO,
        "GITHUB_EVENT_NAME":"workflow_dispatch",
        "GITHUB_REF":"refs/heads/main",
        "GITHUB_WORKFLOW_REF":WORKFLOW,
        "GITHUB_ACTOR":OWNER,
        "GITHUB_ACTOR_ID":"207600140",
        "GITHUB_TRIGGERING_ACTOR":OWNER,
        "GITHUB_RUN_ATTEMPT":"1",
        "STAGING_SUPABASE_PROJECT_REF":pg.PROJECT,
        "STAGING_SSH_USER":"project_ayfaar",
    }
    for key,expected in pinned.items():
        require(source.get(key)==expected, "CONTEXT_"+key)
    sha=source.get("GITHUB_SHA","")
    require(type(sha) is str and SOURCE_SHA.fullmatch(sha) is not None
            and source.get("GITHUB_WORKFLOW_SHA")==sha
            and source.get("C4_REVIEWED_MAIN_SHA")==sha,"SHA")
    require(source.get("C4_CONFIRM")=="RUN_STRIGUNOV4_C4_PREFLIGHT_"+sha,"CONFIRM")
    require(package.SHA==RELEASE,"RELEASE_PIN")
    require(pg.preflight.target_valid(source.get("STAGING_DATABASE_URL","")),"STAGING_DB")
    host=source.get("STAGING_SSH_HOST","")
    require(type(host) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}",host),"HOST")
    try: port=int(source.get("STAGING_SSH_PORT") or "22")
    except (ValueError,TypeError): raise Block("PORT") from None
    require(1<=port<=65535,"PORT")
    key=source.get("STAGING_SSH_PRIVATE_KEY","")
    require(type(key) is str and len(key)>100,"KEY")
    return sha,host,port

def probe(source,host,port):
    with tempfile.TemporaryDirectory(prefix="c4-stage-readonly-") as dir_name:
        folder=Path(dir_name);folder.chmod(0o700)
        known=backup_export.ssh_identity(folder,host,port)
        key=folder/"key"
        key.write_text(source["STAGING_SSH_PRIVATE_KEY"].rstrip("\n")+"\n",encoding="utf-8")
        key.chmod(0o600)
        env={k:os.environ[k] for k in ("PATH","HOME","LANG","LC_ALL") if k in os.environ}
        args=["ssh","-T","-i",str(key),"-p",str(port),
              "-o","BatchMode=yes","-o","IdentitiesOnly=yes",
              "-o","StrictHostKeyChecking=yes","-o","GlobalKnownHostsFile=none",
              "-o","UserKnownHostsFile="+str(known),"-o","ConnectTimeout=20",
              "project_ayfaar@"+host,"sudo","-n","python3","-",RELEASE]
        result=g0.checked(args,env=env,stdin=HOST_SCRIPT.encode(),timeout=130,allow_nonzero=True)
    try: report=json.loads(result.stdout)
    except (ValueError,UnicodeError): raise Block("REMOTE_JSON") from None
    required={"status":"C4_READONLY_PREFLIGHT_PASS","releaseSha":RELEASE,
              "noSendFlags":7,"unauthorizedRoutes":5,
              "stagingWrites":False,"fullE2E":"NOT_RUN"}
    require(result.returncode==0 and report==required,"REMOTE_NOT_PROVEN")
    return report

def run(source):
    sha,host,port=validate(source)
    local=g0.checked(["git","-C",str(g0.ROOT),"rev-parse","HEAD"]).stdout.decode().strip()
    require(local==sha,"SOURCE_CHECKOUT")
    # Same pinned PG17 TLS verify-full read-only postcheck as the approved G0 installer.
    g0.exact_sql_history(source["STAGING_DATABASE_URL"])
    return probe(source,host,port)

def main():
    try:
        print(json.dumps(run(os.environ),sort_keys=True))
        return 0
    except (Block,pg.Gate,g0.Gate,backup_export.GateError,ValueError,OSError):
        print('{"status":"BLOCK","fullE2E":"NOT_RUN"}')
        return 2

if __name__=="__main__":
    raise SystemExit(main())
