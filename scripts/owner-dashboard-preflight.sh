#!/usr/bin/env bash
# Read-only production prerequisite checks. Print labels only, never values.
set +x
set -eu
check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf '%s=PASS\n' "$label"
  else
    printf '%s=FAIL\n' "$label"
    exit 1
  fi
}
check SSH_IDENTITY test "$(id -un)" = project_ayfaar
check CURRENT_SYMLINK test -L /var/www/asi/current
check SHARED_ENV_FILE test -f /var/www/asi/shared/.env.production.local
check SHARED_ENV_READABLE test -r /var/www/asi/shared/.env.production.local
check SESSION_SECRET_PRESENT grep -Eq "^SESSION_SECRET=.+" /var/www/asi/shared/.env.production.local
check OWNER_EMAILS_PRESENT grep -Eq "^ASI_DEVELOPMENT_OWNER_EMAILS=.+" /var/www/asi/shared/.env.production.local
check GITHUB_TOKEN_PRESENT grep -Eq "^GITHUB_TOKEN=.+" /var/www/asi/shared/.env.production.local
check LANDING_SERVICE_ACTIVE /usr/bin/systemctl is-active --quiet asi-landing.service
