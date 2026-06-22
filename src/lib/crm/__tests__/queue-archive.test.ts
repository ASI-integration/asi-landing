import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_EVENT_FEED, buildActivityFeed } from '@/lib/crm/activity-feed';
import { isCrmOperatorEmail } from '@/lib/crm/access';
import {
  applyArchivedContactToQueueState,
  buildQueueItem,
  collectQueueItemsForArchive,
  computeQueueMetrics,
  CRM_QUEUE_KANBAN_COLUMN_CLASS,
  CRM_QUEUE_KANBAN_ROW_CLASS,
  excludeArchivedQueueContacts,
  isQueueItemArchivable,
  isQueueTestGuestContact,
  resolveQueueColumn,
  resolveVisibleKanbanColumns,
} from '@/lib/crm/queue';
import type { CrmContact } from '@/lib/crm/types';

vi.mock('@/lib/auth', () => ({
  isSessionSecretConfigured: vi.fn(() => true),
  getSession: vi.fn(async () => ({ userId: 'user-1', email: 'operator@asi-global.ru' })),
}));

const archiveCrmContactFromQueue = vi.fn();
const getCrmContactById = vi.fn();
const recordEventInsert = vi.fn();

vi.mock('@/lib/crm/repository', () => ({
  archiveCrmContactFromQueue,
  getCrmContactById,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: unknown) => {
        if (table === 'crm_events') recordEventInsert(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

const baseContact: CrmContact = {
  id: 'c-archive',
  name: 'Тест',
  phone: '+7 900 000-00-11',
  telegramUsername: 'test_archive',
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
};

beforeEach(() => {
  vi.resetModules();
  archiveCrmContactFromQueue.mockReset();
  getCrmContactById.mockReset();
  recordEventInsert.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('crm queue archive', () => {
  it('allows archive for all active queue columns except completed', () => {
    const needsOperator = buildQueueItem(baseContact);
    expect(isQueueItemArchivable(needsOperator)).toBe(true);

    const newLead = buildQueueItem({ ...baseContact, status: 'new_lead', onboarding: null });
    expect(isQueueItemArchivable(newLead)).toBe(true);

    const missingData = buildQueueItem({
      ...baseContact,
      onboarding: { ...baseContact.onboarding!, status: 'missing_required_data' },
    });
    expect(isQueueItemArchivable(missingData)).toBe(true);

    const readyForCm = buildQueueItem({
      ...baseContact,
      onboarding: { ...baseContact.onboarding!, status: 'ready_for_channel_manager' },
    });
    expect(isQueueItemArchivable(readyForCm)).toBe(true);

    const completed = buildQueueItem({
      ...baseContact,
      status: 'pilot',
      communicationStatus: 'replied',
      onboarding: null,
    });
    expect(completed.column).toBe('completed');
    expect(isQueueItemArchivable(completed)).toBe(false);
  });

  it('keeps telegram guest_autopilot cards in active queue and archivable', () => {
    const guestContact: CrmContact = {
      ...baseContact,
      id: 'c-guest',
      name: 'Telegram guest',
      status: 'ready_for_test',
      communicationStatus: 'replied',
      note: 'guest_autopilot property_id=prop_A',
      onboarding: null,
    };
    expect(isQueueTestGuestContact(guestContact)).toBe(true);
    expect(resolveQueueColumn(guestContact)).toBe('onboarding');
    const guestItem = buildQueueItem(guestContact);
    expect(guestItem.column).toBe('onboarding');
    expect(guestItem.isTestGuest).toBe(true);
    expect(isQueueItemArchivable(guestItem)).toBe(true);
  });

  it('detects telegram guest_test cards without flagging owners', () => {
    expect(
      isQueueTestGuestContact({
        name: 'Telegram guest',
        note: 'guest_test property_id=OBJ-123',
      }),
    ).toBe(true);
    expect(
      isQueueTestGuestContact({
        name: 'Telegram guest',
        note: 'guest_autopilot property_id=prop_A',
      }),
    ).toBe(true);
    expect(
      isQueueTestGuestContact({
        name: 'Анна',
        note: 'Онбординг ASI',
      }),
    ).toBe(false);
    expect(buildQueueItem({ ...baseContact, name: 'Telegram guest', note: 'guest_test' }).isTestGuest).toBe(
      true,
    );
  });

  it('excludes archived contacts from active queue metrics', () => {
    const active = buildQueueItem(baseContact);
    const archivedContact = { ...baseContact, id: 'c-archived', crmArchived: true };
    const visible = excludeArchivedQueueContacts([baseContact, archivedContact]).map((contact) =>
      buildQueueItem(contact),
    );
    const metrics = computeQueueMetrics(visible);
    expect(visible).toHaveLength(1);
    expect(metrics.needsAttention).toBe(1);
    expect(metrics.activeObjects).toBe(1);
  });

  it('collects unique queue cards from inbox and filtered items for bulk archive', () => {
    const inboxItem = buildQueueItem({ ...baseContact, id: 'c-inbox' });
    const kanbanItem = buildQueueItem({ ...baseContact, id: 'c-kanban' });
    const duplicate = buildQueueItem({ ...baseContact, id: 'c-inbox' });
    const collected = collectQueueItemsForArchive({
      operatorInbox: [inboxItem, duplicate],
      items: [kanbanItem],
    });
    expect(collected.map((item) => item.id).sort()).toEqual(['c-inbox', 'c-kanban']);
  });

  it('maps archive event to operator activity feed copy', () => {
    expect(CRM_EVENT_FEED.crm_queue_archived).toEqual({
      actor: 'Оператор',
      label: 'скрыл объект из очереди CRM',
      tone: 'processing',
    });

    const feed = buildActivityFeed([baseContact], [
      {
        id: 'evt-1',
        contact_id: 'c-archive',
        event_type: 'crm_queue_archived',
        message_text: 'Оператор скрыл объект из очереди CRM',
        metadata: { operator_email: 'operator@asi-global.ru' },
        created_at: '2026-06-19T10:00:00.000Z',
      },
    ]);
    const archivedEntry = feed.find((entry) => entry.id === 'evt-1');
    expect(archivedEntry?.actor).toBe('Оператор');
    expect(archivedEntry?.label).toBe('скрыл объект из очереди CRM');
  });

  it('removes archived cards from inbox, columns and metrics optimistically', () => {
    const inboxItem = buildQueueItem({ ...baseContact, id: 'c-inbox' });
    const kanbanItem = buildQueueItem({
      ...baseContact,
      id: 'c-kanban',
      onboarding: { ...baseContact.onboarding!, status: 'onboarding_started' },
    });
    const columns = {
      new_lead: [],
      onboarding: [kanbanItem],
      missing_data: [],
      ready_for_cm: [],
      needs_operator: [inboxItem],
      completed: [],
    };
    const next = applyArchivedContactToQueueState(
      {
        items: [inboxItem, kanbanItem],
        operatorInbox: [inboxItem],
        columns,
        metrics: computeQueueMetrics([inboxItem, kanbanItem]),
      },
      'c-inbox',
      'all',
    );
    expect(next.operatorInbox).toHaveLength(0);
    expect(next.items.map((item) => item.id)).toEqual(['c-kanban']);
    expect(next.columns.needs_operator).toHaveLength(0);
    expect(next.metrics.needsAttention).toBe(0);
  });

  it('hides empty kanban columns for all/active filters', () => {
    const item = buildQueueItem(baseContact);
    const columns = {
      new_lead: [],
      onboarding: [item],
      missing_data: [],
      ready_for_cm: [],
      needs_operator: [],
      completed: [],
    };
    expect(resolveVisibleKanbanColumns(columns, 'all')).toEqual(['onboarding']);
    expect(resolveVisibleKanbanColumns(columns, 'active')).toEqual(['onboarding']);
    expect(resolveVisibleKanbanColumns(columns, 'needs_operator')).toEqual(['needs_operator']);
  });

  it('does not stretch kanban columns with artificial min-height', () => {
    expect(CRM_QUEUE_KANBAN_ROW_CLASS).toContain('items-start');
    expect(CRM_QUEUE_KANBAN_ROW_CLASS).toContain('content-start');
    expect(CRM_QUEUE_KANBAN_ROW_CLASS).not.toMatch(/min-h/);
    expect(CRM_QUEUE_KANBAN_COLUMN_CLASS).toContain('self-start');
    expect(CRM_QUEUE_KANBAN_COLUMN_CLASS).not.toMatch(/min-h/);
  });

  it('blocks archive API for non-operator session', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'operator@asi-global.ru');

    const auth = await import('@/lib/auth');
    vi.mocked(auth.getSession).mockResolvedValueOnce({
      userId: 'user-2',
      email: 'owner@gmail.com',
    } as never);

    const mod = await import('@/app/api/dashboard/crm/queue/archive/route');
    const res = await mod.POST(
      new Request('http://localhost/api/dashboard/crm/queue/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: 'c-archive' }),
      }),
    );

    expect(res.status).toBe(403);
    expect(archiveCrmContactFromQueue).not.toHaveBeenCalled();
  });

  it('archives telegram guest card for operator', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'operator@asi-global.ru');

    const auth = await import('@/lib/auth');
    vi.mocked(auth.getSession).mockResolvedValueOnce({
      userId: 'user-1',
      email: 'operator@asi-global.ru',
    } as never);

    const guestContact: CrmContact = {
      ...baseContact,
      id: 'c-guest-archive',
      name: 'Telegram guest',
      status: 'ready_for_test',
      communicationStatus: 'replied',
      note: 'guest_autopilot property_id=prop_A',
      onboarding: null,
    };
    getCrmContactById.mockResolvedValueOnce(guestContact);
    archiveCrmContactFromQueue.mockResolvedValueOnce({ ...guestContact, crmArchived: true });

    const mod = await import('@/app/api/dashboard/crm/queue/archive/route');
    const res = await mod.POST(
      new Request('http://localhost/api/dashboard/crm/queue/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: 'c-guest-archive' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(archiveCrmContactFromQueue).toHaveBeenCalledWith('c-guest-archive', 'operator@asi-global.ru');
  });

  it('archives contact and ready_for_cm cards for operator', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'operator@asi-global.ru');

    const auth = await import('@/lib/auth');
    vi.mocked(auth.getSession).mockResolvedValueOnce({
      userId: 'user-1',
      email: 'operator@asi-global.ru',
    } as never);

    const readyContact: CrmContact = {
      ...baseContact,
      id: 'c-ready',
      onboarding: { ...baseContact.onboarding!, status: 'ready_for_channel_manager' },
    };
    getCrmContactById.mockResolvedValueOnce(readyContact);
    archiveCrmContactFromQueue.mockResolvedValueOnce({ ...readyContact, crmArchived: true });

    const mod = await import('@/app/api/dashboard/crm/queue/archive/route');
    const res = await mod.POST(
      new Request('http://localhost/api/dashboard/crm/queue/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: 'c-ready' }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(archiveCrmContactFromQueue).toHaveBeenCalledWith('c-ready', 'operator@asi-global.ru');
    expect(recordEventInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'crm_queue_archived',
        message_text: 'Оператор скрыл объект из очереди CRM',
      }),
    );
  });

  it('treats internal operator emails as CRM operators in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', '');
    expect(isCrmOperatorEmail('operator@asi-global.ru')).toBe(true);
    expect(isCrmOperatorEmail('owner@gmail.com')).toBe(false);
  });
});
