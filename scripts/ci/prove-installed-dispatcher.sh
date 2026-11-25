#!/bin/bash
# Proves the installed tree, not the source tree: module path, rollback,
# ledger, read-only gh api, flock, one authorized job, recovery and no retry.
set -euo pipefail
umask 077
SRC=${SRC:?}
NODE=${ASI_NODE:-node}
ROOT=$(mktemp -d)
BIN=$(mktemp -d)
WORK=$(mktemp -d)
STATE=$(mktemp -d)
LOCK=$STATE/guest.lock
LEDGER=$STATE/spend.sqlite3
GOLD=$STATE/gold.qcow2
OUT=$STATE/out.txt
GH_LOG=$STATE/gh.log
SHA=$(python3 -c 'print("a"*40)')
MAIN=$(python3 -c 'print("b"*40)')
cleanup() { rm -rf -- "$ROOT" "$BIN" "$WORK" "$STATE"; }
trap cleanup EXIT

python3 - "$LEDGER" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute('create table policy(id integer primary key, cap integer, paused integer)')
db.execute('create table calls(id integer primary key)')
db.execute('insert into policy(id, cap, paused) values (1, 0, 1)')
db.commit()
PY
printf 'x' > "$GOLD"
chmod 0444 "$GOLD"
cat > "$BIN/qemu-img" <<'EOF'
#!/bin/sh
echo 'virtual size: 40 GiB (42949672960 bytes)'
EOF
chmod 0755 "$BIN/qemu-img"
cat > "$BIN/gh" <<EOF
#!/bin/sh
printf '%s\\n' "\$*" >> "$GH_LOG"
case "\$*" in
  *registration-token*|*" -X "*|*POST*) echo denied >&2; exit 2 ;;
esac
case "\$2" in
  repos/ASI-integration/asi-landing) echo '{"full_name":"ASI-integration/asi-landing"}' ;;
  repos/ASI-integration/asi-landing/actions/workflows/pr-validation.yml) echo '{"id":101,"name":"PR Validation","path":".github/workflows/pr-validation.yml"}' ;;
  repos/ASI-integration/asi-landing/actions/workflows/agent-intake-triage.yml) echo '{"id":202,"name":"Agent Intake Triage","path":".github/workflows/agent-intake-triage.yml"}' ;;
  'repos/ASI-integration/asi-landing/actions/runs?status=queued&per_page=20') echo '{"workflow_runs":[{"id":50,"workflow_id":101,"event":"pull_request","head_sha":"$SHA","head_repository":{"full_name":"ASI-integration/asi-landing"},"pull_requests":[{"number":687}]},{"id":51,"workflow_id":101,"event":"pull_request","head_sha":"$SHA","head_repository":{"full_name":"ASI-integration/asi-landing"},"pull_requests":[{"number":688}]},{"id":52,"workflow_id":999,"event":"pull_request","head_sha":"$SHA","head_repository":{"full_name":"other/asi-landing"},"pull_requests":[{"number":1}]}]}' ;;
  repos/ASI-integration/asi-landing/actions/runners?per_page=100) echo '{"total_count":0,"runners":[]}' ;;
  repos/ASI-integration/asi-landing/commits/main) echo '{"sha":"$MAIN"}' ;;
  repos/ASI-integration/asi-landing/actions/runs/50/jobs?per_page=100) echo '{"jobs":[{"id":9,"name":"source_validation","status":"queued","conclusion":null,"labels":["self-hosted","linux","x64","asi-vps-onecom"]},{"id":12,"name":"validate","status":"completed","conclusion":"failure","labels":["self-hosted","linux","x64","asi-vps-onecom"]}]}' ;;
  repos/ASI-integration/asi-landing/actions/runs/51/jobs?per_page=100) echo '{"jobs":[{"id":11,"name":"source_validation","status":"queued","conclusion":null,"labels":["self-hosted","linux","x64","asi-vps-onecom"]}]}' ;;
  repos/ASI-integration/asi-landing/pulls/687) echo '{"head":{"sha":"$SHA"}}' ;;
  repos/ASI-integration/asi-landing/pulls/688) echo '{"head":{"sha":"$SHA"}}' ;;
  'repos/ASI-integration/asi-landing/issues/687/comments?per_page=100&page=1') echo '[{"user":{"id":207600140,"type":"User"},"author_association":"OWNER","performed_via_github_app":null,"body":"ASI-OWNER-APPROVE:CONTRACT-CHANGE:687:$SHA"}]' ;;
  'repos/ASI-integration/asi-landing/issues/688/comments?per_page=100&page=1') echo '[]' ;;
  *) echo "unexpected \$2" >&2; exit 2 ;;
esac
EOF
chmod 0755 "$BIN/gh"
cat > "$BIN/launcher" <<'EOF'
#!/bin/sh
# ASI_AUTHORIZED_JOB_ID is the only job this launcher may run.
if [ "$1" != "run-one" ]; then echo 'bad mode' >&2; exit 2; fi
if [ -n "${ASI_EXTRA_JOB_ID:-}" ]; then echo 'captured extra job' >&2; exit 3; fi
printf '%s\n' "$ASI_AUTHORIZED_JOB_ID" >> "$OUT"
if [ -n "${HOLD_FILE:-}" ]; then
  : > "$STARTED"
  while [ ! -f "$RELEASE" ]; do sleep 0.1; done
fi
if [ -n "${SLEEP_FOR:-}" ]; then sleep "$SLEEP_FOR"; fi
EOF
chmod 0755 "$BIN/launcher"

export PATH="$BIN:/usr/bin:/bin"
export ASI_NODE="$NODE"
export ASI_GH="$BIN/gh"
export ASI_SPEND_LEDGER="$LEDGER"
export ASI_GOLD_IMAGE="$GOLD"
export ASI_GOLD_LAUNCHER="$BIN/launcher"
export ASI_WORK_DIR="$WORK"
export ASI_LOCK_FILE="$LOCK"
export ASI_STATE_DIR="$STATE"
export ASI_NO_RETRY_FILE="$STATE/no-retry.ids"
export ASI_DISPATCHER_EXECUTE=YES
export OUT="$OUT"
: > "$OUT"

bash "$SRC/install-ephemeral-dispatcher.sh" --apply "$ROOT"
test -x "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh"
test -x "$ROOT/usr/local/sbin/asi-gold-v33-adapter.sh"
test -f "$ROOT/usr/local/lib/asi/ephemeral-dispatcher.mjs"
test ! -e "$ROOT/usr/local/sbin/ephemeral-dispatcher.mjs"
test "$("$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh" module-path)" = "$ROOT/usr/local/lib/asi/ephemeral-dispatcher.mjs"
grep -q 'flock -n' "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh"
grep -q 'timeout --signal=TERM --kill-after=' "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh"
grep -q 'NO_RETRY' "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh"
if grep -E '^NoNewPrivileges=' "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service"; then
  echo 'NoNewPrivileges would block sudo -n' >&2
  exit 1
fi
grep -q 'sudo -n' "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service"
grep -q 'User=administrator' "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service"
grep -q 'ASI_DISPATCHER_EXECUTE=NO' "$ROOT/etc/asi/ephemeral-dispatcher.env"

bad=$("$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh" serve >"$STATE/bad.out" 2>"$STATE/bad.err" || true)
grep -q PAID_CALLS_BLOCK "$STATE/bad.out" || { echo 'LEDGER_BLOCK_MISSING'; cat "$STATE/bad.out" "$STATE/bad.err"; exit 1; }
test ! -s "$OUT"
python3 - "$LEDGER" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute('update policy set paused=0 where id=1')
db.commit()
PY

ROOT2=$(mktemp -d)
mkdir -p "$ROOT2/usr/local/sbin" "$ROOT2/usr/local/lib/asi" "$ROOT2/etc/systemd/system" "$ROOT2/etc/asi"
for rel in usr/local/sbin/asi-ephemeral-dispatcher.sh usr/local/sbin/asi-gold-v33-adapter.sh usr/local/lib/asi/ephemeral-dispatcher.mjs etc/systemd/system/asi-ephemeral-dispatcher.service etc/asi/ephemeral-dispatcher.env; do
  printf 'OLD\n' > "$ROOT2/$rel"
done
set +e
ASI_DISPATCHER_FAIL_POINT=after-shell bash "$SRC/install-ephemeral-dispatcher.sh" --apply "$ROOT2" >"$STATE/partial.out" 2>"$STATE/partial.err"
partial=$?
set -e
test "$partial" -ne 0
for rel in usr/local/sbin/asi-ephemeral-dispatcher.sh usr/local/sbin/asi-gold-v33-adapter.sh usr/local/lib/asi/ephemeral-dispatcher.mjs etc/systemd/system/asi-ephemeral-dispatcher.service etc/asi/ephemeral-dispatcher.env; do
  test "$(cat "$ROOT2/$rel")" = OLD
done
rm -rf -- "$ROOT2"

mkdir -p "$WORK/guest"
printf 'disk\n' > "$WORK/guest/disk.qcow2"
printf 'iso\n' > "$WORK/guest/seed.iso"
printf 'log\n' > "$WORK/guest/console.log"
printf 'keep\n' > "$STATE/outside.txt"
ln -s "$STATE/outside.txt" "$WORK/guest/evil.qcow2"
"$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh" recover >/dev/null
test ! -e "$WORK/guest/disk.qcow2"
test ! -e "$WORK/guest/seed.iso"
test "$(cat "$WORK/guest/console.log")" = log
test "$(cat "$STATE/outside.txt")" = keep
test -L "$WORK/guest/evil.qcow2"
test -f "$GOLD"

binding=$STATE/binding.json
cat > "$binding" <<EOF
{"repository":"ASI-integration/asi-landing","jobId":9,"runId":50,"workflowId":101,"workflowFile":".github/workflows/pr-validation.yml","headSha":"$SHA","event":"pull_request","admission":"owner-comment","labels":["self-hosted","linux","x64","asi-vps-onecom"]}
EOF
set +e
ASI_EXTRA_JOB_ID=11 "$ROOT/usr/local/sbin/asi-gold-v33-adapter.sh" run-one 11 "$binding" >"$STATE/unauth.out" 2>"$STATE/unauth.err"
unauth=$?
set -e
test "$unauth" -eq 2
test ! -s "$OUT"
grep -q UNAUTHORIZED_JOB "$STATE/unauth.out" "$STATE/unauth.err"

set +e
"$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh" serve >"$STATE/serve.out" 2>"$STATE/serve.err"
serve_rc=$?
set -e
grep -q 'actions/runs?status=queued' "$GH_LOG"
grep -q 'pulls/687' "$GH_LOG"
grep -q 'issues/687/comments' "$GH_LOG"
grep -q 'actions/runs/50/jobs' "$GH_LOG"
if grep -q registration-token "$GH_LOG"; then echo 'token request' >&2; exit 1; fi
mem_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
if grep -q GOLD_SEAL_BLOCK "$STATE/serve.out"; then
  test "$(id -u)" -ne 0
  test ! -s "$OUT"
elif [[ "$mem_kb" -lt 7340032 ]]; then
  grep -q WAIT_MEMORY "$STATE/serve.out"
  test ! -s "$OUT"
else
  test "$serve_rc" -eq 0
  grep -q GUEST_FINISHED "$STATE/serve.out"
  test "$(cat "$OUT")" = 9
  : > "$OUT"
fi
export HOLD_FILE=1 STARTED=$STATE/started RELEASE=$STATE/release
"$ROOT/usr/local/sbin/asi-gold-v33-adapter.sh" run-one 9 "$binding" >"$STATE/hold.out" &
holder=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  [[ -f "$STARTED" ]] && break
  sleep 0.2
done
test -f "$STARTED"
set +e
"$ROOT/usr/local/sbin/asi-gold-v33-adapter.sh" run-one 9 "$binding" >"$STATE/busy.out" 2>"$STATE/busy.err"
busy=$?
set -e
test "$busy" -eq 2
grep -q SLOT_BUSY "$STATE/busy.err"
: > "$RELEASE"
wait "$holder"
unset HOLD_FILE STARTED RELEASE
export SLEEP_FOR=5
set +e
timeout --signal=TERM --kill-after=1 1 "$ROOT/usr/local/sbin/asi-gold-v33-adapter.sh" run-one 9 "$binding" >"$STATE/hang.out" 2>"$STATE/hang.err"
hang=$?
set -e
test "$hang" -ne 0
printf '9\n' >> "$STATE/no-retry.ids"
: > "$GH_LOG"
if [[ "$mem_kb" -ge 7340032 ]]; then
  : > "$OUT"
  "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh" serve >"$STATE/again.out"
  grep -q QUEUE_EMPTY "$STATE/again.out"
  test "$(wc -l < "$OUT")" -eq 0
fi
echo 'INSTALLED_DISPATCHER_PROVED'
