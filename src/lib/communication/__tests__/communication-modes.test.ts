import { describe, expect, it } from 'vitest';
import {
  canSendAutonomousGuestReply,
  getEffectiveCommunicationMode,
  isCommunicationKillSwitchActive,
  normalizeCommunicationMode,
} from '@/lib/communication/communication-autopilot-settings';

describe('communication modes', () => {
  it('normalizes legacy enabled/disabled values', () => {
    expect(normalizeCommunicationMode('enabled')).toBe('autopilot');
    expect(normalizeCommunicationMode('disabled')).toBe('off');
    expect(normalizeCommunicationMode('manual')).toBe('manual');
  });

  it('blocks autonomous replies when kill switch is active', () => {
    const prev = process.env.COMMUNICATION_KILL_SWITCH;
    process.env.COMMUNICATION_KILL_SWITCH = '1';
    try {
      expect(isCommunicationKillSwitchActive()).toBe(true);
      expect(getEffectiveCommunicationMode({ communication_autopilot: 'enabled' })).toBe('off');
      expect(canSendAutonomousGuestReply({ communication_autopilot: 'enabled' })).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.COMMUNICATION_KILL_SWITCH;
      else process.env.COMMUNICATION_KILL_SWITCH = prev;
    }
  });

  it('allows autonomous replies only in autopilot mode', () => {
    const prev = process.env.COMMUNICATION_KILL_SWITCH;
    delete process.env.COMMUNICATION_KILL_SWITCH;
    try {
      expect(canSendAutonomousGuestReply({ communication_autopilot: 'enabled' })).toBe(true);
      expect(canSendAutonomousGuestReply({ communication_autopilot: 'manual' })).toBe(false);
      expect(canSendAutonomousGuestReply({ communication_autopilot: 'disabled' })).toBe(false);
    } finally {
      if (prev !== undefined) process.env.COMMUNICATION_KILL_SWITCH = prev;
    }
  });
});
