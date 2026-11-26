#!/bin/bash
# Privileged recovery for ExecStartPre only. Restart=always runs this before
# every start, so an empty plan exits 0 and the shared lock is released when
# this process returns. It never starts the dispatcher and never changes the
# work directory mode.
set -euo pipefail
umask 077

if [[ "$(id -u)" -ne 0 ]]; then
  echo 'BLOCKED: RECOVERY_PRIVILEGE' >&2
  exit 2
fi
[[ "${1:-}" != serve ]] || { echo 'BLOCKED: RECOVERY_SCOPE' >&2; exit 2; }

for name in ASI_GOLD_IMAGE ASI_WORK_DIR ASI_LOCK_FILE ASI_NO_RETRY_FILE; do
  [[ -n "${!name:-}" ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
done

work=$ASI_WORK_DIR
gold=$ASI_GOLD_IMAGE
lock=$ASI_LOCK_FILE
noretry=$ASI_NO_RETRY_FILE
owner=${ASI_RECOVERY_USER:-asi-landing-kvm}
mod=${ASI_DISPATCHER_MODULE:-/usr/local/lib/asi/ephemeral-dispatcher.mjs}
node_bin=${ASI_NODE:-node}
wait_sec=${ASI_RECOVERY_LOCK_WAIT_SEC:-5}

[[ "$owner" != root && "$owner" != administrator ]] || { echo 'BLOCKED: RECOVERY_OWNER' >&2; exit 2; }
owner_uid=$(id -u "$owner" 2>/dev/null || true)
[[ "$owner_uid" =~ ^[0-9]+$ && "$owner_uid" -gt 0 ]] || { echo 'BLOCKED: RECOVERY_OWNER' >&2; exit 2; }
[[ "$work" != / && "$work" != "$gold" && ${#work} -ge 8 ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
[[ "$wait_sec" =~ ^[0-9]+$ ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
[[ ! -L "$work" && ! -L "$gold" && ! -L "$lock" ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
[[ ! -L "$noretry" && -f "$gold" && -f "$mod" ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }

work_real=$(readlink -f -- "$work")
gold_real=$(readlink -f -- "$gold")
[[ "$work_real" != / && "$work_real" != "$gold_real" ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
if [[ -e "$noretry" ]]; then
  noretry_real=$(readlink -f -- "$noretry")
  noretry_stamp=$(sha256sum -- "$noretry" | awk 'NR==1 { print $1 }')
else
  noretry_real=$noretry
  noretry_stamp=ABSENT
fi
if [[ -d "$work" ]]; then
  work_stamp=$(stat -c '%u:%g:%a' -- "$work")
else
  [[ ! -e "$work" ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
  work_stamp=ABSENT
fi
gold_stamp=$(stat -c '%u:%g:%a:%i' -- "$gold")

command -v python3 >/dev/null 2>&1 || { echo 'BLOCKED: LOCK_OPEN' >&2; exit 2; }
lock_uid=0
lock_gid=0
if [[ ! -e "$lock" ]]; then
  id administrator >/dev/null 2>&1 || { echo 'BLOCKED: LOCK_OWNER' >&2; exit 2; }
  getent group kvm >/dev/null 2>&1 || { echo 'BLOCKED: LOCK_OWNER' >&2; exit 2; }
  lock_uid=$(id -u administrator)
  lock_gid=$(getent group kvm | awk -F: 'NR==1 { print $3 }')
  [[ "$lock_uid" =~ ^[0-9]+$ && "$lock_gid" =~ ^[0-9]+$ ]] || { echo 'BLOCKED: LOCK_OWNER' >&2; exit 2; }
fi
release_lock() {
  if [[ -n "${LOCKHELD_PID:-}" ]]; then
    local pid=$LOCKHELD_PID
    LOCKHELD_PID=
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}
trap release_lock EXIT
# O_NOFOLLOW|O_EXCL: a symlink planted in place of the lock is never opened.
coproc LOCKHELD {
  python3 -c 'import os, stat, sys, time, fcntl
path, wait_s, uid_s, gid_s = sys.argv[1:]
wait, uid, gid = int(wait_s), int(uid_s), int(gid_s)
def fail(code):
    sys.stderr.write("BLOCKED: %s\n" % code)
    sys.stderr.flush()
    sys.exit(2)
try:
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
except FileNotFoundError:
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o660)
    except FileExistsError:
        fail("LOCK_OPEN")
    os.fchown(fd, uid, gid)
    os.fchmod(fd, 0o660)
except OSError:
    fail("LOCK_OPEN")
if not stat.S_ISREG(os.fstat(fd).st_mode):
    fail("LOCK_OPEN")
deadline = time.monotonic() + wait
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() >= deadline:
            fail("LOCK_BUSY")
        time.sleep(0.05)
sys.stdout.write("LOCK_HELD\n")
sys.stdout.flush()
try:
    sys.stdin.read()
except Exception:
    pass
' "$lock" "$wait_sec" "$lock_uid" "$lock_gid"
}
held=
if ! IFS= read -r -t "$((wait_sec + 2))" held <&"${LOCKHELD[0]}"; then
  release_lock
  exit 2
fi
[[ "$held" == LOCK_HELD ]] || { release_lock; echo 'BLOCKED: LOCK_OPEN' >&2; exit 2; }
lock_stamp=$(stat -c '%u:%g:%a' -- "$lock")

set +e
plan=$("$node_bin" "$mod" recover-plan)
plan_rc=$?
set -e
[[ "$plan_rc" -eq 0 ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
set +e
list=$(printf '%s' "$plan" | "$node_bin" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s); if(p.action!=="recover"||p.rebuildGold!==false||!Array.isArray(p.remove)) process.exit(2); for (const f of p.remove){ if(typeof f!=="string"||f.includes("\n")||f.includes("\0")) process.exit(2); process.stdout.write(f+"\n") }})')
list_rc=$?
set -e
[[ "$list_rc" -eq 0 ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }

declare -a remove=()
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  [[ ! -L "$path" && -f "$path" ]] || { echo 'BLOCKED: FOREIGN_FILE' >&2; exit 2; }
  real=$(readlink -f -- "$path")
  case "$real" in
    "$work_real"/*) ;;
    *) echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2 ;;
  esac
  rest=${real#"$work_real/"}
  [[ "$rest" != "$real" && -n "$rest" && "$rest" != /* ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
  [[ "$real" != "$gold_real" && "$real" != "$noretry_real" ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
  case "$real" in
    *.log|*/no-retry.ids) echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2 ;;
    *.qcow2|*.iso) ;;
    *) echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2 ;;
  esac
  [[ "$(stat -c '%u' -- "$path")" == "$owner_uid" ]] || { echo 'BLOCKED: FOREIGN_FILE' >&2; exit 2; }
  [[ "$(stat -c '%h' -- "$path")" == 1 ]] || { echo 'BLOCKED: FOREIGN_FILE' >&2; exit 2; }
  remove+=("$real")
done <<< "$list"

proc_start() {
  local raw rest
  raw=$(cat "/proc/$1/stat" 2>/dev/null || true)
  rest=${raw#*)}
  awk 'NF>=20 { print $20 }' <<< "${rest# }"
}

declare -a kill_pids=() kill_starts=() kill_argv0=()
if command -v pgrep >/dev/null 2>&1; then
  while read -r pid cmd; do
    [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] || continue
    case "$cmd" in
      pgrep*) continue ;;
      *qemu-system*"$work"*|*qemu-system*"$work_real"*) ;;
      *) continue ;;
    esac
    [[ -d "/proc/$pid" ]] || continue
    argv0=$(tr '\0' '\n' < "/proc/$pid/cmdline" | head -n 1 || true)
    cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" || true)
    case "$argv0" in
      qemu-system*|*/qemu-system*) ;;
      *) continue ;;
    esac
    case "$cmdline" in
      *"$work"*|*"$work_real"*) ;;
      *) continue ;;
    esac
    if [[ "$(stat -c '%u' "/proc/$pid")" != "$owner_uid" ]]; then
      echo 'BLOCKED: FOREIGN_PROCESS' >&2
      exit 2
    fi
    start=$(proc_start "$pid")
    [[ "$start" =~ ^[0-9]+$ ]] || { echo 'BLOCKED: FOREIGN_PROCESS' >&2; exit 2; }
    kill_pids+=("$pid")
    kill_starts+=("$start")
    kill_argv0+=("$argv0")
  done < <(pgrep -af qemu-system || true)
fi

guest_same() {
  local pid=$1 start=$2 argv=$3 now
  [[ -d "/proc/$pid" ]] || return 1
  [[ "$(stat -c '%u' "/proc/$pid" 2>/dev/null || true)" == "$owner_uid" ]] || return 1
  [[ "$(proc_start "$pid")" == "$start" ]] || return 1
  now=$(tr '\0' '\n' < "/proc/$pid/cmdline" | head -n 1 || true)
  [[ "$now" == "$argv" ]] || return 1
}

if ((${#kill_pids[@]})); then
  for i in "${!kill_pids[@]}"; do
    if [[ ! -d "/proc/${kill_pids[$i]}" ]]; then
      continue
    fi
    if ! guest_same "${kill_pids[$i]}" "${kill_starts[$i]}" "${kill_argv0[$i]}"; then
      echo 'BLOCKED: FOREIGN_PROCESS' >&2
      exit 2
    fi
    kill -TERM "${kill_pids[$i]}" 2>/dev/null || true
  done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    alive=0
    for i in "${!kill_pids[@]}"; do
      if guest_same "${kill_pids[$i]}" "${kill_starts[$i]}" "${kill_argv0[$i]}"; then alive=1; fi
    done
    [[ "$alive" -eq 0 ]] && break
    sleep 0.2
  done
  for i in "${!kill_pids[@]}"; do
    if guest_same "${kill_pids[$i]}" "${kill_starts[$i]}" "${kill_argv0[$i]}"; then
      echo 'BLOCKED: GUEST_STILL_RUNNING' >&2
      exit 2
    fi
  done
fi

for path in "${remove[@]+"${remove[@]}"}"; do
  [[ ! -L "$path" && -f "$path" ]] || { echo 'BLOCKED: FOREIGN_FILE' >&2; exit 2; }
  now=$(readlink -f -- "$path")
  [[ "$now" == "$path" ]] || { echo 'BLOCKED: FOREIGN_FILE' >&2; exit 2; }
  rest=${now#"$work_real/"}
  [[ "$rest" != "$now" && -n "$rest" && "$rest" != /* ]] || { echo 'BLOCKED: RECOVERY_PATHS' >&2; exit 2; }
  [[ "$(stat -c '%u:%h' -- "$path")" == "${owner_uid}:1" ]] || { echo 'BLOCKED: FOREIGN_FILE' >&2; exit 2; }
  rm -f -- "$path"
done

if [[ "$work_stamp" == ABSENT ]]; then
  [[ ! -e "$work" ]] || { echo 'BLOCKED: WORK_DIR_PERMISSIONS' >&2; exit 2; }
else
  [[ "$(stat -c '%u:%g:%a' -- "$work")" == "$work_stamp" ]] || { echo 'BLOCKED: WORK_DIR_PERMISSIONS' >&2; exit 2; }
fi
[[ "$(stat -c '%u:%g:%a:%i' -- "$gold")" == "$gold_stamp" ]] || { echo 'BLOCKED: GOLD_CHANGED' >&2; exit 2; }
[[ ! -L "$lock" && "$(stat -c '%u:%g:%a' -- "$lock")" == "$lock_stamp" ]] || { echo 'BLOCKED: LOCK_OWNER' >&2; exit 2; }
if [[ "$noretry_stamp" == ABSENT ]]; then
  [[ ! -e "$noretry" ]] || { echo 'BLOCKED: NO_RETRY_CHANGED' >&2; exit 2; }
else
  [[ ! -L "$noretry" && -f "$noretry" ]] || { echo 'BLOCKED: NO_RETRY_CHANGED' >&2; exit 2; }
  [[ "$(sha256sum -- "$noretry" | awk 'NR==1 { print $1 }')" == "$noretry_stamp" ]] || { echo 'BLOCKED: NO_RETRY_CHANGED' >&2; exit 2; }
fi
echo 'RECOVER_OK'
