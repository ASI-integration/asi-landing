#!/usr/bin/env bash
# Guest Autopilot (guestautopilot.com) production deploy — dedicated Hetzner
# VPS, entirely separate from asi-global.ru's Timeweb deploy
# (scripts/deploy-production-systemd-artifact.sh). Deliberately NOT shared
# with that script: sharing it would mean one set of hardcoded guard rails
# has to be safe for two different production targets, which is exactly the
# kind of thing that eventually gets loosened by accident. Two scripts, two
# sets of refusals, no cross-contamination possible.
set -euo pipefail

SHA="${1:-}"
ARTIFACT_PATH="${2:-}"
ENV_SOURCE="${3:-}"
BASE_DIR="${ASI_BASE_DIR:-}"
APP_PORT="${APP_PORT:-}"
SERVICE_NAME="guestautopilot.service"
SERVICE_GROUP="guestautopilot"
DEPLOY_USER="guestautopilot"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "A full commit SHA is required"
[[ -f "$ARTIFACT_PATH" ]] || die "Guest Autopilot artifact is missing"
[[ -f "$ENV_SOURCE" ]] || die "Guest Autopilot environment source is missing"

# Hard refusal of anything RU-shaped or unrecognized. This is the isolation
# boundary: even a misconfigured caller cannot make this script touch the RU
# service, because the only path/port it will ever accept is this one.
case "$BASE_DIR" in
  /var/www/asi|/var/www/asi-staging|*asi-global*|*staging.asi-global*)
    die "Refusing RU/asi-global.ru path: $BASE_DIR" ;;
esac
[[ "$BASE_DIR" == "/var/www/guestautopilot" ]] || die "Refusing unexpected base path: $BASE_DIR"
[[ "$APP_PORT" == "3000" ]] || die "Refusing unexpected port: $APP_PORT"
[[ "$(id -un)" == "$DEPLOY_USER" ]] || die "Deploy must run as $DEPLOY_USER"

for command in tar node curl install systemctl sudo chgrp; do
  command -v "$command" >/dev/null 2>&1 || die "Missing required command: $command"
done

[[ -d "$BASE_DIR" ]] || die "Base directory is missing; run the bootstrap runbook first"
[[ -w "$BASE_DIR" ]] || die "Deploy user cannot write $BASE_DIR"

RELEASES_DIR="$BASE_DIR/releases"
SHARED_DIR="$BASE_DIR/shared"
CURRENT_LINK="$BASE_DIR/current"
RELEASE_DIR="$RELEASES_DIR/$SHA"
STAGING_DIR="$RELEASE_DIR.tmp.$$"
ENV_FILE="$SHARED_DIR/.env.production.local"
ENV_TMP="$SHARED_DIR/.env.production.local.tmp.$$"
ENV_BACKUP="$SHARED_DIR/.env.production.local.rollback.$$"
HAD_ENV_FILE=0

cleanup_sensitive() {
  rm -f "$ENV_SOURCE" "$ENV_TMP" "$ENV_TMP.next" "$ENV_BACKUP"
  rm -rf "$STAGING_DIR"
}
trap cleanup_sensitive EXIT

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
[[ -w "$RELEASES_DIR" ]] || die "Deploy user cannot write $RELEASES_DIR"
[[ -w "$SHARED_DIR" ]] || die "Deploy user cannot write $SHARED_DIR"

# Preserve any server-local variables, then overlay the CI-provided keys.
if [[ -f "$ENV_FILE" ]]; then
  cp -p "$ENV_FILE" "$ENV_BACKUP"
  cp "$ENV_FILE" "$ENV_TMP"
  HAD_ENV_FILE=1
else
  : > "$ENV_TMP"
fi
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || die "Invalid environment line"
  key="${line%%=*}"
  # Refuse to let a CI-provided env file smuggle in RU config or flip the
  # billing gate on — this script is the last line of defense before it
  # lands on disk.
  case "$key" in
    HOST_VARIANT)
      value="${line#*=}"
      [[ "$value" == "ru" ]] && die "Refusing HOST_VARIANT=ru on Guest Autopilot production"
      ;;
    INTERNATIONAL_BILLING_ENABLED)
      value="${line#*=}"
      [[ "$value" == "true" ]] && die "Refusing to deploy with INTERNATIONAL_BILLING_ENABLED=true — not approved for this phase"
      ;;
    STRIPE_ONBOARDING_SECRET_KEY)
      value="${line#*=}"
      case "$value" in
        sk_live_*) die "Refusing a live Stripe secret key (sk_live_...) — test-mode only" ;;
      esac
      ;;
  esac
  tmp2="$ENV_TMP.next"
  grep -v "^${key}=" "$ENV_TMP" > "$tmp2" || true
  mv "$tmp2" "$ENV_TMP"
  printf '%s\n' "$line" >> "$ENV_TMP"
done < "$ENV_SOURCE"
rm -f "$ENV_SOURCE"

for key in ASI_APP_ROOT ASI_RELEASE_PATH ASI_RELEASE_DEPLOYED_AT_ISO ASI_DEPLOY_ENV; do
  tmp2="$ENV_TMP.next"
  grep -v "^${key}=" "$ENV_TMP" > "$tmp2" || true
  mv "$tmp2" "$ENV_TMP"
done
printf 'ASI_APP_ROOT=%s\nASI_RELEASE_PATH=%s\nASI_RELEASE_DEPLOYED_AT_ISO=%s\nASI_DEPLOY_ENV=production\n' \
  "$CURRENT_LINK" "$RELEASE_DIR" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "$ENV_TMP"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$STAGING_DIR"
[[ -f "$STAGING_DIR/release-meta.json" ]] || die "Artifact release metadata is missing"
[[ -f "$STAGING_DIR/node_modules/next/dist/bin/next" ]] || die "Artifact Next.js runtime is missing"

META_SHA="$(node -e "const m=require(process.argv[1]);process.stdout.write(m.gitSha||'')" "$STAGING_DIR/release-meta.json")"
[[ "$META_SHA" == "$SHA" ]] || die "Artifact SHA does not match requested SHA"

chgrp -R "$SERVICE_GROUP" "$STAGING_DIR"
chmod -R g+rX "$STAGING_DIR"
rm -rf "$RELEASE_DIR"
mv "$STAGING_DIR" "$RELEASE_DIR"
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env.production.local"

PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
chgrp "$SERVICE_GROUP" "$ENV_TMP"
chmod 640 "$ENV_TMP"
mv -f "$ENV_TMP" "$ENV_FILE"
SWAP_LINK="$BASE_DIR/current.swap.$$"
ln -sfn "$RELEASE_DIR" "$SWAP_LINK"
mv -Tf "$SWAP_LINK" "$CURRENT_LINK"

start_app() {
  sudo -n /usr/bin/systemctl restart "$SERVICE_NAME"
  /usr/bin/systemctl is-active --quiet "$SERVICE_NAME"
}

verify_release() {
  EXPECTED_SHA="$SHA" APP_PORT="$APP_PORT" node - <<'NODE'
const expectedSha = process.env.EXPECTED_SHA;
const base = `http://127.0.0.1:${process.env.APP_PORT}`;
const deadline = Date.now() + 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function readJson(path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.toLowerCase().includes('application/json')) return null;
  return response.json();
}
(async () => {
  while (Date.now() < deadline) {
    try {
      const health = await readJson('/api/health');
      const version = await readJson('/api/version');
      if (health?.ok === true && version?.sha === expectedSha && version?.appVersion) {
        console.log(JSON.stringify({ ok: true, sha: version.sha, appVersion: version.appVersion, environment: version.environment }));
        return;
      }
    } catch {}
    await sleep(1000);
  }
  throw new Error('Guest Autopilot JSON health verification failed');
})().catch((error) => { console.error(error.message); process.exit(1); });
NODE
}

if ! start_app || ! verify_release; then
  if [[ -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    echo "Deploy failed health verification — rolling back to $PREVIOUS_TARGET" >&2
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    if [[ "$HAD_ENV_FILE" == "1" && -f "$ENV_BACKUP" ]]; then cp -p "$ENV_BACKUP" "$ENV_FILE"; else rm -f "$ENV_FILE"; fi
    start_app || true
  fi
  die "Guest Autopilot deploy failed; previous release restored when available"
fi

rm -f "$ENV_BACKUP"
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -path "$RELEASE_DIR" ! -path "$PREVIOUS_TARGET" -mtime +7 -exec rm -rf -- {} + 2>/dev/null || true
echo "Guest Autopilot deploy complete: SHA=$SHA service=$SERVICE_NAME port=$APP_PORT base=$BASE_DIR"
