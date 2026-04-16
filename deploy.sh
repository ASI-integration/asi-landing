#!/usr/bin/env bash
# deploy.sh — production deploy for asi-landing
# Usage: bash deploy.sh
set -euo pipefail

APP_DIR="/root/asi-landing"
APP_NAME="asi-landing"
HEALTH_URL="http://127.0.0.1:3000"
HEALTH_RETRIES=12
HEALTH_INTERVAL=5

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] FAILED: $*" >&2; exit 1; }

# ── 1. Pull ────────────────────────────────────────────────────────────────────
log "pulling origin/main..."
cd "$APP_DIR"
git pull origin main

# ── 2. Install ────────────────────────────────────────────────────────────────
log "installing dependencies..."
npm install --prefer-offline

# ── 3. Build ──────────────────────────────────────────────────────────────────
log "building..."
npm run build

# ── 4. Verify build ───────────────────────────────────────────────────────────
log "verifying build..."
[[ -f ".next/BUILD_ID" ]] || fail "build did not produce .next/BUILD_ID — aborting"
log "build OK ($(cat .next/BUILD_ID))"

# ── 5. Restart app ────────────────────────────────────────────────────────────
log "restarting app..."
if pm2 describe "$APP_NAME" &>/dev/null; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

# ── 6. Reload nginx ───────────────────────────────────────────────────────────
log "reloading nginx..."
nginx -t && systemctl reload nginx

# ── 7. Healthcheck ────────────────────────────────────────────────────────────
log "checking health ($HEALTH_URL)..."
for i in $(seq 1 $HEALTH_RETRIES); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" || true)
  if [[ "$STATUS" =~ ^[23] ]]; then
    log "health OK (HTTP $STATUS)"
    break
  fi
  if [[ $i -eq $HEALTH_RETRIES ]]; then
    fail "healthcheck failed after $((HEALTH_RETRIES * HEALTH_INTERVAL))s — app not responding (last status: $STATUS)"
  fi
  log "  attempt $i/$HEALTH_RETRIES — HTTP $STATUS, retrying in ${HEALTH_INTERVAL}s..."
  sleep $HEALTH_INTERVAL
done

log "deploy complete"
