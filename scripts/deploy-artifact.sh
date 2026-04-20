#!/usr/bin/env bash
set -euo pipefail

SHA="${1:-}"
ARTIFACT_PATH="${2:-}"

if [[ -z "${SHA:-}" || -z "${ARTIFACT_PATH:-}" ]]; then
  echo "Usage: scripts/deploy-artifact.sh <commit-sha> <artifact.tgz>" >&2
  exit 2
fi

if [[ ! "$SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "ERROR: invalid SHA: $SHA" >&2
  exit 2
fi

if [[ ! -f "$ARTIFACT_PATH" ]]; then
  echo "ERROR: artifact not found: $ARTIFACT_PATH" >&2
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

require_cmd tar
require_cmd npm
require_cmd node
require_cmd pm2
require_cmd curl

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
touch "$LIVE_ENV_FILE"

RELEASE_DIR="${RELEASES_DIR}/${SHA}"

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

rollback_to() {
  local prev="$1"
  log "ROLLBACK: switching current -> $prev"
  ln -sfn "$prev" "$CURRENT_LINK"
  pm2 startOrReload "${CURRENT_LINK}/ecosystem.config.cjs" --only "$PM2_ONLY"
  pm2 save || true
}

log "Preparing release dir: $RELEASE_DIR"
rm -rf "$RELEASE_DIR.tmp"
mkdir -p "$RELEASE_DIR.tmp"

log "Unpacking artifact: $ARTIFACT_PATH"
tar -xzf "$ARTIFACT_PATH" -C "$RELEASE_DIR.tmp"

[[ -f "$RELEASE_DIR.tmp/package.json" ]] || die "artifact missing package.json"
[[ -f "$RELEASE_DIR.tmp/package-lock.json" ]] || die "artifact missing package-lock.json"
[[ -d "$RELEASE_DIR.tmp/.next" ]] || die "artifact missing .next/"
[[ -f "$RELEASE_DIR.tmp/ecosystem.config.cjs" ]] || die "artifact missing ecosystem.config.cjs"

log "Publishing release dir atomically"
rm -rf "$RELEASE_DIR"
mv "$RELEASE_DIR.tmp" "$RELEASE_DIR"

log "Updating shared env metadata + injected secrets (if present)"
merge_env_kv ASI_RELEASE_SHA "$SHA"
merge_env_kv ASI_RELEASE_DEPLOYED_AT_ISO "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
merge_env_kv ASI_RELEASE_PATH "$RELEASE_DIR"
merge_env_kv TWOGIS_CATALOG_API_KEY "${TWOGIS_CATALOG_API_KEY:-}"
merge_env_kv GOOGLE_MAPS_SERVER_API_KEY "${GOOGLE_MAPS_SERVER_API_KEY:-}"

log "Linking env into release"
ln -sfn "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.live"
cp -f "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.local"

log "Installing runtime dependencies (no build on VPS)"
cd "$RELEASE_DIR"
rm -rf node_modules
npm ci --omit=dev

log "Pre-switch smoke check (start Next using prebuilt .next)"
SMOKE_PORT="${SMOKE_PORT:-3107}"
SMOKE_BASE="http://127.0.0.1:${SMOKE_PORT}"

start_server() {
  # Pass release env explicitly: smoke uses plain `npm run start` (not PM2), so it does not get
  # ecosystem.config.cjs merged env. ASI_* must match the deploy SHA for pre-switch checks.
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
trap 'stop_server' EXIT

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
trap - EXIT

log "Pre-switch state capture"
PREV_TARGET=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREV_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
fi

log "Switching current symlink atomically"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

log "Reloading PM2 against current"
pm2 startOrReload "${CURRENT_LINK}/ecosystem.config.cjs" --only "$PM2_ONLY"
pm2 save || true

log "Post-switch healthcheck (and version SHA)"
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
  log "Healthcheck failed after switch"
  if [[ -n "${PREV_TARGET:-}" ]] && [[ -d "$PREV_TARGET" ]]; then
    rollback_to "$PREV_TARGET"
  fi
  die "Deploy failed post-switch healthcheck; rolled back."
fi

log "Writing release metadata file"
BUILD_META="{}"
if [[ -f "${CURRENT_LINK}/.release.build.json" ]]; then
  BUILD_META="$(cat "${CURRENT_LINK}/.release.build.json" || echo "{}")"
fi
cat >"${CURRENT_LINK}/.release.json" <<EOF
{
  "sha": "$SHA",
  "deployed_at_iso": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "release_dir": "$RELEASE_DIR",
  "build": $BUILD_META
}
EOF

log "Deploy complete: SHA=$SHA current=$(readlink -f "$CURRENT_LINK")"

