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
    db.execute('CREATE TABLE policy (id INTEGER PRIMARY KEY, cap INTEGER, paused INTEGER)')
    db.execute('CREATE TABLE calls (id INTEGER PRIMARY KEY)')
    db.execute('INSERT INTO policy (id, cap, paused) VALUES (1, 0, 0)')
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
python3 - "$ASI_SPEND_LEDGER" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('UPDATE policy SET cap=6400 WHERE id=1')
    db.execute('INSERT INTO calls (id) VALUES (1)')
    db.commit()
PY
printf 'ledger=%s\n' "$ASI_SPEND_LEDGER" > "$ASI_ISSUE_686_STAMP"
bash "$HERE/issue-686-one-shot.sh" --reset-only
python3 - "$ASI_SPEND_LEDGER" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    cap, paused = db.execute('SELECT cap, paused FROM policy WHERE id=1').fetchone()
    calls = db.execute('SELECT count(*) FROM calls').fetchone()[0]
if (cap, paused, calls) != (0, 0, 0):
    raise SystemExit('LEDGER_NOT_RESTORED')
PY
[[ ! -f "$ASI_ISSUE_686_STAMP" ]]
set +e
live=$(bash "$HERE/issue-686-one-shot.sh" 2>&1)
live_status=$?
set -e
[[ "$live_status" -eq 2 && "$live" == 'BLOCKED: GATE_MISSING' ]]
echo ISSUE_686_ADAPTERS_PROVED
