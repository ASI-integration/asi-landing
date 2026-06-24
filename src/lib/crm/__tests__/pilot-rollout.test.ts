import { describe, expect, it } from 'vitest';
import type { CrmContact } from '../types';
import {
  checkActivePilotLimit,
  computePilotRolloutMetrics,
  getPilotActiveLimit,
  pilotRolloutStatusLabel,
  resolvePilotRolloutStatus,
  validatePilotStatusChange,
} from '../pilot-rollout';

function contact(overrides: Partial<CrmContact> & Pick<CrmContact, 'id'>): CrmContact {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Тест',
    phone: '',
    telegramUsername: '',
    email: null,
    role: 'owner',
    source: 'form',
    objectsCount: 1,
    city: '',
    note: '',
    status: overrides.status ?? 'new',
    communicationStatus: overrides.communicationStatus ?? 'no_contact',
    lastContactAt: null,
    nextStep: '',
    nextActionAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    crmArchived: overrides.crmArchived,
    onboarding: overrides.onboarding ?? null,
  };
}

describe('pilot rollout gate', () => {
  it('maps legacy CRM statuses to pilot rollout labels', () => {
    expect(resolvePilotRolloutStatus('new_lead')).toBe('new');
    expect(resolvePilotRolloutStatus('pilot_waitlist')).toBe('waitlist');
    expect(resolvePilotRolloutStatus('object_setup')).toBe('onboarding');
    expect(resolvePilotRolloutStatus('pilot_active')).toBe('active_pilot');
    expect(pilotRolloutStatusLabel('pilot_waitlist')).toBe('Лист ожидания');
  });

  it('uses PILOT_ACTIVE_LIMIT with fallback 4', () => {
    const previous = process.env.PILOT_ACTIVE_LIMIT;
    delete process.env.PILOT_ACTIVE_LIMIT;
    expect(getPilotActiveLimit()).toBe(4);
    process.env.PILOT_ACTIVE_LIMIT = '2';
    expect(getPilotActiveLimit()).toBe(2);
    if (previous === undefined) delete process.env.PILOT_ACTIVE_LIMIT;
    else process.env.PILOT_ACTIVE_LIMIT = previous;
  });

  it('blocks active_pilot when limit is reached', () => {
    const contacts = [
      contact({ id: '1', status: 'active_pilot' }),
      contact({ id: '2', status: 'pilot' }),
      contact({ id: '3', status: 'pilot' }),
      contact({ id: '4', status: 'active_pilot' }),
      contact({ id: '5', status: 'waitlist' }),
    ];

    const check = checkActivePilotLimit(contacts, { targetContactId: '5', nextStatus: 'active_pilot' });
    expect(check.allowed).toBe(false);
    expect(check.activeCount).toBe(4);
    expect(validatePilotStatusChange(contacts, '5', 'active_pilot')).toContain('Лимит пилота заполнен');
  });

  it('allows active_pilot when replacing an existing active pilot', () => {
    const contacts = [
      contact({ id: '1', status: 'active_pilot' }),
      contact({ id: '2', status: 'active_pilot' }),
      contact({ id: '3', status: 'active_pilot' }),
      contact({ id: '4', status: 'active_pilot' }),
    ];

    const check = checkActivePilotLimit(contacts, { targetContactId: '1', nextStatus: 'active_pilot' });
    expect(check.allowed).toBe(true);
  });

  it('computes dashboard pilot metrics', () => {
    const metrics = computePilotRolloutMetrics([
      contact({ id: '1', status: 'active_pilot' }),
      contact({ id: '2', status: 'waitlist' }),
      contact({ id: '3', status: 'object_setup' }),
      contact({ id: '4', status: 'new', communicationStatus: 'needs_manual_reaction' }),
      contact({ id: '5', status: 'paused', crmArchived: true }),
    ]);

    expect(metrics).toMatchObject({
      activePilots: 1,
      waitlist: 1,
      onboarding: 1,
      needsAttention: 1,
    });
  });
});
