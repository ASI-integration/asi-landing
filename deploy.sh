#!/usr/bin/env bash
# deploy.sh — production deploy for asi-landing
# Usage: bash deploy.sh
set -uo pipefail

APP_DIR="/root/asi-landing"
APP_NAME="asi-landing"
HEALTH_URL="http://127.0.0.1:3000"
HEALTH_RETRIES=12
HEALTH_INTERVAL=5

log()  { echo "[deploy] $*"; }
fail() { echo "[deploy] FAILED: $*" >&2; exit 1; }

# ── 1. Pull ────────────────────────────────────────────────────────────────────
log "pull"
cd "$APP_DIR"
git pull origin main || fail "git pull failed"

# ── 2. Install ────────────────────────────────────────────────────────────────
log "install"
if ! npm install --prefer-offline; then
  log "install failed — cleaning node_modules and retrying"
  rm -rf node_modules package-lock.json
  npm install || fail "install failed after clean reinstall"
  log "fallback reinstall OK"
fi

# ── 3. Build ──────────────────────────────────────────────────────────────────
log "build"
set +e
npm run build
BUILD_EXIT=$?
set -e

if [[ $BUILD_EXIT -ne 0 ]]; then
  fail "npm run build exited with code $BUILD_EXIT — aborting"
fi

# ── 4. Verify build ───────────────────────────────────────────────────────────
log "verify build"
[[ -f ".next/BUILD_ID" ]] || fail "build succeeded but .next/BUILD_ID missing — aborting"
log "build OK ($(cat .next/BUILD_ID))"

# ── 5. Start / reload app ─────────────────────────────────────────────────────
log "start/reload app"
if pm2 describe "$APP_NAME" &>/dev/null; then
  pm2 reload ecosystem.config.cjs --update-env || fail "pm2 reload failed"
else
  pm2 start ecosystem.config.cjs || fail "pm2 start failed"
fi
pm2 save

# ── 6. Healthcheck ────────────────────────────────────────────────────────────
log "healthcheck"
HEALTHY=0
for i in $(seq 1 $HEALTH_RETRIES); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" || true)
  if [[ "$STATUS" =~ ^[23] ]]; then
    log "health OK (HTTP $STATUS)"
    HEALTHY=1
    break
  fi
  log "  attempt $i/$HEALTH_RETRIES — HTTP $STATUS, retrying in ${HEALTH_INTERVAL}s..."
  sleep $HEALTH_INTERVAL
done

[[ $HEALTHY -eq 1 ]] || fail "healthcheck failed after $((HEALTH_RETRIES * HEALTH_INTERVAL))s — nginx NOT reloaded, app may be broken"

# ── 7. Reload nginx — only after healthy app ──────────────────────────────────
log "reload nginx"
nginx -t && systemctl reload nginx || fail "nginx reload failed"

log "success"
