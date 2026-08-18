import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateGeminiNativeSpeech = vi.fn();
const mockIsGeminiNativeAudioEnabled = vi.fn();
vi.mock('../gemini-native-audio', async () => {
  const actual = await vi.importActual<typeof import('../gemini-native-audio')>('../gemini-native-audio');
  return {
    ...actual,
    generateGeminiNativeSpeech: (...args: unknown[]) => mockGenerateGeminiNativeSpeech(...args),
    isGeminiNativeAudioEnabled: () => mockIsGeminiNativeAudioEnabled(),
  };
});

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

import { pcm16Mono24kToWav } from '../gemini-native-audio';
import { sendVoiceReply } from '../voice-reply';

function decision(voiceText: string) {
  return {
    shouldSendVoice: true,
    reason: 'inbound_voice_allowed',
    voiceText,
  } as const;
}

describe('Gemini Native Audio production routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGenerateGeminiNativeSpeech.mockReset();
    mockIsGeminiNativeAudioEnabled.mockReset();
    mockGenerateSpeech.mockReset();
    mockPrepareTelegramVoiceAudio.mockReset();
    mockRecordVoiceBudgetUsage.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.VOICE_REPLY_ENABLED = '1';
    process.env.TELEGRAM_DRY_RUN = '1';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.VOICE_REPLY_ENABLED;
    delete process.env.TELEGRAM_DRY_RUN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('uses Gemini Native Audio first with speech-normalized conversational text', async () => {
    const nativeAudio = Uint8Array.from([1, 2, 3, 4]).buffer;
    mockIsGeminiNativeAudioEnabled.mockReturnValue(true);
    mockGenerateGeminiNativeSpeech.mockResolvedValue({
      audio: nativeAudio,
      provider: 'gemini-native-audio',
      format: 'wav',
    });
    mockPrepareTelegramVoiceAudio.mockReturnValue({
      oggBytes: Buffer.from([8, 9]),
      ffmpegMissing: false,
      ffmpegUsed: true,
    });

    const text = 'В ASI соблюдайте тишину после 22:00.';
    const sent = await sendVoiceReply(42, { chatId: 42, decision: decision(text) as never });

    expect(sent).toBe(true);
    expect(mockGenerateGeminiNativeSpeech).toHaveBeenCalledWith(
      'В ASI соблюдайте тишину после десяти вечера.',
    );
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
    expect(mockPrepareTelegramVoiceAudio).toHaveBeenCalledWith(nativeAudio, 'wav');
    expect(text).toBe('В ASI соблюдайте тишину после 22:00.');
  });

  it('falls back to the existing TTS path and keeps ASI pronunciation normalization', async () => {
    mockIsGeminiNativeAudioEnabled.mockReturnValue(true);
    mockGenerateGeminiNativeSpeech.mockResolvedValue({
      audio: null,
      provider: 'gemini-native-audio',
      format: 'wav',
      errorType: 'timeout',
    });
    const fallbackAudio = Uint8Array.from([5, 6, 7]).buffer;
    mockGenerateSpeech.mockResolvedValue({
      audio: fallbackAudio,
      provider: 'elevenlabs',
      format: 'mp3',
      fallbackUsed: false,
      attempts: [{ provider: 'elevenlabs', ok: true }],
    });
    mockPrepareTelegramVoiceAudio.mockReturnValue({
      oggBytes: Buffer.from([8, 9]),
      ffmpegMissing: false,
      ffmpegUsed: true,
    });

    const sent = await sendVoiceReply(42, {
      chatId: 42,
      decision: decision('Добро пожаловать в ASI.') as never,
    });

    expect(sent).toBe(true);
    expect(mockGenerateSpeech).toHaveBeenCalledWith('Добро пожаловать в Ay Ess Eye.');
    expect(mockPrepareTelegramVoiceAudio).toHaveBeenCalledWith(fallbackAudio, 'mp3');
  });

  it('wraps 24 kHz mono PCM in a valid WAV container for the Telegram converter', () => {
    const pcm = Buffer.alloc(4_800, 1);
    const wav = Buffer.from(pcm16Mono24kToWav(pcm));

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.length).toBe(44 + pcm.length);
  });
});
