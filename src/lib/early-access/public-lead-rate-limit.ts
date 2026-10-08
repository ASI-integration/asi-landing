import { createHash, randomBytes } from 'node:crypto';
import type { NormalizedCrmContactInput } from '@/lib/crm/normalize';

const salt = randomBytes(16).toString('hex');
const CONTACT_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 1000;
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_CONTACT = 3;
const MAX_GLOBAL = 150;

type Counter = { count: number; expiresAt: number };
type ProcessResult =
  | { allowed: false; retryAfterSeconds: number }
  | { allowed: true; replayed: boolean };

// Defense in depth only: these hashes and counters are process-local and disappear on restart.
// Request IP headers are deliberately ignored because this route cannot prove that a trusted
// reverse proxy overwrote them. See docs/PUBLIC_LEAD_ANTI_ABUSE.md.
const counts = new Map<string, Counter>();
const inFlight = new Map<string, Promise<Exclude<ProcessResult, { allowed: false }>>>();
const completed = new Map<string, number>();

function fingerprint(namespace: string, raw: string): string {
  return createHash('sha256').update([salt, namespace, raw.toLowerCase()].join('|')).digest('hex');
}

function cleanup(now: number): void {
  for (const [key, state] of counts) if (state.expiresAt <= now) counts.delete(key);
  for (const [key, expiresAt] of completed) if (expiresAt <= now) completed.delete(key);
}

function reserve(key: string, max: number, windowMs: number, now: number): Counter | null {
  const previous = counts.get(key);
  if (!previous || previous.expiresAt <= now) {
    const counter = { count: 1, expiresAt: now + windowMs };
    counts.set(key, counter);
    return counter;
  }
  if (previous.count >= max) return null;
  previous.count += 1;
  return previous;
}

function reserveAttempt(contact: string, now: number): { allowed: true } | {
  allowed: false;
  retryAfterSeconds: number;
} {
  cleanup(now);
  const buckets = [
    { key: 'global', max: MAX_GLOBAL, windowMs: GLOBAL_WINDOW_MS },
    {
      key: 'contact:' + fingerprint('contact', contact.trim()),
      max: MAX_PER_CONTACT,
      windowMs: CONTACT_WINDOW_MS,
    },
  ];
  const blockedUntil = buckets.reduce((latest, { key, max }) => {
    const item = counts.get(key);
    return item && item.expiresAt > now && item.count >= max
      ? Math.max(latest, item.expiresAt)
      : latest;
  }, 0);
  if (blockedUntil) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) };
  }

  for (const bucket of buckets) {
    const counter = reserve(bucket.key, bucket.max, bucket.windowMs, now);
    if (!counter) throw new Error('Public lead reservation changed unexpectedly');
  }
  return { allowed: true };
}

function submissionFingerprint(input: NormalizedCrmContactInput): string {
  return fingerprint('submission', JSON.stringify(input));
}

function contactIdentity(input: NormalizedCrmContactInput): string {
  if (input.telegramUsername) return `telegram:${input.telegramUsername.toLowerCase()}`;
  if (input.email) return `email:${input.email.toLowerCase()}`;
  return `phone:${input.phone.replace(/\D/g, '')}`;
}

export async function processPublicPilotLead(
  input: NormalizedCrmContactInput,
  persist: () => Promise<void>,
  now = Date.now(),
): Promise<ProcessResult> {
  cleanup(now);
  const key = submissionFingerprint(input);
  const completedUntil = completed.get(key);
  if (completedUntil && completedUntil > now) return { allowed: true, replayed: true };

  const running = inFlight.get(key);
  if (running) {
    await running;
    return { allowed: true, replayed: true };
  }

  const reservation = reserveAttempt(contactIdentity(input), now);
  if (!reservation.allowed) return reservation;

  const operation = (async (): Promise<{ allowed: true; replayed: false }> => {
    await persist();
    completed.set(key, now + IDEMPOTENCY_WINDOW_MS);
    return { allowed: true, replayed: false };
  })();
  inFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(key) === operation) inFlight.delete(key);
  }
}

export function resetPublicPilotLeadRateLimitForTests(): void {
  counts.clear();
  inFlight.clear();
  completed.clear();
}
