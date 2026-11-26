#!/bin/bash
# Proves the privileged recovery helper without touching production.
# Requires root so the work directory can stay mode 0710.
set -euo pipefail
umask 077
SRC=${SRC:?}
HELPER="$SRC/asi-ephemeral-dispatcher-recover.sh"
ACTIVATE="$SRC/activate-dispatcher-recovery.sh"
NODE=${ASI_NODE:-node}
[[ "$(id -u)" -eq 0 ]] || { echo 'BLOCKED: PROOF_NEEDS_ROOT' >&2; exit 1; }
[[ -x "$NODE" || -x "$(command -v "$NODE")" ]] || { echo 'BLOCKED: NODE_MISSING' >&2; exit 1; }
command -v flock >/dev/null 2>&1 || { echo 'BLOCKED: FLOCK_REQUIRED' >&2; exit 1; }
owner_uid=$(id -u nobody)
owner_gid=$(id -g nobody)

stage() { printf 'STAGE %s\n' "$1"; }
expect_block() {
  local want=$1
  shift
  local err out rc
  err=$(mktemp)
  set +e
  out=$("$@" 2>"$err")
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    echo "EXPECTED_BLOCK $want" >&2
    printf '%s\n' "$out" >&2
    cat "$err" >&2
    exit 1
  fi
  grep -q "$want" "$err" || { echo "MISSING $want" >&2; cat "$err" >&2; exit 1; }
}

stage host-root-refused
expect_block HOST_ROOT bash "$ACTIVATE" --apply /

STATE=$(mktemp -d)
WORK="$STATE/work"
GOLD="$STATE/gold.qcow2"
LOCK="$STATE/dispatcher.lock"
NORETRY="$STATE/no-retry.ids"
DISK="$WORK/guest/disk.qcow2"
LOG="$WORK/guest/console.log"
foreign_pid=
guest_pid=
lock_pid=
trap 'status=$?; for pid in $foreign_pid $guest_pid $lock_pid; do kill -TERM "$pid" 2>/dev/null || true; done; rm -rf -- "$STATE"; exit "$status"' EXIT
install -d -m 0710 -o root -g root "$WORK" "$WORK/guest"
printf 'gold\n' > "$GOLD"
chmod 0444 "$GOLD"
printf '9\n' > "$NORETRY"
printf 'disk\n' > "$DISK"
printf 'log\n' > "$LOG"
printf 'keep\n' > "$STATE/outside.txt"
ln -s "$STATE/outside.txt" "$WORK/guest/evil.qcow2"
chown "$owner_uid:$owner_gid" "$DISK" "$LOG"
printf 'foreign\n' > "$WORK/guest/foreign.qcow2"
chown 0:0 "$WORK/guest/foreign.qcow2"
: > "$LOCK"
chmod 0660 "$LOCK"
export ASI_GOLD_IMAGE="$GOLD" ASI_WORK_DIR="$WORK" ASI_LOCK_FILE="$LOCK" ASI_NO_RETRY_FILE="$NORETRY"
export ASI_RECOVERY_USER=nobody ASI_DISPATCHER_MODULE="$SRC/ephemeral-dispatcher.mjs" ASI_NODE="$NODE"
export ASI_RECOVERY_LOCK_WAIT_SEC=1
stamp=$(stat -c '%u:%g:%a' -- "$WORK")
gold_stamp=$(stat -c '%u:%g:%a:%i' -- "$GOLD")
retry_stamp=$(sha256sum -- "$NORETRY" | awk 'NR==1 { print $1 }')
[[ "$stamp" == "0:0:710" ]] || { echo "WORK_DIR_SETUP $stamp" >&2; exit 1; }

stage foreign-file
expect_block FOREIGN_FILE bash "$HELPER"
[[ -f "$DISK" && -f "$WORK/guest/foreign.qcow2" && -f "$LOG" ]] || { echo 'FOREIGN_FILE_MUTATED' >&2; exit 1; }
[[ "$(stat -c '%u:%g:%a' -- "$WORK")" == "$stamp" ]] || { echo 'WORK_DIR_WIDENED' >&2; exit 1; }
[[ "$(sha256sum -- "$NORETRY" | awk 'NR==1 { print $1 }')" == "$retry_stamp" ]] || { echo 'NO_RETRY_MUTATED' >&2; exit 1; }
rm -f -- "$WORK/guest/foreign.qcow2"

stage hardlink
printf 'outside\n' > "$STATE/outside-disk.qcow2"
chown "$owner_uid:$owner_gid" "$STATE/outside-disk.qcow2"
ln "$STATE/outside-disk.qcow2" "$WORK/guest/linked.qcow2"
expect_block FOREIGN_FILE bash "$HELPER"
[[ "$(cat "$STATE/outside-disk.qcow2")" == outside && -f "$DISK" ]] || { echo 'HARDLINK_MUTATED' >&2; exit 1; }
rm -f -- "$WORK/guest/linked.qcow2"

stage foreign-process
(exec -a "qemu-system-x86_64 $WORK/guest" sleep 30) &
foreign_pid=$!
sleep 0.2
kill -0 "$foreign_pid" 2>/dev/null || { echo 'FOREIGN_PROCESS_NOT_STARTED' >&2; exit 1; }
pgrep -af qemu-system | grep -q "$WORK" || { echo 'FOREIGN_PROCESS_NOT_VISIBLE' >&2; exit 1; }
expect_block FOREIGN_PROCESS bash "$HELPER"
kill -0 "$foreign_pid" 2>/dev/null || { echo 'FOREIGN_PROCESS_KILLED' >&2; exit 1; }
[[ -f "$DISK" ]] || { echo 'FOREIGN_PROCESS_REMOVED_DISK' >&2; exit 1; }
kill -TERM "$foreign_pid" 2>/dev/null || true
wait "$foreign_pid" || true
foreign_pid=

stage owned-guest
runuser -u nobody -- bash -c "exec -a \"qemu-system-x86_64 $WORK/guest\" sleep 30" &
guest_pid=$!
sleep 0.2
kill -0 "$guest_pid" 2>/dev/null || { echo 'GUEST_NOT_STARTED' >&2; exit 1; }
pgrep -af qemu-system | grep -q "$WORK" || { echo 'GUEST_NOT_VISIBLE' >&2; exit 1; }
out=$(bash "$HELPER")
[[ "$out" == RECOVER_OK ]] || { echo "RECOVER_FAILED $out" >&2; exit 1; }
if pgrep -af qemu-system | grep -q "$WORK"; then echo 'GUEST_STILL_RUNNING' >&2; exit 1; fi
wait "$guest_pid" || true
guest_pid=
[[ ! -e "$DISK" ]] || { echo 'DISK_REMAINED' >&2; exit 1; }
[[ "$(cat "$LOG")" == log ]] || { echo 'LOG_LOST' >&2; exit 1; }
[[ -L "$WORK/guest/evil.qcow2" && "$(cat "$STATE/outside.txt")" == keep ]] || { echo 'SYMLINK_TARGET_LOST' >&2; exit 1; }
[[ "$(stat -c '%u:%g:%a' -- "$WORK")" == "$stamp" ]] || { echo 'WORK_DIR_WIDENED' >&2; exit 1; }
[[ "$(stat -c '%u:%g:%a:%i' -- "$GOLD")" == "$gold_stamp" ]] || { echo 'GOLD_CHANGED' >&2; exit 1; }
[[ "$(sha256sum -- "$NORETRY" | awk 'NR==1 { print $1 }')" == "$retry_stamp" ]] || { echo 'NO_RETRY_MUTATED' >&2; exit 1; }

stage restart-again
out=$(bash "$HELPER")
[[ "$out" == RECOVER_OK ]] || { echo "RESTART_FAILED $out" >&2; exit 1; }
[[ "$(cat "$LOG")" == log && "$(sha256sum -- "$NORETRY" | awk 'NR==1 { print $1 }')" == "$retry_stamp" ]] || { echo 'RESTART_MUTATED' >&2; exit 1; }

stage lock-busy
printf 'disk\n' > "$DISK"
chown "$owner_uid:$owner_gid" "$DISK"
flock "$LOCK" sleep 20 &
lock_pid=$!
sleep 0.2
expect_block LOCK_BUSY bash "$HELPER"
[[ -f "$DISK" ]] || { echo 'LOCK_BUSY_REMOVED_DISK' >&2; exit 1; }
kill -TERM "$lock_pid" 2>/dev/null || true
wait "$lock_pid" || true
lock_pid=

stage unprivileged
expect_block RECOVERY_PRIVILEGE runuser -u nobody -- bash "$HELPER"
[[ "$(stat -c '%u:%g:%a' -- "$WORK")" == "$stamp" ]] || { echo 'UNPRIVILEGED_WIDENED_WORK_DIR' >&2; exit 1; }

stage symlink-lock
printf 'sentinel\n' > "$STATE/sentinel"
rm -f -- "$LOCK"
ln -s "$STATE/sentinel" "$LOCK"
expect_block RECOVERY_PATHS bash "$HELPER"
[[ "$(cat "$STATE/sentinel")" == sentinel ]] || { echo 'LOCK_SYMLINK_FOLLOWED' >&2; exit 1; }
rm -f -- "$LOCK"

stage missing-lock-owner
if id administrator >/dev/null 2>&1 && getent group kvm >/dev/null 2>&1; then
  bash "$HELPER" >/dev/null
  [[ "$(stat -c '%U:%G:%a' -- "$LOCK")" == 'administrator:kvm:660' ]] || { echo 'LOCK_OWNER_WRONG' >&2; exit 1; }
else
  expect_block LOCK_OWNER bash "$HELPER"
  [[ ! -e "$LOCK" ]] || { echo 'ROOT_LOCK_CREATED' >&2; exit 1; }
fi

stage activation
ROOT=$(mktemp -d)
printf 'SENTINEL\n' > "$ROOT/sentinel.env"
printf 'OLD\n' > "$ROOT/old-helper"
install -D -m 0644 "$ROOT/old-helper" "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover"
install -D -m 0644 "$ROOT/old-helper" "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf"
rm -f -- "$ROOT/old-helper"
fake=$(mktemp -d)
printf '#!/bin/sh\necho SYSTEMCTL_CALLED\nexit 99\n' > "$fake/systemctl"
chmod 0755 "$fake/systemctl"
set +e
PATH="$fake:$PATH" ASI_RECOVERY_FAIL_POINT=after-helper bash "$ACTIVATE" --apply "$ROOT" >"$STATE/partial.out" 2>"$STATE/partial.err"
partial=$?
set -e
[[ "$partial" -ne 0 ]] || { echo 'PARTIAL_SUCCEEDED' >&2; exit 1; }
[[ "$(cat "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover")" == OLD ]] || { echo 'PARTIAL_NOT_ROLLED_BACK' >&2; exit 1; }
[[ "$(cat "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf")" == OLD ]] || { echo 'PARTIAL_DROPIN' >&2; exit 1; }
grep -q FAILED_PARTIAL "$STATE/partial.err"
PATH="$fake:$PATH" bash "$ACTIVATE" --apply "$ROOT" >"$STATE/apply.out"
grep -q RECOVERY_APPLY_OK "$STATE/apply.out"
grep -q ACTIVATION_NO_RESTART "$STATE/apply.out"
! grep -q SYSTEMCTL_CALLED "$STATE/apply.out"
grep -q '^ExecStartPre=$' "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf"
grep -q '^ExecStartPre=+/usr/local/libexec/asi-ephemeral-dispatcher-recover$' "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf"
! grep -q '^User=' "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf"
! grep -q '^ExecStart=' "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf"
grep -q 'O_NOFOLLOW' "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover"
bash "$ACTIVATE" --plan >"$STATE/plan.out"
grep -q '^STEP1 ' "$STATE/plan.out"
grep -q '^STEP4 ' "$STATE/plan.out"
grep -q '^ROLLBACK ' "$STATE/plan.out"
! grep -q 'chmod' "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover"
[[ "$(cat "$ROOT/sentinel.env")" == SENTINEL ]] || { echo 'SENTINEL_CHANGED' >&2; exit 1; }
bash "$ACTIVATE" --rollback "$ROOT/.asi-recovery-snapshot" "$ROOT" >"$STATE/rollback.out"
grep -q RECOVERY_ROLLBACK_OK "$STATE/rollback.out"
[[ "$(cat "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover")" == OLD ]] || { echo 'ROLLBACK_HELPER' >&2; exit 1; }
[[ "$(cat "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf")" == OLD ]] || { echo 'ROLLBACK_DROPIN' >&2; exit 1; }
rm -rf -- "$ROOT" "$fake"

grep -q '^User=administrator' "$SRC/asi-ephemeral-dispatcher.service"
grep -q '^ExecStartPre=/usr/local/sbin/asi-ephemeral-dispatcher.sh recover' "$SRC/asi-ephemeral-dispatcher.service"
echo RECOVERY_HELPER_PROVED
