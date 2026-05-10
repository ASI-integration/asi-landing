import { describe, expect, it } from 'vitest';
import {
  CIS_ADDRESS_SEARCH_PROFILE_PLACEHOLDERS,
  pointInBBox,
} from '@/lib/location/address-providers/address-search-profile';
import {
  buildRuMetroGeocodeVariants,
  buildRuMetroSuggestQueryVariants,
  resolveRuAddressSearchProfiles,
  shouldExpandRuMetroSuggest,
} from '@/lib/location/address-providers/ru-address-search-profile';
import {
  normalizeRuAddressQuery,
  rerankRuSuggestionsByLocality,
} from '@/lib/location/address-providers/ru-normalize';

describe('CIS profile placeholders (extension hooks)', () => {
  it('exposes empty-query CIS stubs without breaking RU imports', () => {
    expect(CIS_ADDRESS_SEARCH_PROFILE_PLACEHOLDERS.KZ.country).toBe('KZ');
    expect(CIS_ADDRESS_SEARCH_PROFILE_PLACEHOLDERS.GE.queryExpansionTemplates?.length).toBe(0);
    expect(pointInBBox(43.2, 76.9, { minLat: 43.1, maxLat: 43.3, minLon: 76.8, maxLon: 77.0 })).toBe(true);
  });
});

describe('RU corpus: corpus / строение / литера / пр-т / flat stripping', () => {
  it('unifies 37к1 and spaced corpus variants', () => {
    const a = normalizeRuAddressQuery('Оборонная 37к1').normalized;
    const b = normalizeRuAddressQuery('Оборонная 37 к 1').normalized;
    expect(a).toBe(b);
    expect(a).toContain('37к1');
  });

  it('normalizes строение', () => {
    const n = normalizeRuAddressQuery('Лесная 10 стр 2').normalized;
    expect(n).toContain('10с2');
  });

  it('normalizes литера', () => {
    const n = normalizeRuAddressQuery('Лесная 10 лит б').normalized;
    expect(n).toContain('10лб');
  });

  it('expands пр-т', () => {
    const n = normalizeRuAddressQuery('Комсомольский пр-т 15').normalized;
    expect(n.toLowerCase()).toContain('проспект');
  });

  it('drops flat number from providerQuery only', () => {
    const r = normalizeRuAddressQuery('Нагатинская улица 10к2 кв 15');
    expect(r.normalized.toLowerCase()).toContain('кв');
    expect(r.providerQuery.toLowerCase()).not.toContain('кв');
  });
});

describe('RU metro profile suggest expansions', () => {
  it('SPb/LO profile: short street + Murino / LO in variants', () => {
    const raw = 'оборонная, 37, к1';
    const { normalized, providerQuery } = normalizeRuAddressQuery(raw);
    expect(shouldExpandRuMetroSuggest(normalized)).toBe(true);
    const res = resolveRuAddressSearchProfiles({ normalizedQuery: normalized });
    const variants = buildRuMetroSuggestQueryVariants(providerQuery, normalized, res.profiles);
    const flat = variants.join(' ').toLowerCase();
    expect(flat).toContain('мурино');
    expect(flat).toContain('ленинградская');
    expect(flat).toContain('санкт-петербург');
  });

  it('does not expand when a major city is already explicit', () => {
    const { normalized, providerQuery } = normalizeRuAddressQuery('Краснодар, Оборонная 10');
    expect(shouldExpandRuMetroSuggest(normalized)).toBe(false);
    expect(buildRuMetroSuggestQueryVariants(providerQuery, normalized, [])).toEqual([]);
  });

  it('does not treat казанская as Казань', () => {
    const { normalized } = normalizeRuAddressQuery('улица Казанская 5');
    const hit = resolveRuAddressSearchProfiles({ normalizedQuery: normalized });
    expect(hit.profiles.length).toBeGreaterThan(3);
    expect(hit.contextLocked).toBe(false);
  });
});

describe('Geocode variants via profiles', () => {
  it('adds regional prefixes with Россия', () => {
    const raw = 'Оборонная 37к1';
    const res = resolveRuAddressSearchProfiles({
      normalizedQuery: normalizeRuAddressQuery(raw).normalized,
    });
    const v = buildRuMetroGeocodeVariants(raw, res);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some(x => x.toLowerCase().includes('мурино'))).toBe(true);
    expect(v.every(x => x.toLowerCase().includes('россия'))).toBe(true);
  });
});

describe('Reranking with resolved profiles', () => {
  it('Murino wins over Krasnodar under SPb session (profile negativeRegions)', () => {
    const normalized = normalizeRuAddressQuery('Оборонная 37к1').normalized;
    const res = resolveRuAddressSearchProfiles({
      normalizedQuery: normalized,
      contextCity: 'Санкт-Петербург',
    });
    const rows = [
      { value: 'ул. Оборонная, 37к1, Краснодар, Россия' },
      { value: 'Ленинградская область, Мурино, Оборонная ул., 37к1' },
    ];
    const ranked = rerankRuSuggestionsByLocality(normalized, rows, {
      contextCity: 'Санкт-Петербург',
      addressSearchProfiles: res.profiles,
      addressSearchContextLocked: res.contextLocked,
      addressSearchExpansionActive: true,
    });
    expect(ranked[0]?.value).toContain('Мурино');
  });

  it('Moscow Oblast context prefers regional row over Novosibirsk homonym', () => {
    const normalized = normalizeRuAddressQuery('Центральная 10').normalized;
    const res = resolveRuAddressSearchProfiles({
      normalizedQuery: normalized,
      contextCity: 'Москва',
    });
    const rows = [
      { value: 'Новосибирск, ул. Центральная, 10' },
      { value: 'Московская область, Люберцы, ул. Центральная, 10' },
    ];
    const ranked = rerankRuSuggestionsByLocality(normalized, rows, {
      contextCity: 'Москва',
      addressSearchProfiles: res.profiles,
      addressSearchContextLocked: res.contextLocked,
      addressSearchExpansionActive: true,
    });
    expect(ranked[0]?.value.toLowerCase()).toContain('люберцы');
  });

  it('SPb bbox demotes Stary Oskol vs Murino', () => {
    const normalized = normalizeRuAddressQuery('Оборонная 5').normalized;
    const res = resolveRuAddressSearchProfiles({
      normalizedQuery: normalized,
      biasLat: 59.93,
      biasLon: 30.33,
    });
    const rows = [
      { value: 'ул. Оборонная, 5, Старый Оскол, Россия' },
      { value: 'Ленинградская область, Мурино, Оборонная ул., 5' },
    ];
    const ranked = rerankRuSuggestionsByLocality(normalized, rows, {
      biasLat: 59.93,
      biasLon: 30.33,
      addressSearchProfiles: res.profiles,
      addressSearchContextLocked: res.contextLocked,
      addressSearchExpansionActive: true,
    });
    expect(ranked[0]?.value.toLowerCase()).toContain('мурино');
  });
});
