const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const TIMEOUT_MS = 8000;

interface LLMCallOptions {
  systemPrompt: string;
  userMessage: string;
}

/**
 * Call OpenAI Chat Completions with a hard timeout.
 * Returns null on failure so callers can fall back gracefully.
 */
export async function callLLM({ systemPrompt, userMessage }: LLMCallOptions): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.warn('[LLM] OPENAI_API_KEY not set — skipping LLM call');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
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
      console.error('[LLM] API error:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('[LLM] Request timed out after', TIMEOUT_MS, 'ms');
    } else {
      console.error('[LLM] Unexpected error:', err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
