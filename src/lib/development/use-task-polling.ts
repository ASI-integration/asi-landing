'use client';

import { useEffect, useRef } from 'react';
import {
  createDevelopmentPollScheduler,
  isTerminalDevelopmentStatus,
  type DevelopmentPollStatus,
} from './poll-scheduler';

export type { DevelopmentPollStatus } from './poll-scheduler';
export { isTerminalDevelopmentStatus } from './poll-scheduler';

/**
 * Polls while status is queued/running/awaiting_owner.
 * Guarantees no overlapping requests and cleans up on unmount / taskId change.
 */
export function useDevelopmentTaskPolling(options: {
  taskId: string | null;
  status: DevelopmentPollStatus;
  enabled: boolean;
  intervalMs?: number;
  onPoll: (taskId: string) => Promise<void>;
}) {
  const { taskId, status, enabled, intervalMs = 3000, onPoll } = options;
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  useEffect(() => {
    if (!enabled || !taskId) return;
    if (isTerminalDevelopmentStatus(status)) return;

    const currentTaskId = taskId;
    const scheduler = createDevelopmentPollScheduler({
      intervalMs,
      onPoll: () => onPollRef.current(currentTaskId),
    });

    return () => {
      scheduler.stop();
    };
  }, [enabled, taskId, status, intervalMs]);
}
