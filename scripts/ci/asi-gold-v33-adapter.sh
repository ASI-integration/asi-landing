#!/bin/bash
# Adapter for one authorized guest. It never selects a queue and never builds Gold.
# The proven launcher is executed only as: run-one, with the bound job id.
set -euo pipefail
umask 077
[[ "${1:-}" == run-one && -n "${2:-}" && -n "${3:-}" ]] || { echo 'USAGE: asi-gold-v33-adapter.sh run-one JOB BINDING' >&2; exit 2; }
JOB=$2
BINDING=$3
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$HERE" in
  */usr/local/sbin) MOD="$(dirname "$HERE")/lib/asi/ephemeral-dispatcher.mjs" ;;
  *) MOD="$HERE/ephemeral-dispatcher.mjs" ;;
esac
[[ -f "$MOD" ]] || { echo 'BLOCKED: DISPATCHER_MODULE_MISSING' >&2; exit 2; }
NODE=${ASI_NODE:-node}
"$NODE" "$MOD" authorize "$JOB" "$BINDING"
LAUNCHER=${ASI_GOLD_LAUNCHER:-}
[[ -n "$LAUNCHER" && -x "$LAUNCHER" && ! -L "$LAUNCHER" ]] || { echo 'BLOCKED: GOLD_LAUNCHER_ABSENT' >&2; exit 2; }
fd=${ASI_LOCK_FD:-}
[[ "$fd" =~ ^[0-9]+$ && -e "/proc/self/fd/$fd" ]] || { echo 'BLOCKED: LOCK_NOT_HELD' >&2; exit 2; }
held=$(readlink "/proc/self/fd/$fd" || true)
[[ "$(readlink -f "$held")" == "$(readlink -f "$ASI_LOCK_FILE")" ]] || { echo 'BLOCKED: LOCK_NOT_HELD' >&2; exit 2; }
export ASI_GOLD_MODE=run-one
export ASI_AUTHORIZED_JOB_ID="$JOB"
export ASI_BINDING_FILE="$BINDING"
unset ASI_EXTRA_JOB_ID || true
exec "$LAUNCHER" run-one
