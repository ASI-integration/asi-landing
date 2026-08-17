import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessSupportBotUpdate = vi.fn();
vi.mock('@/lib/communication/telegram-support-bot', () => ({
  processSupportBotUpdate: (...args: unknown[]) => mockProcessSupportBotUpdate(...args),
}));

import { POST } from '../support-webhook/route';

const WEBHOOK_SECRET = 'test-support-webhook-secret';
const update = {
  update_id: 7001,
  message: {
    message_id: 51,
    chat: { id: 501, type: 'private' },
    text: 'Support request',
  },
};

function telegramRequest(secretToken: string | null = WEBHOOK_SECRET): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (secretToken !== null) {
    headers.set('x-telegram-bot-api-secret-token', secretToken);
  }

  return new Request('https://example.test/api/telegram/support-webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(update),
  });
}

describe('Telegram support webhook route', () => {
  beforeEach(() => {
    mockProcessSupportBotUpdate.mockReset();
    process.env.TELEGRAM_SUPPORT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it('returns 503 without processing when the configured secret is missing', async () => {
    delete process.env.TELEGRAM_SUPPORT_WEBHOOK_SECRET;

    const res = await POST(telegramRequest());

    expect(res.status).toBe(503);
    expect(mockProcessSupportBotUpdate).not.toHaveBeenCalled();
  });

  it('returns 503 without processing when the configured secret is blank', async () => {
    process.env.TELEGRAM_SUPPORT_WEBHOOK_SECRET = '   ';

    const res = await POST(telegramRequest());

    expect(res.status).toBe(503);
    expect(mockProcessSupportBotUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 without processing when request authentication is missing', async () => {
    const res = await POST(telegramRequest(null));

    expect(res.status).toBe(403);
    expect(mockProcessSupportBotUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 without processing when request authentication is incorrect', async () => {
    const res = await POST(telegramRequest('wrong-secret'));

    expect(res.status).toBe(403);
    expect(mockProcessSupportBotUpdate).not.toHaveBeenCalled();
  });

  it('accepts and processes a request with correct authentication', async () => {
    mockProcessSupportBotUpdate.mockResolvedValue({ outcome: 'replied', intent: 'support' });

    const res = await POST(telegramRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, outcome: 'replied', intent: 'support' });
    expect(mockProcessSupportBotUpdate).toHaveBeenCalledWith(update);
  });
});
