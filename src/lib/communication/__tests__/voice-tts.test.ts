import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runVoiceAcceptance } from '../../../../scripts/communication-voice-live-probe-v1.mjs';
import { generateSpeech, isTtsConfigured } from '../voice-tts';

const ENV_KEYS = [
  'VOICE_TTS_BASE_URL',
  'VOICE_TTS_RELAY_TOKEN',
  'VOICE_TTS_API_KEY',
  'VOICE_TTS_PROVIDER',
  'VOICE_TTS_FALLBACK_PROVIDER',
  'VOICE_TTS_MODEL',
  'VOICE_TTS_VOICE',
  'VOICE_TTS_RESPONSE_FORMAT',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_TTS_MODEL',
  'OPENAI_TTS_VOICE',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_MODEL_ID',
  'ELEVENLABS_VOICE_ID',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('voice TTS wrapper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('reports missing TTS env without throwing', async () => {
    expect(isTtsConfigured()).toBe(false);
    const result = await generateSpeech('Тестовый ответ.');
    expect(result.audio).toBeNull();
    expect(result.attempts).toEqual([{ provider: 'openai', ok: false, errorType: 'missing_api_key' }]);
  });

  it('detects relay TTS when base URL and token are set', () => {
    process.env.VOICE_TTS_BASE_URL = 'http://127.0.0.1:8091/v1';
    process.env.VOICE_TTS_RELAY_TOKEN = 'test-token';
    expect(isTtsConfigured()).toBe(true);
  });

  it('uses the ElevenLabs key header and provider-specific model on success', async () => {
    process.env.VOICE_TTS_PROVIDER = 'elevenlabs';
    process.env.ELEVENLABS_API_KEY = 'test-eleven-key';
    process.env.ELEVENLABS_MODEL_ID = 'eleven-test-model';
    const fetchMock = vi.fn().mockResolvedValue(new Response(Uint8Array.from([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateSpeech('Проверка ElevenLabs.');

    expect(result.audio?.byteLength).toBe(3);
    expect(result.provider).toBe('elevenlabs');
    expect(result.attempts).toEqual([{ provider: 'elevenlabs', ok: true }]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'xi-api-key': 'test-eleven-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({ model_id: 'eleven-test-model' });
  });

  it('classifies ElevenLabs HTTP 401 and falls back to configured OpenAI TTS', async () => {
    process.env.VOICE_TTS_PROVIDER = 'elevenlabs';
    process.env.ELEVENLABS_API_KEY = 'invalid-test-eleven-key';
    process.env.ELEVENLABS_MODEL_ID = 'eleven-test-model';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }, 401))
      .mockResolvedValueOnce(new Response(Uint8Array.from([4, 5, 6]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateSpeech('Проверка резервного синтеза.');

    expect(result.provider).toBe('openai');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attempts).toEqual([
      {
        provider: 'elevenlabs',
        ok: false,
        errorType: 'invalid_credential',
        httpStatus: 401,
        providerCode: 'invalid_api_key',
        credentialReplacementRequired: true,
        credentialEnv: 'ELEVENLABS_API_KEY',
      },
      { provider: 'openai', ok: true },
    ]);
    const [openAiUrl, openAiInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(openAiUrl).toBe('https://api.openai.com/v1/audio/speech');
    expect(JSON.parse(String(openAiInit.body))).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'coral' });
    expect(JSON.stringify(result)).not.toContain('invalid-test-eleven-key');
  });

  it('returns sanitized attempts when every configured provider fails', async () => {
    process.env.VOICE_TTS_PROVIDER = 'elevenlabs';
    process.env.ELEVENLABS_API_KEY = 'invalid-test-eleven-key';
    process.env.OPENAI_API_KEY = 'invalid-test-openai-key';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: { status: 'invalid_api_key' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_api_key' } }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateSpeech('Все провайдеры недоступны.');

    expect(result.audio).toBeNull();
    expect(result.errorType).toBe('all_providers_failed');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.every((attempt) => attempt.credentialReplacementRequired)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('invalid-test');
  });

  it('live acceptance reports TTS fallback and proves Telegram sendVoice as separate stages', async () => {
    const env = {
      NODE_ENV: 'test' as const,
      VOICE_TTS_PROVIDER: 'elevenlabs',
      ELEVENLABS_API_KEY: 'invalid-test-eleven-key',
      OPENAI_API_KEY: 'test-openai-key',
      TELEGRAM_BOT_TOKEN: 'test-telegram-token',
      TELEGRAM_TEST_CHAT_ID: '42',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: { status: 'invalid_api_key' } }, 401))
      .mockResolvedValueOnce(new Response(Uint8Array.from([7, 8, 9]), { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 99, voice: { duration: 1, file_size: 3 } } }, 200));

    const result = await runVoiceAcceptance({
      env,
      fetchImpl: fetchMock,
      convertAudio: (generated: { bytes: Buffer }) => generated.bytes,
    });

    expect(result).toMatchObject({
      pass: true,
      degraded: true,
      provider: 'openai',
      fallbackUsed: true,
      operatorActions: [
        { provider: 'elevenlabs', action: 'replace_production_credential', secretEnv: 'ELEVENLABS_API_KEY' },
      ],
      stages: [
        { stage: 'tts_generation', pass: true, provider: 'openai', fallbackUsed: true },
        { stage: 'audio_conversion', pass: true },
        { stage: 'telegram_send_voice', pass: true, messageId: 99 },
      ],
    });
  });

  it('live acceptance fails at TTS and never calls Telegram when all providers fail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: { status: 'invalid_api_key' } }, 401));
    const result = await runVoiceAcceptance({
      env: {
        NODE_ENV: 'test',
        VOICE_TTS_PROVIDER: 'elevenlabs',
        ELEVENLABS_API_KEY: 'invalid-test-eleven-key',
        TELEGRAM_BOT_TOKEN: 'test-telegram-token',
        TELEGRAM_TEST_CHAT_ID: '42',
      },
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      pass: false,
      failedStage: 'tts_generation',
      stages: [{ stage: 'tts_generation', pass: false }],
      operatorActions: [{ secretEnv: 'ELEVENLABS_API_KEY' }],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('production workflow uses a constrained safety choice and names every required acceptance stage', () => {
    const workflow = readFileSync('.github/workflows/communication-production-completion-v1.yml', 'utf8');

    expect(workflow).toContain('type: choice');
    expect(workflow).toContain('authorized_for_selected_mode');
    expect(workflow).not.toContain('Exact confirmation phrase');
    expect(workflow).not.toContain('ACCEPT_COMMUNICATION_PRODUCTION_COMPLETION_V1');
    for (const stage of ['active_state', 'text_autopilot', 'outbound_tts_and_send_voice', 'inbound_stt']) {
      expect(workflow).toContain(`run_acceptance_stage ${stage}`);
    }
    expect(workflow).toContain('stage=inbound_stt_input');
  });
});
