import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateSpeech = vi.fn();
const mockRecordVoiceBudgetUsage = vi.fn();

vi.mock('../voice-tts', () => ({
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
}));

vi.mock('../gemini-native-audio', () => ({
  isGeminiNativeAudioEnabled: () => false,
  generateGeminiNativeSpeech: vi.fn(),
}));

vi.mock('../voice-budget-store', () => ({
  recordVoiceBudgetUsage: (...args: unknown[]) => mockRecordVoiceBudgetUsage(...args),
}));

vi.mock('../voice-reply', () => ({
  isVoiceReplyGloballyEnabled: () => true,
}));

import {
  MaxAdapter,
  isAllowedMaxAudioUrl,
  maxWebhookAudioAttachment,
  maxWebhookHasProcessableMessage,
} from '../channels/max';

describe('MAX voice transport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockGenerateSpeech.mockReset();
    mockRecordVoiceBudgetUsage.mockReset();
    process.env.MAX_BOT_TOKEN = 'max-token-test';
    delete process.env.MAX_API_BASE_URL;
    process.env.VOICE_REPLY_ENABLED = '1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MAX_BOT_TOKEN;
    delete process.env.MAX_API_BASE_URL;
    delete process.env.VOICE_REPLY_ENABLED;
  });

  it('recognizes an audio-only webhook as processable', () => {
    const payload = {
      update_type: 'message_created',
      message: {
        body: {
          mid: 'm-voice-1',
          text: '',
          attachments: [
            {
              type: 'audio',
              payload: {
                url: 'https://vu.okcdn.ru/audio/source.m4a',
                token: 'opaque-token',
              },
            },
          ],
        },
      },
    };

    expect(maxWebhookHasProcessableMessage(payload)).toBe(true);
    expect(maxWebhookAudioAttachment(payload)).toEqual(
      expect.objectContaining({ type: 'audio' }),
    );
  });

  it('allows only HTTPS MAX/CDN media hosts', () => {
    expect(isAllowedMaxAudioUrl('https://vu.okcdn.ru/upload.do?id=1')).toBe(true);
    expect(isAllowedMaxAudioUrl('https://cdn.max.ru/audio/1')).toBe(true);
    expect(isAllowedMaxAudioUrl('http://vu.okcdn.ru/audio/1')).toBe(false);
    expect(isAllowedMaxAudioUrl('https://evil.example/audio/1')).toBe(false);
  });

  it('sends text with target id in query params on the current MAX API host', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const sent = await new MaxAdapter().sendMessage('max-chat-1', 'hello', {
      chat_id: 'max-chat-1',
      user_id: 'max-user-1',
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://platform-api2.max.ru/messages?chat_id=max-chat-1');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'max-token-test' }),
        body: JSON.stringify({ text: 'hello' }),
      }),
    );
  });

  it('uploads generated audio and sends an audio attachment instead of duplicating full text', async () => {
    mockGenerateSpeech.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3, 4]).buffer,
      provider: 'test-tts',
      format: 'wav',
      fallbackUsed: false,
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://platform-api2.max.ru/uploads?type=audio') {
        return new Response(
          JSON.stringify({
            url: 'https://vu.okcdn.ru/upload.do?session=1',
            token: 'audio-token-1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('https://vu.okcdn.ru/upload.do')) {
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({ retval: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === 'https://platform-api2.max.ru/messages?chat_id=99001') {
        return new Response(JSON.stringify({ message: {} }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const sent = await new MaxAdapter().sendMessage('99001', 'Голосовой ответ', {
      chat_id: '99001',
      voice_response_decision: {
        shouldSendVoice: true,
        reason: 'inbound_voice_allowed',
        voiceText: 'Голосовой ответ',
      },
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, finalInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(JSON.parse(String(finalInit.body))).toEqual({
      attachments: [{ type: 'audio', payload: { token: 'audio-token-1' } }],
    });
    expect(mockRecordVoiceBudgetUsage).toHaveBeenCalledTimes(1);
  });

  it('falls back to text if voice upload preparation fails', async () => {
    mockGenerateSpeech.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3, 4]).buffer,
      provider: 'test-tts',
      format: 'wav',
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://platform-api2.max.ru/uploads?type=audio') {
        return new Response(JSON.stringify({ error: 'no upload' }), { status: 500 });
      }
      if (url === 'https://platform-api2.max.ru/messages?chat_id=99001') {
        return new Response(JSON.stringify({ message: {} }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const sent = await new MaxAdapter().sendMessage('99001', 'Текстовый fallback', {
      chat_id: '99001',
      voice_response_decision: {
        shouldSendVoice: true,
        reason: 'inbound_voice_allowed',
        voiceText: 'Голосовой ответ',
      },
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, fallbackInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(fallbackInit.body))).toEqual({ text: 'Текстовый fallback' });
  });
});
