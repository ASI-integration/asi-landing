#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD_SCRIPT="${ROOT_DIR}/scripts/deploy-shadow-env-guard.sh"
WORKFLOW="${ROOT_DIR}/.github/workflows/deploy.yml"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

pass_count=0

pass() {
  pass_count=$((pass_count + 1))
  printf 'ok %d - %s\n' "$pass_count" "$1"
}

apply_guard() {
  local file="$1"
  local secret="${2:-test-runner-secret}"
  printf '%s' "$secret" | bash "$GUARD_SCRIPT" apply "$file"
}

assert_count() {
  local expected="$1" pattern="$2" file="$3"
  local actual
  actual="$(grep -c "$pattern" "$file" || true)"
  [[ "$actual" -eq "$expected" ]]
}

case_dir="${TEST_ROOT}/missing"
mkdir "$case_dir"
apply_guard "${case_dir}/env" >/dev/null
grep -Fxq 'BOOKING_OPS_AUTOMATION_MODE=shadow' "${case_dir}/env"
assert_count 0 '^BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS=' "${case_dir}/env"
pass 'missing environment file creates shadow mode without a canary allowlist'

env_file="${TEST_ROOT}/preserve.env"
printf 'DATABASE_URL=postgres://example\nFEATURE_FLAG=true\n' > "$env_file"
apply_guard "$env_file" >/dev/null
grep -Fxq 'DATABASE_URL=postgres://example' "$env_file"
grep -Fxq 'FEATURE_FLAG=true' "$env_file"
pass 'unrelated variables are preserved'

printf 'BOOKING_OPS_AUTOMATION_MODE=shadow\n' > "$env_file"
apply_guard "$env_file" >/dev/null
assert_count 1 '^BOOKING_OPS_AUTOMATION_MODE=shadow$' "$env_file"
pass 'existing shadow mode remains exactly once'

printf 'BOOKING_OPS_AUTOMATION_MODE=active\n' > "$env_file"
apply_guard "$env_file" >/dev/null
assert_count 1 '^BOOKING_OPS_AUTOMATION_MODE=shadow$' "$env_file"
assert_count 0 '^BOOKING_OPS_AUTOMATION_MODE=active$' "$env_file"
pass 'active mode becomes shadow'

printf 'BOOKING_OPS_AUTOMATION_MODE=canary\n' > "$env_file"
apply_guard "$env_file" >/dev/null
assert_count 1 '^BOOKING_OPS_AUTOMATION_MODE=shadow$' "$env_file"
assert_count 0 '^BOOKING_OPS_AUTOMATION_MODE=canary$' "$env_file"
pass 'canary mode becomes shadow'

printf 'BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS=booking-1,booking-2\n' > "$env_file"
apply_guard "$env_file" >/dev/null
assert_count 0 '^BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS=' "$env_file"
pass 'existing canary allowlist is removed'

printf 'BOOKING_OPS_AUTOMATION_MODE=active\nBOOKING_OPS_AUTOMATION_MODE=shadow\nBOOKING_OPS_AUTOMATION_MODE=canary\n' > "$env_file"
apply_guard "$env_file" >/dev/null
assert_count 1 '^BOOKING_OPS_AUTOMATION_MODE=' "$env_file"
pass 'duplicate automation mode lines become one shadow line'

printf 'BOOKING_OPS_AUTO_SEND_RUNNER_SECRET=old-one\nBOOKING_OPS_AUTO_SEND_RUNNER_SECRET=old-two\n' > "$env_file"
apply_guard "$env_file" 'replacement-secret' >/dev/null
assert_count 1 '^BOOKING_OPS_AUTO_SEND_RUNNER_SECRET=' "$env_file"
grep -Fxq 'BOOKING_OPS_AUTO_SEND_RUNNER_SECRET=replacement-secret' "$env_file"
pass 'duplicate runner secret keys become one line'

printf '# deployment settings\n\nUNRELATED=value with spaces # retained\n# BOOKING_OPS_AUTOMATION_MODE=active\n' > "$env_file"
apply_guard "$env_file" >/dev/null
grep -Fxq '# deployment settings' "$env_file"
grep -Fxq 'UNRELATED=value with spaces # retained' "$env_file"
grep -Fxq '# BOOKING_OPS_AUTOMATION_MODE=active' "$env_file"
pass 'comments, blank lines, and unrelated values remain intact'

printf '# stable\nOTHER=value\n' > "$env_file"
apply_guard "$env_file" >/dev/null
cp "$env_file" "${env_file}.first"
apply_guard "$env_file" >/dev/null
cmp -s "$env_file" "${env_file}.first"
pass 'repeated execution is idempotent'

secret_marker='do-not-print-this-secret'
output="$(apply_guard "$env_file" "$secret_marker" 2>&1)"
[[ "$output" != *"$secret_marker"* ]]
pass 'runner secret value is not printed'

printf 'BOOKING_OPS_AUTO_SEND_RUNNER_SECRET=set\nBOOKING_OPS_AUTOMATION_MODE=shadow\nBOOKING_OPS_AUTOMATION_MODE=active\n' > "$env_file"
if bash "$GUARD_SCRIPT" verify "$env_file" >/dev/null 2>&1; then
  echo 'expected non-shadow verification to fail' >&2
  exit 1
fi
pass 'verification fails if mode is not shadow'

printf 'BOOKING_OPS_AUTO_SEND_RUNNER_SECRET=set\nBOOKING_OPS_AUTOMATION_MODE=shadow\nBOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS=booking-1\n' > "$env_file"
if bash "$GUARD_SCRIPT" verify "$env_file" >/dev/null 2>&1; then
  echo 'expected canary allowlist verification to fail' >&2
  exit 1
fi
pass 'verification fails if a canary allowlist remains'

guard_line="$(grep -n 'deploy-shadow-env-guard.sh.*apply' "$WORKFLOW" | cut -d: -f1)"
deploy_line="$(grep -n 'asi-deploy-artifact.sh.*SHA' "$WORKFLOW" | cut -d: -f1)"
[[ -n "$guard_line" && -n "$deploy_line" && "$guard_line" -lt "$deploy_line" ]]
pass 'environment verification occurs before the deploy script'

grep -Fq 'confirm_production_deploy:' "$WORKFLOW"
grep -Fq 'if [ "${{ inputs.confirm_production_deploy }}" != "DEPLOY_PRODUCTION" ]; then' "$WORKFLOW"
pass 'manual production deployment confirmation remains required'

printf '1..%d\n' "$pass_count"
