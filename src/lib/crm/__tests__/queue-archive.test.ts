import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_EVENT_FEED, buildActivityFeed } from '@/lib/crm/activity-feed';
import { isCrmOperatorEmail } from '@/lib/crm/access';
import {
  buildQueueItem,
  computeQueueMetrics,
  CRM_QUEUE_KANBAN_ROW_CLASS,
  excludeArchivedQueueContacts,
  isQueueItemArchivable,
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
  it('allows archive button columns for operator-facing cards', () => {
    const needsOperator = buildQueueItem(baseContact);
    expect(isQueueItemArchivable(needsOperator)).toBe(true);

    const newLead = buildQueueItem({ ...baseContact, status: 'new_lead', onboarding: null });
    expect(isQueueItemArchivable(newLead)).toBe(true);

    const missingData = buildQueueItem({
      ...baseContact,
      onboarding: { ...baseContact.onboarding!, status: 'missing_required_data' },
    });
    expect(isQueueItemArchivable(missingData)).toBe(false);
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

  it('does not stretch kanban columns with artificial min-height', () => {
    expect(CRM_QUEUE_KANBAN_ROW_CLASS).toContain('items-start');
    expect(CRM_QUEUE_KANBAN_ROW_CLASS).not.toMatch(/min-h/);
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

  it('archives contact for operator and records activity event', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'operator@asi-global.ru');

    const auth = await import('@/lib/auth');
    vi.mocked(auth.getSession).mockResolvedValueOnce({
      userId: 'user-1',
      email: 'operator@asi-global.ru',
    } as never);
    getCrmContactById.mockResolvedValueOnce(baseContact);
    archiveCrmContactFromQueue.mockResolvedValueOnce({ ...baseContact, crmArchived: true });

    const mod = await import('@/app/api/dashboard/crm/queue/archive/route');
    const res = await mod.POST(
      new Request('http://localhost/api/dashboard/crm/queue/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: 'c-archive' }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(archiveCrmContactFromQueue).toHaveBeenCalledWith('c-archive', 'operator@asi-global.ru');
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
