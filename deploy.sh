#!/usr/bin/env bash
set -euo pipefail
cat >&2 <<'MSG'
ERROR: deploy.sh is retired.

Production releases are artifact-only: GitHub Actions builds in CI and the VPS runs
scripts/deploy-artifact.sh (no git pull / npm build in the live tree).

See: .github/workflows/deploy.yml and DEPLOY.md
MSG
exit 1
