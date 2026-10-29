import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Shared ASI RU identity policy. Never build a separate users table or session. */
export const RU_CODE_DIGITS = 8;
export const RU_CODE_TTL_SECONDS = 600;
export const RU_CODE_MAX_ATTEMPTS = 5;

export function normalizeLoginEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || /[\x00-\x20\x7f]/.test(email)) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)) return null;
  return email;
}

export function createOneTimeCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(RU_CODE_DIGITS, '0');
}

/** Pepper is server-only, >=32 characters, never stored in database or browser. */
export function digestOneTimeCode(email: string, code: string, pepper: string): string {
  if (!normalizeLoginEmail(email) || !/^[0-9]{8}$/.test(code) || pepper.length < 32) {
    throw new Error('EMAIL_CODE_SECURITY_CONFIGURATION');
  }
  return createHmac('sha256', pepper).update('asi.ru.email-code.v1\0').update(email).update('\0').update(code).digest('hex');
}

export function matchOneTimeCodeDigest(expectedHex: string, actualHex: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHex) || !/^[0-9a-f]{64}$/.test(actualHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
}

export function ruCodeAuthConfigured(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.ASI_RU_EMAIL_CODE_ENABLED === 'true' &&
    (env.ASI_RU_EMAIL_CODE_PEPPER?.length ?? 0) >= 32 &&
    Boolean(env.ASI_AUTH_RESEND_API_KEY?.trim()) &&
    Boolean(env.ASI_AUTH_FROM_EMAIL?.trim()) &&
    (env.SESSION_SECRET?.trim().length ?? 0) >= 32 &&
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()) &&
    Boolean(env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim());
}

/** Request must originate from the same exact browser origin. */
export function isSameOriginAuthRequest(requestUrl: string, requestOrigin: string | null): boolean {
  try {
    const target = new URL(requestUrl);
    const origin = new URL(requestOrigin || '');
    return target.protocol === 'https:' && origin.protocol === target.protocol &&
      origin.host === target.host && origin.origin === requestOrigin;
  } catch {
    return false;
  }
}
