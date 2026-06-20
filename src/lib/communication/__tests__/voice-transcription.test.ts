import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transcribeVoiceMessageDetailed } from '../voice-transcription';

const ORIGINAL_ENV = process.env;

function audioResponse(bytes: number[], contentType = 'audio/ogg'): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('Telegram voice transcription transport', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      TELEGRAM_BOT_TOKEN: '123:test-token',
      VOICE_STT_BASE_URL: 'http://relay.test/v1',
      VOICE_STT_RELAY_TOKEN: 'relay-secret',
      VOICE_STT_MODEL: 'gpt-4o-transcribe',
      VOICE_TRANSCRIPTION_DISABLED: '0',
      COMM_PIPELINE_DEBUG: '0',
      TELEGRAM_DEBUG: '0',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = ORIGINAL_ENV;
  });

  it('downloads the Telegram voice file and posts audio/ogg to the configured STT relay', async () => {
    let sttForm: FormData | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/getFile')) {
        expect(url).toContain('file_id=voice-file-1');
        return Response.json({
          ok: true,
          result: { file_path: 'voice/file_1.oga', file_size: 4 },
        });
      }
      if (url.includes('/file/bot')) {
        return audioResponse([1, 2, 3, 4]);
      }
      if (url === 'http://relay.test/v1/audio/transcriptions') {
        sttForm = init?.body as FormData;
        return Response.json({ text: 'можете порекомендовать рестораны рядом?' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeVoiceMessageDetailed('voice-file-1', 'audio/ogg', { updateId: 101 });

    expect(result).toMatchObject({
      ok: true,
      text: 'можете порекомендовать рестораны рядом?',
      provider: 'voice_stt_relay',
      mimeType: 'audio/ogg',
      extension: '.ogg',
      downloadBytes: 4,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sttForm).not.toBeNull();
    const form = sttForm as unknown as FormData;
    expect(form.get('model')).toBe('gpt-4o-transcribe');
    const file = form.get('file') as File;
    expect(file.name).toBe('voice_message.ogg');
    expect(file.type).toBe('audio/ogg');
  });

  it('does not leak tokens or API keys in STT failure logs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/getFile')) {
          return Response.json({
            ok: true,
            result: { file_path: 'voice/file_2.oga', file_size: 4 },
          });
        }
        if (url.includes('/file/bot')) {
          return audioResponse([1, 2, 3, 4]);
        }
        if (url === 'http://relay.test/v1/audio/transcriptions') {
          return new Response('provider rejected Bearer sk-liveSecret123 token=supersecret', { status: 401 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const result = await transcribeVoiceMessageDetailed('voice-file-2', 'audio/ogg', { updateId: 102 });

    expect(result).toMatchObject({
      ok: false,
      reason: 'stt_failed',
      provider: 'voice_stt_relay',
      stt: { status: 401 },
    });
    const logs = JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(logs).not.toContain('sk-liveSecret123');
    expect(logs).not.toContain('supersecret');
    expect(logs).toContain('[redacted]');
  });

  it('returns missing_env when the STT relay auth env is absent', async () => {
    delete process.env.VOICE_STT_RELAY_TOKEN;
    delete process.env.VOICE_STT_API_KEY;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/getFile')) {
        return Response.json({
          ok: true,
          result: { file_path: 'voice/file_3.oga', file_size: 4 },
        });
      }
      if (url.includes('/file/bot')) {
        return audioResponse([1, 2, 3, 4]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeVoiceMessageDetailed('voice-file-3', 'audio/ogg', { updateId: 103 });

    expect(result).toMatchObject({
      ok: false,
      reason: 'stt_failed',
      provider: 'voice_stt_relay',
      stt: { kind: 'missing_config', code: 'missing_env' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const logs = JSON.stringify(warnSpy.mock.calls);
    expect(logs).toContain('missing_env');
    expect(logs).not.toContain('relay-secret');
  });
});
