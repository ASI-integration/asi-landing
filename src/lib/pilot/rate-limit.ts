/**
 * SP-04 — basic create rate limit (per process, fail-closed when exceeded).
 * Not a distributed limiter; enough for pilot beta API surface.
 */
import { PilotAccessError } from './errors';

const WINDOW_MS = 60_000;
const MAX_CREATES_PER_WINDOW = 10;

const createTimestampsByUser = new Map<string, number[]>();

export function assertPilotCreateRateLimit(
  pilotUserId: string,
  nowMs: number = Date.now(),
): void {
  const key = String(pilotUserId ?? '').trim();
  if (!key) {
    throw new PilotAccessError('invalid_pilot', 400, 'Некорректный пользователь пилота.');
  }

  const cutoff = nowMs - WINDOW_MS;
  const prior = (createTimestampsByUser.get(key) ?? []).filter((ts) => ts >= cutoff);
  if (prior.length >= MAX_CREATES_PER_WINDOW) {
    throw new PilotAccessError(
      'rate_limited',
      429,
      'Слишком много запросов. Подождите минуту и попробуйте снова.',
    );
  }
  prior.push(nowMs);
  createTimestampsByUser.set(key, prior);
}

/** Test-only helper to reset in-memory buckets. */
export function resetPilotCreateRateLimitForTests(): void {
  createTimestampsByUser.clear();
}
