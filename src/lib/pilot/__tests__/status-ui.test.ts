import { describe, expect, it } from 'vitest';
import {
  PILOT_CONSOLE_STATUS_LABELS,
  pilotConsoleStatusLabel,
  pilotConsoleStatusTone,
} from '../status-ui';

describe('SP-05 pilot status-ui', () => {
  it('maps every consoleStatus to a stable label and tone', () => {
    expect(pilotConsoleStatusLabel('queued')).toBe(PILOT_CONSOLE_STATUS_LABELS.queued);
    expect(pilotConsoleStatusLabel('running')).toBe(PILOT_CONSOLE_STATUS_LABELS.running);
    expect(pilotConsoleStatusLabel('blocked')).toBe(PILOT_CONSOLE_STATUS_LABELS.blocked);
    expect(pilotConsoleStatusLabel('succeeded')).toBe(PILOT_CONSOLE_STATUS_LABELS.succeeded);
    expect(pilotConsoleStatusLabel('failed')).toBe(PILOT_CONSOLE_STATUS_LABELS.failed);

    expect(pilotConsoleStatusTone('queued')).toBe('neutral');
    expect(pilotConsoleStatusTone('running')).toBe('active');
    expect(pilotConsoleStatusTone('blocked')).toBe('attention');
    expect(pilotConsoleStatusTone('succeeded')).toBe('success');
    expect(pilotConsoleStatusTone('failed')).toBe('danger');
  });
});
