import { describe, expect, it } from 'vitest';
import { buildOperatorInbox, buildQueueItem, isOperatorInboxItem } from '../queue';
import type { CrmContact } from '../types';

function guestContact(overrides: Partial<CrmContact> = {}): CrmContact {
  return {
    id: 'contact-1',
    name: 'Гость',
    phone: '',
    telegramUsername: 'guest1',
    email: null,
    role: 'unknown',
    source: 'telegram',
    objectsCount: 0,
    city: '',
    note: '',
    status: 'ready_for_test',
    communicationStatus: 'needs_manual_reaction',
    lastContactAt: '2026-06-21T10:00:00.000Z',
    nextStep: '',
    nextActionAt: null,
    createdAt: '2026-06-21T09:00:00.000Z',
    updatedAt: '2026-06-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('operator inbox filtering', () => {
  it('shows guest escalations but hides owner onboarding columns', () => {
    const escalation = buildQueueItem(
      guestContact({ communicationStatus: 'needs_manual_reaction' }),
    );
    const onboarding = buildQueueItem(
      guestContact({
        status: 'waiting_object_data',
        communicationStatus: 'waiting_reply',
        onboarding: {
          status: 'missing_required_data',
          statusLabel: 'Не хватает данных',
          missing: ['wifi'],
          lastMessage: '',
          channelManagerHref: null,
          readinessPercent: null,
          readinessStatusLabel: null,
          nextBestStep: null,
          missingOptional: [],
        },
      }),
    );

    expect(isOperatorInboxItem(escalation)).toBe(true);
    expect(isOperatorInboxItem(onboarding)).toBe(false);
    expect(buildOperatorInbox([escalation, onboarding])).toEqual([escalation]);
  });
});
