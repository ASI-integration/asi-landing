'use client';

import { useEffect, useRef } from 'react';
import { createDevelopmentPollScheduler } from '@/lib/development/poll-scheduler';
import {
  isTerminalPilotConsoleStatus,
  type PilotConsoleStatus,
} from '@/lib/pilot/status';

/**
 * Lightweight SP-05 polling for active (non-terminal) pilot tasks.
 * Reuses the existing non-overlapping scheduler; no websockets.
 */
export function usePilotTaskPolling(options: {
  taskId: string | null;
  consoleStatus: PilotConsoleStatus | null | undefined;
  enabled: boolean;
  intervalMs?: number;
  onPoll: (taskId: string) => Promise<void>;
}) {
  const { taskId, consoleStatus, enabled, intervalMs = 4000, onPoll } = options;
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  useEffect(() => {
    if (!enabled || !taskId || !consoleStatus) return;
    if (isTerminalPilotConsoleStatus(consoleStatus)) return;

    const currentTaskId = taskId;
    const scheduler = createDevelopmentPollScheduler({
      intervalMs,
      onPoll: () => onPollRef.current(currentTaskId),
    });

    return () => {
      scheduler.stop();
    };
  }, [enabled, taskId, consoleStatus, intervalMs]);
}

/**
 * Poll the task list while any listed task is still active.
 */
export function usePilotListPolling(options: {
  enabled: boolean;
  hasActiveTasks: boolean;
  intervalMs?: number;
  onPoll: () => Promise<void>;
}) {
  const { enabled, hasActiveTasks, intervalMs = 5000, onPoll } = options;
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  useEffect(() => {
    if (!enabled || !hasActiveTasks) return;

    const scheduler = createDevelopmentPollScheduler({
      intervalMs,
      onPoll: () => onPollRef.current(),
    });

    return () => {
      scheduler.stop();
    };
  }, [enabled, hasActiveTasks, intervalMs]);
}
