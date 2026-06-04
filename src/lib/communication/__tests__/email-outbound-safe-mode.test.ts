import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  getEmailOutboundMode,
  isEmailAutoSendEnabled,
  isEmailDraftOnly,
  shouldSuppressEmailOutbound,
} from '../email-outbound-safe-mode';

describe('email-outbound-safe-mode', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to draft-only without guest auto-send', () => {
    expect(isEmailAutoSendEnabled()).toBe(false);
    expect(isEmailDraftOnly()).toBe(true);
    expect(shouldSuppressEmailOutbound()).toBe(true);
    expect(getEmailOutboundMode()).toBe('draft_only');
  });

  it('allows auto-send only when explicitly enabled and draft-only disabled', () => {
    vi.stubEnv('EMAIL_AUTO_SEND', 'true');
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'false');
    expect(isEmailAutoSendEnabled()).toBe(true);
    expect(isEmailDraftOnly()).toBe(false);
    expect(shouldSuppressEmailOutbound()).toBe(false);
    expect(getEmailOutboundMode()).toBe('auto_send');
  });

  it('keeps outbound suppressed when auto-send is off even if draft-only is false', () => {
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'false');
    expect(shouldSuppressEmailOutbound()).toBe(true);
    expect(getEmailOutboundMode()).toBe('disabled');
  });
});
