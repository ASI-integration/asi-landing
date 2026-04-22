import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _resetForTesting } from '../idempotency';
import {
  __resetEscalationReviewStoreForTests,
  acknowledgeEscalationReview,
  approveEscalationReview,
  closeEscalationReview,
  createOrUpdateEscalationReview,
  getActiveEscalationReviewIdForSession,
  getEscalationReview,
  listEscalationReviews,
  sendOperatorReply,
} from '../operator-review';

// Mock Supabase for session-status transitions invoked by close/send
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }),
  },
}));

// Mock channel adapter sendMessage (operator reply path)
const mockSendMessage = vi.fn().mockResolvedValue(true);
vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => {
      throw new Error('normalizeInbound not used in operator review tests');
    },
    sendMessage: (to: string, content: string) => mockSendMessage(to, content),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

describe('operator escalation review store', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetEscalationReviewStoreForTests();
    mockSendMessage.mockClear();
  });

  it('creates a persistent review item and marks it active for the session', () => {
    const review = createOrUpdateEscalationReview({
      sessionId: 'sess_1',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'LOW_INTENT_CONFIDENCE',
      confidence: 0.4,
      latestMessages: [],
    });
    expect(review.reviewId).toBeTruthy();
    expect(review.status).toBe('pending');
    expect(getActiveEscalationReviewIdForSession('sess_1')).toBe(review.reviewId);
  });

  it('allows acknowledge and close transitions', () => {
    const review = createOrUpdateEscalationReview({
      sessionId: 'sess_2',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
      latestMessages: [],
    });
    const ack = acknowledgeEscalationReview(review.reviewId, 'op_1');
    expect(ack.status).toBe('acknowledged');
    const closed = closeEscalationReview(review.reviewId, 'op_1');
    expect(closed.status).toBe('closed');
    expect(getActiveEscalationReviewIdForSession('sess_2')).toBe(null);
  });

  it('sends an operator reply through adapter and records idempotency', async () => {
    const review = createOrUpdateEscalationReview({
      sessionId: 'sess_3',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
      latestMessages: [],
    });

    const res1 = await sendOperatorReply({
      reviewId: review.reviewId,
      operatorId: 'op_2',
      replyText: 'Manual operator reply',
    });
    expect(res1.ok).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage).toHaveBeenCalledWith('42', 'Manual operator reply');

    const res2 = await sendOperatorReply({
      reviewId: review.reviewId,
      operatorId: 'op_2',
      replyText: 'Manual operator reply',
    });
    // Duplicate prevented at outbound idempotency layer
    expect(res2.ok).toBe(true);
    expect(res2.duplicatePrevented).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it('approve marks review approved (without sending)', () => {
    const review = createOrUpdateEscalationReview({
      sessionId: 'sess_4',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
      latestMessages: [],
    });
    const approved = approveEscalationReview(review.reviewId, 'op_3');
    expect(approved.status).toBe('approved');
    const fetched = getEscalationReview(review.reviewId)!;
    expect(fetched.status).toBe('approved');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('lists pending items', () => {
    createOrUpdateEscalationReview({
      sessionId: 'sess_5',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'X',
      latestMessages: [],
    });
    createOrUpdateEscalationReview({
      sessionId: 'sess_6',
      channel: 'telegram',
      targetId: '43',
      escalationReason: 'Y',
      latestMessages: [],
    });
    const pending = listEscalationReviews({ status: 'pending' });
    expect(pending.length).toBe(2);
  });
});

