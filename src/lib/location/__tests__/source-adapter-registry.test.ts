import { describe, expect, it } from 'vitest';
import {
  LOCATION_SOURCE_ADAPTER_REGISTRY,
  SELECTIVE_LOCATION_SOURCE_PARSING_POLICY_RU,
  listLocationSourceAdaptersByLayer,
  sourceRegistryHasOnlyCanonicalUiAdapters,
} from '../data-sources/source-adapter-registry';

describe('location source adapter registry', () => {
  it('declares the canonical adapter contract for planned source groups', () => {
    const ids = LOCATION_SOURCE_ADAPTER_REGISTRY.map(source => source.id);

    expect(ids).toEqual(expect.arrayContaining([
      'osm-overpass-base-geo',
      'gar-fias-address-normalization',
      'rosstat-emiss-market-context',
      'official-civil-aviation-registry',
      'official-sea-river-port-registries',
      'osm-transport-geometry',
      'official-rail-bus-hubs',
      'eiszhs-domrf-developments',
      'eis-zakupki-development-signals',
      'regional-urban-planning-portals',
      'yandex-2gis-premium-official-api',
    ]));

    for (const source of LOCATION_SOURCE_ADAPTER_REGISTRY) {
      expect(source.sourceName).toBeTruthy();
      expect(source.allowedUsage).toBeTruthy();
      expect(source.updateFrequency).toBeTruthy();
      expect(source.freshness).toBeTruthy();
      expect(source.dataCoverage).toBeTruthy();
      expect(source.confidence).toMatch(/^(high|medium|low)$/);
      expect(source.entityTypesProvided.length).toBeGreaterThan(0);
      expect(source.geocodingRequirements).toBeTruthy();
      expect(source.cachingPolicy).toContain('Cache');
      expect(source.mapsToCanonicalEntities).toBe(true);
      expect(source.uiMayReadRawSourceData).toBe(false);
    }
  });

  it('keeps premium commercial providers license-safe and out of grey scraping', () => {
    const premium = listLocationSourceAdaptersByLayer('commercial_premium_later');

    expect(premium).toHaveLength(1);
    expect(premium[0].sourceName).toContain('Yandex / 2GIS');
    expect(premium[0].status).toBe('license_required');
    expect(premium[0].allowedUsage.toLowerCase()).toContain('grey scraping is prohibited');
  });

  it('states selective parsing and canonical report mapping policy', () => {
    const policy = SELECTIVE_LOCATION_SOURCE_PARSING_POLICY_RU.join(' ');

    expect(policy).toContain('Не парсим всё подряд');
    expect(policy).toContain('кэшируемым');
    expect(policy).toContain('канонические сущности');
    expect(policy).toContain('UI читает канонические данные отчёта');
    expect(sourceRegistryHasOnlyCanonicalUiAdapters()).toBe(true);
  });
});
