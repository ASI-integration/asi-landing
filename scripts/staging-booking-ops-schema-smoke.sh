#!/usr/bin/env bash
# Dedicated diagnostic ref only. Protected workflow must remain on main.
# Never restore the deployment continuation on this branch.
set -euo pipefail
python3 scripts/strigunov4/audit.py
exit 97
