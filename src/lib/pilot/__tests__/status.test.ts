import { describe, expect, it } from 'vitest';
import { normalizePilotConsoleStatus } from '../status';

describe('SP-04 normalizePilotConsoleStatus', () => {
  it('maps Bridge statuses to stable Pilot Console statuses', () => {
    expect(normalizePilotConsoleStatus('queued')).toBe('queued');
    expect(normalizePilotConsoleStatus('running')).toBe('running');
    expect(normalizePilotConsoleStatus('awaiting_owner')).toBe('blocked');
    expect(normalizePilotConsoleStatus('completed')).toBe('succeeded');
    expect(normalizePilotConsoleStatus('failed')).toBe('failed');
  });
});
