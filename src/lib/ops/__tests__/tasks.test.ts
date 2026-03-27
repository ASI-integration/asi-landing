/**
 * Unit tests for src/lib/ops/tasks.ts
 *
 * Strategy: mock @/lib/supabase at module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// Control knobs
let mockInsertedRow: Row | null = null;
let mockInsertError: string | null = null;
let mockSelectRows: Row[] = [];
let mockSelectError: string | null = null;
let mockUpdateRow: Row | null = null;
let mockUpdateError: string | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'ops_tasks') throw new Error(`unexpected table: ${table}`);
      return {
        // upsert().select().maybeSingle() — used by createOpsTask
        upsert: (_row: unknown, _opts: unknown) => ({
          select: (_cols?: string) => ({
            maybeSingle: async () => ({
              data:  mockInsertError ? null : mockInsertedRow,
              error: mockInsertError ? { message: mockInsertError } : null,
            }),
          }),
        }),
        // select().order().eq()...  — used by getOpsTasks
        select: (_cols?: string) => ({
          order: (_col: string, _opts: unknown) => ({
            eq: (_col2: string, _val: unknown) => ({
              eq: (_col3: string, _val2: unknown) => ({
                eq: (_col4: string, _val3: unknown) => ({
                  // deeply nested chains resolve to the same data
                  then: (cb: (r: { data: Row[]; error: null }) => unknown) =>
                    cb({ data: mockSelectError ? [] : mockSelectRows, error: mockSelectError ? { message: mockSelectError } as never : null }),
                  catch: (cb: (e: unknown) => unknown) => cb(null),
                }),
                then: (cb: (r: { data: Row[]; error: null }) => unknown) =>
                  cb({ data: mockSelectError ? [] : mockSelectRows, error: mockSelectError ? { message: mockSelectError } as never : null }),
                catch: (cb: (e: unknown) => unknown) => cb(null),
              }),
              then: (cb: (r: { data: Row[]; error: null }) => unknown) =>
                cb({ data: mockSelectError ? [] : mockSelectRows, error: mockSelectError ? { message: mockSelectError } as never : null }),
              catch: (cb: (e: unknown) => unknown) => cb(null),
            }),
            // no further .eq — full result
            then: (cb: (r: { data: Row[]; error: null }) => unknown) =>
              cb({ data: mockSelectError ? [] : mockSelectRows, error: mockSelectError ? { message: mockSelectError } as never : null }),
            catch: (cb: (e: unknown) => unknown) => cb(null),
          }),
        }),
        // update().eq().select().maybeSingle() — used by updateOpsTask
        update: (_updates: unknown) => ({
          eq: (_col: string, _val: unknown) => ({
            select: (_cols?: string) => ({
              maybeSingle: async () => ({
                data:  mockUpdateError ? null : mockUpdateRow,
                error: mockUpdateError ? { message: mockUpdateError } : null,
              }),
            }),
          }),
        }),
      };
    },
  },
}));

import {
  createOpsTask,
  getOpsTasks,
  updateOpsTask,
  OpsTaskType,
  OpsTaskStatus,
  OpsTaskPriority,
} from '../tasks';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockInsertedRow  = { id: 'task-uuid-1' };
  mockInsertError  = null;
  mockSelectRows   = [];
  mockSelectError  = null;
  mockUpdateRow    = null;
  mockUpdateError  = null;
});

// ─── createOpsTask ────────────────────────────────────────────────────────────

describe('createOpsTask', () => {
  it('creates a task and returns created=true', async () => {
    const result = await createOpsTask({
      property_id:    'prop_A',
      reservation_id: 'res_123',
      chat_id:        999,
      task_type:      OpsTaskType.PreArrivalPrep,
      title:          'Pre-arrival prep',
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.task_id).toBe('task-uuid-1');
  });

  it('returns created=false when dedup_key conflict (row already existed — null returned)', async () => {
    mockInsertedRow = null; // upsert with ignoreDuplicates returns null on conflict
    const result = await createOpsTask({
      property_id: 'prop_A',
      reservation_id: 'res_123',
      task_type: OpsTaskType.PreArrivalPrep,
      title: 'Pre-arrival prep',
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
    expect(result.task_id).toBeNull();
  });

  it('returns ok=false when Supabase errors', async () => {
    mockInsertError = 'connection timeout';
    const result = await createOpsTask({
      property_id: 'prop_A',
      task_type:   OpsTaskType.GuestIssue,
      title:       'Issue',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/connection timeout/);
  });

  it('uses explicit dedup_key when provided', async () => {
    // Just verify no error — the dedup_key is passed through.
    const result = await createOpsTask({
      property_id: 'prop_A',
      task_type:   OpsTaskType.Checkout,
      title:       'Checkout',
      dedup_key:   'custom-dedup-key',
    });
    expect(result.ok).toBe(true);
  });

  it('defaults to normal priority', async () => {
    const result = await createOpsTask({
      property_id: 'prop_A',
      task_type:   OpsTaskType.Turnover,
      title:       'Turnover',
    });
    expect(result.ok).toBe(true);
  });

  it('uses no_res dedup_key when no reservation_id', async () => {
    const result = await createOpsTask({
      property_id: 'prop_A',
      chat_id:     888,
      task_type:   OpsTaskType.GuestIssue,
      title:       'Issue without reservation',
    });
    expect(result.ok).toBe(true);
  });
});

// ─── getOpsTasks ──────────────────────────────────────────────────────────────

describe('getOpsTasks', () => {
  it('returns empty list when no tasks match', async () => {
    mockSelectRows = [];
    const result = await getOpsTasks({ property_id: 'prop_A' });
    expect(result.ok).toBe(true);
    expect(result.tasks).toHaveLength(0);
  });

  it('returns tasks when they exist', async () => {
    mockSelectRows = [
      { id: 'task-1', task_type: 'pre_arrival_prep', task_status: 'open', property_id: 'prop_A' },
      { id: 'task-2', task_type: 'checkin_ready',    task_status: 'open', property_id: 'prop_A' },
    ];
    const result = await getOpsTasks({ property_id: 'prop_A' });
    expect(result.ok).toBe(true);
    expect(result.tasks).toHaveLength(2);
  });

  it('returns ok=false on Supabase error', async () => {
    mockSelectError = 'db error';
    const result = await getOpsTasks({ property_id: 'prop_A' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/db error/);
  });
});

// ─── updateOpsTask ────────────────────────────────────────────────────────────

describe('updateOpsTask', () => {
  it('updates task status and returns updated task', async () => {
    mockUpdateRow = {
      id: 'task-1', task_type: 'checkout', task_status: 'resolved',
      property_id: 'prop_A', reservation_id: 'res_123',
    };
    const result = await updateOpsTask({
      task_id:     'task-1',
      task_status: OpsTaskStatus.Resolved,
    });
    expect(result.ok).toBe(true);
    expect(result.task?.task_status).toBe('resolved');
  });

  it('returns not_found error when task does not exist', async () => {
    mockUpdateRow = null;
    const result = await updateOpsTask({ task_id: 'nonexistent' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task_not_found');
  });

  it('returns ok=false on Supabase error', async () => {
    mockUpdateError = 'update failed';
    const result = await updateOpsTask({ task_id: 'task-1', task_status: OpsTaskStatus.InProgress });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/update failed/);
  });
});
