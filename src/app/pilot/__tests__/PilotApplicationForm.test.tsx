import { describe, expect, it } from 'vitest';
import { PILOT_PLATFORM_OPTIONS } from '@/lib/crm/pilot-options';
import {
  normalizePropertyCountInput,
  parsePilotApplicationDraft,
  selectAllPilotPlatforms,
} from '../PilotApplicationForm';

describe('pilot application property count input', () => {
  it('removes leading zeroes without changing normal values', () => {
    expect(normalizePropertyCountInput('1')).toBe('1');
    expect(normalizePropertyCountInput('2')).toBe('2');
    expect(normalizePropertyCountInput('02')).toBe('2');
    expect(normalizePropertyCountInput('4')).toBe('4');
    expect(normalizePropertyCountInput('10')).toBe('10');
  });
});

describe('pilot application form draft state', () => {
  it('restores only pilot form fields from saved browser state', () => {
    const draft = parsePilotApplicationDraft(JSON.stringify({
      name: 'Анна',
      telegramContact: '@anna_host',
      role: 'manager',
      city: 'Казань',
      propertyCount: '02',
      channelManager: 'bnovo',
      selectedPlatforms: ['avito', 'ostrovok', 'unknown'],
      hasActiveBookings: 'soon',
      testFocus: 'channels',
      feedbackReady: 'unsure',
      secretToken: 'must-not-be-used',
    }));

    expect(draft).toEqual({
      name: 'Анна',
      telegramContact: '@anna_host',
      role: 'manager',
      city: 'Казань',
      propertyCount: '2',
      channelManager: 'bnovo',
      selectedPlatforms: ['avito', 'ostrovok'],
      hasActiveBookings: 'soon',
      testFocus: 'channels',
      feedbackReady: 'unsure',
    });
  });

  it('falls back to safe defaults when saved browser state is broken', () => {
    expect(parsePilotApplicationDraft('{broken')).toMatchObject({
      name: '',
      telegramContact: '',
      role: 'owner',
      city: '',
      propertyCount: '1',
      selectedPlatforms: [],
    });
  });

  it('selects every configured pilot platform in one action', () => {
    expect(selectAllPilotPlatforms()).toEqual([...PILOT_PLATFORM_OPTIONS]);
  });
});
