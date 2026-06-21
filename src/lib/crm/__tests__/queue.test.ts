import { describe, expect, it } from 'vitest';
import type { CrmContact, CrmOnboardingStatus } from '../types';
import {
  buildOperatorInbox,
  buildQueueItem,
  computeQueueMetrics,
  filterQueueItems,
  groupQueueByColumn,
  resolveQueueColumn,
} from '../queue';

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

function withOnboarding(
  status: CrmOnboardingStatus,
  missing: string[] = [],
  readiness?: Partial<{
    readinessPercent: number;
    readinessStatusLabel: string;
    nextBestStep: string;
  }>,
): CrmContact {
  return {
    ...baseContact,
    note: [
      'Онбординг ASI',
      `Статус: ${status}`,
      readiness?.readinessPercent != null ? `Готовность: ${readiness.readinessPercent}%` : null,
      readiness?.readinessStatusLabel ? `Статус готовности: ${readiness.readinessStatusLabel}` : null,
      `Не хватает: ${missing.length ? missing.join(', ') : 'ничего'}`,
      readiness?.nextBestStep ? `Следующий шаг: ${readiness.nextBestStep}` : null,
      'Последнее сообщение: тест',
      'Менеджер каналов: /dashboard/channel-connections',
    ]
      .filter(Boolean)
      .join('\n'),
    onboarding: {
      status,
      statusLabel: status,
      missing,
      lastMessage: 'тест',
      channelManagerHref: '/dashboard/channel-connections',
      readinessPercent: readiness?.readinessPercent ?? null,
      readinessStatusLabel: readiness?.readinessStatusLabel ?? null,
      nextBestStep: readiness?.nextBestStep ?? null,
      missingOptional: [],
    },
  };
}

describe('crm queue', () => {
  it('maps onboarding statuses to queue columns', () => {
    expect(resolveQueueColumn({ ...baseContact, status: 'new_lead' })).toBe('new_lead');
    expect(resolveQueueColumn(withOnboarding('onboarding_started'))).toBe('onboarding');
    expect(resolveQueueColumn(withOnboarding('missing_required_data', ['wifi']))).toBe('missing_data');
    expect(resolveQueueColumn(withOnboarding('ready_for_channel_manager'))).toBe('ready_for_cm');
    expect(resolveQueueColumn(withOnboarding('needs_operator'))).toBe('needs_operator');
    expect(resolveQueueColumn({ ...baseContact, status: 'pilot' })).toBe('completed');
  });

  it('builds queue cards with russian labels and flags', () => {
    const item = buildQueueItem(
      withOnboarding('ready_for_channel_manager', [], {
        readinessPercent: 100,
        readinessStatusLabel: 'Готов к Менеджеру каналов',
        nextBestStep: 'Открыть Менеджер каналов',
      }),
    );
    expect(item.objectTitle).toBe('Объект в Москва');
    expect(item.onboardingStatusLabel).toBe('Готов к Менеджеру каналов');
    expect(item.readyForChannelManager).toBe(true);
    expect(item.needsOperator).toBe(false);
    expect(item.channelManagerStatus).toBe('Готов к подключению');
    expect(item.readinessPercent).toBe(100);
    expect(item.nextBestStep).toBe('Открыть Менеджер каналов');
  });

  it('filters queue items', () => {
    const items = [
      buildQueueItem(withOnboarding('needs_operator')),
      buildQueueItem(withOnboarding('ready_for_channel_manager')),
      buildQueueItem({ ...baseContact, status: 'pilot' }),
    ];

    expect(filterQueueItems(items, 'needs_operator')).toHaveLength(1);
    expect(filterQueueItems(items, 'ready_for_cm')).toHaveLength(1);
    expect(filterQueueItems(items, 'completed')).toHaveLength(1);
    expect(filterQueueItems(items, 'active')).toHaveLength(2);
  });

  it('groups items by column and builds operator inbox', () => {
    const items = [
      buildQueueItem({
        ...withOnboarding('needs_operator'),
        lastContactAt: '2026-06-19T09:00:00.000Z',
      }),
      buildQueueItem({
        ...withOnboarding('needs_operator'),
        id: 'c-2',
        lastContactAt: '2026-06-19T11:00:00.000Z',
      }),
      buildQueueItem(withOnboarding('onboarding_started')),
    ];

    const grouped = groupQueueByColumn(items);
    expect(grouped.needs_operator).toHaveLength(2);
    expect(grouped.onboarding).toHaveLength(1);

    const inbox = buildOperatorInbox(items);
    expect(inbox).toHaveLength(2);
    expect(inbox[0]?.id).toBe('c-2');
  });

  it('computes dashboard metrics', () => {
    const items = [
      buildQueueItem(withOnboarding('onboarding_started')),
      buildQueueItem(withOnboarding('missing_required_data', ['wifi'])),
      buildQueueItem(withOnboarding('ready_for_channel_manager')),
      buildQueueItem(withOnboarding('needs_operator')),
      buildQueueItem({ ...baseContact, status: 'pilot' }),
    ];

    expect(computeQueueMetrics(items)).toEqual({
      activeObjects: 4,
      onboarding: 2,
      readyForChannelManager: 1,
      needsAttention: 1,
      completed: 1,
    });
  });
});
