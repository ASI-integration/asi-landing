#!/usr/bin/env bash
# Roll back to an existing artifact-based release (no rebuild).
# Requires a release directory created by deploy-artifact.sh under releases/<sha>.
set -euo pipefail

SHA="${1:-}"
if [[ -z "${SHA:-}" || ! "$SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "Usage: ASI_BASE_DIR=/var/www/asi bash scripts/rollback-artifact.sh <existing-release-sha>" >&2
  exit 2
fi

BASE_DIR="${ASI_BASE_DIR:-/var/www/asi}"
RELEASES_DIR="${BASE_DIR}/releases"
SHARED_DIR="${BASE_DIR}/shared"
CURRENT_LINK="${BASE_DIR}/current"
RELEASE_DIR="${RELEASES_DIR}/${SHA}"
LIVE_ENV_FILE="${SHARED_DIR}/.env.production.live"

APP_NAME="${PM2_APP_NAME:-asi-landing}"
PM2_ONLY="${PM2_ONLY:-$APP_NAME}"

log() { printf "\n[%s] %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }
require_cmd pm2
require_cmd curl
require_cmd node

[[ -d "$RELEASE_DIR" ]] || die "Release directory not found (nothing to roll back to): $RELEASE_DIR"
[[ -f "${RELEASE_DIR}/ecosystem.config.cjs" ]] || die "Invalid release dir (missing ecosystem.config.cjs): $RELEASE_DIR"

mkdir -p "$SHARED_DIR"
touch "$LIVE_ENV_FILE"

merge_env_kv() {
  local key="$1"
  local val="$2"
  [[ -z "${val:-}" ]] && return 0
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$LIVE_ENV_FILE" ]]; then
    grep -v "^${key}=" "$LIVE_ENV_FILE" >"$tmp" || true
  else
    : >"$tmp"
  fi
  printf "%s=%s\n" "$key" "$val" >>"$tmp"
  mv "$tmp" "$LIVE_ENV_FILE"
}

log "Updating shared env metadata to match rollback target"
merge_env_kv ASI_RELEASE_SHA "$SHA"
merge_env_kv ASI_RELEASE_DEPLOYED_AT_ISO "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
merge_env_kv ASI_RELEASE_PATH "$RELEASE_DIR"

log "Linking env into target release"
ln -sfn "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.live"
cp -f "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.local"

log "Switching current symlink -> $RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

log "Reloading PM2"
pm2 startOrReload "${CURRENT_LINK}/ecosystem.config.cjs" --only "$PM2_ONLY"
pm2 save || true

log "Post-switch /api/version check"
if ! SHA_EXPECT="$SHA" node - <<'NODE'
const timeoutMs = 20_000;
const start = Date.now();
const base = 'http://127.0.0.1:3000';
const expected = process.env.SHA_EXPECT;

async function waitFor(url) {
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (res.ok) return res;
    } catch {}
    await new Promise(r => setTimeout(r, 350));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

(async () => {
  await waitFor(`${base}/api/health`);
  const v = await fetch(`${base}/api/version`, { headers: { 'cache-control': 'no-cache' } }).then(r => r.json());
  if (v?.sha && v.sha !== expected) throw new Error(`version mismatch: expected=${expected} got=${v.sha}`);
  console.log('rollback health: ok');
})().catch(e => {
  console.error('rollback health: failed', e);
  process.exit(1);
});
NODE
then
  die "Rollback healthcheck failed"
fi

log "Rollback complete: SHA=$SHA current=$(readlink -f "$CURRENT_LINK")"
