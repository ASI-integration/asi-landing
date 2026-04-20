#!/usr/bin/env bash
set -euo pipefail
cat >&2 <<'MSG'
ERROR: rollback.sh is retired (git checkout + rebuild in a single app directory).

Rollback for production is symlink-based under ASI_BASE_DIR (default /var/www/asi):
  ASI_BASE_DIR=/var/www/asi bash scripts/rollback-artifact.sh <existing-release-sha>

List candidates: ls /var/www/asi/releases
MSG
exit 1
