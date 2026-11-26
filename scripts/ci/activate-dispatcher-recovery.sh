#!/bin/bash
# Install the recovery drop-in and helper, or roll them back.
# Refuses a real host root unless ASI_DISPATCHER_HOST_INSTALL=YES.
# systemctl enable is a separate stage. Apply does not enable, start,
# or restart the unit and does not change ASI_DISPATCHER_EXECUTE.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$HERE/../.." && pwd)
BASE_SHA=398c2ef0c2432aff8e841cc3f8075794c869a82a
GATE=$REPO/docs/operations/onecom-dispatcher-recovery-398c2ef0/recovery-dropin-owner-gate.json
ENABLE_GATE=$REPO/docs/operations/onecom-dispatcher-recovery-398c2ef0/recovery-enable-owner-gate.json
UNIT=asi-ephemeral-dispatcher.service
ACTION=
ROOT=
SNAP=
PATHS=(
  usr/local/libexec/asi-ephemeral-dispatcher-recover
  etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf
)

assert_identity() {
  local err
  err=$(mktemp)
  if ! python3 - "$REPO" "$GATE" "$BASE_SHA" 2>"$err" <<'PY'
import hashlib, json, subprocess, sys
repo, gate_path, base = sys.argv[1:4]
try:
    gate = json.load(open(gate_path, encoding="utf-8"))
    if gate["identity"]["sha"] != base:
        raise SystemExit("BASE_SHA")
    rec = {}
    for part in gate["identity"]["recordId"].split(";"):
        key, value = part.split("=", 1)
        rec[key] = value
    exact, package, scenario = rec["exact-sha"], rec["package-sha256"], rec["scenario-sha256"]
    if len(exact) != 40 or len(package) != 64 or len(scenario) != 64:
        raise SystemExit("PACKAGE_SHA")
    text = gate["allowedSideEffect"]
    if base not in text or exact not in text or package not in text or scenario not in text:
        raise SystemExit("GATE_TEXT")
    files = [
        "scripts/ci/asi-ephemeral-dispatcher-recover.sh",
        "scripts/ci/asi-ephemeral-dispatcher.service.d/recovery.conf",
        "scripts/ci/activate-dispatcher-recovery.sh",
    ]
    def show(commit, path):
        return subprocess.check_output(["git", "-C", repo, "show", "%s:%s" % (commit, path)])
    digest = hashlib.sha256()
    for path in files:
        data = show(exact, path)
        if show("HEAD", path) != data:
            raise SystemExit("PACKAGE_DRIFT")
        digest.update(path.encode())
        digest.update(b"\0")
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)
    if digest.hexdigest() != package:
        raise SystemExit("PACKAGE_SHA")
    script = show("HEAD", "scripts/ci/onecom-dispatcher-recovery.sh")
    if hashlib.sha256(script).hexdigest() != scenario:
        raise SystemExit("SCENARIO_SHA")
    if subprocess.call(["git", "-C", repo, "merge-base", "--is-ancestor", exact, "HEAD"]) != 0:
        raise SystemExit("EXACT_SHA")
    if subprocess.call(["git", "-C", repo, "merge-base", "--is-ancestor", base, "HEAD"]) != 0:
        raise SystemExit("BASE_SHA")
except SystemExit:
    raise
except Exception:
    raise SystemExit("PACKAGE_SHA")
PY
  then
    local reason
    reason=$(tr -d '\n' < "$err")
    rm -f -- "$err"
    echo "BLOCKED: ${reason:-PACKAGE_SHA}" >&2
    exit 2
  fi
  rm -f -- "$err"
}

if [[ "${1:-}" == --plan ]]; then
  cat <<'EOF'
STEP1 apply helper and drop-in; any copy failure restores the snapshot
STEP2 daemon-reload and start only while ASI_DISPATCHER_EXECUTE=NO; successful apply is not rolled back
STEP3 require a fresh journal RECOVER_OK, a read-only queue decision, the sqlite ledger, and unchanged NO_RETRY
STEP4 systemctl enable only in the separate enable stage
STEP5 set ASI_DISPATCHER_EXECUTE=YES only under the separate execute-yes owner gate
ROLLBACK restore the snapshot and the original active and enabled state, then daemon-reload
EOF
  exit 0
fi
if [[ "${1:-}" == --assert-identity ]]; then
  assert_identity
  echo RECOVERY_IDENTITY_OK
  exit 0
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) ACTION=stage; ROOT=${2:?}; shift 2 ;;
    --apply) ACTION=apply; ROOT=${2:?}; shift 2 ;;
    --reload) ACTION=reload; ROOT=${2:?}; shift 2 ;;
    --enable) ACTION=enable; ROOT=${2:?}; shift 2 ;;
    --rollback) ACTION=rollback; SNAP=${2:?}; ROOT=${3:?}; shift 3 ;;
    *) echo 'USAGE: activate-dispatcher-recovery.sh --stage DIR | --apply DIR | --reload DIR | --enable DIR | --rollback SNAP DIR' >&2; exit 2 ;;
  esac
done
[[ -n "$ROOT" && -n "$ACTION" ]] || { echo 'BLOCKED: ROOT' >&2; exit 2; }
if [[ "$ROOT" == / && "${ASI_DISPATCHER_HOST_INSTALL:-NO}" != YES ]]; then
  echo 'BLOCKED: HOST_ROOT' >&2
  exit 2
fi

copy_new() {
  install -d -m 0755 \
    "$ROOT/usr/local/libexec" \
    "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d"
  install -m 0755 \
    "$HERE/asi-ephemeral-dispatcher-recover.sh" \
    "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover"
  if [[ "${ASI_RECOVERY_FAIL_POINT:-}" == after-helper ]]; then
    echo 'FAILED_PARTIAL' >&2
    return 1
  fi
  install -m 0644 \
    "$HERE/asi-ephemeral-dispatcher.service.d/recovery.conf" \
    "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf"
}
snapshot_paths() {
  local rel
  for rel in "${PATHS[@]}"; do
    if [[ -f "$ROOT/$rel" ]]; then
      install -d -m 0755 "$SNAP/$(dirname -- "$rel")"
      cp -p -- "$ROOT/$rel" "$SNAP/$rel"
    fi
  done
}
rollback_paths() {
  local rel
  for rel in "${PATHS[@]}"; do
    rm -f -- "$ROOT/$rel"
    if [[ -f "$SNAP/$rel" ]]; then
      install -d -m 0755 "$ROOT/$(dirname -- "$rel")"
      cp -p -- "$SNAP/$rel" "$ROOT/$rel"
    fi
  done
}
systemd_allowed() {
  [[ "$ROOT" == / || "${ASI_RECOVERY_DRY_ROOT:-}" == "$ROOT" ]]
}
restore_unit() {
  [[ -f "$SNAP/unit-active" && -f "$SNAP/unit-enabled" ]] || return 0
  systemd_allowed || return 0
  local was_active was_enabled
  was_active=$(tr -d '[:space:]' < "$SNAP/unit-active")
  was_enabled=$(tr -d '[:space:]' < "$SNAP/unit-enabled")
  case "$was_enabled" in
    enabled) systemctl enable "$UNIT" ;;
    disabled) systemctl disable "$UNIT" ;;
  esac
  if [[ "$was_active" == active ]]; then
    systemctl restart "$UNIT"
  else
    systemctl stop "$UNIT" || true
  fi
}

case "$ACTION" in
  stage) copy_new ;;
  apply)
    SNAP=${ASI_DISPATCHER_SNAPSHOT:-"$ROOT/.asi-recovery-snapshot"}
    rm -rf -- "$SNAP"
    install -d -m 0700 "$SNAP"
    snapshot_paths
    printf 'snapshot\n' > "$SNAP/READY"
    rollback_apply() {
      local status=$?
      trap - ERR
      [[ -f "$SNAP/READY" ]] && rollback_paths
      exit "$status"
    }
    trap rollback_apply ERR
    copy_new
    [[ -s "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover" ]] || false
    [[ -s "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf" ]] || false
    if systemd_allowed && [[ "${ASI_RECOVERY_DAEMON_RELOAD:-NO}" == YES ]]; then
      systemctl daemon-reload
    fi
    trap - ERR
    ;;
  reload)
    systemd_allowed || { echo 'BLOCKED: RELOAD' >&2; exit 2; }
    [[ "${ASI_RECOVERY_DAEMON_RELOAD:-NO}" == YES ]] || { echo 'BLOCKED: RELOAD' >&2; exit 2; }
    systemctl daemon-reload
    ;;
  enable)
    [[ "${ASI_RECOVERY_ENABLE_AUTHORIZED:-NO}" == YES ]] || { echo 'BLOCKED: ENABLE_UNAUTHORIZED' >&2; exit 2; }
    systemd_allowed || { echo 'BLOCKED: ENABLE_SCOPE' >&2; exit 2; }
    if [[ -n "${ASI_RECOVERY_DRY_ROOT:-}" && -n "${ASI_RECOVERY_ENABLE_GATE:-}" ]]; then
      ENABLE_GATE=$ASI_RECOVERY_ENABLE_GATE
    fi
    assert_identity
    python3 - "$GATE" "$ENABLE_GATE" <<'PY'
import json, sys
install, enable = (json.load(open(path, encoding="utf-8")) for path in sys.argv[1:3])
if enable["status"] != "approved":
    raise SystemExit("ENABLE_UNAUTHORIZED")
if enable["identity"]["recordId"] != install["identity"]["recordId"]:
    raise SystemExit("ENABLE_UNAUTHORIZED")
if "systemctl enable" not in enable["allowedSideEffect"]:
    raise SystemExit("ENABLE_UNAUTHORIZED")
PY
    systemctl enable "$UNIT"
    ;;
  rollback)
    [[ -f "$SNAP/READY" ]] || { echo 'BLOCKED: SNAPSHOT_MISSING' >&2; exit 2; }
    rollback_paths
    if systemd_allowed && [[ "${ASI_RECOVERY_DAEMON_RELOAD:-NO}" == YES ]]; then
      systemctl daemon-reload
    fi
    restore_unit
    ;;
esac
echo "RECOVERY_${ACTION^^}_OK"
if [[ "$ACTION" != enable ]]; then
  echo 'ACTIVATION_NO_RESTART'
fi
