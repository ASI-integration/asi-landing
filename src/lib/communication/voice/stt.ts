const STT_TIMEOUT_MS_DEFAULT = 30_000;

export type SttProviderId = 'openai' | 'llm_primary' | 'llm_fallback' | 'disabled';

export interface SttContext {
  updateId?: number;
}

export interface SttAttemptResult {
  ok: boolean;
  provider: Exclude<SttProviderId, 'disabled'>;
  text?: string;
  confidence?: number;
  usedFallback: boolean;
  fail?: {
    kind: 'missing_config' | 'http' | 'timeout' | 'network' | 'empty' | 'unexpected';
    status?: number;
    message?: string;
    geoBlocked?: boolean;
  };
}

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1' || process.env.WHATSAPP_DEBUG === '1';
}

function getTimeoutMs(): number {
  const raw = process.env.VOICE_STT_TIMEOUT_MS ?? process.env.WHISPER_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : STT_TIMEOUT_MS_DEFAULT;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function isGeoBlockedStt(status: number, body: string): boolean {
  if (status !== 403) return false;
  const b = (body ?? '').toLowerCase();
  return b.includes('unsupported_country_region_territory') || b.includes('country, region, or territory not supported');
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.hostname.toLowerCase() === 'openrouter.ai';
  } catch {
    return baseUrl.toLowerCase().includes('openrouter.ai');
  }
}

function defaultModelForBaseUrl(baseUrl: string): string {
  const u = baseUrl.toLowerCase();
  // OpenRouter STT uses chat-completions w/ audio modality (not Whisper endpoint).
  // `whisper-1` will 400 ("not a valid model ID") on OpenRouter.
  if (isOpenRouterBaseUrl(baseUrl)) return 'openai/gpt-4o-mini-transcribe';
  // Groq Whisper models are not "whisper-1".
  if (u.includes('api.groq.com')) return 'whisper-large-v3-turbo';
  return 'whisper-1';
}

function getPrimaryProvider(): SttProviderId {
  const raw = (process.env.VOICE_STT_PRIMARY ?? '').trim().toLowerCase();
  if (!raw) {
    // Production safety: if an explicit STT fallback is configured, prefer it by default.
    // This avoids relying on a potentially geo-blocked "primary" provider as the default STT path.
    const hasLlmFallback =
      Boolean((process.env.LLM_FALLBACK_BASE_URL ?? '').trim()) && Boolean((process.env.LLM_FALLBACK_API_KEY ?? '').trim());
    return hasLlmFallback ? 'llm_fallback' : 'llm_primary';
  }
  if (raw === 'openai') return 'openai';
  if (raw === 'llm_primary') return 'llm_primary';
  if (raw === 'llm_fallback') return 'llm_fallback';
  if (raw === 'disabled' || raw === 'off' || raw === 'none') return 'disabled';
  return 'llm_primary';
}

function getFallbackProvider(): SttProviderId {
  const raw = (process.env.VOICE_STT_FALLBACK ?? '').trim().toLowerCase();
  if (!raw) {
    // Default fallback: use an explicitly-configured LLM fallback (if present).
    // We intentionally do NOT auto-select OpenAI here because some server regions are geo-blocked for STT.
    const hasLlmFallback =
      Boolean((process.env.LLM_FALLBACK_BASE_URL ?? '').trim()) && Boolean((process.env.LLM_FALLBACK_API_KEY ?? '').trim());
    return hasLlmFallback ? 'llm_fallback' : 'disabled';
  }
  if (raw === 'openai') return 'openai';
  if (raw === 'llm_primary') return 'llm_primary';
  if (raw === 'llm_fallback') return 'llm_fallback';
  if (raw === 'disabled' || raw === 'off' || raw === 'none') return 'disabled';
  return 'disabled';
}

function getVoiceSttRelayConfig(): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrlRaw = (process.env.VOICE_STT_BASE_URL ?? '').trim();
  if (!baseUrlRaw) return null;
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const apiKey =
    (process.env.VOICE_STT_API_KEY ?? '').trim() ||
    (process.env.VOICE_STT_RELAY_TOKEN ?? '').trim() ||
    (process.env.OPENAI_API_KEY ?? '').trim() ||
    'relay';
  const model = (process.env.VOICE_STT_MODEL ?? '').trim() || defaultModelForBaseUrl(baseUrl);
  return { baseUrl, apiKey, model };
}

function getProviderConfig(provider: Exclude<SttProviderId, 'disabled'>): { baseUrl: string; apiKey: string; model: string } | null {
  if (provider === 'openai') {
    const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
    if (!apiKey) return null;
    const baseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1');
    const model = (process.env.VOICE_STT_MODEL ?? '').trim() || defaultModelForBaseUrl(baseUrl);
    return { baseUrl, apiKey, model };
  }

  if (provider === 'llm_primary') {
    const baseUrl = normalizeBaseUrl(process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1');
    const apiKey = (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '').trim();
    if (!apiKey) return null;
    const model =
      (process.env.VOICE_STT_MODEL ?? '').trim() ||
      (process.env.LLM_STT_MODEL ?? '').trim() ||
      defaultModelForBaseUrl(baseUrl);
    return { baseUrl, apiKey, model };
  }

  // llm_fallback
  const baseUrlRaw = (process.env.LLM_FALLBACK_BASE_URL ?? '').trim();
  const apiKey = (process.env.LLM_FALLBACK_API_KEY ?? '').trim();
  if (!baseUrlRaw || !apiKey) return null;
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const model =
    (process.env.VOICE_STT_MODEL ?? '').trim() ||
    (process.env.LLM_FALLBACK_STT_MODEL ?? '').trim() ||
    (process.env.LLM_FALLBACK_MODEL ?? '').trim() ||
    defaultModelForBaseUrl(baseUrl);
  return { baseUrl, apiKey, model };
}

function filenameToAudioFormat(filename: string): string {
  const lower = filename.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  // OpenRouter docs list common formats; pass through best-effort.
  if (ext === 'wav') return 'wav';
  if (ext === 'mp3') return 'mp3';
  if (ext === 'aiff' || ext === 'aif') return 'aiff';
  if (ext === 'aac') return 'aac';
  if (ext === 'ogg') return 'ogg';
  if (ext === 'flac') return 'flac';
  if (ext === 'm4a') return 'm4a';
  if (ext === 'webm') return 'webm';
  if (ext === 'opus') return 'opus';
  return 'wav';
}

function extractTextFromChatCompletionJson(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as {
    choices?: Array<{
      message?: { content?: unknown };
      delta?: { content?: unknown };
    }>;
  };
  const first = d.choices?.[0];
  const content = first?.message?.content ?? first?.delta?.content;
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    // Some providers return structured content parts; collect any text-like parts.
    const texts: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as { type?: unknown; text?: unknown };
      if (p.type === 'text' && typeof p.text === 'string') texts.push(p.text);
    }
    const joined = texts.join('').trim();
    return joined || null;
  }
  return null;
}

async function transcribeViaOpenRouterChat(params: {
  provider: Exclude<SttProviderId, 'disabled'>;
  baseUrl: string;
  apiKey: string;
  model: string;
  audioBuffer: ArrayBuffer;
  filename: string;
  ctx?: SttContext;
}): Promise<{ ok: true; text: string } | { ok: false; fail: SttAttemptResult['fail'] }> {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (debugEnabled()) {
    console.log('[voice:stt] attempt.start_openrouter_audio', {
      provider: params.provider,
      update_id: params.ctx?.updateId ?? null,
      baseUrl: params.baseUrl,
      model: params.model,
      filename: params.filename,
      timeout_ms: timeoutMs,
      bytes: params.audioBuffer.byteLength,
    });
  }

  try {
    const bytes = new Uint8Array(params.audioBuffer);
    // Avoid Node-only Buffer dependency; convert manually for Edge compatibility.
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64Audio = btoa(binary);
    const format = filenameToAudioFormat(params.filename);

    const res = await fetch(`${params.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this audio. Return only the transcript text.' },
              { type: 'input_audio', input_audio: { data: base64Audio, format } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      const geoBlocked = isGeoBlockedStt(res.status, body);
      console.error('[voice:stt] attempt.fail_http', {
        provider: params.provider,
        update_id: params.ctx?.updateId ?? null,
        baseUrl: params.baseUrl,
        model: params.model,
        status: res.status,
        geo_blocked: geoBlocked,
        body,
      });
      return { ok: false, fail: { kind: 'http', status: res.status, message: body, geoBlocked } };
    }

    const data = (await res.json()) as unknown;
    const text = extractTextFromChatCompletionJson(data);
    if (!text) {
      console.warn('[voice:stt] attempt.fail_empty', { provider: params.provider });
      return { ok: false, fail: { kind: 'empty' } };
    }

    if (debugEnabled()) console.log('[voice:stt] attempt.ok', { provider: params.provider, chars: text.length });
    return { ok: true, text };
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      console.error('[voice:stt] attempt.fail_timeout', {
        provider: params.provider,
        update_id: params.ctx?.updateId ?? null,
        timeout_ms: timeoutMs,
      });
      return { ok: false, fail: { kind: 'timeout', message: `timeout_ms=${timeoutMs}` } };
    }
    console.error('[voice:stt] attempt.fail_network', {
      provider: params.provider,
      update_id: params.ctx?.updateId ?? null,
      message: (err as Error).message,
    });
    return { ok: false, fail: { kind: 'network', message: (err as Error).message } };
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeOpenAiCompatible(params: {
  provider: Exclude<SttProviderId, 'disabled'>;
  baseUrl: string;
  apiKey: string;
  model: string;
  audioBuffer: ArrayBuffer;
  filename: string;
  ctx?: SttContext;
}): Promise<{ ok: true; text: string; confidence?: number } | { ok: false; fail: SttAttemptResult['fail'] }> {
  // OpenRouter does NOT implement the OpenAI Whisper `/audio/transcriptions` endpoint.
  // Instead, it accepts audio as an input modality via `/chat/completions`.
  if (isOpenRouterBaseUrl(params.baseUrl)) {
    return transcribeViaOpenRouterChat(params);
  }

  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  console.info('[voice:stt] attempt.start', {
    provider: params.provider,
    update_id: params.ctx?.updateId ?? null,
    baseUrl: params.baseUrl,
    model: params.model,
    filename: params.filename,
    timeout_ms: timeoutMs,
    bytes: params.audioBuffer.byteLength,
  });

  try {
    const blob = new Blob([params.audioBuffer]);
    const form = new FormData();
    form.append('file', blob, params.filename);
    form.append('model', params.model);

    const res = await fetch(`${params.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      const geoBlocked = isGeoBlockedStt(res.status, body);
      console.error('[voice:stt] attempt.fail_http', {
        provider: params.provider,
        update_id: params.ctx?.updateId ?? null,
        baseUrl: params.baseUrl,
        model: params.model,
        status: res.status,
        geo_blocked: geoBlocked,
        body,
      });
      return { ok: false, fail: { kind: 'http', status: res.status, message: body, geoBlocked } };
    }

    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim();
    if (!text) {
      console.warn('[voice:stt] attempt.fail_empty', { provider: params.provider });
      return { ok: false, fail: { kind: 'empty' } };
    }

    console.info('[voice:stt] attempt.ok', {
      provider: params.provider,
      update_id: params.ctx?.updateId ?? null,
      baseUrl: params.baseUrl,
      model: params.model,
      chars: text.length,
    });
    return { ok: true, text };
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      console.error('[voice:stt] attempt.fail_timeout', {
        provider: params.provider,
        update_id: params.ctx?.updateId ?? null,
        timeout_ms: timeoutMs,
      });
      return { ok: false, fail: { kind: 'timeout', message: `timeout_ms=${timeoutMs}` } };
    }
    console.error('[voice:stt] attempt.fail_network', {
      provider: params.provider,
      update_id: params.ctx?.updateId ?? null,
      message: (err as Error).message,
    });
    return { ok: false, fail: { kind: 'network', message: (err as Error).message } };
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeWithConfiguredStt(params: {
  audioBuffer: ArrayBuffer;
  filename: string;
  ctx?: SttContext;
}): Promise<SttAttemptResult> {
  if (process.env.VOICE_TRANSCRIPTION_DISABLED === '1') {
    if (debugEnabled()) console.info('[voice:stt] transcription.disabled');
    return { ok: false, provider: 'llm_primary', usedFallback: false, fail: { kind: 'missing_config', message: 'VOICE_TRANSCRIPTION_DISABLED' } };
  }

  const relay = getVoiceSttRelayConfig();
  if (relay) {
    console.info('[voice:stt] selection', {
      update_id: params.ctx?.updateId ?? null,
      primary: 'google_stt_relay',
      baseUrl: relay.baseUrl,
      model: relay.model,
    });
    const relayAttempt = await transcribeOpenAiCompatible({
      provider: 'openai',
      baseUrl: relay.baseUrl,
      apiKey: relay.apiKey,
      model: relay.model,
      audioBuffer: params.audioBuffer,
      filename: params.filename,
      ctx: params.ctx,
    });
    if (relayAttempt.ok) {
      return { ok: true, provider: 'openai', usedFallback: false, text: relayAttempt.text };
    }
    return {
      ok: false,
      provider: 'openai',
      usedFallback: false,
      fail: relayAttempt.fail ?? { kind: 'unexpected' },
    };
  }

  const primary = getPrimaryProvider();
  const fallback = getFallbackProvider();

  console.info('[voice:stt] selection', { update_id: params.ctx?.updateId ?? null, primary, fallback });

  if (primary === 'disabled') {
    return { ok: false, provider: 'llm_primary', usedFallback: false, fail: { kind: 'missing_config', message: 'VOICE_STT_PRIMARY=disabled' } };
  }

  const attemptProviders: Array<{ provider: Exclude<SttProviderId, 'disabled'>; usedFallback: boolean }> = [
    { provider: primary, usedFallback: false },
  ];
  if (fallback !== 'disabled' && fallback !== primary) {
    attemptProviders.push({ provider: fallback, usedFallback: true });
  }

  for (const p of attemptProviders) {
    const cfg = getProviderConfig(p.provider);
    if (!cfg) {
      console.warn('[voice:stt] attempt.skip_missing_config', { provider: p.provider });
      if (p.usedFallback) {
        return { ok: false, provider: p.provider, usedFallback: true, fail: { kind: 'missing_config', message: 'missing provider config' } };
      }
      continue;
    }

    const r = await transcribeOpenAiCompatible({
      provider: p.provider,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      audioBuffer: params.audioBuffer,
      filename: params.filename,
      ctx: params.ctx,
    });
    if (r.ok) return { ok: true, provider: p.provider, usedFallback: p.usedFallback, text: r.text };

    // Emergency: if primary is geo-blocked (403 unsupported_country_region_territory),
    // attempt `llm_fallback` if it is configured, even when VOICE_STT_FALLBACK is "disabled".
    // This keeps behavior safe (no webhook changes) while enabling a production fix via env only.
    if (!p.usedFallback && r.fail?.kind === 'http' && r.fail?.geoBlocked) {
      const fallbackCfg = getProviderConfig('llm_fallback');
      if (fallbackCfg && p.provider !== 'llm_fallback') {
        console.warn('[voice:stt] geo_blocked.primary_trying_emergency_fallback', {
          update_id: params.ctx?.updateId ?? null,
          primary_provider: p.provider,
          fallback_provider: 'llm_fallback',
        });
        const fr = await transcribeOpenAiCompatible({
          provider: 'llm_fallback',
          baseUrl: fallbackCfg.baseUrl,
          apiKey: fallbackCfg.apiKey,
          model: fallbackCfg.model,
          audioBuffer: params.audioBuffer,
          filename: params.filename,
          ctx: params.ctx,
        });
        if (fr.ok) return { ok: true, provider: 'llm_fallback', usedFallback: true, text: fr.text };
        return { ok: false, provider: 'llm_fallback', usedFallback: true, fail: fr.fail };
      }
      return { ok: false, provider: p.provider, usedFallback: false, fail: r.fail };
    }
  }

  return { ok: false, provider: primary, usedFallback: false, fail: { kind: 'unexpected' } };
}

