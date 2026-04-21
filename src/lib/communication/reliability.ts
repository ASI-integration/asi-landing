import { createHash } from 'crypto';

export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

export function jitterMs(baseMs: number): number {
  const r = Math.random();
  return Math.max(0, Math.floor(baseMs * (0.7 + 0.6 * r)));
}

export type RetryDecision = {
  retryable: boolean;
  reason: string;
};

export function classifyRetryableError(err: unknown): RetryDecision {
  const msg =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === 'string'
        ? err
        : JSON.stringify(err);

  const m = msg.toLowerCase();

  // Common transient/network failure signatures
  if (
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('econnreset') ||
    m.includes('eai_again') ||
    m.includes('enotfound') ||
    m.includes('socket hang up') ||
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('503') ||
    m.includes('502') ||
    m.includes('504')
  ) {
    return { retryable: true, reason: 'transient_network_or_rate_limit' };
  }

  return { retryable: false, reason: 'non_retryable' };
}

export async function retry<T>(params: {
  attempts: number;
  baseDelayMs: number;
  onAttempt?: (info: { attempt: number; error?: unknown; decision?: RetryDecision }) => void;
  fn: () => Promise<T>;
  isSuccess?: (value: T) => boolean;
}): Promise<{ ok: boolean; value?: T; attempts: number; lastError?: unknown; lastDecision?: RetryDecision }> {
  const max = Math.max(1, params.attempts);
  let lastError: unknown = undefined;
  let lastDecision: RetryDecision | undefined = undefined;

  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      params.onAttempt?.({ attempt });
      const v = await params.fn();
      const ok = params.isSuccess ? params.isSuccess(v) : true;
      if (ok) return { ok: true, value: v, attempts: attempt };
      // Treat "false-y success value" as error-ish for retry logic.
      lastError = new Error('retry: unsuccessful result');
      lastDecision = { retryable: true, reason: 'unsuccessful_result' };
      params.onAttempt?.({ attempt, error: lastError, decision: lastDecision });
    } catch (err) {
      lastError = err;
      lastDecision = classifyRetryableError(err);
      params.onAttempt?.({ attempt, error: err, decision: lastDecision });
      if (!lastDecision.retryable) {
        return { ok: false, attempts: attempt, lastError, lastDecision };
      }
    }

    if (attempt < max) {
      const delay = jitterMs(params.baseDelayMs * Math.pow(2, attempt - 1));
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return { ok: false, attempts: max, lastError, lastDecision };
}

