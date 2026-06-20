/** TTS wrapper: OpenAI-compatible relay/base URL, OpenAI, or ElevenLabs. */

export type TtsGenerationResult = {
  audio: ArrayBuffer | null;
  provider: string;
  format: string;
  errorType?: string;
};

const DEFAULT_TIMEOUT_MS = 20_000;

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function timeoutMs(): number {
  const raw = Number(process.env.VOICE_TTS_TIMEOUT_MS ?? process.env.ELEVENLABS_TIMEOUT_MS ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export function isTtsConfigured(): boolean {
  if (process.env.VOICE_TTS_BASE_URL?.trim()) {
    return Boolean(
      process.env.VOICE_TTS_RELAY_TOKEN?.trim() ||
        process.env.VOICE_TTS_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim(),
    );
  }
  const provider = String(process.env.VOICE_TTS_PROVIDER ?? 'openai').trim().toLowerCase();
  if (provider === 'elevenlabs') {
    return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.VOICE_TTS_API_KEY?.trim());
}

function resolveProvider(): 'relay' | 'openai' | 'elevenlabs' {
  if (process.env.VOICE_TTS_BASE_URL?.trim()) return 'relay';
  const raw = String(process.env.VOICE_TTS_PROVIDER ?? 'openai').trim().toLowerCase();
  return raw === 'elevenlabs' ? 'elevenlabs' : 'openai';
}

function resolveModel(): string {
  return (
    process.env.VOICE_TTS_MODEL?.trim() ||
    (resolveProvider() === 'elevenlabs' ? 'eleven_multilingual_v2' : 'gpt-4o-mini-tts')
  );
}

function resolveVoice(): string {
  return (
    process.env.VOICE_TTS_VOICE?.trim() ||
    process.env.ELEVENLABS_VOICE_ID?.trim() ||
    (resolveProvider() === 'elevenlabs' ? '21m00Tcm4TlvDq8ikWAM' : 'coral')
  );
}

function resolveResponseFormat(): string {
  return process.env.VOICE_TTS_RESPONSE_FORMAT?.trim() || 'opus';
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function generateViaRelay(text: string): Promise<TtsGenerationResult> {
  const baseUrl = process.env.VOICE_TTS_BASE_URL!.trim().replace(/\/+$/, '');
  const token =
    process.env.VOICE_TTS_RELAY_TOKEN?.trim() ||
    process.env.VOICE_TTS_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    '';
  const format = resolveResponseFormat();

  const res = await fetchWithTimeout(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'audio/*',
    },
    body: JSON.stringify({
      model: resolveModel(),
      voice: resolveVoice(),
      input: text,
      response_format: format,
      speed: Number(process.env.VOICE_TTS_SPEED ?? '1') || 1,
      instructions: process.env.VOICE_TTS_INSTRUCTIONS?.trim() || undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[tg:voice] tts.relay.fail_http', { status: res.status, body: body.slice(0, 200) });
    return { audio: null, provider: 'relay', format, errorType: 'relay_http_fail' };
  }

  const audio = await res.arrayBuffer();
  return { audio, provider: 'relay', format };
}

async function generateViaOpenAi(text: string): Promise<TtsGenerationResult> {
  const apiKey = process.env.VOICE_TTS_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { audio: null, provider: 'openai', format: resolveResponseFormat(), errorType: 'missing_api_key' };
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const format = resolveResponseFormat();

  const res = await fetchWithTimeout(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'audio/*',
    },
    body: JSON.stringify({
      model: resolveModel(),
      voice: resolveVoice(),
      input: text,
      response_format: format,
      speed: Number(process.env.VOICE_TTS_SPEED ?? '1') || 1,
      instructions: process.env.VOICE_TTS_INSTRUCTIONS?.trim() || undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[tg:voice] tts.openai.fail_http', { status: res.status, body: body.slice(0, 200) });
    return { audio: null, provider: 'openai', format, errorType: 'openai_http_fail' };
  }

  const audio = await res.arrayBuffer();
  return { audio, provider: 'openai', format };
}

async function generateViaElevenLabs(text: string): Promise<TtsGenerationResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return { audio: null, provider: 'elevenlabs', format: 'mp3', errorType: 'missing_api_key' };
  }

  const voiceId = resolveVoice();
  const model = resolveModel();
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[tg:voice] tts.elevenlabs.fail_http', { status: res.status, body: body.slice(0, 200) });
    return { audio: null, provider: 'elevenlabs', format: 'mp3', errorType: 'elevenlabs_http_fail' };
  }

  const audio = await res.arrayBuffer();
  return { audio, provider: 'elevenlabs', format: 'mp3' };
}

export async function generateSpeech(text: string): Promise<TtsGenerationResult> {
  if (!text.trim()) {
    return { audio: null, provider: 'none', format: 'opus', errorType: 'empty_text' };
  }

  const provider = resolveProvider();
  if (debugEnabled()) {
    console.log('[tg:voice] tts.start', { provider, chars: text.length, model: resolveModel(), voice: resolveVoice() });
  }

  try {
    let result: TtsGenerationResult;
    if (provider === 'relay') result = await generateViaRelay(text);
    else if (provider === 'elevenlabs') result = await generateViaElevenLabs(text);
    else result = await generateViaOpenAi(text);

    if (result.audio && debugEnabled()) {
      console.log('[tg:voice] tts.ok', { provider: result.provider, bytes: result.audio.byteLength, format: result.format });
    }
    return result;
  } catch (err) {
    const errorType = (err as Error).name === 'AbortError' ? 'timeout' : 'network';
    console.error('[tg:voice] tts.fail', { provider, errorType, message: (err as Error).message });
    return { audio: null, provider, format: resolveResponseFormat(), errorType };
  }
}
