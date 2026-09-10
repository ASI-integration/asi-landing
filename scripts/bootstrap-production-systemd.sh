#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/var/www/asi"
CURRENT_LINK="$BASE_DIR/current"
SHARED_DIR="$BASE_DIR/shared"
ENV_FILE="$SHARED_DIR/.env.production.local"
DROPIN_DIR="/etc/systemd/system/asi-landing.service.d"
DROPIN_FILE="$DROPIN_DIR/20-release-layout.conf"
SUDOERS_FILE="/etc/sudoers.d/asi-landing-production-deploy"

fail() { echo "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || fail "Run as root"
[[ -d /srv/asi-landing ]] || fail "/srv/asi-landing is missing"
id asi-runtime >/dev/null 2>&1 || fail "asi-runtime user is missing"
id project_ayfaar >/dev/null 2>&1 || fail "project_ayfaar user is missing"
id -nG project_ayfaar | tr ' ' '\n' | grep -Fxq asi-runtime || fail "project_ayfaar is not in asi-runtime group"

mkdir -p "$BASE_DIR/releases" "$SHARED_DIR"
chown project_ayfaar:asi-runtime "$BASE_DIR" "$BASE_DIR/releases" "$SHARED_DIR"
chmod 2770 "$BASE_DIR" "$BASE_DIR/releases" "$SHARED_DIR"

if [[ ! -e "$CURRENT_LINK" ]]; then
  ln -s /srv/asi-landing "$CURRENT_LINK"
fi

touch "$ENV_FILE"
chown project_ayfaar:asi-runtime "$ENV_FILE"
chmod 640 "$ENV_FILE"

mkdir -p "$DROPIN_DIR"
cat > "$DROPIN_FILE" <<'EOF'
[Service]
WorkingDirectory=/var/www/asi/current
EnvironmentFile=-/var/www/asi/shared/.env.production.local
ExecStart=
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
EOF
chmod 644 "$DROPIN_FILE"

cat > "$SUDOERS_FILE" <<'EOF'
project_ayfaar ALL=(root) NOPASSWD: /usr/bin/systemctl restart asi-landing.service
EOF
chmod 440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

systemctl daemon-reload
systemctl restart asi-landing.service
systemctl is-active --quiet asi-landing.service || fail "asi-landing.service is not active"

for i in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then
    echo "Production systemd bootstrap complete"
    echo "current=$(readlink -f "$CURRENT_LINK")"
    exit 0
  fi
  sleep 1
done

fail "health check failed after bootstrap"
