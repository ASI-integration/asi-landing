import { describe, it, expect } from 'vitest';
import { overpassToCanonical } from '../canonical/overpass-to-canonical';
import { GENERATED_MAGNET_REGISTRY } from '../canonical/generated-magnet-registry';
import { classifyCanonicalMagnet } from '../canonical/magnet-registry';
import type { MagnetItem } from '../types';

function minimalMagnet(args: { canonicalType: any; categoryId?: string; name?: string; distance?: number; subType?: string; attractionScore?: number }): MagnetItem {
  return {
    categoryId: args.categoryId ?? 'attraction',
    categoryLabel: args.categoryId ?? 'attraction',
    icon: '',
    name: args.name ?? 'X',
    lat: 0,
    lon: 0,
    distance: args.distance ?? 500,
    weight: 1,
    permanenceType: 'permanent',
    scopeLevel: 'city',
    strengthClass: 'medium',
    attractionScore: args.attractionScore ?? 0,
    subType: args.subType,
    canonicalType: args.canonicalType,
    canonicalMapping: {
      confidence: 1,
      matchedBy: 'tag',
      ambiguous: false,
      ambiguityReasons: [],
      warnings: [],
      normalizedTags: {},
      source: 'test',
    },
  };
}

function expectRegistryTierCap(canonicalType: any, decision: ReturnType<typeof classifyCanonicalMagnet>) {
  const reg = (GENERATED_MAGNET_REGISTRY as any)[canonicalType];
  expect(reg).toBeTruthy();
  expect(decision.maxResidentialTier).toBeLessThanOrEqual(reg.maxTier);
}

describe('overpass → canonical mapping', () => {
  it('railway station', () => {
    const r = overpassToCanonical({ tags: { railway: 'station', name: 'Kirovsky Zavod Station' } });
    expect(r.canonicalType).toBe('railway_station');
    expect(r.matchedBy).toBe('tag');
    const d = classifyCanonicalMagnet({ magnet: minimalMagnet({ canonicalType: r.canonicalType, categoryId: 'railway_station', name: 'Station' }) });
    expectRegistryTierCap(r.canonicalType, d);
    expect((GENERATED_MAGNET_REGISTRY as any)[r.canonicalType].residentialEligibility.primeEligible).toBe(true);
  });

  it('airport', () => {
    const r = overpassToCanonical({ tags: { aeroway: 'aerodrome', name: 'Test Airport' } });
    expect(r.canonicalType).toBe('airport');
    expect(r.matchedBy).toBe('tag');
    const d = classifyCanonicalMagnet({ magnet: minimalMagnet({ canonicalType: r.canonicalType, categoryId: 'airport', name: 'Airport', distance: 1800 }) });
    expectRegistryTierCap(r.canonicalType, d);
    expect((GENERATED_MAGNET_REGISTRY as any)[r.canonicalType].residentialEligibility.primeEligible).toBe(true);
  });

  it('port', () => {
    const r = overpassToCanonical({ tags: { harbour: 'port', name: 'Port Terminal' } });
    expect(r.canonicalType).toBe('port');
    expect(r.matchedBy).toBe('tag');
    const d = classifyCanonicalMagnet({ magnet: minimalMagnet({ canonicalType: r.canonicalType, categoryId: 'railway_station', name: 'Port' }) });
    expectRegistryTierCap(r.canonicalType, d);
  });

  it('metro station', () => {
    const r = overpassToCanonical({ tags: { station: 'subway', name: 'Metro' } });
    expect(r.canonicalType).toBe('metro_station');
    expect(r.matchedBy).toBe('tag');
  });

  it('industrial plant', () => {
    const r = overpassToCanonical({ tags: { man_made: 'works', name: 'Factory Works' } });
    expect(r.canonicalType).toBe('industrial_anchor');
    expect(r.matchedBy).toBe('tag');
  });

  it('industrial zone', () => {
    const r = overpassToCanonical({ tags: { landuse: 'industrial', name: 'Industrial Zone' } });
    expect(r.canonicalType).toBe('industrial_zone');
    expect(r.matchedBy).toBe('tag');
  });

  it('office / business center stays separated', () => {
    const r1 = overpassToCanonical({ tags: { office: 'yes', name: 'Some Office' } });
    expect(r1.canonicalType).toBe('office_cluster');
    const r2 = overpassToCanonical({ tags: { office: 'yes', name: 'Бизнес-центр Альфа' } });
    // name-only business_center is ambiguous by design
    expect(r2.canonicalType).toBe('business_center');
    expect(r2.ambiguous).toBe(true);
  });

  it('hospital', () => {
    const r = overpassToCanonical({ tags: { amenity: 'hospital', name: 'City Hospital' } });
    expect(r.canonicalType).toBe('hospital');
    expect(r.matchedBy).toBe('tag');
  });

  it('university', () => {
    const r = overpassToCanonical({ tags: { amenity: 'university', name: 'Uni' } });
    expect(r.canonicalType).toBe('university');
  });

  it('shopping mall', () => {
    const r = overpassToCanonical({ tags: { shop: 'mall', name: 'Mall' } });
    expect(r.canonicalType).toBe('shopping_mall');
  });

  it('park', () => {
    const r = overpassToCanonical({ tags: { leisure: 'park', name: 'Central Park' } });
    expect(r.canonicalType).toBe('park');
  });

  it('beach / waterfront', () => {
    const r1 = overpassToCanonical({ tags: { natural: 'beach', name: 'Beach' } });
    expect(r1.canonicalType).toBe('beach');
    const r2 = overpassToCanonical({ tags: { waterway: 'riverbank', name: 'Embankment' } });
    expect(r2.canonicalType).toBe('waterfront');
  });

  it('resort area', () => {
    const r = overpassToCanonical({ name: 'Ski Resort Area', tags: {} });
    expect(r.canonicalType).toBe('resort_area');
    expect(r.matchedBy).toBe('nameFallback');
  });

  it('stadium / event venue', () => {
    const r1 = overpassToCanonical({ tags: { leisure: 'stadium', name: 'Arena' } });
    expect(r1.canonicalType).toBe('stadium');
    const r2 = overpassToCanonical({ tags: { amenity: 'conference_centre', name: 'Expo' } });
    expect(r2.canonicalType).toBe('event_venue');
  });

  it('museum / theater / generic attraction stay capped (tier1CreditMax=0)', () => {
    const museum = overpassToCanonical({ tags: { tourism: 'museum', name: 'Museum' } });
    const theater = overpassToCanonical({ tags: { amenity: 'theatre', name: 'Theatre' } });
    const generic = overpassToCanonical({ name: 'Generic Attraction', tags: {} });
    expect(museum.canonicalType).toBe('museum');
    expect(theater.canonicalType).toBe('theater');
    expect(generic.canonicalType).toBe('tourist_attraction');

    for (const t of [museum.canonicalType, theater.canonicalType, generic.canonicalType]) {
      const reg = (GENERATED_MAGNET_REGISTRY as any)[t];
      expect(reg.scoringCaps.tier1CreditMax).toBe(0);
    }
  });

  it('weak local amenity', () => {
    const r = overpassToCanonical({ tags: { amenity: 'cafe', name: 'Cafe' } });
    // We do not treat cafes as magnets; they must fall back safely.
    expect(r.canonicalType).toBe('weak_amenity');
  });

  it('unknown POI falls back to weak_amenity with warnings in strict mode', () => {
    const r = overpassToCanonical({ tags: { amenity: 'something_new', name: 'Unknown' } });
    expect(r.canonicalType).toBe('weak_amenity');
    expect(r.matchedBy).toBe('unknownFallback');
    // strict mode should emit warnings by default
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('regression: Kirovsky Zavod must not become tourist/cultural Tier-1', () => {
    const r = overpassToCanonical({ name: 'Кировский завод', tags: {} });
    expect(r.canonicalType).toBe('industrial_anchor');
    const d = classifyCanonicalMagnet({ magnet: minimalMagnet({ canonicalType: r.canonicalType, categoryId: 'business', subType: 'factory', name: 'Кировский завод' }) });
    expect(d.family).toBe('industrial_anchor');
    expect(d.maxResidentialTier).not.toBe(1);
  });
});

