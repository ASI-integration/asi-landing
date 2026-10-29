import { describe, expect, it } from 'vitest';
import {
  createOneTimeCode, digestOneTimeCode, isSameOriginAuthRequest,
  matchOneTimeCodeDigest, normalizeLoginEmail, ruCodeAuthConfigured,
} from '../ru-email-code-policy';

const pepper = 'test-only-inert-pepper-at-least-32-chars';
describe('shared RU email-code identity policy', () => {
  it('normalizes real addresses but rejects malformed, control and oversized values', () => {
    expect(normalizeLoginEmail('  User@Example.RU  ')).toBe('user@example.ru');
    for (const e of ['x', 'user@example', 'abc @example.ru', 'a'.repeat(256)+'@ru.ru', null, {}, '\n@e.ru']) {
      expect(normalizeLoginEmail(e)).toBeNull();
    }
  });
  it('generates exactly eight decimal digits including possible leading zero', () => {
    for (let i = 0; i < 20; i++) expect(createOneTimeCode()).toMatch(/^[0-9]{8}$/);
  });
  it('derives bound HMAC without storing raw code and checks constant-time digest', () => {
    const a = digestOneTimeCode('one@example.ru', '00012345', pepper);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toContain('00012345');
    expect(matchOneTimeCodeDigest(a, a)).toBe(true);
    expect(matchOneTimeCodeDigest(a, digestOneTimeCode('two@example.ru', '00012345', pepper))).toBe(false);
    expect(matchOneTimeCodeDigest(a, digestOneTimeCode('one@example.ru', '11112345', pepper))).toBe(false);
    expect(matchOneTimeCodeDigest('zz', a)).toBe(false);
    expect(() => digestOneTimeCode('one@example.ru', '12345678', 'weak')).toThrow();
  });
  it('defaults to disabled unless the complete server-only capability is configured', () => {
    const env = {
      ASI_RU_EMAIL_CODE_ENABLED: 'true', ASI_RU_EMAIL_CODE_PEPPER: pepper,
      ASI_AUTH_RESEND_API_KEY: 'fixture', ASI_AUTH_FROM_EMAIL: 'no-reply@asi-global.ru',
      SESSION_SECRET: pepper, SUPABASE_URL: 'https://example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    };
    expect(ruCodeAuthConfigured(env)).toBe(true);
    expect(ruCodeAuthConfigured({ ...env, ASI_RU_EMAIL_CODE_ENABLED: undefined })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, ASI_RU_EMAIL_CODE_PEPPER: '' })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, ASI_AUTH_RESEND_API_KEY: undefined })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, SESSION_SECRET: '' })).toBe(false);
  });
  it('rejects cross-origin and non-HTTPS requests', () => {
    const url='https://asi-global.ru/api/auth/email-code/request';
    expect(isSameOriginAuthRequest(url, 'https://asi-global.ru')).toBe(true);
    for(const origin of ['https://fake.asi-global.ru','https://asi-global.ru.evil.test',
      'http://asi-global.ru', 'https://asi-global.ru:444', null, 'not-a-url']) {
      expect(isSameOriginAuthRequest(url, origin)).toBe(false);
    }
  });
});
