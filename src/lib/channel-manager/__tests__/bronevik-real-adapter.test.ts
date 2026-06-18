import { describe, expect, it } from 'vitest';
import {
  BronevikMtsTravelRealAdapter,
  buildBronevikMtsTravelDryRunPreview,
  getBronevikMtsTravelCredentialStatus,
  loadBronevikMtsTravelCredentials,
} from '../bronevik-mts-real-adapter';
import { assertChannelGuardrails } from '../repository';
import type { ChannelListing, ChannelManagerChannel, InventoryDay } from '../types';

function bronevikChannel(overrides: Partial<ChannelManagerChannel> = {}): ChannelManagerChannel {
  return {
    id: 'channel-bronevik',
    accountId: 'account-1',
    code: 'bronevik_mts_travel',
    name: 'Броневик / МТС Travel',
    adapterKind: 'api',
    status: 'sandbox',
    integrationType: 'partner_channel_manager_api',
    syncMode: 'shadow',
    isEnabled: true,
    isAutoSellEnabled: false,
    isOverbookingProtectionEnabled: false,
    reliabilityLevel: 78,
    commissionPercent: 14,
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

function listing(overrides: Partial<ChannelListing> = {}): ChannelListing {
  return {
    id: 'listing-1',
    accountId: 'account-1',
    channelId: 'channel-bronevik',
    propertyId: 'property-1',
    unitKey: 'default',
    externalListingId: 'room-category-1',
    title: 'Стандарт',
    status: 'active',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

function inventoryDay(overrides: Partial<InventoryDay> = {}): InventoryDay {
  return {
    id: 'inventory-1',
    accountId: 'account-1',
    propertyId: 'property-1',
    unitKey: 'default',
    day: '2026-07-10',
    totalUnits: 3,
    bookedUnits: 1,
    manualBlockedUnits: 0,
    availableUnits: 2,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('Bronevik / MTS Travel real adapter contour', () => {
  it('returns a clear missing-credentials status without throwing', async () => {
    const adapter = new BronevikMtsTravelRealAdapter();
    const result = await adapter.validateCredentials({ values: {} });

    expect(result.ok).toBe(false);
    expect(result.externalCalls).toBe(0);
    expect(result.message).toContain('Не хватает доступов');
  });

  it('masks secrets and does not expose token values', () => {
    const credentials = loadBronevikMtsTravelCredentials({
      BRONEVIK_MTS_TRAVEL_API_BASE_URL: 'https://sandbox.example.test',
      BRONEVIK_MTS_TRAVEL_CLIENT_ID: 'client-123',
      BRONEVIK_MTS_TRAVEL_CLIENT_SECRET: 'secret-value',
      BRONEVIK_MTS_TRAVEL_PARTNER_ID: 'partner-1',
      BRONEVIK_MTS_TRAVEL_SANDBOX_HOTEL_ID: 'hotel-1',
      BRONEVIK_MTS_TRAVEL_SIGNATURE_KEY: 'signature-value',
    });

    const status = getBronevikMtsTravelCredentialStatus(credentials);

    expect(status.ok).toBe(true);
    expect(JSON.stringify(status.maskedValues)).not.toContain('secret-value');
    expect(JSON.stringify(status.maskedValues)).not.toContain('signature-value');
    expect(status.maskedValues.BRONEVIK_MTS_TRAVEL_CLIENT_SECRET).toBe('задано: ***');
  });

  it('builds an availability payload and keeps it in dry-run', () => {
    const preview = buildBronevikMtsTravelDryRunPreview({
      channel: bronevikChannel(),
      listing: listing(),
      propertyId: 'property-1',
      unitKey: 'default',
      inventoryDays: [inventoryDay()],
      env: {
        BRONEVIK_MTS_TRAVEL_API_BASE_URL: 'https://sandbox.example.test',
        BRONEVIK_MTS_TRAVEL_CLIENT_ID: 'client-123',
        BRONEVIK_MTS_TRAVEL_CLIENT_SECRET: 'secret-value',
        BRONEVIK_MTS_TRAVEL_PARTNER_ID: 'partner-1',
        BRONEVIK_MTS_TRAVEL_SANDBOX_HOTEL_ID: 'hotel-1',
      },
    });

    expect(preview.externalCalls).toBe(0);
    expect(preview.realOtaChanged).toBe(false);
    expect(preview.payload.availability).toEqual([
      {
        hotelId: 'hotel-1',
        roomCategoryId: 'room-category-1',
        ratePlanId: null,
        date: '2026-07-10',
        available: 2,
        stopSale: false,
      },
    ]);
  });

  it('marks missing mappings instead of failing the payload build', () => {
    const preview = buildBronevikMtsTravelDryRunPreview({
      channel: bronevikChannel(),
      listing: listing({ externalListingId: 'property-1:default:bronevik_mts_travel' }),
      propertyId: 'property-1',
      unitKey: 'default',
      inventoryDays: [inventoryDay()],
      env: {},
    });

    expect(preview.payload.availability).toHaveLength(1);
    expect(preview.missingMappings.map((item) => item.field)).toEqual(
      expect.arrayContaining([
        'credentials',
        'property.external_hotel_id',
        'unit.external_room_category_id',
        'rate_plan.external_rate_plan_id',
      ]),
    );
  });

  it('blocks active mode for the first real OTA adapter', () => {
    expect(() => assertChannelGuardrails(bronevikChannel(), { syncMode: 'active' })).toThrow(
      'real_ota_adapter_active_mode_disabled',
    );
  });

  it('does not allow iCal-like non-API channels to become active', () => {
    expect(() =>
      assertChannelGuardrails(
        bronevikChannel({
          code: 'ical',
          name: 'iCal',
          adapterKind: 'manual',
          status: 'disabled',
          integrationType: 'ical',
          syncMode: 'disabled',
          supportsAvailabilityPush: false,
        }),
        { syncMode: 'active' },
      ),
    ).toThrow('non_api_channels_cannot_use_active_auto_sell');
  });

  it('keeps outbound operations blocked with zero external calls', async () => {
    const adapter = new BronevikMtsTravelRealAdapter();
    const result = await adapter.pushAvailability({
      channel: bronevikChannel(),
      propertyId: 'property-1',
      unitKey: 'default',
      days: [inventoryDay()],
    });

    expect(result.ok).toBe(true);
    expect(result.externalCalls).toBe(0);
    expect(result.details).toMatchObject({
      outbound: 'shadow_mode_external_send_blocked',
      realOtaChanged: false,
    });
  });
});
