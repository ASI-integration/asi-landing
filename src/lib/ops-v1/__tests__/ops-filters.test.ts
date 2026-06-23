/**
 * OPS v1.3 filter, close/reopen, and summary tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const OPEN_STATUSES = ['new', 'in_progress', 'waiting_owner', 'needs_operator'];
const DONE_STATUSES = ['done', 'closed'];

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

function listThenable(data: Row[]) {
  return {
    in: (col: string, values: unknown[]) => {
      if (col === 'task_status') {
        const allowed = new Set(values.map(String));
        return listThenable(sortRows(rows.filter((row) => allowed.has(String(row.task_status)))));
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
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import { createOpsOperatorTask } from '@/lib/ops-board/repository';
import { GET as listTasksRoute } from '@/app/api/ops/tasks/route';
import { PATCH as patchTaskRoute } from '@/app/api/ops/tasks/[id]/route';

describe('ops v1.3 filters', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(syncAutoOpsTasks).mockClear();
  });

  it('excludes done tasks from active list', async () => {
    const created = await createOpsV1Task({
      taskType: 'manual_review',
      objectLabel: 'Объект 1',
      comment: 'Проверить',
    });
    expect(created.ok).toBe(true);

    await patchTaskRoute(
      new Request('http://localhost/api/ops/tasks/task-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      }),
      { params: Promise.resolve({ id: created.task!.id }) },
    );

    const active = await listOpsV1Tasks({ filter: 'active', syncAuto: false });
    expect(active.tasks).toHaveLength(0);

    const done = await listOpsV1Tasks({ filter: 'done', syncAuto: false });
    expect(done.tasks).toHaveLength(1);
    expect(done.tasks[0]?.status).toBe('done');

    const all = await listOpsV1Tasks({ filter: 'all', syncAuto: false });
    expect(all.tasks).toHaveLength(1);
  });

  it('sets closed_at on done and clears it when returning to in_progress', async () => {
    const created = await createOpsV1Task({
      taskType: 'manual_review',
      objectLabel: 'Объект 2',
    });
    const taskId = created.task!.id;

    await patchTaskRoute(
      new Request(`http://localhost/api/ops/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      }),
      { params: Promise.resolve({ id: taskId }) },
    );

    const doneRow = rows.find((row) => row.id === taskId);
    expect(doneRow?.closed_at).toBeTruthy();

    await patchTaskRoute(
      new Request(`http://localhost/api/ops/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      }),
      { params: Promise.resolve({ id: taskId }) },
    );

    const reopenedRow = rows.find((row) => row.id === taskId);
    expect(reopenedRow?.task_status).toBe('in_progress');
    expect(reopenedRow?.closed_at).toBeNull();

    const active = await listOpsV1Tasks({ filter: 'active', syncAuto: false });
    expect(active.tasks).toHaveLength(1);
    expect(active.tasks[0]?.status).toBe('in_progress');
  });

  it('summary counts only active tasks', () => {
    const today = new Date().toISOString();
    const summary = buildOpsV1Summary([
      {
        id: '1',
        propertyId: 'OBJ-1',
        objectLabel: 'Квартира 1',
        taskType: 'cleaning',
        status: 'needs_attention',
        source: 'crm',
        origin: 'auto',
        scheduledAt: today,
        comment: null,
        title: 'Уборка',
        createdAt: today,
        updatedAt: today,
      },
      {
        id: '2',
        propertyId: 'OBJ-2',
        objectLabel: 'Квартира 2',
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

    expect(summary.needsAttention).toBe(1);
    expect(summary.cleaningNeeded).toBe(1);
  });

  it('GET /api/ops/tasks supports filter query param', async () => {
    await createOpsV1Task({ taskType: 'manual_review', objectLabel: 'A' });

    const activeResponse = await listTasksRoute(new Request('http://localhost/api/ops/tasks?filter=active'));
    const activePayload = await activeResponse.json();
    expect(activePayload.filter).toBe('active');
    expect(activePayload.tasks).toHaveLength(1);

    await patchTaskRoute(
      new Request('http://localhost/api/ops/tasks/task-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      }),
      { params: Promise.resolve({ id: 'task-1' }) },
    );

    const doneResponse = await listTasksRoute(new Request('http://localhost/api/ops/tasks?filter=done'));
    const donePayload = await doneResponse.json();
    expect(donePayload.tasks).toHaveLength(1);
    expect(donePayload.summary.needsAttention).toBe(0);
  });

  it('repeat sync does not reopen done task with same dedupe_key', async () => {
    const dedupKey = 'auto:crm:contact-1:other';
    await createOpsOperatorTask({
      taskType: 'other',
      source: 'crm',
      title: 'Проверить',
      dedupKey,
      taskStatus: 'done',
      metadata: { created_by_system: true },
    });

    const result = await createOpsOperatorTask({
      taskType: 'other',
      source: 'crm',
      title: 'Проверить',
      dedupKey,
      taskStatus: 'new',
      metadata: { created_by_system: true },
    });

    expect(result.created).toBe(false);
    expect(result.task?.taskStatus).toBe('done');
    expect(rows.filter((row) => row.dedup_key === dedupKey)).toHaveLength(1);
  });
});
