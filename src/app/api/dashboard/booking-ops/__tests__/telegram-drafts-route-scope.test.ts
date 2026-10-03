import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  operatorAuth: vi.fn(),
  adminAuth: vi.fn(),
  access: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: mocks.operatorAuth,
  requireOpsAdminSession: mocks.adminAuth,
}));

vi.mock('../access', () => ({
  requireBookingOpsApiAccess: mocks.access,
}));

vi.mock('@/lib/booking-ops/telegram-drafts', () => ({
  listBookingOpsTelegramDrafts: mocks.list,
  createTelegramDraftFromBookingOpsAction: mocks.create,
  updateBookingOpsTelegramDraftStatus: mocks.update,
}));

import { GET, PATCH, POST } from '../[id]/telegram-drafts/route';

const context = { params: { id: 'requested-ops' } };
const canonical = {
  ok: true,
  bookingId: 'canonical-ops',
  accountId: 'account-a',
  propertyId: 'property-a',
};
const expectedScope = { accountId: 'account-a', propertyId: 'property-a' };

describe('telegram drafts canonical scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const session = { email: 'operator@asi.test', userId: 'operator-a' };
    mocks.operatorAuth.mockResolvedValue({ session });
    mocks.adminAuth.mockResolvedValue({ session });
    mocks.access.mockResolvedValue(canonical);
    mocks.list.mockResolvedValue({ ok: true, drafts: [] });
    mocks.create.mockResolvedValue({ ok: true, draft: { id: 'draft-a' } });
    mocks.update.mockResolvedValue({ ok: true, draft: { id: 'draft-a', status: 'copied' } });
  });

  it('GET uses canonical record id and execution scope', async () => {
    const response = await GET(new Request('http://localhost/telegram-drafts'), context);
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(canonical.bookingId, { expectedScope });
  });

  it('POST creates only in canonical scope', async () => {
    const response = await POST(new Request('http://localhost/telegram-drafts', {
      method: 'POST',
      body: JSON.stringify({ actionId: 'request_guest_documents' }),
    }), context);
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      canonical.bookingId,
      'request_guest_documents',
      { createdBy: 'operator@asi.test', expectedScope },
    );
  });

  it('PATCH binds draft status mutation to canonical scope', async () => {
    const response = await PATCH(new Request('http://localhost/telegram-drafts', {
      method: 'PATCH',
      body: JSON.stringify({ draftId: 'draft-a', status: 'copied' }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      canonical.bookingId,
      'draft-a',
      'copied',
      { expectedScope },
    );
  });

  it('GET fails closed on execution-time scope mismatch', async () => {
    mocks.list.mockRejectedValue(new Error('booking_scope_mismatch'));
    const response = await GET(new Request('http://localhost/telegram-drafts'), context);
    expect(response.status).toBe(403);
  });

  it('POST fails closed on execution-time scope mismatch', async () => {
    mocks.create.mockRejectedValue(new Error('booking_scope_mismatch'));
    const response = await POST(new Request('http://localhost/telegram-drafts', {
      method: 'POST',
      body: JSON.stringify({ actionId: 'request_guest_documents' }),
    }), context);
    expect(response.status).toBe(403);
  });

  it('PATCH fails closed on execution-time scope mismatch', async () => {
    mocks.update.mockRejectedValue(new Error('booking_scope_mismatch'));
    const response = await PATCH(new Request('http://localhost/telegram-drafts', {
      method: 'PATCH',
      body: JSON.stringify({ draftId: 'draft-a', status: 'copied' }),
    }), context);
    expect(response.status).toBe(403);
  });

  it('stops before domain work when shared access denies', async () => {
    mocks.access.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ ok: false }, { status: 403 }),
    });
    const response = await POST(new Request('http://localhost/telegram-drafts', {
      method: 'POST',
      body: JSON.stringify({ actionId: 'request_guest_documents' }),
    }), context);
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
