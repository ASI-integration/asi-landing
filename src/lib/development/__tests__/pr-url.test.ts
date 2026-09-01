import { describe, expect, it } from 'vitest';
import { safeAllowlistedPullRequestUrl } from '../pr-url';

describe('safeAllowlistedPullRequestUrl', () => {
  it('accepts a valid allowlisted GitHub PR URL', () => {
    expect(safeAllowlistedPullRequestUrl('https://github.com/ASI-integration/asi-landing/pull/116')).toBe(
      'https://github.com/ASI-integration/asi-landing/pull/116',
    );
    expect(safeAllowlistedPullRequestUrl('https://github.com/ASI-integration/asi-os-runtime/pull/42')).toBe(
      'https://github.com/ASI-integration/asi-os-runtime/pull/42',
    );
  });

  it('rejects an invalid URL', () => {
    expect(safeAllowlistedPullRequestUrl('not-a-url')).toBeNull();
    expect(safeAllowlistedPullRequestUrl('')).toBeNull();
  });

  it('rejects another host', () => {
    expect(
      safeAllowlistedPullRequestUrl('https://evil.example/ASI-integration/asi-landing/pull/1'),
    ).toBeNull();
  });

  it('rejects another repository', () => {
    expect(safeAllowlistedPullRequestUrl('https://github.com/ASI-integration/other-repo/pull/1')).toBeNull();
    expect(safeAllowlistedPullRequestUrl('https://github.com/other/asi-landing/pull/1')).toBeNull();
  });
});
