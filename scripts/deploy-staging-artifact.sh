#!/usr/bin/env bash
set -euo pipefail

SHA="${1:-}"
ARTIFACT_PATH="${2:-}"
ENV_SOURCE="${3:-}"
BASE_DIR="${ASI_BASE_DIR:-}"
APP_NAME="${PM2_APP_NAME:-}"
APP_PORT="${APP_PORT:-}"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "A full commit SHA is required"
[[ -f "$ARTIFACT_PATH" ]] || die "Staging artifact is missing"
[[ -f "$ENV_SOURCE" ]] || die "Staging environment file is missing"
[[ "$BASE_DIR" == "/var/www/asi-staging" ]] || die "Refusing non-staging application path"
[[ "$APP_NAME" == "asi-landing-staging" ]] || die "Refusing non-staging PM2 process name"
[[ "$APP_PORT" == "3001" ]] || die "Refusing non-staging application port"

for command in tar node pm2 curl install; do
  command -v "$command" >/dev/null 2>&1 || die "Missing required command: $command"
done

RELEASES_DIR="$BASE_DIR/releases"
SHARED_DIR="$BASE_DIR/shared"
CURRENT_LINK="$BASE_DIR/current"
RELEASE_DIR="$RELEASES_DIR/$SHA"
STAGING_DIR="$RELEASE_DIR.tmp.$$"
ENV_FILE="$SHARED_DIR/.env.staging.local"

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
chmod 700 "$SHARED_DIR"
install -m 600 "$ENV_SOURCE" "$ENV_FILE"
printf 'ASI_APP_ROOT=%s\nASI_RELEASE_PATH=%s\nASI_RELEASE_DEPLOYED_AT_ISO=%s\n' \
  "$CURRENT_LINK" "$RELEASE_DIR" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "$ENV_FILE"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$STAGING_DIR"
[[ -f "$STAGING_DIR/release-meta.json" ]] || die "Artifact release metadata is missing"
[[ -f "$STAGING_DIR/node_modules/next/dist/bin/next" ]] || die "Artifact Next.js runtime is missing"

META_SHA="$(node -e "const m=require(process.argv[1]);process.stdout.write(m.gitSha||'')" "$STAGING_DIR/release-meta.json")"
[[ "$META_SHA" == "$SHA" ]] || die "Artifact SHA does not match requested SHA"

rm -rf "$RELEASE_DIR"
mv "$STAGING_DIR" "$RELEASE_DIR"
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env.production.local"

PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
SWAP_LINK="$BASE_DIR/current.swap.$$"
ln -sfn "$RELEASE_DIR" "$SWAP_LINK"
mv -Tf "$SWAP_LINK" "$CURRENT_LINK"

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
echo "Staging deploy complete: SHA=$SHA process=$APP_NAME port=$APP_PORT"
