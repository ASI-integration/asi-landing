import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  __resetEscalationReviewStoreForTests,
  __setEscalationReviewStoreHealthForTests,
  createOrUpdateEscalationReview,
} from '@/lib/communication/operator-review';

const mocks = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  loadMemory: vi.fn(async (_arg: unknown) => ({ profile: null, preferences: [], events: [] })),
  upsertPreference: vi.fn(async (_arg: unknown) => undefined),
  deleteItem: vi.fn(async (_arg: unknown) => undefined),
  correctEvent: vi.fn(async (_arg: unknown) => undefined),
  forgetAll: vi.fn(async (_arg: unknown) => undefined),
}));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'operator-1', email: 'operator@example.com' })),
}));

vi.mock('@/lib/accounts', () => ({
  resolveAccountIdForUser: vi.fn(async () => mocks.accountId),
}));

vi.mock('@/lib/communication/guest-long-term-memory', () => ({
  loadGuestLongTermMemory: (arg: unknown) => mocks.loadMemory(arg),
  upsertGuestPreference: (arg: unknown) => mocks.upsertPreference(arg),
  deleteGuestMemoryItem: (arg: unknown) => mocks.deleteItem(arg),
  correctGuestOperationalEvent: (arg: unknown) => mocks.correctEvent(arg),
  forgetGuestLongTermMemory: (arg: unknown) => mocks.forgetAll(arg),
}));

describe('operator guest-memory tenant boundary', () => {
  beforeEach(() => {
    __resetEscalationReviewStoreForTests();
    mocks.accountId = 'account-a';
    mocks.loadMemory.mockClear();
    mocks.upsertPreference.mockClear();
    mocks.deleteItem.mockClear();
    mocks.correctEvent.mockClear();
    mocks.forgetAll.mockClear();
  });

  it('reads memory only through the authenticated account scope', async () => {
    const review = createOrUpdateEscalationReview({
      accountId: 'account-a',
      sessionId: 'memory-same-account',
      channel: 'telegram',
      targetId: '1',
      escalationReason: 'REQUIRES_OPERATOR',
      source: { guest_id: 'guest-1' },
    });
    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost'), { params: { reviewId: review.reviewId } });

    expect(res.status).toBe(200);
    expect(mocks.loadMemory).toHaveBeenCalledOnce();
    expect(mocks.loadMemory).toHaveBeenCalledWith({ accountId: 'account-a', guestId: 'guest-1' });
  });

  it('hides a foreign review before any guest-memory read', async () => {
    const review = createOrUpdateEscalationReview({
      accountId: 'account-b',
      sessionId: 'memory-cross-account',
      channel: 'telegram',
      targetId: '2',
      escalationReason: 'REQUIRES_OPERATOR',
      source: { guest_id: 'guest-shared' },
    });
    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost'), { params: { reviewId: review.reviewId } });

    expect(res.status).toBe(404);
    expect(mocks.loadMemory).not.toHaveBeenCalled();
  });

  it('blocks cross-account memory mutation before write adapters', async () => {
    const review = createOrUpdateEscalationReview({
      accountId: 'account-b',
      sessionId: 'memory-cross-account-patch',
      channel: 'telegram',
      targetId: '3',
      escalationReason: 'REQUIRES_OPERATOR',
      source: { guest_id: 'guest-shared' },
    });
    const { PATCH } = await import('../route');
    const req = new NextRequest('http://localhost', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'correct_preference', key: 'parking', value: 'needed' }),
    });
    const res = await PATCH(req, { params: { reviewId: review.reviewId } });

    expect(res.status).toBe(404);
    expect(mocks.upsertPreference).not.toHaveBeenCalled();
    expect(mocks.loadMemory).not.toHaveBeenCalled();
  });

  it('returns 503 and touches no memory when the review store is unhealthy', async () => {
    const review = createOrUpdateEscalationReview({
      accountId: 'account-a',
      sessionId: 'memory-unhealthy',
      channel: 'telegram',
      targetId: '4',
      escalationReason: 'REQUIRES_OPERATOR',
      source: { guest_id: 'guest-1' },
    });
    __setEscalationReviewStoreHealthForTests(false);
    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost'), { params: { reviewId: review.reviewId } });

    expect(res.status).toBe(503);
    expect(mocks.loadMemory).not.toHaveBeenCalled();
  });
});
