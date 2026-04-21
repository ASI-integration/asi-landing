#!/usr/bin/env bash
set -euo pipefail
cat >&2 <<'MSG'
ERROR: deploy.sh is retired.

Production releases are artifact-only: GitHub Actions builds in CI and the VPS runs
scripts/deploy-artifact.sh (artifact unpack + symlink; no install/build on the live tree).

See: .github/workflows/deploy.yml and DEPLOY.md
MSG
exit 1
