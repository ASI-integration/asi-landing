import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const PROPERTY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mocks = vi.hoisted(() => ({
  requireCrmOperatorSession: vi.fn(),
  getEscalationReview: vi.fn(),
  resolveGuestMemoryAccountId: vi.fn(),
  assertExactAccountMembership: vi.fn(),
  loadGuestLongTermMemory: vi.fn(),
  upsertGuestPreference: vi.fn(),
  deleteGuestMemoryItem: vi.fn(),
  correctGuestOperationalEvent: vi.fn(),
  forgetGuestLongTermMemory: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: mocks.requireCrmOperatorSession,
}));

vi.mock('@/lib/communication/operator-review', () => ({
  getEscalationReview: mocks.getEscalationReview,
}));

vi.mock('@/lib/communication/guest-memory-account', () => ({
  resolveGuestMemoryAccountId: mocks.resolveGuestMemoryAccountId,
  assertExactAccountMembership: mocks.assertExactAccountMembership,
}));

vi.mock('@/lib/communication/guest-long-term-memory', () => ({
  loadGuestLongTermMemory: mocks.loadGuestLongTermMemory,
  upsertGuestPreference: mocks.upsertGuestPreference,
  deleteGuestMemoryItem: mocks.deleteGuestMemoryItem,
  correctGuestOperationalEvent: mocks.correctGuestOperationalEvent,
  forgetGuestLongTermMemory: mocks.forgetGuestLongTermMemory,
}));

function reviewForAccount(accountId: typeof ACCOUNT_A | typeof ACCOUNT_B) {
  return {
    reviewId: `review-${accountId.slice(0, 8)}`,
    sessionId: `session-${accountId.slice(0, 8)}`,
    channel: 'telegram' as const,
    targetId: '1001',
    propertyId: accountId === ACCOUNT_A ? PROPERTY_A : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    reservationId: `reservation-${accountId.slice(0, 8)}`,
    escalationReason: 'REQUIRES_OPERATOR',
    status: 'pending' as const,
    source: { guest_id: 'guest-shared' },
    latestMessages: [],
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
}

describe('GET/PATCH /api/operator/escalation-reviews/[reviewId]/guest-memory tenant authorization', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requireCrmOperatorSession.mockReset();
    mocks.getEscalationReview.mockReset();
    mocks.resolveGuestMemoryAccountId.mockReset();
    mocks.assertExactAccountMembership.mockReset();
    mocks.loadGuestLongTermMemory.mockReset();
    mocks.upsertGuestPreference.mockReset();
    mocks.deleteGuestMemoryItem.mockReset();
    mocks.correctGuestOperationalEvent.mockReset();
    mocks.forgetGuestLongTermMemory.mockReset();

    mocks.loadGuestLongTermMemory.mockResolvedValue({ profile: null, preferences: [], events: [] });
    mocks.upsertGuestPreference.mockResolvedValue(undefined);
    mocks.deleteGuestMemoryItem.mockResolvedValue(undefined);
    mocks.correctGuestOperationalEvent.mockResolvedValue(undefined);
    mocks.forgetGuestLongTermMemory.mockResolvedValue(undefined);
  });

  it('rejects a signed-in non-CRM user before any memory access', async () => {
    mocks.requireCrmOperatorSession.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: 'Нет доступа к CRM.' }, { status: 403 }),
    });

    const { GET, PATCH } = await import('../route');
    const getRes = await GET(new NextRequest('http://localhost/guest-memory'), {
      params: { reviewId: 'review-denied' },
    });
    const patchRes = await PATCH(
      new NextRequest('http://localhost/guest-memory', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'forget_all' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { reviewId: 'review-denied' } },
    );

    expect(getRes.status).toBe(403);
    expect(patchRes.status).toBe(403);
    expect(mocks.getEscalationReview).not.toHaveBeenCalled();
    expect(mocks.resolveGuestMemoryAccountId).not.toHaveBeenCalled();
    expect(mocks.loadGuestLongTermMemory).not.toHaveBeenCalled();
    expect(mocks.forgetGuestLongTermMemory).not.toHaveBeenCalled();
  });

  it('forbids account A operator from reading or mutating account B memory with zero memory calls', async () => {
    mocks.requireCrmOperatorSession.mockResolvedValue({
      session: { userId: 'user-a', email: 'operator-a@asi-global.ru' },
    });
    const foreignReview = reviewForAccount(ACCOUNT_B);
    mocks.getEscalationReview.mockReturnValue(foreignReview);
    mocks.resolveGuestMemoryAccountId.mockResolvedValue(ACCOUNT_B);
    mocks.assertExactAccountMembership.mockResolvedValue(false);

    const { GET, PATCH } = await import('../route');
    const getRes = await GET(new NextRequest('http://localhost/guest-memory'), {
      params: { reviewId: foreignReview.reviewId },
    });
    expect(getRes.status).toBe(403);
    expect(mocks.loadGuestLongTermMemory).not.toHaveBeenCalled();

    for (const body of [
      { action: 'correct_preference', key: 'parking', value: 'x' },
      { action: 'delete_preference', itemId: 'pref-1' },
      { action: 'correct_event', itemId: 'event-1', summary: 'x' },
      { action: 'forget_all' },
    ]) {
      mocks.loadGuestLongTermMemory.mockClear();
      mocks.upsertGuestPreference.mockClear();
      mocks.deleteGuestMemoryItem.mockClear();
      mocks.correctGuestOperationalEvent.mockClear();
      mocks.forgetGuestLongTermMemory.mockClear();

      const patchRes = await PATCH(
        new NextRequest('http://localhost/guest-memory', {
          method: 'PATCH',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
        { params: { reviewId: foreignReview.reviewId } },
      );
      expect(patchRes.status).toBe(403);
      expect(mocks.loadGuestLongTermMemory).not.toHaveBeenCalled();
      expect(mocks.upsertGuestPreference).not.toHaveBeenCalled();
      expect(mocks.deleteGuestMemoryItem).not.toHaveBeenCalled();
      expect(mocks.correctGuestOperationalEvent).not.toHaveBeenCalled();
      expect(mocks.forgetGuestLongTermMemory).not.toHaveBeenCalled();
    }

    expect(mocks.assertExactAccountMembership).toHaveBeenCalledWith({
      userId: 'user-a',
      accountId: ACCOUNT_B,
    });
  });

  it('allows the exact account operator to read and forget within that account only', async () => {
    mocks.requireCrmOperatorSession.mockResolvedValue({
      session: { userId: 'user-a', email: 'operator-a@asi-global.ru' },
    });
    const ownReview = reviewForAccount(ACCOUNT_A);
    mocks.getEscalationReview.mockReturnValue(ownReview);
    mocks.resolveGuestMemoryAccountId.mockResolvedValue(ACCOUNT_A);
    mocks.assertExactAccountMembership.mockResolvedValue(true);
    mocks.loadGuestLongTermMemory.mockResolvedValue({
      profile: { guestId: 'guest-shared', preferredLanguage: 'ru' },
      preferences: [],
      events: [],
    });

    const { GET, PATCH } = await import('../route');
    const getRes = await GET(new NextRequest('http://localhost/guest-memory'), {
      params: { reviewId: ownReview.reviewId },
    });
    const getBody = await getRes.json();
    expect(getRes.status).toBe(200);
    expect(getBody).toMatchObject({ ok: true, memory: { profile: { guestId: 'guest-shared' } } });
    expect(mocks.loadGuestLongTermMemory).toHaveBeenCalledWith('guest-shared', ACCOUNT_A);

    const patchRes = await PATCH(
      new NextRequest('http://localhost/guest-memory', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'forget_all' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { reviewId: ownReview.reviewId } },
    );
    const patchBody = await patchRes.json();
    expect(patchRes.status).toBe(200);
    expect(patchBody).toEqual({ ok: true, memory: { profile: null, preferences: [], events: [] } });
    expect(mocks.forgetGuestLongTermMemory).toHaveBeenCalledWith('guest-shared', ACCOUNT_A);
  });

  it('returns 403 when membership lookup fails closed', async () => {
    mocks.requireCrmOperatorSession.mockResolvedValue({
      session: { userId: 'user-a', email: 'operator-a@asi-global.ru' },
    });
    const ownReview = reviewForAccount(ACCOUNT_A);
    mocks.getEscalationReview.mockReturnValue(ownReview);
    mocks.resolveGuestMemoryAccountId.mockResolvedValue(ACCOUNT_A);
    mocks.assertExactAccountMembership.mockResolvedValue(false);

    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/guest-memory'), {
      params: { reviewId: ownReview.reviewId },
    });
    expect(res.status).toBe(403);
    expect(mocks.loadGuestLongTermMemory).not.toHaveBeenCalled();
  });
});
