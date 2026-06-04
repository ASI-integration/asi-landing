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
    mockReplyToTelegram.mockReset();
    mockReplyToTelegram.mockResolvedValue(true);
    mockSendVoiceReply.mockReset();
    process.env.VOICE_REPLY_ENABLED = '1';
    process.env.VOICE_REPLY_MODE = 'mirror';
  });

  it('sends text when TTS or sendVoice fails for an inbound voice reply', async () => {
    mockSendVoiceReply.mockResolvedValue(false);
    const adapter = new TelegramAdapter();

    const sent = await adapter.sendMessage('42', 'Здравствуйте! Wi-Fi: сеть ASI, пароль отправлен в бронировании.', {
      update_id: 1001,
      reply_handler: 'test:voice',
      voice_reply_source: 'inbound_voice',
    });

    expect(sent).toBe(true);
    expect(mockSendVoiceReply).toHaveBeenCalledOnce();
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      42,
      'Здравствуйте! Wi-Fi: сеть ASI, пароль отправлен в бронировании.',
      { handler: 'test:voice', update_id: 1001 },
    );
  });

  it('does not duplicate text when voice was sent successfully', async () => {
    mockSendVoiceReply.mockResolvedValue(true);
    const adapter = new TelegramAdapter();

    const sent = await adapter.sendMessage('42', 'Здравствуйте! Инструкцию отправил.', {
      update_id: 1002,
      reply_handler: 'test:voice',
      voice_reply_source: 'inbound_voice',
    });

    expect(sent).toBe(true);
    expect(mockSendVoiceReply).toHaveBeenCalledOnce();
    expect(mockReplyToTelegram).not.toHaveBeenCalled();
  });
});
