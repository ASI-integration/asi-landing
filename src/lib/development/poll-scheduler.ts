export type DevelopmentPollStatus =
  | 'queued'
  | 'running'
  | 'awaiting_owner'
  | 'completed'
  | 'failed'
  | null
  | undefined;

export function isTerminalDevelopmentStatus(status: DevelopmentPollStatus): boolean {
  return status === 'completed' || status === 'failed';
}

type SchedulerOptions = {
  intervalMs: number;
  onPoll: () => Promise<void>;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

/**
 * Non-overlapping poll scheduler. Stops when stopped() is called (unmount / task change / terminal).
 */
export function createDevelopmentPollScheduler(options: SchedulerOptions) {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let inFlight = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeoutFn(() => {
      void tick();
    }, options.intervalMs);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await options.onPoll();
    } finally {
      inFlight = false;
      if (!stopped) schedule();
    }
  };

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
    get inFlight() {
      return inFlight;
    },
  };
}
