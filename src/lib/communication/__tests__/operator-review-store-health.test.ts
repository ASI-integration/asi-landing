import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock Supabase for session-status transitions invoked by close/send.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }),
  },
}));

// Mock channel adapter — not exercised by these tests, but imported transitively.
vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => {
      throw new Error('not used');
    },
    sendMessage: async () => true,
    formatResponse: (raw: string) => raw,
  }),
}));

const REVIEWS_FILENAME = 'asi-comm-escalation-reviews.json';

describe('operator review store — fail closed on corruption', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-review-health-'));
    process.env.COMM_STATE_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.COMM_STATE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('A. healthy valid store loads normally and mutations work', async () => {
    const validStore = {
      reviewsById: {},
      activeReviewIdBySessionId: {},
    };
    fs.writeFileSync(path.join(tmpDir, REVIEWS_FILENAME), JSON.stringify(validStore), 'utf-8');

    const mod = await import('../operator-review');
    mod.__forceReloadOperatorReviewStoreFromDiskForTests();

    expect(mod.getOperatorReviewStoreHealth()).toBe('healthy');
    expect(mod.listEscalationReviews()).toEqual([]);
    expect(() => mod.assertOperatorReviewStoreHealthy()).not.toThrow();

    // Mutations still work normally against a healthy store.
    const review = mod.createOrUpdateEscalationReview({
      sessionId: 'sess_health_a',
      channel: 'telegram',
      targetId: '1',
      escalationReason: 'X',
      latestMessages: [],
    });
    const acked = mod.acknowledgeEscalationReview(review.reviewId, 'op_1');
    expect(acked.status).toBe('acknowledged');
  });

  it('B. corrupt JSON marks the store unavailable and blocks reads/mutations', async () => {
    fs.writeFileSync(path.join(tmpDir, REVIEWS_FILENAME), '{ this is not valid json', 'utf-8');

    const mod = await import('../operator-review');
    mod.__forceReloadOperatorReviewStoreFromDiskForTests();

    expect(mod.getOperatorReviewStoreHealth()).toBe('unavailable');
    expect(() => mod.assertOperatorReviewStoreHealthy()).toThrow(mod.OperatorReviewStoreUnavailableError);

    // Mutations must throw rather than silently succeed against an empty cache.
    expect(() => mod.acknowledgeEscalationReview('any_review_id', 'op_1')).toThrow(
      mod.OperatorReviewStoreUnavailableError,
    );
    await expect(
      mod.sendOperatorReply({ reviewId: 'any_review_id', operatorId: 'op_1', replyText: 'hi' }),
    ).rejects.toThrow(mod.OperatorReviewStoreUnavailableError);
    expect(() =>
      mod.forceCloseActiveReviewForSession({ sessionId: 'sess_x', operatorId: 'op_1', reason: 'r' }),
    ).toThrow(mod.OperatorReviewStoreUnavailableError);

    // The corrupt file on disk must be left untouched — no destructive overwrite.
    const onDisk = fs.readFileSync(path.join(tmpDir, REVIEWS_FILENAME), 'utf-8');
    expect(onDisk).toBe('{ this is not valid json');
  });

  it('C. filesystem read failure marks the store unavailable (fail closed)', async () => {
    // Real, portable read failure: a directory at the store's path exists
    // (fs.existsSync → true) but fs.readFileSync throws EISDIR reading it.
    fs.mkdirSync(path.join(tmpDir, REVIEWS_FILENAME));

    const mod = await import('../operator-review');
    mod.__forceReloadOperatorReviewStoreFromDiskForTests();

    expect(mod.getOperatorReviewStoreHealth()).toBe('unavailable');
    expect(() => mod.assertOperatorReviewStoreHealthy()).toThrow(mod.OperatorReviewStoreUnavailableError);
  });

  it('D. missing file is treated as legitimate empty store, not corruption', async () => {
    // No file written to tmpDir at all.
    const mod = await import('../operator-review');
    mod.__forceReloadOperatorReviewStoreFromDiskForTests();

    expect(mod.getOperatorReviewStoreHealth()).toBe('healthy');
    expect(mod.listEscalationReviews()).toEqual([]);
    expect(() => mod.assertOperatorReviewStoreHealthy()).not.toThrow();
  });

  it('E. once unhealthy, subsequent calls remain fail-closed until explicit reset', async () => {
    fs.writeFileSync(path.join(tmpDir, REVIEWS_FILENAME), 'not json at all', 'utf-8');

    const mod = await import('../operator-review');
    mod.__forceReloadOperatorReviewStoreFromDiskForTests();
    expect(mod.getOperatorReviewStoreHealth()).toBe('unavailable');

    // Fixing the file on disk must NOT silently recover the process —
    // there is no automatic re-read; only explicit reset changes health.
    fs.writeFileSync(
      path.join(tmpDir, REVIEWS_FILENAME),
      JSON.stringify({ reviewsById: {}, activeReviewIdBySessionId: {} }),
      'utf-8',
    );
    expect(mod.getOperatorReviewStoreHealth()).toBe('unavailable');
    expect(() => mod.acknowledgeEscalationReview('x', 'op_1')).toThrow(mod.OperatorReviewStoreUnavailableError);
  });

  it('F. reset helper clears both cache and store-health state', async () => {
    fs.writeFileSync(path.join(tmpDir, REVIEWS_FILENAME), 'not json at all', 'utf-8');

    const mod = await import('../operator-review');
    mod.__forceReloadOperatorReviewStoreFromDiskForTests();
    expect(mod.getOperatorReviewStoreHealth()).toBe('unavailable');

    mod.__resetEscalationReviewStoreForTests();
    expect(mod.getOperatorReviewStoreHealth()).toBe('healthy');
    expect(mod.listEscalationReviews()).toEqual([]);
    expect(() => mod.assertOperatorReviewStoreHealthy()).not.toThrow();
  });
});
