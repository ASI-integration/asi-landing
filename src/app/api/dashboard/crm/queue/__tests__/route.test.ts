import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  isSessionSecretConfigured: vi.fn(() => true),
  getSession: vi.fn(async () => ({ userId: 'user-1', email: 'owner@example.com' })),
}));

const listCrmContacts = vi.fn();
const listCrmEventsByContactIds = vi.fn();
const listRecentCrmEventsForFeed = vi.fn();
const loadCrmBookingSignalsForQueue = vi.fn();
const summarizeOpenOpsTasksByContactIds = vi.fn();

vi.mock('@/lib/crm/repository', () => ({
  listCrmContacts,
}));

vi.mock('@/lib/crm/booking-signals', () => ({
  loadCrmBookingSignalsForQueue,
}));

vi.mock('@/lib/crm/queue-events', () => ({
  listCrmEventsByContactIds,
  listRecentCrmEventsForFeed,
}));

vi.mock('@/lib/ops-board/repository', () => ({
  summarizeOpenOpsTasksByContactIds,
}));

beforeEach(() => {
  vi.resetModules();
  listCrmContacts.mockReset();
  listCrmEventsByContactIds.mockReset();
  listRecentCrmEventsForFeed.mockReset();
  loadCrmBookingSignalsForQueue.mockReset();
  summarizeOpenOpsTasksByContactIds.mockReset();
  summarizeOpenOpsTasksByContactIds.mockResolvedValue({});
  loadCrmBookingSignalsForQueue.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/api/dashboard/crm/queue', () => {
  it('returns queue payload with metrics and operator inbox', async () => {
    listCrmContacts.mockResolvedValueOnce([
      {
        id: 'c-1',
        name: 'Ольга',
        phone: '+7 900 000-00-01',
        telegramUsername: 'olga_ops',
        email: null,
        role: 'owner',
        source: 'telegram',
        objectsCount: 1,
        city: 'Сочи',
        note: [
          'Онбординг ASI',
          'Статус: needs_operator',
          'Не хватает: фото',
          'Последнее сообщение: нужен оператор',
          'Менеджер каналов: /dashboard/channel-connections',
        ].join('\n'),
        status: 'contact',
        communicationStatus: 'needs_manual_reaction',
        lastContactAt: '2026-06-19T09:15:00.000Z',
        nextStep: 'Ответить',
        nextActionAt: null,
        createdAt: '2026-06-17T11:00:00.000Z',
        updatedAt: '2026-06-19T09:15:00.000Z',
        onboarding: {
          status: 'needs_operator',
          statusLabel: 'needs_operator',
          missing: ['photos'],
          lastMessage: 'нужен оператор',
          channelManagerHref: '/dashboard/channel-connections',
          readinessPercent: null,
          readinessStatusLabel: null,
          nextBestStep: null,
          missingOptional: [],
        },
      },
    ]);
    listCrmEventsByContactIds.mockResolvedValueOnce({
      'c-1': [
        {
          id: 'e-1',
          author: 'Владелец',
          text: 'нужен оператор',
          createdAt: '2026-06-19T09:15:00.000Z',
        },
      ],
    });
    listRecentCrmEventsForFeed.mockResolvedValueOnce([
      {
        id: 'e-2',
        contact_id: 'c-1',
        event_type: 'operator_followup_required',
        message_text: 'нужен оператор',
        metadata: {},
        created_at: '2026-06-19T09:15:00.000Z',
      },
    ]);

    const mod = await import('../route');
    const res = await mod.GET(new Request('http://localhost/api/dashboard/crm/queue?filter=needs_operator'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.filter).toBe('needs_operator');
    expect(body.metrics.needsAttention).toBe(1);
    expect(body.operatorInbox).toHaveLength(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].needsOperator).toBe(true);
    expect(body.items[0].messages).toHaveLength(1);
    expect(body.items[0].operationalStatus).toBe('needs_attention');
    expect(body.items[0].recentActivities.length).toBeGreaterThan(0);
    expect(body.activityFeed.length).toBeGreaterThan(0);
    expect(body.bookingSignals).toEqual([]);
    expect(body.refreshedAt).toBeTruthy();
    expect(loadCrmBookingSignalsForQueue).toHaveBeenCalledTimes(1);
  });
});
