#!/bin/bash
# One-shot Issue #686 permit. Exits before any host change unless the owner
# gate is approved. The reboot helper is this same file with --reset-only.
set -euo pipefail
umask 077
STAMP=/var/lib/asi/issue-686-permit.stamp
RECEIPT=/var/lib/asi/issue-686-permit-receipt.json
MAX_KOPECKS=6400
GOLD_BYTES=42949672960

fail() { echo "BLOCKED: $1" >&2; exit 2; }

reset_ledger() {
  local ledger=$1
  python3 - "$ledger" "$RECEIPT" <<'PY'
import json, sqlite3, sys
from pathlib import Path
ledger, receipt = sys.argv[1:]
path = Path(ledger)
if path.is_symlink() or not path.is_file():
    raise SystemExit(1)
uri = path.resolve().as_uri()
with sqlite3.connect(uri, uri=True) as db:
    rows = db.execute("SELECT * FROM calls").fetchall()
    cols = [item[1] for item in db.execute("PRAGMA table_info(calls)").fetchall()]
    Path(receipt).parent.mkdir(parents=True, exist_ok=True)
    Path(receipt).write_text(json.dumps({"columns": cols, "rows": rows}), encoding="utf-8")
    db.execute("DELETE FROM calls")
    changed = db.execute("UPDATE policy SET cap=0, paused=0 WHERE id=1").rowcount
    db.commit()
if changed != 1:
    raise SystemExit(1)
PY
}

if [[ "${1:-}" == --reset-only ]]; then
  [[ -f "$STAMP" ]] || exit 0
  ledger=$(awk -F= '$1=="ledger" {print $2; exit}' "$STAMP")
  [[ "$ledger" =~ ^/[-A-Za-z0-9_./]+$ ]] || fail LEDGER
  reset_ledger "$ledger" || fail LEDGER
  rm -f -- "$STAMP"
  exit 0
fi

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$HERE/../.." && pwd)
GATE=$REPO/docs/operations/onecom-dispatcher-recovery-398c2ef0/issue-686-draft-pr-owner-gate.json
CONTRACT=$REPO/docs/operations/onecom-dispatcher-recovery-398c2ef0/issue-686-draft-pr-runtime-contract.json
UNIT=$HERE/asi-issue-686-budget-reset.service
reason=$(python3 - "$GATE" "$CONTRACT" "$HERE/issue-686-one-shot.sh" "$UNIT" <<'PY'
import hashlib, json, sys
gate, contract, script, unit = sys.argv[1:]
try:
    gate_doc = json.load(open(gate, encoding="utf-8"))
    contract_doc = json.load(open(contract, encoding="utf-8"))
except Exception:
    print("GATE_MISSING")
    raise SystemExit(1)
if gate_doc.get("status") != "approved" or not isinstance(gate_doc.get("authorization"), dict):
    print("GATE_MISSING")
    raise SystemExit(1)
auth = gate_doc["authorization"]
if auth.get("source") != "explicit_owner_message" or auth.get("owner") != "Nikolay":
    print("GATE_SCOPE")
    raise SystemExit(1)
if auth.get("scope") != contract_doc.get("scope") or auth.get("taskCycle") != contract_doc.get("taskCycle"):
    print("GATE_SCOPE")
    raise SystemExit(1)
if gate_doc.get("allowedSideEffect") != contract_doc.get("allowedSideEffect"):
    print("GATE_SCOPE")
    raise SystemExit(1)
rec = dict(part.split("=", 1) for part in gate_doc["identity"]["recordId"].split(";"))
if rec.get("exact-sha") != "39b75b7770fce0297954f7e24418dbe5f08c0ce7":
    print("PACKAGE_SHA")
    raise SystemExit(1)
if rec.get("package-sha256") != "cbf301ac7bf9663daf72a5a6081aa2b2622b52ec778feee3899fdad629e883b7":
    print("PACKAGE_SHA")
    raise SystemExit(1)
if rec.get("scenario-sha256") != "1f80857c356067054671b855e4e24f131436a50c7fea5658adbaf3d892e568fc":
    print("SCENARIO_SHA")
    raise SystemExit(1)
if hashlib.sha256(open(script, "rb").read()).hexdigest() != rec.get("permit-sha256"):
    print("PERMIT_SHA")
    raise SystemExit(1)
if hashlib.sha256(open(unit, "rb").read()).hexdigest() != rec.get("reset-sha256"):
    print("PERMIT_SHA")
    raise SystemExit(1)
PY
) || fail "${reason:-GATE_MISSING}"

require_path() {
  [[ "${1:-}" =~ ^/[-A-Za-z0-9_./]+$ && -x "$1" ]] || fail ENV_MISSING
}
[[ -n "${ASI_SPEND_LEDGER:-}" && -n "${ASI_GOLD_IMAGE:-}" ]] || fail ENV_MISSING
[[ -n "${ASI_WORKER_SLOT:-}" && -n "${ASI_AUTOMATIC_RETRY:-}" && -n "${ASI_API_FALLBACK:-}" && -n "${ASI_MODEL_EFFECTS:-}" ]] || fail ENV_MISSING
[[ "$ASI_WORKER_SLOT" == 5 ]] || fail WORKER_SLOT
[[ "$ASI_AUTOMATIC_RETRY" == false ]] || fail AUTOMATIC_RETRY
[[ "$ASI_API_FALLBACK" == false ]] || fail API_FALLBACK
[[ "$ASI_MODEL_EFFECTS" == 'CODEX,INDEPENDENT_REVIEW' ]] || fail MODEL_EFFECTS
[[ "${ASI_DISPATCHER_EXECUTE:-NO}" == NO && "${ASI_PAID_CALLS_ENABLED:-NO}" == NO ]] || fail LIVE_FLAGS
for cmd in "${ASI_CLOUDRU_BALANCE_CMD:-}" "${ASI_ISSUE_686_CAPTURE_CMD:-}" "${ASI_CODEX_CMD:-}" \
  "${ASI_LOCAL_TEST_CMD:-}" "${ASI_INDEPENDENT_REVIEW_CMD:-}" "${ASI_DRAFT_PR_CMD:-}"; do
  require_path "$cmd"
done

balance=$("$ASI_CLOUDRU_BALANCE_CMD") || fail CLOUDRU_BALANCE
[[ "$balance" =~ ^[0-9]+$ && "$balance" -ge "$MAX_KOPECKS" ]] || fail CLOUDRU_BALANCE
[[ -f "$ASI_GOLD_IMAGE" && ! -L "$ASI_GOLD_IMAGE" ]] || fail GOLD_CHANGED
gold_stamp=$(stat -c '%u:%g:%a:%i' -- "$ASI_GOLD_IMAGE")
gold_size=$(qemu-img info -f qcow2 "$ASI_GOLD_IMAGE" | sed -n 's/.*(\([0-9][0-9]*\) bytes).*/\1/p' | head -n 1)
[[ "$gold_size" == "$GOLD_BYTES" ]] || fail GOLD_CHANGED

if ! python3 - "$ASI_SPEND_LEDGER" <<'PY'
import sqlite3, sys
from pathlib import Path
path = Path(sys.argv[1])
if path.is_symlink() or not path.is_file():
    raise SystemExit(1)
with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
    row = db.execute("SELECT cap, paused FROM policy WHERE id=1").fetchone()
    calls = db.execute("SELECT count(*) FROM calls").fetchone()[0]
    columns = [item[1] for item in db.execute("PRAGMA table_info(calls)").fetchall()]
if row is None or int(row[0]) != 0 or int(row[1]) != 0 or int(calls) != 0 or "id" not in columns:
    raise SystemExit(1)
PY
then
  fail LEDGER
fi

restore_budget() {
  local status=$?
  set +e
  if [[ -f "$STAMP" ]]; then
    reset_ledger "$ASI_SPEND_LEDGER"
    local reset_status=$?
    if [[ "$reset_status" -eq 0 ]]; then
      rm -f -- "$STAMP"
      systemctl disable asi-issue-686-budget-reset.service >/dev/null 2>&1
    else
      status=1
    fi
  fi
  [[ "$(stat -c '%u:%g:%a:%i' -- "$ASI_GOLD_IMAGE")" == "$gold_stamp" ]] || status=1
  exit "$status"
}
trap restore_budget EXIT

install -d -m 0700 /var/lib/asi
printf 'ledger=%s\n' "$ASI_SPEND_LEDGER" > "$STAMP"
install -m 0644 "$UNIT" /etc/systemd/system/asi-issue-686-budget-reset.service
install -m 0755 "$HERE/issue-686-one-shot.sh" /usr/local/libexec/asi-issue-686-budget-reset
systemctl daemon-reload
systemctl enable asi-issue-686-budget-reset.service

python3 - "$ASI_SPEND_LEDGER" "$MAX_KOPECKS" <<'PY'
import sqlite3, sys
from pathlib import Path
ledger, cap = sys.argv[1:]
with sqlite3.connect(Path(ledger).resolve().as_uri(), uri=True) as db:
    cur = db.execute("UPDATE policy SET cap=?, paused=0 WHERE id=1 AND cap=0 AND paused=0", (int(cap),))
    if cur.rowcount != 1:
        raise SystemExit(1)
    db.commit()
PY

"$ASI_ISSUE_686_CAPTURE_CMD" 686 5
"$ASI_CODEX_CMD"
"$ASI_LOCAL_TEST_CMD"
"$ASI_INDEPENDENT_REVIEW_CMD"
"$ASI_DRAFT_PR_CMD"
echo ISSUE_686_ONE_SHOT_OK
