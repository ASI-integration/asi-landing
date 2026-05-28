#!/usr/bin/env bash
# Staging-only rollback to an existing artifact release.
set -euo pipefail

SHA="${1:-}"

readonly ASI_BASE_DIR="/var/www/asi-staging"
readonly ASI_APP_ROOT="/var/www/asi-staging/current"
readonly PM2_APP_NAME="asi-landing-staging"
readonly PORT="3001"
readonly LIVE_ENV_FILE="/var/www/asi-staging/shared/.env.staging.live"

RELEASES_DIR="${ASI_BASE_DIR}/releases"
SHARED_DIR="${ASI_BASE_DIR}/shared"
CURRENT_LINK="${ASI_APP_ROOT}"
RELEASE_DIR="${RELEASES_DIR}/${SHA}"

log() { printf "\n[%s] %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }

assert_staging_guardrails() {
  [[ "$ASI_BASE_DIR" == "/var/www/asi-staging" ]] || die "Staging rollback must use /var/www/asi-staging"
  [[ "$ASI_BASE_DIR" != "/var/www/asi" ]] || die "Refusing production base dir: /var/www/asi"
  [[ "$ASI_APP_ROOT" == "/var/www/asi-staging/current" ]] || die "Staging rollback must use /var/www/asi-staging/current"
  [[ "$ASI_APP_ROOT" != "/var/www/asi/current" ]] || die "Refusing production current path: /var/www/asi/current"
  [[ "$PM2_APP_NAME" == "asi-landing-staging" ]] || die "Staging rollback must use asi-landing-staging"
  [[ "$PM2_APP_NAME" != "asi-landing" ]] || die "Refusing production PM2 app: asi-landing"
  [[ "$PORT" == "3001" ]] || die "Staging rollback must use port 3001"
  [[ "$PORT" != "3000" ]] || die "Refusing production port: 3000"
  [[ "$LIVE_ENV_FILE" == "/var/www/asi-staging/shared/.env.staging.live" ]] || die "Staging rollback must use .env.staging.live"
  [[ "$LIVE_ENV_FILE" != *"production"* ]] || die "Refusing production-like env path: $LIVE_ENV_FILE"
}

assert_safe_command_args() {
  local rendered="$*"
  [[ "$rendered" != *"/var/www/asi/current"* ]] || die "Refusing command that references production current path: $rendered"
  [[ "$rendered" != *"/var/www/asi "* ]] || die "Refusing command that references production base path: $rendered"
  [[ ! "$rendered" =~ (^|[[:space:]])asi-landing($|[[:space:]]) ]] || die "Refusing command that targets production PM2 process: $rendered"
  [[ "$rendered" != *":3000"* && "$rendered" != *" 3000"* ]] || die "Refusing command that references production port 3000: $rendered"
}

if [[ -z "${SHA:-}" || ! "$SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "Usage: bash scripts/rollback-artifact-staging.sh <existing-release-sha>" >&2
  exit 2
fi

assert_staging_guardrails
require_cmd pm2
require_cmd node
require_cmd curl

[[ -d "$RELEASE_DIR" ]] || die "Release directory not found: $RELEASE_DIR"
[[ -f "${RELEASE_DIR}/ecosystem.staging.config.cjs" ]] || die "Release missing ecosystem.staging.config.cjs: $RELEASE_DIR"
[[ -f "${RELEASE_DIR}/release-meta.json" ]] || die "Release missing release-meta.json: $RELEASE_DIR"

EXPECTED_SHA="$(node -e "
const fs = require('fs');
const p = require('path').join(process.argv[1], 'release-meta.json');
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const s = typeof j.gitSha === 'string' ? j.gitSha.trim() : '';
if (!s) process.exit(2);
process.stdout.write(s);
" "$RELEASE_DIR" 2>/dev/null)" || die "Could not read gitSha from release-meta.json"
[[ "$EXPECTED_SHA" == "$SHA" ]] || die "Artifact metadata SHA (${EXPECTED_SHA}) does not match requested rollback SHA (${SHA})"

mkdir -p "$SHARED_DIR"
touch "$LIVE_ENV_FILE"

merge_env_kv() {
  local key="$1"
  local val="$2"
  [[ -z "${val:-}" ]] && return 0
  local tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$LIVE_ENV_FILE" >"$tmp" || true
  printf "%s=%s\n" "$key" "$val" >>"$tmp"
  mv "$tmp" "$LIVE_ENV_FILE"
}

remove_env_key() {
  local key="$1"
  local tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$LIVE_ENV_FILE" >"$tmp" || true
  mv "$tmp" "$LIVE_ENV_FILE"
}

pm2_clean_start() {
  [[ "$1" == "$PM2_APP_NAME" ]] || die "Refusing non-staging PM2 app: $1"
  [[ "$2" == "${ASI_APP_ROOT}/ecosystem.staging.config.cjs" ]] || die "Refusing non-staging PM2 config: $2"
  [[ "$3" == "$PORT" ]] || die "Refusing non-staging port: $3"
  assert_safe_command_args pm2 stop "$1"
  assert_safe_command_args pm2 start "$2" --only "$1"

  log "pm2_clean_start: stop, kill-port, delete, start, save (app=$1 port=$3)"
  pm2 stop "$1" 2>/dev/null || true

  if command -v fuser >/dev/null 2>&1; then
    fuser -k "$3/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti:"$3" 2>/dev/null | xargs kill -9 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    local pids=""
    pids="$(ss -ltnp 2>/dev/null | grep -E ":${3}\\b" | sed -n 's/.*pid=\\([0-9]\\+\\).*/\\1/p' | sort -u | tr '\n' ' ' || true)"
    for pid in $pids; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi

  sleep 0.5
  pm2 delete "$1" 2>/dev/null || true
  sleep 0.3

  if command -v ss >/dev/null 2>&1 && ss -ltnp 2>/dev/null | grep -qE ":${3}\\b"; then
    ss -ltnp 2>/dev/null | grep -E ":${3}\\b" || true
    die "Port $3 is still in use; refusing to start PM2"
  fi

  pm2 start "$2" --only "$1"
  pm2 save || true
}

log "Updating staging env metadata to match rollback target"
remove_env_key ASI_RELEASE_SHA
merge_env_kv ASI_APP_ROOT "$ASI_APP_ROOT"
merge_env_kv ASI_RELEASE_DEPLOYED_AT_ISO "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
merge_env_kv ASI_RELEASE_PATH "$RELEASE_DIR"

ln -sfn "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.staging.live"

log "Switching staging current symlink to $RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "${ASI_BASE_DIR}/current.swap.$$"
mv -Tf "${ASI_BASE_DIR}/current.swap.$$" "$CURRENT_LINK"

pm2_clean_start "$PM2_APP_NAME" "${ASI_APP_ROOT}/ecosystem.staging.config.cjs" "$PORT"

log "Staging rollback healthcheck"
if ! EXPECT_SHA="$EXPECTED_SHA" PORT="$PORT" node - <<'NODE'
const timeoutMs = 45_000;
const start = Date.now();
const base = `http://127.0.0.1:${process.env.PORT}`;
const expected = (process.env.EXPECT_SHA || '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = '';

(async () => {
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await fetch(`${base}/api/health`, { headers: { 'cache-control': 'no-cache' } });
      if (!health.ok) {
        last = await health.text();
        await sleep(500);
        continue;
      }
      const version = await fetch(`${base}/api/version`, { headers: { 'cache-control': 'no-cache' } });
      last = await version.text();
      if (!version.ok) {
        await sleep(500);
        continue;
      }
      const parsed = JSON.parse(last);
      if (String(parsed.sha || '').trim() === expected) {
        console.log('staging rollback health: ok');
        return;
      }
    } catch (error) {
      last = String(error);
    }
    await sleep(500);
  }
  console.error('staging rollback health: failed, last=', last.slice(0, 800));
  process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
then
  pm2 describe "$PM2_APP_NAME" 2>/dev/null || true
  pm2 logs "$PM2_APP_NAME" --lines 120 --nostream 2>/dev/null || true
  die "Staging rollback healthcheck failed"
fi

log "Staging rollback complete: SHA=$SHA current=$(readlink -f "$CURRENT_LINK")"
