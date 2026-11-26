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
diagnose() {
  local dest
  dest=$(mktemp /tmp/asi-installed-dispatcher-diagnose.XXXXXXXX.txt)
  {
    echo "=== asi installed dispatcher diagnose $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    echo "saved=$dest"
    id || true
    echo "gold=$(stat -c '%u:%g:%a %F' "$GOLD" 2>&1 || true)"
    echo "node=$(${NODE:-node} -v 2>&1 || true)"
    echo "--- seal.out ---"; cat "$STATE/seal.out" 2>/dev/null || true
    echo "--- seal.err ---"; cat "$STATE/seal.err" 2>/dev/null || true
    echo "--- serve.out ---"; cat "$STATE/serve.out" 2>/dev/null || true
    echo "--- serve.err ---"; cat "$STATE/serve.err" 2>/dev/null || true
    echo "--- second.out ---"; cat "$STATE/second.out" 2>/dev/null || true
    echo "--- second.err ---"; cat "$STATE/second.err" 2>/dev/null || true
  } >"$dest" 2>&1 || true
  cat "$dest" >&2 || true
}
cleanup() { rm -rf -- "$ROOT" "$BIN" "$WORK" "$STATE"; }
trap cleanup EXIT
# An unprivileged user cannot enter a mount namespace directly. A user
# namespace maps that user's fixture to uid 0 so the production seal check
# sees a root-owned 0444 image, then mount --bind can replace meminfo.
# Outside that namespace the same fixture stays non-root and must be blocked.
ns_unshare() {
  if [[ "$(id -u)" -eq 0 ]]; then
    unshare --mount "$@"
  else
    unshare --user --map-root-user --mount "$@"
  fi
}

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
  'repos/ASI-integration/asi-landing/actions/runs?status=queued&per_page=20') echo '{"workflow_runs":[{"id":51,"workflow_id":101,"event":"pull_request","head_sha":"$SHA","run_attempt":1,"head_repository":{"full_name":"ASI-integration/asi-landing"},"pull_requests":[{"number":688}]}]}' ;;
  'repos/ASI-integration/asi-landing/actions/runs?status=in_progress&per_page=20') echo '{"workflow_runs":[{"id":40,"workflow_id":101,"event":"pull_request","head_sha":"$SHA","run_attempt":1,"head_repository":{"full_name":"ASI-integration/asi-landing"},"pull_requests":[{"number":687}]}]}' ;;
  'repos/ASI-integration/asi-landing/actions/runs?status=pending&per_page=20') echo '{"workflow_runs":[]}' ;;
  repos/ASI-integration/asi-landing/actions/runners?per_page=100) echo '{"total_count":0,"runners":[]}' ;;
  repos/ASI-integration/asi-landing/commits/main) echo '{"sha":"$MAIN"}' ;;
  repos/ASI-integration/asi-landing/actions/runs/40/jobs?per_page=100) echo '{"jobs":[{"id":7,"name":"source_validation","status":"queued","conclusion":null,"labels":["asi-40-1-source_validation"]}]}' ;;
  repos/ASI-integration/asi-landing/actions/runs/51/jobs?per_page=100) echo '{"jobs":[{"id":11,"name":"source_validation","status":"queued","conclusion":null,"labels":["asi-51-1-source_validation"]}]}' ;;
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
# Gold v3.3 run-one. The guest job is taken only from the locked binding.
set -eu
[ "$1" = run-one ] || { echo 'bad mode' >&2; exit 2; }
python3 - "$ASI_BINDING_FILE" "$ASI_AUTHORIZED_JOB_ID" <<'PY'
import json, os, sys
binding = json.load(open(sys.argv[1]))
if str(binding.get("jobId")) != sys.argv[2]:
    raise SystemExit(3)
if binding.get("repository") != "ASI-integration/asi-landing":
    raise SystemExit(3)
route = "asi-%s-%s-%s" % (binding.get("runId"), binding.get("runAttempt"), binding.get("jobName"))
if binding.get("routeLabel") != route:
    raise SystemExit(3)
if "linux" in binding.get("labels", []) or "asi-vps-onecom" in binding.get("labels", []):
    raise SystemExit(3)
if os.environ.get("ASI_EXTRA_JOB_ID"):
    raise SystemExit(3)
open(os.environ["OUT"], "a").write(sys.argv[2] + "\n")
open(os.environ["STARTED_MARK"], "a").write("LAUNCHER_STARTED\n")
PY
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
export STARTED_MARK="$STATE/launcher.started"
: > "$OUT"

bash "$SRC/install-ephemeral-dispatcher.sh" --apply "$ROOT"
test -x "$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh"
test -x "$ROOT/usr/local/sbin/asi-gold-v33-adapter.sh"
test -x "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'gold-v32' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'ubuntu-noble-docker-nodejs-actions-runner.qcow2' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'restrict=on' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'token_courier.py' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'github-fetch-proxy.cjs' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'assigned-job.fifo' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'chmod 0710 "$work_base"' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'git/ref/pull/' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'ACTIONS_RUNNER_HOOK_JOB_STARTED="$ACTIONS_RUNNER_HOOK_JOB_STARTED"' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
if grep -q 'ASI_ASSIGNED_JOB_MATCH user=$(id -un) uid=$(id -u)" >/dev/ttyS0' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"; then
  echo 'installed hook still opens the serial device' >&2
  exit 1
fi
if grep -E 'usermod .*dialout|chmod 0666 /dev/ttyS0' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"; then
  echo 'runner serial privilege was added' >&2
  exit 1
fi
grep -q 'device_del' "$ROOT/usr/local/sbin/asi-landing-gold-v33.sh"
grep -q 'gold-v32' "$ROOT/etc/asi/ephemeral-dispatcher.env"
grep -q 'asi-landing-gold-v33.sh' "$ROOT/etc/asi/ephemeral-dispatcher.env"
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
grep -q PAID_CALLS_BLOCK "$STATE/bad.out" || { echo 'LEDGER_BLOCK_MISSING' >&2; cat "$STATE/bad.out" "$STATE/bad.err" >&2; diagnose; exit 1; }
test ! -s "$OUT"
python3 - "$LEDGER" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute('update policy set paused=0 where id=1')
db.commit()
PY

ROOT2=$(mktemp -d)
mkdir -p "$ROOT2/usr/local/sbin" "$ROOT2/usr/local/lib/asi" "$ROOT2/etc/systemd/system" "$ROOT2/etc/asi"
for rel in usr/local/sbin/asi-ephemeral-dispatcher.sh usr/local/sbin/asi-gold-v33-adapter.sh usr/local/sbin/asi-landing-gold-v33.sh usr/local/lib/asi/ephemeral-dispatcher.mjs etc/systemd/system/asi-ephemeral-dispatcher.service etc/asi/ephemeral-dispatcher.env; do
  printf 'OLD\n' > "$ROOT2/$rel"
done
set +e
ASI_DISPATCHER_FAIL_POINT=after-shell bash "$SRC/install-ephemeral-dispatcher.sh" --apply "$ROOT2" >"$STATE/partial.out" 2>"$STATE/partial.err"
partial=$?
set -e
test "$partial" -ne 0
for rel in usr/local/sbin/asi-ephemeral-dispatcher.sh usr/local/sbin/asi-gold-v33-adapter.sh usr/local/sbin/asi-landing-gold-v33.sh usr/local/lib/asi/ephemeral-dispatcher.mjs etc/systemd/system/asi-ephemeral-dispatcher.service etc/asi/ephemeral-dispatcher.env; do
  test "$(cat "$ROOT2/$rel")" = OLD
done
rm -rf -- "$ROOT2"

mkdir -p "$WORK/guest" "$WORK/run-40-1-source_validation/guest-1"
printf 'disk\n' > "$WORK/guest/disk.qcow2"
printf 'iso\n' > "$WORK/guest/seed.iso"
printf 'log\n' > "$WORK/guest/console.log"
printf 'disk\n' > "$WORK/run-40-1-source_validation/guest-1/disk.qcow2"
printf 'log\n' > "$WORK/run-40-1-source_validation/guest-1/console.log"
printf 'keep\n' > "$STATE/outside.txt"
ln -s "$STATE/outside.txt" "$WORK/guest/evil.qcow2"
python3 -c 'import os,sys; os.execv("/bin/sleep", ["qemu-system-x86_64", "30", sys.argv[1]])' "$WORK/guest" &
guest_pid=$!
sleep 0.2
"$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh" recover >/dev/null
if kill -0 "$guest_pid" 2>/dev/null; then echo 'GUEST_STILL_RUNNING' >&2; diagnose; exit 1; fi
wait "$guest_pid" || true
test ! -e "$WORK/guest/disk.qcow2"
test ! -e "$WORK/guest/seed.iso"
test ! -e "$WORK/run-40-1-source_validation/guest-1/disk.qcow2"
test "$(cat "$WORK/guest/console.log")" = log
test "$(cat "$WORK/run-40-1-source_validation/guest-1/console.log")" = log
test "$(cat "$STATE/outside.txt")" = keep
test -L "$WORK/guest/evil.qcow2"
test -f "$GOLD"

binding=$STATE/binding.json
cat > "$binding" <<EOF
{"repository":"ASI-integration/asi-landing","jobId":7,"runId":40,"workflowId":101,"workflowFile":".github/workflows/pr-validation.yml","headSha":"$SHA","event":"pull_request","admission":"owner-comment","labels":["self-hosted","linux","x64","asi-vps-onecom"]}
EOF
set +e
"$ROOT/usr/local/sbin/asi-gold-v33-adapter.sh" run-one 11 "$binding" >"$STATE/unauth.out" 2>"$STATE/unauth.err"
unauth=$?
set -e
test "$unauth" -eq 2
test ! -s "$OUT"
test ! -s "$STARTED_MARK"
grep -q UNAUTHORIZED_JOB "$STATE/unauth.out" "$STATE/unauth.err"
rm -f -- "$binding"
printf 'MemAvailable:    8388608 kB\n' > "$STATE/meminfo"
export ASI_MEMINFO_FILE=$STATE/meminfo
export ASI_DISPATCHER=$ROOT/usr/local/sbin/asi-ephemeral-dispatcher.sh
cat > "$STATE/serve-isolated.sh" <<'EOF'
#!/bin/bash
set -euo pipefail
gold_stat=$(stat -c '%u:%a' "$ASI_GOLD_IMAGE")
if [[ "$gold_stat" != 0:444 || -L "$ASI_GOLD_IMAGE" ]]; then
  echo "GOLD_FIXTURE_NOT_ROOT_SEALED stat=$gold_stat" >&2
  exit 1
fi
mount --bind "$ASI_MEMINFO_FILE" /proc/meminfo
grep -q '^MemAvailable:[[:space:]]*8388608 kB$' /proc/meminfo || { echo MEMINFO_BIND_FAILED >&2; exit 1; }
exec "$ASI_DISPATCHER" serve
EOF
chmod 0755 "$STATE/serve-isolated.sh"
if [[ "$(id -u)" -ne 0 ]]; then
  set +e
  "$ASI_DISPATCHER" serve >"$STATE/seal.out" 2>"$STATE/seal.err"
  seal=$?
  set -e
  if [[ "$seal" -eq 0 ]] || ! grep -q GOLD_SEAL_BLOCK "$STATE/seal.out"; then
    echo 'GOLD_SEAL_NOT_ENFORCED' >&2
    diagnose
    exit 1
  fi
fi
export HOLD_FILE=1 STARTED=$STATE/started RELEASE=$STATE/release
ns_unshare "$STATE/serve-isolated.sh" >"$STATE/serve.out" 2>"$STATE/serve.err" &
holder=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  [[ -f "$STARTED_MARK" ]] && break
  sleep 0.2
done
if [[ ! -s "$STARTED_MARK" ]]; then
  echo 'LAUNCHER_NOT_STARTED' >&2
  diagnose
  exit 1
fi
grep -q LAUNCHER_STARTED "$STARTED_MARK"
test "$(cat "$OUT")" = 7
grep -q 'status=in_progress' "$GH_LOG"
grep -q 'status=pending' "$GH_LOG"
grep -q 'actions/runs/40/jobs' "$GH_LOG"
if grep -q registration-token "$GH_LOG"; then echo 'token request' >&2; exit 1; fi
set +e
ns_unshare "$STATE/serve-isolated.sh" >"$STATE/second.out" 2>"$STATE/second.err"
second=$?
set -e
if [[ "$second" -ne 2 ]] || ! grep -q SLOT_BUSY "$STATE/second.err"; then
  echo 'SLOT_NOT_BUSY' >&2
  diagnose
  exit 1
fi
test "$(wc -l < "$OUT")" -eq 1
: > "$RELEASE"
wait "$holder"
grep -q GUEST_FINISHED "$STATE/serve.out"
echo 'INSTALLED_DISPATCHER_PROVED'
