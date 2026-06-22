/**
 * Focused auto OPS task sync tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCrmContacts: vi.fn(),
  listEscalationReviews: vi.fn(),
  createOpsOperatorTask: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('@/lib/crm/repository', () => ({
  listCrmContacts: mocks.listCrmContacts,
}));

vi.mock('@/lib/communication/operator-review', () => ({
  listEscalationReviews: mocks.listEscalationReviews,
}));

vi.mock('@/lib/ops-board/repository', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ops-board/repository')>('@/lib/ops-board/repository');
  return {
    ...actual,
    createOpsOperatorTask: mocks.createOpsOperatorTask,
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mocks.supabaseFrom(...args),
  },
}));

import { buildAutoOpsDedupKey } from '@/lib/ops-board/repository';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';

describe('ops v1 auto tasks', () => {
  const seenDedupKeys = new Set<string>();

  beforeEach(() => {
    mocks.listCrmContacts.mockReset();
    mocks.listEscalationReviews.mockReset();
    mocks.createOpsOperatorTask.mockReset();
    mocks.supabaseFrom.mockReset();
    mocks.supabaseFrom.mockImplementation(() => ({
      select: () => ({
        neq: () => ({
          limit: async () => ({ data: [], error: null }),
        }),
      }),
    }));
    seenDedupKeys.clear();
    mocks.createOpsOperatorTask.mockImplementation(async (input: { dedupKey?: string | null }) => {
      const dedupKey = String(input.dedupKey ?? '');
      if (seenDedupKeys.has(dedupKey)) {
        return { ok: true, created: false, task: { id: 'task-1' } };
      }
      seenDedupKeys.add(dedupKey);
      return { ok: true, created: true, task: { id: 'task-1' } };
    });
    mocks.listEscalationReviews.mockReturnValue([]);
  });

  it('builds stable dedupe keys for auto tasks', () => {
    const key = buildAutoOpsDedupKey({
      source: 'crm',
      sourceId: 'contact-1',
      taskType: 'other',
    });
    expect(key).toBe('auto:crm:contact-1:other');
    expect(
      buildAutoOpsDedupKey({
        source: 'booking',
        sourceId: 'res-1',
        taskType: 'prepare_checkin',
        dateKey: '2026-06-22',
      }),
    ).toBe('auto:booking:res-1:prepare_checkin:2026-06-22');
  });

  it('creates CRM onboarding review tasks once per contact', async () => {
    mocks.listCrmContacts.mockResolvedValue([
      {
        id: 'c-1',
        name: 'Владелец',
        status: 'access_received',
        crmArchived: false,
        ownerObjects: [{ objectId: 'OBJ-1', title: 'Квартира', readinessPercent: 50, isActiveSession: true }],
        activeObjectTitle: 'Квартира',
        communicationStatus: 'no_contact',
        onboarding: null,
      },
    ]);

    const first = await syncAutoOpsTasks();
    const second = await syncAutoOpsTasks();

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(mocks.createOpsOperatorTask).toHaveBeenCalledTimes(2);
    expect(mocks.createOpsOperatorTask.mock.calls[0]?.[0]).toMatchObject({
      dedupKey: 'auto:crm:c-1:other',
      description: 'Проверить готовность объекта к настройке',
      metadata: expect.objectContaining({
        created_by_system: true,
        integration: 'crm_onboarding',
      }),
    });
  });

  it('creates object passport tasks when onboarding data is missing', async () => {
    mocks.listCrmContacts.mockResolvedValue([
      {
        id: 'c-2',
        name: 'Владелец 2',
        status: 'object_setup',
        crmArchived: false,
        ownerObjects: [],
        activeObjectTitle: null,
        communicationStatus: 'no_contact',
        onboarding: {
          status: 'missing_required_data',
          statusLabel: 'не хватает данных',
          missing: ['фото', 'Wi-Fi'],
          lastMessage: '',
          channelManagerHref: null,
          readinessPercent: 40,
          readinessStatusLabel: null,
          nextBestStep: null,
          missingOptional: [],
          objectType: null,
          checkinTime: null,
          checkoutTime: null,
          channels: [],
          rules: [],
          wifiName: null,
          wifiPassword: null,
          photosCount: null,
        },
      },
    ]);

    await syncAutoOpsTasks();

    expect(mocks.createOpsOperatorTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupKey: 'auto:object_passport:c-2:request_owner_data',
        taskStatus: 'needs_operator',
        description: 'Не хватает данных для публикации объекта',
        metadata: expect.objectContaining({
          integration: 'object_passport',
        }),
      }),
    );
  });

  it('creates communication tasks for manual reaction and pending escalations', async () => {
    mocks.listCrmContacts.mockResolvedValue([
      {
        id: 'c-3',
        name: 'Владелец 3',
        status: 'pilot',
        crmArchived: false,
        ownerObjects: [],
        activeObjectTitle: null,
        communicationStatus: 'needs_manual_reaction',
        onboarding: null,
      },
    ]);
    mocks.listEscalationReviews.mockReturnValue([
      {
        reviewId: 'rev-1',
        sessionId: 'sess-1',
        channel: 'telegram',
        targetId: '123',
        propertyId: 'OBJ-1',
        leadId: 'c-3',
        escalationReason: 'low_confidence',
        latestMessages: [{ direction: 'inbound', content: 'Помогите', createdAt: '2026-06-22T10:00:00Z' }],
        status: 'pending',
        createdAt: '2026-06-22T10:00:00Z',
        updatedAt: '2026-06-22T10:00:00Z',
      },
    ]);

    const first = await syncAutoOpsTasks();
    const second = await syncAutoOpsTasks();

    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(mocks.createOpsOperatorTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupKey: 'auto:communications:crm:c-3:verify_guest_issue',
        taskType: 'verify_guest_issue',
        description: 'Требуется ручная проверка сообщения гостя',
        metadata: expect.objectContaining({
          integration: 'communications_escalation',
        }),
      }),
    );
    expect(mocks.createOpsOperatorTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupKey: 'auto:communications:rev-1:verify_guest_issue',
        taskType: 'verify_guest_issue',
      }),
    );
  });

  it('creates booking tasks for check-in today, tomorrow, and cleaning after checkout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T12:00:00'));

    mocks.listCrmContacts.mockResolvedValue([]);
    mocks.supabaseFrom.mockImplementation(() => ({
      select: () => ({
        neq: () => ({
          limit: async () => ({
            data: [
              {
                id: 'res-today',
                property_id: 'PROP-1',
                check_in: '2026-06-22',
                check_out: '2026-06-25',
                status: 'confirmed',
              },
              {
                id: 'res-tomorrow',
                property_id: 'PROP-2',
                check_in: '2026-06-23',
                check_out: '2026-06-26',
                status: 'confirmed',
              },
              {
                id: 'res-cleaning',
                property_id: 'PROP-3',
                check_in: '2026-06-18',
                check_out: '2026-06-21',
                status: 'confirmed',
              },
            ],
            error: null,
          }),
        }),
      }),
    }));

    await syncAutoOpsTasks();

    expect(mocks.createOpsOperatorTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'prepare_checkin',
        description: 'Заезд сегодня',
        metadata: expect.objectContaining({ integration: 'booking' }),
      }),
    );
    expect(mocks.createOpsOperatorTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'prepare_checkin',
        description: 'Заезд завтра',
      }),
    );
    expect(mocks.createOpsOperatorTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'verify_cleaning',
        description: 'Уборка после выезда',
      }),
    );

    vi.useRealTimers();
  });

  it('logs per-source seed counts during sync', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.listCrmContacts.mockResolvedValue([
      {
        id: 'c-1',
        name: 'Владелец',
        status: 'test_object_selected',
        crmArchived: false,
        ownerObjects: [],
        activeObjectTitle: null,
        communicationStatus: 'no_contact',
        onboarding: null,
      },
    ]);

    await syncAutoOpsTasks();

    expect(infoSpy).toHaveBeenCalledWith('[ops-v1] auto-sync seed counts', {
      crm: 1,
      object_passport: 0,
      communications: 0,
      bookings: 0,
    });
    infoSpy.mockRestore();
  });

  it('continues when CRM source is unavailable', async () => {
    mocks.listCrmContacts.mockRejectedValue(new Error('crm_contacts relation does not exist'));

    const result = await syncAutoOpsTasks();

    expect(result).toEqual({ created: 0, scanned: 0 });
    expect(mocks.createOpsOperatorTask).not.toHaveBeenCalled();
  });

  it('continues when bookings source is unavailable', async () => {
    mocks.listCrmContacts.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.supabaseFrom.mockImplementation(() => ({
      select: () => ({
        neq: () => ({
          limit: async () => ({ data: null, error: { message: 'tg_guest_reservations missing' } }),
        }),
      }),
    }));

    const result = await syncAutoOpsTasks();

    expect(result).toEqual({ created: 0, scanned: 0 });
    expect(warnSpy).toHaveBeenCalledWith(
      '[ops-v1] auto-sync: bookings source unavailable',
      'tg_guest_reservations missing',
    );
    warnSpy.mockRestore();
  });
});
