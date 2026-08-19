import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn().mockResolvedValue({ outcome: 'replied' });
const mockProcessMaxVoiceUpdate = vi.fn().mockResolvedValue({ outcome: 'voice_transcript_processed' });

vi.mock('@/lib/communication/orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

vi.mock('@/lib/communication/max-voice-inbound', () => ({
  processMaxVoiceUpdate: (...args: unknown[]) => mockProcessMaxVoiceUpdate(...args),
}));

describe('MAX webhook voice route', () => {
  beforeEach(() => {
    mockProcessMessage.mockClear();
    mockProcessMaxVoiceUpdate.mockClear();
    process.env.MAX_WEBHOOK_SECRET = 'max-secret-1';
  });

  it('routes an audio-only message_created event into the voice processor', async () => {
    const { POST } = await import('../route');
    const payload = {
      update_type: 'message_created',
      update_id: 'voice-event-1',
      message: {
        sender: { user_id: 'max-user-1' },
        recipient: { chat_id: '99001' },
        body: {
          mid: 'voice-mid-1',
          text: '',
          attachments: [
            {
              type: 'audio',
              payload: {
                url: 'https://vu.okcdn.ru/audio/voice.m4a',
                token: 'opaque-token',
              },
            },
          ],
        },
      },
    };
    const req = new Request('http://localhost/api/max/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Max-Bot-Api-Secret': 'max-secret-1',
      },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(mockProcessMaxVoiceUpdate).toHaveBeenCalledTimes(1);
    expect(mockProcessMaxVoiceUpdate).toHaveBeenCalledWith(payload);
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });
});
