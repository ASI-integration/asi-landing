import { describe, expect, it } from 'vitest';
import {
  buildProviderQueryWithDefaultCity,
  hasExplicitRuCity,
  normalizeRuAddressQuery,
} from '../ru-normalize';

describe('ru-normalize: corpus / building normalization', () => {
  it('collapses "7, к1" into "7к1"', () => {
    const { normalized } = normalizeRuAddressQuery('ушинского 7, к1');
    expect(normalized).toContain('7к1');
    expect(normalized).not.toMatch(/7,\s*к1/u);
  });

  it('collapses "7 к1" into "7к1"', () => {
    const { normalized } = normalizeRuAddressQuery('ушинского 7 к1');
    expect(normalized).toContain('7к1');
  });

  it('leaves "7к1" unchanged', () => {
    const { normalized } = normalizeRuAddressQuery('ушинского 7к1');
    expect(normalized).toContain('7к1');
  });

  it('collapses "дом 7 корпус 1" into "дом 7к1"', () => {
    const { normalized } = normalizeRuAddressQuery('ушинского дом 7 корпус 1');
    expect(normalized).toContain('7к1');
    expect(normalized).not.toMatch(/корпус/u);
  });

  it('collapses "7, корп. 1" into "7к1"', () => {
    const { normalized } = normalizeRuAddressQuery('ушинского 7, корп. 1');
    expect(normalized).toContain('7к1');
    expect(normalized).not.toMatch(/корп/u);
  });

  it('collapses "7 корп 1" into "7к1"', () => {
    const { normalized } = normalizeRuAddressQuery('ушинского 7 корп 1');
    expect(normalized).toContain('7к1');
  });
});

describe('ru-normalize: hasExplicitRuCity', () => {
  it('returns false when no city is named', () => {
    expect(hasExplicitRuCity('ушинского 7к1')).toBe(false);
  });

  it('returns true for Санкт-Петербург variants', () => {
    expect(hasExplicitRuCity('Санкт-Петербург, ушинского 7')).toBe(true);
    expect(hasExplicitRuCity('Питер, ушинского 7')).toBe(true);
    expect(hasExplicitRuCity('СПб, ушинского 7')).toBe(true);
  });

  it('returns true for Москва', () => {
    expect(hasExplicitRuCity('Москва, ушинского 7')).toBe(true);
  });

  it('returns true for other major cities', () => {
    expect(hasExplicitRuCity('Пермь, ушинского 7')).toBe(true);
    expect(hasExplicitRuCity('Казань, ушинского 7')).toBe(true);
  });
});

describe('ru-normalize: buildProviderQueryWithDefaultCity', () => {
  it('appends Санкт-Петербург when query has street/house but no city', () => {
    const out = buildProviderQueryWithDefaultCity('улица Ушинского, 7к1');
    expect(out).toMatch(/Санкт-Петербург, Россия$/u);
  });

  it('does NOT append when query already names Москва', () => {
    const out = buildProviderQueryWithDefaultCity('Москва, улица Ушинского, 7к1');
    expect(out).not.toMatch(/Санкт-Петербург/u);
  });

  it('does NOT append when query already names Санкт-Петербург', () => {
    const out = buildProviderQueryWithDefaultCity('Санкт-Петербург, улица Ушинского, 7к1');
    expect(out.match(/Санкт-Петербург/gu)?.length ?? 0).toBe(1);
  });

  it('does NOT append for a bare locality name (no street/house)', () => {
    const out = buildProviderQueryWithDefaultCity('Невская Дубровка');
    expect(out).not.toMatch(/Санкт-Петербург/u);
  });
});
