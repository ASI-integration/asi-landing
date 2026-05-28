#!/usr/bin/env bash
# Staging-only artifact deploy. This script must never target production.
set -euo pipefail

SHA="${1:-}"
ARTIFACT_PATH="${2:-}"

readonly ASI_BASE_DIR="/var/www/asi-staging"
readonly ASI_APP_ROOT="/var/www/asi-staging/current"
readonly PM2_APP_NAME="asi-landing-staging"
readonly PORT="3001"
readonly LIVE_ENV_FILE="/var/www/asi-staging/shared/.env.staging.live"

RELEASES_DIR="${ASI_BASE_DIR}/releases"
SHARED_DIR="${ASI_BASE_DIR}/shared"
CURRENT_LINK="${ASI_APP_ROOT}"

log() { printf "\n[%s] %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }

assert_staging_guardrails() {
  [[ "$ASI_BASE_DIR" == "/var/www/asi-staging" ]] || die "Staging deploy must use ASI_BASE_DIR=/var/www/asi-staging"
  [[ "$ASI_BASE_DIR" != "/var/www/asi" ]] || die "Refusing production base dir: /var/www/asi"
  [[ "$ASI_APP_ROOT" == "/var/www/asi-staging/current" ]] || die "Staging deploy must use ASI_APP_ROOT=/var/www/asi-staging/current"
  [[ "$ASI_APP_ROOT" != "/var/www/asi/current" ]] || die "Refusing production current path: /var/www/asi/current"
  [[ "$PM2_APP_NAME" == "asi-landing-staging" ]] || die "Staging deploy must use PM2_APP_NAME=asi-landing-staging"
  [[ "$PM2_APP_NAME" != "asi-landing" ]] || die "Refusing production PM2 app: asi-landing"
  [[ "$PORT" == "3001" ]] || die "Staging deploy must use PORT=3001"
  [[ "$PORT" != "3000" ]] || die "Refusing production port: 3000"
  [[ "$LIVE_ENV_FILE" == "/var/www/asi-staging/shared/.env.staging.live" ]] || die "Staging deploy must use /var/www/asi-staging/shared/.env.staging.live"
  [[ "$LIVE_ENV_FILE" != *"production"* ]] || die "Refusing env file path that looks production-like: $LIVE_ENV_FILE"
}

assert_safe_command_args() {
  local rendered="$*"
  [[ "$rendered" != *"/var/www/asi/current"* ]] || die "Refusing command that references production current path: $rendered"
  [[ "$rendered" != *"/var/www/asi "* ]] || die "Refusing command that references production base path: $rendered"
  [[ ! "$rendered" =~ (^|[[:space:]])asi-landing($|[[:space:]]) ]] || die "Refusing command that targets production PM2 process: $rendered"
  [[ "$rendered" != *":3000"* && "$rendered" != *" 3000"* ]] || die "Refusing command that references production port 3000: $rendered"
}

if [[ -z "${SHA:-}" || -z "${ARTIFACT_PATH:-}" ]]; then
  echo "Usage: bash scripts/deploy-artifact-staging.sh <commit-sha> <artifact.tgz>" >&2
  exit 2
fi
if [[ ! "$SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  die "Invalid SHA: $SHA"
fi
if [[ ! -f "$ARTIFACT_PATH" ]]; then
  die "Artifact not found: $ARTIFACT_PATH"
fi

assert_staging_guardrails
require_cmd tar
require_cmd node
require_cmd pm2
require_cmd curl

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
touch "$LIVE_ENV_FILE"

RELEASE_DIR="${RELEASES_DIR}/${SHA}"
STAGING_DIR="${RELEASE_DIR}.tmp.$$"

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

read_git_sha_from_release_dir() {
  local dir="$1"
  node -e "
const fs = require('fs');
const p = require('path').join(process.argv[1], 'release-meta.json');
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const s = typeof j.gitSha === 'string' ? j.gitSha.trim() : '';
if (!s) process.exit(2);
process.stdout.write(s);
" "$dir" 2>/dev/null
}

write_staging_ecosystem() {
  local dir="$1"
  cat >"${dir}/ecosystem.staging.config.cjs" <<'NODE'
const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const root = '/var/www/asi-staging/current';
const fileEnv = parseEnvFile(path.join(root, '.env.staging.live'));
delete fileEnv.ASI_RELEASE_SHA;

module.exports = {
  apps: [
    {
      name: 'asi-landing-staging',
      cwd: root,
      script: path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
      interpreter: 'node',
      args: ['start', '-H', '127.0.0.1', '-p', '3001'],
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      env: {
        ...fileEnv,
        ASI_APP_ROOT: root,
        NODE_ENV: 'production',
        PORT: '3001',
      },
    },
  ],
};
NODE
}

pm2_clean_start() {
  local app_name="$1"
  local config="$2"
  local port="$3"

  [[ "$app_name" == "$PM2_APP_NAME" ]] || die "Refusing non-staging PM2 app: $app_name"
  [[ "$config" == "${ASI_APP_ROOT}/ecosystem.staging.config.cjs" ]] || die "Refusing non-staging PM2 config: $config"
  [[ "$port" == "$PORT" ]] || die "Refusing non-staging port: $port"
  assert_safe_command_args pm2 stop "$app_name"
  assert_safe_command_args pm2 start "$config" --only "$app_name"

  log "pm2_clean_start: stop, kill-port, delete, start, save (app=$app_name port=$port)"
  pm2 stop "$app_name" 2>/dev/null || true

  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    local pids=""
    pids="$(ss -ltnp 2>/dev/null | grep -E ":${port}\\b" | sed -n 's/.*pid=\\([0-9]\\+\\).*/\\1/p' | sort -u | tr '\n' ' ' || true)"
    for pid in $pids; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi

  sleep 0.5
  pm2 delete "$app_name" 2>/dev/null || true
  sleep 0.3

  if command -v ss >/dev/null 2>&1 && ss -ltnp 2>/dev/null | grep -qE ":${port}\\b"; then
    ss -ltnp 2>/dev/null | grep -E ":${port}\\b" || true
    die "Port $port is still in use; refusing to start PM2"
  fi

  pm2 start "$config" --only "$app_name"
  pm2 save || true
}

rollback_to_previous() {
  local prev="$1"
  [[ -n "$prev" && -d "$prev" ]] || return 0
  log "Rollback: switching staging current back to $prev"
  ln -sfn "$prev" "${ASI_BASE_DIR}/current.swap.$$"
  mv -Tf "${ASI_BASE_DIR}/current.swap.$$" "$CURRENT_LINK"
  pm2_clean_start "$PM2_APP_NAME" "${ASI_APP_ROOT}/ecosystem.staging.config.cjs" "$PORT"
}

log "Staging artifact file: $ARTIFACT_PATH"
log "Staging deploy SHA: $SHA"
log "Staging base dir: $ASI_BASE_DIR"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$STAGING_DIR"

[[ -f "$STAGING_DIR/package.json" ]] || die "Artifact missing package.json"
[[ -f "$STAGING_DIR/package-lock.json" ]] || die "Artifact missing package-lock.json"
[[ -d "$STAGING_DIR/.next" ]] || die "Artifact missing .next/"
[[ -f "$STAGING_DIR/release-meta.json" ]] || die "Artifact missing release-meta.json"
[[ -d "$STAGING_DIR/node_modules" ]] || die "Artifact missing node_modules/"
[[ -f "$STAGING_DIR/node_modules/next/dist/bin/next" ]] || die "Artifact missing Next CLI"

META_SHA="$(read_git_sha_from_release_dir "$STAGING_DIR")" || die "release-meta.json missing gitSha"
[[ "$META_SHA" == "$SHA" ]] || die "release-meta gitSha mismatch: arg=${SHA} artifact=${META_SHA}"

write_staging_ecosystem "$STAGING_DIR"

PREV_TARGET=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREV_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
fi

rm -rf "$RELEASE_DIR"
mv "$STAGING_DIR" "$RELEASE_DIR"

remove_env_key ASI_RELEASE_SHA
merge_env_kv ASI_APP_ROOT "$ASI_APP_ROOT"
merge_env_kv ASI_RELEASE_DEPLOYED_AT_ISO "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
merge_env_kv ASI_RELEASE_PATH "$RELEASE_DIR"
merge_env_kv TWOGIS_CATALOG_API_KEY "${TWOGIS_CATALOG_API_KEY:-}"
merge_env_kv GOOGLE_MAPS_SERVER_API_KEY "${GOOGLE_MAPS_SERVER_API_KEY:-}"

ln -sfn "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.staging.live"

log "Switching staging current symlink to $RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "${ASI_BASE_DIR}/current.swap.$$"
mv -Tf "${ASI_BASE_DIR}/current.swap.$$" "$CURRENT_LINK"

pm2_clean_start "$PM2_APP_NAME" "${ASI_APP_ROOT}/ecosystem.staging.config.cjs" "$PORT"

log "Early-crash guard"
sleep 3
EARLY_CRASH="$(
  PM2_ONLY="$PM2_APP_NAME" node - <<'NODE' 2>/dev/null || echo "YES"
const { execSync } = require('child_process');
const name = process.env.PM2_ONLY;
const list = JSON.parse(execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'));
const proc = list.find((x) => x && x.name === name);
const env = proc?.pm2_env || {};
process.stdout.write(String(env.status || '') === 'online' && Number(env.restart_time || 0) === 0 ? 'no' : 'YES');
NODE
)"
if [[ "$EARLY_CRASH" == "YES" ]]; then
  pm2 describe "$PM2_APP_NAME" 2>/dev/null || true
  pm2 logs "$PM2_APP_NAME" --lines 120 --nostream 2>/dev/null || true
  rollback_to_previous "$PREV_TARGET"
  die "Staging process crashed early; rolled back where possible"
fi

log "Staging healthcheck"
if ! EXPECT_SHA="$META_SHA" PORT="$PORT" node - <<'NODE'
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
        console.log('staging health: ok');
        return;
      }
    } catch (error) {
      last = String(error);
    }
    await sleep(500);
  }
  console.error('staging health: failed, last=', last.slice(0, 800));
  process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
then
  rollback_to_previous "$PREV_TARGET"
  die "Staging healthcheck failed; rolled back where possible"
fi

log "Staging deploy complete: SHA=$META_SHA current=$(readlink -f "$CURRENT_LINK")"
curl -fsS "http://127.0.0.1:${PORT}/api/version" && echo "" || true
