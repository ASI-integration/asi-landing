// Safe per-account execution decision for the dedicated Booking Ops scheduler.
// Only literal opt-ins enable a live send; persisted server policy remains authoritative.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MANUAL_LIVE_CONFIRMATION = 'SEND_FOR_THIS_ACCOUNT';

export function parseSchedulerAccountAllowlist(value) {
  const input = String(value ?? '').trim();
  if (!input) return { valid: false, ids: new Set(), reason: 'missing_allowlist' };
  const tokens = input.split(',').map((token) => token.trim());
  if (tokens.some((token) => !UUID_RE.test(token))) {
    return { valid: false, ids: new Set(), reason: 'invalid_allowlist' };
  }
  const ids = new Set(tokens.map((token) => token.toLowerCase()));
  if (ids.size !== tokens.length || ids.size > 20) {
    return { valid: false, ids: new Set(), reason: 'duplicate_or_oversized_allowlist' };
  }
  return { valid: true, ids, reason: null };
}

export function decideBookingOpsSchedulerExecution({
  eventName, accountId, manualDryRun, manualLiveConfirmation,
  schedulerEnabled, scheduledLiveEnabled, scheduledAccountAllowlist,
} = {}) {
  const id = String(accountId ?? '').trim();
  if (!UUID_RE.test(id)) return { execute: false, dryRun: true, reason: 'invalid_account_id' };
  if (eventName === 'workflow_dispatch') {
    if (manualDryRun === 'true') {
      return { execute: true, dryRun: true, reason: 'manual_dry_run' };
    }
    if (manualDryRun !== 'false') {
      return { execute: false, dryRun: true, reason: 'invalid_manual_dry_run' };
    }
    if (manualLiveConfirmation !== MANUAL_LIVE_CONFIRMATION) {
      return { execute: false, dryRun: true, reason: 'manual_live_not_acknowledged' };
    }
    return { execute: true, dryRun: false, reason: 'manual_live_owner_acknowledged' };
  }
  if (eventName !== 'schedule') {
    return { execute: false, dryRun: true, reason: 'invalid_event' };
  }
  if (schedulerEnabled !== 'true') {
    return { execute: false, dryRun: true, reason: 'scheduled_mode_not_enabled' };
  }
  const allowlist = parseSchedulerAccountAllowlist(scheduledAccountAllowlist);
  if (scheduledLiveEnabled !== 'true') {
    return { execute: true, dryRun: true, reason: 'scheduled_dry_run' };
  }
  if (!allowlist.valid) {
    return { execute: false, dryRun: true, reason: allowlist.reason };
  }
  if (!allowlist.ids.has(id.toLowerCase())) {
    return { execute: true, dryRun: true, reason: 'account_not_live_allowlisted' };
  }
  return { execute: true, dryRun: false, reason: 'scheduled_live_account_allowlisted' };
}
