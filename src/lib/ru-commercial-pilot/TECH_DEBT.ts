/**
 * Technical debt after P0-01 (canonical RU commercial pilot lifecycle):
 *
 * Supporting / non-canonical layers (do not delete; do not treat as commercial SSOT):
 * - CRM `crm_contacts.status` including `active_pilot` — operator capacity / rollout queue
 * - Ops v17 `ops_v17_onboardings.pilot_activated_at` — internal zero-touch wizard
 * - Guest Autopilot `accounts.lifecycle_*` + `TRIAL_DAYS` — international Stripe trial
 * - `pilot-readiness` — object passport evidence only (reused as start gate, not commercial clock)
 *
 * Follow-ups (later P0): 14-day telemetry pack, report_ready transition implementation,
 * continued/stopped with entitlement (YooKassa stays disabled until owner gate).
 */
export const RU_COMMERCIAL_PILOT_LIFECYCLE_DEBT = [
  'crm_active_pilot_not_ssot',
  'ops_v17_pilot_active_not_ssot',
  'guestautopilot_trial_not_ru_pilot',
  'report_ready_transition_not_wired',
  'continued_stopped_not_wired',
] as const;
