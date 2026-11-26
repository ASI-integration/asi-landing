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

stage self-check
out=$(ASI_RECOVERY_SELF_CHECK=YES bash "$HELPER" --self-check)
[[ "$out" == SELF_CHECK_OK ]] || { echo "SELF_CHECK $out" >&2; exit 1; }

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
grep -q 'successful apply is not rolled back' "$STATE/plan.out"
grep -q '^STEP4 ' "$STATE/plan.out"
grep -q '^ROLLBACK ' "$STATE/plan.out"
! grep -E '(^|[[:space:]])chmod[[:space:]]' "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover"
grep -q 'pidfd_send_signal' "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover"
grep -q 'renameat' "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover"
[[ "$(cat "$ROOT/sentinel.env")" == SENTINEL ]] || { echo 'SENTINEL_CHANGED' >&2; exit 1; }
bash "$ACTIVATE" --rollback "$ROOT/.asi-recovery-snapshot" "$ROOT" >"$STATE/rollback.out"
grep -q RECOVERY_ROLLBACK_OK "$STATE/rollback.out"
[[ "$(cat "$ROOT/usr/local/libexec/asi-ephemeral-dispatcher-recover")" == OLD ]] || { echo 'ROLLBACK_HELPER' >&2; exit 1; }
[[ "$(cat "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf")" == OLD ]] || { echo 'ROLLBACK_DROPIN' >&2; exit 1; }
rm -rf -- "$ROOT" "$fake"

grep -q '^User=administrator' "$SRC/asi-ephemeral-dispatcher.service"
grep -q '^ExecStartPre=/usr/local/sbin/asi-ephemeral-dispatcher.sh recover' "$SRC/asi-ephemeral-dispatcher.service"

stage scenario
awk '
  /^[[:space:]]*# --- STEP2 ---/ {s=1}
  /^[[:space:]]*# --- STEP3 ---/ {s=0}
  s && /--rollback/ {found=1}
  END { exit found ? 1 : 0 }
' "$SRC/onecom-dispatcher-recovery.sh" || { echo 'STEP2_ROLLBACK' >&2; exit 1; }
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*'
if [[ -f "$SRC/../../.git" ]] && grep -q '^gitdir: [A-Za-z]:' "$SRC/../../.git"; then
  export GIT_DIR=/mnt/hostc/asi-landing/.git/worktrees/dispatcher-recovery
fi
DRY=$(mktemp -d)
BIN=$(mktemp -d)
LOG=$STATE/systemctl.log
JDIR=$STATE/journal
mkdir -p "$JDIR" "$DRY/etc/asi"
printf 'gold\n' > "$DRY/gold.qcow2"
chmod 0444 "$DRY/gold.qcow2"
printf '9\n' > "$DRY/no-retry.ids"
python3 - "$DRY/ledger.sqlite3" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("CREATE TABLE policy (id INTEGER PRIMARY KEY, cap INTEGER, paused INTEGER)")
db.execute("CREATE TABLE calls (id INTEGER PRIMARY KEY)")
db.execute("INSERT INTO policy (id, cap, paused) VALUES (1, 0, 0)")
db.commit()
PY
cat > "$DRY/etc/asi/ephemeral-dispatcher.env" <<EOF
ASI_DISPATCHER_EXECUTE=NO
ASI_PAID_CALLS_ENABLED=NO
ASI_SPEND_LEDGER=$DRY/ledger.sqlite3
ASI_GOLD_IMAGE=$DRY/gold.qcow2
ASI_NO_RETRY_FILE=$DRY/no-retry.ids
ASI_WORK_DIR=$DRY/work
ASI_LOCK_FILE=$DRY/lock
EOF
cat > "$BIN/systemctl" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$LOG"
case "\$1" in
  is-active) printf '%s\n' inactive; exit 3 ;;
  is-enabled) printf '%s\n' disabled; exit 1 ;;
  start|restart) mkdir -p "$JDIR"; : > "$JDIR/started"; exit 0 ;;
  show) printf '%s\n' '0123456789abcdef0123456789abcdef'; exit 0 ;;
  *) exit 0 ;;
esac
EOF
cat > "$BIN/journalctl" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$LOG"
if printf '%s' "\$*" | grep -q -- --show-cursor; then
  # The unit journal is empty on a first start and has no cursor.
  if printf '%s' "\$*" | grep -q -- '-u'; then
    exit 0
  fi
  printf '%s\n' '-- cursor: s=system;i=1;b=boot;'
  exit 0
fi
if printf '%s' "\$*" | grep -q -- --after-cursor; then
  printf '%s' "\$*" | grep -q -- '-u' || exit 0
  printf '%s' "\$*" | grep -q -- 'asi-ephemeral-dispatcher.service' || exit 0
  printf '%s' "\$*" | grep -q -- 's=system;i=1;b=boot;' || exit 0
  if printf '%s' "\$*" | grep -q -- '_SYSTEMD_INVOCATION_ID=0123456789abcdef0123456789abcdef'; then
    if [ -f "$JDIR/started" ] && [ ! -f "$JDIR/old-only" ]; then
      printf '%s\n' RECOVER_OK
    fi
  fi
  exit 0
fi
printf '%s\n' 'OLD RECOVER_OK'
exit 0
EOF
printf '%s\n' '#!/bin/sh' 'printf "%s\n" "{\"action\":\"hold\",\"reason\":\"QUEUE_EMPTY\",\"boot\":false}"' > "$BIN/node"
chmod 0755 "$BIN/systemctl" "$BIN/journalctl" "$BIN/node"
printf 'OLD\n' > "$STATE/old-recovery"
install -D -m 0644 "$STATE/old-recovery" "$DRY/usr/local/libexec/asi-ephemeral-dispatcher-recover"
install -D -m 0644 "$STATE/old-recovery" "$DRY/etc/systemd/system/asi-ephemeral-dispatcher.service.d/recovery.conf"
: > "$LOG"
set +e
ASI_RECOVERY_DRY_ROOT="$DRY" ASI_RECOVERY_DRY_BIN="$BIN" ASI_RECOVERY_FAIL_POINT=after-start \
  bash "$SRC/onecom-dispatcher-recovery.sh" install-and-verify >"$STATE/fail.out" 2>"$STATE/fail.err"
fail_rc=$?
set -e
[[ "$fail_rc" -ne 0 ]] || { echo 'FAILPOINT_SUCCEEDED' >&2; exit 1; }
grep -q FAILED_AFTER_START "$STATE/fail.err" || { echo 'FAILPOINT_MISSING' >&2; cat "$STATE/fail.err" >&2; exit 1; }
[[ "$(cat "$DRY/usr/local/libexec/asi-ephemeral-dispatcher-recover")" == OLD ]] || { echo 'FAIL_NOT_ROLLED_BACK' >&2; cat "$STATE/fail.err" >&2; exit 1; }
grep -q '^start ' "$LOG"
grep -q '^stop ' "$LOG"
grep -q '^disable ' "$LOG"
! grep -q '^enable ' "$LOG"
: > "$LOG"
rm -f -- "$JDIR/started"
ASI_RECOVERY_DRY_ROOT="$DRY" ASI_RECOVERY_DRY_BIN="$BIN" \
  bash "$SRC/onecom-dispatcher-recovery.sh" install-and-verify >"$STATE/scenario.out" 2>"$STATE/scenario.err" \
  || { echo 'SCENARIO_FAILED' >&2; cat "$STATE/scenario.out" "$STATE/scenario.err" >&2; exit 1; }
grep -q RECOVERY_SCENARIO_OK "$STATE/scenario.out"
grep -q pidfd_send_signal "$DRY/usr/local/libexec/asi-ephemeral-dispatcher-recover"
grep -q '^daemon-reload$' "$LOG"
grep -q '^start ' "$LOG"
grep -q -- '--after-cursor' "$LOG"
cursor_line=$(grep -- '--show-cursor' "$LOG")
printf '%s\n' "$cursor_line" | grep -q -- '-u' && { echo 'EMPTY_JOURNAL_CURSOR' >&2; exit 1; }
grep -- '--after-cursor' "$LOG" | grep -q -- '_SYSTEMD_INVOCATION_ID=0123456789abcdef0123456789abcdef' \
  || { echo 'INVOCATION_FILTER' >&2; exit 1; }
grep -- '--after-cursor' "$LOG" | grep -q -- 'asi-ephemeral-dispatcher.service' \
  || { echo 'UNIT_FILTER' >&2; exit 1; }
! grep -q '^enable ' "$LOG"
: > "$LOG"
rm -f -- "$JDIR/started"
: > "$JDIR/old-only"
set +e
ASI_RECOVERY_DRY_ROOT="$DRY" ASI_RECOVERY_DRY_BIN="$BIN" \
  bash "$SRC/onecom-dispatcher-recovery.sh" install-and-verify >"$STATE/old.out" 2>"$STATE/old.err"
old_rc=$?
set -e
[[ "$old_rc" -ne 0 ]] || { echo 'OLD_JOURNAL_ACCEPTED' >&2; exit 1; }
grep -q 'BLOCKED: JOURNAL' "$STATE/old.err" || { echo 'OLD_JOURNAL_ACCEPTED' >&2; cat "$STATE/old.err" >&2; exit 1; }
grep -q '^stop ' "$LOG"
rm -f -- "$JDIR/old-only"
[[ "$(cat "$DRY/no-retry.ids")" == 9 ]] || { echo 'SCENARIO_NO_RETRY' >&2; exit 1; }
[[ "$(stat -c '%a' -- "$DRY/gold.qcow2")" == 444 ]] || { echo 'SCENARIO_GOLD' >&2; exit 1; }
: > "$LOG"
set +e
ASI_RECOVERY_DRY_ROOT="$DRY" ASI_RECOVERY_DRY_BIN="$BIN" \
  bash "$SRC/onecom-dispatcher-recovery.sh" enable >"$STATE/enable.out" 2>"$STATE/enable.err"
enable_rc=$?
set -e
[[ "$enable_rc" -ne 0 ]]
grep -q ENABLE_UNAUTHORIZED "$STATE/enable.err"
! grep -q '^enable ' "$LOG"
enable_gate=$SRC/../../docs/operations/onecom-dispatcher-recovery-398c2ef0/recovery-enable-owner-gate.json
install_gate=$SRC/../../docs/operations/onecom-dispatcher-recovery-398c2ef0/recovery-dropin-owner-gate.json
python3 - "$enable_gate" "$install_gate" "$STATE/enable-gate.json" <<'PY'
import json, sys
gate = json.load(open(sys.argv[1], encoding="utf-8"))
install = json.load(open(sys.argv[2], encoding="utf-8"))
gate["status"] = "approved"
gate["identity"]["recordId"] = install["identity"]["recordId"]
json.dump(gate, open(sys.argv[3], "w"))
PY
: > "$LOG"
ASI_RECOVERY_DRY_ROOT="$DRY" ASI_RECOVERY_DRY_BIN="$BIN" \
  ASI_RECOVERY_ENABLE_AUTHORIZED=YES ASI_RECOVERY_ENABLE_GATE="$STATE/enable-gate.json" \
  bash "$SRC/onecom-dispatcher-recovery.sh" enable >"$STATE/enabled.out" 2>"$STATE/enabled.err" \
  || { echo 'ENABLE_FAILED' >&2; cat "$STATE/enabled.err" >&2; exit 1; }
grep -q RECOVERY_ENABLE_OK "$STATE/enabled.out"
grep -q '^enable asi-ephemeral-dispatcher.service$' "$LOG"
! grep -q '^start ' "$LOG"
! grep -q '^restart ' "$LOG"
install_gate=$SRC/../../docs/operations/onecom-dispatcher-recovery-398c2ef0/recovery-dropin-owner-gate.json
install_contract=$SRC/../../docs/operations/onecom-dispatcher-recovery-398c2ef0/recovery-dropin-runtime-contract.json
python3 - "$install_gate" "$install_contract" "$enable_gate" <<'PY'
import json, sys
gate, contract, enable = (json.load(open(path, encoding="utf-8")) for path in sys.argv[1:4])
if gate["status"] != "approved" or gate["authorization"]["scope"] != contract["scope"]:
    raise SystemExit("install gate is not approved for this package")
if gate["identity"]["recordId"] != contract["identity"]["recordId"]:
    raise SystemExit("install identity mismatch")
if enable["status"] != "approved":
    raise SystemExit("enable gate is not approved")
enable_contract = json.load(open(sys.argv[2].replace("recovery-dropin-runtime-contract.json", "recovery-enable-runtime-contract.json"), encoding="utf-8"))
if enable["authorization"]["scope"] != enable_contract["scope"]:
    raise SystemExit("enable scope mismatch")
if "systemctl enable" not in enable["authorization"]["scope"] or "Do not start or restart" not in enable["authorization"]["scope"]:
    raise SystemExit("enable scope is not bound")
if "systemctl start" not in contract["scope"] or "Do not systemctl enable" not in contract["scope"]:
    raise SystemExit("start is not bound in the install scope")
if "systemctl start" not in gate["allowedSideEffect"] or "Do not systemctl enable" not in gate["allowedSideEffect"]:
    raise SystemExit("start is not bound in the allowed side effect")
PY
rm -rf -- "$DRY" "$BIN"

stage systemd-ten-cycles
command -v systemctl >/dev/null 2>&1 || { echo 'BLOCKED: SYSTEMD' >&2; exit 1; }
id nobody >/dev/null 2>&1 || { echo 'BLOCKED: NOBODY' >&2; exit 1; }
CYCLE=$(mktemp -d)
install -d -m 0710 "$CYCLE/work"
chown nobody:nogroup "$CYCLE/work"
printf 'gold\n' > "$CYCLE/gold"
chmod 0444 "$CYCLE/gold"
: > "$CYCLE/lock"
printf '9\n' > "$CYCLE/noretry"
cat > "$CYCLE/mod.mjs" <<'EOF'
const mode = process.argv[2];
if (mode === 'recover-plan') {
  process.stdout.write(JSON.stringify({action:'recover', rebuildGold:false, remove:[]}) + '\n');
  process.exit(0);
}
process.exit(2);
EOF
cat > "$CYCLE/serve.sh" <<'EOF'
#!/bin/bash
printf '%s\n' '{"action":"idle","reason":"QUEUE_EMPTY","boot":false,"retry":false}'
exit 0
EOF
chmod 0755 "$CYCLE/serve.sh"
cat > /run/systemd/system/asi-recovery-cycles.service <<EOF
[Unit]
Description=ASI recovery ten-cycle acceptance
StartLimitIntervalSec=0

[Service]
Type=simple
User=nobody
Group=nogroup
Environment=ASI_GOLD_IMAGE=$CYCLE/gold
Environment=ASI_WORK_DIR=$CYCLE/work
Environment=ASI_LOCK_FILE=$CYCLE/lock
Environment=ASI_NO_RETRY_FILE=$CYCLE/noretry
Environment=ASI_RECOVERY_USER=nobody
Environment=ASI_DISPATCHER_MODULE=$CYCLE/mod.mjs
Environment=ASI_NODE=$NODE
Environment=ASI_DISPATCHER_EXECUTE=NO
ExecStartPre=+$SRC/asi-ephemeral-dispatcher-recover.sh
ExecStart=$CYCLE/serve.sh
Restart=always
RestartSec=1
EOF
cleanup_cycles() {
  systemctl stop asi-recovery-cycles.service >/dev/null 2>&1 || true
  rm -f /run/systemd/system/asi-recovery-cycles.service
  systemctl daemon-reload >/dev/null 2>&1 || true
  rm -rf -- "$CYCLE"
}
systemctl daemon-reload
systemctl reset-failed asi-recovery-cycles.service >/dev/null 2>&1 || true
cycle_start=$(date '+%Y-%m-%d %H:%M:%S')
systemctl start asi-recovery-cycles.service
cycle_ok=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  sleep 1
  cycle_ok=$(journalctl -u asi-recovery-cycles.service --since "$cycle_start" -o cat --no-pager | grep -c '^RECOVER_OK$' || true)
  [[ "$cycle_ok" -ge 10 ]] && break
done
cycle_left=$(journalctl -u asi-recovery-cycles.service --since "$cycle_start" --no-pager | grep -c 'left-over' || true)
cleanup_cycles
[[ "$cycle_ok" -ge 10 ]] || { echo 'CYCLE_COUNT' >&2; exit 1; }
[[ "$cycle_left" -eq 0 ]] || { echo 'LEFTOVER_PYTHON' >&2; exit 1; }

echo RECOVERY_HELPER_PROVED
