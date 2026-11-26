#!/bin/bash
# No-spend proof for OWNER_ATTESTED_BALANCE. It does not call the six adapters.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
SHA=$(python3 - "$HERE/owner-attested-balance.py" <<'PY'
import hashlib, sys
print(hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())
PY
)
NOW=1700000000
cat > "$ROOT/attestation.json" <<EOF
{"kind":"OWNER_ATTESTED_BALANCE","source":"owner_cabinet","apiBalance":false,"issue":686,"worker":5,"budgetKopecks":6400,"reserveKopecks":3200,"monetaryBalanceKopecks":81533,"grantBonusKopecks":500000,"observedAt":$NOW,"exactSha":"abc123"}
EOF
cat > "$ROOT/gate.json" <<EOF
{"status":"approved","authorization":{"source":"explicit_owner_message","owner":"Nikolay","scope":"OWNER_ATTESTED_BALANCE"},"identity":{"recordId":"attestation-sha256=$SHA"}}
EOF
python3 - "$ROOT/ledger.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('CREATE TABLE policy (id INTEGER PRIMARY KEY, cap INTEGER, paused INTEGER)')
    db.execute('CREATE TABLE calls (id INTEGER PRIMARY KEY)')
    db.execute('INSERT INTO policy (id, cap, paused) VALUES (1, 0, 0)')
    db.commit()
PY
common=(--attestation "$ROOT/attestation.json" --gate "$ROOT/gate.json" --ledger "$ROOT/ledger.sqlite3" --state "$ROOT/state.json" --attestation-sha256 "$SHA" --exact-sha abc123 --paid NO --execute NO --now "$NOW")
start=$(python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}")
[[ "$start" == *'"source": "OWNER_ATTESTED_BALANCE"'* ]]
[[ "$start" == *'"apiBalance": false'* ]]
[[ "$start" == *'"grantBonusesCountedAsMoney": false'* ]]
python3 "$HERE/owner-attested-balance.py" admit-call "${common[@]}" --effect CODEX >/dev/null
python3 "$HERE/owner-attested-balance.py" admit-call "${common[@]}" --effect INDEPENDENT_REVIEW >/dev/null
set +e
third=$(python3 "$HERE/owner-attested-balance.py" admit-call "${common[@]}" --effect CODEX 2>&1)
third_status=$?
set -e
[[ "$third_status" -eq 2 && "$third" == 'BLOCKED: NO_REPLAY' ]]
python3 - "$ROOT/ledger.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('ALTER TABLE calls ADD COLUMN kopecks INTEGER')
    db.execute('INSERT INTO calls (id, kopecks) VALUES (1, 0), (2, 0)')
    db.commit()
PY
python3 "$HERE/owner-attested-balance.py" reconcile "${common[@]}" --ledger "$ROOT/ledger.sqlite3" >/dev/null
set +e
reuse=$(python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}" 2>&1)
reuse_status=$?
set -e
[[ "$reuse_status" -eq 2 && "$reuse" == 'BLOCKED: ATTESTATION_REUSED' ]]
rm -f "$ROOT/state.json"
python3 - "$ROOT/attestation.json" <<'PY'
import json, sys
path = sys.argv[1]
doc = json.load(open(path, encoding='utf-8'))
doc['observedAt'] -= 601
json.dump(doc, open(path, 'w', encoding='utf-8'))
PY
set +e
expired=$(python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}" 2>&1)
expired_status=$?
set -e
[[ "$expired_status" -eq 2 && "$expired" == 'BLOCKED: ATTESTATION_EXPIRED' ]]
python3 - "$ROOT/attestation.json" <<'PY'
import json, sys
path = sys.argv[1]
doc = json.load(open(path, encoding='utf-8'))
doc['observedAt'] += 601
doc['monetaryBalanceKopecks'] = 81532
json.dump(doc, open(path, 'w', encoding='utf-8'))
PY
set +e
short=$(python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}" 2>&1)
short_status=$?
set -e
[[ "$short_status" -eq 2 && "$short" == 'BLOCKED: INSUFFICIENT_FUNDS' ]]
python3 - "$ROOT/ledger.sqlite3" "$ROOT/attestation.json" <<'PY'
import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('INSERT INTO calls (id) VALUES (3)')
    db.commit()
path = sys.argv[2]
doc = json.load(open(path, encoding='utf-8'))
doc['monetaryBalanceKopecks'] = 81533
json.dump(doc, open(path, 'w', encoding='utf-8'))
PY
set +e
parallel=$(python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}" 2>&1)
parallel_status=$?
set -e
[[ "$parallel_status" -eq 2 && "$parallel" == 'BLOCKED: PARALLEL_PAID' ]]
rm -f "$ROOT/state.json"
python3 - "$ROOT/ledger.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('DELETE FROM calls')
    db.commit()
PY
python3 "$HERE/owner-attested-balance.py" admit-start "${common[@]}" >/dev/null
python3 "$HERE/owner-attested-balance.py" admit-call "${common[@]}" --effect CODEX >/dev/null
set +e
unknown=$(python3 "$HERE/owner-attested-balance.py" reconcile "${common[@]}" --ledger "$ROOT/ledger.sqlite3" 2>&1)
unknown_status=$?
set -e
[[ "$unknown_status" -eq 2 && "$unknown" == 'BLOCKED: UNKNOWN_CHARGE_STOP' ]]
echo OWNER_ATTESTED_BALANCE_PROVED
