/**
 * Tests for GET /api/admin/ops-tasks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
let mockTasks: Row[] = [];
let mockError: string | null = null;

vi.mock('@/lib/ops/tasks', () => ({
  getOpsTasks: async (filter: Record<string, unknown>) => {
    if (mockError) return { ok: false, tasks: [], error: mockError };
    return { ok: true, tasks: mockTasks };
  },
  OpsTaskStatus: {
    Open:       'open',
    InProgress: 'in_progress',
    Resolved:   'resolved',
    Canceled:   'canceled',
  },
}));

import { GET } from '../ops-tasks/route';

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

function makeReq(params: Record<string, string>, secret: string | null = ADMIN_SECRET): Request {
  const url = new URL('http://localhost/api/admin/ops-tasks');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: secret !== null ? { 'x-admin-secret': secret } : {},
  });
}

beforeEach(() => {
  mockTasks = [];
  mockError = null;
});

describe('GET /api/admin/ops-tasks', () => {
  it('returns 401 without secret', async () => {
    const res = await GET(makeReq({ property_id: 'prop_A' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await GET(makeReq({ property_id: 'prop_A' }, 'bad'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when no filter provided', async () => {
    const res = await GET(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status', async () => {
    const res = await GET(makeReq({ status: 'flying' }));
    expect(res.status).toBe(400);
  });

  it('returns 200 with empty tasks list', async () => {
    const res = await GET(makeReq({ property_id: 'prop_A' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.tasks).toEqual([]);
  });

  it('returns 200 with tasks when filtered by property_id', async () => {
    mockTasks = [
      { id: 't1', task_type: 'pre_arrival_prep', task_status: 'open', property_id: 'prop_A' },
    ];
    const res = await GET(makeReq({ property_id: 'prop_A' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].id).toBe('t1');
  });

  it('filters by reservation_id', async () => {
    mockTasks = [
      { id: 't2', task_type: 'checkin_ready', task_status: 'open', reservation_id: 'res_X' },
    ];
    const res = await GET(makeReq({ reservation_id: 'res_X' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
  });

  it('filters by status', async () => {
    mockTasks = [
      { id: 't3', task_type: 'checkout', task_status: 'resolved' },
    ];
    const res  = await GET(makeReq({ status: 'resolved' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
  });

  it('returns 500 when getOpsTasks errors', async () => {
    mockError = 'db failure';
    const res  = await GET(makeReq({ property_id: 'prop_A' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
  });
});
