import { describe, expect, it } from 'vitest';
import { isTerminalPilotConsoleStatus, normalizePilotConsoleStatus } from '../status';

describe('SP-04 normalizePilotConsoleStatus', () => {
  it('maps Bridge statuses to stable Pilot Console statuses', () => {
    expect(normalizePilotConsoleStatus('queued')).toBe('queued');
    expect(normalizePilotConsoleStatus('running')).toBe('running');
    expect(normalizePilotConsoleStatus('awaiting_owner')).toBe('blocked');
    expect(normalizePilotConsoleStatus('completed')).toBe('succeeded');
    expect(normalizePilotConsoleStatus('failed')).toBe('failed');
  });

  it('keeps HITL blocked tasks non-terminal so the same task can continue', () => {
    expect(isTerminalPilotConsoleStatus('blocked')).toBe(false);
    expect(isTerminalPilotConsoleStatus('queued')).toBe(false);
    expect(isTerminalPilotConsoleStatus('running')).toBe(false);
    expect(isTerminalPilotConsoleStatus('succeeded')).toBe(true);
    expect(isTerminalPilotConsoleStatus('failed')).toBe(true);
  });
});
