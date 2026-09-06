#!/usr/bin/env bash
# Staging-only rollback to an existing artifact release.
set -euo pipefail

SHA="${1:-}"

readonly BASE_DIR="/var/www/asi-staging"
readonly CURRENT_LINK="$BASE_DIR/current"
readonly RELEASES_DIR="$BASE_DIR/releases"
readonly ENV_FILE="$BASE_DIR/shared/.env.staging.local"
readonly APP_NAME="asi-landing-staging"
readonly APP_PORT="3001"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "A full staging release SHA is required"
[[ "$BASE_DIR" == "/var/www/asi-staging" ]] || die "Refusing non-staging application path"
[[ "$APP_NAME" == "asi-landing-staging" ]] || die "Refusing non-staging PM2 process name"
[[ "$APP_PORT" == "3001" ]] || die "Refusing non-staging application port"

for command in node pm2; do
  command -v "$command" >/dev/null 2>&1 || die "Missing required command: $command"
done

RELEASE_DIR="$RELEASES_DIR/$SHA"
[[ -d "$RELEASE_DIR" ]] || die "Staging release directory not found: $RELEASE_DIR"
[[ -f "$RELEASE_DIR/release-meta.json" ]] || die "Release metadata is missing"
[[ -f "$RELEASE_DIR/node_modules/next/dist/bin/next" ]] || die "Release Next.js runtime is missing"
[[ -f "$ENV_FILE" ]] || die "Shared staging environment file is missing"

META_SHA="$(node -e "const m=require(process.argv[1]);process.stdout.write(m.gitSha||'')" "$RELEASE_DIR/release-meta.json")"
[[ "$META_SHA" == "$SHA" ]] || die "Release metadata SHA does not match requested SHA"

update_env_key() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" >"$tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

start_app() {
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  (
    cd "$CURRENT_LINK"
    NODE_ENV=production PORT="$APP_PORT" pm2 start node_modules/next/dist/bin/next \
      --name "$APP_NAME" --cwd "$CURRENT_LINK" -- start -H 127.0.0.1 -p "$APP_PORT"
  )
  pm2 save
}

verify_release() {
  EXPECTED_SHA="$SHA" APP_PORT="$APP_PORT" node - <<'NODE'
const base = `http://127.0.0.1:${process.env.APP_PORT}`;
const expectedSha = process.env.EXPECTED_SHA;
const deadline = Date.now() + 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  while (Date.now() < deadline) {
    try {
      const healthResponse = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      const versionResponse = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(5000) });
      const health = await healthResponse.json();
      const version = await versionResponse.json();
      if (healthResponse.ok && versionResponse.ok && health.ok === true
          && version.environment === 'staging' && version.sha === expectedSha) {
        console.log(JSON.stringify({ ok: true, environment: version.environment, sha: version.sha }));
        return;
      }
    } catch {}
    await sleep(1000);
  }
  throw new Error('Staging rollback health verification failed');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
}

PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
SWAP_LINK="$BASE_DIR/current.rollback.$$"

update_env_key ASI_RELEASE_PATH "$RELEASE_DIR"
update_env_key ASI_RELEASE_DEPLOYED_AT_ISO "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env.production.local"
ln -sfn "$RELEASE_DIR" "$SWAP_LINK"
mv -Tf "$SWAP_LINK" "$CURRENT_LINK"

if ! start_app || ! verify_release; then
  if [[ -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    update_env_key ASI_RELEASE_PATH "$PREVIOUS_TARGET"
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    start_app || true
  fi
  die "Staging rollback failed; previous release restored when available"
fi

echo "Staging rollback complete: SHA=$SHA process=$APP_NAME port=$APP_PORT"
