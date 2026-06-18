import { describe, expect, it } from 'vitest';
import { computePropertyReadiness } from '../property-lifecycle';
import type { OpsProperty, PropertyMasterCard } from '@/lib/ops-foundation/types';
import { createEmptySetupData, type PropertySetupData } from '@/lib/property-setup/setup-data';
import type { ChannelManagerChannel } from '../types';

function completeSetup(): PropertySetupData {
  const setup = createEmptySetupData();
  setup.basic.title = 'Тестовый объект';
  setup.basic.city = 'Москва';
  setup.basic.shortSummary = 'Кратко';
  setup.address.line = 'ул. Примерная, 1';
  setup.units = [{ name: 'Студия', count: '1', capacity: '2', bedType: 'Двуспальная', amenities: 'Wi-Fi' }];
  setup.description.full = 'Полное описание';
  setup.rules.smoking = 'Запрещено';
  setup.checkInOut.checkInTime = '14:00';
  setup.checkInOut.checkOutTime = '12:00';
  setup.wifi.wifiName = 'GuestWiFi';
  setup.pricing.basePricePerNight = '5000';
  setup.channels = setup.channels.map((channel, index) =>
    index === 0 ? { ...channel, status: 'preparing' } : channel,
  );
  return setup;
}

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
      setupProfile: completeSetup(),
    });

    expect(result.status).toBe('shadow_mode');
  });

  it('marks pricing and channels done from setup profile, not real channels', () => {
    const result = computePropertyReadiness({
      property: property(),
      masterCard: null,
      mediaCount: 1,
      channels: [],
      conflictCount: 0,
      discrepancyCount: 0,
      setupProfile: completeSetup(),
    });

    const pricing = result.steps.find((step) => step.id === 'pricing');
    const channels = result.steps.find((step) => step.id === 'channels');
    expect(pricing?.done).toBe(true);
    expect(channels?.done).toBe(true);
    expect(pricing?.actionHref).toBe('/dashboard/properties/prop-1/setup?step=pricing');
  });

  it('links every preparation step to an existing setup section', () => {
    const result = computePropertyReadiness({
      property: property(),
      masterCard: null,
      mediaCount: 0,
      channels: [],
      conflictCount: 0,
      discrepancyCount: 0,
      setupProfile: completeSetup(),
    });

    expect(result.steps.map((step) => step.actionHref)).toEqual([
      '/dashboard/properties/prop-1/setup?step=basic',
      '/dashboard/properties/prop-1/setup?step=address',
      '/dashboard/properties/prop-1/setup?step=units',
      '/dashboard/properties/prop-1/setup?step=photos',
      '/dashboard/properties/prop-1/setup?step=description',
      '/dashboard/properties/prop-1/setup?step=rules',
      '/dashboard/properties/prop-1/setup?step=checkin',
      '/dashboard/properties/prop-1/setup?step=wifi',
      '/dashboard/properties/prop-1/setup?step=pricing',
      '/dashboard/properties/prop-1/setup?step=channels',
      '/dashboard/properties/prop-1/setup?step=readiness',
    ]);
  });

  it('keeps pricing and channels incomplete without setup selections', () => {
    const result = computePropertyReadiness({
      property: property(),
      masterCard: null,
      mediaCount: 1,
      channels: [channel({ syncMode: 'active', status: 'active', isAutoSellEnabled: true })],
      conflictCount: 0,
      discrepancyCount: 0,
    });

    expect(result.steps.find((step) => step.id === 'pricing')?.done).toBe(false);
    expect(result.steps.find((step) => step.id === 'channels')?.done).toBe(false);
  });
});
