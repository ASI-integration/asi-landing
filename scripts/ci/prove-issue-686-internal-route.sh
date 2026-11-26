#!/bin/bash
# End-to-end route through the installed run_checks and _create_verified_draft.
# Git push and the GitHub API are simulated. No production ledger, Gold, or spend.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
SNAPSHOT=${ASI_ISSUE_686_RUNTIME_SNAPSHOT:?}
[[ -f "$SNAPSHOT/local_ci.py" && -f "$SNAPSHOT/pr_publisher.py" && -f "$SNAPSHOT/issue_intake.py" ]]
python3 - "$SNAPSHOT" "$ROOT/runtime" <<'PY'
import pathlib, sys
snapshot, runtime = map(pathlib.Path, sys.argv[1:])
runtime.mkdir(parents=True)
local = (snapshot / "local_ci.py").read_text(encoding="utf-8")
old = 'sys.path.insert(0,"/home/administrator/asi-continuous")'
new = 'sys.path.insert(0, os.environ["ASI_RUNTIME_ROOT"])'
if old not in local:
    raise SystemExit("LOCAL_CI_IMPORT_PATH")
(runtime / "local_ci.py").write_text(local.replace(old, new, 1), encoding="utf-8")
for name in ("pr_publisher.py", "issue_intake.py"):
    (runtime / name).write_text((snapshot / name).read_text(encoding="utf-8"), encoding="utf-8")
(runtime / "asi_continuous.py").write_text("""
import os
import sqlite3
from pathlib import Path
BASE = Path(os.environ["ASI_ISSUE_686_FIXTURE_BASE"])
ROOT = Path(os.environ["ASI_ISSUE_686_FIXTURE_ROOT"])
DB = Path(os.environ["ASI_ISSUE_686_FIXTURE_DB"])
FINANCE_TASK_PATH_PREFIX = "src/lib/ota-finance/__tests__/"
FINANCE_TASK_PIN_SHA = "08d05b55d1abcec341d3ca0dca87f9900ff65485"

def atomic(c, fn):
    c.execute("BEGIN IMMEDIATE")
    try:
        value = fn(c)
        c.execute("COMMIT")
        return value
    except BaseException:
        c.execute("ROLLBACK")
        raise

def con():
    c = sqlite3.connect(DB, timeout=30, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=30000")
    return c
""", encoding="utf-8")
PY
export ASI_RUNTIME_ROOT=$ROOT/runtime
export ASI_ISSUE_686_FIXTURE_BASE=$ROOT/base
export ASI_ISSUE_686_FIXTURE_ROOT=$ROOT/source
export ASI_ISSUE_686_FIXTURE_DB=$ROOT/queue.sqlite3
export ASI_ISSUE_686_PUBLISH=$ROOT/publish.json
export ASI_ISSUE_686_SIMULATE_EXTERNAL=1
export ASI_ISSUE_686_STAMP=$ROOT/stamp
export ASI_ISSUE_686_RECEIPT=$ROOT/receipt.json
export ASI_WORKER_SLOT=5
export ASI_AUTOMATIC_RETRY=false
export ASI_API_FALLBACK=false
export ASI_MODEL_EFFECTS=CODEX,INDEPENDENT_REVIEW
export ASI_DISPATCHER_EXECUTE=NO
export ASI_PAID_CALLS_ENABLED=NO
export ASI_GLOBAL_CAP_KOPECKS=0
export GIT_AUTHOR_NAME=ASI
export GIT_AUTHOR_EMAIL=asi@example.invalid
export GIT_COMMITTER_NAME=ASI
export GIT_COMMITTER_EMAIL=asi@example.invalid
python3 - "$ASI_ISSUE_686_FIXTURE_DB" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('''CREATE TABLE jobs(
        id TEXT PRIMARY KEY, lane TEXT NOT NULL, objective TEXT NOT NULL,
        paths TEXT NOT NULL, state TEXT NOT NULL, attempt INTEGER NOT NULL,
        created INTEGER NOT NULL, touched INTEGER NOT NULL,
        available_after INTEGER NOT NULL DEFAULT 0)''')
    db.commit()
PY
set +e
missing=$(python3 "$HERE/issue-686-adapters.py" local-ci 2>&1)
missing_status=$?
set -e
[[ "$missing_status" -eq 2 && "$missing" == 'BLOCKED: LOCAL_CI_NOT_READY' ]]
git init -b main "$ROOT/source" >/dev/null
mkdir -p "$ROOT/source/notes"
printf 'base\n' > "$ROOT/source/notes/issue-686.txt"
git -C "$ROOT/source" add notes/issue-686.txt
git -C "$ROOT/source" commit -m base >/dev/null
JOB=asi-p1-686-0123456789abcdef0123
git -C "$ROOT/source" checkout -b "asi-continuous/$JOB" >/dev/null 2>&1
printf 'changed\n' > "$ROOT/source/notes/issue-686.txt"
git -C "$ROOT/source" add notes/issue-686.txt
git -C "$ROOT/source" commit -m change >/dev/null
EXPECTED=$(git -C "$ROOT/source" rev-parse HEAD)
python3 - "$ASI_ISSUE_686_FIXTURE_DB" "$JOB" <<'PY'
import sqlite3, sys
db_path, job = sys.argv[1:]
with sqlite3.connect(db_path) as db:
    db.execute(
        "INSERT INTO jobs(id,lane,objective,paths,state,attempt,created,touched) "
        "VALUES(?,?,?,?, 'LOCAL_READY',1,1,1)",
        (job, "acceptance_monitoring", "issue 686", '["notes/issue-686.txt"]'),
    )
    db.commit()
PY
ci=$(python3 "$HERE/issue-686-adapters.py" local-ci)
[[ "$ci" == *'"state": "LOCAL_CI_PASS"'* ]]
[[ "$ci" == *"\"commit\": \"$EXPECTED\""* ]]
[[ "$ci" == *'"changed": 1'* ]]
draft=$(python3 "$HERE/issue-686-adapters.py" draft-pr)
[[ "$draft" == *'"draft": true'* ]]
[[ "$draft" == *'"merged": false'* ]]
[[ "$draft" == *"\"sha\": \"$EXPECTED\""* ]]
python3 - "$ROOT" "$SNAPSHOT" "$EXPECTED" "$JOB" <<'PY'
import ast, pathlib, sqlite3, sys
root, snapshot, expected, job = sys.argv[1:]
root = pathlib.Path(root)
snapshot = pathlib.Path(snapshot)

def tree(path, name):
    parsed = ast.parse(pathlib.Path(path).read_text(encoding="utf-8"))
    for node in parsed.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.dump(node)
    raise SystemExit("FUNCTION_MISSING")

if tree(snapshot / "local_ci.py", "run_checks") != tree(root / "runtime" / "local_ci.py", "run_checks"):
    raise SystemExit("RUN_CHECKS_DRIFT")
if tree(snapshot / "pr_publisher.py", "_create_verified_draft") != tree(root / "runtime" / "pr_publisher.py", "_create_verified_draft"):
    raise SystemExit("DRAFT_DRIFT")
with sqlite3.connect(root / "queue.sqlite3") as db:
    state, receipt = db.execute(
        "SELECT state, receipt FROM p1_pr_publish WHERE job=?", (job,)).fetchone()
if state != "DRAFT_PR_RECEIPTED" or receipt != f"ASI-integration/asi-landing#686@{expected}":
    raise SystemExit("DRAFT_RECEIPT")
PY
python3 - "$ROOT/settled.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('''CREATE TABLE policy (
        id INTEGER PRIMARY KEY CHECK(id=1), cap INTEGER NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
        changed INTEGER NOT NULL)''')
    db.execute('''CREATE TABLE calls (
        operation TEXT NOT NULL, phase TEXT NOT NULL, created INTEGER NOT NULL,
        reserved INTEGER NOT NULL, actual INTEGER, status TEXT NOT NULL,
        PRIMARY KEY(operation, phase))''')
    db.execute("INSERT INTO policy(id,cap,paused,changed) VALUES(1,6400,0,0)")
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-issue-686','CODEX',1,3200,100,'SETTLED')")
    db.commit()
PY
printf 'ledger=%s\n' "$ROOT/settled.sqlite3" > "$ASI_ISSUE_686_STAMP"
bash "$HERE/issue-686-one-shot.sh" --reset-only
python3 - "$ROOT/settled.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    cap, paused = db.execute("SELECT cap, paused FROM policy WHERE id=1").fetchone()
    calls = db.execute("SELECT count(*) FROM calls").fetchone()[0]
if (cap, paused, calls) != (0, 0, 0):
    raise SystemExit("KNOWN_LEDGER_NOT_CLEARED")
PY
python3 - "$ROOT/crash.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('''CREATE TABLE policy (
        id INTEGER PRIMARY KEY CHECK(id=1), cap INTEGER NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
        changed INTEGER NOT NULL)''')
    db.execute('''CREATE TABLE calls (
        operation TEXT NOT NULL, phase TEXT NOT NULL, created INTEGER NOT NULL,
        reserved INTEGER NOT NULL, actual INTEGER, status TEXT NOT NULL,
        PRIMARY KEY(operation, phase))''')
    db.execute("INSERT INTO policy(id,cap,paused,changed) VALUES(1,6400,0,0)")
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-issue-686','CODEX',1,3200,NULL,'RESERVED_UNCERTAIN')")
    db.commit()
PY
printf 'ledger=%s\n' "$ROOT/crash.sqlite3" > "$ASI_ISSUE_686_STAMP"
bash "$HERE/issue-686-one-shot.sh" --reset-only
printf 'ledger=%s\n' "$ROOT/crash.sqlite3" > "$ASI_ISSUE_686_STAMP"
bash "$HERE/issue-686-one-shot.sh" --reset-only
python3 - "$ROOT/crash.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    cap, paused, reason = db.execute("SELECT cap, paused, reason FROM policy WHERE id=1").fetchone()
    actual, status = db.execute("SELECT actual, status FROM calls").fetchone()
if (cap, paused, reason, actual, status) != (0, 1, "UNKNOWN_OR_OVER_BUDGET_USAGE", None, "UNKNOWN_HELD"):
    raise SystemExit("UNKNOWN_HELD_NOT_PRESERVED")
PY
set +e
blocked=$(python3 "$HERE/owner-attested-balance.py" ledger-zero --ledger "$ROOT/crash.sqlite3" 2>&1)
blocked_status=$?
set -e
[[ "$blocked_status" -eq 2 && "$blocked" == 'BLOCKED: PARALLEL_PAID' ]]
echo ISSUE_686_INTERNAL_ROUTE_PROVED
