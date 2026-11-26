#!/bin/bash
# Install the recovery drop-in and helper, or roll them back.
# Refuses a real host root unless ASI_DISPATCHER_HOST_INSTALL=YES.
# Does not enable, start, or restart the unit, does not change
# ASI_DISPATCHER_EXECUTE, and does not touch Gold or the installed dispatcher.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ACTION=
ROOT=
SNAP=
PATHS=(
  usr/local/libexec/asi-ephemeral-dispatcher-recover
  etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf
)
if [[ "${1:-}" == --plan ]]; then
  cat <<'EOF'
STEP1 apply helper and drop-in; any copy failure restores the snapshot
STEP2 daemon-reload and start only while ASI_DISPATCHER_EXECUTE=NO
STEP3 require RECOVER_OK and a read-only GitHub queue decision
STEP4 set ASI_DISPATCHER_EXECUTE=YES only under the separate execute-yes owner gate
STEP5 restart, then recheck cap 0, Gold, and NO_RETRY
ROLLBACK stop the unit if this run started it, restore the snapshot, daemon-reload
EOF
  exit 0
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) ACTION=stage; ROOT=${2:?}; shift 2 ;;
    --apply) ACTION=apply; ROOT=${2:?}; shift 2 ;;
    --rollback) ACTION=rollback; SNAP=${2:?}; ROOT=${3:?}; shift 3 ;;
    *) echo 'USAGE: activate-dispatcher-recovery.sh --stage DIR | --apply DIR | --rollback SNAP DIR' >&2; exit 2 ;;
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
    if [[ "$ROOT" == / && "${ASI_RECOVERY_DAEMON_RELOAD:-NO}" == YES ]]; then
      systemctl daemon-reload
    fi
    trap - ERR
    ;;
  rollback)
    [[ -f "$SNAP/READY" ]] || { echo 'BLOCKED: SNAPSHOT_MISSING' >&2; exit 2; }
    rollback_paths
    if [[ "$ROOT" == / && "${ASI_RECOVERY_DAEMON_RELOAD:-NO}" == YES ]]; then
      systemctl daemon-reload
    fi
    ;;
esac
echo "RECOVERY_${ACTION^^}_OK"
echo 'ACTIVATION_NO_RESTART'
