import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), scope: vi.fn(), create: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession: mocks.auth, requireOpsAdminSession: mocks.auth }));
vi.mock('../access', () => ({ requireBookingOpsApiAccess: mocks.access }));
vi.mock('@/lib/booking-ops/repository', () => ({ requireBookingOpsRecordScope: mocks.scope }));
vi.mock('@/lib/booking-ops/tasks', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/booking-ops/tasks')>(),
  createBookingOpsTask: mocks.create, listBookingOpsTasksForRecord: mocks.list,
}));
import { GET, POST } from '../[id]/tasks/route';
const context = { params: { id: 'requested-id' } };
const canonical = { ok: true, bookingId: 'canonical-ops', accountId: 'account-a', propertyId: 'property-a' };
const scope = { accountId: canonical.accountId, propertyId: canonical.propertyId };
function request(payload: Record<string, unknown> = {}) {
  return new Request('http://localhost/tasks', { method: 'POST', body: JSON.stringify({
    taskType: 'cleaning_needed', bookingId: 'foreign-source', booking_ops_record_id: 'foreign-ops',
    accountId: 'foreign-account', propertyId: 'foreign-property',
    metadata: { accountId: 'foreign-account' }, ...payload,
  }) });
}
describe('manual task creation canonical scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ session: { email: 'operator' } });
    mocks.access.mockResolvedValue(canonical);
    mocks.scope.mockResolvedValue({ id: canonical.bookingId, bookingId: 'canonical-source' });
    mocks.create.mockResolvedValue({ ok: true, created: true, task: { id: 'task-a' } });
    mocks.list.mockResolvedValue({ ok: true, tasks: [] });
  });
  it.each(['bookingId', 'booking_id'])('ignores payload %s and carries canonical scope into the domain', async key => {
    expect((await POST(request({ bookingId: undefined, [key]: 'foreign-source' }), context)).status).toBe(201);
    expect(mocks.scope).toHaveBeenCalledWith(canonical.bookingId, scope);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      bookingOpsRecordId: canonical.bookingId, bookingId: 'canonical-source', source: 'manual',
    }), { expectedScope: scope });
  });
  it('uses canonical ID for task listing', async () => {
    expect((await GET(new Request('http://localhost/tasks'), context)).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(canonical.bookingId);
  });
  it.each([403, 409])('rejects denied or unbound access (%s) before any domain work', async status => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ ok: false }, { status }) });
    expect((await POST(request(), context)).status).toBe(status);
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects an ownership change after route authorization before mutation', async () => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('fails closed if domain execution detects a later ownership change', async () => {
    mocks.create.mockRejectedValue(new Error('booking_scope_mismatch'));
    expect((await POST(request(), context)).status).toBe(403);
  });
  it('preserves idempotent reuse response', async () => {
    mocks.create.mockResolvedValue({ ok: true, created: false, task: { id: 'task-a' } });
    expect((await POST(request(), context)).status).toBe(200);
  });
});
