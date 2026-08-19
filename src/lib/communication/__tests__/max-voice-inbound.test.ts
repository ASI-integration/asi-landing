import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn();
const mockTranscribe = vi.fn();

vi.mock('../orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

vi.mock('../voice/stt', async () => {
  const actual = await vi.importActual<typeof import('../voice/stt')>('../voice/stt');
  return {
    ...actual,
    transcribeWithConfiguredStt: (...args: unknown[]) => mockTranscribe(...args),
  };
});

import { _resetForTesting as resetIdempotency } from '../idempotency';
import { processMaxVoiceUpdate } from '../max-voice-inbound';

describe('MAX inbound voice', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetIdempotency();
    mockProcessMessage.mockReset();
    mockProcessMessage.mockResolvedValue({ outcome: 'replied', category: 'issue', escalation: null });
    mockTranscribe.mockReset();
    mockTranscribe.mockResolvedValue({
      ok: true,
      provider: 'llm_primary',
      usedFallback: false,
      text: 'Во сколько заезд?',
    });
    process.env.MAX_BOT_TOKEN = 'max-test-token';
    delete process.env.MAX_VOICE_MAX_BYTES;
    delete process.env.MAX_VOICE_FETCH_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MAX_BOT_TOKEN;
    delete process.env.MAX_VOICE_MAX_BYTES;
    delete process.env.MAX_VOICE_FETCH_TIMEOUT_MS;
  });

  function payload(url = 'https://vu.okcdn.ru/audio/voice-1.m4a') {
    return {
      update_type: 'message_created',
      update_id: 'event-voice-1',
      timestamp: 1787160000000,
      message: {
        sender: { user_id: 'max-user-1' },
        recipient: { chat_id: '99001' },
        timestamp: 1787160000000,
        body: {
          mid: 'max-mid-voice-1',
          text: '',
          attachments: [
            {
              type: 'audio',
              payload: { url, token: 'opaque-audio-token' },
            },
          ],
        },
      },
    };
  }

  it('downloads a trusted MAX audio attachment, transcribes it, and enters the canonical brain', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3, 4, 5]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '5' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await processMaxVoiceUpdate(payload());

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'voice_transcript_processed',
        transcript_chars: 'Во сколько заезд?'.length,
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockTranscribe.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        filename: 'max_voice.m4a',
        mimeType: 'audio/mp4',
      }),
    );
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    expect(mockProcessMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        channel: 'max',
        externalUserId: 'max-user-1',
        chatId: '99001',
        messageText: 'Во сколько заезд?',
        metadata: expect.objectContaining({
          transport: 'max_voice',
          originalMessageType: 'audio',
          sttStatus: 'success',
          voice: expect.objectContaining({
            voiceChannel: 'max_voice',
            originalMessageType: 'audio',
          }),
        }),
      }),
    );
  });

  it('deduplicates the media before paying for STT twice', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await processMaxVoiceUpdate(payload('https://vu.okcdn.ru/audio/voice-1.mp3'));
    const second = await processMaxVoiceUpdate(payload('https://vu.okcdn.ru/audio/voice-1.mp3'));

    expect(first.outcome).toBe('voice_transcript_processed');
    expect(second.outcome).toBe('duplicate');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
  });

  it('does not fetch an untrusted media URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await processMaxVoiceUpdate(payload('https://evil.example/audio.mp3'));

    expect(result.outcome).toBe('voice_fallback_sent');
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(mockProcessMessage).not.toHaveBeenCalled();
    // The only possible fetch would be the best-effort MAX text fallback; the untrusted URL itself is never fetched.
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('evil.example'))).toBe(false);
  });

  it('rejects oversized audio before STT', async () => {
    process.env.MAX_VOICE_MAX_BYTES = '4';
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3, 4, 5]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '5' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await processMaxVoiceUpdate(payload('https://vu.okcdn.ru/audio/too-big.mp3'));

    expect(result.outcome).toBe('voice_fallback_sent');
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });
});
