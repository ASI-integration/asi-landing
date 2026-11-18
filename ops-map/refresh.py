#!/usr/bin/env python3
"""Refresh confirmed ASI milestones from GitHub and private staging receipts.

The checked-in JSON on asi/ops-map-live is the same material state published
by the VPS. Push occurs only after a material change; no branch protection bypass.
"""
from datetime import datetime, timezone
from pathlib import Path
import json, os, subprocess, tempfile

REPO = "ASI-integration/asi-landing"
BRANCH = "asi/ops-map-live"
PUBLIC = Path("/opt/asi-ops-map/ops-map-status.json")
SOURCE = Path("/home/administrator/asi-ops-map-source")
REPO_FILE = SOURCE / "ops-map-status.json"
ACCEPT = Path("/home/administrator/asi-v11-candidate/ops-map-acceptance.json")
STAGE = Path("/srv/asi-strigunov-stage/current")

def run(*cmd, timeout=25, cwd=None):
    result = subprocess.run(list(cmd), cwd=cwd, capture_output=True,
                            text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError("Источник данных временно недоступен: " + str(cmd[0]))
    return result.stdout.strip()

def api(path):
    return json.loads(run("gh","api",f"repos/{REPO}/{path}"))

def pr(number):
    p = api(f"pulls/{number}")
    return {"merged": bool(p.get("merged")), "head":p["head"]["sha"],
            "updated":p.get("updated_at", ""), "merge":p.get("merge_commit_sha","")}

def owner_approved(head):
    # Read-only, exact literal match; do not emit owner names or comments to the web.
    comments = api("issues/665/comments?per_page=100")
    literal = f"ASI-OWNER-APPROVE:RELEASE-EXCEPTION:665:{head}"
    return any(x.get("body","").strip()==literal and
               x.get("user",{}).get("login")=="ASI-integration" for x in comments)

def acceptance(main_sha):
    # Privileged local receipt is never editable through the public server.
    try:
        if not ACCEPT.is_file(): return 0
        receipt=json.loads(ACCEPT.read_text(encoding="utf-8"))
        if (receipt.get("mode")!="no-send" or
            receipt.get("sourceSha")!=main_sha or receipt.get("verified") is not True):
            return 0
        passed=receipt.get("passed",[])
        return 20*len(set(passed).intersection({"G2","G3","G4","G5","G6"}))
    except (OSError,ValueError,TypeError):
        return 0

def stage_running():
    try:
        return run("systemctl","is-active","asi-strigunov-stage.service",timeout=5)=="active"
    except (RuntimeError,subprocess.TimeoutExpired):
        return False

def build():
    main=api("git/ref/heads/main")["object"]["sha"]
    p658,p664,p665,p669=[pr(n) for n in (658,664,665,669)]
    # Also detect any newly closed PR, not just the four milestone PRs.
    recently_closed=api("pulls?state=closed&sort=updated&direction=desc&per_page=30")
    last_closed=max(recently_closed, key=lambda item:item.get("closed_at") or "",
                    default={})
    done=sum((p658["merged"],p664["merged"],p665["merged"],p669["merged"]))
    pipeline=100 if p665["merged"] else 95 if p658["merged"] and p664["merged"] else 75 if p658["merged"] else 55
    pilot=acceptance(main) if p665["merged"] else 0
    if not p665["merged"]:
        status=("Подтвердить финальный выпуск проверенного кода"
                if not owner_approved(p665["head"])
                else "Подтвердить безопасное включение тестового стенда после выпуска")
    elif pilot<100:
        status="Подтвердить безопасный запуск и полный тест аренды"
    else:
        status="Согласовать запуск первого реального объекта"
    # A green autonomous badge requires verified production autonomy, which
    # current CI and a merely active stage process do not demonstrate.
    health={"stagingAlive":stage_running(),"verifiedAutonomous":False}
    summary=(f"Выпущено {done} из 4 ключевых изменений. " +
            ("Проверяем весь цикл аренды." if p665["merged"] else "Готовим финальный выпуск конвейера."))
    return {"schema":"asi.ops-map.v1","updatedAt":None,
        "source":{"repository":REPO,"branch":BRANCH,"mainSha":main},
        "header":{"state":"owner","reason":status},
        "summary":summary,"currentStage":3 if p665["merged"] else 2,
        "stages":[
            {"percent":100,"detail":"Ядро, база и исполнители подключены"},
            {"percent":pipeline,"detail": "Проверки и сборка готовятся к выпуску" if not p665["merged"] else "Проверенный конвейер собран"},
            {"percent":pilot,"detail":"Тест: обращение, бронь, документы, уборка, отчёт"},
            {"percent":0,"detail":"Реальные объекты ещё не запущены"},
            {"percent":0,"detail":"Новые направления пока в планах"}],
        "health":health,
        "facts":{"pr658Merged":p658["merged"],"pr664Merged":p664["merged"],
                 "pr665Merged":p665["merged"],"pr669Merged":p669["merged"],
                 "lastClosedPr":last_closed.get("number"),
                 "lastClosedAt":last_closed.get("closed_at"),
                 "lastClosedMerged":bool(last_closed.get("merged_at"))}}

def atomic_write(path, raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd, temp=tempfile.mkstemp(prefix=".status-", dir=str(path.parent))
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def main():
    new=build()
    try: prior=json.loads(PUBLIC.read_text(encoding="utf-8"))
    except (OSError,ValueError): prior={}
    # Comparing without timestamp ensures no noisy commit every minute.
    old=dict(prior);old.pop("updatedAt",None)
    comparison=dict(new);comparison.pop("updatedAt",None)
    if old==comparison:
        return
    new["updatedAt"]=datetime.now(timezone.utc).isoformat()
    raw=json.dumps(new,ensure_ascii=False,indent=2,sort_keys=True)+"\n"
    atomic_write(PUBLIC,raw)
    if SOURCE.is_dir() and run("git","branch","--show-current",cwd=SOURCE)==BRANCH:
        atomic_write(REPO_FILE,raw)
        run("git","add","--","ops-map-status.json",cwd=SOURCE)
        changes=subprocess.run(["git","diff","--cached","--quiet"],cwd=SOURCE,check=False)
        if changes.returncode==1:
            run("git","commit","-m","data(roadmap): refresh verified project milestones",cwd=SOURCE)
            run("git","push","origin",BRANCH,cwd=SOURCE,timeout=50)

if __name__=="__main__":
    main()
