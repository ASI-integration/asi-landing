import { describe, expect, it } from 'vitest';
import { getChannelAdapter, protectedNonApiChannelCapabilities } from '../adapters';
import { assertChannelGuardrails, isApiLikeChannel } from '../repository';
import type { ChannelManagerChannel } from '../types';

function channel(overrides: Partial<ChannelManagerChannel> = {}): ChannelManagerChannel {
  return {
    id: 'channel-1',
    accountId: 'account-1',
    code: 'yandex_travel',
    name: 'Яндекс Путешествия',
    adapterKind: 'mock',
    status: 'mocked',
    integrationType: 'api',
    syncMode: 'disabled',
    isEnabled: true,
    isAutoSellEnabled: false,
    isOverbookingProtectionEnabled: false,
    reliabilityLevel: 80,
    commissionPercent: 15,
    supportsAvailabilityPush: true,
    supportsRatesPush: true,
    supportsRestrictionsPush: true,
    supportsBookingPull: true,
    supportsBookingWebhook: true,
    supportsCancellationWebhook: true,
    supportsModificationWebhook: true,
    lastSyncAt: null,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('channel manager API-first guardrails', () => {
  it('allows an API channel to enter shadow mode', () => {
    const apiChannel = channel();

    expect(assertChannelGuardrails(apiChannel, { syncMode: 'shadow' })).toEqual({ syncMode: 'shadow' });
  });

  it('allows an API channel to enter active mode with auto-sell', () => {
    const apiChannel = channel({ syncMode: 'active' });

    expect(assertChannelGuardrails(apiChannel, { isAutoSellEnabled: true })).toEqual({
      isAutoSellEnabled: true,
    });
  });

  it('blocks active auto-sell for iCal, manual, and email parsing channels', () => {
    for (const capability of protectedNonApiChannelCapabilities) {
      const nonApiChannel = channel({
        code: capability.code,
        name: capability.displayName,
        integrationType: capability.integrationType,
        syncMode: 'disabled',
        supportsAvailabilityPush: false,
      });

      expect(isApiLikeChannel(nonApiChannel)).toBe(false);
      expect(() => assertChannelGuardrails(nonApiChannel, { syncMode: 'active' })).toThrow(
        'non_api_channels_cannot_use_active_auto_sell',
      );
      expect(() => assertChannelGuardrails(nonApiChannel, { isAutoSellEnabled: true })).toThrow(
        'non_api_channels_cannot_use_active_auto_sell',
      );
    }
  });

  it('requires active mode before enabling auto-sell on API channels', () => {
    const apiChannel = channel({ syncMode: 'shadow' });

    expect(() => assertChannelGuardrails(apiChannel, { isAutoSellEnabled: true })).toThrow(
      'auto_sell_requires_active_mode',
    );
  });

  it('requires availability push support for active mode', () => {
    const apiChannel = channel({ supportsAvailabilityPush: false });

    expect(() => assertChannelGuardrails(apiChannel, { syncMode: 'active' })).toThrow(
      'active_mode_requires_availability_push',
    );
  });

  it('uses API-like adapters without external calls for health checks', async () => {
    const adapter = getChannelAdapter('yandex_travel');

    await expect(adapter.healthCheck()).resolves.toMatchObject({
      ok: true,
      externalCalls: 0,
    });
  });
});
