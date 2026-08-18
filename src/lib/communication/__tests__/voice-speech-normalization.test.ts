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

import {
  normalizeSpeechTextForNativeAudio,
  normalizeSpeechTextForTts,
} from '../voice-speech-normalization';
import { sendVoiceReply } from '../voice-reply';

describe('voice speech normalization', () => {
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

  it('converts standalone ASI to the owner-selected English letter-name pronunciation for conventional TTS', () => {
    expect(normalizeSpeechTextForTts('Добро пожаловать в ASI. Ваш помощник ASI готов.')).toBe(
      'Добро пожаловать в Ay Ess Eye. Ваш помощник Ay Ess Eye готов.',
    );
    expect(normalizeSpeechTextForTts('ASI Asi asi')).toBe('Ay Ess Eye Ay Ess Eye Ay Ess Eye');
  });

  it('turns exact-hour Russian clock values into natural speech phrases', () => {
    expect(normalizeSpeechTextForNativeAudio('Соблюдайте тишину после 22:00.')).toBe(
      'Соблюдайте тишину после десяти вечера.',
    );
    expect(normalizeSpeechTextForNativeAudio('Завтрак в 08:00, выезд до 12:00.')).toBe(
      'Завтрак в восемь утра, выезд до полудня.',
    );
    expect(normalizeSpeechTextForNativeAudio('Тихие часы 22:00–08:00.')).toBe(
      'Тихие часы с десяти вечера до восьми утра.',
    );
    expect(normalizeSpeechTextForNativeAudio('Подойдите к 21:00.')).toBe('Подойдите к девяти вечера.');
  });

  it('turns dotted Russian calendar dates into a speech-friendly form', () => {
    expect(normalizeSpeechTextForNativeAudio('Заезд 18.08.2026 после 22:00.')).toBe(
      'Заезд 18 августа 2026 года после десяти вечера.',
    );
  });

  it('does not rewrite arbitrary numbers, PINs, identifiers, email addresses, URLs, or non-Russian text', () => {
    const russian = 'PIN 2200, код A-2200, Wi-Fi 5G, foo@asi.com, https://asi-global.ru/path';
    expect(normalizeSpeechTextForNativeAudio(russian)).toBe(russian);

    const english = 'Quiet hours after 22:00. Check-in 18.08.2026.';
    expect(normalizeSpeechTextForNativeAudio(english)).toBe(english);

    const tts = 'basic ASI_global foo@asi.com https://asi-global.ru/path';
    expect(normalizeSpeechTextForTts(tts)).toBe(tts);
  });

  it('keeps the original visible text unchanged while passing normalized text to TTS', async () => {
    const visibleText = 'Добро пожаловать в ASI. Тишина после 22:00.';
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
    expect(mockGenerateSpeech).toHaveBeenCalledWith(
      'Добро пожаловать в Ay Ess Eye. Тишина после десяти вечера.',
    );
    expect(visibleText).toBe('Добро пожаловать в ASI. Тишина после 22:00.');
  });
});
