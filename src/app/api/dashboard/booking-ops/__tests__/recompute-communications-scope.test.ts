import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminAuth: vi.fn(),
  access: vi.fn(),
  scope: vi.fn(),
  syncTasks: vi.fn(),
  listTasks: vi.fn(),
  guestIntake: vi.fn(),
  syncCommunications: vi.fn(),
  preparation: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession: mocks.adminAuth,
  requireCrmOperatorSession: vi.fn(),
}));
vi.mock('../access', () => ({ requireBookingOpsApiAccess: mocks.access }));
vi.mock('@/lib/booking-ops/repository', () => ({
  requireBookingOpsRecordScope: mocks.scope,
  syncBookingOpsTasksForRecordId: mocks.syncTasks,
}));
vi.mock('@/lib/booking-ops/tasks', () => ({ listBookingOpsTasksForRecord: mocks.listTasks }));
vi.mock('@/lib/booking-ops/guest-intake-autopilot', () => ({ syncGuestIntakeAutopilot: mocks.guestIntake }));
vi.mock('@/lib/booking-ops/communication-orchestrator', () => ({
  listBookingOpsCommunicationsForRecord: vi.fn(),
  syncBookingOpsCommunications: mocks.syncCommunications,
}));
vi.mock('@/lib/booking-ops/automation-engine', () => ({ planBookingOpsPreparation: mocks.preparation }));

import { POST as communicationsPOST } from '../[id]/communications/route';
import { POST as recomputePOST } from '../[id]/recompute/route';

const context = { params: { id: 'requested-ops' } };
const expectedScope = { accountId: 'account-a', propertyId: 'property-a' };
const access = { ok: true, bookingId: 'canonical-ops', ...expectedScope };
const record = { id: 'canonical-ops', bookingId: 'source-a', propertyId: 'property-a', guestIntake: null };

describe('Booking Ops recompute/communications canonical mutation scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminAuth.mockResolvedValue({ session: { email: 'ops@asi.test', userId: 'user-a' } });
    mocks.access.mockResolvedValue(access);
    mocks.scope.mockResolvedValue(record);
    mocks.syncTasks.mockResolvedValue({ ok: true });
    mocks.listTasks.mockResolvedValue({ ok: true, tasks: [] });
    mocks.guestIntake.mockResolvedValue({ ok: true, session: null, plan: {} });
    mocks.syncCommunications.mockResolvedValue({ ok: true, communications: [], plan: { nextAction: null } });
    mocks.preparation.mockReturnValue({});
  });

  it('communications POST carries canonical mutation scope', async () => {
    const response = await communicationsPOST(new Request('http://localhost/communications', { method: 'POST' }), context);
    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith(access.bookingId, expectedScope);
    expect(mocks.listTasks).toHaveBeenCalledWith(access.bookingId, { expectedScope });
    expect(mocks.guestIntake).toHaveBeenCalledWith(record, expectedScope);
    expect(mocks.syncCommunications).toHaveBeenCalledWith(expect.objectContaining({ expectedScope }));
  });

  it('recompute POST carries canonical scope through task and communication sync', async () => {
    const response = await recomputePOST(new Request('http://localhost/recompute', { method: 'POST' }), context);
    expect(response.status).toBe(200);
    expect(mocks.syncTasks).toHaveBeenCalledWith(access.bookingId, { expectedScope });
    expect(mocks.scope).toHaveBeenCalledWith(access.bookingId, expectedScope);
    expect(mocks.listTasks).toHaveBeenCalledWith(access.bookingId, { expectedScope });
    expect(mocks.guestIntake).toHaveBeenCalledWith(record, expectedScope);
    expect(mocks.syncCommunications).toHaveBeenCalledWith(expect.objectContaining({ expectedScope }));
  });

  it.each([
    ['communications', communicationsPOST],
    ['recompute', recomputePOST],
  ] as const)('%s fails closed after ownership changes', async (_name, handler) => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    const response = await handler(new Request('http://localhost/action', { method: 'POST' }), context);
    expect(response.status).toBe(403);
    expect(mocks.syncCommunications).not.toHaveBeenCalled();
  });
});
