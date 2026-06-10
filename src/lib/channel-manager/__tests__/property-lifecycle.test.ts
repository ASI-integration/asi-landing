import { describe, expect, it } from 'vitest';
import { computePropertyReadiness } from '../property-lifecycle';
import type { OpsProperty, PropertyMasterCard } from '@/lib/ops-foundation/types';
import type { ChannelManagerChannel } from '../types';

function property(overrides: Partial<OpsProperty> = {}): OpsProperty {
  return {
    id: 'prop-1',
    accountId: 'acc-1',
    title: 'Тестовый объект',
    address: 'ул. Примерная, 1',
    city: 'Москва',
    timezone: 'Europe/Moscow',
    status: 'draft',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function channel(overrides: Partial<ChannelManagerChannel> = {}): ChannelManagerChannel {
  return {
    id: 'ch-1',
    accountId: 'acc-1',
    code: 'yandex_travel',
    name: 'Яндекс Путешествия',
    adapterKind: 'mock',
    status: 'mocked',
    integrationType: 'api',
    syncMode: 'disabled',
    isEnabled: true,
    isAutoSellEnabled: false,
    isOverbookingProtectionEnabled: true,
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
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computePropertyReadiness', () => {
  it('returns draft when property is missing', () => {
    const result = computePropertyReadiness({
      property: null,
      masterCard: null,
      mediaCount: 0,
      channels: [],
      conflictCount: 0,
      discrepancyCount: 0,
    });

    expect(result.status).toBe('draft');
  });

  it('returns info_required when address is missing', () => {
    const result = computePropertyReadiness({
      property: property({ address: null }),
      masterCard: null,
      mediaCount: 0,
      channels: [],
      conflictCount: 0,
      discrepancyCount: 0,
    });

    expect(result.status).toBe('info_required');
  });

  it('returns photos_required when photos are missing', () => {
    const result = computePropertyReadiness({
      property: property(),
      masterCard: null,
      mediaCount: 0,
      channels: [],
      conflictCount: 0,
      discrepancyCount: 0,
    });

    expect(result.status).toBe('photos_required');
  });

  it('returns attention_required when conflicts exist', () => {
    const result = computePropertyReadiness({
      property: property(),
      masterCard: {
        id: 'mc-1',
        propertyId: 'prop-1',
        publicTitle: 'Тест',
        shortDescription: 'Кратко',
        fullDescription: 'Полное описание',
        amenities: [],
        houseRules: 'Без курения',
        checkInInstructions: 'С 14:00',
        checkOutInstructions: 'До 12:00',
        wifiName: 'GuestWiFi',
        wifiPassword: '123',
        parkingInfo: null,
        depositInfo: null,
        extraFeesInfo: null,
        cancellationInfo: null,
        guestContactsInfo: null,
        internalNotes: null,
        contentVersion: 1,
        publicationStatus: 'draft',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      } satisfies PropertyMasterCard,
      mediaCount: 3,
      channels: [channel({ syncMode: 'shadow', status: 'sandbox' })],
      conflictCount: 1,
      discrepancyCount: 0,
    });

    expect(result.status).toBe('attention_required');
  });

  it('returns shadow_mode when shadow channel is connected', () => {
    const result = computePropertyReadiness({
      property: property(),
      masterCard: {
        id: 'mc-1',
        propertyId: 'prop-1',
        publicTitle: 'Тест',
        shortDescription: 'Кратко',
        fullDescription: 'Полное описание',
        amenities: [],
        houseRules: 'Без курения',
        checkInInstructions: 'С 14:00',
        checkOutInstructions: 'До 12:00',
        wifiName: 'GuestWiFi',
        wifiPassword: '123',
        parkingInfo: null,
        depositInfo: null,
        extraFeesInfo: null,
        cancellationInfo: null,
        guestContactsInfo: null,
        internalNotes: null,
        contentVersion: 1,
        publicationStatus: 'draft',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      mediaCount: 2,
      channels: [channel({ syncMode: 'shadow', status: 'sandbox' })],
      conflictCount: 0,
      discrepancyCount: 0,
    });

    expect(result.status).toBe('shadow_mode');
  });
});
