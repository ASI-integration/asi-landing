# Rollback-safe OPS alert scheduler PM2 sync (sourced by deploy/rollback scripts).
# Requires log(), die(), and CURRENT_LINK in the caller.

pm2_sync_ops_alert_scheduler_rollback() {
  local root="${1:-${CURRENT_LINK:-}}"
  local script_path="${root}/scripts/ops-alert-scheduler.mjs"

  pm2 delete asi-ops-alert-scheduler >/dev/null 2>&1 || true

  if [[ -f "$script_path" ]]; then
    log "PM2 OPS alert scheduler: ensure single process asi-ops-alert-scheduler (5m cadence)"
    (
      cd "$root"
      pm2 start "$script_path" \
        --name asi-ops-alert-scheduler \
        --cwd "$root" \
        --interpreter node
    ) || die "Failed to start asi-ops-alert-scheduler"
  else
    log "OPS alert scheduler script absent in target release; removed any existing asi-ops-alert-scheduler"
  fi

  pm2 save || true
}
