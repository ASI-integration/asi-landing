import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateSpeech = vi.fn();
vi.mock('../voice-tts', () => ({
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
}));

const mockPrepareTelegramVoiceAudio = vi.fn();
vi.mock('../voice-audio', () => ({
  prepareTelegramVoiceAudio: (...args: unknown[]) => mockPrepareTelegramVoiceAudio(...args),
}));

const mockRecordVoiceBudgetUsage = vi.fn();
vi.mock('../voice-budget-store', () => ({
  recordVoiceBudgetUsage: (...args: unknown[]) => mockRecordVoiceBudgetUsage(...args),
}));

import { normalizeSpeechTextForTts } from '../voice-speech-normalization';
import { sendVoiceReply } from '../voice-reply';

describe('ASI TTS brand pronunciation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGenerateSpeech.mockReset();
    mockPrepareTelegramVoiceAudio.mockReset();
    mockRecordVoiceBudgetUsage.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    process.env.VOICE_REPLY_ENABLED = '1';
    process.env.TELEGRAM_DRY_RUN = '1';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.VOICE_REPLY_ENABLED;
    delete process.env.TELEGRAM_DRY_RUN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('converts standalone ASI to the owner-selected English letter-name pronunciation', () => {
    expect(normalizeSpeechTextForTts('Добро пожаловать в ASI. Ваш помощник ASI готов.')).toBe(
      'Добро пожаловать в Ay Ess Eye. Ваш помощник Ay Ess Eye готов.',
    );
    expect(normalizeSpeechTextForTts('ASI Asi asi')).toBe('Ay Ess Eye Ay Ess Eye Ay Ess Eye');
  });

  it('does not rewrite unrelated words, identifiers, email addresses, or URLs', () => {
    const text = 'basic ASI_global foo@asi.com https://asi-global.ru/path';
    expect(normalizeSpeechTextForTts(text)).toBe(text);
  });

  it('keeps the original visible text unchanged while passing normalized text to TTS', async () => {
    const visibleText = 'Добро пожаловать в ASI. Всё готово.';
    mockGenerateSpeech.mockResolvedValue({
      audio: Uint8Array.from([1, 2, 3]).buffer,
      provider: 'elevenlabs',
      format: 'mp3',
      fallbackUsed: false,
      attempts: [{ provider: 'elevenlabs', ok: true }],
    });
    mockPrepareTelegramVoiceAudio.mockReturnValue({
      oggBytes: Buffer.from([1, 2, 3]),
      ffmpegMissing: false,
      ffmpegUsed: false,
    });

    const sent = await sendVoiceReply(42, {
      chatId: 42,
      decision: {
        shouldSendVoice: true,
        reason: 'inbound_voice_allowed',
        voiceText: visibleText,
      } as never,
    });

    expect(sent).toBe(true);
    expect(mockGenerateSpeech).toHaveBeenCalledWith('Добро пожаловать в Ay Ess Eye. Всё готово.');
    expect(visibleText).toBe('Добро пожаловать в ASI. Всё готово.');
  });
});
