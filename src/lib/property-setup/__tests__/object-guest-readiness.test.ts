import { describe, expect, it } from 'vitest';
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';
import { createEmptySetupData } from '../setup-data';
import {
  buildGuestTestDeepLink,
  computeObjectGuestReadiness,
  formatGuestReadinessBlockersRu,
} from '../object-guest-readiness';

const property: OpsProperty = {
  id: 'prop-1',
  accountId: 'acct-1',
  title: 'Тестовый объект',
  address: null,
  city: null,
  timezone: 'Europe/Moscow',
  status: 'draft',
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
};

const masterCard: PropertyMasterCard = {
  id: 'card-1',
  propertyId: 'prop-1',
  publicTitle: null,
  shortDescription: null,
  fullDescription: null,
  amenities: [],
  houseRules: null,
  checkInInstructions: null,
  checkOutInstructions: null,
  wifiName: null,
  wifiPassword: null,
  parkingInfo: null,
  depositInfo: null,
  extraFeesInfo: null,
  cancellationInfo: null,
  guestContactsInfo: null,
  internalNotes: null,
  contentVersion: 1,
  publicationStatus: 'draft',
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
};

const photo: PropertyMedia = {
  id: 'photo-1',
  propertyId: 'prop-1',
  url: 'https://example.com/photo.jpg',
  storagePath: null,
  title: null,
  description: null,
  sortOrder: 0,
  isCover: true,
  status: 'active',
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
};

describe('object guest readiness', () => {
  it('marks empty object as not ready with concrete next step', () => {
    const readiness = computeObjectGuestReadiness({
      propertyId: 'prop-1',
      property,
      masterCard,
      setup: createEmptySetupData(),
      media: [],
    });

    expect(readiness.isReady).toBe(false);
    expect(readiness.nextItem?.id).toBe('city');
    expect(readiness.completedCount).toBe(0);
    expect(readiness.statusMessage).toContain('город');
  });

  it('becomes ready when guest test fields are filled', () => {
    const setup = createEmptySetupData();
    setup.basic.city = 'Казань';
    setup.address.line = 'ул. Баумана, 1';
    setup.checkInOut.checkInInstructions = 'Код от домофона 1234.';
    setup.wifi.wifiName = 'ASI_Guest';
    setup.rules.smoking = 'Запрещено';
    setup.description.full = 'Уютная квартира в центре.';

    const readiness = computeObjectGuestReadiness({
      propertyId: 'prop-1',
      property: { ...property, city: 'Казань', address: 'ул. Баумана, 1' },
      masterCard,
      setup,
      media: [photo],
    });

    expect(readiness.isReady).toBe(true);
    expect(readiness.nextItem).toBeNull();
    expect(readiness.completedCount).toBe(7);
  });

  it('builds telegram deep link for guest test', () => {
    expect(buildGuestTestDeepLink('prop-1')).toContain('guest_test_prop-1');
    expect(buildGuestTestDeepLink('prop-1')).toMatch(/^https:\/\/t\.me\//);
  });

  it('formats missing blockers in Russian', () => {
    const readiness = computeObjectGuestReadiness({
      propertyId: 'prop-1',
      property,
      masterCard,
      setup: createEmptySetupData(),
      media: [],
    });

    const text = formatGuestReadinessBlockersRu(readiness);
    expect(text).toContain('не хватает');
    expect(text).toContain('город');
    expect(text).toContain('/dashboard/properties/prop-1/setup');
  });
});
