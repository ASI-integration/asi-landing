import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { _resetForTesting } from '@/lib/communication/idempotency';
import {
  canAiReply,
  getHandoffLockState,
  HandoffLockState,
  requestOperatorHandoff,
} from '@/lib/communication/handoff-lock';
import { __resetEscalationReviewStoreForTests, __setEscalationReviewStoreHealthForTests } from '@/lib/communication/operator-review';
import {
  getCommAgentSessionMemory,
  resetCommAgentSessionMemoryForTests,
  updateCommAgentSessionMemory,
} from '@/lib/communication/comm-agent-session-memory';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn(async () => true), accountId: 'account-a' as string | null }));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'op_route_1', email: 'op@example.com' })),
}));

vi.mock('@/lib/accounts', () => ({
  resolveAccountIdForUser: vi.fn(async () => mocks.accountId),
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
    mocks.accountId = 'account-a';
  });

  it('acknowledge locks the session for the operator and blocks AI replies', async () => {
    const { reviewId } = requestOperatorHandoff({
      accountId: 'account-a',
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
      accountId: 'account-a',
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
      accountId: 'account-a',
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
});

describe('operator review tenant and store safety', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetEscalationReviewStoreForTests();
    resetCommAgentSessionMemoryForTests();
    mocks.sendMessage.mockClear();
    mocks.accountId = 'account-a';
  });

  it('cross-account send_reply is hidden and makes zero adapter calls', async () => {
    const { reviewId } = requestOperatorHandoff({
      accountId: 'account-b',
      sessionId: 'sess_cross_account',
      channel: 'telegram',
      targetId: '4999',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    const { PATCH } = await import('../route');
    const req = new NextRequest('http://localhost/api/operator/escalation-reviews/' + reviewId, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'send_reply', replyText: 'must not send' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await PATCH(req, { params: { reviewId } });
    expect(res.status).toBe(404);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('legacy unbound review is not readable from an authenticated account', async () => {
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_unbound',
      channel: 'telegram',
      targetId: '5000',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews/' + reviewId), {
      params: { reviewId },
    });
    expect(res.status).toBe(404);
  });

  it('unhealthy review store returns 503 and keeps AI fail-closed', async () => {
    const { reviewId } = requestOperatorHandoff({
      accountId: 'account-a',
      sessionId: 'sess_unhealthy',
      channel: 'telegram',
      targetId: '5001',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    __setEscalationReviewStoreHealthForTests(false);
    expect(canAiReply('sess_unhealthy')).toBe(false);

    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews/' + reviewId), {
      params: { reviewId },
    });
    expect(res.status).toBe(503);
  });
});
