/**
 * SP-05 — user-facing labels for Pilot Console normalized statuses.
 * Does not invent a second status model; only maps API consoleStatus → copy.
 */
import type { PilotConsoleStatus } from './status';
import { isTerminalPilotConsoleStatus } from './status';
import { PILOT_USER_STATE } from './user-copy';

export type { PilotConsoleStatus };
export { isTerminalPilotConsoleStatus };

export const PILOT_CONSOLE_STATUS_LABELS: Record<PilotConsoleStatus, string> = {
  queued: PILOT_USER_STATE.readyToWork,
  running: PILOT_USER_STATE.inProgress,
  blocked: PILOT_USER_STATE.needsAnswer,
  succeeded: PILOT_USER_STATE.done,
  failed: PILOT_USER_STATE.failed,
};

export function pilotConsoleStatusLabel(status: PilotConsoleStatus): string {
  return PILOT_CONSOLE_STATUS_LABELS[status] ?? status;
}

export function pilotConsoleStatusTone(
  status: PilotConsoleStatus,
): 'neutral' | 'active' | 'attention' | 'success' | 'danger' {
  switch (status) {
    case 'queued':
      return 'neutral';
    case 'running':
      return 'active';
    case 'blocked':
      return 'attention';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
