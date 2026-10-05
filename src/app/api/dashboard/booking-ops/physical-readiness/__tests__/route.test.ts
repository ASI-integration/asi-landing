import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), lifecycle: vi.fn(),
  flow: Object.fromEntries([
    'ensurePhysicalTasks', 'recomputePhysicalReadiness', 'updateCleaningTask', 'updateLinenTask',
    'updateSuppliesTask', 'createMaintenanceTicket', 'updateMaintenanceTicket',
    'createPhysicalCoordinationDraft', 'approveFinalPhysicalReadiness', 'getPhysicalReadiness',
  ].map(name => [name, vi.fn()])),
}));
vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: mocks.auth, requireOpsAdminSession: mocks.auth,
}));
vi.mock('../../access', () => ({ requireBookingOpsApiAccess: mocks.access }));
vi.mock('@/lib/booking-ops/physical-readiness-execution', () => mocks.flow);
vi.mock('@/lib/booking-ops/lifecycle-entry-adapter', () => ({ emitPhysicalLifecycle: mocks.lifecycle }));
import { GET, POST } from '../route';
const canonical = { ok: true, bookingId: 'canonical-booking', accountId: 'account-a', propertyId: 'property-a' };
const scope = { accountId: canonical.accountId, propertyId: canonical.propertyId };
const actions = [
  ['ensure_tasks', 'ensurePhysicalTasks'], ['recompute', 'recomputePhysicalReadiness'],
  ['update_cleaning', 'updateCleaningTask'], ['update_linen', 'updateLinenTask'],
  ['update_supplies', 'updateSuppliesTask'], ['create_maintenance', 'createMaintenanceTicket'],
  ['update_maintenance', 'updateMaintenanceTicket'], ['create_draft', 'createPhysicalCoordinationDraft'],
  ['final_approval', 'approveFinalPhysicalReadiness'],
] as const;
function request(action = 'ensure_tasks') {
  return new Request('http://localhost/api/dashboard/booking-ops/physical-readiness', {
    method: 'POST', body: JSON.stringify({ action, bookingId: 'request-booking',
      accountId: 'attacker', propertyId: 'attacker', expectedScope: { accountId: 'attacker' } }),
  });
}
describe('physical readiness protected canonical API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ session: { userId: 'operator', email: 'operator@asi.test' } });
    mocks.access.mockResolvedValue(canonical);
  });
  it.each([
    ['GET', () => GET(new Request('http://localhost/?bookingId=x'))],
    ['POST', () => POST(request())],
  ])('returns 401 for unauthorized %s', async (_name, call) => {
    mocks.auth.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 401 }) });
    expect((await call()).status).toBe(401);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each(actions)('binds %s and lifecycle to canonical scope', async (action, fn) => {
    expect((await POST(request(action))).status).toBe(200);
    expect(mocks.flow[fn].mock.calls[0][0]).toBe(canonical.bookingId);
    expect(mocks.flow[fn].mock.calls[0].at(-1)).toEqual(scope);
    expect(mocks.lifecycle).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: canonical.bookingId, expectedScope: scope,
    }));
  });
  it('binds the physical snapshot read to canonical scope', async () => {
    expect((await GET(new Request('http://localhost/?bookingId=request-booking'))).status).toBe(200);
    expect(mocks.flow.getPhysicalReadiness).toHaveBeenCalledWith(canonical.bookingId, scope);
  });
  it.each([403, 409])('rejects cross-account/unbound mutations (%s)', async code => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ ok: false }, { status: code }) });
    expect((await POST(request())).status).toBe(code);
    expect(mocks.flow.ensurePhysicalTasks).not.toHaveBeenCalled();
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
});
