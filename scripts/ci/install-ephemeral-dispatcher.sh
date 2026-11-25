#!/bin/bash
# Atomic package installer. Refuses the real host root unless a separate
# ASI_DISPATCHER_HOST_INSTALL=YES is present. Tests use --root on a temp tree.
# Rollback restores the previous unit and script or removes a first install.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ACTION=stage
ROOT=${ASI_DISPATCHER_ROOT:-}
SNAP=
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
  install -m 0644 "$HERE/ephemeral-dispatcher.mjs" "$ROOT/usr/local/lib/asi/ephemeral-dispatcher.mjs"
  install -m 0644 "$HERE/asi-ephemeral-dispatcher.service" "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service"
  printf 'ASI_PAID_CALLS_ENABLED=NO\nASI_GLOBAL_CAP_KOPECKS=0\nASI_DISPATCHER_EXECUTE=NO\n' > "$ROOT/etc/asi/ephemeral-dispatcher.env"
  chmod 0600 "$ROOT/etc/asi/ephemeral-dispatcher.env"
}
case "$ACTION" in
  stage)
    copy_new
    ;;
  apply)
    SNAP=${ASI_DISPATCHER_SNAPSHOT:-"$ROOT/.asi-dispatcher-snapshot"}
    rm -rf -- "$SNAP"
    install -d -m 0700 "$SNAP"
    for rel in usr/local/sbin/asi-ephemeral-dispatcher.sh usr/local/lib/asi/ephemeral-dispatcher.mjs etc/systemd/system/asi-ephemeral-dispatcher.service etc/asi/ephemeral-dispatcher.env; do
      if [[ -f "$ROOT/$rel" ]]; then
        install -d -m 0755 "$SNAP/$(dirname -- "$rel")"
        cp -p -- "$ROOT/$rel" "$SNAP/$rel"
      fi
    done
    printf 'snapshot\n' > "$SNAP/READY"
    if [[ "${ASI_DISPATCHER_FAIL_AFTER_SNAPSHOT:-NO}" == YES ]]; then
      echo 'FAILED_AFTER_SNAPSHOT' >&2
      exit 1
    fi
    copy_new
    if [[ ! -s "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh" ]]; then
      "$0" --rollback "$SNAP" "$ROOT"
      exit 1
    fi
    ;;
  rollback)
    [[ -f "$SNAP/READY" ]] || { echo 'BLOCKED: SNAPSHOT_MISSING' >&2; exit 2; }
    for rel in usr/local/sbin/asi-ephemeral-dispatcher.sh usr/local/lib/asi/ephemeral-dispatcher.mjs etc/systemd/system/asi-ephemeral-dispatcher.service etc/asi/ephemeral-dispatcher.env; do
      rm -f -- "$ROOT/$rel"
      if [[ -f "$SNAP/$rel" ]]; then
        install -d -m 0755 "$ROOT/$(dirname -- "$rel")"
        cp -p -- "$SNAP/$rel" "$ROOT/$rel"
      fi
    done
    ;;
esac
echo "DISPATCHER_${ACTION^^}_OK"
