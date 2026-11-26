#!/bin/bash
# Offline route on an isolated copy of the production spend schema.
# It does not open the production ledger, sign a ticket, or publish a PR.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
export ASI_ISSUE_686_STAMP=$ROOT/stamp
export ASI_ISSUE_686_RECEIPT=$ROOT/receipt.json
cat > "$ROOT/schema.py" <<'PY'
import sqlite3, sys
def create(path):
    with sqlite3.connect(path) as db:
        db.execute('''CREATE TABLE policy (
            id INTEGER PRIMARY KEY CHECK(id=1), cap INTEGER NOT NULL,
            paused INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
            changed INTEGER NOT NULL)''')
        db.execute('''CREATE TABLE calls (
            operation TEXT NOT NULL, phase TEXT NOT NULL, created INTEGER NOT NULL,
            reserved INTEGER NOT NULL, actual INTEGER, status TEXT NOT NULL,
            PRIMARY KEY(operation, phase))''')
        db.execute("INSERT INTO policy(id,cap,paused,changed) VALUES(1,0,0,0)")
        db.commit()
if __name__ == '__main__':
    create(sys.argv[1])
PY
python3 "$ROOT/schema.py" "$ROOT/ledger.sqlite3"
python3 "$HERE/owner-attested-balance.py" ledger-zero --ledger "$ROOT/ledger.sqlite3" >/dev/null
NOW=1700000000
cat > "$ROOT/attestation.json" <<EOF
{"kind":"OWNER_ATTESTED_BALANCE","source":"owner_cabinet","apiBalance":false,"issue":686,"worker":5,"budgetKopecks":6400,"reserveKopecks":3200,"monetaryBalanceKopecks":81533,"grantBonusKopecks":358100,"observedAt":$NOW,"exactSha":"abc123"}
EOF
cat > "$ROOT/gate.json" <<'EOF'
{"status":"approved","authorization":{"source":"explicit_owner_message","owner":"Nikolay","scope":"OWNER_ATTESTED_BALANCE"},"identity":{"recordId":"attestation-sha256=offline"}}
EOF
common=(--attestation "$ROOT/attestation.json" --gate "$ROOT/gate.json" --ledger "$ROOT/ledger.sqlite3" --state "$ROOT/state.json" --attestation-sha256 offline --exact-sha abc123 --paid NO --execute NO --now "$NOW")
python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}" >/dev/null
python3 "$HERE/owner-attested-balance.py" admit-call "${common[@]}" --effect CODEX >/dev/null
python3 "$HERE/owner-attested-balance.py" admit-call "${common[@]}" --effect INDEPENDENT_REVIEW >/dev/null
python3 - "$ROOT/ledger.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute("UPDATE policy SET cap=6400 WHERE id=1 AND cap=0")
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-issue-686','CODEX',1,3200,100,'SETTLED')")
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-issue-686','INDEPENDENT_REVIEW',1,3200,200,'SETTLED')")
    db.commit()
PY
printf '%s\n' '{"draft":true,"merged":false,"url":"https://example.invalid/pull/686"}' > "$ROOT/draft.json"
python3 - "$ROOT/draft.json" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1], encoding='utf-8'))
assert doc['draft'] is True and doc['merged'] is False
PY
settled=$(python3 "$HERE/owner-attested-balance.py" reconcile "${common[@]}" --ledger "$ROOT/ledger.sqlite3")
[[ "$settled" == *'"actualKopecks": 300'* ]]
[[ "$settled" == *'"apiBalance": false'* ]]
printf 'ledger=%s\n' "$ROOT/ledger.sqlite3" > "$ASI_ISSUE_686_STAMP"
bash "$HERE/issue-686-one-shot.sh" --reset-only
python3 - "$ROOT/ledger.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    cap, paused = db.execute('SELECT cap, paused FROM policy WHERE id=1').fetchone()
    calls = db.execute('SELECT count(*) FROM calls').fetchone()[0]
if (cap, paused, calls) != (0, 0, 0):
    raise SystemExit('LEDGER_NOT_RESTORED')
PY
[[ ! -f "$ASI_ISSUE_686_STAMP" ]]

python3 - "$ROOT/ledger.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('ALTER TABLE calls ADD COLUMN extra TEXT')
    db.commit()
PY
set +e
unknown_columns=$(python3 "$HERE/owner-attested-balance.py" ledger-zero --ledger "$ROOT/ledger.sqlite3" 2>&1)
unknown_status=$?
set -e
[[ "$unknown_status" -eq 2 && "$unknown_columns" == 'BLOCKED: LEDGER' ]]

python3 "$ROOT/schema.py" "$ROOT/nonzero.sqlite3"
python3 - "$ROOT/nonzero.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-issue-686','CODEX',1,3200,0,'SETTLED')")
    db.commit()
PY
set +e
nonzero=$(python3 "$HERE/owner-attested-balance.py" ledger-zero --ledger "$ROOT/nonzero.sqlite3" 2>&1)
nonzero_status=$?
set -e
[[ "$nonzero_status" -eq 2 && "$nonzero" == 'BLOCKED: PARALLEL_PAID' ]]

python3 "$ROOT/schema.py" "$ROOT/budget.sqlite3"
rm -f "$ROOT/state.json"
python3 - "$ROOT/attestation.json" <<'PY'
import json, sys
path = sys.argv[1]
doc = json.load(open(path, encoding='utf-8'))
doc['observedAt'] = 1700000000
json.dump(doc, open(path, 'w', encoding='utf-8'))
PY
common=(--attestation "$ROOT/attestation.json" --gate "$ROOT/gate.json" --ledger "$ROOT/budget.sqlite3" --state "$ROOT/state.json" --attestation-sha256 offline --exact-sha abc123 --paid NO --execute NO --now 1700000000)
python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}" >/dev/null
python3 "$HERE/owner-attested-balance.py" admit-call "${common[@]}" --effect CODEX >/dev/null
python3 "$HERE/owner-attested-balance.py" admit-call "${common[@]}" --effect INDEPENDENT_REVIEW >/dev/null
python3 - "$ROOT/budget.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-issue-686','CODEX',1,3200,3200,'SETTLED')")
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-issue-686','INDEPENDENT_REVIEW',1,3200,3201,'SETTLED')")
    db.commit()
PY
set +e
over=$(python3 "$HERE/owner-attested-balance.py" reconcile "${common[@]}" --ledger "$ROOT/budget.sqlite3" 2>&1)
over_status=$?
set -e
[[ "$over_status" -eq 2 && "$over" == 'BLOCKED: BUDGET' ]]

rm -f "$ROOT/state.json"
python3 - "$ROOT/attestation.json" <<'PY'
import json, sys
path = sys.argv[1]
doc = json.load(open(path, encoding='utf-8'))
doc['observedAt'] = 1795710953
json.dump(doc, open(path, 'w', encoding='utf-8'))
PY
set +e
reused=$(python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}" --now 1795710953 2>&1)
reused_status=$?
set -e
[[ "$reused_status" -eq 2 && "$reused" == 'BLOCKED: ATTESTATION_REUSED' ]]

python3 "$ROOT/schema.py" "$ROOT/crash.sqlite3"
python3 - "$ROOT/crash.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('UPDATE policy SET cap=6400 WHERE id=1')
    db.execute("INSERT INTO calls(operation,phase,created,reserved,actual,status) VALUES('asi-issue-686','CODEX',1,3200,NULL,'RESERVED_UNCERTAIN')")
    db.commit()
PY
printf 'ledger=%s\n' "$ROOT/crash.sqlite3" > "$ASI_ISSUE_686_STAMP"
bash "$HERE/issue-686-one-shot.sh" --reset-only
python3 - "$ROOT/crash.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    cap, paused, reason = db.execute('SELECT cap, paused, reason FROM policy WHERE id=1').fetchone()
    actual, status = db.execute('SELECT actual, status FROM calls').fetchone()
    count = db.execute('SELECT count(*) FROM calls').fetchone()[0]
if (cap, paused, reason, count, actual, status) != (0, 1, 'UNKNOWN_OR_OVER_BUDGET_USAGE', 1, None, 'UNKNOWN_HELD'):
    raise SystemExit('CRASH_LEDGER_NOT_HELD')
PY
printf 'ledger=%s\n' "$ROOT/crash.sqlite3" > "$ASI_ISSUE_686_STAMP"
bash "$HERE/issue-686-one-shot.sh" --reset-only
python3 - "$ROOT/crash.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    cap, paused = db.execute('SELECT cap, paused FROM policy WHERE id=1').fetchone()
    status = db.execute('SELECT status FROM calls').fetchone()[0]
if (cap, paused, status) != (0, 1, 'UNKNOWN_HELD'):
    raise SystemExit('RECONCILE_HOLD_LOST')
PY
echo ISSUE_686_LEDGER_ROUTE_PROVED
