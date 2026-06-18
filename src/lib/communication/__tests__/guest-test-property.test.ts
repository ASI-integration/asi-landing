import { describe, expect, it } from 'vitest';
import { mapSetupSourcesToGuestTestProperty } from '../guest-test-property';
import { normalizeSetupData } from '@/lib/property-setup/setup-data';
import type { OpsProperty, PropertyMasterCard } from '@/lib/ops-foundation/types';

const PROPERTY_ID = '202aa8b7-0c8e-4a42-a47d-a440fe68e5b2';

const property: OpsProperty = {
  id: PROPERTY_ID,
  accountId: 'acct-1',
  title: 'Апартаменты на Тверской',
  address: 'ул. Тверская, 1',
  city: 'Москва',
  timezone: 'Europe/Moscow',
  status: 'draft',
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-18T00:00:00.000Z',
};

const masterCard: PropertyMasterCard = {
  id: 'card-1',
  propertyId: PROPERTY_ID,
  publicTitle: null,
  shortDescription: 'test',
  fullDescription: 'test',
  amenities: [],
  houseRules: 'Курение: test\nЖивотные: test',
  checkInInstructions: 'Заезд с 14. test',
  checkOutInstructions: 'test',
  wifiName: 'WiFi Guru',
  wifiPassword: 'secret-pass',
  parkingInfo: null,
  depositInfo: null,
  extraFeesInfo: null,
  cancellationInfo: null,
  guestContactsInfo: null,
  internalNotes: null,
  contentVersion: 1,
  publicationStatus: 'draft',
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-18T00:00:00.000Z',
};

const setup = normalizeSetupData({
  basic: { title: 'Апартаменты на Тверской', city: 'Москва', propertyType: '', shortSummary: '' },
  address: { line: 'ул. Тверская, 1', district: '', accessNote: '' },
  wifi: { wifiName: 'WiFi Guru', wifiPassword: 'secret-pass', entryInstructions: '', keysInfo: '', householdInstructions: '' },
  rules: { smoking: 'test', pets: 'test', parties: 'test', children: 'test', deposit: '3000', documents: 'test', quietHours: '' },
  checkInOut: {
    checkInTime: '14',
    checkOutTime: '11',
    checkInInstructions: 'test',
    checkOutInstructions: 'test',
  },
  description: { full: 'test', shortForOta: 'test', advantages: 'test' },
});

describe('guest test property mapping from setup sources', () => {
  it('maps address, wifi and rules from setup/profile tables', () => {
    const mapped = mapSetupSourcesToGuestTestProperty({
      propertyId: PROPERTY_ID,
      property,
      masterCard,
      setup,
    });

    expect(mapped.address).toBe('Москва, ул. Тверская, 1');
    expect(mapped.wifi_name).toBe('WiFi Guru');
    expect(mapped.wifi_password).toBe('secret-pass');
    expect(mapped.house_rules_text).toContain('Курение: test');
    expect(mapped.check_in_text).toContain('test');
  });
});
