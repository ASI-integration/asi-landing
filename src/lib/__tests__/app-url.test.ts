import { afterEach, describe, expect, it } from 'vitest';
import {
  containsBogusDashboardOrigin,
  normalizeAppPath,
  resolvePublicAppOrigin,
  resolveRedirectOrigin,
  toAppAbsoluteUrl,
  toAppPath,
} from '@/lib/app-url';

describe('app-url', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_URL;
  });

  it('keeps root-relative paths for in-app navigation', () => {
    expect(toAppPath('/dashboard/properties/prop-1/setup?step=readiness')).toBe(
      '/dashboard/properties/prop-1/setup?step=readiness',
    );
  });

  it('strips bogus absolute dashboard host to root-relative path', () => {
    expect(normalizeAppPath('http://dashboard/dashboard/properties/prop-1/setup')).toBe(
      '/dashboard/properties/prop-1/setup',
    );
  });

  it('never emits http://dashboard absolute URLs', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://dashboard';
    expect(toAppAbsoluteUrl('/dashboard/properties/prop-1/setup?step=readiness')).toBe(
      'https://asi-global.ru/dashboard/properties/prop-1/setup?step=readiness',
    );
    expect(containsBogusDashboardOrigin(toAppAbsoluteUrl('/dashboard/properties/prop-1'))).toBe(false);
  });

  it('uses configured public origin when hostname is valid', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://asi-global.ru';
    expect(resolvePublicAppOrigin()).toBe('https://asi-global.ru');
    expect(toAppAbsoluteUrl('/dashboard')).toBe('https://asi-global.ru/dashboard');
  });

  it('falls back to canonical RU origin for internal service host redirects', () => {
    expect(
      resolveRedirectOrigin({
        forwardedHost: 'dashboard',
        forwardedProto: 'http',
      }),
    ).toBe('https://asi-global.ru');
  });

  it('keeps real forwarded host for production redirects', () => {
    expect(
      resolveRedirectOrigin({
        forwardedHost: 'asi-global.ru',
        forwardedProto: 'https',
      }),
    ).toBe('https://asi-global.ru');
  });
});
