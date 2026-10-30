import { describe, expect, it } from 'vitest';
import { safeAuthRedirectPath } from '../app-url';
import {
  createOneTimeCode, digestOneTimeCode, isSameOriginAuthRequest,
  isCanonicalRuEmailCodeRequest,
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
    // The public digest helper must be invariant under the same case/space
    // normalization as the real OTP issuance and verification paths.
    expect(digestOneTimeCode('  ONE@Example.RU  ', '00012345', pepper)).toBe(a);
    expect(() => digestOneTimeCode('not-an-email', '00012345', pepper)).toThrow();
    expect(() => digestOneTimeCode('one@example.ru', '0001234x', pepper)).toThrow();
  });
  it('defaults to disabled unless the complete server-only capability is configured', () => {
    const env = {
      ASI_RU_EMAIL_CODE_ENABLED: 'true', ASI_RU_EMAIL_CODE_SCHEMA_READY: 'true',
      ASI_RU_EMAIL_CODE_ORIGIN: 'https://www.asi-global.ru',
      ASI_RU_EMAIL_CODE_PEPPER: pepper,
      ASI_AUTH_RESEND_API_KEY: 'fixture', ASI_AUTH_FROM_EMAIL: 'no-reply@asi-global.ru',
      SESSION_SECRET: pepper, SUPABASE_URL: 'https://example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    };
    expect(ruCodeAuthConfigured(env)).toBe(true);
    expect(ruCodeAuthConfigured({ ...env, ASI_RU_EMAIL_CODE_ENABLED: undefined })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, ASI_RU_EMAIL_CODE_SCHEMA_READY: undefined })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, ASI_RU_EMAIL_CODE_ORIGIN: undefined })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, ASI_RU_EMAIL_CODE_ORIGIN: 'https://evil.ru' })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, ASI_RU_EMAIL_CODE_SCHEMA_READY: 'false' })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, ASI_RU_EMAIL_CODE_PEPPER: '' })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, ASI_AUTH_RESEND_API_KEY: undefined })).toBe(false);
    expect(ruCodeAuthConfigured({ ...env, SESSION_SECRET: '' })).toBe(false);
  });
  it('preserves internal redirects and rejects cross-origin login destinations', () => {
    expect(safeAuthRedirectPath('/dashboard/settings?tab=profile'))
      .toBe('/dashboard/settings?tab=profile');
    for (const unsafe of [
      null, '', '//evil.example', '/\\\\evil.example', '/next\\\\evil.example',
      '/next\nmalicious', 'https://evil.example', 'javascript:alert(1)',
    ]) {
      expect(safeAuthRedirectPath(unsafe)).toBe('/dashboard');
    }
  });
  it('accepts OTP only at its exact configured ASI RU origin, regardless of a spoofed forwarded host', () => {
    const env={ASI_RU_EMAIL_CODE_ORIGIN:'https://www.asi-global.ru'};
    expect(isCanonicalRuEmailCodeRequest('https://www.asi-global.ru/api/auth/email-code/request',env)).toBe(true);
    for (const uri of [
      'http://www.asi-global.ru/api/auth/email-code/request',
      'https://asi-global.ru/api/auth/email-code/request',
      'https://g2.asi-global.ru/api/auth/email-code/request',
      'https://another-business.ru/api/auth/email-code/request',
      'https://www.asi-global.ru.evil.ru/api/auth/email-code/request',
      'https://www.asi-global.ru:8443/api/auth/email-code/request',
      'not-a-url',
    ]) expect(isCanonicalRuEmailCodeRequest(uri,env)).toBe(false);
    for (const origin of [undefined,'https://evil.ru','https://www.asi-global.ru:8443',
      'http://www.asi-global.ru','https://user@www.asi-global.ru',
      'https://www.asi-global.ru/extra']) {
      expect(isCanonicalRuEmailCodeRequest('https://www.asi-global.ru/api/auth/email-code/request',
        {ASI_RU_EMAIL_CODE_ORIGIN:origin})).toBe(false);
    }
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
