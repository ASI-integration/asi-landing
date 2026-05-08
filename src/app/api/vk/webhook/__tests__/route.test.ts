import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn().mockResolvedValue({ outcome: 'replied' });

vi.mock('@/lib/communication/orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

describe('VK webhook route', () => {
  beforeEach(() => {
    mockProcessMessage.mockClear();
    delete process.env.VK_CONFIRMATION_CODE;
    delete process.env.VK_CALLBACK_SECRET;
  });

  it('returns VK confirmation code for confirmation callback', async () => {
    process.env.VK_CONFIRMATION_CODE = 'vk-confirm-123';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/vk/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'confirmation', group_id: 77 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toBe('vk-confirm-123');
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('ignores unsupported callback events safely', async () => {
    process.env.VK_CALLBACK_SECRET = 'secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/vk/webhook', {
      method: 'POST',
      body: JSON.stringify({
        type: 'message_reply',
        group_id: 77,
        secret: 'secret-1',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toBe('ok');
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('sends VK message_new into shared orchestrator path', async () => {
    process.env.VK_CALLBACK_SECRET = 'secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/vk/webhook', {
      method: 'POST',
      body: JSON.stringify({
        type: 'message_new',
        group_id: 77,
        event_id: 'event-11',
        secret: 'secret-1',
        object: {
          message: {
            id: 91,
            conversation_message_id: 15,
            from_id: 112233,
            peer_id: 2000000411,
            date: 1715158800,
            text: 'вафля?',
          },
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toBe('ok');
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    expect(mockProcessMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        channel: 'vk',
        externalUserId: '112233',
        chatId: '2000000411',
        messageText: 'вафля?',
      }),
    );
  });
});
