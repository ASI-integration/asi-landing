#!/bin/bash
# Executes the real v3.3 launcher's run-one admission. It must select one
# routed job and must not request a runner registration token.
set -euo pipefail
umask 077
SRC=${SRC:?}
LAUNCHER=$SRC/asi-landing-gold-v33.sh
BIN=$(mktemp -d)
STATE=$(mktemp -d)
GH_LOG=$STATE/gh.log
SHA=$(python3 -c 'print("a"*40)')
cleanup() { rm -rf -- "$BIN" "$STATE"; }
trap cleanup EXIT
bash -n "$LAUNCHER"

cat > "$BIN/gh" <<'EOF'
#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
if not args or args[0] != 'api' or len(args) != 2:
    sys.exit(2)
path = args[1]
open(os.environ['GH_LOG'], 'a', encoding='ascii').write(path + '\n')
if '-X' in path or 'registration-token' in path:
    sys.exit(2)
sha = os.environ['SHA']
case = os.environ.get('GOLD_CASE', 'ok')
labels = ['asi-40-1-source_validation']
if case == 'common':
    labels = ['self-hosted', 'linux', 'x64', 'asi-vps-onecom']
extra = ''
if case == 'subset':
    extra = ',{"id":12,"name":"other","status":"queued","conclusion":null,"labels":["asi-40-1-source_validation"]}'
jobs = '{"jobs":[{"id":7,"name":"source_validation","status":"queued","conclusion":null,"labels":%s}%s]}' % (
    __import__('json').dumps(labels), extra)
pages = {
    'repos/ASI-integration/asi-landing/pulls/687': '{"head":{"sha":"%s"}}' % sha,
    'repos/ASI-integration/asi-landing/issues/687/comments?per_page=100&page=1':
        '[{"user":{"id":207600140,"type":"User"},"author_association":"OWNER","performed_via_github_app":null,"body":"ASI-OWNER-APPROVE:CONTRACT-CHANGE:687:%s"}]' % sha,
    'repos/ASI-integration/asi-landing/actions/runs/40': '{"head_sha":"%s","run_attempt":1}' % sha,
    'repos/ASI-integration/asi-landing/actions/runs/40/jobs?per_page=100': jobs,
    'repos/ASI-integration/asi-landing/actions/runs?status=queued&per_page=20':
        '{"workflow_runs":[{"id":51}]}',
    'repos/ASI-integration/asi-landing/actions/runs?status=in_progress&per_page=20':
        '{"workflow_runs":[{"id":40}]}' if case != 'subset' else '{"workflow_runs":[{"id":40},{"id":41}]}',
    'repos/ASI-integration/asi-landing/actions/runs/51/jobs?per_page=100':
        '{"jobs":[{"id":11,"name":"source_validation","status":"queued","conclusion":null,"labels":["self-hosted","linux","x64","asi-vps-onecom"]}]}',
    'repos/ASI-integration/asi-landing/actions/runs/41/jobs?per_page=100':
        '{"jobs":[{"id":12,"name":"other","status":"queued","conclusion":null,"labels":["asi-40-1-source_validation"]}]}',
}
if path not in pages:
    sys.stderr.write('unexpected %s\n' % path)
    sys.exit(2)
sys.stdout.write(pages[path])
EOF
chmod 0755 "$BIN/gh"

export PATH="$BIN:/usr/bin:/bin"
export GH_LOG SHA
cat > "$STATE/binding.json" <<EOF
{"repository":"ASI-integration/asi-landing","jobId":7,"runId":40,"runAttempt":1,"jobName":"source_validation","routeLabel":"asi-40-1-source_validation","prNumber":687,"headSha":"$SHA","event":"pull_request","admission":"owner-comment","labels":["asi-40-1-source_validation"]}
EOF

export ASI_BINDING_FILE=$STATE/binding.json ASI_AUTHORIZED_JOB_ID=7 GOLD_CASE=ok ASI_WORK_DIR=/var/tmp/asi-ephemeral-dispatcher
: > "$GH_LOG"
set +e
timeout 25 bash "$LAUNCHER" run-one >"$STATE/ok.out" 2>"$STATE/ok.err"
ok=$?
set -e
test "$ok" -ne 0
grep -q 'RUN_ONE_ADMITTED label=asi-40-1-source_validation job=7 work=/var/tmp/asi-ephemeral-dispatcher/run-40-1-source_validation' "$STATE/ok.out"
if grep -q registration-token "$GH_LOG"; then echo 'token request' >&2; exit 1; fi
grep -q 'pulls/687' "$GH_LOG"
grep -q 'actions/runs/40' "$GH_LOG"

export ASI_AUTHORIZED_JOB_ID=11
: > "$GH_LOG"
set +e
timeout 25 bash "$LAUNCHER" run-one >"$STATE/foreign.out" 2>"$STATE/foreign.err"
foreign=$?
set -e
test "$foreign" -ne 0
if grep -q RUN_ONE_ADMITTED "$STATE/foreign.out"; then echo 'foreign job admitted' >&2; exit 1; fi
grep -q UNAUTHORIZED_JOB "$STATE/foreign.err"
if grep -q registration-token "$GH_LOG"; then echo 'token request' >&2; exit 1; fi

export ASI_AUTHORIZED_JOB_ID=7 GOLD_CASE=common
: > "$GH_LOG"
set +e
timeout 25 bash "$LAUNCHER" run-one >"$STATE/common.out" 2>"$STATE/common.err"
common=$?
set -e
test "$common" -ne 0
if grep -q RUN_ONE_ADMITTED "$STATE/common.out"; then echo 'common labels admitted' >&2; exit 1; fi
grep -q COMMON_LABEL_BLOCK "$STATE/common.err"

export GOLD_CASE=subset
: > "$GH_LOG"
set +e
timeout 25 bash "$LAUNCHER" run-one >"$STATE/subset.out" 2>"$STATE/subset.err"
subset=$?
set -e
test "$subset" -ne 0
if grep -q RUN_ONE_ADMITTED "$STATE/subset.out"; then echo 'subset route admitted' >&2; exit 1; fi
grep -q FOREIGN_JOB_ROUTE "$STATE/subset.err"

MERGE=$(python3 -c 'print("c"*40)')
cat > "$STATE/event.json" <<EOF
{"pull_request":{"head":{"sha":"$SHA"},"merge_commit_sha":"$MERGE"}}
EOF
chmod 0755 "$STATE"
chmod 0644 "$STATE/event.json"
if [[ "$(id -u)" -eq 0 ]]; then
  id asi-route-hook >/dev/null 2>&1 || /usr/sbin/useradd --system --home-dir /tmp/asi-route-hook --create-home --shell /bin/bash asi-route-hook
  install -o root -g root -m 0755 "$LAUNCHER" "$STATE/hook-launcher"
  /usr/sbin/runuser -u asi-route-hook -- test -w "$STATE/hook-launcher" && { echo 'hook is writable by runner' >&2; exit 1; }
  run_as=(/usr/sbin/runuser -u asi-route-hook --)
else
  install -m 0555 "$LAUNCHER" "$STATE/hook-launcher"
  run_as=()
fi
"${run_as[@]}" env ASI_HOOK_EXEC_CHECK=1 "$STATE/hook-launcher" run-one-hook >"$STATE/exec.out"
grep -q 'ASI_HOOK_EXEC_AS_RUNNER user=' "$STATE/exec.out"
if [[ "$(id -u)" -eq 0 ]]; then
  grep -q 'user=asi-route-hook' "$STATE/exec.out"
fi
"${run_as[@]}" env ASI_EXPECT_RUN_ID=40 ASI_EXPECT_RUN_ATTEMPT=1 ASI_EXPECT_JOB_NAME=source_validation ASI_EXPECT_HEAD="$SHA" \
  GITHUB_RUN_ID=40 GITHUB_RUN_ATTEMPT=1 GITHUB_JOB=source_validation GITHUB_EVENT_NAME=pull_request \
  GITHUB_EVENT_PATH="$STATE/event.json" GITHUB_SHA="$MERGE" \
  "$STATE/hook-launcher" run-one-hook >"$STATE/hook.out"
grep -q 'ASI_ASSIGNED_JOB_MATCH user=' "$STATE/hook.out"
set +e
"${run_as[@]}" env ASI_EXPECT_RUN_ID=40 ASI_EXPECT_RUN_ATTEMPT=1 ASI_EXPECT_JOB_NAME=source_validation ASI_EXPECT_HEAD="$SHA" \
  GITHUB_RUN_ID=40 GITHUB_RUN_ATTEMPT=1 GITHUB_JOB=source_validation GITHUB_EVENT_NAME=pull_request \
  GITHUB_EVENT_PATH="$STATE/event.json" GITHUB_SHA="$SHA" \
  "$STATE/hook-launcher" run-one-hook >"$STATE/hook-bad.out" 2>"$STATE/hook-bad.err"
hook=$?
set -e
test "$hook" -eq 97
grep -q MERGE_SHA_MISMATCH "$STATE/hook-bad.err"
cat > "$STATE/event.json" <<EOF
{"pull_request":{"head":{"sha":"$SHA"},"merge_commit_sha":"$SHA"}}
EOF
set +e
"${run_as[@]}" env ASI_EXPECT_RUN_ID=40 ASI_EXPECT_RUN_ATTEMPT=1 ASI_EXPECT_JOB_NAME=source_validation ASI_EXPECT_HEAD="$SHA" \
  GITHUB_RUN_ID=40 GITHUB_RUN_ATTEMPT=1 GITHUB_JOB=source_validation GITHUB_EVENT_NAME=pull_request \
  GITHUB_EVENT_PATH="$STATE/event.json" GITHUB_SHA="$SHA" \
  "$STATE/hook-launcher" run-one-hook >"$STATE/hook-same.out" 2>"$STATE/hook-same.err"
same=$?
set -e
test "$same" -eq 97
grep -q MERGE_SHA_IS_PR_HEAD "$STATE/hook-same.err"
echo 'GOLD_V33_RUN_ONE_PROVED'
