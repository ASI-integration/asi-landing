import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplyToTelegram = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
}));

const mockSendVoiceReply = vi.fn();
vi.mock('../voice-reply', async () => {
  const actual = await vi.importActual<typeof import('../voice-reply')>('../voice-reply');
  return {
    ...actual,
    sendVoiceReply: (...args: unknown[]) => mockSendVoiceReply(...args),
  };
});

import { TelegramAdapter } from '../channels/telegram';

describe('Telegram voice reply text fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockReplyToTelegram.mockReset();
    mockReplyToTelegram.mockResolvedValue(true);
    mockSendVoiceReply.mockReset();
    process.env.VOICE_REPLY_ENABLED = '1';
  });

  it('always sends text when TTS or sendVoice fails', async () => {
    mockSendVoiceReply.mockResolvedValue(false);
    const adapter = new TelegramAdapter();

    const sent = await adapter.sendMessage('42', 'Здравствуйте! Wi-Fi: сеть ASI, пароль отправлен в бронировании.', {
      update_id: 1001,
      reply_handler: 'test:voice',
      voice_response_decision: {
        shouldSendVoice: true,
        reason: 'inbound_voice_allowed',
        voiceText: 'Здравствуйте! Wi-Fi: сеть ASI.',
      },
    });

    expect(sent).toBe(true);
    expect(mockSendVoiceReply).toHaveBeenCalledOnce();
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      42,
      'Здравствуйте! Wi-Fi: сеть ASI, пароль отправлен в бронировании.',
      { handler: 'test:voice', update_id: 1001 },
    );
    expect(console.warn).toHaveBeenCalledWith('[tg:voice] voice_reply.text_fallback', {
      chat_id: 42,
      update_id: 1001,
      reason: 'inbound_voice_allowed',
    });
  });

  it('sends text and voice when voice succeeds (text is mandatory)', async () => {
    mockSendVoiceReply.mockResolvedValue(true);
    const adapter = new TelegramAdapter();

    const sent = await adapter.sendMessage('42', 'Здравствуйте! Инструкцию отправил.', {
      update_id: 1002,
      reply_handler: 'test:voice',
      voice_response_decision: {
        shouldSendVoice: true,
        reason: 'urgent_intent',
        voiceText: 'Здравствуйте! Инструкцию отправил.',
      },
    });

    expect(sent).toBe(true);
    expect(mockSendVoiceReply).toHaveBeenCalledOnce();
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      42,
      'Здравствуйте! Инструкцию отправил.',
      { handler: 'test:voice', update_id: 1002 },
    );
  });

  it('skips voice attempt when policy decision is absent', async () => {
    const adapter = new TelegramAdapter();
    const sent = await adapter.sendMessage('42', 'Только текст.', {
      update_id: 1003,
      reply_handler: 'test:text_only',
    });

    expect(sent).toBe(true);
    expect(mockSendVoiceReply).not.toHaveBeenCalled();
    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
  });

  it('keeps voice reply disabled by default even when policy asks for voice', async () => {
    delete process.env.VOICE_REPLY_ENABLED;
    const adapter = new TelegramAdapter();

    const sent = await adapter.sendMessage('42', 'Только текст по умолчанию.', {
      update_id: 1004,
      reply_handler: 'test:voice_default_off',
      voice_response_decision: {
        shouldSendVoice: true,
        reason: 'inbound_voice_allowed',
        voiceText: 'Только текст по умолчанию.',
      },
    });

    expect(sent).toBe(true);
    expect(mockSendVoiceReply).not.toHaveBeenCalled();
    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
  });
});
