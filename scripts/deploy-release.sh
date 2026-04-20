#!/usr/bin/env bash
set -euo pipefail

SHA="${1:-}"
if [[ -z "$SHA" ]]; then
  echo "Usage: scripts/deploy-release.sh <commit-sha>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Filesystem layout (overrideable for staging)
BASE_DIR="${ASI_BASE_DIR:-/var/www/asi}"
RELEASES_DIR="${BASE_DIR}/releases"
SHARED_DIR="${BASE_DIR}/shared"
CURRENT_LINK="${BASE_DIR}/current"

APP_NAME="${PM2_APP_NAME:-asi-landing}"
PM2_ONLY="${PM2_ONLY:-$APP_NAME}"

LIVE_ENV_FILE="${SHARED_DIR}/.env.production.live"

log() { printf "\n[%s] %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }

require_cmd git
require_cmd npm
require_cmd node
require_cmd pm2

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
touch "$LIVE_ENV_FILE"

# Ensure we can resolve SHA and that it's deployable from main.
log "Fetching origin and validating deploy SHA."
git -C "$ROOT" fetch origin --prune
git -C "$ROOT" cat-file -e "${SHA}^{commit}" || die "Commit not found: ${SHA}"
git -C "$ROOT" show -s --format='%H %s' "$SHA"
git -C "$ROOT" merge-base --is-ancestor "$SHA" origin/main || die "Refusing to deploy: SHA is not an ancestor of origin/main"

RELEASE_DIR="${RELEASES_DIR}/${SHA}"

if [[ -d "$RELEASE_DIR" ]]; then
  log "Release directory already exists: $RELEASE_DIR"
else
  log "Creating git worktree for release: $RELEASE_DIR"
  git -C "$ROOT" worktree add --detach "$RELEASE_DIR" "$SHA"
fi

cleanup_worktree() {
  # Best-effort cleanup if we created a broken release dir.
  if [[ -d "$RELEASE_DIR" ]] && [[ ! -f "$RELEASE_DIR/package.json" ]]; then
    rm -rf "$RELEASE_DIR" || true
  fi
}

rollback_to() {
  local prev="$1"
  log "ROLLBACK: switching current -> $prev"
  ln -sfn "$prev" "$CURRENT_LINK"
  pm2 startOrReload "${CURRENT_LINK}/ecosystem.config.cjs" --only "$PM2_ONLY"
}

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

log "Updating shared env metadata + injected secrets (if present)."
merge_env_kv ASI_RELEASE_SHA "$SHA"
merge_env_kv ASI_RELEASE_DEPLOYED_AT_ISO "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
merge_env_kv ASI_RELEASE_PATH "$RELEASE_DIR"
merge_env_kv TWOGIS_CATALOG_API_KEY "${TWOGIS_CATALOG_API_KEY:-}"
merge_env_kv GOOGLE_MAPS_SERVER_API_KEY "${GOOGLE_MAPS_SERVER_API_KEY:-}"

log "Linking env into release and creating build-local env."
ln -sfn "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.live"
cp -f "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.local"

log "Installing dependencies (clean) in release dir."
cd "$RELEASE_DIR"
rm -rf node_modules
npm ci

log "Release gates: typecheck, tests, build."
npm run typecheck
npm run test:location-golden
npm run build

log "Local smoke check against a locally started server."
SMOKE_PORT="${SMOKE_PORT:-3107}"
SMOKE_BASE="http://127.0.0.1:${SMOKE_PORT}"

start_server() {
  PORT="$SMOKE_PORT" NODE_ENV=production ASI_RELEASE_SHA="$SHA" \
    ASI_RELEASE_DEPLOYED_AT_ISO="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" ASI_RELEASE_PATH="$RELEASE_DIR" \
    nohup npm run start -- -H 127.0.0.1 -p "$SMOKE_PORT" >/tmp/asi-smoke-${SHA}.log 2>&1 &
  echo $! > /tmp/asi-smoke-${SHA}.pid
}
stop_server() {
  if [[ -f /tmp/asi-smoke-${SHA}.pid ]]; then
    kill "$(cat /tmp/asi-smoke-${SHA}.pid)" 2>/dev/null || true
    rm -f /tmp/asi-smoke-${SHA}.pid || true
  fi
}

start_server
trap 'stop_server; cleanup_worktree' EXIT

SMOKE_BASE="$SMOKE_BASE" SHA="$SHA" node - <<'NODE'
const base = process.env.SMOKE_BASE;
const sha = process.env.SHA;
const timeoutMs = 25_000;
const start = Date.now();

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

async function mustOk(path) {
  const res = await fetch(`${base}${path}`, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res;
}

(async () => {
  await waitFor(`${base}/api/health`);
  await mustOk(`/`);
  await mustOk(`/ru`);
  const v = await mustOk(`/api/version`).then(r => r.json());
  if (v?.sha && v.sha !== sha) {
    throw new Error(`/api/version sha mismatch: expected=${sha} got=${v.sha}`);
  }
  console.log('smoke: ok');
})().catch(e => {
  console.error('smoke: failed', e);
  process.exit(1);
});
NODE

stop_server

log "Pre-switch state capture."
PREV_TARGET=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREV_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
fi

log "Switching current symlink atomically."
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

log "Reloading PM2 against current."
pm2 startOrReload "${CURRENT_LINK}/ecosystem.config.cjs" --only "$PM2_ONLY"
pm2 save

log "Post-switch healthcheck."
if ! SHA="$SHA" node - <<'NODE'
const timeoutMs = 20_000;
const start = Date.now();
const base = 'http://127.0.0.1:3000';
const expected = process.env.SHA;

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
  console.log('health: ok');
})().catch(e => {
  console.error('health: failed', e);
  process.exit(1);
});
NODE
then
  log "Healthcheck failed after switch."
  if [[ -n "${PREV_TARGET:-}" ]] && [[ -d "$PREV_TARGET" ]]; then
    rollback_to "$PREV_TARGET"
  fi
  die "Deploy failed post-switch healthcheck; rolled back."
fi

log "Writing release metadata file."
cat >"${CURRENT_LINK}/.release.json" <<EOF
{
  "sha": "$(git -C "$RELEASE_DIR" rev-parse HEAD)",
  "deployed_at_iso": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "release_dir": "$RELEASE_DIR"
}
EOF

log "Deploy complete: SHA=$SHA current=$(readlink -f "$CURRENT_LINK")"

trap - EXIT
exit 0

