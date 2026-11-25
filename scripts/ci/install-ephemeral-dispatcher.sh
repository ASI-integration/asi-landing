#!/bin/bash
# Atomic package installer. Refuses the real host root unless a separate
# ASI_DISPATCHER_HOST_INSTALL=YES is present. A partial copy rolls back.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ACTION=stage
ROOT=${ASI_DISPATCHER_ROOT:-}
SNAP=
PATHS=(
  usr/local/sbin/asi-ephemeral-dispatcher.sh
  usr/local/sbin/asi-gold-v33-adapter.sh
  usr/local/lib/asi/ephemeral-dispatcher.mjs
  etc/systemd/system/asi-ephemeral-dispatcher.service
  etc/asi/ephemeral-dispatcher.env
)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) ACTION=stage; ROOT=${2:?}; shift 2 ;;
    --apply) ACTION=apply; ROOT=${2:?}; shift 2 ;;
    --rollback) ACTION=rollback; SNAP=${2:?}; ROOT=${3:?}; shift 3 ;;
    *) echo 'USAGE: install-ephemeral-dispatcher.sh --stage DIR | --apply DIR | --rollback SNAP DIR' >&2; exit 2 ;;
  esac
done
[[ -n "$ROOT" ]] || { echo 'BLOCKED: ROOT' >&2; exit 2; }
if [[ "$ROOT" == / && "${ASI_DISPATCHER_HOST_INSTALL:-NO}" != YES ]]; then
  echo 'BLOCKED: HOST_ROOT' >&2
  exit 2
fi
copy_new() {
  install -d -m 0755 "$ROOT/usr/local/sbin" "$ROOT/usr/local/lib/asi" "$ROOT/etc/systemd/system" "$ROOT/etc/asi"
  install -m 0755 "$HERE/asi-ephemeral-dispatcher.sh" "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh"
  if [[ "${ASI_DISPATCHER_FAIL_POINT:-}" == after-shell ]]; then
    echo 'FAILED_PARTIAL' >&2
    return 1
  fi
  install -m 0755 "$HERE/asi-gold-v33-adapter.sh" "$ROOT/usr/local/sbin/asi-gold-v33-adapter.sh"
  install -m 0644 "$HERE/ephemeral-dispatcher.mjs" "$ROOT/usr/local/lib/asi/ephemeral-dispatcher.mjs"
  install -m 0644 "$HERE/asi-ephemeral-dispatcher.service" "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service"
  cat > "$ROOT/etc/asi/ephemeral-dispatcher.env" <<'EOF'
ASI_DISPATCHER_EXECUTE=NO
ASI_SPEND_LEDGER=/home/administrator/asi-continuous/global-paid-spend.sqlite3
ASI_GOLD_IMAGE=
ASI_GOLD_LAUNCHER=
ASI_WORK_DIR=/var/tmp/asi-ephemeral-dispatcher
ASI_LOCK_FILE=/var/tmp/asi-ephemeral-dispatcher.lock
ASI_STATE_DIR=/var/tmp/asi-ephemeral-dispatcher-state
ASI_NO_RETRY_FILE=/var/tmp/asi-ephemeral-dispatcher-state/no-retry.ids
EOF
  chmod 0600 "$ROOT/etc/asi/ephemeral-dispatcher.env"
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
    SNAP=${ASI_DISPATCHER_SNAPSHOT:-"$ROOT/.asi-dispatcher-snapshot"}
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
    if [[ "${ASI_DISPATCHER_FAIL_AFTER_SNAPSHOT:-NO}" == YES ]]; then
      echo 'FAILED_AFTER_SNAPSHOT' >&2
      false
    fi
    copy_new
    if [[ ! -s "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh" || ! -s "$ROOT/usr/local/lib/asi/ephemeral-dispatcher.mjs" ]]; then
      false
    fi
    trap - ERR
    ;;
  rollback)
    [[ -f "$SNAP/READY" ]] || { echo 'BLOCKED: SNAPSHOT_MISSING' >&2; exit 2; }
    rollback_paths
    ;;
esac
echo "DISPATCHER_${ACTION^^}_OK"
