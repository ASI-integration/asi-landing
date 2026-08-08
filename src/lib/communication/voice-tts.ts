/** TTS wrapper: OpenAI-compatible relay/base URL, OpenAI, or ElevenLabs. */

export type TtsProvider = 'relay' | 'openai' | 'elevenlabs';

export type TtsProviderAttempt = {
  provider: TtsProvider;
  ok: boolean;
  errorType?: string;
  httpStatus?: number;
  providerCode?: string;
  credentialReplacementRequired?: boolean;
  billingRestorationRequired?: boolean;
  credentialEnv?: 'ELEVENLABS_API_KEY' | 'OPENAI_API_KEY' | 'VOICE_TTS_API_KEY' | 'VOICE_TTS_RELAY_TOKEN';
};

export type TtsGenerationResult = {
  audio: ArrayBuffer | null;
  provider: string;
  format: string;
  errorType?: string;
  fallbackUsed?: boolean;
  attempts?: TtsProviderAttempt[];
};

type ProviderResult = {
  audio: ArrayBuffer | null;
  provider: TtsProvider;
  format: string;
  attempt: TtsProviderAttempt;
};

const DEFAULT_TIMEOUT_MS = 20_000;

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function timeoutMs(): number {
  const raw = Number(process.env.VOICE_TTS_TIMEOUT_MS ?? process.env.ELEVENLABS_TIMEOUT_MS ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function preferredProvider(): TtsProvider {
  if (process.env.VOICE_TTS_BASE_URL?.trim()) return 'relay';
  return String(process.env.VOICE_TTS_PROVIDER ?? 'openai').trim().toLowerCase() === 'elevenlabs'
    ? 'elevenlabs'
    : 'openai';
}

function providerConfigured(provider: TtsProvider): boolean {
  if (provider === 'relay') {
    return Boolean(
      process.env.VOICE_TTS_BASE_URL?.trim() &&
        (process.env.VOICE_TTS_RELAY_TOKEN?.trim() ||
          process.env.VOICE_TTS_API_KEY?.trim() ||
          process.env.OPENAI_API_KEY?.trim()),
    );
  }
  if (provider === 'elevenlabs') return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.VOICE_TTS_API_KEY?.trim());
}

function configuredProviderOrder(): TtsProvider[] {
  const preferred = preferredProvider();
  const explicitFallback = String(process.env.VOICE_TTS_FALLBACK_PROVIDER ?? '').trim().toLowerCase();
  const candidates: TtsProvider[] = [preferred];

  if (
    (explicitFallback === 'relay' || explicitFallback === 'openai' || explicitFallback === 'elevenlabs') &&
    explicitFallback !== preferred
  ) {
    candidates.push(explicitFallback);
  }

  const defaults: TtsProvider[] = preferred === 'elevenlabs'
    ? ['openai']
    : preferred === 'openai'
      ? ['elevenlabs']
      : ['openai', 'elevenlabs'];
  candidates.push(...defaults);

  return [...new Set(candidates)].filter((provider, index) => index === 0 || providerConfigured(provider));
}

export function isTtsConfigured(): boolean {
  return configuredProviderOrder().some(providerConfigured);
}

function resolveModel(provider: TtsProvider): string {
  if (provider === 'elevenlabs') {
    return (
      process.env.ELEVENLABS_MODEL_ID?.trim() ||
      (preferredProvider() === 'elevenlabs' ? process.env.VOICE_TTS_MODEL?.trim() : '') ||
      'eleven_multilingual_v2'
    );
  }
  if (provider === 'openai') {
    return (
      process.env.OPENAI_TTS_MODEL?.trim() ||
      (preferredProvider() === 'openai' ? process.env.VOICE_TTS_MODEL?.trim() : '') ||
      'gpt-4o-mini-tts'
    );
  }
  return process.env.VOICE_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
}

function resolveVoice(provider: TtsProvider): string {
  if (provider === 'elevenlabs') {
    return (
      process.env.ELEVENLABS_VOICE_ID?.trim() ||
      (preferredProvider() === 'elevenlabs' ? process.env.VOICE_TTS_VOICE?.trim() : '') ||
      '21m00Tcm4TlvDq8ikWAM'
    );
  }
  if (provider === 'openai') {
    return (
      process.env.OPENAI_TTS_VOICE?.trim() ||
      (preferredProvider() === 'openai' ? process.env.VOICE_TTS_VOICE?.trim() : '') ||
      'coral'
    );
  }
  return process.env.VOICE_TTS_VOICE?.trim() || 'coral';
}

function resolveResponseFormat(provider: TtsProvider): string {
  if (provider === 'elevenlabs') return 'mp3';
  if (provider === 'openai') {
    return process.env.OPENAI_TTS_RESPONSE_FORMAT?.trim() || process.env.VOICE_TTS_RESPONSE_FORMAT?.trim() || 'opus';
  }
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

function safeProviderCode(value: unknown): string | undefined {
  const code = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9_.-]{1,80}$/.test(code) ? code : undefined;
}

function isBillingProviderCode(providerCode: string | undefined): boolean {
  return providerCode === 'payment_issue';
}

async function failedAttempt(
  response: Response,
  provider: TtsProvider,
  credentialEnv: TtsProviderAttempt['credentialEnv'],
): Promise<TtsProviderAttempt> {
  let providerCode: string | undefined;
  try {
    const body = (await response.json()) as {
      detail?: { status?: unknown; code?: unknown } | string;
      error?: { code?: unknown; type?: unknown };
      code?: unknown;
      type?: unknown;
    };
    providerCode = safeProviderCode(
      typeof body.detail === 'object' && body.detail
        ? body.detail.status ?? body.detail.code
        : body.error?.code ?? body.error?.type ?? body.code ?? body.type,
    );
  } catch {
    // Provider returned a non-JSON error. Status-based classification remains safe.
  }

  const billingRestorationRequired = isBillingProviderCode(providerCode);
  const credentialReplacementRequired = response.status === 401 && !billingRestorationRequired;
  const errorType = billingRestorationRequired
    ? 'billing_account_restricted'
    : credentialReplacementRequired
    ? 'invalid_credential'
    : response.status === 403
      ? 'authorization_failed'
      : response.status === 402
        ? 'quota_exceeded'
        : response.status === 429
          ? 'rate_limited'
          : 'provider_http_error';

  return {
    provider,
    ok: false,
    errorType,
    httpStatus: response.status,
    providerCode,
    credentialReplacementRequired,
    ...(billingRestorationRequired ? { billingRestorationRequired: true } : {}),
    ...(credentialReplacementRequired ? { credentialEnv } : {}),
  };
}

async function generateViaRelay(text: string): Promise<ProviderResult> {
  const baseUrl = process.env.VOICE_TTS_BASE_URL!.trim().replace(/\/+$/, '');
  const token =
    process.env.VOICE_TTS_RELAY_TOKEN?.trim() ||
    process.env.VOICE_TTS_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    '';
  const credentialEnv = process.env.VOICE_TTS_RELAY_TOKEN?.trim()
    ? 'VOICE_TTS_RELAY_TOKEN'
    : process.env.VOICE_TTS_API_KEY?.trim()
      ? 'VOICE_TTS_API_KEY'
      : 'OPENAI_API_KEY';
  const format = resolveResponseFormat('relay');

  const res = await fetchWithTimeout(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'audio/*',
    },
    body: JSON.stringify({
      model: resolveModel('relay'),
      voice: resolveVoice('relay'),
      input: text,
      response_format: format,
      speed: Number(process.env.VOICE_TTS_SPEED ?? '1') || 1,
      instructions: process.env.VOICE_TTS_INSTRUCTIONS?.trim() || undefined,
    }),
  });

  if (!res.ok) {
    return { audio: null, provider: 'relay', format, attempt: await failedAttempt(res, 'relay', credentialEnv) };
  }

  return {
    audio: await res.arrayBuffer(),
    provider: 'relay',
    format,
    attempt: { provider: 'relay', ok: true },
  };
}

async function generateViaOpenAi(text: string): Promise<ProviderResult> {
  const apiKey = process.env.VOICE_TTS_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const credentialEnv = process.env.VOICE_TTS_API_KEY?.trim() ? 'VOICE_TTS_API_KEY' : 'OPENAI_API_KEY';
  const format = resolveResponseFormat('openai');
  if (!apiKey) {
    return {
      audio: null,
      provider: 'openai',
      format,
      attempt: { provider: 'openai', ok: false, errorType: 'missing_api_key' },
    };
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const res = await fetchWithTimeout(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'audio/*',
    },
    body: JSON.stringify({
      model: resolveModel('openai'),
      voice: resolveVoice('openai'),
      input: text,
      response_format: format,
      speed: Number(process.env.VOICE_TTS_SPEED ?? '1') || 1,
      instructions: process.env.VOICE_TTS_INSTRUCTIONS?.trim() || undefined,
    }),
  });

  if (!res.ok) {
    return { audio: null, provider: 'openai', format, attempt: await failedAttempt(res, 'openai', credentialEnv) };
  }

  return {
    audio: await res.arrayBuffer(),
    provider: 'openai',
    format,
    attempt: { provider: 'openai', ok: true },
  };
}

async function generateViaElevenLabs(text: string): Promise<ProviderResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return {
      audio: null,
      provider: 'elevenlabs',
      format: 'mp3',
      attempt: { provider: 'elevenlabs', ok: false, errorType: 'missing_api_key' },
    };
  }

  const voiceId = resolveVoice('elevenlabs');
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
      model_id: resolveModel('elevenlabs'),
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    return {
      audio: null,
      provider: 'elevenlabs',
      format: 'mp3',
      attempt: await failedAttempt(res, 'elevenlabs', 'ELEVENLABS_API_KEY'),
    };
  }

  return {
    audio: await res.arrayBuffer(),
    provider: 'elevenlabs',
    format: 'mp3',
    attempt: { provider: 'elevenlabs', ok: true },
  };
}

async function generateViaProvider(provider: TtsProvider, text: string): Promise<ProviderResult> {
  if (provider === 'relay') return generateViaRelay(text);
  if (provider === 'elevenlabs') return generateViaElevenLabs(text);
  return generateViaOpenAi(text);
}

export async function generateSpeech(text: string): Promise<TtsGenerationResult> {
  if (!text.trim()) {
    return { audio: null, provider: 'none', format: 'opus', errorType: 'empty_text', attempts: [] };
  }

  const providers = configuredProviderOrder();
  const attempts: TtsProviderAttempt[] = [];
  if (debugEnabled()) {
    console.log('[tg:voice] tts.start', { providers, chars: text.length });
  }

  for (const [index, provider] of providers.entries()) {
    try {
      const result = await generateViaProvider(provider, text);
      attempts.push(result.attempt);
      if (result.audio) {
        if (debugEnabled()) {
          console.log('[tg:voice] tts.ok', {
            provider,
            bytes: result.audio.byteLength,
            format: result.format,
            fallback_used: index > 0,
          });
        }
        return {
          audio: result.audio,
          provider,
          format: result.format,
          fallbackUsed: index > 0,
          attempts,
        };
      }
      console.warn('[tg:voice] tts.provider_fail', result.attempt);
    } catch (err) {
      const errorType = (err as Error).name === 'AbortError' ? 'timeout' : 'network';
      const attempt: TtsProviderAttempt = { provider, ok: false, errorType };
      attempts.push(attempt);
      console.warn('[tg:voice] tts.provider_fail', attempt);
    }
  }

  const lastAttempt = attempts.at(-1);
  return {
    audio: null,
    provider: lastAttempt?.provider ?? providers[0] ?? 'none',
    format: lastAttempt?.provider ? resolveResponseFormat(lastAttempt.provider) : 'opus',
    errorType: attempts.length === 1 ? lastAttempt?.errorType : 'all_providers_failed',
    fallbackUsed: false,
    attempts,
  };
}
