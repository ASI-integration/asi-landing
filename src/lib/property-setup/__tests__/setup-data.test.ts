import { describe, expect, it } from 'vitest';
import {
  buildSetupMirrorUpdates,
  createEmptySetupData,
  isSetupChannelsSelected,
  isSetupPricingComplete,
  normalizeSetupData,
  setupDataFromExisting,
} from '../setup-data';

describe('normalizeSetupData', () => {
  it('returns safe defaults for empty/garbage input', () => {
    const fromNull = normalizeSetupData(null);
    const fromGarbage = normalizeSetupData({ basic: 'oops', units: 'nope', channels: 42 });

    expect(fromNull.basic.title).toBe('');
    expect(fromNull.units).toEqual([]);
    expect(fromNull.channels.length).toBeGreaterThan(0);
    expect(fromGarbage.basic.title).toBe('');
    expect(fromGarbage.units).toEqual([]);
    // channels always normalize to the full catalog with not_connected defaults
    expect(fromGarbage.channels.every((channel) => channel.status === 'not_connected')).toBe(true);
  });

  it('coerces nested values to strings (no [object Object])', () => {
    const result = normalizeSetupData({
      basic: { title: { ru: 'x' }, city: 5 },
      pricing: { basePricePerNight: 5000 },
    });
    expect(result.basic.title).toBe('');
    expect(result.basic.city).toBe('5');
    expect(result.pricing.basePricePerNight).toBe('5000');
  });

  it('keeps only known channel codes and valid statuses', () => {
    const result = normalizeSetupData({
      channels: [
        { code: 'yandex_travel', status: 'preparing' },
        { code: 'unknown_channel', status: 'preparing' },
        { code: 'ostrovok', status: 'invalid_status' },
      ],
    });
    expect(result.channels.find((c) => c.code === 'yandex_travel')?.status).toBe('preparing');
    expect(result.channels.find((c) => c.code === 'ostrovok')?.status).toBe('not_connected');
    expect(result.channels.some((c) => c.code === 'unknown_channel')).toBe(false);
  });
});

describe('completion helpers', () => {
  it('detects pricing and channel selection', () => {
    const data = createEmptySetupData();
    expect(isSetupPricingComplete(data)).toBe(false);
    expect(isSetupChannelsSelected(data)).toBe(false);

    data.pricing.basePricePerNight = '4500';
    data.channels[0] = { ...data.channels[0], status: 'needs_credentials' };
    expect(isSetupPricingComplete(data)).toBe(true);
    expect(isSetupChannelsSelected(data)).toBe(true);
  });
});

describe('buildSetupMirrorUpdates', () => {
  it('does not overwrite existing fields with empty values', () => {
    const updates = buildSetupMirrorUpdates(createEmptySetupData());
    expect(updates.property.title).toBeUndefined();
    expect(updates.property.city).toBeUndefined();
    expect(updates.masterCard.fullDescription).toBeUndefined();
    expect(updates.masterCard.houseRules).toBeUndefined();
  });

  it('composes house rules from structured fields', () => {
    const data = createEmptySetupData();
    data.rules.smoking = 'Запрещено';
    data.rules.pets = 'По согласованию';
    const updates = buildSetupMirrorUpdates(data);
    expect(updates.masterCard.houseRules).toContain('Курение: Запрещено');
    expect(updates.masterCard.houseRules).toContain('Животные: По согласованию');
  });
});

describe('setupDataFromExisting', () => {
  it('prefills from property and master card', () => {
    const data = setupDataFromExisting(
      { title: 'Апартаменты', city: 'Москва', address: 'ул. Тверская, 1' },
      { shortDescription: 'Кратко', fullDescription: 'Полное', wifiName: 'Net', wifiPassword: '123' },
    );
    expect(data.basic.title).toBe('Апартаменты');
    expect(data.address.line).toBe('ул. Тверская, 1');
    expect(data.description.full).toBe('Полное');
    expect(data.wifi.wifiName).toBe('Net');
  });
});
