#!/usr/bin/env bash
set -euo pipefail

SHA="${1:-}"
ARTIFACT_PATH="${2:-}"
ENV_SOURCE="${3:-}"
BASE_DIR="${ASI_BASE_DIR:-}"
APP_NAME="${PM2_APP_NAME:-}"
APP_PORT="${APP_PORT:-}"
SERVICE_NAME="asi-landing-staging.service"
SERVICE_GROUP="asi-runtime"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "A full commit SHA is required"
[[ -f "$ARTIFACT_PATH" ]] || die "Staging artifact is missing"
[[ -f "$ENV_SOURCE" ]] || die "Staging environment file is missing"
[[ "$BASE_DIR" == "/var/www/asi-staging" ]] || die "Refusing non-staging application path"
[[ "$APP_NAME" == "asi-landing-staging" ]] || die "Refusing non-staging application name"
[[ "$APP_PORT" == "3001" ]] || die "Refusing non-staging application port"

for command in tar node curl install systemctl sudo chgrp; do
  command -v "$command" >/dev/null 2>&1 || die "Missing required command: $command"
done

[[ -d "$BASE_DIR" ]] || die "Staging base directory is missing"
[[ -w "$BASE_DIR" ]] || die "Staging deploy user cannot write $BASE_DIR"

RELEASES_DIR="$BASE_DIR/releases"
SHARED_DIR="$BASE_DIR/shared"
CURRENT_LINK="$BASE_DIR/current"
RELEASE_DIR="$RELEASES_DIR/$SHA"
STAGING_DIR="$RELEASE_DIR.tmp.$$"
ENV_FILE="$SHARED_DIR/.env.staging.local"
ENV_TMP="$SHARED_DIR/.env.staging.local.tmp.$$"

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
[[ -w "$RELEASES_DIR" ]] || die "Staging deploy user cannot write $RELEASES_DIR"
[[ -w "$SHARED_DIR" ]] || die "Staging deploy user cannot write $SHARED_DIR"

# Write the service environment atomically. The deploy user is expected to be
# a member of the asi-runtime group; the systemd service runs as asi-runtime.
rm -f "$ENV_TMP"
install -m 640 "$ENV_SOURCE" "$ENV_TMP"
chgrp "$SERVICE_GROUP" "$ENV_TMP" || { rm -f "$ENV_TMP"; die "Cannot assign staging env to $SERVICE_GROUP group"; }

# Runtime Bridge bearer tokens are staging-host secrets. They are provisioned
# once on the server and intentionally kept out of GitHub Actions. Preserve
# them across application deploys when the generated staging.env does not
# contain them.
if [[ -f "$ENV_FILE" ]]; then
  for key in \
    ASI_RUNTIME_BRIDGE_CHAT_TOKEN \
    ASI_RUNTIME_BRIDGE_OWNER_TOKEN \
    ASI_RUNTIME_BRIDGE_RUNNER_TOKEN; do
    if ! grep -q "^${key}=" "$ENV_SOURCE"; then
      preserved="$(grep -m1 "^${key}=" "$ENV_FILE" || true)"
      if [[ -n "$preserved" ]]; then
        printf '%s\n' "$preserved" >> "$ENV_TMP"
      fi
    fi
  done
fi

printf 'ASI_APP_ROOT=%s\nASI_RELEASE_PATH=%s\nASI_RELEASE_DEPLOYED_AT_ISO=%s\n' \
  "$CURRENT_LINK" "$RELEASE_DIR" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "$ENV_TMP"
mv -f "$ENV_TMP" "$ENV_FILE"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$STAGING_DIR"
[[ -f "$STAGING_DIR/release-meta.json" ]] || die "Artifact release metadata is missing"
[[ -f "$STAGING_DIR/node_modules/next/dist/bin/next" ]] || die "Artifact Next.js runtime is missing"

META_SHA="$(node -e "const m=require(process.argv[1]);process.stdout.write(m.gitSha||'')" "$STAGING_DIR/release-meta.json")"
[[ "$META_SHA" == "$SHA" ]] || die "Artifact SHA does not match requested SHA"

# Ensure the service account can traverse/read the release created by the
# dedicated deploy account without making staging world-writable.
chgrp -R "$SERVICE_GROUP" "$STAGING_DIR"
chmod -R g+rX "$STAGING_DIR"

rm -rf "$RELEASE_DIR"
mv "$STAGING_DIR" "$RELEASE_DIR"
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env.production.local"

PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
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
        if (health?.ok === true && version?.environment === 'staging' && version?.sha === expectedSha && version?.appVersion) {
          console.log(JSON.stringify({ ok: true, environment: version.environment, sha: version.sha, appVersion: version.appVersion }));
          return;
        }
      } catch {}
      await sleep(1000);
    }
    throw new Error('Staging JSON health verification failed');
  })().catch((error) => { console.error(error.message); process.exit(1); });
NODE
}

if ! start_app || ! verify_release; then
  if [[ -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    start_app || true
  fi
  die "Staging deploy failed; previous release restored when available"
fi

find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -path "$RELEASE_DIR" ! -path "$PREVIOUS_TARGET" -mtime +7 -exec rm -rf -- {} + 2>/dev/null || true
echo "Staging deploy complete: SHA=$SHA service=$SERVICE_NAME port=$APP_PORT"
