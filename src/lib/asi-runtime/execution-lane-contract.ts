/**
 * Runtime PR #127 executor-lane reason codes.
 * Landing /pilot create accepts ONLY READY as authoritative free-lane evidence.
 * Do not treat `runtime_executor_ready` as lane-free.
 */
export const EXECUTION_LANE_REASON_CODES = {
  READY: 'runtime_execution_lane_ready',
  OCCUPIED: 'runtime_execution_lane_occupied',
  OWNER_ACTION_REQUIRED: 'runtime_execution_lane_owner_action_required',
  RECOVERY_BLOCKED: 'runtime_execution_lane_recovery_blocked',
  UNAVAILABLE: 'runtime_execution_lane_unavailable',
} as const;

export type ExecutionLaneReasonCode =
  (typeof EXECUTION_LANE_REASON_CODES)[keyof typeof EXECUTION_LANE_REASON_CODES];

export const AUTHORITATIVE_EXECUTION_LANE_READY_REASON = EXECUTION_LANE_REASON_CODES.READY;

/** Pre-#127 executor probe code. Not proof that the execution lane is free. */
export const LEGACY_EXECUTOR_READY_REASON = 'runtime_executor_ready';

export const BRIDGE_ADMISSION_BUSY_CODE = 'admission_busy';

export const BRIDGE_NON_TERMINAL_STATUSES = ['queued', 'running', 'awaiting_owner'] as const;
export const BRIDGE_TERMINAL_STATUSES = ['completed', 'failed'] as const;

export function isAuthoritativeExecutionLaneReady(input: {
  state?: string;
  blockingLaunch?: boolean;
  reasonCode?: string | null;
}): boolean {
  return input.state === 'ready'
    && input.blockingLaunch === false
    && input.reasonCode === AUTHORITATIVE_EXECUTION_LANE_READY_REASON;
}
