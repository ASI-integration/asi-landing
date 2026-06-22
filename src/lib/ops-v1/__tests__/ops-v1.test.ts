/**
 * Focused OPS v1 tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

let rows: Row[] = [];

function resetStore(): void {
  rows = [];
}

function findOpenByDedup(dedupKey: string): Row | undefined {
  return rows.find(
    (row) =>
      row.dedup_key === dedupKey &&
      ['new', 'in_progress', 'waiting_owner', 'needs_operator'].includes(String(row.task_status)),
  );
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'ops_operator_tasks') throw new Error(`unexpected table: ${table}`);

      return {
        insert: (row: Row) => ({
          select: () => ({
            single: async () => {
              const dedup = String(row.dedup_key ?? '');
              if (findOpenByDedup(dedup)) {
                return { data: null, error: { message: 'duplicate', code: '23505' } };
              }
              const created = {
                id: `task-${rows.length + 1}`,
                ...row,
                metadata: row.metadata ?? {},
                closed_at: null,
              };
              rows.push(created);
              return { data: created, error: null };
            },
          }),
        }),
        select: () => ({
          eq: (col: string, val: unknown) => ({
            in: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: findOpenByDedup(String(val)) ?? null, error: null }),
                }),
              }),
            }),
            maybeSingle: async () => ({ data: rows.find((row) => row[col] === val) ?? null, error: null }),
          }),
          order: () => ({
            then: (cb: (r: { data: Row[]; error: null }) => unknown) =>
              cb({
                data: [...rows].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))),
                error: null,
              }),
          }),
        }),
        update: (patch: Row) => ({
          eq: (col: string, val: unknown) => ({
            select: () => ({
              maybeSingle: async () => {
                const row = rows.find((item) => item[col] === val);
                if (!row) return { data: null, error: null };
                Object.assign(row, patch);
                return { data: row, error: null };
              },
            }),
          }),
        }),
      };
    },
  },
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({ session: { userId: 'u1', email: 'operator@asi-global.ru' } })),
}));

vi.mock('@/lib/ops-board/crm-events', () => ({
  emitOpsTaskStatusEvent: vi.fn(async () => undefined),
}));

import { buildOpsV1Summary, createOpsV1Task, listOpsV1Tasks } from '@/lib/ops-v1/repository';
import { mapOperatorStatusToV1, mapOperatorTypeToV1 } from '@/lib/ops-v1/mapping';
import { GET as listTasksRoute } from '@/app/api/ops/tasks/route';
import { PATCH as patchTaskRoute } from '@/app/api/ops/tasks/[id]/route';

describe('ops v1', () => {
  beforeEach(() => {
    resetStore();
  });

  it('maps operator task types and statuses to OPS v1 labels', () => {
    expect(mapOperatorTypeToV1('prepare_checkin')).toBe('checkin');
    expect(mapOperatorStatusToV1('needs_operator')).toBe('needs_attention');
  });

  it('builds summary cards from OPS v1 tasks', () => {
    const today = new Date().toISOString();
    const summary = buildOpsV1Summary([
      {
        id: '1',
        propertyId: 'OBJ-1',
        objectLabel: 'Квартира 1',
        taskType: 'checkin',
        status: 'new',
        source: 'manual',
        scheduledAt: today,
        comment: null,
        title: 'Заезд',
        createdAt: today,
        updatedAt: today,
      },
      {
        id: '2',
        propertyId: 'OBJ-2',
        objectLabel: 'Квартира 2',
        taskType: 'cleaning',
        status: 'needs_attention',
        source: 'crm',
        scheduledAt: today,
        comment: 'Нужна уборка',
        title: 'Уборка',
        createdAt: today,
        updatedAt: today,
      },
    ]);

    expect(summary.checkinsToday).toBe(1);
    expect(summary.cleaningNeeded).toBe(1);
    expect(summary.needsAttention).toBe(1);
  });

  it('lists and updates tasks through OPS v1 API', async () => {
    const created = await createOpsV1Task({
      taskType: 'manual_review',
      objectLabel: 'Тестовый объект',
      comment: 'Проверить ключи',
    });
    expect(created.ok).toBe(true);

    const listResponse = await listTasksRoute();
    const listPayload = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listPayload.tasks).toHaveLength(1);
    expect(listPayload.summary).toBeTruthy();

    const listed = await listOpsV1Tasks();
    expect(listed.tasks[0]?.objectLabel).toBe('Тестовый объект');

    const patchResponse = await patchTaskRoute(
      new Request('http://localhost/api/ops/tasks/task-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      }),
      { params: Promise.resolve({ id: created.task!.id }) },
    );
    const patchPayload = await patchResponse.json();
    expect(patchResponse.status).toBe(200);
    expect(patchPayload.task.status).toBe('in_progress');
  });
});
