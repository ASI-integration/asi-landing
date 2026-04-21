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
require_cmd node

[[ -d "$RELEASE_DIR" ]] || die "Release directory not found (nothing to roll back to): $RELEASE_DIR"
[[ -f "${RELEASE_DIR}/ecosystem.config.cjs" ]] || die "Invalid release dir (missing ecosystem.config.cjs): $RELEASE_DIR"
EXPECTED_SHA=""
if [[ -f "${RELEASE_DIR}/release-meta.json" ]]; then
  EXPECTED_SHA="$(node -e "
const fs = require('fs');
const p = require('path').join(process.argv[1], 'release-meta.json');
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const s = typeof j.gitSha === 'string' ? j.gitSha.trim() : '';
if (!s) process.exit(2);
process.stdout.write(s);
" "$RELEASE_DIR" 2>/dev/null)" || die "Could not read gitSha from release-meta.json"
elif [[ -f "${RELEASE_DIR}/.release.build.json" ]]; then
  EXPECTED_SHA="$(node -e "
const fs = require('fs');
const p = require('path').join(process.argv[1], '.release.build.json');
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const s = typeof j.sha === 'string' ? j.sha.trim() : '';
if (!s) process.exit(2);
process.stdout.write(s);
" "$RELEASE_DIR" 2>/dev/null)" || die "Could not read sha from .release.build.json"
else
  die "Invalid release dir (missing release-meta.json and .release.build.json): $RELEASE_DIR"
fi
if [[ "$EXPECTED_SHA" != "$SHA" ]]; then
  die "Artifact metadata SHA (${EXPECTED_SHA}) does not match requested rollback SHA (${SHA})"
fi

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

remove_env_key() {
  local key="$1"
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$LIVE_ENV_FILE" ]]; then
    grep -v "^${key}=" "$LIVE_ENV_FILE" >"$tmp" || true
    mv "$tmp" "$LIVE_ENV_FILE"
  fi
}

log "Updating shared env metadata to match rollback target"
remove_env_key ASI_RELEASE_SHA
merge_env_kv ASI_APP_ROOT "${CURRENT_LINK}"
merge_env_kv ASI_RELEASE_DEPLOYED_AT_ISO "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
merge_env_kv ASI_RELEASE_PATH "$RELEASE_DIR"

log "Linking env into target release"
ln -sfn "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.live"
cp -f "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.local"

log "Switching current symlink -> $RELEASE_DIR (atomic)"
SWAP_LINK="${BASE_DIR}/current.swap.$$.$RANDOM"
ln -sfn "$RELEASE_DIR" "$SWAP_LINK"
mv -Tf "$SWAP_LINK" "$CURRENT_LINK"

log "PM2 status (before reload):"
pm2 status "$PM2_ONLY" 2>/dev/null || pm2 status || true

log "Reloading PM2"
pm2 startOrReload "/var/www/asi/current/ecosystem.config.cjs" --only "$PM2_ONLY"
pm2 save || true

log "PM2 status (after reload):"
pm2 status "$PM2_ONLY" 2>/dev/null || pm2 status || true

log "Post-switch /api/version check (SHA must match release-meta in target release)"
if ! EXPECT_SHA="$EXPECTED_SHA" node - <<'NODE'
const timeoutMs = 45_000;
const start = Date.now();
const base = 'http://127.0.0.1:3000';
const expected = (process.env.EXPECT_SHA || '').trim();

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let lastSha = '';
let lastStatus = 0;
let lastBody = '';

(async () => {
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await fetch(`${base}/api/health`, { headers: { 'cache-control': 'no-cache' } });
      if (!h.ok) {
        lastStatus = h.status;
        lastBody = await h.text();
        await sleep(500);
        continue;
      }
      const verRes = await fetch(`${base}/api/version`, { headers: { 'cache-control': 'no-cache' } });
      lastStatus = verRes.status;
      lastBody = await verRes.text();
      if (!verRes.ok) {
        await sleep(500);
        continue;
      }
      let v;
      try {
        v = JSON.parse(lastBody);
      } catch {
        await sleep(500);
        continue;
      }
      lastSha = typeof v?.sha === 'string' ? v.sha.trim() : '';
      if (lastSha === expected) {
        console.log('rollback health: ok');
        return;
      }
    } catch (e) {
      lastBody = String(e);
    }
    await sleep(500);
  }
  console.error('rollback health: FAILED expected=', expected, 'lastSha=', lastSha, 'status=', lastStatus, 'body=', lastBody.slice(0, 800));
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
then
  die "Rollback healthcheck failed"
fi

log "Rollback complete: SHA=$SHA current=$(readlink -f "$CURRENT_LINK")"
