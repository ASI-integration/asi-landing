import { describe, expect, it } from 'vitest';
import type { CrmContact, CrmOnboardingStatus } from '../types';
import {
  buildActivityFeed,
  buildCardActivities,
  CRM_ACTIVITY_FEED_LIMIT,
  CRM_CARD_ACTIVITY_LIMIT,
  formatFeedLine,
  resolveOperationalStatus,
} from '../activity-feed';
import type { CrmEventRow } from '../queue-events';
import { buildQueueItem } from '../queue';

const baseContact: CrmContact = {
  id: 'c-1',
  name: 'Тест Владелец',
  phone: '+7 900 000-00-00',
  telegramUsername: 'test_owner',
  email: null,
  role: 'owner',
  source: 'telegram',
  objectsCount: 1,
  city: 'Москва',
  note: '',
  status: 'contact',
  communicationStatus: 'waiting_reply',
  lastContactAt: '2026-06-19T10:00:00.000Z',
  nextStep: '',
  nextActionAt: null,
  createdAt: '2026-06-18T10:00:00.000Z',
  updatedAt: '2026-06-19T10:00:00.000Z',
};

function withOnboarding(status: CrmOnboardingStatus, missing: string[] = []): CrmContact {
  return {
    ...baseContact,
    onboarding: {
      status,
      statusLabel: status,
      missing,
      lastMessage: 'тест',
      channelManagerHref: '/dashboard/channel-connections',
    },
  };
}

describe('crm activity feed', () => {
  it('maps crm events and onboarding to russian feed lines sorted newest first', () => {
    const contacts = [
      withOnboarding('missing_required_data', ['wifi', 'адрес объекта']),
      withOnboarding('ready_for_channel_manager', []),
    ];
    contacts[0] = { ...contacts[0], id: 'c-old', updatedAt: '2026-06-19T09:00:00.000Z' };
    contacts[1] = { ...contacts[1], id: 'c-new', updatedAt: '2026-06-19T10:00:00.000Z' };

    const events: CrmEventRow[] = [
      {
        id: 'e-1',
        contact_id: 'c-new',
        event_type: 'status_change',
        message_text: null,
        metadata: {},
        created_at: '2026-06-19T10:05:00.000Z',
      },
      {
        id: 'e-2',
        contact_id: 'c-old',
        event_type: 'missing_data',
        message_text: null,
        metadata: { missing_fields: ['wifi'] },
        created_at: '2026-06-19T09:30:00.000Z',
      },
    ];

    const feed = buildActivityFeed(contacts, events, 20);
    expect(feed.length).toBeGreaterThan(0);
    expect(feed[0]?.createdAt).toBe('2026-06-19T10:05:00.000Z');
    expect(feed.some((entry) => entry.label.includes('статус подключения'))).toBe(true);
    expect(feed.some((entry) => entry.label.includes('Wi-Fi'))).toBe(true);
    expect(feed.some((entry) => entry.label.includes('Менеджеру каналов'))).toBe(true);
    expect(feed.some((entry) => entry.label.includes('onboarding_started'))).toBe(false);
  });

  it('limits feed and card activities', () => {
    const contacts = Array.from({ length: 10 }, (_, index) =>
      withOnboarding('onboarding_started', index % 2 === 0 ? ['wifi'] : [])
    ).map((contact, index) => ({ ...contact, id: `c-${index}` }));

    const feed = buildActivityFeed(contacts, [], CRM_ACTIVITY_FEED_LIMIT);
    expect(feed.length).toBeLessThanOrEqual(CRM_ACTIVITY_FEED_LIMIT);

    const cardActivities = buildCardActivities(withOnboarding('onboarding_started', ['photos']), [], CRM_CARD_ACTIVITY_LIMIT);
    expect(cardActivities.length).toBeLessThanOrEqual(CRM_CARD_ACTIVITY_LIMIT);
    expect(cardActivities.some((item) => item.label.includes('Wi-Fi') || item.label.includes('фото'))).toBe(true);
  });

  it('resolves operational status for cards', () => {
    const ready = buildQueueItem(withOnboarding('ready_for_channel_manager'));
    expect(ready.operationalStatus).toBe('ready');
    expect(ready.operationalStatusLabel).toBe('Готово');

    const attention = buildQueueItem(withOnboarding('needs_operator'));
    expect(attention.operationalStatus).toBe('needs_attention');

    const waiting = resolveOperationalStatus(
      { ...baseContact, communicationStatus: 'waiting_reply' },
      { needsOperator: false, readyForChannelManager: false, column: 'onboarding' }
    );
    expect(waiting).toBe('waiting_owner');
  });

  it('formats feed line for demo display', () => {
    const line = formatFeedLine({
      id: 'x',
      actor: 'ASI',
      label: 'сохранила адрес объекта',
      tone: 'done',
      createdAt: '2026-06-19T14:36:00.000Z',
      objectTitle: 'Объект в Москва',
      contactId: 'c-1',
    });
    expect(line).toMatch(/ASI сохранила адрес объекта/);
    expect(line).not.toMatch(/onboarding_started/);
  });
});
