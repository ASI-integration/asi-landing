import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({
  session: { userId: 'operator', email: 'operator@example.test' },
  allowlist: new Set(['operator@example.test']),
  reviews: [] as Array<Record<string, unknown>>,
  failed: false,
  send: vi.fn(async () => ({ ok: true })),
  lock: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getSession: async () => state.session }));
vi.mock('@/lib/crm/access', () => ({ opsAdminAllowlist: () => state.allowlist }));
vi.mock('../handoff-lock', () => ({ lockSessionForOperator: state.lock }));
vi.mock('../operator-review', () => ({
  listEscalationReviews: () => { if (state.failed) throw new Error('secret'); return state.reviews; },
  getEscalationReview: (id: string) => { if (state.failed) throw new Error('secret'); return state.reviews.find((r) => r.reviewId === id); },
  sendOperatorReply: state.send,
}));
import { GET, POST } from '@/app/api/operator/unidentified-reviews/route';
describe('platform unidentified conversation quarantine', () => {
  beforeEach(() => {
    state.session = { userId: 'operator', email: 'operator@example.test' };
    state.allowlist = new Set(['operator@example.test']);
    state.reviews = [
      { reviewId: 'unbound', accountId: null, sessionId: 's', channel: 'telegram', status: 'pending',
        updatedAt: 'now', targetId: 'sensitive-target', suggestedReply: 'password=secret' },
      { reviewId: 'foreign', accountId: 'b', sessionId: 's-b', status: 'pending' },
      { reviewId: 'closed', accountId: null, status: 'closed' },
    ];
    state.failed = false; state.lock.mockClear(); state.send.mockClear();
    state.send.mockResolvedValue({ ok: true });
  });
  const post = (body: unknown) => POST(new NextRequest('http://local/api/operator/unidentified-reviews', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }));
  it('shows unbound active identifiers only, with no guest content or credentials', async () => {
    const response = await GET(); const body = await response.json();
    expect(body.items).toEqual([{ reviewId: 'unbound', channel: 'telegram', status: 'pending', updatedAt: 'now' }]);
    expect(JSON.stringify(body)).not.toMatch(/secret|sensitive-target|foreign/);
  });
  it.each(['tenant@example.test', 'staff@asi-global.ru', ''])('denies %s even outside production', async (email) => {
    state.session.email = email;
    expect((await GET()).status).toBe(403);
    expect((await post({ reviewId: 'unbound', action: 'request_identity' })).status).toBe(403);
    expect(state.send).not.toHaveBeenCalled(); expect(state.lock).not.toHaveBeenCalled();
  });
  it('denies absent explicit platform allowlist', async () => {
    state.allowlist.clear(); expect((await GET()).status).toBe(403);
  });
  it('requires an authenticated user', async () => {
    state.session.userId = ''; expect((await GET()).status).toBe(401);
  });
  it.each(['foreign', 'closed', 'missing'])('cannot act on %s review', async (reviewId) => {
    expect((await post({ reviewId, action: 'request_identity' })).status).toBe(404);
    expect(state.send).not.toHaveBeenCalled(); expect(state.lock).not.toHaveBeenCalled();
  });
  it.each([{ accountId: 'a' }, { propertyId: 'p' }, { replyText: 'forged' }, { action: 'return_to_ai' }])(
    'rejects binding/free-text/release fields %j', async (extra) => {
      expect((await post({ reviewId: 'unbound', action: 'request_identity', ...extra })).status).toBe(400);
      expect(state.send).not.toHaveBeenCalled();
    });
  it('acknowledges without sending or assigning a tenant', async () => {
    expect((await post({ reviewId: 'unbound', action: 'acknowledge' })).status).toBe(200);
    expect(state.lock).toHaveBeenCalledWith({ reviewId: 'unbound', operatorId: 'operator' });
    expect(state.send).not.toHaveBeenCalled(); expect(state.reviews[0].accountId).toBeNull();
  });
  it('sends only the fixed identity question, keeping automation locked', async () => {
    expect((await post({ reviewId: 'unbound', action: 'request_identity' })).status).toBe(200);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: 'unbound', operatorId: 'operator', resumeAutomation: false,
      replyText: expect.stringContaining('номер'),
    }));
    expect(state.reviews[0].accountId).toBeNull();
  });
  it('does not report failed delivery as success', async () => {
    state.send.mockResolvedValue({ ok: false });
    expect((await post({ reviewId: 'unbound', action: 'request_identity' })).status).toBe(502);
  });
  it('fails closed on corrupt persistence without exposing errors', async () => {
    state.failed = true;
    const response = await GET();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
    expect((await post({ reviewId: 'unbound', action: 'request_identity' })).status).toBe(503);
    expect(state.send).not.toHaveBeenCalled();
  });
});
