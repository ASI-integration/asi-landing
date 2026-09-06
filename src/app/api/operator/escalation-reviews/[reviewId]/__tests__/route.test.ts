import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { _resetForTesting } from '@/lib/communication/idempotency';
import {
  canAiReply,
  getHandoffLockState,
  HandoffLockState,
  requestOperatorHandoff,
} from '@/lib/communication/handoff-lock';
import {
  __resetEscalationReviewStoreForTests,
  __setOperatorReviewStoreHealthForTests,
} from '@/lib/communication/operator-review';
import {
  getCommAgentSessionMemory,
  resetCommAgentSessionMemoryForTests,
  updateCommAgentSessionMemory,
} from '@/lib/communication/comm-agent-session-memory';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn(async () => true) }));

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
    sendMessage: mocks.sendMessage,
    formatResponse: (raw: string) => raw,
  }),
}));

describe('PATCH /api/operator/escalation-reviews/[reviewId] acknowledge → lockSessionForOperator', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetEscalationReviewStoreForTests();
    resetCommAgentSessionMemoryForTests();
    mocks.sendMessage.mockClear();
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

  it('send_reply records the approved answer, closes the handoff and resumes AI idempotently', async () => {
    updateCommAgentSessionMemory('telegram', '4244', {
      last_intent: 'maintenance_issue',
      pending_operator_reason: 'maintenance_issue',
      pending_operator_status: 'open',
      unresolved_action: 'maintenance_issue',
      language: 'ru',
    });
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_route_resolve',
      channel: 'telegram',
      targetId: '4244',
      escalationReason: 'maintenance_issue',
      chatId: 4244,
    });

    const { PATCH } = await import('../route');
    const request = () => new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'send_reply', replyText: 'Мастер придёт после 18:00.' }),
      headers: { 'content-type': 'application/json' },
    });
    const first = await PATCH(request(), { params: { reviewId } });
    const firstBody = await first.json();
    const second = await PATCH(request(), { params: { reviewId } });
    const secondBody = await second.json();

    expect(firstBody).toMatchObject({
      ok: true,
      releaseState: 'resolved',
      duplicatePrevented: false,
      review: {
        status: 'closed',
        resolution: {
          operatorId: 'op_route_1',
          reason: 'operator_reply_resolved',
          approvedAnswer: 'Мастер придёт после 18:00.',
        },
      },
    });
    expect(secondBody).toMatchObject({ ok: true, duplicatePrevented: true });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(canAiReply('sess_route_resolve')).toBe(true);
    expect(getCommAgentSessionMemory('telegram', '4244')).toMatchObject({
      pending_operator_reason: null,
      pending_operator_status: 'resolved',
      unresolved_action: null,
      last_safe_reply: 'Мастер придёт после 18:00.',
    });
  });

  describe('operator review store unavailable — fail closed', () => {
    it('GET returns 503 (not 404) instead of treating the review as not found', async () => {
      const { reviewId } = requestOperatorHandoff({
        sessionId: 'sess_route_unavailable_get',
        channel: 'telegram',
        targetId: '5001',
        escalationReason: 'REQUIRES_OPERATOR',
      });
      __setOperatorReviewStoreHealthForTests('unavailable');

      const { GET } = await import('../route');
      const res = await GET(
        new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`),
        { params: { reviewId } },
      );
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body).toEqual({ ok: false, error: 'operator_review_store_unavailable' });
    });

    it('PATCH acknowledge returns 503 and does not mutate state', async () => {
      const { reviewId } = requestOperatorHandoff({
        sessionId: 'sess_route_unavailable_patch',
        channel: 'telegram',
        targetId: '5002',
        escalationReason: 'REQUIRES_OPERATOR',
      });
      __setOperatorReviewStoreHealthForTests('unavailable');

      const { PATCH } = await import('../route');
      const req = new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'acknowledge' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PATCH(req, { params: { reviewId } });
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body).toEqual({ ok: false, error: 'operator_review_store_unavailable' });
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it('PATCH send_reply returns 503 and never calls the channel adapter', async () => {
      const { reviewId } = requestOperatorHandoff({
        sessionId: 'sess_route_unavailable_reply',
        channel: 'telegram',
        targetId: '5003',
        escalationReason: 'REQUIRES_OPERATOR',
      });
      __setOperatorReviewStoreHealthForTests('unavailable');

      const { PATCH } = await import('../route');
      const req = new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'send_reply', replyText: 'hello' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PATCH(req, { params: { reviewId } });
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body).toEqual({ ok: false, error: 'operator_review_store_unavailable' });
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });
});
