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

EXPECTED_PM2_USER="${ASI_PM2_USER:-project_ayfaar}"
EXPECTED_PM2_HOME="${ASI_PM2_HOME:-/home/${EXPECTED_PM2_USER}/.pm2}"

assert_pm2_runtime_user() {
  local actual_user
  actual_user="$(id -un)"
  if [[ "$actual_user" != "$EXPECTED_PM2_USER" ]]; then
    die "PM2 deploy must run as ${EXPECTED_PM2_USER}; current user is ${actual_user}"
  fi

  if [[ -n "${PM2_HOME:-}" && "${PM2_HOME}" != "$EXPECTED_PM2_HOME" ]]; then
    die "PM2_HOME must be ${EXPECTED_PM2_HOME}; current PM2_HOME=${PM2_HOME}"
  fi
  export PM2_HOME="$EXPECTED_PM2_HOME"
  mkdir -p "$PM2_HOME"

  local root_pm2_daemon=""
  root_pm2_daemon="$(ps -eo user=,pid=,args= 2>/dev/null | awk '$1=="root" && $0 ~ /PM2/ && $0 ~ /God Daemon/ {print}' || true)"
  if [[ -n "$root_pm2_daemon" ]]; then
    log "Root-owned PM2 daemon detected:"
    echo "$root_pm2_daemon"
    die "Refusing deploy while root PM2 daemon is running; use only ${EXPECTED_PM2_USER} PM2"
  fi

  log "PM2 runtime user check: user=${actual_user} PM2_HOME=${PM2_HOME}"
}

print_runtime_diagnostics() {
  local label="${1:-runtime diagnostics}"
  log "Diagnostics: ${label}"
  log "  pm2 describe ($PM2_ONLY):"
  pm2 describe "$PM2_ONLY" 2>/dev/null || true
  log "  pm2 logs ($PM2_ONLY) last 120 lines:"
  pm2 logs "$PM2_ONLY" --lines 120 --nostream 2>/dev/null || true
  log "  ss -ltnp | grep :3000:"
  ss -ltnp 2>/dev/null | grep ":3000" || true
}

curl_with_timeout_diagnostics() {
  local url="$1"
  local label="$2"
  local timeout="${3:-5}"
  local out
  local rc=0
  out="$(curl -fsS --connect-timeout "$timeout" --max-time "$timeout" "$url" 2>&1)" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    printf "%s" "$out"
    return 0
  fi
  log "${label} failed or timed out (curl rc=${rc}): ${url}"
  echo "$out"
  if [[ "$rc" -eq 28 ]]; then
    print_runtime_diagnostics "${label} timeout"
  fi
  return "$rc"
}

assert_pm2_runtime_user

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
touch "$LIVE_ENV_FILE"

RELEASE_DIR="${RELEASES_DIR}/${SHA}"
STAGING_DIR="${RELEASE_DIR}.tmp.$$"

cleanup_old_release_artifacts() {
  local current_target=""
  current_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

  log "Disk before release cleanup:"
  df -h "$BASE_DIR" || true
  du -sh "$RELEASES_DIR" 2>/dev/null || true

  log "Cleaning failed staging dirs (*.tmp.*)"
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.tmp.*' -exec rm -rf -- {} + 2>/dev/null || true

  log "Cleaning old non-current release dirs"
  while IFS= read -r release_path; do
    [[ -z "$release_path" ]] && continue
    if [[ -n "$current_target" && "$release_path" == "$current_target" ]]; then
      continue
    fi
    if [[ "$release_path" == "$RELEASE_DIR" ]]; then
      continue
    fi
    rm -rf -- "$release_path"
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '*.tmp.*' -print 2>/dev/null || true)

  log "Disk after release cleanup:"
  df -h "$BASE_DIR" || true
  du -sh "$RELEASES_DIR" 2>/dev/null || true
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

remove_env_key() {
  local key="$1"
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$LIVE_ENV_FILE" ]]; then
    grep -v "^${key}=" "$LIVE_ENV_FILE" >"$tmp" || true
    mv "$tmp" "$LIVE_ENV_FILE"
  fi
}

read_env_value() {
  local key="$1"
  if [[ ! -f "$LIVE_ENV_FILE" ]]; then
    return 0
  fi
  grep -E "^${key}=" "$LIVE_ENV_FILE" | head -1 | cut -d= -f2- || true
}

env_list_has_email() {
  local raw="$1"
  local email="$2"
  local normalized
  normalized="$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "$raw" |
    tr ',;' '  ' |
    tr -s ' ' '\n' |
    tr '[:upper:]' '[:lower:]' |
    grep -Fxq "$normalized"
}

ensure_email_in_env_list() {
  local key="$1"
  local email="$2"
  local current
  current="$(read_env_value "$key")"
  if env_list_has_email "$current" "$email"; then
    log "CRM allowlist: ${email} already present in ${key}"
    return 0
  fi
  local merged="$email"
  if [[ -n "${current// }" ]]; then
    merged="${current},${email}"
  fi
  merge_env_kv "$key" "$merged"
  log "CRM allowlist: added ${email} to ${key}"
}

ensure_crm_operator_allowlist() {
  local required_email="project.ayfaar@gmail.com"
  if env_list_has_email "$(read_env_value CRM_OPERATOR_EMAILS)" "$required_email"; then
    log "CRM allowlist: ${required_email} already in CRM_OPERATOR_EMAILS"
    return 0
  fi
  if env_list_has_email "$(read_env_value OPERATOR_EMAIL)" "$required_email"; then
    log "CRM allowlist: ${required_email} already in OPERATOR_EMAIL"
    return 0
  fi
  ensure_email_in_env_list CRM_OPERATOR_EMAILS "$required_email"
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

pm2_clean_start() {
  local app_name="$1"
  local port="${2:-3000}"

  log "pm2_clean_start: cd-current -> delete -> kill-port -> direct-next-start -> save (app=$app_name port=$port)"

  (
    cd "$CURRENT_LINK"

    pm2 delete "$app_name" 2>/dev/null || true
    fuser -k "${port}/tcp" 2>/dev/null || true
    sleep 0.5

    if command -v ss >/dev/null 2>&1; then
      if ss -ltnp 2>/dev/null | grep -qE ":${port}\\b"; then
        log "ERROR: port $port still appears to be in use; refusing to start PM2"
        ss -ltnp 2>/dev/null | grep -E ":${port}\\b" || true
        return 1
      fi
    elif command -v lsof >/dev/null 2>&1; then
      if lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
        log "ERROR: port $port still appears to be in use; refusing to start PM2"
        lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
        return 1
      fi
    fi

    NODE_ENV=production \
      PORT="$port" \
      ASI_APP_ROOT="$CURRENT_LINK" \
      pm2 start node_modules/next/dist/bin/next \
        --name "$app_name" \
        --cwd "$CURRENT_LINK" \
        -- start -H 127.0.0.1 -p "$port"
  ) || return $?
  pm2 save || true
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
  pm2_clean_start "$PM2_ONLY" "3000" || die "PM2 start aborted: port 3000 not free"
  log "PM2 status (after reload after rollback):"
  pm2 status "$PM2_ONLY" 2>/dev/null || pm2 status || true
  if [[ -n "${expect_sha:-}" ]]; then
    local expect_release_path
    expect_release_path="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
    log "Post-rollback /api/version check (expect SHA and releasePath from previous release)"
    if ! EXPECT_SHA="$expect_sha" EXPECT_RELEASE_PATH="$expect_release_path" node - <<'NODE'
const timeoutMs = 60_000;
const start = Date.now();
const base = 'http://127.0.0.1:3000';
const expected = (process.env.EXPECT_SHA || '').trim();
const expectedReleasePath = (process.env.EXPECT_RELEASE_PATH || '').trim();
let lastBody = '';
let lastSha = '';
let lastReleasePath = '';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  while (Date.now() - start < timeoutMs) {
    try {
      const verRes = await fetch(`${base}/api/version`, {
        headers: { 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(5000),
      });
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
      lastReleasePath = typeof v?.releasePath === 'string' ? v.releasePath.trim() : '';
      if (lastSha === expected && lastReleasePath === expectedReleasePath) {
        console.log('rollback-version-health: ok');
        return;
      }
    } catch (e) {
      lastBody = e?.name === 'TimeoutError' ? 'TimeoutError: /api/version' : String(e);
    }
    await sleep(500);
  }
  console.error(
    'rollback-version-health: failed expected=',
    expected,
    'expectedReleasePath=',
    expectedReleasePath,
    'lastSha=',
    lastSha,
    'lastReleasePath=',
    lastReleasePath,
    'lastBody=',
    lastBody,
  );
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

cleanup_old_release_artifacts

log "Preparing staging dir: $STAGING_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

log "Unpacking artifact into staging"
tar -xzf "$ARTIFACT_PATH" -C "$STAGING_DIR"

log "Preflight: mandatory artifact paths"
[[ -f "$STAGING_DIR/package.json" ]] || die "artifact missing package.json"
[[ -f "$STAGING_DIR/package-lock.json" ]] || die "artifact missing package-lock.json"
[[ -d "$STAGING_DIR/.next" ]] || die "artifact missing .next/"
[[ -f "$STAGING_DIR/release-meta.json" ]] || die "artifact missing release-meta.json"
[[ -d "$STAGING_DIR/node_modules" ]] || die "artifact missing node_modules/ (artifact must bundle prod deps)"
[[ -f "$STAGING_DIR/node_modules/next/dist/bin/next" ]] || die "artifact missing Next CLI (node_modules/next/dist/bin/next)"
[[ -f "$STAGING_DIR/scripts/check-location-pdf-chromium.mjs" ]] || die "artifact missing scripts/check-location-pdf-chromium.mjs"

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
ensure_crm_operator_allowlist
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

log "Starting PM2 with direct Next command (single app: $PM2_ONLY)"
pm2_clean_start "$PM2_ONLY" "3000" || die "PM2 start aborted: port 3000 not free"

log "Resolved current symlink (readlink -f /var/www/asi/current):"
readlink -f /var/www/asi/current || true

log "PM2 runtime fingerprint (jlist) ($PM2_ONLY):"
PM2_ONLY="$PM2_ONLY" node - <<'NODE' || true
const { execSync } = require('child_process');
const name = (process.env.PM2_ONLY || 'asi-landing').trim();
try {
  const raw = execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const list = JSON.parse(raw);
  const p = list.find((x) => x && x.name === name);
  if (!p) {
    console.log(`pm2(${name}): not found`);
    process.exit(0);
  }
  const env = p.pm2_env || {};
  console.log(`pm2(${name}): status=${env.status} pid=${env.pid} restart_time=${env.restart_time}`);
  console.log(`  pm_cwd=${env.pm_cwd}`);
  console.log(`  pm_exec_path=${env.pm_exec_path}`);
  console.log(`  exec_interpreter=${env.exec_interpreter}`);
} catch (e) {
  console.log(`pm2(${name}): jlist parse failed: ${String(e)}`);
}
NODE

log "PM2 online status is diagnostic only; release readiness is checked by /api/version"

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
    interpreter: env.exec_interpreter,
    node_version: env.node_version,
    args: env.args,
    env: {
      ASI_APP_ROOT: env.env?.ASI_APP_ROOT ?? null,
      ASI_RELEASE_DEPLOYED_AT_ISO: env.env?.ASI_RELEASE_DEPLOYED_AT_ISO ?? null,
      ASI_RELEASE_PATH: env.env?.ASI_RELEASE_PATH ?? null,
      NODE_ENV: env.env?.NODE_ENV ?? null,
      PORT: env.env?.PORT ?? null,
    },
  }, null, 2));
} catch (e) {
  console.log('pm2-jlist: failed:', String(e));
}
NODE
log "  curl /api/health (best-effort):"
curl_with_timeout_diagnostics "http://127.0.0.1:3000/api/health" "/api/health best-effort" 5 && echo "" || true
log "  curl /api/version (best-effort):"
curl_with_timeout_diagnostics "http://127.0.0.1:3000/api/version" "/api/version best-effort" 5 && echo "" || true

EXPECTED_CURRENT_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
log "Post-switch /api/version healthcheck (retries until SHA and releasePath match current release)"
if ! EXPECT_SHA="$EXPECTED_SHA" EXPECT_RELEASE_PATH="$EXPECTED_CURRENT_TARGET" node - <<'NODE'
const timeoutMs = 60_000;
const start = Date.now();
const base = 'http://127.0.0.1:3000';
const expected = (process.env.EXPECT_SHA || '').trim();
const expectedReleasePath = (process.env.EXPECT_RELEASE_PATH || '').trim();

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let lastSha = '';
let lastStatus = 0;
let lastBody = '';
let lastReleasePath = '';
let lastAppRoot = '';
let lastProcessCwd = '';
let lastResolvedReleasePath = '';

(async () => {
  while (Date.now() - start < timeoutMs) {
    try {
      const verRes = await fetch(`${base}/api/version`, {
        headers: { 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(5000),
      });
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
      lastReleasePath = typeof v?.releasePath === 'string' ? v.releasePath.trim() : '';
      lastAppRoot = typeof v?.appRoot === 'string' ? v.appRoot.trim() : '';
      lastProcessCwd = typeof v?.processCwd === 'string' ? v.processCwd.trim() : '';
      lastResolvedReleasePath =
        typeof v?.resolvedReleasePath === 'string' ? v.resolvedReleasePath.trim() : '';
      if (lastSha === expected && lastReleasePath === expectedReleasePath) {
        console.log('version-health: ok sha=', lastSha, 'releasePath=', lastReleasePath);
        return;
      }
    } catch (e) {
      lastBody = e?.name === 'TimeoutError' ? 'TimeoutError: /api/version' : String(e);
    }
    await sleep(500);
  }
  console.error('version-health: FAILED');
  console.error('  expected SHA (from artifact release-meta.json):', expected);
  console.error('  expected releasePath (readlink -f current):', expectedReleasePath || '<missing>');
  console.error('  last /api/version status:', lastStatus);
  console.error('  last /api/version sha:', lastSha);
  console.error('  last /api/version releasePath:', lastReleasePath || '<missing>');
  console.error('  last /api/version appRoot:', lastAppRoot || '<missing>');
  console.error('  last /api/version processCwd:', lastProcessCwd || '<missing>');
  console.error('  last /api/version resolvedReleasePath:', lastResolvedReleasePath || '<missing>');
  console.error('  last body:', lastBody.slice(0, 800));
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
then
  log "/api/version healthcheck failed after switch"
  log "  expected SHA (artifact): $EXPECTED_SHA"
  log "  attempted new release: $RELEASE_DIR"
  log "  previous release path: ${PREV_TARGET:-<none>}"

  log "Failure diagnostics (post-switch)"
  log "  readlink -f ${CURRENT_LINK}: $(readlink -f "$CURRENT_LINK" || echo "<unavailable>")"
  log "  Expected current target (readlink -f): $(readlink -f "$CURRENT_LINK" 2>/dev/null || echo "<unavailable>")"
  log "  Expected SHA (artifact): $EXPECTED_SHA"
  log "  PM2 status:"
  pm2 status "$PM2_ONLY" 2>/dev/null || pm2 status || true
  log "  PM2 describe ($PM2_ONLY):"
  pm2 describe "$PM2_ONLY" 2>/dev/null || true
  log "  PM2 env/cwd/script (jlist):"
  PM2_ONLY="$PM2_ONLY" node - <<'NODE' || true
const { execSync } = require('child_process');
const name = (process.env.PM2_ONLY || 'asi-landing').trim();
try {
  const raw = execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const list = JSON.parse(raw);
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
    interpreter: env.exec_interpreter,
    args: env.args,
    env: {
      ASI_APP_ROOT: env.env?.ASI_APP_ROOT ?? null,
      ASI_RELEASE_PATH: env.env?.ASI_RELEASE_PATH ?? null,
    },
  }, null, 2));
} catch (e) {
  console.log('pm2-jlist: failed:', String(e));
}
NODE
  log "  PM2 logs ($PM2_ONLY) last 120 lines:"
  pm2 logs "$PM2_ONLY" --lines 120 --nostream 2>/dev/null || true
  log "  ss -ltnp | grep :3000:"
  ss -ltnp 2>/dev/null | grep ":3000" || true
  log "  ps -ef | grep -E 'next|node|npm' | grep -v grep:"
  ps -ef 2>/dev/null | grep -E 'next|node|npm' | grep -v grep || true
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
  die "Deploy failed post-switch /api/version healthcheck; rolled back where possible."
fi

log "Post-switch diagnostics"
EXPECTED_CURRENT_TARGET="${EXPECTED_CURRENT_TARGET:-$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)}"
log "  readlink -f ${CURRENT_LINK}: ${EXPECTED_CURRENT_TARGET:-<unavailable>}"
log "  release-meta.json (current):"
cat "${CURRENT_LINK}/release-meta.json" 2>/dev/null || echo "<missing release-meta.json>"
log "  PM2 env/cwd/script (jlist):"
PM2_ONLY="$PM2_ONLY" node - <<'NODE' || true
const { execSync } = require('child_process');
const name = (process.env.PM2_ONLY || 'asi-landing').trim();
try {
  const raw = execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const list = JSON.parse(raw);
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
    interpreter: env.exec_interpreter,
    args: env.args,
    env: {
      ASI_APP_ROOT: env.env?.ASI_APP_ROOT ?? null,
      ASI_RELEASE_PATH: env.env?.ASI_RELEASE_PATH ?? null,
    },
  }, null, 2));
} catch (e) {
  console.log('pm2-jlist: failed:', String(e));
}
NODE

log "  curl /api/health (best-effort):"
curl_with_timeout_diagnostics "http://127.0.0.1:3000/api/health" "/api/health post-switch" 5 && echo "" || true
log "  curl /api/version (best-effort after successful release check):"
curl_with_timeout_diagnostics "http://127.0.0.1:3000/api/version" "/api/version post-switch best-effort" 5 && echo "" || true

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
curl_with_timeout_diagnostics "http://127.0.0.1:3000/api/version" "/api/version final" 5 && echo "" || true
