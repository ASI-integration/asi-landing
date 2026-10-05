import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOpsAdminSession: vi.fn(),
  requireCrmOperatorSession: vi.fn(),
  requireScopeAccess: vi.fn(),
  requireCheckAccess: vi.fn(),
  requireHoldAccess: vi.fn(),
  requireBlockAccess: vi.fn(),
  supabaseFrom: vi.fn(),
  checkAvailabilityConflict: vi.fn(),
  releaseAvailabilityHold: vi.fn(),
  confirmAvailabilityHold: vi.fn(),
  releaseAvailabilityBlock: vi.fn(),
  getAvailabilityStatus: vi.fn(),
  explainAvailabilityConflict: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession: mocks.requireOpsAdminSession,
  requireCrmOperatorSession: mocks.requireCrmOperatorSession,
}));
vi.mock('@/app/api/dashboard/booking-ops/access', () => ({
  requireBookingOpsApiAvailabilityScopeAccess: mocks.requireScopeAccess,
  requireBookingOpsApiAvailabilityCheckAccess: mocks.requireCheckAccess,
  requireBookingOpsApiAvailabilityHoldAccess: mocks.requireHoldAccess,
  requireBookingOpsApiAvailabilityBlockAccess: mocks.requireBlockAccess,
}));
vi.mock('@/lib/booking-ops/availability-overbooking-protection', () => ({
  checkAvailabilityConflict: mocks.checkAvailabilityConflict,
  confirmAvailabilityHold: mocks.confirmAvailabilityHold,
  createAvailabilityBlock: vi.fn(),
  createAvailabilityHold: vi.fn(),
  expireAvailabilityHolds: vi.fn(),
  releaseAvailabilityBlock: mocks.releaseAvailabilityBlock,
  releaseAvailabilityHold: mocks.releaseAvailabilityHold,
  getAvailabilityStatus: mocks.getAvailabilityStatus,
  explainAvailabilityConflict: mocks.explainAvailabilityConflict,
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.supabaseFrom } }));

import { POST as actionPost } from '../action/route';
import { GET as statusGet } from '../status/route';
import { GET as explainGet } from '../explain/route';

const session = { userId: 'operator-1', email: 'operator@asi.test' };
const access = {
  ok: true as const,
  accountId: 'account-a',
  actorId: 'operator-1',
  bookingId: '30000000-0000-4000-8000-000000000003',
  propertyId: 'property-a',
  propertySetupId: '20000000-0000-4000-8000-000000000002',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOpsAdminSession.mockResolvedValue({ session });
  mocks.requireCrmOperatorSession.mockResolvedValue({ session });
  mocks.requireScopeAccess.mockResolvedValue(access);
  mocks.requireCheckAccess.mockResolvedValue({ ...access, checkId: 'check-a' });
  mocks.requireHoldAccess.mockResolvedValue({ ...access, holdId: '50000000-0000-4000-8000-000000000005' });
  mocks.requireBlockAccess.mockResolvedValue({ ...access, bookingId: null, blockId: '60000000-0000-4000-8000-000000000006' });
  mocks.checkAvailabilityConflict.mockResolvedValue({ status: 'no_conflict' });
  mocks.releaseAvailabilityHold.mockResolvedValue({ id: '50000000-0000-4000-8000-000000000005' });
  mocks.confirmAvailabilityHold.mockResolvedValue({ id: '50000000-0000-4000-8000-000000000005' });
  mocks.releaseAvailabilityBlock.mockResolvedValue({ id: '60000000-0000-4000-8000-000000000006' });
  mocks.getAvailabilityStatus.mockResolvedValue({ conflicts: [], blockers: [] });
  mocks.explainAvailabilityConflict.mockResolvedValue({ id: 'check-a', status: 'no_conflict' });
});

describe('availability route canonical access', () => {
  it('binds conflict checks to canonical account/property/booking scope', async () => {
    const res = await actionPost(new Request('http://localhost/api/dashboard/availability/action', {
      method: 'POST',
      body: JSON.stringify({
        action: 'check_conflict',
        bookingId: access.bookingId,
        propertyId: 'forged-property',
        dateFrom: '2026-10-10',
        dateTo: '2026-10-12',
      }),
    }));

    expect(res.status).toBe(200);
    expect(mocks.requireScopeAccess).toHaveBeenCalledWith(session, expect.objectContaining({
      bookingId: access.bookingId,
      propertyId: 'forged-property',
    }));
    expect(mocks.checkAvailabilityConflict).toHaveBeenCalledWith({
      bookingId: access.bookingId,
      propertySetupId: access.propertySetupId,
      propertyId: access.propertyId,
      dateFrom: '2026-10-10',
      dateTo: '2026-10-12',
    }, { checkType: 'manual_review', accountId: access.accountId });
  });

  it('does not execute availability action when canonical scope fails', async () => {
    mocks.requireScopeAccess.mockResolvedValueOnce({
      ok: false,
      response: new Response('forbidden', { status: 403 }),
    });
    const res = await actionPost(new Request('http://localhost/api/dashboard/availability/action', {
      method: 'POST',
      body: JSON.stringify({ action: 'check_conflict', propertyId: 'foreign-property' }),
    }));

    expect(res.status).toBe(403);
    expect(mocks.checkAvailabilityConflict).not.toHaveBeenCalled();
  });

  it('scopes availability status reads to the authenticated account', async () => {
    const res = await statusGet(new Request(
      `http://localhost/api/dashboard/availability/status?booking_id=${access.bookingId}&property_id=property-a`,
    ));

    expect(res.status).toBe(200);
    expect(mocks.getAvailabilityStatus).toHaveBeenCalledWith({
      bookingId: access.bookingId,
      propertySetupId: access.propertySetupId,
      propertyId: access.propertyId,
    }, { dateFrom: null, dateTo: null }, { accountId: access.accountId });
  });

  it('revalidates check ownership before explaining a conflict', async () => {
    const res = await explainGet(new Request(
      'http://localhost/api/dashboard/availability/explain?check_id=check-a',
    ));

    expect(res.status).toBe(200);
    expect(mocks.requireCheckAccess).toHaveBeenCalledWith(session, 'check-a');
    expect(mocks.explainAvailabilityConflict).toHaveBeenCalledWith(
      { checkId: 'check-a' },
      access.accountId,
      { propertyId: access.propertyId },
    );
  });

  it('derives release-hold scope from the hold instead of trusting request property scope', async () => {
    const holdId = '50000000-0000-4000-8000-000000000005';
    const res = await actionPost(new Request('http://localhost/api/dashboard/availability/action', {
      method: 'POST',
      body: JSON.stringify({
        action: 'release_hold',
        holdId,
        propertyId: 'forged-property',
      }),
    }));

    expect(res.status).toBe(200);
    expect(mocks.requireHoldAccess).toHaveBeenCalledWith(session, holdId);
    expect(mocks.requireScopeAccess).not.toHaveBeenCalled();
    expect(mocks.releaseAvailabilityHold).toHaveBeenCalledWith(
      holdId,
      undefined,
      access.accountId,
      { propertyId: access.propertyId, propertySetupId: access.propertySetupId },
    );
  });

  it('guards mark-needs-review writes with canonical property scope', async () => {
    const query: Record<string, any> = {};
    query.update = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.select = vi.fn(() => query);
    query.maybeSingle = vi.fn().mockResolvedValue({ data: { id: access.bookingId }, error: null });
    mocks.supabaseFrom.mockReturnValue(query);

    const res = await actionPost(new Request('http://localhost/api/dashboard/availability/action', {
      method: 'POST',
      body: JSON.stringify({ action: 'mark_needs_review', bookingId: access.bookingId }),
    }));

    expect(res.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('id', access.bookingId);
    expect(query.eq).toHaveBeenCalledWith('account_id', access.accountId);
    expect(query.eq).toHaveBeenCalledWith('property_id', access.propertyId);
  });

  it('guards add-note reads and writes with canonical property scope', async () => {
    const readQuery: Record<string, any> = {};
    readQuery.eq = vi.fn(() => readQuery);
    readQuery.maybeSingle = vi.fn().mockResolvedValue({ data: { warnings: ['existing'] }, error: null });
    const readSource = { select: vi.fn(() => readQuery) };

    const writeQuery: Record<string, any> = {};
    writeQuery.eq = vi.fn(() => writeQuery);
    writeQuery.select = vi.fn(() => writeQuery);
    writeQuery.single = vi.fn().mockResolvedValue({ data: { id: 'check-a', warnings: ['existing', 'note'] }, error: null });
    const writeSource = { update: vi.fn(() => writeQuery) };

    mocks.supabaseFrom.mockReset();
    mocks.supabaseFrom.mockReturnValueOnce(readSource).mockReturnValueOnce(writeSource);

    const res = await actionPost(new Request('http://localhost/api/dashboard/availability/action', {
      method: 'POST',
      body: JSON.stringify({ action: 'add_note', checkId: 'check-a', note: 'note' }),
    }));

    expect(res.status).toBe(200);
    expect(mocks.requireCheckAccess).toHaveBeenCalledWith(session, 'check-a');
    expect(readQuery.eq).toHaveBeenCalledWith('property_id', access.propertyId);
    expect(writeQuery.eq).toHaveBeenCalledWith('property_id', access.propertyId);
  });

  it('derives release-block scope from the block before mutation', async () => {
    const blockId = '60000000-0000-4000-8000-000000000006';
    const res = await actionPost(new Request('http://localhost/api/dashboard/availability/action', {
      method: 'POST',
      body: JSON.stringify({
        action: 'release_block',
        blockId,
        propertyId: 'forged-property',
      }),
    }));

    expect(res.status).toBe(200);
    expect(mocks.requireBlockAccess).toHaveBeenCalledWith(session, blockId);
    expect(mocks.releaseAvailabilityBlock).toHaveBeenCalledWith(
      blockId,
      undefined,
      access.accountId,
      { propertyId: access.propertyId, propertySetupId: access.propertySetupId },
    );
  });
});
