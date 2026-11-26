#!/bin/bash
# Isolated no-spend proof. It never uses the production ledger or Gold.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
export ASI_ISSUE_686_NO_SPEND=1
export ASI_ISSUE_686_EFFECT_DIR=$ROOT/effects
export ASI_SPEND_LEDGER=$ROOT/ledger.sqlite3
export ASI_ISSUE_686_STAMP=$ROOT/stamp
export ASI_ISSUE_686_RECEIPT=$ROOT/receipt.json
export ASI_WORKER_SLOT=5
export ASI_AUTOMATIC_RETRY=false
export ASI_API_FALLBACK=false
export ASI_MODEL_EFFECTS=CODEX,INDEPENDENT_REVIEW
export ASI_DISPATCHER_EXECUTE=NO
export ASI_PAID_CALLS_ENABLED=NO
export ASI_GLOBAL_CAP_KOPECKS=0
mkdir -p "$ASI_ISSUE_686_EFFECT_DIR"
python3 - "$ASI_SPEND_LEDGER" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('''CREATE TABLE policy (
        id INTEGER PRIMARY KEY, cap INTEGER, paused INTEGER,
        reason TEXT NOT NULL DEFAULT '', changed INTEGER NOT NULL DEFAULT 0)''')
    db.execute('''CREATE TABLE calls (
        operation TEXT NOT NULL, phase TEXT NOT NULL, created INTEGER NOT NULL,
        reserved INTEGER NOT NULL, actual INTEGER, status TEXT NOT NULL,
        PRIMARY KEY(operation, phase))''')
    db.execute('INSERT INTO policy (id, cap, paused, changed) VALUES (1, 0, 0, 0)')
    db.commit()
PY
set +e
cycle=$(bash "$HERE/issue-686-one-shot.sh" --no-spend 2>&1)
cycle_status=$?
set -e
[[ "$cycle_status" -eq 2 ]]
[[ "$cycle" == *'BLOCKED: AUTHENTICATED_CLOUDRU_BALANCE_CONNECTOR_NOT_CONFIGURED'* ]]
for name in capture codex local-ci review draft-pr; do
  [[ -f "$ASI_ISSUE_686_EFFECT_DIR/$name.json" ]]
done
python3 - "$ASI_SPEND_LEDGER" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    cap, paused = db.execute('SELECT cap, paused FROM policy WHERE id=1').fetchone()
    calls = db.execute('SELECT count(*) FROM calls').fetchone()[0]
if (cap, paused, calls) != (0, 0, 0):
    raise SystemExit('NO_SPEND_MUTATED_LEDGER')
PY
set +e
replay=$(python3 "$HERE/issue-686-adapters.py" codex 2>&1)
replay_status=$?
set -e
[[ "$replay_status" -eq 2 && "$replay" == 'BLOCKED: NO_REPLAY' ]]
mkdir -p "$ROOT/fake-runtime" "$ROOT/live-effects"
printf '%s\n' 'from pathlib import Path
PATH = Path(__file__).with_suffix(".count")
def tick(*_args, **_kwargs):
    count = int(PATH.read_text()) if PATH.exists() else 0
    PATH.write_text(str(count + 1))
    return "ok"' > "$ROOT/fake-runtime/candidate_codex_recovery.py"
cp "$ROOT/fake-runtime/candidate_codex_recovery.py" "$ROOT/fake-runtime/candidate_review_dispatch.py"
export ASI_ISSUE_686_EFFECT_DIR=$ROOT/live-effects
set +e
first_live=$(ASI_ISSUE_686_NO_SPEND= ASI_RUNTIME_ROOT=$ROOT/fake-runtime python3 "$HERE/issue-686-adapters.py" codex 2>&1)
first_status=$?
second_live=$(ASI_ISSUE_686_NO_SPEND= ASI_RUNTIME_ROOT=$ROOT/fake-runtime python3 "$HERE/issue-686-adapters.py" codex 2>&1)
second_status=$?
set -e
[[ "$first_status" -eq 0 && "$first_live" == *'"effect": "CODEX"'* ]]
[[ "$second_status" -eq 2 && "$second_live" == 'BLOCKED: NO_REPLAY' ]]
[[ "$(cat "$ROOT/fake-runtime/candidate_codex_recovery.count")" == 1 ]]
export ASI_ISSUE_686_NO_SPEND=1
export ASI_ISSUE_686_EFFECT_DIR=$ROOT/effects
unset ASI_RUNTIME_ROOT
python3 - "$ASI_SPEND_LEDGER" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('UPDATE policy SET cap=6400 WHERE id=1')
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-t','CODEX',1,3200,NULL,'RESERVED_UNCERTAIN')")
    db.commit()
PY
printf 'ledger=%s\n' "$ASI_SPEND_LEDGER" > "$ASI_ISSUE_686_STAMP"
bash "$HERE/issue-686-one-shot.sh" --reset-only
python3 - "$ASI_SPEND_LEDGER" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    cap, paused, reason = db.execute('SELECT cap, paused, reason FROM policy WHERE id=1').fetchone()
    row = db.execute('SELECT actual, status FROM calls').fetchone()
    count = db.execute('SELECT count(*) FROM calls').fetchone()[0]
if (cap, paused, reason, count) != (0, 1, 'UNKNOWN_OR_OVER_BUDGET_USAGE', 1):
    raise SystemExit('UNCERTAIN_LEDGER_NOT_HELD')
if row != (None, 'UNKNOWN_HELD'):
    raise SystemExit('UNKNOWN_HELD_NOT_PRESERVED')
PY
[[ ! -f "$ASI_ISSUE_686_STAMP" ]]
set +e
live=$(bash "$HERE/issue-686-one-shot.sh" 2>&1)
live_status=$?
set -e
[[ "$live_status" -eq 2 && "$live" == 'BLOCKED: GATE_MISSING' ]]
echo ISSUE_686_ADAPTERS_PROVED
