import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { _resetForTesting } from '@/lib/communication/idempotency';
import {
  canAiReply,
  getHandoffLockState,
  HandoffLockState,
  requestOperatorHandoff,
} from '@/lib/communication/handoff-lock';
import { __resetEscalationReviewStoreForTests } from '@/lib/communication/operator-review';

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'op_route_1', email: 'op@example.com' })),
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

describe('PATCH /api/operator/escalation-reviews/[reviewId] acknowledge → lockSessionForOperator', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetEscalationReviewStoreForTests();
  });

  it('acknowledge locks the session for the operator and blocks AI replies', async () => {
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_route_ack',
      channel: 'telegram',
      targetId: '4242',
      escalationReason: 'REQUIRES_OPERATOR',
      chatId: 4242,
    });
    expect(getHandoffLockState('sess_route_ack')).toBe(HandoffLockState.OperatorRequested);
    expect(canAiReply('sess_route_ack')).toBe(false);

    const { PATCH } = await import('../route');
    const req = new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'acknowledge' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await PATCH(req, { params: { reviewId } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      review: expect.objectContaining({
        reviewId,
        status: 'acknowledged',
      }),
    });
    expect(getHandoffLockState('sess_route_ack')).toBe(HandoffLockState.OperatorActive);
    expect(canAiReply('sess_route_ack')).toBe(false);
  });

  it('repeated acknowledge stays operator_active (idempotent lock)', async () => {
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_route_ack_idem',
      channel: 'telegram',
      targetId: '4243',
      escalationReason: 'REQUIRES_OPERATOR',
      chatId: 4243,
    });

    const { PATCH } = await import('../route');
    const makeReq = () =>
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'acknowledge' }),
        headers: { 'content-type': 'application/json' },
      });

    const first = await PATCH(makeReq(), { params: { reviewId } });
    const firstBody = await first.json();
    const second = await PATCH(makeReq(), { params: { reviewId } });
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.review.status).toBe('acknowledged');
    expect(secondBody.review.status).toBe('acknowledged');
    expect(secondBody.review.reviewId).toBe(firstBody.review.reviewId);
    expect(getHandoffLockState('sess_route_ack_idem')).toBe(HandoffLockState.OperatorActive);
    expect(canAiReply('sess_route_ack_idem')).toBe(false);
  });
});
