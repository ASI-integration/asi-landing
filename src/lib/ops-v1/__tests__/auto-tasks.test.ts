/**
 * Focused auto OPS task sync tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCrmContacts: vi.fn(),
  listEscalationReviews: vi.fn(),
  createOpsOperatorTask: vi.fn(),
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
    from: () => ({
      select: () => ({
        neq: () => ({
          limit: async () => ({ data: [], error: null }),
        }),
      }),
    }),
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
});
