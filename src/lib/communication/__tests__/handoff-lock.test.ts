import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _resetForTesting } from '../idempotency';
import {
  __resetEscalationReviewStoreForTests,
  acknowledgeEscalationReview,
  getActiveEscalationReviewIdForSession,
} from '../operator-review';
import {
  HandoffLockState,
  canAiReply,
  getHandoffLockState,
  lockSessionForOperator,
  releaseSessionToAi,
  requestOperatorHandoff,
} from '../handoff-lock';

// Supabase is invoked best-effort by session-status.transitionSessionStatus.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }),
  },
}));

// Channel adapter mock (recoverConversationSessionToActive fans out to the engine).
vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => { throw new Error('not used'); },
    sendMessage: async () => true,
    formatResponse: (raw: string) => raw,
  }),
}));

describe('handoff lock — session ownership state machine', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetEscalationReviewStoreForTests();
  });

  it('starts in ai_active and allows AI replies', () => {
    expect(getHandoffLockState('sess_a')).toBe(HandoffLockState.AiActive);
    expect(canAiReply('sess_a')).toBe(true);
  });

  it('complaint/escalation locks the session: state=operator_requested, AI cannot reply', () => {
    const result = requestOperatorHandoff({
      sessionId: 'sess_b',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'PAYMENT_COMPLAINT',
      chatId: 42,
      updateId: 1,
      detail: 'guest reported double charge',
    });

    expect(result.alreadyLocked).toBe(false);
    expect(result.state).toBe(HandoffLockState.OperatorRequested);
    expect(getHandoffLockState('sess_b')).toBe(HandoffLockState.OperatorRequested);
    expect(canAiReply('sess_b')).toBe(false);
    expect(getActiveEscalationReviewIdForSession('sess_b')).toBe(result.reviewId);
  });

  it('AI reply is blocked while operator_active', () => {
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_c',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    const ack = lockSessionForOperator({ reviewId, operatorId: 'op_alpha' });
    expect(ack.state).toBe(HandoffLockState.OperatorActive);
    expect(canAiReply('sess_c')).toBe(false);

    // Direct ack via store should also surface as operator_active.
    acknowledgeEscalationReview(reviewId, 'op_alpha');
    expect(getHandoffLockState('sess_c')).toBe(HandoffLockState.OperatorActive);
  });

  it('repeated lockSessionForOperator acknowledge is idempotent and keeps AI locked', () => {
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_c_idem',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    const first = lockSessionForOperator({ reviewId, operatorId: 'op_alpha' });
    const second = lockSessionForOperator({ reviewId, operatorId: 'op_alpha' });

    expect(first.state).toBe(HandoffLockState.OperatorActive);
    expect(second.state).toBe(HandoffLockState.OperatorActive);
    expect(second.review.reviewId).toBe(first.review.reviewId);
    expect(second.review.status).toBe('acknowledged');
    expect(canAiReply('sess_c_idem')).toBe(false);
  });

  it('duplicate escalation does not duplicate the lock — idempotent', () => {
    const first = requestOperatorHandoff({
      sessionId: 'sess_d',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    expect(first.alreadyLocked).toBe(false);

    const second = requestOperatorHandoff({
      sessionId: 'sess_d',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    expect(second.alreadyLocked).toBe(true);
    expect(second.reviewId).toBe(first.reviewId);
    // Still exactly one active review for the session.
    expect(getActiveEscalationReviewIdForSession('sess_d')).toBe(first.reviewId);
    expect(canAiReply('sess_d')).toBe(false);
  });

  it('release returns session to AI: resolved → returned_to_ai', () => {
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_e',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    lockSessionForOperator({ reviewId, operatorId: 'op_beta' });
    expect(canAiReply('sess_e')).toBe(false);

    const released = releaseSessionToAi({
      sessionId: 'sess_e',
      operatorId: 'op_beta',
      reason: 'resolved_in_chat',
      chatId: 42,
    });
    expect(released.state).toBe(HandoffLockState.Resolved);
    expect(released.closedReviewId).toBe(reviewId);

    // Subsequent reads collapse to returned_to_ai (AI may resume).
    expect(getHandoffLockState('sess_e')).toBe(HandoffLockState.ReturnedToAi);
    expect(canAiReply('sess_e')).toBe(true);
  });

  it('non-escalation flow stays ai_active and AI may reply', () => {
    expect(getHandoffLockState('sess_f')).toBe(HandoffLockState.AiActive);
    expect(canAiReply('sess_f')).toBe(true);
    // Even after lots of idle reads, never escalated → never locked.
    expect(getHandoffLockState('sess_f')).toBe(HandoffLockState.AiActive);
  });

  it('release on a session with no active review is a no-op', () => {
    const released = releaseSessionToAi({
      sessionId: 'sess_g',
      operatorId: 'op_gamma',
      reason: 'manual_unlock',
    });
    expect(released.closedReviewId).toBe(null);
    // No prior history → still ai_active.
    expect(getHandoffLockState('sess_g')).toBe(HandoffLockState.AiActive);
  });

  it('Telegram flow: simulated inbound dedup does not create a duplicate lock', () => {
    // Two inbound retries for the same update_id would both call requestOperatorHandoff
    // (in real flow inbound idempotency dedups upstream; here we prove the lock layer
    // is also self-defensive).
    const a = requestOperatorHandoff({
      sessionId: 'sess_h',
      channel: 'telegram',
      targetId: '99',
      escalationReason: 'URGENT_ISSUE',
      chatId: 99,
      updateId: 4242,
    });
    const b = requestOperatorHandoff({
      sessionId: 'sess_h',
      channel: 'telegram',
      targetId: '99',
      escalationReason: 'URGENT_ISSUE',
      chatId: 99,
      updateId: 4242,
    });
    expect(a.reviewId).toBe(b.reviewId);
    expect(b.alreadyLocked).toBe(true);
    expect(canAiReply('sess_h')).toBe(false);
  });

  it('after release, a new escalation re-locks (returned_to_ai → operator_requested)', () => {
    const { reviewId } = requestOperatorHandoff({
      sessionId: 'sess_i',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    releaseSessionToAi({ sessionId: 'sess_i', operatorId: 'op_delta', reason: 'done' });
    expect(getHandoffLockState('sess_i')).toBe(HandoffLockState.ReturnedToAi);

    const re = requestOperatorHandoff({
      sessionId: 'sess_i',
      channel: 'telegram',
      targetId: '42',
      escalationReason: 'REQUIRES_OPERATOR',
    });
    expect(re.alreadyLocked).toBe(false);
    expect(re.reviewId).not.toBe(reviewId);
    expect(canAiReply('sess_i')).toBe(false);
  });
});
