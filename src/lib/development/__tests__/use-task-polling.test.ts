import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDevelopmentPollScheduler,
  isTerminalDevelopmentStatus,
} from '../poll-scheduler';

describe('development poll scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recognizes terminal statuses', () => {
    expect(isTerminalDevelopmentStatus('completed')).toBe(true);
    expect(isTerminalDevelopmentStatus('failed')).toBe(true);
    expect(isTerminalDevelopmentStatus('running')).toBe(false);
  });

  it('does not overlap in-flight poll requests', async () => {
    const gate: { resolve: (() => void) | null } = { resolve: null };
    const onPoll = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          gate.resolve = resolve;
        }),
    );

    const scheduler = createDevelopmentPollScheduler({
      intervalMs: 3000,
      onPoll,
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(onPoll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(onPoll).toHaveBeenCalledTimes(1);

    gate.resolve?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onPoll).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('stops scheduling after stop() (terminal / unmount cleanup)', async () => {
    const onPoll = vi.fn(async () => undefined);
    const scheduler = createDevelopmentPollScheduler({
      intervalMs: 3000,
      onPoll,
    });

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(onPoll).not.toHaveBeenCalled();
  });
});
