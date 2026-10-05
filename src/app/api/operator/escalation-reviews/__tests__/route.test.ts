import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  __resetEscalationReviewStoreForTests,
  __setEscalationReviewStoreHealthForTests,
  createOrUpdateEscalationReview,
} from '@/lib/communication/operator-review';

const mocks = vi.hoisted(() => ({ accountId: 'account-a' as string | null }));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'operator-1', email: 'operator@example.com' })),
}));

vi.mock('@/lib/accounts', () => ({
  resolveAccountIdForUser: vi.fn(async () => mocks.accountId),
}));

describe('GET /api/operator/escalation-reviews tenant scoping', () => {
  beforeEach(() => {
    __resetEscalationReviewStoreForTests();
    mocks.accountId = 'account-a';
  });

  it('returns only reviews owned by the authenticated account', async () => {
    createOrUpdateEscalationReview({
      accountId: 'account-a',
      sessionId: 'sess-a',
      channel: 'telegram',
      targetId: '1',
      escalationReason: 'A',
    });
    createOrUpdateEscalationReview({
      accountId: 'account-b',
      sessionId: 'sess-b',
      channel: 'telegram',
      targetId: '2',
      escalationReason: 'B',
    });
    createOrUpdateEscalationReview({
      sessionId: 'sess-unbound',
      channel: 'telegram',
      targetId: '3',
      escalationReason: 'UNBOUND',
    });

    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({ accountId: 'account-a', sessionId: 'sess-a' });
  });

  it('returns 503 when review persistence is unhealthy', async () => {
    __setEscalationReviewStoreHealthForTests(false);
    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));
    expect(res.status).toBe(503);
  });

  it('fails closed when account workspace cannot be resolved', async () => {
    mocks.accountId = null;
    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));
    expect(res.status).toBe(403);
  });
});
