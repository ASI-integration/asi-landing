import { describe, expect, it } from 'vitest';
import { safeLoginRedirect } from '../auth-redirect';

describe('safeLoginRedirect', () => {
  it.each([
    '/dashboard',
    '/dashboard/booking-ops?view=calendar#today',
    '/ru/dashboard',
  ])('keeps safe local path %s', (path) => {
    expect(safeLoginRedirect(path)).toBe(path);
  });

  it.each([
    null,
    '',
    'https://evil.example/phishing',
    '//evil.example',
    '/\\\\evil.example',
    '/%5cevil.example',
    '/%2f%2fevil.example',
    '/%255cevil.example',
    '/%252f%252fevil.example',
    '/%0devil.example',
    '/bad%',
  ])('rejects unsafe/ambiguous path %s', (path) => {
    expect(safeLoginRedirect(path)).toBe('/dashboard');
  });
});
