import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTtsConfigured } from '../voice-tts';

describe('voice TTS wrapper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.VOICE_TTS_BASE_URL;
    delete process.env.VOICE_TTS_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
  });

  it('reports missing TTS env without throwing', () => {
    expect(isTtsConfigured()).toBe(false);
  });

  it('detects relay TTS when base URL and token are set', () => {
    process.env.VOICE_TTS_BASE_URL = 'http://127.0.0.1:8091/v1';
    process.env.VOICE_TTS_RELAY_TOKEN = 'test-token';
    expect(isTtsConfigured()).toBe(true);
  });
});

describe('generateSpeech', () => {
  it('returns null audio when env is missing', async () => {
    const { generateSpeech } = await import('../voice-tts');
    const result = await generateSpeech('Тестовый ответ.');
    expect(result.audio).toBeNull();
  });
});
