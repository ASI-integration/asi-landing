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
  createOrUpdateEscalationReview,
  getEscalationReview,
} from '@/lib/communication/operator-review';
import {
  getCommAgentSessionMemory,
  resetCommAgentSessionMemoryForTests,
  updateCommAgentSessionMemory,
} from '@/lib/communication/comm-agent-session-memory';

const mocks = vi.hoisted(() => ({
  authStatus: 'allowed' as 'allowed' | 'unauthenticated' | 'forbidden',
  memberships: ['account-a'],
  propertyAccounts: {} as Record<string, string>,
  bookingBindings: [] as Array<{
    id: string;
    booking_id: string | null;
    asi_reference: string | null;
    account_id: string;
    property_id: string | null;
  }>,
  legacyReservations: [] as Array<{
    id: string;
    booking_id: string | null;
    reservation_ref: string | null;
    property_id: string;
  }>,
  legacyPropertyBindings: [] as Array<{
    legacy_property_id: string;
    account_id: string;
    canonical_property_id: string;
  }>,
  sendMessage: vi.fn(async () => true),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => {
    if (mocks.authStatus === 'unauthenticated') {
      return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
    }
    if (mocks.authStatus === 'forbidden') {
      return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { session: { userId: 'op_route_1', email: 'op@example.com' } };
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => table === 'account_members' ? ({
      select: () => ({
        eq: async () => ({ data: mocks.memberships.map((account_id) => ({ account_id })), error: null }),
      }),
    }) : table === 'properties' ? ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          limit: async () => ({
            data: mocks.propertyAccounts[value]
              ? [{ account_id: mocks.propertyAccounts[value] }]
              : [],
            error: null,
          }),
        }),
        in: async (_column: string, values: string[]) => ({
          data: values.flatMap((value) => mocks.propertyAccounts[value]
            ? [{ id: value, account_id: mocks.propertyAccounts[value] }]
            : []),
          error: null,
        }),
      }),
    }) : table === 'booking_ops_records' ? ({
      select: () => ({
        eq: (column: 'id' | 'booking_id' | 'asi_reference', value: string) => ({
          limit: async () => ({
            data: mocks.bookingBindings.filter((row) => row[column] === value),
            error: null,
          }),
        }),
        in: async (column: 'id' | 'booking_id' | 'asi_reference', values: string[]) => ({
          data: mocks.bookingBindings.filter((row) => values.includes(String(row[column] ?? ''))),
          error: null,
        }),
      }),
    }) : table === 'tg_guest_reservations' ? ({
      select: () => ({
        eq: (column: 'id' | 'booking_id' | 'reservation_ref', value: string) => ({
          limit: async () => ({
            data: mocks.legacyReservations.filter((row) => row[column] === value),
            error: null,
          }),
        }),
        in: async (column: 'id' | 'booking_id' | 'reservation_ref', values: string[]) => ({
          data: mocks.legacyReservations.filter((row) => values.includes(String(row[column] ?? ''))),
          error: null,
        }),
      }),
    }) : table === 'legacy_tg_property_bindings' ? ({
      select: () => ({
        eq: (_column: 'legacy_property_id', value: string) => ({
          limit: async () => ({
            data: mocks.legacyPropertyBindings.filter((row) => row.legacy_property_id === value),
            error: null,
          }),
        }),
        in: async (_column: 'legacy_property_id', values: string[]) => ({
          data: mocks.legacyPropertyBindings.filter((row) => values.includes(row.legacy_property_id)),
          error: null,
        }),
      }),
    }) : ({
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
    mocks.authStatus = 'allowed';
    mocks.memberships = ['account-a'];
    mocks.propertyAccounts = {};
    mocks.bookingBindings = [];
    mocks.legacyReservations = [];
    mocks.legacyPropertyBindings = [];
    mocks.sendMessage.mockClear();
  });

  it('returns 401 before reading a review when there is no authenticated session', async () => {
    mocks.authStatus = 'unauthenticated';
    const { GET, PATCH } = await import('../route');
    const res = await GET(
      new NextRequest('http://localhost/api/operator/escalation-reviews/missing'),
      { params: { reviewId: 'missing' } },
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 for every action to an authenticated non-operator without mutation or send', async () => {
    const { reviewId } = requestOperatorHandoff({
      accountId: 'account-a',
      sessionId: 'sess_route_forbidden',
      channel: 'telegram',
      targetId: '4241',
      escalationReason: 'REQUIRES_OPERATOR',
      chatId: 4241,
    });
    mocks.authStatus = 'forbidden';
    const { GET, PATCH } = await import('../route');

    const deniedGet = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`),
      { params: { reviewId } },
    );
    expect(deniedGet.status).toBe(403);

    for (const action of ['acknowledge', 'approve', 'close', 'send_reply', 'return_to_ai']) {
      const res = await PATCH(new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, replyText: 'must not send' }),
        headers: { 'content-type': 'application/json' },
      }), { params: { reviewId } });
      expect(res.status).toBe(403);
    }

    expect(getEscalationReview(reviewId)?.status).toBe('pending');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('returns 403 for a CRM operator when the canonical membership layer is empty', async () => {
    const review = createOrUpdateEscalationReview({
      sessionId: 'sess_empty_canonical_layer',
      channel: 'email',
      targetId: 'known.guest@example.test',
      reservationId: 'legacy-reservation-empty-canonical',
      propertyId: 'test-prop-tg-live',
      escalationReason: 'EMAIL_DRAFT_OPERATOR_REVIEW',
    });
    mocks.memberships = [];
    const beforeDenied = getEscalationReview(review.reviewId);
    const { GET, PATCH } = await import('../route');

    const deniedGet = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${review.reviewId}`),
      { params: { reviewId: review.reviewId } },
    );
    const deniedSend = await PATCH(new NextRequest(
      `http://localhost/api/operator/escalation-reviews/${review.reviewId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'send_reply', replyText: 'must not send' }),
        headers: { 'content-type': 'application/json' },
      },
    ), { params: { reviewId: review.reviewId } });

    expect(deniedGet.status).toBe(403);
    expect(deniedSend.status).toBe(403);
    expect(getEscalationReview(review.reviewId)).toEqual(beforeDenied);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('allows an operator in the same account and denies another account', async () => {
    const propertyId = '11111111-1111-4111-8111-111111111111';
    mocks.propertyAccounts[propertyId] = 'account-a';
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_route_account_scope',
      channel: 'telegram',
      targetId: '4240',
      propertyId,
      escalationReason: 'REQUIRES_OPERATOR',
    });
    const { GET, PATCH } = await import('../route');

    const allowed = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`),
      { params: { reviewId } },
    );
    expect(allowed.status).toBe(200);

    mocks.memberships = ['account-b'];
    const deniedGet = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`),
      { params: { reviewId } },
    );
    const deniedPatch = await PATCH(new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'send_reply', replyText: 'must not send' }),
      headers: { 'content-type': 'application/json' },
    }), { params: { reviewId } });

    expect(deniedGet.status).toBe(403);
    expect(deniedPatch.status).toBe(403);
    expect(getEscalationReview(reviewId)?.status).toBe('pending');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('resolves the production-shaped email review through persisted legacy tenant binding without booking ops', async () => {
    const reservationId = '7e57b9e2-5a39-4c8b-8b0f-2a6c6d5e0201';
    const canonicalPropertyId = '22222222-2222-4222-8222-222222222222';
    mocks.propertyAccounts[canonicalPropertyId] = 'account-a';
    mocks.legacyReservations = [{
      id: reservationId,
      booking_id: null,
      reservation_ref: null,
      property_id: 'test-prop-tg-live',
    }];
    mocks.legacyPropertyBindings = [{
      legacy_property_id: 'test-prop-tg-live',
      account_id: 'account-a',
      canonical_property_id: canonicalPropertyId,
    }];
    const review = createOrUpdateEscalationReview({
      sessionId: 'sess_grounded_email',
      channel: 'email',
      targetId: 'known.guest@example.test',
      reservationId,
      propertyId: 'test-prop-tg-live',
      escalationReason: 'EMAIL_DRAFT_OPERATOR_REVIEW',
      suggestedReply: 'Выезд до 12:00. Ключи оставьте по инструкции из заселения.',
      source: { source: 'email_inbound', outboundMode: 'draft_only' },
    });
    const { GET, PATCH } = await import('../route');
    const { GET: GETCollection } = await import('../../route');

    const allowedGet = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${review.reviewId}`),
      { params: { reviewId: review.reviewId } },
    );
    const allowedAction = await PATCH(new NextRequest(
      `http://localhost/api/operator/escalation-reviews/${review.reviewId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'acknowledge' }),
        headers: { 'content-type': 'application/json' },
      },
    ), { params: { reviewId: review.reviewId } });

    expect(allowedGet.status).toBe(200);
    expect(allowedAction.status).toBe(200);
    const allowedCollection = await GETCollection(
      new NextRequest('http://localhost/api/operator/escalation-reviews'),
    );
    const allowedCollectionBody = await allowedCollection.json();
    expect(allowedCollectionBody.reviews).toEqual([
      expect.objectContaining({ reviewId: review.reviewId, propertyId: 'test-prop-tg-live' }),
    ]);
    expect(getEscalationReview(review.reviewId)).toMatchObject({
      status: 'acknowledged',
      propertyId: 'test-prop-tg-live',
      reservationId,
      suggestedReply: expect.stringContaining('12:00'),
    });

    const beforeDenied = getEscalationReview(review.reviewId);
    mocks.authStatus = 'forbidden';
    const deniedNonOperator = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${review.reviewId}`),
      { params: { reviewId: review.reviewId } },
    );
    expect(deniedNonOperator.status).toBe(403);

    mocks.authStatus = 'allowed';
    mocks.memberships = ['account-b'];
    const deniedGet = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${review.reviewId}`),
      { params: { reviewId: review.reviewId } },
    );
    const deniedSend = await PATCH(new NextRequest(
      `http://localhost/api/operator/escalation-reviews/${review.reviewId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'send_reply', replyText: 'must not send' }),
        headers: { 'content-type': 'application/json' },
      },
    ), { params: { reviewId: review.reviewId } });

    expect(deniedGet.status).toBe(403);
    expect(deniedSend.status).toBe(403);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(getEscalationReview(review.reviewId)).toEqual(beforeDenied);
  });

  it('keeps an existing booking-ops-backed text property review accessible', async () => {
    mocks.bookingBindings = [{
      id: '22222222-2222-4222-8222-222222222222',
      booking_id: 'reservation-1',
      asi_reference: null,
      account_id: 'account-a',
      property_id: 'test-prop-tg-live',
    }];
    const review = createOrUpdateEscalationReview({
      sessionId: 'sess_booking_ops_text',
      channel: 'email',
      targetId: 'known.guest@example.test',
      reservationId: 'reservation-1',
      propertyId: 'test-prop-tg-live',
      escalationReason: 'EMAIL_DRAFT_OPERATOR_REVIEW',
    });
    const { GET } = await import('../route');

    const response = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${review.reviewId}`),
      { params: { reviewId: review.reviewId } },
    );

    expect(response.status).toBe(200);
  });

  it('fails closed when the legacy tenant binding is missing or conflicts with canonical/booking evidence', async () => {
    const { GET, PATCH } = await import('../route');
    const reservationId = '7e57b9e2-5a39-4c8b-8b0f-2a6c6d5e0201';
    const canonicalPropertyId = '22222222-2222-4222-8222-222222222222';
    const cases = [
      {
        sessionId: 'missing',
        propertyAccount: 'account-a',
        legacyBindings: [],
        bookingBindings: [],
      },
      {
        sessionId: 'canonical-conflict',
        propertyAccount: 'account-b',
        legacyBindings: [{
          legacy_property_id: 'test-prop-tg-live',
          account_id: 'account-a',
          canonical_property_id: canonicalPropertyId,
        }],
        bookingBindings: [],
      },
      {
        sessionId: 'booking-conflict',
        propertyAccount: 'account-a',
        legacyBindings: [{
          legacy_property_id: 'test-prop-tg-live',
          account_id: 'account-a',
          canonical_property_id: canonicalPropertyId,
        }],
        bookingBindings: [
          { id: 'record-c', booking_id: reservationId, asi_reference: null, account_id: 'account-b', property_id: 'test-prop-tg-live' },
        ],
      },
    ];

    for (const testCase of cases) {
      mocks.propertyAccounts = { [canonicalPropertyId]: testCase.propertyAccount };
      mocks.legacyReservations = [{
        id: reservationId,
        booking_id: null,
        reservation_ref: null,
        property_id: 'test-prop-tg-live',
      }];
      mocks.legacyPropertyBindings = testCase.legacyBindings;
      mocks.bookingBindings = testCase.bookingBindings;
      const review = createOrUpdateEscalationReview({
        sessionId: `sess_text_${testCase.sessionId}`,
        channel: 'email',
        targetId: 'known.guest@example.test',
        reservationId,
        propertyId: 'test-prop-tg-live',
        escalationReason: 'EMAIL_DRAFT_OPERATOR_REVIEW',
      });
      const response = await GET(
        new NextRequest(`http://localhost/api/operator/escalation-reviews/${review.reviewId}`),
        { params: { reviewId: review.reviewId } },
      );
      const beforeDenied = getEscalationReview(review.reviewId);
      const deniedSend = await PATCH(new NextRequest(
        `http://localhost/api/operator/escalation-reviews/${review.reviewId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'send_reply', replyText: 'must not send' }),
          headers: { 'content-type': 'application/json' },
        },
      ), { params: { reviewId: review.reviewId } });
      expect(response.status).toBe(403);
      expect(deniedSend.status).toBe(403);
      expect(getEscalationReview(review.reviewId)).toEqual(beforeDenied);
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    }
  });

  it('fails closed when review tenant scope is missing', async () => {
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_route_missing_scope',
      channel: 'telegram',
      targetId: '4239',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    const { GET, PATCH } = await import('../route');
    const get = await GET(
      new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`),
      { params: { reviewId } },
    );
    const patch = await PATCH(new NextRequest(`http://localhost/api/operator/escalation-reviews/${reviewId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'send_reply', replyText: 'must not send' }),
      headers: { 'content-type': 'application/json' },
    }), { params: { reviewId } });

    expect(get.status).toBe(403);
    expect(patch.status).toBe(403);
    expect(getEscalationReview(reviewId)?.status).toBe('pending');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('returns only reviews from the operator account in the collection', async () => {
    const own = requestOperatorHandoff({
      accountId: 'account-a', sessionId: 'sess_list_a', channel: 'telegram', targetId: '4301', escalationReason: 'test',
    });
    requestOperatorHandoff({
      accountId: 'account-b', sessionId: 'sess_list_b', channel: 'telegram', targetId: '4302', escalationReason: 'test',
    });
    requestOperatorHandoff({
      sessionId: 'sess_list_unresolved', channel: 'telegram', targetId: '4303', escalationReason: 'test',
    });
    const { GET } = await import('../../route');

    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reviews.map((review: { reviewId: string }) => review.reviewId)).toEqual([own.reviewId]);
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
