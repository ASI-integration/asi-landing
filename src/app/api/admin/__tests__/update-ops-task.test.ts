/**
 * Tests for POST /api/admin/update-ops-task
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

let mockUpdatedTask: Row | null = null;
let mockUpdateError: string | null = null;
let mockCreateResult: { ok: boolean; task_id: string | null; created: boolean; error?: string } = {
  ok: true, task_id: 'turnover-uuid', created: true,
};

vi.mock('@/lib/ops/tasks', () => ({
  updateOpsTask: async (params: Record<string, unknown>) => {
    if (mockUpdateError) return { ok: false, task: null, error: mockUpdateError };
    if (!mockUpdatedTask) return { ok: false, task: null, error: 'task_not_found' };
    return { ok: true, task: { ...mockUpdatedTask, task_status: params.task_status ?? mockUpdatedTask.task_status } };
  },
  createOpsTask: async (_params: unknown) => mockCreateResult,
  OpsTaskType:   { Checkout: 'checkout', Turnover: 'turnover', GuestIssue: 'guest_issue', PreArrivalPrep: 'pre_arrival_prep', CheckinReady: 'checkin_ready' },
  OpsTaskStatus: { Open: 'open', InProgress: 'in_progress', Resolved: 'resolved', Canceled: 'canceled' },
  OpsTaskPriority: { Normal: 'normal', Urgent: 'urgent', Emergency: 'emergency', Informational: 'informational' },
}));

vi.mock('@/lib/communication/timeline', () => ({
  appendTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ops/unit-state', () => ({
  getUnitState:              vi.fn().mockResolvedValue({ ok: true, state: { current_state: 'occupied', dirty: false, blocked_reason: null } }),
  markUnitCheckoutDue:       vi.fn().mockResolvedValue({ ok: true, state: { current_state: 'checkout_due' } }),
  markUnitTurnoverNeeded:    vi.fn().mockResolvedValue({ ok: true, state: { current_state: 'turnover_needed' } }),
  markUnitInTurnover:        vi.fn().mockResolvedValue({ ok: true, state: { current_state: 'in_turnover' } }),
  markUnitReadyAfterTurnover: vi.fn().mockResolvedValue({ ok: true, state: { current_state: 'ready', blocked_reason: null }, gate_blocked: false }),
}));

import { POST } from '../update-ops-task/route';

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

function makeReq(body: unknown, secret: string | null = ADMIN_SECRET): Request {
  return new Request('http://localhost/api/admin/update-ops-task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== null ? { 'x-admin-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUpdatedTask = {
    id: 'task-1', task_type: 'pre_arrival_prep', task_status: 'open',
    property_id: 'prop_A', reservation_id: 'res_123', chat_id: 999,
  };
  mockUpdateError = null;
  mockCreateResult = { ok: true, task_id: 'turnover-uuid', created: true };
});

describe('POST /api/admin/update-ops-task', () => {
  // ── Auth ───────────────────────────────────────────────────────────────────

  it('returns 401 without secret', async () => {
    const res = await POST(makeReq({ task_id: 'task-1' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await POST(makeReq({ task_id: 'task-1' }, 'bad'));
    expect(res.status).toBe(401);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 when task_id is missing', async () => {
    const res  = await POST(makeReq({}));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/task_id/);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://localhost/api/admin/update-ops-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid task_status', async () => {
    const res  = await POST(makeReq({ task_id: 'task-1', task_status: 'flying' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/task_status/);
  });

  // ── Update ─────────────────────────────────────────────────────────────────

  it('updates status correctly', async () => {
    const res  = await POST(makeReq({ task_id: 'task-1', task_status: 'in_progress' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.task.task_status).toBe('in_progress');
  });

  it('updates assigned_to and operator_note', async () => {
    const res  = await POST(makeReq({ task_id: 'task-1', assigned_to: 'staff@example.com', operator_note: 'On it' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  // ── Not found ──────────────────────────────────────────────────────────────

  it('returns 404 when task not found', async () => {
    mockUpdatedTask = null;
    const res  = await POST(makeReq({ task_id: 'ghost-task' }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
  });

  // ── Turnover auto-creation ─────────────────────────────────────────────────

  it('auto-creates turnover task when checkout task is resolved', async () => {
    mockUpdatedTask = {
      id: 'task-checkout', task_type: 'checkout', task_status: 'resolved',
      property_id: 'prop_A', reservation_id: 'res_123', chat_id: 999,
    };
    const res  = await POST(makeReq({ task_id: 'task-checkout', task_status: 'resolved' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.turnover_created).toBe(true);
    // unit state should advance to turnover_needed
    expect(json.unit_state).toBe('turnover_needed');
  });

  it('advances unit state to checkout_due when checkout task goes in_progress', async () => {
    mockUpdatedTask = {
      id: 'task-checkout', task_type: 'checkout', task_status: 'in_progress',
      property_id: 'prop_A', reservation_id: 'res_123', chat_id: 999,
    };
    const res  = await POST(makeReq({ task_id: 'task-checkout', task_status: 'in_progress' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.unit_state).toBe('checkout_due');
  });

  it('advances unit state to in_turnover when turnover task goes in_progress', async () => {
    mockUpdatedTask = {
      id: 'task-turnover', task_type: 'turnover', task_status: 'in_progress',
      property_id: 'prop_A', reservation_id: 'res_123', chat_id: 999,
    };
    const res  = await POST(makeReq({ task_id: 'task-turnover', task_status: 'in_progress' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.unit_state).toBe('in_turnover');
  });

  it('advances unit state to ready when turnover task resolves and gates pass', async () => {
    mockUpdatedTask = {
      id: 'task-turnover', task_type: 'turnover', task_status: 'resolved',
      property_id: 'prop_A', reservation_id: 'res_123', chat_id: 999,
    };
    const res  = await POST(makeReq({ task_id: 'task-turnover', task_status: 'resolved' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.unit_state).toBe('ready');
  });

  it('does not auto-create turnover when non-checkout task is resolved', async () => {
    mockUpdatedTask = {
      id: 'task-prep', task_type: 'pre_arrival_prep', task_status: 'resolved',
      property_id: 'prop_A', reservation_id: 'res_123', chat_id: 999,
    };
    const res  = await POST(makeReq({ task_id: 'task-prep', task_status: 'resolved' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.turnover_created).toBeUndefined();
  });

  it('does not auto-create turnover when checkout task is not resolved', async () => {
    mockUpdatedTask = {
      id: 'task-checkout', task_type: 'checkout', task_status: 'in_progress',
      property_id: 'prop_A', reservation_id: 'res_123', chat_id: 999,
    };
    const res  = await POST(makeReq({ task_id: 'task-checkout', task_status: 'in_progress' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.turnover_created).toBeUndefined();
  });

  // ── DB error ───────────────────────────────────────────────────────────────

  it('returns 500 on Supabase error', async () => {
    mockUpdateError = 'db error';
    const res  = await POST(makeReq({ task_id: 'task-1', task_status: 'resolved' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
  });
});
