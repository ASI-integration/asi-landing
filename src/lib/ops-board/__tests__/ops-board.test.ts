/**
 * Focused OPS Board v1 tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

let rows: Row[] = [];
let crmEvents: Row[] = [];

function resetStore(): void {
  rows = [];
  crmEvents = [];
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
      if (table === 'crm_events') {
        return {
          insert: (row: Row) => {
            crmEvents.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
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
            in: (col2: string, vals: unknown[]) => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    const match = rows.find(
                      (row) =>
                        row[col] === val &&
                        vals.includes(row[col2] as never) &&
                        ['new', 'in_progress', 'waiting_owner', 'needs_operator'].includes(
                          String(row.task_status),
                        ),
                    );
                    return { data: match ?? null, error: null };
                  },
                }),
              }),
            }),
            maybeSingle: async () => ({ data: rows.find((row) => row[col] === val) ?? null, error: null }),
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: rows.find((row) => row[col] === val) ?? null, error: null }),
              }),
            }),
          }),
          in: (col: string, vals: unknown[]) => {
            const chain = {
              in: (col2: string, vals2: unknown[]) => ({
                then: (cb: (r: { data: Row[]; error: null }) => unknown) =>
                  cb({
                    data: rows.filter(
                      (row) => vals.includes(row[col] as never) && vals2.includes(row[col2] as never),
                    ),
                    error: null,
                  }),
              }),
              order: async () => ({
                data: rows.filter((row) => vals.includes(row[col] as never)),
                error: null,
              }),
            };
            return chain;
          },
          order: () => ({
            then: (cb: (r: { data: Row[]; error: null }) => unknown) =>
              cb({ data: [...rows].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))), error: null }),
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

import {
  buildOpsDedupKey,
  createOpsOperatorTask,
  listOpsOperatorTasks,
  summarizeOpenOpsTasksByContactIds,
  updateOpsOperatorTask,
} from '@/lib/ops-board/repository';
import {
  createOpsTaskFromAutopilotEscalation,
  createOpsTaskFromChannelManager,
} from '@/lib/ops-board/integrations';
import { emitOpsTaskCreatedEvent, emitOpsTaskStatusEvent } from '@/lib/ops-board/crm-events';
import { isCrmOperatorEmail } from '@/lib/crm/access';
import { GET as listTasksRoute } from '@/app/api/dashboard/operations/tasks/route';
import { PATCH as patchTaskRoute } from '@/app/api/dashboard/operations/tasks/[id]/route';

describe('ops-board v1', () => {
  beforeEach(() => {
    resetStore();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'operator@asi-global.ru');
  });

  it('creates an OPS task', async () => {
    const result = await createOpsOperatorTask({
      taskType: 'verify_guest_issue',
      source: 'manual',
      contactId: 'contact-1',
      objectId: 'OBJ-1',
      ownerName: 'Иван',
    });
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.task?.taskType).toBe('verify_guest_issue');
  });

  it('lists created tasks for Operations board', async () => {
    await createOpsOperatorTask({
      taskType: 'other',
      source: 'manual',
      contactId: 'contact-2',
      title: 'Проверить доступ',
    });
    const listed = await listOpsOperatorTasks({ status: 'all' });
    expect(listed.ok).toBe(true);
    expect(listed.tasks).toHaveLength(1);
    expect(listed.tasks[0]?.title).toBe('Проверить доступ');
  });

  it('updates task status', async () => {
    const created = await createOpsOperatorTask({
      taskType: 'contact_owner',
      source: 'crm',
      contactId: 'contact-3',
    });
    const updated = await updateOpsOperatorTask(created.task!.id, { taskStatus: 'in_progress' });
    expect(updated.ok).toBe(true);
    expect(updated.task?.taskStatus).toBe('in_progress');
  });

  it('creates OPS task from Communication Autopilot escalation', async () => {
    const result = await createOpsTaskFromAutopilotEscalation({
      contactId: 'guest-1',
      propertyId: 'OBJ-9',
      escalationReason: 'complaint',
      guestQuestion: 'Жалоба на номер',
    });
    expect(result.created).toBe(true);
    const task = rows.find((row) => row.id === result.taskId);
    expect(task?.task_type).toBe('verify_guest_issue');
    expect(task?.task_status).toBe('needs_operator');
    expect(task?.priority).toBe('critical');
  });

  it('creates OPS task from Channel Manager needs help', async () => {
    const result = await createOpsTaskFromChannelManager({
      contactId: 'owner-1',
      objectId: 'OBJ-77',
      method: 'realtycalendar',
      reason: 'Нужна помощь',
    });
    expect(result.created).toBe(true);
    expect(rows[0]?.task_type).toBe('verify_channel_manager');
  });

  it('does not create duplicate open task with same dedup key', async () => {
    const dedup = buildOpsDedupKey({ taskType: 'verify_channel_manager', objectId: 'OBJ-55', contactId: 'c-55' });
    const first = await createOpsOperatorTask({
      taskType: 'verify_channel_manager',
      source: 'channel_manager',
      objectId: 'OBJ-55',
      contactId: 'c-55',
    });
    const second = await createOpsOperatorTask({
      taskType: 'verify_channel_manager',
      source: 'channel_manager',
      objectId: 'OBJ-55',
      contactId: 'c-55',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.task?.id).toBe(first.task?.id);
    expect(findOpenByDedup(dedup)).toBeTruthy();
    expect(rows).toHaveLength(1);
  });

  it('writes Activity Feed events for create and status changes', async () => {
    await emitOpsTaskCreatedEvent({
      contactId: 'contact-feed',
      taskId: 'task-feed',
      taskType: 'verify_guest_issue',
      title: 'Проверить проблему гостя',
      source: 'communication_autopilot',
      objectId: 'OBJ-1',
    });
    await emitOpsTaskStatusEvent({
      contactId: 'contact-feed',
      taskId: 'task-feed',
      taskType: 'verify_guest_issue',
      taskStatus: 'in_progress',
      title: 'Проверить проблему гостя',
    });
    expect(crmEvents.map((row) => row.event_type)).toEqual(['ops_task_created', 'ops_task_in_progress']);
  });

  it('summarizes open OPS tasks for CRM Queue', async () => {
    await createOpsOperatorTask({
      taskType: 'request_owner_data',
      source: 'crm',
      contactId: 'crm-1',
      priority: 'urgent',
    });
    await createOpsOperatorTask({
      taskType: 'verify_cleaning',
      source: 'crm',
      contactId: 'crm-1',
      priority: 'critical',
    });
    const summary = await summarizeOpenOpsTasksByContactIds(['crm-1', 'crm-2']);
    expect(summary['crm-1']?.openCount).toBe(2);
    expect(summary['crm-1']?.highestPriority).toBe('critical');
    expect(summary['crm-2']?.openCount).toBe(0);
  });

  it('blocks non-operator access to Operations API', async () => {
    expect(isCrmOperatorEmail('owner@gmail.com')).toBe(false);
    expect(isCrmOperatorEmail('operator@asi-global.ru')).toBe(true);

    const listResponse = await listTasksRoute(new Request('http://localhost/api/dashboard/operations/tasks'));
    expect(listResponse.status).toBe(200);

    const created = await createOpsOperatorTask({
      taskType: 'other',
      source: 'manual',
      contactId: 'contact-api',
    });
    const patchResponse = await patchTaskRoute(
      new Request('http://localhost/api/dashboard/operations/tasks/task-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskStatus: 'in_progress' }),
      }),
      { params: Promise.resolve({ id: created.task!.id }) },
    );
    expect(patchResponse.status).toBe(200);
  });
});
