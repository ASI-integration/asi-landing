#!/usr/bin/env bash
# rollback.sh — roll back asi-landing to a previous commit and redeploy
# Usage:
#   bash rollback.sh            → rolls back to HEAD~1 (previous commit)
#   bash rollback.sh <sha>      → rolls back to specific commit SHA
set -euo pipefail

APP_DIR="/root/asi-landing"
APP_NAME="asi-landing"
HEALTH_URL="http://127.0.0.1:3000"
HEALTH_RETRIES=12
HEALTH_INTERVAL=5
TARGET="${1:-HEAD~1}"

log() { echo "[rollback] $*"; }
fail() { echo "[rollback] FAILED: $*" >&2; exit 1; }

cd "$APP_DIR"

# ── Show recent commits ───────────────────────────────────────────────────────
log "recent commits:"
git log --oneline -6

CURRENT=$(git rev-parse HEAD)
RESOLVED=$(git rev-parse "$TARGET")
log "current : $CURRENT"
log "rolling back to: $RESOLVED"

# ── Reset ─────────────────────────────────────────────────────────────────────
log "checking out $TARGET..."
git checkout "$RESOLVED" -- .
# Keep git HEAD pointer in sync so repeated rollbacks don't confuse git
git reset --soft "$RESOLVED"

# ── Install ───────────────────────────────────────────────────────────────────
log "installing dependencies..."
npm install --prefer-offline

# ── Build ─────────────────────────────────────────────────────────────────────
log "building..."
npm run build

# ── Verify build ──────────────────────────────────────────────────────────────
log "verifying build..."
[[ -f ".next/BUILD_ID" ]] || fail "build did not produce .next/BUILD_ID — aborting"
log "build OK ($(cat .next/BUILD_ID))"

# ── Restart app ───────────────────────────────────────────────────────────────
log "restarting app..."
if pm2 describe "$APP_NAME" &>/dev/null; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

# ── Reload nginx ──────────────────────────────────────────────────────────────
log "reloading nginx..."
nginx -t && systemctl reload nginx

# ── Healthcheck ───────────────────────────────────────────────────────────────
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

log "rollback complete — running on commit $RESOLVED"
