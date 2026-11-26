#!/bin/bash
# Single server scenario for the recovery package.
# install-and-verify applies the helper and drop-in, then daemon-reloads and
# starts only while ASI_DISPATCHER_EXECUTE=NO. That success path does not call
# --rollback. systemctl enable is a separate invocation. Any failure restores
# the snapshot and the original active/enabled state.
# Production is refused until the matching gate status is approved.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$HERE/../.." && pwd)
UNIT=asi-ephemeral-dispatcher.service
GATE=$REPO/docs/operations/onecom-dispatcher-recovery-398c2ef0/recovery-dropin-owner-gate.json
ENABLE_GATE=$REPO/docs/operations/onecom-dispatcher-recovery-398c2ef0/recovery-enable-owner-gate.json
MODE=${1:-}
ROOT=
SNAP=
ENV_FILE=
LEDGER=
GOLD=
NORETRY=

if [[ -n "${ASI_RECOVERY_DRY_ROOT:-}" ]]; then
  ROOT=$(readlink -f -- "$ASI_RECOVERY_DRY_ROOT")
  export ASI_RECOVERY_DRY_ROOT=$ROOT
  [[ "$ROOT" != / && -n "${ASI_RECOVERY_DRY_BIN:-}" && -x "$ASI_RECOVERY_DRY_BIN/systemctl" && -x "$ASI_RECOVERY_DRY_BIN/journalctl" ]] || {
    echo 'BLOCKED: DRY_BIN' >&2
    exit 2
  }
  export PATH="$ASI_RECOVERY_DRY_BIN:$PATH"
  case $(readlink -f -- "$(command -v systemctl)") in
    "$(readlink -f -- "$ASI_RECOVERY_DRY_BIN")"/*) ;;
    *) echo 'BLOCKED: DRY_BIN' >&2; exit 2 ;;
  esac
  ENV_FILE=$ROOT/etc/asi/ephemeral-dispatcher.env
else
  [[ "$(id -u)" -eq 0 ]] || { echo 'BLOCKED: RECOVERY_PRIVILEGE' >&2; exit 2; }
  [[ "${ASI_DISPATCHER_HOST_INSTALL:-NO}" == YES ]] || { echo 'BLOCKED: HOST_ROOT' >&2; exit 2; }
  ROOT=/
  ENV_FILE=/etc/asi/ephemeral-dispatcher.env
fi

gate_status() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["status"])' "$1"
}

load_env() {
  [[ -f "$ENV_FILE" ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
  local line key
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[A-Z0-9_]+=[^$\`]*$ ]] || continue
    key=${line%%=*}
    case "$key" in
      ASI_*) export "$line" ;;
    esac
  done < "$ENV_FILE"
  [[ "${ASI_DISPATCHER_EXECUTE:-}" == NO ]] || { echo 'BLOCKED: EXECUTE' >&2; exit 2; }
  [[ "${ASI_PAID_CALLS_ENABLED:-NO}" == NO ]] || { echo 'BLOCKED: PAID_CALLS' >&2; exit 2; }
  LEDGER=${ASI_SPEND_LEDGER:-/home/administrator/asi-continuous/global-paid-spend.sqlite3}
  GOLD=${ASI_GOLD_IMAGE:?}
  NORETRY=${ASI_NO_RETRY_FILE:?}
}

ledger_zero() {
  python3 - "$LEDGER" <<'PY'
import sqlite3, sys
from pathlib import Path
p = Path(sys.argv[1])
if p.is_symlink() or not p.is_file():
    raise SystemExit("LEDGER_UNVERIFIED")
uri = p.resolve().as_uri() + "?mode=ro"
with sqlite3.connect(uri, uri=True) as db:
    row = db.execute("SELECT cap, paused FROM policy WHERE id=1").fetchone()
    calls = db.execute("SELECT count(*) FROM calls").fetchone()[0]
if row is None or int(row[0]) != 0 or int(row[1]) != 0 or int(calls) != 0:
    raise SystemExit("LEDGER_NOT_ZERO")
PY
}

file_stamp() {
  if [[ -e "$1" ]]; then
    sha256sum -- "$1" | awk 'NR==1 { print $1 }'
  else
    printf 'ABSENT\n'
  fi
}

rollback_scenario() {
  local status=$?
  trap - EXIT
  set +e
  if [[ -n "${SNAP:-}" && -f "$SNAP/READY" ]]; then
    ASI_DISPATCHER_HOST_INSTALL=YES ASI_RECOVERY_DAEMON_RELOAD=YES \
      bash "$HERE/activate-dispatcher-recovery.sh" --rollback "$SNAP" "$ROOT"
  fi
  exit "$status"
}

fresh_recover() {
  local cursor=$1 invocation fresh
  invocation=$(systemctl show -p InvocationID --value -- "$UNIT" | tr -d '[:space:]' || true)
  [[ "$invocation" =~ ^[0-9a-fA-F]{32}$ ]] || return 1
  # Unit plus this start's InvocationID. An older RECOVER_OK, including one
  # after the cursor but from another start, does not match.
  fresh=$(journalctl -u "$UNIT" "_SYSTEMD_INVOCATION_ID=${invocation}" \
    --after-cursor "$cursor" -o cat --no-pager || true)
  printf '%s\n' "$fresh" | grep -qx 'RECOVER_OK'
}

queue_decision() {
  local bin mod
  if [[ -n "${ASI_RECOVERY_DRY_ROOT:-}" ]]; then
    bin=$ASI_RECOVERY_DRY_BIN/node
  else
    bin=${ASI_NODE:-node}
  fi
  mod=${ASI_DISPATCHER_MODULE:-/usr/local/lib/asi/ephemeral-dispatcher.mjs}
  local out
  if [[ -n "${ASI_RECOVERY_DRY_ROOT:-}" ]]; then
    out=$("$bin" "$mod" decide)
  else
    out=$(runuser -u administrator -g kvm -- "$bin" "$mod" decide)
  fi
  printf '%s\n' "$out"
  python3 -c 'import json,sys; p=json.loads(sys.stdin.read()); raise SystemExit(0 if p.get("boot") is False else 2)' <<<"$out"
}

bash "$HERE/activate-dispatcher-recovery.sh" --assert-identity

case "$MODE" in
  install-and-verify)
    if [[ "$ROOT" == / && "$(gate_status "$GATE")" != approved ]]; then
      echo 'BLOCKED: GATE_MISSING' >&2
      exit 2
    fi
    load_env
    before_retry=$(file_stamp "$NORETRY")
    gold_stamp=$(stat -c '%u:%g:%a:%i' -- "$GOLD")
    ledger_zero
    trap rollback_scenario EXIT
    # --- STEP1 ---
    ASI_DISPATCHER_HOST_INSTALL=YES bash "$HERE/activate-dispatcher-recovery.sh" --apply "$ROOT"
    SNAP=$ROOT/.asi-recovery-snapshot
    systemctl is-active "$UNIT" > "$SNAP/unit-active" || true
    systemctl is-enabled "$UNIT" > "$SNAP/unit-enabled" || true
    was_active=$(tr -d '[:space:]' < "$SNAP/unit-active")
    # A first start has an empty unit journal, so a unit-scoped cursor does not
    # exist yet. Take the system journal cursor before start. Verification
    # below still requires this unit and its new InvocationID.
    cursor=$(journalctl -n 0 --show-cursor -o cat --no-pager | awk -F': ' '/^-- cursor: / { print $2; exit }' || true)
    [[ -n "${cursor:-}" ]] || { echo 'BLOCKED: JOURNAL' >&2; exit 1; }
    # --- STEP2 ---
    # Successful activation reloads and starts. Rollback is only the failure path.
    ASI_DISPATCHER_HOST_INSTALL=YES ASI_RECOVERY_DAEMON_RELOAD=YES \
      bash "$HERE/activate-dispatcher-recovery.sh" --reload "$ROOT"
    if [[ "$was_active" == active ]]; then
      systemctl restart "$UNIT"
    else
      systemctl start "$UNIT"
    fi
    if [[ "${ASI_RECOVERY_FAIL_POINT:-}" == after-start ]]; then
      echo 'FAILED_AFTER_START' >&2
      exit 1
    fi
    # --- STEP3 ---
    fresh_recover "$cursor" || { echo 'BLOCKED: JOURNAL' >&2; exit 1; }
    ledger_zero || { echo 'BLOCKED: LEDGER' >&2; exit 1; }
    [[ "$(file_stamp "$NORETRY")" == "$before_retry" ]] || { echo 'BLOCKED: NO_RETRY' >&2; exit 1; }
    [[ "$(stat -c '%u:%g:%a:%i' -- "$GOLD")" == "$gold_stamp" ]] || { echo 'BLOCKED: GOLD_CHANGED' >&2; exit 1; }
    if [[ -z "${ASI_RECOVERY_DRY_ROOT:-}" ]]; then
      size=$(qemu-img info -f qcow2 "$GOLD" | sed -n 's/.*(\([0-9][0-9]*\) bytes).*/\1/p' | head -n 1)
      [[ "$size" == 42949672960 ]] || { echo 'BLOCKED: GOLD_CHANGED' >&2; exit 1; }
    fi
    queue_decision >/dev/null
    trap - EXIT
    echo RECOVERY_SCENARIO_OK
    ;;
  enable)
    [[ "${ASI_RECOVERY_ENABLE_AUTHORIZED:-NO}" == YES ]] || { echo 'BLOCKED: ENABLE_UNAUTHORIZED' >&2; exit 2; }
    if [[ -n "${ASI_RECOVERY_DRY_ROOT:-}" && -n "${ASI_RECOVERY_ENABLE_GATE:-}" ]]; then
      export ASI_RECOVERY_ENABLE_GATE
    elif [[ "$(gate_status "$ENABLE_GATE")" != approved ]]; then
      echo 'BLOCKED: ENABLE_UNAUTHORIZED' >&2
      exit 2
    fi
    # --- STEP4 ---
    ASI_DISPATCHER_HOST_INSTALL=YES ASI_RECOVERY_ENABLE_AUTHORIZED=YES \
      bash "$HERE/activate-dispatcher-recovery.sh" --enable "$ROOT"
    ;;
  *)
    echo 'USAGE: onecom-dispatcher-recovery.sh install-and-verify|enable' >&2
    exit 2
    ;;
esac
