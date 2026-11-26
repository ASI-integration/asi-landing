#!/bin/bash
# One-shot Issue #686 contour. Adapter paths are fixed files beside this
# script. An environment value cannot replace them with a shell command.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$HERE/../.." && pwd)
GATE=$REPO/docs/operations/onecom-dispatcher-recovery-398c2ef0/issue-686-adapter-owner-gate.json
CONTRACT=$REPO/docs/operations/onecom-dispatcher-recovery-398c2ef0/issue-686-adapter-runtime-contract.json
ENV_FILE=$HERE/asi-p1-686-one-shot.env
UNIT=$HERE/asi-issue-686-budget-reset.service
SERVICE=$HERE/asi-p1-686-one-shot.service
ATTEST=$HERE/owner-attested-balance.py
ADAPTER=$HERE/issue-686-adapters.py
MAX_KOPECKS=6400
GOLD_BYTES=42949672960
PRODUCTION_LEDGER=/home/administrator/asi-continuous/global-paid-spend.sqlite3
NO_SPEND=0

fail() { echo "BLOCKED: $1" >&2; exit 2; }

if [[ "${1:-}" == --no-spend ]]; then
  NO_SPEND=1
  shift
fi

reset_ledger() {
  local ledger=$1
  python3 - "$ledger" "${ASI_ISSUE_686_RECEIPT:-/var/lib/asi/issue-686-permit-receipt.json}" <<'PY'
import json, sqlite3, sys
from pathlib import Path
ledger, receipt = sys.argv[1:]
path = Path(ledger)
if path.is_symlink() or not path.is_file():
    raise SystemExit(1)
with sqlite3.connect(path.resolve().as_uri(), uri=True) as db:
    rows = db.execute("SELECT * FROM calls").fetchall()
    cols = [item[1] for item in db.execute("PRAGMA table_info(calls)").fetchall()]
    Path(receipt).parent.mkdir(parents=True, exist_ok=True)
    Path(receipt).write_text(json.dumps({"columns": cols, "rows": rows}), encoding="utf-8")
    uncertain = db.execute(
        "SELECT count(*) FROM calls WHERE status IN ('RESERVED_UNCERTAIN','UNKNOWN_HELD') OR actual IS NULL"
    ).fetchone()[0]
    if uncertain:
        db.execute(
            "UPDATE calls SET status='UNKNOWN_HELD' "
            "WHERE status IN ('RESERVED_UNCERTAIN','UNKNOWN_HELD') OR actual IS NULL"
        )
        changed = db.execute(
            "UPDATE policy SET cap=0, paused=1, reason='UNKNOWN_OR_OVER_BUDGET_USAGE', "
            "changed=CAST(strftime('%s','now') AS INTEGER) WHERE id=1"
        ).rowcount
    else:
        db.execute("DELETE FROM calls")
        changed = db.execute(
            "UPDATE policy SET cap=0, paused=0, reason='', "
            "changed=CAST(strftime('%s','now') AS INTEGER) WHERE id=1"
        ).rowcount
    db.commit()
if changed != 1:
    raise SystemExit(1)
PY
}

if [[ "${1:-}" == --reset-only ]]; then
  stamp=${ASI_ISSUE_686_STAMP:-/var/lib/asi/issue-686-permit.stamp}
  [[ -f "$stamp" ]] || exit 0
  ledger=$(awk -F= '$1=="ledger" {print $2; exit}' "$stamp")
  [[ "$ledger" =~ ^/[-A-Za-z0-9_./]+$ ]] || fail LEDGER
  reset_ledger "$ledger" || fail LEDGER
  rm -f -- "$stamp"
  exit 0
fi

if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[A-Z0-9_]+= ]] || continue
    key=${line%%=*}
    if [[ -z "${!key:-}" ]]; then
      export "$line"
    fi
  done < "$ENV_FILE"
fi
export ASI_WORKER_SLOT=5
export ASI_AUTOMATIC_RETRY=false
export ASI_API_FALLBACK=false
export ASI_MODEL_EFFECTS=CODEX,INDEPENDENT_REVIEW
export ASI_DISPATCHER_EXECUTE=NO
export ASI_PAID_CALLS_ENABLED=NO
export ASI_GLOBAL_CAP_KOPECKS=0
unset GH_CONFIG_DIR

tool_path() {
  local path=$1
  path=$(readlink -f "$path")
  [[ "$path" == /usr/bin/* || "$path" == /usr/sbin/* || "$path" == /usr/local/bin/* ]] || fail TOOL_PATH
  [[ -x "$path" && "$(stat -c '%u' "$path")" == 0 ]] || fail TOOL_PATH
  printf '%s\n' "$path"
}

as_administrator() {
  local py ru
  py=$(tool_path /usr/bin/python3)
  ru=$(tool_path /usr/sbin/runuser)
  "$ru" -u administrator -- env -i \
    HOME=/home/administrator \
    USER=administrator \
    LOGNAME=administrator \
    PATH=/usr/local/bin:/usr/bin:/bin \
    PYTHONPATH="${ASI_RUNTIME_ROOT:-/home/administrator/asi-continuous}:/home/administrator/asi-v18-reviewed-main-20261115/ops/v17" \
    ASI_RUNTIME_ROOT="${ASI_RUNTIME_ROOT:-/home/administrator/asi-continuous}" \
    ASI_WORKER_SLOT="${ASI_WORKER_SLOT:-5}" \
    ASI_AUTOMATIC_RETRY="${ASI_AUTOMATIC_RETRY:-false}" \
    ASI_API_FALLBACK="${ASI_API_FALLBACK:-false}" \
    ASI_MODEL_EFFECTS="${ASI_MODEL_EFFECTS:-CODEX,INDEPENDENT_REVIEW}" \
    ASI_DISPATCHER_EXECUTE="${ASI_DISPATCHER_EXECUTE:-NO}" \
    ASI_PAID_CALLS_ENABLED="${ASI_PAID_CALLS_ENABLED:-NO}" \
    ASI_GLOBAL_CAP_KOPECKS="${ASI_GLOBAL_CAP_KOPECKS:-0}" \
    ASI_ISSUE_686_EFFECT_DIR="${ASI_ISSUE_686_EFFECT_DIR:-}" \
    ASI_ISSUE_686_PUBLISH="${ASI_ISSUE_686_PUBLISH:-}" \
    ASI_ISSUE_686_NO_SPEND="${ASI_ISSUE_686_NO_SPEND:-}" \
    ASI_ISSUE_686_SIMULATE_EXTERNAL="${ASI_ISSUE_686_SIMULATE_EXTERNAL:-}" \
    "$py" "$@"
}

admin_python() {
  if [[ "$(id -u)" -eq 0 ]]; then
    as_administrator -
  else
    PYTHONPATH="${ASI_RUNTIME_ROOT:-/home/administrator/asi-continuous}:/home/administrator/asi-v18-reviewed-main-20261115/ops/v17" python3 -
  fi
}

run_adapter() {
  if [[ "$(id -u)" -eq 0 && "${ASI_ISSUE_686_NO_SPEND:-}" != 1 ]]; then
    as_administrator "$ADAPTER" "$1"
  else
    python3 "$ADAPTER" "$1"
  fi
}

if [[ "${1:-}" == --preflight ]]; then
  runtime=${ASI_RUNTIME_ROOT:-/home/administrator/asi-continuous}
  tool_path /usr/bin/gh >/dev/null
  tool_path /usr/bin/git >/dev/null
  tool_path /usr/bin/python3 >/dev/null
  tool_path /usr/bin/openssl >/dev/null
  tool_path /usr/bin/sqlite3 >/dev/null
  [[ "${ASI_API_FALLBACK}" == false ]] || fail API_FALLBACK
  admin_python <<'PY' || fail GITHUB_ISSUE_READ_FAILED
import os, pwd, issue_intake
if os.geteuid() != pwd.getpwnam("administrator").pw_uid:
    raise SystemExit("NOT_ADMINISTRATOR")
issue = issue_intake.fetch_issue_readonly()
if issue.get("number") != 686 or "HOLD" not in str(issue.get("title") or ""):
    raise SystemExit(1)
print("ISSUE_READ", issue["number"])
print("CHECK privilege_drop PASS", os.geteuid())
PY
  perms=$(admin_python <<'PY'
import os, pwd, subprocess
if os.geteuid() != pwd.getpwnam("administrator").pw_uid:
    raise SystemExit("NOT_ADMINISTRATOR")
gh = os.path.realpath("/usr/bin/gh")
if not gh.startswith("/usr/bin/") or not os.path.isfile(gh):
    raise SystemExit("TOOL_PATH")
result = subprocess.run([gh, "api", "repos/ASI-integration/asi-landing", "--jq", "{pull:.permissions.pull,push:.permissions.push}"], capture_output=True, text=True)
if result.returncode != 0:
    raise SystemExit("GITHUB_REPO_PERMISSION")
print(result.stdout.strip())
PY
)
  [[ "$perms" == *'"pull":true'* ]] || fail GITHUB_REPO_PERMISSION
  admin_python <<'PY' || fail CODEX_ROUTE
import os, pwd, codex_subscription as sub
if os.geteuid() != pwd.getpwnam("administrator").pw_uid:
    raise SystemExit("NOT_ADMINISTRATOR")
argv = sub.codex_argv("/home/administrator", review=True)
required = ("forced_login_method=\"chatgpt\"", "model_provider=\"openai\"", "--ignore-user-config", "exec")
if argv[0] != "codex" or "read-only" not in argv or any(item not in argv for item in required):
    raise SystemExit("CODEX_ARGV")
account = sub.account_probe()
if account.get("mode") != "chatgpt-included-only" or account.get("metered_api_allowed") is not False:
    raise SystemExit("CODEX_BILLING")
print("CHECK codex_route PASS", account["mode"])
PY
  admin_python <<'PY' || fail REVIEW_ROUTE
import cloudru_bridge as cloud
from provider_dispatch import BudgetHalt
if cloud.MODEL != "ai-sage/GigaChat3.5-432B-A28B" or cloud.RESERVE_KOPECKS != 3200:
    raise SystemExit("REVIEW_MODEL")
try:
    cloud.tariff_preflight()
except BudgetHalt as error:
    if "PAID_EFFECTS_DISABLED_UNTIL_SIGNED_RELEASE" not in str(error):
        raise
else:
    raise SystemExit("REVIEW_SPEND_NOT_HELD")
print("CHECK review_route PASS", cloud.MODEL)
PY
  git=$(tool_path /usr/bin/git)
  env -i PATH=/usr/bin:/bin HOME=/root GIT_CONFIG_GLOBAL=/dev/null \
    "$git" -c core.hooksPath=/dev/null -c protocol.ext.allow=never \
    -C "$REPO" rev-parse --is-inside-work-tree >/dev/null || fail GIT_REPO
  env -i PATH=/usr/bin:/bin HOME=/root GIT_CONFIG_GLOBAL=/dev/null \
    "$git" -c core.hooksPath=/dev/null -c protocol.ext.allow=never \
    -C "$REPO" ls-remote --exit-code origin refs/heads/agent/p1-686-dispatcher-recovery-audit >/dev/null || fail GIT_REMOTE
  python3 - "$runtime" "$ADAPTER" <<'PY' || fail EXEC_ISOLATION
import pathlib, sqlite3, sys
runtime, adapter = sys.argv[1:]
local = pathlib.Path(runtime, "local_ci.py").read_text(encoding="utf-8")
publisher = pathlib.Path(runtime, "pr_publisher.py").read_text(encoding="utf-8")
adapter_text = pathlib.Path(adapter).read_text(encoding="utf-8")
if "env=ENV" not in local or '"HOME":"/home/administrator"' not in local or "shell=True" in local:
    raise SystemExit("LOCAL_CI")
if "shell=True" in publisher or "shell=True" in adapter_text:
    raise SystemExit("AGENT_EXEC")
ledger = sqlite3.connect("file:/home/administrator/asi-continuous/global-paid-spend.sqlite3?mode=ro", uri=True)
cap, paused = ledger.execute("select cap, paused from policy where id=1").fetchone()
count = ledger.execute("select count(*) from calls").fetchone()[0]
if (cap, paused, count) != (0, 0, 0):
    raise SystemExit("LEDGER")
print("CHECK ledger PASS", cap, paused, count)
PY
  echo "CHECK github_api PASS"
  echo "CHECK repo_permission PASS $perms"
  echo "CHECK git_hooks PASS disabled"
  echo "CHECK api_fallback PASS false"
  echo "CHECK tools PASS gh git python3 openssl sqlite3"
  echo PREFLIGHT_FREE_OK
  exit 0
fi

if [[ "$NO_SPEND" == 1 ]]; then
  [[ -n "${ASI_ISSUE_686_EFFECT_DIR:-}" && -n "${ASI_SPEND_LEDGER:-}" ]] || fail ENV_MISSING
  [[ "$ASI_SPEND_LEDGER" != "$PRODUCTION_LEDGER" ]] || fail PRODUCTION_LEDGER
  export ASI_ISSUE_686_NO_SPEND=1
  run_adapter capture
  run_adapter codex
  run_adapter local-ci
  run_adapter review
  run_adapter draft-pr
  if ! run_adapter balance; then
    fail AUTHENTICATED_CLOUDRU_BALANCE_CONNECTOR_NOT_CONFIGURED
  fi
  echo ISSUE_686_NO_SPEND_OK
  exit 0
fi

TICKET_DIR=${ASI_ISSUE_686_TICKET_DIR:-/var/lib/asi/issue-686-launch}
cleanup_authorization() {
  python3 "$ATTEST" consume-ticket --ticket "$TICKET_DIR/owner_ticket.json" --consumed "$TICKET_DIR/consumed" || true
  rm -f -- "$TICKET_DIR/owner_ticket.sig" "$TICKET_DIR/owner_ticket.json" "$TICKET_DIR/payload"
}
[[ -f "$TICKET_DIR/owner_ticket.json" && -f "$TICKET_DIR/owner_ticket.sig" && ! -L "$TICKET_DIR/owner_ticket.json" && ! -L "$TICKET_DIR/owner_ticket.sig" ]] || fail GATE_MISSING
exact_sha=$(git -C "$REPO" rev-parse HEAD)
python3 "$ATTEST" verify-ticket --runtime "$ASI_RUNTIME_ROOT" --ticket "$TICKET_DIR/owner_ticket.json" --signature "$TICKET_DIR/owner_ticket.sig" --public-key /etc/asi/p1-686-owner-public.pem --attestation "${ASI_OWNER_ATTESTED_BALANCE:-/etc/asi/owner-attested-balance.json}" --exact-sha "$exact_sha" --permit "$HERE/issue-686-one-shot.sh" --consumed "$TICKET_DIR/consumed"
trap cleanup_authorization EXIT
reason=$(python3 - "$GATE" "$CONTRACT" "$HERE/issue-686-one-shot.sh" "$ADAPTER" "$ENV_FILE" "$UNIT" "$SERVICE" "$ATTEST" <<'PY'
import hashlib, json, sys
gate, contract, script, adapter, env_file, unit, service, attest = sys.argv[1:]
try:
    gate_doc = json.load(open(gate, encoding='utf-8'))
    contract_doc = json.load(open(contract, encoding='utf-8'))
except Exception:
    print('GATE_MISSING')
    raise SystemExit(1)
if gate_doc.get('identity') != contract_doc.get('identity'):
    print('PERMIT_SHA')
    raise SystemExit(1)
rec = dict(part.split('=', 1) for part in gate_doc['identity']['recordId'].split(';'))
checks = {
    'permit-sha256': script,
    'adapter-sha256': adapter,
    'env-sha256': env_file,
    'reset-sha256': unit,
    'service-sha256': service,
    'attestation-sha256': attest,
}
for key, path in checks.items():
    if hashlib.sha256(open(path, 'rb').read()).hexdigest() != rec.get(key):
        print('PERMIT_SHA')
        raise SystemExit(1)
if rec.get('package-sha256') != 'cbf301ac7bf9663daf72a5a6081aa2b2622b52ec778feee3899fdad629e883b7':
    print('PACKAGE_SHA')
    raise SystemExit(1)
PY
) || fail "${reason:-GATE_MISSING}"

[[ -n "${ASI_SPEND_LEDGER:-}" && -n "${ASI_GOLD_IMAGE:-}" && -n "${ASI_RUNTIME_ROOT:-}" ]] || fail ENV_MISSING
# The signed owner gate is the authorization. Do not synthesize the absent file.
[[ ! -e /etc/asi/p1-686-authorization ]] || fail AUTHORIZATION_FILE_PRESENT
set +e
api_balance=$(run_adapter balance 2>&1)
api_status=$?
set -e
ATTESTED=0
NEED_ATTEST=0
if [[ "$api_status" -eq 0 ]]; then
  printf '%s\n' "$api_balance"
else
  [[ "$api_balance" == *AUTHENTICATED_CLOUDRU_BALANCE_CONNECTOR_NOT_CONFIGURED* ]] || fail CLOUDRU_BALANCE
  NEED_ATTEST=1
fi

[[ -f "$ASI_GOLD_IMAGE" && ! -L "$ASI_GOLD_IMAGE" ]] || fail GOLD_CHANGED
gold_stamp=$(stat -c '%u:%g:%a:%i' -- "$ASI_GOLD_IMAGE")
gold_size=$(qemu-img info -f qcow2 "$ASI_GOLD_IMAGE" | sed -n 's/.*(\([0-9][0-9]*\) bytes).*/\1/p' | head -n 1)
[[ "$gold_size" == "$GOLD_BYTES" ]] || fail GOLD_CHANGED
python3 "$ATTEST" ledger-zero --ledger "$ASI_SPEND_LEDGER"

if [[ "$NEED_ATTEST" == 1 ]]; then
  exact_sha=$(git -C "$REPO" rev-parse HEAD)
  attest_sha=$(python3 - "$ATTEST" <<'PY'
import hashlib, sys
print(hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())
PY
)
  python3 "$ATTEST" admit-start --attestation "${ASI_OWNER_ATTESTED_BALANCE:-/etc/asi/owner-attested-balance.json}" --gate "$GATE" --ledger "$ASI_SPEND_LEDGER" --state /var/lib/asi/issue-686-attestation.json --attestation-sha256 "$attest_sha" --exact-sha "$exact_sha" --paid "$ASI_PAID_CALLS_ENABLED" --execute "$ASI_DISPATCHER_EXECUTE" --runtime "$ASI_RUNTIME_ROOT" --ticket "$TICKET_DIR/owner_ticket.json" --signature "$TICKET_DIR/owner_ticket.sig" --public-key /etc/asi/p1-686-owner-public.pem --permit "$HERE/issue-686-one-shot.sh" --consumed "$TICKET_DIR/consumed"
  ATTESTED=1
fi

stamp=/var/lib/asi/issue-686-permit.stamp
restore_budget() {
  local status=$?
  set +e
  cleanup_authorization
  if [[ -f "$stamp" ]]; then
    reset_ledger "$ASI_SPEND_LEDGER"
    if [[ $? -eq 0 ]]; then
      rm -f -- "$stamp"
      systemctl disable asi-issue-686-budget-reset.service >/dev/null 2>&1
    else
      status=1
    fi
  fi
  [[ "$(stat -c '%u:%g:%a:%i' -- "$ASI_GOLD_IMAGE")" == "$gold_stamp" ]] || status=1
  exit "$status"
}
trap restore_budget EXIT
install -d -m 0700 /var/lib/asi /etc/asi /usr/local/libexec
printf 'ledger=%s\n' "$ASI_SPEND_LEDGER" > "$stamp"
install -m 0640 "$ENV_FILE" /etc/asi/p1-686-one-shot.env
install -m 0644 "$HERE/asi-p1-686-one-shot.service" /etc/systemd/system/asi-p1-686-one-shot.service
install -m 0644 "$UNIT" /etc/systemd/system/asi-issue-686-budget-reset.service
install -m 0755 "$HERE/issue-686-one-shot.sh" /usr/local/libexec/asi-issue-686-one-shot.sh
install -m 0755 "$ADAPTER" /usr/local/libexec/asi-issue-686-adapters.py
systemctl daemon-reload
systemctl enable asi-issue-686-budget-reset.service
python3 - "$ASI_SPEND_LEDGER" "$MAX_KOPECKS" <<'PY'
import sqlite3, sys
from pathlib import Path
ledger, cap = sys.argv[1:]
with sqlite3.connect(Path(ledger).resolve().as_uri(), uri=True) as db:
    cur = db.execute('UPDATE policy SET cap=?, paused=0 WHERE id=1 AND cap=0 AND paused=0', (int(cap),))
    if cur.rowcount != 1:
        raise SystemExit(1)
    db.commit()
PY
if [[ -z "${ASI_ISSUE_686_EFFECT_DIR:-}" ]]; then
  export ASI_ISSUE_686_EFFECT_DIR=/home/administrator/.asi-issue-686/effects
fi
install -d -m 0700 "$(dirname "$ASI_ISSUE_686_EFFECT_DIR")" "$ASI_ISSUE_686_EFFECT_DIR"
if [[ "$(id -u)" -eq 0 ]]; then
  chown administrator:administrator "$(dirname "$ASI_ISSUE_686_EFFECT_DIR")" "$ASI_ISSUE_686_EFFECT_DIR"
fi
run_adapter capture
if [[ "$ATTESTED" == 1 ]]; then
  python3 "$ATTEST" admit-call --state /var/lib/asi/issue-686-attestation.json --effect CODEX
fi
run_adapter codex
export ASI_ISSUE_686_PUBLISH=/home/administrator/.asi-issue-686/publish.json
unset ASI_ISSUE_686_SIMULATE_EXTERNAL
run_adapter local-ci
if [[ "$ATTESTED" == 1 ]]; then
  python3 "$ATTEST" admit-call --state /var/lib/asi/issue-686-attestation.json --effect INDEPENDENT_REVIEW
fi
run_adapter review
run_adapter draft-pr
if [[ "$ATTESTED" == 1 ]]; then
  python3 "$ATTEST" reconcile --state /var/lib/asi/issue-686-attestation.json --ledger "$ASI_SPEND_LEDGER"
fi
echo ISSUE_686_ONE_SHOT_OK
