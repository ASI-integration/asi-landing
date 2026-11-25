#!/bin/bash
# Plan and, only when ASI_DISPATCHER_EXECUTE=YES, ask the host helper to boot one
# overlay. This script does not build or replace the sealed Gold image.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MODE=${1:-plan}
export ASI_PAID_CALLS_ENABLED=${ASI_PAID_CALLS_ENABLED:-NO}
export ASI_GLOBAL_CAP_KOPECKS=${ASI_GLOBAL_CAP_KOPECKS:-0}
if [[ "$ASI_PAID_CALLS_ENABLED" != NO || "$ASI_GLOBAL_CAP_KOPECKS" != 0 ]]; then
  echo 'BLOCKED: PAID_CALLS_OR_CAP' >&2
  exit 2
fi
NODE=${ASI_NODE:-node}
case "$MODE" in
  plan|recover)
    if [[ -n "${ASI_QUEUE_FILE:-}" && -f "${ASI_QUEUE_FILE}" ]]; then
      "$NODE" "$HERE/ephemeral-dispatcher.mjs" "$MODE" < "${ASI_QUEUE_FILE}"
    else
      echo "DISPATCHER_${MODE^^}"
    fi
    ;;
  serve)
    if [[ "${ASI_DISPATCHER_EXECUTE:-NO}" != YES ]]; then
      echo 'PLAN_ONLY'
      exit 0
    fi
    if [[ -z "${ASI_GOLD_RUN_ONE:-}" || ! -x "${ASI_GOLD_RUN_ONE}" ]]; then
      echo 'BLOCKED: GOLD_BOOT_HELPER_ABSENT' >&2
      exit 2
    fi
    if [[ -z "${ASI_QUEUE_FILE:-}" || ! -f "${ASI_QUEUE_FILE}" ]]; then
      echo 'BLOCKED: QUEUE_UNVERIFIED' >&2
      exit 2
    fi
    plan=$("$NODE" "$HERE/ephemeral-dispatcher.mjs" plan < "${ASI_QUEUE_FILE}")
    job=$(printf '%s' "$plan" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s);if(p.boot===true)process.stdout.write(String(p.job.jobId))})')
    if [[ -z "$job" ]]; then
      printf '%s\n' "$plan"
      exit 0
    fi
    if command -v timeout >/dev/null 2>&1; then
      exec timeout --signal=TERM --kill-after="${KILL_AFTER_SEC:-30}" "${GUEST_TIMEOUT_SEC:-3300}" "${ASI_GOLD_RUN_ONE}" "$job"
    fi
    exec "${ASI_GOLD_RUN_ONE}" "$job"
    ;;
  *)
    echo 'USAGE: asi-ephemeral-dispatcher.sh plan|recover|serve' >&2
    exit 2
    ;;
esac
