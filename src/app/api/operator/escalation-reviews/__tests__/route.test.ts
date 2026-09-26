import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { _resetForTesting } from '@/lib/communication/idempotency';
import {
  __resetEscalationReviewStoreForTests,
  __setOperatorReviewStoreHealthForTests,
} from '@/lib/communication/operator-review';
import { requestOperatorHandoff } from '@/lib/communication/handoff-lock';

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'op_list_route_1', email: 'op@example.com' })),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }),
      }),
    }),
  },
}));

vi.mock('@/lib/communication/channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => {
      throw new Error('not used');
    },
    sendMessage: async () => true,
    formatResponse: (raw: string) => raw,
  }),
}));

describe('GET /api/operator/escalation-reviews', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetEscalationReviewStoreForTests();
  });

  it('returns 200 with reviews when the store is healthy', async () => {
    requestOperatorHandoff({
      sessionId: 'sess_list_healthy',
      channel: 'telegram',
      targetId: '1',
      escalationReason: 'REQUIRES_OPERATOR',
    });

    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.reviews.length).toBe(1);
  });

  it('returns explicit 503 instead of a truthful-looking empty list when the store is unavailable', async () => {
    __setOperatorReviewStoreHealthForTests('unavailable');

    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ ok: false, error: 'operator_review_store_unavailable' });
  });
});
