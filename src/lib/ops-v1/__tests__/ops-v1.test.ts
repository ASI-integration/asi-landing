/**
 * Focused OPS v1 tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const OPEN_STATUSES = ['new', 'in_progress', 'waiting_owner', 'needs_operator'];

let rows: Row[] = [];

function resetStore(): void {
  rows = [];
}

function findByDedup(dedupKey: string): Row | undefined {
  return rows.find((row) => row.dedup_key === dedupKey);
}

function sortRows(data: Row[]): Row[] {
  return [...data].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function filterByStatuses(statuses: string[]): Row[] {
  const allowed = new Set(statuses);
  return sortRows(rows.filter((row) => allowed.has(String(row.task_status))));
}

function listThenable(data: Row[]) {
  return {
    in: (col: string, values: unknown[]) => {
      if (col === 'task_status') {
        return listThenable(filterByStatuses(values.map(String)));
      }
      return listThenable(data);
    },
    then: (cb: (r: { data: Row[]; error: null }) => unknown) => cb({ data, error: null }),
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'ops_operator_tasks') throw new Error(`unexpected table: ${table}`);

      return {
        insert: (row: Row) => ({
          select: () => ({
            single: async () => {
              const created = {
                id: `task-${rows.length + 1}`,
                ...row,
                metadata: row.metadata ?? {},
                closed_at: null,
                updated_at: row.updated_at ?? row.created_at ?? new Date().toISOString(),
              };
              rows.push(created);
              return { data: created, error: null };
            },
          }),
        }),
        select: () => ({
          eq: (col: string, val: unknown) => {
            if (col === 'dedup_key') {
              const match = findByDedup(String(val));
              return {
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: match ?? null, error: null }),
                  }),
                }),
              };
            }
            return {
              maybeSingle: async () => ({ data: rows.find((item) => item[col] === val) ?? null, error: null }),
            };
          },
          order: () => listThenable(sortRows(rows)),
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
  requireOpsAdminSession: vi.fn(async () => ({ session: { userId: 'u1', email: 'operator@asi-global.ru' } })),
}));

vi.mock('@/lib/ops-v1/auto-tasks', () => ({
  syncAutoOpsTasks: vi.fn(async () => ({ created: 0, scanned: 0 })),
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

  it('builds summary cards from OPS v1 tasks and ignores completed ones', () => {
    const today = new Date().toISOString();
    const summary = buildOpsV1Summary([
      {
        id: '1',
        propertyId: 'OBJ-1',
        objectLabel: 'Квартира 1',
        taskType: 'checkin',
        status: 'new',
        source: 'admin',
        origin: 'manual',
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
        origin: 'auto',
        scheduledAt: today,
        comment: 'Нужна уборка',
        title: 'Уборка',
        createdAt: today,
        updatedAt: today,
      },
      {
        id: '3',
        propertyId: 'OBJ-3',
        objectLabel: 'Квартира 3',
        taskType: 'cleaning',
        status: 'done',
        source: 'crm',
        origin: 'auto',
        scheduledAt: today,
        comment: null,
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

    const listResponse = await listTasksRoute(new Request('http://localhost/api/ops/tasks?filter=active'));
    const listPayload = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listPayload.tasks).toHaveLength(1);
    expect(listPayload.summary).toBeTruthy();

    const listed = await listOpsV1Tasks({ filter: 'active', syncAuto: false });
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

  it('GET /api/ops/tasks returns 200 with empty payload when task list fails', async () => {
    const { supabase } = await import('@/lib/supabase');
    const originalFrom = supabase.from;
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'ops_operator_tasks') {
        return {
          select: () => ({
            order: () => ({
              then: (cb: (result: { data: null; error: { message: string } }) => unknown) =>
                cb({ data: null, error: { message: 'ops_operator_tasks missing' } }),
            }),
          }),
        } as never;
      }
      return originalFrom.call(supabase, table);
    });

    const listResponse = await listTasksRoute(new Request('http://localhost/api/ops/tasks'));
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload.ok).toBe(true);
    expect(listPayload.tasks).toEqual([]);
    expect(listPayload.summary).toEqual({
      checkinsToday: 0,
      checkoutsToday: 0,
      cleaningNeeded: 0,
      needsAttention: 0,
    });
  });
});
