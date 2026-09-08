/**
 * SP-09 — Strigunov pilot acceptance stage IDs (STRIGUNOV_PILOT_ACCEPTANCE.md §6).
 */
export const STRIGUNOV_PILOT_ACCEPTANCE_STAGES = [
  'pilot_identity',
  'pilot_template_policy',
  'pilot_create_bridge',
  'pilot_runner_execute',
  'pilot_result_card',
  'pilot_telegram_silent_success',
  'pilot_telegram_blocked',
  'pilot_authz_isolation',
  'pilot_readiness_failclosed',
] as const;

export type StrigunovPilotAcceptanceStage = typeof STRIGUNOV_PILOT_ACCEPTANCE_STAGES[number];

/** Fixed green harness prompt (S2 / SP-02). */
export const STRIGUNOV_PILOT_ACCEPTANCE_GREEN_GOAL =
  'Add a proof markdown under docs/pilot/ for the Strigunov acceptance harness.';

/**
 * Normative notification matrix expectations for strigunov_pilot_v1
 * (STRIGUNOV_PILOT_ACCEPTANCE.md §5).
 */
export const STRIGUNOV_PILOT_TELEGRAM_MATRIX = {
  profile: 'strigunov_pilot_v1',
  silentEvents: [
    'TASK_STARTED',
    'FIXING_STARTED',
    'REVIEW_FINDINGS',
  ] as const,
  silentBareReadyForOwner: true,
  notifyEvents: ['BLOCKED', 'FAILED'] as const,
  notifyExplicitHitlReadyForOwner: true,
} as const;
