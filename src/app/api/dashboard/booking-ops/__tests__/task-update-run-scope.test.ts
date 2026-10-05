import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  scope: vi.fn(),
  complete: vi.fn(),
  list: vi.fn(),
  parse: vi.fn(),
  getTask: vi.fn(),
  communications: vi.fn(),
  runAction: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession: mocks.auth,
}));

vi.mock('../access', () => ({
  requireBookingOpsApiAccess: mocks.access,
}));

vi.mock('@/lib/booking-ops/repository', () => ({
  requireBookingOpsRecordScope: mocks.scope,
}));

vi.mock('@/lib/booking-ops/task-completion-effects', () => ({
  updateBookingOpsTaskWithCompletionEffects: mocks.complete,
}));

vi.mock('@/lib/booking-ops/tasks', () => ({
  listBookingOpsTasksForRecord: mocks.list,
  parseUpdateBookingOpsTaskInput: mocks.parse,
  getBookingOpsTask: mocks.getTask,
}));

vi.mock('@/lib/booking-ops/communication-orchestrator', () => ({
  syncBookingOpsCommunications: mocks.communications,
}));

vi.mock('@/lib/booking-ops/task-action-runner', () => ({
  runBookingOpsTaskAction: mocks.runAction,
}));

import { PATCH } from '../[id]/tasks/[taskId]/route';
import { POST as RUN } from '../[id]/tasks/[taskId]/run/route';

const context = { params: { id: 'requested-ops', taskId: 'task-a' } };
const canonical = {
  ok: true,
  bookingId: 'canonical-ops',
  accountId: 'account-a',
  propertyId: 'property-a',
};
const expectedScope = { accountId: 'account-a', propertyId: 'property-a' };
const record = {
  id: 'canonical-ops',
  bookingId: 'reservation-a',
  propertyId: 'property-a',
};
const task = {
  id: 'task-a',
  bookingOpsRecordId: 'canonical-ops',
  bookingId: 'reservation-a',
  taskType: 'cleaning_needed',
  title: 'cleaning',
  description: null,
  status: 'open',
  priority: 'normal',
  source: 'manual',
  dueAt: null,
  completedAt: null,
  metadata: {},
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
};

function patchRequest() {
  return new Request('http://localhost/tasks/task-a', {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'completed',
      bookingId: 'foreign-booking',
      accountId: 'foreign-account',
      propertyId: 'foreign-property',
    }),
  });
}

describe('task update/run canonical scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ session: { email: 'operator@asi.test', userId: 'operator' } });
    mocks.access.mockResolvedValue(canonical);
    mocks.scope.mockResolvedValue(record);
    mocks.parse.mockReturnValue({ ok: true, input: { status: 'completed' } });
    mocks.complete.mockResolvedValue({
      ok: true,
      task: { ...task, status: 'completed' },
      effectResult: null,
    });
    mocks.list.mockResolvedValue({ ok: true, tasks: [task] });
    mocks.communications.mockResolvedValue({ ok: true, communications: [], plan: {} });
    mocks.getTask.mockResolvedValue({ ok: true, task });
    mocks.runAction.mockResolvedValue({
      ok: true,
      actionType: 'cleaning_needed',
      message: 'ok',
      createdDraftIds: null,
      checklist: ['manual'],
      nextTaskStatusSuggestion: 'in_progress',
      blockingReason: null,
    });
  });

  it('PATCH ignores requested identity and carries canonical scope through completion and communications', async () => {
    const response = await PATCH(patchRequest(), context);
    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith(canonical.bookingId, expectedScope);
    expect(mocks.complete).toHaveBeenCalledWith(
      canonical.bookingId,
      context.params.taskId,
      { status: 'completed' },
      undefined,
      expectedScope,
    );
    expect(mocks.list).toHaveBeenCalledWith(canonical.bookingId, { expectedScope });
    expect(mocks.communications).toHaveBeenCalledWith(expect.objectContaining({
      record,
      tasks: [task],
      expectedScope,
    }));
  });

  it('PATCH fails closed when ownership changes after route authorization', async () => {
    mocks.complete.mockRejectedValue(new Error('booking_scope_mismatch'));
    const response = await PATCH(patchRequest(), context);
    expect(response.status).toBe(403);
  });

  it.each([403, 409])('PATCH stops before domain work when shared access denies with %s', async status => {
    mocks.access.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ ok: false }, { status }),
    });
    const response = await PATCH(patchRequest(), context);
    expect(response.status).toBe(status);
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('run route uses canonical record id and expected scope for the task action', async () => {
    const response = await RUN(new Request('http://localhost/run', { method: 'POST' }), context);
    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith(canonical.bookingId, expectedScope);
    expect(mocks.getTask).toHaveBeenCalledWith(canonical.bookingId, context.params.taskId);
    expect(mocks.runAction).toHaveBeenCalledWith(record, task, {
      createdBy: 'operator@asi.test',
      expectedScope,
    });
  });

  it('run route fails closed if action-time scope revalidation rejects', async () => {
    mocks.runAction.mockRejectedValue(new Error('booking_scope_mismatch'));
    const response = await RUN(new Request('http://localhost/run', { method: 'POST' }), context);
    expect(response.status).toBe(403);
  });
});
