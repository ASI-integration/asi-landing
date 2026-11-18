#!/usr/bin/env python3
"""PR664 owner-controlled no-send stage promotion; never automatically scheduled."""
import argparse, fcntl, hashlib, json, os, pathlib, subprocess, sys, tarfile, posixpath, time
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError

SHA="c1746cc8e199a0ad9d3598b37d2fa952fea8e214"
SOURCE_PR_HEAD="0266587e4e6337968f093c20f05d0b4b35aac5f8"
ARTSHA="3cbbf031a681bffe03b2ab74d53ea1ea2a65fd7b616d19eb752932e6a310aa7e"
MANSHA="cd81fd64de94fcc6a4111e81197f4748484dfb10b94f31e763e7b7c0309e5821"
BASE=pathlib.Path("/home/administrator/asi-v11-candidate")
SRC=BASE/"onecom-g2-clean-build-c1746cc8-20261118"
ART=BASE/"release-artifacts-c1746cc8-20261118"
ARCHIVE=ART/"asi-strigunov-main-c1746cc8e199.tar.gz"
MANIFEST=ART/"RELEASE-CANDIDATE-MANIFEST-c1746cc8-20261118.json"
STAGE=pathlib.Path("/srv/asi-strigunov-stage")
CURRENT=STAGE/"current"
TARGET=STAGE/"releases/asi-stage-main-c1746cc8e199"
LOCK=BASE/"integration/owner-pr664-promotion.lock"
SERVICE="asi-strigunov-stage.service"
FLAGS={"ASI_APP_ROOT":str(CURRENT),"ASI_DEPLOY_ENV":"staging",
"ASI_SYNTHETIC_NO_SEND":"YES","EMAIL_AUTO_SEND":"false",
"EMAIL_DRAFT_ONLY":"true","DRY_RUN_TELEGRAM_OUTBOUND":"true",
"ALLOW_REAL_TELEGRAM_SYNTHETIC":"false","YOOKASSA_ENABLED":"false",
"LLM_ENABLED":"false","TELEGRAM_GUEST_AGENT_MODE":"off"}

class Blocked(RuntimeError): pass

def cmd(*args,timeout=30):
    try:r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout)
    except (OSError,subprocess.TimeoutExpired) as e:raise Blocked("CMD_UNAVAILABLE") from e
    if r.returncode:raise Blocked("CMD_FAILED")
    return r.stdout.decode("utf8","replace").strip()

def hashfile(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(4*1024*1024),b""):h.update(b)
    return h.hexdigest()

def gh(*args):
    try:return json.loads(cmd("runuser","-u","administrator","--","gh",*args))
    except (Blocked,ValueError) as e:raise Blocked("GITHUB_API_UNAVAILABLE") from e

def get(path):
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,*a,**k):return None
    try:res=build_opener(NoRedirect).open(Request("http://127.0.0.1:3001"+path,method="GET"),timeout=5)
    except HTTPError as e:res=e
    with res:return res.status,res.read(8192) if path=="/api/version" else b""

def verify_artifact():
    if hashfile(ARCHIVE)!=ARTSHA or hashfile(MANIFEST)!=MANSHA:raise Blocked("SEALED_HASH_DRIFT")
    m=json.loads(MANIFEST.read_text("utf8"))
    if (m.get("source_sha")!=SHA or m.get("source_pr_head")!=SOURCE_PR_HEAD or
        m.get("source_pr")!=664 or m.get("archive_name")!=ARCHIVE.name or
        m.get("artifact_sha256")!=ARTSHA or
        m.get("release_state")!="SEALED_CANDIDATE_NOT_PROMOTED" or
        m.get("stage_release_promoted") is not False):raise Blocked("MANIFEST_DRIFT")
    if cmd("runuser","-u","administrator","--","git","-C",str(SRC),"rev-parse","HEAD")!=SHA:raise Blocked("SOURCE_HEAD_DRIFT")
    if cmd("runuser","-u","administrator","--","git","-C",str(SRC),"ls-files","-m"):raise Blocked("DIRTY_TRACKED_FILES")
    if json.loads((SRC/"release/release-meta.json").read_text())!={"gitSha":SHA}:raise Blocked("VERSION_METADATA_DRIFT")
    if not (SRC/".next/BUILD_ID").is_file():raise Blocked("BUILD_MISSING")
    return m

def verify_archive_members():
    # Pre-scan the pinned gzip tar stream; no unreviewed extraction.
    names=set()
    try:
        with tarfile.open(ARCHIVE,mode="r|gz") as arc:
            for obj in arc:
                n=obj.name.removeprefix("./")
                if not n:continue
                if (n.startswith("/") or posixpath.normpath(n)!=n.rstrip("/") or
                    n in names or not (obj.isfile() or obj.isdir() or obj.issym())):
                    raise Blocked("UNSAFE_TAR_PATH")
                names.add(n)
                if n==".git" or n.startswith(".git/") or n in (".env",".env.local",".env.production",".npmrc"):
                    raise Blocked("UNREVIEWED_ARCHIVE_CONTENT")
                if obj.issym():
                    dest=posixpath.normpath(posixpath.join(posixpath.dirname(n),obj.linkname))
                    if obj.linkname.startswith("/") or dest==".." or dest.startswith("../"):
                        raise Blocked("LINK_ESCAPE")
    except (tarfile.TarError,EOFError,OSError) as e:
        raise Blocked("ARCHIVE_UNREADABLE") from e
    if not {".next/BUILD_ID","release-meta.json","node_modules/next/package.json"}.issubset(names):
        raise Blocked("ARCHIVE_INCOMPLETE")
    return len(names)

def verify_stage():
    if not CURRENT.is_symlink():raise Blocked("STAGING_LINK_CHANGED")
    previous=CURRENT.resolve(strict=True)
    release_dir=(STAGE/"releases").resolve(strict=True)
    if previous.parent!=release_dir or not previous.is_dir() or previous==TARGET:
        raise Blocked("STAGING_RELEASE_PATH_UNVERIFIED")
    if TARGET.exists() or TARGET.is_symlink():raise Blocked("TARGET_ALREADY_EXISTS")
    data=cmd("systemctl","show",SERVICE,"-p","ActiveState","-p","MainPID","-p","User","-p","WorkingDirectory")
    fields=dict(s.split("=",1) for s in data.splitlines() if "=" in s)
    if (fields.get("ActiveState")!="active" or fields.get("User")!="asi-strigunov-stage" or
        fields.get("WorkingDirectory")!=str(CURRENT)):raise Blocked("STAGE_SYSTEMD_DRIFT")
    pid=int(fields.get("MainPID") or 0)
    if pid<=1:raise Blocked("STAGE_PID_MISSING")
    raw=(pathlib.Path("/proc")/str(pid)/"environ").read_bytes()
    env=dict(s.split(b"=",1) for s in raw.split(bytes([0])) if b"=" in s)
    if any(env.get(k.encode())!=v.encode() for k,v in FLAGS.items()):raise Blocked("NO_SEND_POLICY_DRIFT")
    if get("/api/health")[0]!=200:raise Blocked("LIVE_HEALTH_NOT_READY")
    return str(previous)

def verify_github():
    repo="ASI-integration/asi-landing"
    pr=gh("pr","view","664","--repo",repo,"--json","state,isDraft,reviewDecision,headRefOid,baseRefName,author,mergeCommit")
    blockers=[]
    if pr.get("state")!="MERGED" or pr.get("isDraft") is not False:
        blockers.append("PR664_NOT_MERGED")
    if (pr.get("headRefOid")!=SOURCE_PR_HEAD or pr.get("baseRefName")!="main" or
        (pr.get("mergeCommit") or {}).get("oid")!=SHA):
        blockers.append("PR664_MERGE_SOURCE_NOT_PINNED")
    # GitHub clears reviewDecision after merge; trust only independently approved exact-head reviews below.
    if pr.get("state")!="MERGED" and pr.get("reviewDecision")!="APPROVED":
        blockers.append("PR664_REVIEW_NOT_APPROVED")
    rev=gh("api",f"repos/{repo}/pulls/664/reviews","--paginate")
    author=(pr.get("author") or {}).get("login")
    latest={}
    for r in rev:
        who=(r.get("user") or {}).get("login")
        if who:latest[who]=r
    if not any(r.get("state")=="APPROVED" and r.get("commit_id")==SOURCE_PR_HEAD and who!=author for who,r in latest.items()):
        blockers.append("INDEPENDENT_SHA_REVIEW_MISSING")
    runs=gh("api",f"repos/{repo}/actions/runs","-X","GET","-f",f"head_sha={SOURCE_PR_HEAD}","-f","per_page=100").get("workflow_runs",[])
    if not any(x.get("name")=="PR Validation" and x.get("head_sha")==SOURCE_PR_HEAD and
        x.get("event")=="pull_request" and x.get("conclusion")=="success" for x in runs):
        blockers.append("NATIVE_PR_CI_NOT_PASSED")
    if not any(x.get("name")=="ASI trusted release governance" and x.get("head_sha")==SOURCE_PR_HEAD and
        x.get("event") in ("pull_request","pull_request_target") and
        x.get("conclusion")=="success" for x in runs):
        blockers.append("TRUSTED_RELEASE_NOT_APPROVED")
    compare=gh("api",f"repos/{repo}/compare/{SHA}...main")
    if compare.get("status") not in ("ahead","identical"):
        blockers.append("SEALED_MAIN_SOURCE_NOT_ANCESTOR")
    return blockers

def verify_publisher_review():
    """A privileged publisher cannot authorize its own unreviewed source."""
    import base64
    repo="ASI-integration/asi-landing"
    pp=gh("pr","view","665","--repo",repo,
          "--json","state,isDraft,reviewDecision,headRefOid,author,baseRefName")
    head=pp.get("headRefOid","")
    blockers=[]
    if pp.get("state")!="MERGED" or pp.get("isDraft") is not False or pp.get("baseRefName")!="main":
        blockers.append("PR665_PUBLISHER_NOT_MERGED_TO_MAIN")
    # GitHub clears reviewDecision after merge; exact independent reviews below
    # remain mandatory and are stronger than a merged PR's presentation field.
    if pp.get("state")!="MERGED" and pp.get("reviewDecision")!="APPROVED":
        blockers.append("PR665_PUBLISHER_NOT_APPROVED")
    reviews=gh("api",f"repos/{repo}/pulls/665/reviews","--paginate")
    author=(pp.get("author") or {}).get("login")
    latest={}
    for r in reviews:
        who=(r.get("user") or {}).get("login")
        if who:latest[who]=r
    if not any(r.get("state")=="APPROVED" and r.get("commit_id")==head
               and who!=author for who,r in latest.items()):
        blockers.append("PR665_INDEPENDENT_REVIEW_MISSING")
    path="scripts/strigunov4/owner_pr664_promotion_v2.py"
    entry=gh("api",f"repos/{repo}/contents/{path}","-X","GET","-f",f"ref={head}")
    reviewed=base64.b64decode(entry.get("content","")).decode("utf8").replace("\r\n","\n")
    installed=pathlib.Path(__file__).read_text("utf8").replace("\r\n","\n")
    if reviewed.strip()!=installed.strip():
        blockers.append("PUBLISHER_SOURCE_NOT_APPROVED")
    ci=gh("api",f"repos/{repo}/actions/runs","-X","GET",
          "-f",f"head_sha={head}","-f","per_page=100")
    if not any(x.get("name")=="PR Validation" and x.get("head_sha")==head and
               x.get("event")=="pull_request" and x.get("conclusion")=="success"
               for x in ci.get("workflow_runs",[])):
        blockers.append("PR665_NATIVE_CI_NOT_PASSED")
    return blockers

def assert_fresh_release_authority():
    """Do not reuse a preflight's earlier review/CI result after owner input.

    GitHub is re-read immediately before any privileged staging switch. The
    previously checked immutable source and publisher must still be approved,
    pass native CI and satisfy current-main ancestry. A remote error is fatal.
    """
    blockers=verify_github()+verify_publisher_review()
    if blockers:raise Blocked("RELEASE_AUTHORITY_REVOKED_OR_STALE")


def preflight():
    blockers=[];ok=[]
    for name,fn in (("ARTIFACT",verify_artifact),("ARCHIVE",verify_archive_members),
                    ("STAGING",verify_stage)):
        try:fn();ok.append(name)
        except (Blocked,ValueError,OSError,KeyError) as e:blockers.append(name+"_"+(str(e) if isinstance(e,Blocked) else "CHECK_FAILED"))
    try:blockers.extend(verify_github())
    except (Blocked,ValueError,OSError):blockers.append("GITHUB_UNVERIFIED")
    try:blockers.extend(verify_publisher_review())
    except (Blocked,ValueError,OSError,KeyError):blockers.append("PUBLISHER_CODE_REVIEW_UNVERIFIED")
    return {"schema":"asi.pr664.owner-promotion-v2","source_sha":SHA,
        "artifact_sha256":ARTSHA,"checks_passed":ok,"blockers":sorted(set(blockers)),
        "status":"BLOCKED" if blockers else "READY_FOR_OWNER_CONFIRMATION",
        "stage_mutations":0,"g2_g6_physical":"NOT_RUN"}

def postcheck():
    for _ in range(18):
        try:
            status,body=get("/api/version")
            if status==200 and get("/api/health")[0]==200:
                v=json.loads(body)
                if (v.get("sha")==SHA and v.get("appRoot")==str(CURRENT) and
                    v.get("resolvedReleasePath")==str(TARGET) and
                    all(get(p)[0]==401 for p in ("/api/dashboard/booking-ops",
                    "/api/dashboard/booking-ops/alerts","/api/dashboard/crm/queue"))):return
        except (OSError,URLError,ValueError,KeyError):pass
        time.sleep(2)
    raise Blocked("POST_SWITCH_VERSION_OR_AUTH_FAIL")

def switch(path,name):
    temp=STAGE/(".owner-pr664-"+name+"-"+SHA[:12])
    if temp.exists() or temp.is_symlink():raise Blocked("TEMP_LINK_EXISTS")
    temp.symlink_to(path)
    os.replace(temp,CURRENT)
    # Caller records that the link switched BEFORE attempting service restart.

def promote():
    if os.geteuid()!=0 or not sys.stdin.isatty():raise Blocked("DIRECT_OWNER_INTERACTIVE_ROOT_TTY_REQUIRED")
    with LOCK.open("a+b") as f:
        try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Blocked("PROMOTION_ALREADY_RUNNING")
        report=preflight()
        if report["status"]!="READY_FOR_OWNER_CONFIRMATION":return report
        phrase="PROMOTE-PR664-"+SHA[:12]+"-"+ARTSHA[:12]
        print("Staging only, no-send. Old release retained. Exact approval: "+phrase,flush=True)
        if input("Owner confirmation: ").strip()!=phrase:raise Blocked("OWNER_DID_NOT_AUTHORIZE")
        previous=pathlib.Path(verify_stage());verify_artifact();verify_archive_members()
        assert_fresh_release_authority()
        TARGET.mkdir(mode=0o700)
        changed=False
        try:
            cmd("tar","--no-same-owner","--no-same-permissions",
                "-xzf",str(ARCHIVE),"-C",str(TARGET),timeout=300)
            if json.loads((TARGET/"release-meta.json").read_text())!={"gitSha":SHA}:
                raise Blocked("EXTRACTED_METADATA_DRIFT")
            cmd("chown","-R","asi-strigunov-stage:asi-strigunov-stage",str(TARGET),timeout=300)
            # Closing the review/CI TOCTOU gap: never trust a result fetched
            # before potentially lengthy extraction/chown or owner input.
            assert_fresh_release_authority()
            if not CURRENT.is_symlink() or CURRENT.resolve()!=previous:
                raise Blocked("STAGING_LINK_CHANGED_BEFORE_SWITCH")
            switch(TARGET,"new");changed=True
            cmd("systemctl","restart",SERVICE,timeout=90)
            postcheck()
            return {"status":"PROMOTED_STAGING_ONLY","sha":SHA,"g2_acceptance":"NOT_RUN"}
        except Exception as exc:
            if changed:
                try:
                    switch(previous,"rollback")
                    cmd("systemctl","restart",SERVICE,timeout=90)
                    for attempt in range(12):
                        try:
                            if get("/api/health")[0]==200:break
                        except (OSError,URLError):pass
                        time.sleep(2)
                    else:raise Blocked("ROLLBACK_HEALTH_UNVERIFIED")
                except Exception:raise Blocked("ROLLBACK_UNVERIFIED") from exc
                raise Blocked("PROMOTION_FAILED_ROLLED_BACK") from exc
            raise Blocked("PROMOTION_FAILED_BEFORE_SWITCH") from exc

def main():
    ap=argparse.ArgumentParser()
    mode=ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight",action="store_true")
    mode.add_argument("--promote",action="store_true")
    args=ap.parse_args()
    try:
        output=preflight() if args.preflight else promote()
        print(json.dumps(output,sort_keys=True,indent=2))
        return 0 if output["status"] not in ("BLOCKED",) else 2
    except (Blocked,OSError) as e:
        print(json.dumps({"status":"BLOCKED","reason":str(e),"staging_not_accepted":True}))
        return 2

if __name__=="__main__":sys.exit(main())
