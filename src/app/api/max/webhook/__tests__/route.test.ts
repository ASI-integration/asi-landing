import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn().mockResolvedValue({ outcome: 'replied' });

vi.mock('@/lib/communication/orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

describe('MAX webhook route', () => {
  beforeEach(() => {
    mockProcessMessage.mockClear();
    delete process.env.MAX_WEBHOOK_SECRET;
  });

  it('rejects webhook requests with invalid secret', async () => {
    process.env.MAX_WEBHOOK_SECRET = 'max-secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/max/webhook', {
      method: 'POST',
      body: JSON.stringify({ update_type: 'message_created' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Max-Bot-Api-Secret': 'wrong-secret',
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('ignores unsupported webhook events safely', async () => {
    process.env.MAX_WEBHOOK_SECRET = 'max-secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/max/webhook', {
      method: 'POST',
      body: JSON.stringify({ update_type: 'bot_started', update_id: 'event-1' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Max-Bot-Api-Secret': 'max-secret-1',
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: true, reason: 'unsupported_event' });
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('ignores empty message_created events safely', async () => {
    process.env.MAX_WEBHOOK_SECRET = 'max-secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/max/webhook', {
      method: 'POST',
      body: JSON.stringify({
        update_type: 'message_created',
        update_id: 'event-empty',
        message: {
          id: 'msg-empty',
          sender: { user_id: 'max-user-1' },
          recipient: { chat_id: 'max-chat-1' },
          body: { text: '' },
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Max-Bot-Api-Secret': 'max-secret-1',
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: true, reason: 'empty_message' });
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('sends message_created events into the shared orchestrator path', async () => {
    process.env.MAX_WEBHOOK_SECRET = 'max-secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/max/webhook', {
      method: 'POST',
      body: JSON.stringify({
        update_type: 'message_created',
        update_id: 'event-11',
        timestamp: 1715158800,
        message: {
          id: 'msg-11',
          sender: { user_id: 'max-user-1' },
          recipient: { chat_id: 'max-chat-1' },
          body: { text: 'вафля?' },
          timestamp: 1715158800,
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Max-Bot-Api-Secret': 'max-secret-1',
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    expect(mockProcessMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        channel: 'max',
        externalUserId: 'max-user-1',
        chatId: 'max-chat-1',
        messageText: 'вафля?',
      }),
    );
  });
});
