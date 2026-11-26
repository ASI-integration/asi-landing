#!/bin/bash
# One-guest dispatcher. Reads the spend ledger and GitHub with gh api.
# Boots only through the Gold v3.3 adapter. Does not build or replace Gold.
set -euo pipefail
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MODE=${1:-serve}
resolve_module() {
  case "$HERE" in
    */usr/local/sbin)
      local lib
      lib="$(dirname "$HERE")/lib/asi/ephemeral-dispatcher.mjs"
      [[ -f "$lib" ]] || { echo 'BLOCKED: DISPATCHER_MODULE_MISSING' >&2; exit 2; }
      printf '%s\n' "$lib"
      ;;
    *)
      [[ -f "$HERE/ephemeral-dispatcher.mjs" ]] || { echo 'BLOCKED: DISPATCHER_MODULE_MISSING' >&2; exit 2; }
      printf '%s\n' "$HERE/ephemeral-dispatcher.mjs"
      ;;
  esac
}
MOD=$(resolve_module)
NODE=${ASI_NODE:-node}
ADAPTER="$HERE/asi-gold-v33-adapter.sh"

case "$MODE" in
  module-path)
    printf '%s\n' "$MOD"
    ;;
  recover)
    [[ -n "${ASI_GOLD_IMAGE:-}" && -n "${ASI_WORK_DIR:-}" ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
    plan=$("$NODE" "$MOD" recover-plan)
    set +e
    list=$(printf '%s' "$plan" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s); if(p.rebuildGold!==false||!Array.isArray(p.remove)) process.exit(2); for (const f of p.remove) process.stdout.write(f+"\n")})')
    rc=$?
    set -e
    [[ "$rc" -eq 0 ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
    pids=()
    if command -v pgrep >/dev/null 2>&1; then
      while read -r pid cmd; do
        [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] || continue
        case "$cmd" in
          pgrep*) continue ;;
        esac
        case "$cmd" in
          *qemu-system*"$ASI_WORK_DIR"*) pids+=("$pid") ;;
        esac
      done < <(pgrep -af qemu-system || true)
    fi
    if ((${#pids[@]})); then
      for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        alive=0
        for pid in "${pids[@]}"; do
          if kill -0 "$pid" 2>/dev/null; then alive=1; fi
        done
        [[ "$alive" -eq 0 ]] && break
        sleep 0.2
      done
      for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
          echo 'BLOCKED: GUEST_STILL_RUNNING' >&2
          exit 2
        fi
      done
    fi
    while IFS= read -r path; do
      [[ -n "$path" ]] || continue
      case "$path" in
        "$ASI_WORK_DIR"/*.qcow2|"$ASI_WORK_DIR"/*/*.qcow2|"$ASI_WORK_DIR"/*/*/*.qcow2|"$ASI_WORK_DIR"/*.iso|"$ASI_WORK_DIR"/*/*.iso|"$ASI_WORK_DIR"/*/*/*.iso)
          rm -f -- "$path"
          ;;
        *)
          echo 'BLOCKED: RECOVERY_PATHS' >&2
          exit 2
          ;;
      esac
    done <<< "$list"
    echo 'RECOVER_OK'
    ;;
  serve)
    command -v flock >/dev/null 2>&1 || { echo 'BLOCKED: FLOCK_REQUIRED' >&2; exit 2; }
    command -v timeout >/dev/null 2>&1 || { echo 'BLOCKED: TIMEOUT_REQUIRED' >&2; exit 2; }
    set +e
    decision=$("$NODE" "$MOD" decide)
    rc=$?
    set -e
    printf '%s\n' "$decision"
    [[ "$rc" -eq 0 ]] || exit "$rc"
    job=$(printf '%s' "$decision" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s); if(p.boot===true) process.stdout.write(String(p.job.jobId))})')
    if [[ -z "$job" ]]; then
      printf '%s\n' "$decision"
      exit 0
    fi
    if [[ "${ASI_DISPATCHER_EXECUTE:-NO}" != YES ]]; then
      printf '%s\n' "$decision"
      echo 'BOOT_HELD'
      exit 0
    fi
    [[ -n "${ASI_LOCK_FILE:-}" && -n "${ASI_STATE_DIR:-}" && -x "$ADAPTER" ]] || { echo 'BLOCKED: GOLD_LAUNCHER_ABSENT' >&2; exit 2; }
    mkdir -p -- "$ASI_STATE_DIR"
    exec 9>>"$ASI_LOCK_FILE"
    if ! flock -n 9; then
      echo 'BLOCKED: SLOT_BUSY' >&2
      exit 2
    fi
    binding="$ASI_STATE_DIR/binding.json"
    printf '%s' "$decision" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s); if(!p.binding||p.binding.jobId!==p.job.jobId) process.exit(2); process.stdout.write(JSON.stringify(p.binding))})' > "$binding"
    chmod 0600 "$binding"
    export ASI_LOCK_FD=9
    set +e
    timeout --signal=TERM --kill-after="${ASI_KILL_AFTER_SEC:-30}" "${ASI_GUEST_TIMEOUT_SEC:-3300}" \
      "$ADAPTER" run-one "$job" "$binding"
    rc=$?
    set -e
    if [[ "$rc" -ne 0 ]]; then
      if [[ -n "${ASI_NO_RETRY_FILE:-}" ]]; then
        printf '%s\n' "$job" >> "$ASI_NO_RETRY_FILE"
      fi
      echo 'NO_RETRY'
      exit 0
    fi
    echo 'GUEST_FINISHED'
    ;;
  *)
    echo 'USAGE: asi-ephemeral-dispatcher.sh module-path|recover|serve' >&2
    exit 2
    ;;
esac
