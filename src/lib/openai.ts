/**
 * LLM client — provider-agnostic, OpenAI-compatible Chat Completions API.
 *
 * Primary provider configuration (env vars):
 *   LLM_BASE_URL    Base URL of the provider  (default: https://api.openai.com/v1)
 *   LLM_API_KEY     API key                   (falls back to OPENAI_API_KEY)
 *   LLM_MODEL       Model name                (default: gpt-4o-mini)
 *   LLM_TIMEOUT_MS  Request timeout in ms     (default: 10000)
 *
 * Optional fallback provider (tried if primary fails):
 *   LLM_FALLBACK_BASE_URL
 *   LLM_FALLBACK_API_KEY
 *   LLM_FALLBACK_MODEL  (defaults to LLM_MODEL if not set)
 *
 * OpenRouter-specific (auto-detected via LLM_BASE_URL):
 *   HTTP-Referer and X-Title headers are injected automatically when the
 *   base URL contains "openrouter.ai".  Without them, OpenRouter may return
 *   choices[0].message.content = null for non-localhost API keys.
 *   Override the referer via NEXT_PUBLIC_APP_URL.
 *
 * Any OpenAI-compatible provider works: OpenRouter, Groq, Together AI, etc.
 */

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LLMCallOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
}

function buildConfig(modelOverride?: string): { primary: ProviderConfig; fallback: ProviderConfig | null } {
  const primary: ProviderConfig = {
    baseUrl: (process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    model: modelOverride || process.env.LLM_MODEL || 'gpt-4o-mini',
  };

  const fallbackBase = process.env.LLM_FALLBACK_BASE_URL;
  const fallback: ProviderConfig | null = fallbackBase
    ? {
        baseUrl: fallbackBase.replace(/\/$/, ''),
        apiKey: process.env.LLM_FALLBACK_API_KEY ?? '',
        model: modelOverride || process.env.LLM_FALLBACK_MODEL || primary.model,
      }
    : null;

  return { primary, fallback };
}

/**
 * Call the configured LLM. Tries the primary provider first; if it fails and a
 * fallback is configured, tries the fallback. Returns null on total failure so
 * callers can degrade gracefully.
 */
export async function callLLM(options: LLMCallOptions): Promise<string | null> {
  const { primary, fallback } = buildConfig(options.model?.trim() || undefined);

  const result = await callProvider(primary, options, false);
  if (result !== null) return result;

  if (fallback) {
    console.warn('[LLM] Primary provider failed — trying fallback');
    return callProvider(fallback, options, true);
  }

  return null;
}

async function callProvider(
  cfg: ProviderConfig,
  { systemPrompt, userMessage }: LLMCallOptions,
  isFallback: boolean,
): Promise<string | null> {
  const tag = isFallback ? '[LLM:fallback]' : '[LLM:primary]';

  if (!cfg.apiKey) {
    console.warn(`${tag} API key not configured — skipping`);
    return null;
  }

  // Read timeout at call time (not at module init) so Vercel env is guaranteed
  // to be available and NaN from early cold-starts is avoided.
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 10000);

  // Diagnostic log — reveals which provider/model/key prefix was actually
  // resolved so 401/403 errors are immediately traceable in production logs.
  const maskedKey = cfg.apiKey.length > 8
    ? `${cfg.apiKey.slice(0, 8)}…`
    : '(short-key)';
  console.info(`${tag} calling baseUrl=${cfg.baseUrl} model=${cfg.model} key=${maskedKey}`);

  // OpenRouter requires these headers for non-localhost keys; without them the
  // response may include content: null even for a 200 OK.
  const isOpenRouter = cfg.baseUrl.includes('openrouter.ai');
  const extraHeaders: Record<string, string> = isOpenRouter
    ? {
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://asi-landing.local',
        'X-Title': 'ASI Telegram Bot',
      }
    : {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 200,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      logProviderError(tag, res.status, body);
      return null;
    }

    const data = await res.json();
    const content: string | null | undefined = data?.choices?.[0]?.message?.content;

    if (content == null) {
      // OpenRouter returns content: null when the request is gated (e.g. missing
      // Referer, quota exhausted, or model returned an empty completion).
      console.warn(
        `${tag} Provider returned content=null (status=200). ` +
          `Check HTTP-Referer header, quota, and model availability.`,
      );
      return null;
    }

    return content.trim() || null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error(`${tag} Request timed out after ${timeoutMs}ms`);
    } else {
      console.error(`${tag} Network error:`, (err as Error).message ?? err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function logProviderError(tag: string, status: number, body: string): void {
  if (status === 403 && body.includes('unsupported_country_region_territory')) {
    console.error(`${tag} Provider blocked — geo-restriction (status=403)`);
  } else if (status === 401) {
    console.error(`${tag} Auth failed — invalid API key (status=401) body=${body.slice(0, 200)}`);
  } else if (status === 403) {
    console.error(`${tag} Auth failed — forbidden (status=403) body=${body.slice(0, 200)}`);
  } else if (status === 429) {
    console.error(`${tag} Rate limited (status=429)`);
  } else if (status >= 500) {
    console.error(`${tag} Provider server error (status=${status})`);
  } else {
    console.error(`${tag} API error status=${status} body=${body.slice(0, 200)}`);
  }
}
