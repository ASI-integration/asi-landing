import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  operatorAuth: vi.fn(),
  adminAuth: vi.fn(),
  access: vi.fn(),
  scope: vi.fn(),
  updateRecord: vi.fn(),
  listTasks: vi.fn(),
  syncLifecycle: vi.fn(),
  lifecycleStatus: vi.fn(),
  adminGate: vi.fn(),
  recordEvent: vi.fn(),
  lifecycleSummary: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: mocks.operatorAuth,
  requireOpsAdminSession: mocks.adminAuth,
}));
vi.mock('../access', () => ({ requireBookingOpsApiAccess: mocks.access }));
vi.mock('@/lib/booking-ops/repository', () => ({
  requireBookingOpsRecordScope: mocks.scope,
  updateBookingOpsRecord: mocks.updateRecord,
}));
vi.mock('@/lib/booking-ops/tasks', () => ({
  listBookingOpsTasksForRecord: mocks.listTasks,
  createBookingOpsTask: vi.fn(),
  parseCreateManualBookingOpsTaskInput: vi.fn(),
}));
vi.mock('@/lib/booking-ops/task-types', () => ({ BOOKING_OPS_TASK_TYPE_LABELS_RU: {} }));
vi.mock('@/lib/booking-ops/lifecycle', () => ({
  syncLifecycleFromBookingOpsRecord: mocks.syncLifecycle,
  getLifecycleStatus: mocks.lifecycleStatus,
  adminUpdateLifecycleGate: mocks.adminGate,
}));
vi.mock('@/lib/booking-ops/lifecycle-autopilot-service', () => ({
  recordAndProcessBookingEvent: mocks.recordEvent,
  getBookingLifecycleSummary: mocks.lifecycleSummary,
}));

import { GET as recordGET, PATCH as recordPATCH } from '../[id]/route';
import { GET as tasksGET } from '../[id]/tasks/route';
import { GET as lifecycleGET, PATCH as lifecyclePATCH } from '../[id]/lifecycle/route';
import { GET as lifecycleSummaryGET } from '../[id]/lifecycle-summary/route';

const context = { params: { id: 'requested-ops' } };
const expectedScope = { accountId: 'account-a', propertyId: 'property-a' };
const access = { ok: true, bookingId: 'canonical-ops', ...expectedScope };
const record = { id: 'canonical-ops', bookingId: 'source-a', propertyId: 'property-a', guestIntake: null };

describe('Booking Ops canonical record/lifecycle route scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operatorAuth.mockResolvedValue({ session: { userId: 'user-a', email: 'ops@asi.test' } });
    mocks.adminAuth.mockResolvedValue({ session: { userId: 'user-a', email: 'ops@asi.test' } });
    mocks.access.mockResolvedValue(access);
    mocks.scope.mockResolvedValue(record);
    mocks.updateRecord.mockResolvedValue({ ok: true, record });
    mocks.listTasks.mockResolvedValue({ ok: true, tasks: [] });
    mocks.syncLifecycle.mockResolvedValue(undefined);
    mocks.lifecycleStatus.mockResolvedValue({ ok: true, lifecycle: { bookingId: record.id, gates: [] } });
    mocks.adminGate.mockResolvedValue({ ok: true, gate: { gateKey: 'documents_verified', status: 'completed' } });
    mocks.recordEvent.mockResolvedValue({ processed: true });
    mocks.lifecycleSummary.mockResolvedValue({ stage: 'guest_intake' });
  });

  it('record GET reads the canonical booking inside expected scope', async () => {
    const response = await recordGET(new Request('http://localhost/record'), context);
    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith(access.bookingId, expectedScope);
  });

  it('record PATCH binds the update to canonical scope', async () => {
    const response = await recordPATCH(new Request('http://localhost/record', {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'operator note' }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateRecord).toHaveBeenCalledWith(access.bookingId, expect.objectContaining({ notes: 'operator note' }), {
      actorType: 'admin',
      expectedScope,
    });
  });

  it('task list retains canonical scope', async () => {
    const response = await tasksGET(new Request('http://localhost/tasks'), context);
    expect(response.status).toBe(200);
    expect(mocks.listTasks).toHaveBeenCalledWith(access.bookingId, { expectedScope });
  });

  it('lifecycle GET retains scope through synchronization and status read', async () => {
    const response = await lifecycleGET(new Request('http://localhost/lifecycle'), context);
    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith(access.bookingId, expectedScope);
    expect(mocks.syncLifecycle).toHaveBeenCalledWith(record, expectedScope);
    expect(mocks.lifecycleStatus).toHaveBeenCalledWith(record.id, expectedScope);
  });

  it('lifecycle PATCH revalidates scope through gate, event, and final status', async () => {
    const response = await lifecyclePATCH(new Request('http://localhost/lifecycle', {
      method: 'PATCH',
      body: JSON.stringify({ gateKey: 'documents_verified', status: 'completed', reason: 'reviewed' }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.adminGate).toHaveBeenCalledWith(expect.objectContaining({
      expectedScope,
      bookingId: record.id,
      gateKey: 'documents_verified',
      status: 'completed',
    }));
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: record.id,
      type: 'manual.override',
    }), expectedScope);
    expect(mocks.lifecycleStatus).toHaveBeenCalledWith(record.id, expectedScope);
  });

  it('lifecycle summary is read only through canonical scope', async () => {
    const response = await lifecycleSummaryGET(new Request('http://localhost/lifecycle-summary'), context);
    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith(access.bookingId, expectedScope);
    expect(mocks.lifecycleSummary).toHaveBeenCalledWith(record.id, expectedScope);
  });

  it.each([
    ['record', recordGET],
    ['lifecycle', lifecycleGET],
    ['lifecycle-summary', lifecycleSummaryGET],
  ] as const)('%s read fails closed if ownership changes after route access', async (_name, handler) => {
    mocks.scope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const response = await handler(new Request('http://localhost/scoped'), context);
    expect(response.status).toBe(403);
  });

  it('task list fails closed if ownership changes after route access', async () => {
    mocks.listTasks.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const response = await tasksGET(new Request('http://localhost/tasks'), context);
    expect(response.status).toBe(403);
  });

  it('record PATCH does not leak scope mismatch details', async () => {
    mocks.updateRecord.mockResolvedValueOnce({ ok: false, error: 'scope_mismatch' });
    const response = await recordPATCH(new Request('http://localhost/record', {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'operator note' }),
    }), context);
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe('Нет доступа к бронированию.');
  });
});
