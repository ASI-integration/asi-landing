import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  allowRealTelegramSyntheticTests,
  DEFAULT_PROTECTED_TELEGRAM_CHAT_IDS,
  getTelegramTestChatId,
  isProtectedOwnerChatId,
  isTelegramOutboundDryRun,
  shouldSuppressTelegramOutbound,
} from '../telegram-outbound-safe-mode';

describe('telegram-outbound-safe-mode', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults protected owner chat id', () => {
    expect(DEFAULT_PROTECTED_TELEGRAM_CHAT_IDS).toContain('931919812');
    expect(isProtectedOwnerChatId(931919812)).toBe(true);
    expect(isProtectedOwnerChatId('920001')).toBe(false);
  });

  it('honors DRY_RUN_TELEGRAM_OUTBOUND for outbound dry run', () => {
    vi.stubEnv('DRY_RUN_TELEGRAM_OUTBOUND', 'true');
    expect(isTelegramOutboundDryRun()).toBe(true);
    expect(shouldSuppressTelegramOutbound('920001', { syntheticInbound: true })).toBe(true);
  });

  it('blocks synthetic inbound to protected chat unless explicitly approved', () => {
    expect(shouldSuppressTelegramOutbound('931919812', { syntheticInbound: true })).toBe(true);
    vi.stubEnv('ALLOW_REAL_TELEGRAM_SYNTHETIC', '1');
    expect(allowRealTelegramSyntheticTests()).toBe(true);
    expect(shouldSuppressTelegramOutbound('931919812', { syntheticInbound: true })).toBe(false);
  });

  it('does not block real webhook traffic to protected chat', () => {
    expect(shouldSuppressTelegramOutbound('931919812', { syntheticInbound: false })).toBe(false);
  });

  it('returns TELEGRAM_TEST_CHAT_ID only when explicitly set', () => {
    expect(getTelegramTestChatId()).toBeNull();
    vi.stubEnv('TELEGRAM_TEST_CHAT_ID', '920001');
    expect(getTelegramTestChatId()).toBe('920001');
  });
});
