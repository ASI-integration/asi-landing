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

read_git_sha_from_release_dir() {
  local dir="$1"
  node -e "
const fs = require('fs');
const dir = process.argv[1];
try {
  const p = require('path').join(dir, 'release-meta.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const s = typeof j.gitSha === 'string' ? j.gitSha.trim() : '';
  if (s) process.stdout.write(s);
} catch {}
" "$dir" 2>/dev/null || true
}

rollback_to() {
  local prev="$1"
  local expect_sha="${2:-}"
  local tmp_link="${BASE_DIR}/current.swap.$$.$RANDOM"
  log "ROLLBACK: switching current -> $prev (expected artifact SHA: ${expect_sha:-<unknown>})"
  ln -sfn "$prev" "$tmp_link"
  mv -Tf "$tmp_link" "$CURRENT_LINK"
  log "PM2 status (before reload after rollback):"
  pm2 status "$PM2_ONLY" 2>/dev/null || pm2 status || true
  pm2 startOrReload "${CURRENT_LINK}/ecosystem.config.cjs" --only "$PM2_ONLY"
  pm2 save || true
  log "PM2 status (after reload after rollback):"
  pm2 status "$PM2_ONLY" 2>/dev/null || pm2 status || true
  if [[ -n "${expect_sha:-}" ]]; then
    log "Post-rollback healthcheck (expect SHA from previous release metadata)"
    if ! EXPECT_SHA="$expect_sha" node - <<'NODE'
const timeoutMs = 45_000;
const start = Date.now();
const base = 'http://127.0.0.1:3000';
const expected = (process.env.EXPECT_SHA || '').trim();
let lastBody = '';
let lastSha = '';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`, { headers: { 'cache-control': 'no-cache' } });
      if (!res.ok) {
        lastBody = await res.text();
        await sleep(500);
        continue;
      }
      const verRes = await fetch(`${base}/api/version`, { headers: { 'cache-control': 'no-cache' } });
      const txt = await verRes.text();
      lastBody = txt;
      if (!verRes.ok) {
        await sleep(500);
        continue;
      }
      let v;
      try {
        v = JSON.parse(txt);
      } catch {
        await sleep(500);
        continue;
      }
      lastSha = typeof v?.sha === 'string' ? v.sha.trim() : '';
      if (lastSha === expected) {
        console.log('rollback-health: ok');
        return;
      }
    } catch (e) {
      lastBody = String(e);
    }
    await sleep(500);
  }
  console.error('rollback-health: failed expected=', expected, 'lastSha=', lastSha, 'lastBody=', lastBody);
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
    then
      die "Post-rollback healthcheck failed (previous release unhealthy)"
    fi
  fi
}

log "Artifact file: $ARTIFACT_PATH"
log "Deploy argument SHA (CI): $SHA"
log "Base dir: $BASE_DIR"

log "Preparing staging dir: $STAGING_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

log "Unpacking artifact into staging"
tar -xzf "$ARTIFACT_PATH" -C "$STAGING_DIR"

log "Preflight: mandatory artifact paths"
[[ -f "$STAGING_DIR/package.json" ]] || die "artifact missing package.json"
[[ -f "$STAGING_DIR/package-lock.json" ]] || die "artifact missing package-lock.json"
[[ -d "$STAGING_DIR/.next" ]] || die "artifact missing .next/"
[[ -f "$STAGING_DIR/ecosystem.config.cjs" ]] || die "artifact missing ecosystem.config.cjs"
[[ -f "$STAGING_DIR/release-meta.json" ]] || die "artifact missing release-meta.json"
[[ -d "$STAGING_DIR/node_modules" ]] || die "artifact missing node_modules/ (artifact must bundle prod deps)"
[[ -f "$STAGING_DIR/node_modules/next/dist/bin/next" ]] || die "artifact missing Next CLI (node_modules/next/dist/bin/next)"

META_SHA="$(read_git_sha_from_release_dir "$STAGING_DIR")"
if [[ -z "$META_SHA" ]]; then
  die "release-meta.json missing gitSha"
fi
if [[ "$META_SHA" != "$SHA" ]]; then
  die "release-meta gitSha mismatch: workflow/arg=${SHA} artifact=${META_SHA}"
fi

log "Publishing release dir atomically: $RELEASE_DIR"
rm -rf "$RELEASE_DIR"
mv "$STAGING_DIR" "$RELEASE_DIR"

EXPECTED_SHA="$META_SHA"
log "Canonical deploy SHA from artifact release-meta.json: $EXPECTED_SHA"

log "Updating shared env metadata + injected secrets (if present)"
remove_env_key ASI_RELEASE_SHA
merge_env_kv ASI_APP_ROOT "${CURRENT_LINK}"
merge_env_kv ASI_RELEASE_DEPLOYED_AT_ISO "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
merge_env_kv ASI_RELEASE_PATH "$RELEASE_DIR"
merge_env_kv TWOGIS_CATALOG_API_KEY "${TWOGIS_CATALOG_API_KEY:-}"
merge_env_kv GOOGLE_MAPS_SERVER_API_KEY "${GOOGLE_MAPS_SERVER_API_KEY:-}"

log "Linking env into release"
ln -sfn "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.live"
cp -f "$LIVE_ENV_FILE" "${RELEASE_DIR}/.env.production.local"

PREV_TARGET=""
PREV_SHA=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREV_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
fi
if [[ -n "${PREV_TARGET:-}" && -d "$PREV_TARGET" ]]; then
  PREV_SHA="$(read_git_sha_from_release_dir "$PREV_TARGET")"
  if [[ -z "$PREV_SHA" ]] && [[ -f "$PREV_TARGET/.release.build.json" ]]; then
    PREV_SHA="$(node -pe "try { JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sha||'' } catch(e) { '' }" "$PREV_TARGET/.release.build.json" 2>/dev/null || true)"
  fi
fi

log "Previous current -> ${PREV_TARGET:-<none>}"
log "Previous release artifact SHA -> ${PREV_SHA:-<unknown>}"
log "New release dir -> $RELEASE_DIR"

log "PM2 list (asi-related, before switch):"
pm2 list 2>/dev/null | grep -Ei 'asi|landing|name|─' || pm2 list || true

log "Atomically switching current symlink to new release"
SWAP_LINK="${BASE_DIR}/current.swap.$$.$RANDOM"
ln -sfn "$RELEASE_DIR" "$SWAP_LINK"
mv -Tf "$SWAP_LINK" "$CURRENT_LINK"
unset SWAP_LINK

log "Reloading PM2 (single app: $PM2_ONLY)"
pm2 startOrReload "${CURRENT_LINK}/ecosystem.config.cjs" --only "$PM2_ONLY"
pm2 save || true

log "PM2 status (after reload):"
pm2 status "$PM2_ONLY" 2>/dev/null || pm2 status || true

log "Post-switch debug (before healthcheck)"
log "  readlink -f ${CURRENT_LINK}: $(readlink -f "$CURRENT_LINK" || echo "<unavailable>")"
log "  release-meta.json (current):"
cat "${CURRENT_LINK}/release-meta.json" 2>/dev/null || echo "<missing release-meta.json>"
log "  PM2 describe ($PM2_ONLY):"
pm2 describe "$PM2_ONLY" 2>/dev/null || true
log "  PM2 env/cwd/script (jlist):"
node - <<'NODE' || true
const { execSync } = require('child_process');
try {
  const raw = execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const list = JSON.parse(raw);
  const name = process.env.PM2_ONLY || 'asi-landing';
  const p = list.find((x) => x && x.name === name);
  if (!p) {
    console.log('pm2-jlist: process not found:', name);
    process.exit(0);
  }
  const env = p.pm2_env || {};
  console.log(JSON.stringify({
    name: p.name,
    status: env.status,
    pid: env.pid,
    restart_time: env.restart_time,
    pm_cwd: env.pm_cwd,
    script: env.pm_exec_path,
    ASI_APP_ROOT: env.env?.ASI_APP_ROOT,
  }, null, 2));
} catch (e) {
  console.log('pm2-jlist: failed:', String(e));
}
NODE
log "  curl /api/version (best-effort):"
curl -fsS "http://127.0.0.1:3000/api/version" && echo "" || true

log "Post-switch healthcheck (retries until SHA matches artifact metadata)"
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
        console.log('health: ok sha=', lastSha);
        return;
      }
    } catch (e) {
      lastBody = String(e);
    }
    await sleep(500);
  }
  console.error('health: FAILED');
  console.error('  expected SHA (from artifact release-meta.json):', expected);
  console.error('  last /api/version status:', lastStatus);
  console.error('  last /api/version sha:', lastSha);
  console.error('  last body:', lastBody.slice(0, 800));
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
then
  log "Healthcheck failed after switch"
  log "  expected SHA (artifact): $EXPECTED_SHA"
  log "  attempted new release: $RELEASE_DIR"
  log "  previous release path: ${PREV_TARGET:-<none>}"

  log "Failure diagnostics (post-switch)"
  log "  readlink -f ${CURRENT_LINK}: $(readlink -f "$CURRENT_LINK" || echo "<unavailable>")"
  log "  PM2 status:"
  pm2 status "$PM2_ONLY" 2>/dev/null || pm2 status || true
  log "  PM2 describe ($PM2_ONLY):"
  pm2 describe "$PM2_ONLY" 2>/dev/null || true
  log "  PM2 logs ($PM2_ONLY) last 100 lines:"
  pm2 logs "$PM2_ONLY" --lines 100 --nostream 2>/dev/null || true
  log "  Restart loop check (pm2 jlist):"
  PM2_ONLY="$PM2_ONLY" node - <<'NODE' || true
const { execSync } = require('child_process');
const name = (process.env.PM2_ONLY || 'asi-landing').trim();
try {
  const raw = execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const list = JSON.parse(raw);
  const p = list.find((x) => x && x.name === name);
  if (!p) {
    console.log('restart-loop: process not found:', name);
    process.exit(0);
  }
  const env = p.pm2_env || {};
  const restart = Number(env.restart_time || 0);
  const status = String(env.status || '');
  console.log('restart-loop:', { name, status, restart_time: restart, pid: env.pid });
  if (status === 'errored' || restart >= 3) {
    console.log('restart-loop: YES');
  } else {
    console.log('restart-loop: no');
  }
} catch (e) {
  console.log('restart-loop: failed:', String(e));
}
NODE

  if [[ -n "${PREV_TARGET:-}" ]] && [[ -d "$PREV_TARGET" ]]; then
    rollback_to "$PREV_TARGET" "$PREV_SHA"
    log "Rollback complete; live symlink restored to previous release."
  else
    log "No valid previous release to roll back to."
  fi
  die "Deploy failed post-switch healthcheck; rolled back where possible."
fi

log "Writing deploy-side metadata (.release.json)"
BUILD_META="{}"
if [[ -f "${CURRENT_LINK}/release-meta.json" ]]; then
  BUILD_META="$(cat "${CURRENT_LINK}/release-meta.json" || echo "{}")"
fi
cat >"${CURRENT_LINK}/.release.json" <<EOF
{
  "sha": "$EXPECTED_SHA",
  "deployed_at_iso": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "release_dir": "$RELEASE_DIR",
  "build": $BUILD_META
}
EOF

log "Deploy complete: SHA=$EXPECTED_SHA current=$(readlink -f "$CURRENT_LINK")"
curl -fsS "http://127.0.0.1:3000/api/version" && echo "" || true
