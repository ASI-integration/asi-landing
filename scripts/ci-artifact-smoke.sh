#!/usr/bin/env bash
# Run in CI after packaging: unpack artifact, start Next production, verify /api/health, /api/version, SHA.
# EXPECT_SHA must match release-meta.json gitSha and live /api/version.
set -euo pipefail

TGZ="${1:-}"
PORT="${2:-13077}"

if [[ -z "${TGZ}" || ! -f "$TGZ" ]]; then
  echo "Usage: EXPECT_SHA=<full-sha> bash scripts/ci-artifact-smoke.sh <artifact.tgz> [port]" >&2
  exit 2
fi

EXPECT_SHA="${EXPECT_SHA:-}"
if [[ -z "${EXPECT_SHA}" || ! "$EXPECT_SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "ERROR: EXPECT_SHA must be set to the git commit SHA packaged into the artifact" >&2
  exit 2
fi

TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP" || true
}
trap cleanup EXIT

tar -xzf "$TGZ" -C "$TMP"
cd "$TMP"

[[ -f release-meta.json ]] || { echo "ERROR: missing release-meta.json in artifact" >&2; exit 1; }

META_SHA="$(node -e "const j=require('./release-meta.json'); process.stdout.write(String(j.gitSha||'').trim())")"
if [[ "$META_SHA" != "$EXPECT_SHA" ]]; then
  echo "ERROR: release-meta.json gitSha mismatch: expected=${EXPECT_SHA} got=${META_SHA}" >&2
  exit 1
fi

if [[ -d node_modules ]]; then
  echo "Using bundled node_modules from artifact (no npm ci)."
else
  echo "Installing production deps from lockfile (legacy artifact without node_modules)..."
  npm ci --omit=dev
fi

[[ -f node_modules/next/dist/bin/next ]] || {
  echo "ERROR: Next CLI missing under node_modules" >&2
  exit 1
}

[[ -f scripts/check-location-pdf-chromium.mjs ]] || {
  echo "ERROR: missing scripts/check-location-pdf-chromium.mjs in artifact" >&2
  exit 1
}

echo "Starting Next (production) on 127.0.0.1:${PORT}..."
SRV_PID=""
PORT="$PORT" NODE_ENV=production ASI_APP_ROOT="$(pwd)" \
  nohup node ./node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$PORT" >/tmp/asi-ci-artifact-smoke.log 2>&1 &
SRV_PID=$!

stop_server() {
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" 2>/dev/null || true
  fi
  if [[ -n "${SRV_PID:-}" ]] && kill -0 "$SRV_PID" 2>/dev/null; then
    kill -TERM "$SRV_PID" 2>/dev/null || true
    sleep 0.35
    kill -KILL "$SRV_PID" 2>/dev/null || true
  fi
}
trap 'stop_server; cleanup' EXIT

BASE="http://127.0.0.1:${PORT}"
export SMOKE_BASE="$BASE"
export EXPECT_SHA
node - <<'NODE'
const base = process.env.SMOKE_BASE;
const expected = process.env.EXPECT_SHA;
const timeoutMs = 60_000;
const start = Date.now();

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`, { headers: { 'cache-control': 'no-cache' } });
      if (res.ok) break;
    } catch {}
    await sleep(400);
  }
  if (Date.now() - start >= timeoutMs) {
    throw new Error(`Timeout waiting for ${base}/api/health`);
  }

  const health = await fetch(`${base}/api/health`, { headers: { 'cache-control': 'no-cache' } }).then((r) => r.json());
  if (!health || typeof health !== 'object') throw new Error('health: invalid JSON');
  if (!health.ok) throw new Error('health: ok is not true');

  const verRes = await fetch(`${base}/api/version`, { headers: { 'cache-control': 'no-cache' } });
  if (!verRes.ok) throw new Error(`/api/version returned ${verRes.status}`);
  const ver = await verRes.json();
  const got = typeof ver?.sha === 'string' ? ver.sha.trim() : '';
  if (!got) throw new Error('/api/version: missing sha');
  if (got !== expected) {
    throw new Error(`/api/version sha mismatch: expected=${expected} got=${got}`);
  }
  console.log('ci-artifact-smoke: ok');
})().catch((e) => {
  console.error('ci-artifact-smoke: failed', e);
  process.exit(1);
});
NODE

stop_server
trap cleanup EXIT
