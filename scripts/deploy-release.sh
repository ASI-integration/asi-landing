#!/usr/bin/env bash
set -euo pipefail
cat >&2 <<'MSG'
ERROR: scripts/deploy-release.sh is retired (VPS-side git worktree + build).

Use GitHub Actions on push to main: it builds the release artifact and runs
scripts/deploy-artifact.sh on the VPS (unpack + npm ci --omit=dev + smoke + symlink switch).

See: .github/workflows/deploy.yml
MSG
exit 1
