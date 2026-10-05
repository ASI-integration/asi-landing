import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  disk: '{"reviewsById":{},"activeReviewIdBySessionId":{}}',
  failWrite: false, failRead: false, pending: '', send: vi.fn(), resume: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: () => true, mkdirSync: () => {}, appendFileSync: () => {},
  readFileSync: () => { if (fake.failRead) throw new Error('EACCES'); return fake.disk; },
  writeFileSync: (_path: string, value: string) => {
    if (fake.failWrite) throw new Error('ENOSPC');
    fake.pending = value;
  },
  renameSync: () => { fake.disk = fake.pending; },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no live DB'); } } }));
vi.mock('../channels', () => ({ getChannelAdapter: () => ({ sendMessage: fake.send }) }));
vi.mock('../conversation-session-engine', () => ({ recoverConversationSessionToActive: fake.resume }));
vi.mock('../session-status', () => ({ SessionStatus: { Active: 'active' }, transitionSessionStatus: fake.resume }));
vi.mock('../idempotency', () => ({ checkAndMarkKey: () => false }));
vi.mock('../audit', () => ({ auditLog: vi.fn(), auditError: vi.fn(), auditDuplicateOutboundPrevented: vi.fn() }));
const input = { accountId: 'A', sessionId: 'shared', channel: 'telegram' as const,
  targetId: '42', actorId: 'guest', escalationReason: 'help' };
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('NODE_ENV', 'production');
  fake.disk = '{"reviewsById":{},"activeReviewIdBySessionId":{}}';
  fake.failWrite = false; fake.failRead = false; fake.send.mockReset().mockResolvedValue(true);
  fake.resume.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe('Wave 0 adversarial persistence and tenancy', () => {
  it.each(['{', '{}', '[]', '{"reviewsById":[],"activeReviewIdBySessionId":{}}'])(
    'rejects corrupt store %s and prevents outbound', async (disk) => {
      fake.disk = disk;
      const store = await import('../operator-review');
      expect(() => store.listEscalationReviews()).toThrow('operator_review_store_unhealthy');
      await expect(store.sendOperatorReply({ reviewId: 'x', operatorId: 'op', replyText: 'x' }))
        .rejects.toThrow('operator_review_store_unhealthy');
      expect(fake.send).not.toHaveBeenCalled();
    });
  it('read failure stays unhealthy on repeated reads', async () => {
    fake.failRead = true;
    const store = await import('../operator-review');
    expect(() => store.listEscalationReviews()).toThrow();
    fake.failRead = false;
    expect(() => store.listEscalationReviews()).toThrow('operator_review_store_unhealthy');
  });
  it('failed release cannot return success or resume automation; old disk survives', async () => {
    const store = await import('../operator-review');
    const review = store.createOrUpdateEscalationReview(input);
    const before = fake.disk;
    fake.failWrite = true;
    expect(() => store.forceCloseActiveReviewForSession({
      sessionId: input.sessionId, expectedReviewId: review.reviewId, operatorId: 'op', reason: 'release',
    })).toThrow('operator_review_store_unhealthy');
    expect(fake.resume).not.toHaveBeenCalled();
    expect(fake.disk).toBe(before);
    expect(() => store.getEscalationReview(review.reviewId)).toThrow('operator_review_store_unhealthy');
  });
  it.each([null, 'B'])('cannot update A through shared session with account %s', async (accountId) => {
    const store = await import('../operator-review');
    const review = store.createOrUpdateEscalationReview(input);
    expect(() => store.createOrUpdateEscalationReview({ ...input, accountId, detail: 'foreign' }))
      .toThrow('review_account_mismatch');
    expect(store.getEscalationReview(review.reviewId)?.detail).toBeUndefined();
  });
  it('cannot adopt an unbound legacy review', async () => {
    const store = await import('../operator-review');
    store.createOrUpdateEscalationReview({ ...input, accountId: null });
    expect(() => store.createOrUpdateEscalationReview(input)).toThrow('review_account_mismatch');
  });
  it('old authorized review cannot release, acknowledge or send into a new tenant session', async () => {
    const store = await import('../operator-review');
    const a = store.createOrUpdateEscalationReview(input);
    store.closeEscalationReview(a.reviewId, 'op-A');
    const b = store.createOrUpdateEscalationReview({ ...input, accountId: 'B' });
    fake.resume.mockClear();
    expect(() => store.forceCloseActiveReviewForSession({
      sessionId: 'shared', expectedReviewId: a.reviewId, operatorId: 'op-A', reason: 'release',
    })).toThrow('review_session_mismatch');
    expect(() => store.acknowledgeEscalationReview(a.reviewId, 'op-A')).toThrow('review_session_mismatch');
    await expect(store.sendOperatorReply({ reviewId: a.reviewId, operatorId: 'op-A', replyText: 'x' }))
      .rejects.toThrow('review_session_mismatch');
    expect(store.getEscalationReview(b.reviewId)?.status).toBe('pending');
    expect(fake.send).not.toHaveBeenCalled(); expect(fake.resume).not.toHaveBeenCalled();
  });
  it('rechecks session ownership after the outbound await', async () => {
    const store = await import('../operator-review');
    const a = store.createOrUpdateEscalationReview(input);
    let complete!: (sent: boolean) => void;
    fake.send.mockImplementationOnce(() => new Promise<boolean>((resolve) => { complete = resolve; }));
    const sending = store.sendOperatorReply({ reviewId: a.reviewId, operatorId: 'op-A', replyText: 'x' });
    store.closeEscalationReview(a.reviewId, 'op-A');
    const b = store.createOrUpdateEscalationReview({ ...input, accountId: 'B' });
    fake.resume.mockClear();
    complete(true);
    await expect(sending).rejects.toThrow('review_session_mismatch');
    expect(store.getActiveEscalationReviewIdForSession('shared')).toBe(b.reviewId);
    expect(fake.resume).not.toHaveBeenCalled();
  });
  it('missing active index cannot silently unlock a pending review after restart', async () => {
    let store = await import('../operator-review');
    store.createOrUpdateEscalationReview(input);
    const saved = JSON.parse(fake.disk); saved.activeReviewIdBySessionId = {};
    fake.disk = JSON.stringify(saved); vi.resetModules();
    store = await import('../operator-review');
    expect(() => store.getActiveEscalationReviewIdForSession('shared'))
      .toThrow('operator_review_store_unhealthy');
  });
});
