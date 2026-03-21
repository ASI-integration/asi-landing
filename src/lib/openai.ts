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
}

function buildConfig(): { primary: ProviderConfig; fallback: ProviderConfig | null } {
  const primary: ProviderConfig = {
    baseUrl: (process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  };

  const fallbackBase = process.env.LLM_FALLBACK_BASE_URL;
  const fallback: ProviderConfig | null = fallbackBase
    ? {
        baseUrl: fallbackBase.replace(/\/$/, ''),
        apiKey: process.env.LLM_FALLBACK_API_KEY ?? '',
        model: process.env.LLM_FALLBACK_MODEL ?? primary.model,
      }
    : null;

  return { primary, fallback };
}

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 10000);

/**
 * Call the configured LLM. Tries the primary provider first; if it fails and a
 * fallback is configured, tries the fallback. Returns null on total failure so
 * callers can degrade gracefully.
 */
export async function callLLM(options: LLMCallOptions): Promise<string | null> {
  const { primary, fallback } = buildConfig();

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
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
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error(`${tag} Request timed out after ${TIMEOUT_MS}ms`);
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
    console.error(`${tag} Auth failed — invalid API key (status=401)`);
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
