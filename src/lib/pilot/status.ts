/**
 * SP-04 — smallest Pilot Console status normalization.
 * Does not redesign Bridge/Runtime status enums.
 */
import type { RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';

/** Stable Pilot Console statuses for UI badges (SP-04 / future SP-05). */
export type PilotConsoleStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'succeeded'
  | 'failed';

/**
 * Map Bridge task status → Pilot Console status.
 * `awaiting_owner` becomes `blocked` for pilots (they cannot approve owner gates).
 */
export function normalizePilotConsoleStatus(
  bridgeStatus: RuntimeBridgeTaskStatus,
): PilotConsoleStatus {
  switch (bridgeStatus) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'awaiting_owner':
      return 'blocked';
    case 'completed':
      return 'succeeded';
    case 'failed':
      return 'failed';
    default: {
      const _exhaustive: never = bridgeStatus;
      return _exhaustive;
    }
  }
}

export function isTerminalPilotConsoleStatus(status: PilotConsoleStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'blocked';
}
