import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isRu: vi.fn(), issue: vi.fn() }));
vi.mock('@/lib/getIsRuHost', () => ({ getIsRuHost: mocks.isRu }));
vi.mock('@/lib/auth/ru-email-code-server', () => ({
  AUTH_GENERIC_RESPONSE: { ok: true, message: 'If the address exists, a code will be sent.' },
  ruEmailCodeReady: () => true,
  issueRuEmailCode: mocks.issue,
}));

import { POST } from '@/app/api/auth/email-code/request/route';

const origin = 'https://www.asi-global.ru';
function request(body: string) {
  return new Request(origin + '/api/auth/email-code/request', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ASI_RU_EMAIL_CODE_ORIGIN', origin);
  mocks.isRu.mockResolvedValue(true);
  mocks.issue.mockResolvedValue({ sent: true, throttled: false });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('RU email-code request body bounds', () => {
  it('accepts normal bounded JSON and preserves generic response', async () => {
    const res = await POST(request(JSON.stringify({ email: 'user@example.ru' })));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(mocks.issue).toHaveBeenCalledOnce();
  });

  it('rejects oversized unauthenticated JSON before quota or email handling', async () => {
    const res = await POST(request(JSON.stringify({
      email: 'user@example.ru', padding: 'X'.repeat(2048),
    })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'INVALID_BODY' });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('continues to reject cross-origin POST before quota or email handling', async () => {
    const hostile = new Request(origin + '/api/auth/email-code/request', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.ru' }),
    });
    const res = await POST(hostile);
    expect(res.status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
