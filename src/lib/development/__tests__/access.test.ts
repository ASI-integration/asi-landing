import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDevelopmentOwnerEmail } from '../access';

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isDevelopmentOwnerEmail', () => {
  it('allows an owner email from ASI_DEVELOPMENT_OWNER_EMAILS (case-insensitive)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', 'Owner@Example.com, other@example.com');
    expect(isDevelopmentOwnerEmail('owner@example.com')).toBe(true);
    expect(isDevelopmentOwnerEmail('OWNER@EXAMPLE.COM')).toBe(true);
  });

  it('denies a regular authenticated user', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', 'owner@example.com');
    expect(isDevelopmentOwnerEmail('user@example.com')).toBe(false);
  });

  it('denies everyone in production when ASI_DEVELOPMENT_OWNER_EMAILS is empty', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', '');
    expect(isDevelopmentOwnerEmail('anyone@asi-global.ru')).toBe(false);
    expect(isDevelopmentOwnerEmail('owner@example.com')).toBe(false);
  });

  it('does not treat CRM operators as development owners without the owner allowlist', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'crm@asi-global.ru');
    vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', 'owner@example.com');
    expect(isDevelopmentOwnerEmail('crm@asi-global.ru')).toBe(false);
    expect(isDevelopmentOwnerEmail('operator@asi-global.ru')).toBe(false);
  });

  it('never falls back to *@asi-global.ru', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', '');
    expect(isDevelopmentOwnerEmail('security@asi-global.ru')).toBe(false);
  });
});
