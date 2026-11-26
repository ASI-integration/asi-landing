#!/bin/bash
# Privileged recovery for ExecStartPre only. Restart=always runs this before
# every start, so an empty plan exits 0 and the shared lock is released when
# this process returns. It never starts the dispatcher and never changes the
# work directory mode.
set -euo pipefail
umask 077

RECOVERY_ACT_PY=$(cat <<'PY'
import base64, ctypes, fcntl, os, shutil, signal, stat, subprocess, sys, tempfile, time

libc = ctypes.CDLL(None, use_errno=True)
libc.renameat.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p]
libc.renameat.restype = ctypes.c_int

def rename_at(olddir, old, newdir, new):
    ctypes.set_errno(0)
    rc = libc.renameat(olddir, os.fsencode(old), newdir, os.fsencode(new))
    if rc != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))

def fail(code):
    sys.stderr.write("BLOCKED: %s\n" % code)
    sys.stderr.flush()
    sys.exit(2)

def start_of(pid):
    with open("/proc/%d/stat" % pid, "r", encoding="utf-8", errors="replace") as fh:
        raw = fh.read()
    rest = raw.split(")", 1)[1].strip().split()
    if len(rest) < 20:
        raise OSError("stat")
    return rest[19]

def argv0_of(pid):
    with open("/proc/%d/cmdline" % pid, "rb") as fh:
        return fh.read().split(b"\0", 1)[0]

def uid_of(pid):
    return os.stat("/proc/%d" % pid).st_uid

def lock_matches(fd, path):
    held = os.fstat(fd)
    if not stat.S_ISREG(held.st_mode):
        return False
    try:
        current = os.stat(path, follow_symlinks=False)
    except OSError:
        return False
    if stat.S_ISLNK(current.st_mode):
        return False
    return (current.st_dev, current.st_ino) == (held.st_dev, held.st_ino)

def open_dir(path):
    if not path.startswith("/"):
        raise OSError("path")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.strip("/").split("/"):
            if part in ("", ".", ".."):
                raise OSError("path")
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except Exception:
        os.close(fd)
        raise

def unlink_verified(path, expect_dev, expect_ino, owner_uid):
    work = os.environ["ASI_RECOVERY_WORK_REAL"]
    gold = os.environ["ASI_RECOVERY_GOLD_REAL"]
    noretry = os.environ["ASI_RECOVERY_NORETRY_REAL"]
    if not path.startswith(work + "/"):
        return "UNLINK_FOREIGN"
    rel = path[len(work) + 1:]
    if not rel or rel.startswith("/") or rel == ".." or "/../" in "/%s/" % rel or rel.endswith(".log") or rel.endswith("/no-retry.ids") or rel == "no-retry.ids":
        return "UNLINK_FOREIGN"
    if not (rel.endswith(".qcow2") or rel.endswith(".iso")):
        return "UNLINK_FOREIGN"
    if path in (gold, noretry):
        return "UNLINK_FOREIGN"
    parent = os.path.dirname(path)
    name = os.path.basename(path)
    if name in ("", ".", ".."):
        return "UNLINK_FOREIGN"
    try:
        dirfd = open_dir(parent)
    except OSError:
        return "UNLINK_FOREIGN"
    priv = tempfile.mkdtemp(prefix=".asi-unlink-", dir=parent)
    os.chmod(priv, 0o700)
    privfd = os.open(priv, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    fd = -1
    moved = False
    try:
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dirfd)
        except OSError:
            return "UNLINK_FOREIGN"
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != owner_uid or st.st_nlink != 1:
            return "UNLINK_FOREIGN"
        if (st.st_dev, st.st_ino) != (expect_dev, expect_ino):
            return "UNLINK_FOREIGN"
        try:
            rename_at(dirfd, name, privfd, "held")
        except OSError:
            return "UNLINK_FOREIGN"
        moved = True
        held = os.stat("held", dir_fd=privfd, follow_symlinks=False)
        now = os.fstat(fd)
        if (held.st_dev, held.st_ino) != (now.st_dev, now.st_ino):
            try:
                rename_at(privfd, "held", dirfd, name)
                moved = False
            except OSError:
                pass
            return "UNLINK_FOREIGN"
        os.unlink("held", dir_fd=privfd)
        moved = False
        return "UNLINK_OK"
    finally:
        if fd >= 0:
            os.close(fd)
        os.close(privfd)
        os.close(dirfd)
        if not moved:
            shutil.rmtree(priv, ignore_errors=True)

def signal_pid(pid, start, uid, argv0):
    try:
        pidfd = os.pidfd_open(pid)
    except OSError:
        return "SIGNAL_GONE"
    try:
        try:
            same = start_of(pid) == start and uid_of(pid) == uid and argv0_of(pid) == argv0
        except OSError:
            return "SIGNAL_GONE"
        if not same:
            return "SIGNAL_GONE"
        try:
            signal.pidfd_send_signal(pidfd, signal.SIGTERM)
        except ProcessLookupError:
            return "SIGNAL_GONE"
        except OSError:
            return "SIGNAL_FOREIGN"
        return "SIGNAL_OK"
    finally:
        os.close(pidfd)

def same_pid(pid, start, uid, argv0):
    try:
        pidfd = os.pidfd_open(pid)
    except OSError:
        return "SAME_NO"
    try:
        try:
            ok = start_of(pid) == start and uid_of(pid) == uid and argv0_of(pid) == argv0
        except OSError:
            return "SAME_NO"
        return "SAME_YES" if ok else "SAME_NO"
    finally:
        os.close(pidfd)

def open_lock(path, wait, uid, gid):
    flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        try:
            fd = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o660)
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
    if not lock_matches(fd, path):
        fail("LOCK_OPEN")
    return fd

def self_check():
    procs = []
    try:
        base = tempfile.mkdtemp(prefix="asi-recovery-self-")
        lock_path = os.path.join(base, "lock")
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.unlink(lock_path)
        os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        if lock_matches(fd, lock_path):
            raise SystemExit("lock inode was replaced and still matched")
        os.close(fd)
        work = os.path.join(base, "work")
        os.makedirs(os.path.join(work, "guest"))
        disk = os.path.join(work, "guest", "disk.qcow2")
        with open(disk, "w", encoding="utf-8") as fh:
            fh.write("disk")
        os.chown(disk, os.getuid(), os.getgid())
        held = os.open(disk, os.O_RDONLY | os.O_CLOEXEC)
        st = os.fstat(held)
        os.unlink(disk)
        with open(disk, "w", encoding="utf-8") as fh:
            fh.write("new")
        os.environ["ASI_RECOVERY_WORK_REAL"] = work
        os.environ["ASI_RECOVERY_GOLD_REAL"] = os.path.join(base, "gold.qcow2")
        os.environ["ASI_RECOVERY_NORETRY_REAL"] = os.path.join(base, "no-retry.ids")
        reply = unlink_verified(disk, st.st_dev, st.st_ino, os.getuid())
        os.close(held)
        if reply != "UNLINK_FOREIGN":
            raise SystemExit("unlink swapped inode returned %s" % reply)
        with open(disk, "r", encoding="utf-8") as fh:
            if fh.read() != "new":
                raise SystemExit("swapped file was deleted")
        proc = subprocess.Popen(["sleep", "30"])
        procs.append(proc)
        pid = proc.pid
        start = start_of(pid)
        argv0 = argv0_of(pid)
        uid = uid_of(pid)
        if signal_pid(pid, "0", uid, argv0) != "SIGNAL_GONE":
            raise SystemExit("wrong starttime was signaled")
        if proc.poll() is not None:
            raise SystemExit("process died after a rejected signal")
        if signal_pid(pid, start, uid, argv0) != "SIGNAL_OK":
            raise SystemExit("pidfd signal failed")
        proc.wait(timeout=5)
        later = subprocess.Popen(["sleep", "30"])
        procs.append(later)
        if signal_pid(pid, start, uid, argv0) != "SIGNAL_GONE":
            raise SystemExit("stale pidfd identity was not rejected")
        if later.poll() is not None:
            raise SystemExit("later process was signaled")
        sys.stdout.write("SELF_CHECK_OK\n")
    finally:
        for proc in procs:
            if proc.poll() is None:
                proc.kill()
                proc.wait()

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        self_check()
        return
    path, wait_s, uid_s, gid_s = sys.argv[1:5]
    fd = open_lock(path, int(wait_s), int(uid_s), int(gid_s))
    st = os.fstat(fd)
    sys.stdout.write("LOCK_HELD %d %d\n" % (st.st_dev, st.st_ino))
    sys.stdout.flush()
    for line in sys.stdin:
        parts = line.rstrip("\n").split(" ")
        cmd = parts[0] if parts else ""
        if cmd == "RELEASE":
            break
        try:
            if cmd == "CHECK":
                reply = "LOCK_SAME" if lock_matches(fd, path) else "LOCK_CHANGED"
            elif cmd == "SIGNAL":
                if not lock_matches(fd, path):
                    reply = "LOCK_CHANGED"
                else:
                    argv0 = base64.b64decode(parts[4])
                    reply = signal_pid(int(parts[1]), parts[2], int(parts[3]), argv0)
            elif cmd == "SAME":
                argv0 = base64.b64decode(parts[4])
                reply = same_pid(int(parts[1]), parts[2], int(parts[3]), argv0)
            elif cmd == "UNLINK":
                if not lock_matches(fd, path):
                    reply = "LOCK_CHANGED"
                else:
                    target = base64.b64decode(parts[4]).decode("utf-8", "strict")
                    reply = unlink_verified(target, int(parts[2]), int(parts[3]), int(parts[1]))
            else:
                reply = "BLOCKED"
        except (OSError, ValueError, IndexError, UnicodeError):
            reply = "BLOCKED"
        sys.stdout.write(reply + "\n")
        sys.stdout.flush()
    os.close(fd)

if __name__ == "__main__":
    main()
PY
)

if [[ "$(id -u)" -ne 0 ]]; then
  echo 'BLOCKED: RECOVERY_PRIVILEGE' >&2
  exit 2
fi
if [[ "${1:-}" == --self-check ]]; then
  [[ "${ASI_RECOVERY_SELF_CHECK:-NO}" == YES ]] || { echo 'BLOCKED: RECOVERY_SCOPE' >&2; exit 2; }
  python3 -c "$RECOVERY_ACT_PY" --self-check
  exit $?
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
export ASI_RECOVERY_WORK_REAL=$work_real ASI_RECOVERY_GOLD_REAL=$gold_real ASI_RECOVERY_NORETRY_REAL=$noretry_real

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
coproc LOCKHELD {
  python3 -c "$RECOVERY_ACT_PY" "$lock" "$wait_sec" "$lock_uid" "$lock_gid"
}
held=
if ! IFS= read -r -t "$((wait_sec + 2))" held <&"${LOCKHELD[0]}"; then
  release_lock
  exit 2
fi
read -r tag lock_dev lock_ino <<<"$held"
[[ "$tag" == LOCK_HELD && "$lock_dev" =~ ^[0-9]+$ && "$lock_ino" =~ ^[0-9]+$ ]] || {
  release_lock
  echo 'BLOCKED: LOCK_OPEN' >&2
  exit 2
}
[[ "$(stat -c '%d %i' -- "$lock")" == "$lock_dev $lock_ino" ]] || {
  release_lock
  echo 'BLOCKED: LOCK_OWNER' >&2
  exit 2
}
lock_stamp=$(stat -c '%u:%g:%a:%d:%i' -- "$lock")

ask() {
  printf '%s\n' "$1" >&"${LOCKHELD[1]}" || { echo 'BLOCKED: LOCK_OPEN' >&2; exit 2; }
  if ! IFS= read -r -t 10 ASK_REPLY <&"${LOCKHELD[0]}"; then
    echo 'BLOCKED: LOCK_OPEN' >&2
    exit 2
  fi
}

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

declare -a remove=() remove_dev=() remove_ino=()
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
  remove_dev+=("$(stat -c '%d' -- "$real")")
  remove_ino+=("$(stat -c '%i' -- "$real")")
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

if ((${#kill_pids[@]})); then
  for i in "${!kill_pids[@]}"; do
    argv_b64=$(printf '%s' "${kill_argv0[$i]}" | base64 -w0)
    ask "SIGNAL ${kill_pids[$i]} ${kill_starts[$i]} $owner_uid $argv_b64"
    case "$ASK_REPLY" in
      SIGNAL_OK|SIGNAL_GONE) ;;
      LOCK_CHANGED) echo 'BLOCKED: LOCK_OWNER' >&2; exit 2 ;;
      *) echo 'BLOCKED: FOREIGN_PROCESS' >&2; exit 2 ;;
    esac
  done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    alive=0
    for i in "${!kill_pids[@]}"; do
      argv_b64=$(printf '%s' "${kill_argv0[$i]}" | base64 -w0)
      ask "SAME ${kill_pids[$i]} ${kill_starts[$i]} $owner_uid $argv_b64"
      [[ "$ASK_REPLY" == SAME_YES ]] && alive=1
    done
    [[ "$alive" -eq 0 ]] && break
    sleep 0.2
  done
  for i in "${!kill_pids[@]}"; do
    argv_b64=$(printf '%s' "${kill_argv0[$i]}" | base64 -w0)
    ask "SAME ${kill_pids[$i]} ${kill_starts[$i]} $owner_uid $argv_b64"
    if [[ "$ASK_REPLY" == SAME_YES ]]; then
      echo 'BLOCKED: GUEST_STILL_RUNNING' >&2
      exit 2
    fi
  done
fi

for i in "${!remove[@]}"; do
  path_b64=$(printf '%s' "${remove[$i]}" | base64 -w0)
  ask "UNLINK $owner_uid ${remove_dev[$i]} ${remove_ino[$i]} $path_b64"
  case "$ASK_REPLY" in
    UNLINK_OK) ;;
    LOCK_CHANGED) echo 'BLOCKED: LOCK_OWNER' >&2; exit 2 ;;
    *) echo 'BLOCKED: FOREIGN_FILE' >&2; exit 2 ;;
  esac
done

if [[ "$work_stamp" == ABSENT ]]; then
  [[ ! -e "$work" ]] || { echo 'BLOCKED: WORK_DIR_PERMISSIONS' >&2; exit 2; }
else
  [[ "$(stat -c '%u:%g:%a' -- "$work")" == "$work_stamp" ]] || { echo 'BLOCKED: WORK_DIR_PERMISSIONS' >&2; exit 2; }
fi
[[ "$(stat -c '%u:%g:%a:%i' -- "$gold")" == "$gold_stamp" ]] || { echo 'BLOCKED: GOLD_CHANGED' >&2; exit 2; }
[[ ! -L "$lock" && "$(stat -c '%u:%g:%a:%d:%i' -- "$lock")" == "$lock_stamp" ]] || { echo 'BLOCKED: LOCK_OWNER' >&2; exit 2; }
ask "CHECK"
[[ "$ASK_REPLY" == LOCK_SAME ]] || { echo 'BLOCKED: LOCK_OWNER' >&2; exit 2; }
if [[ "$noretry_stamp" == ABSENT ]]; then
  [[ ! -e "$noretry" ]] || { echo 'BLOCKED: NO_RETRY_CHANGED' >&2; exit 2; }
else
  [[ ! -L "$noretry" && -f "$noretry" ]] || { echo 'BLOCKED: NO_RETRY_CHANGED' >&2; exit 2; }
  [[ "$(sha256sum -- "$noretry" | awk 'NR==1 { print $1 }')" == "$noretry_stamp" ]] || { echo 'BLOCKED: NO_RETRY_CHANGED' >&2; exit 2; }
fi
echo 'RECOVER_OK'
