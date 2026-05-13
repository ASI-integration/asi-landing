import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocationAnalysis, MagnetItem, NeighborhoodEnvironmentLayer, ScoreBand } from '@/lib/location/types';

const mockFetchOsmData = vi.fn();
const mockBuildAnalysis = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();

vi.mock('@/lib/location', async () => {
  const actual = await vi.importActual<typeof import('@/lib/location')>('@/lib/location');
  return {
    ...actual,
    fetchOsmData: (...args: unknown[]) => mockFetchOsmData(...args),
    buildAnalysis: (...args: unknown[]) => mockBuildAnalysis(...args),
  };
});

vi.mock('@/lib/location/cache', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
}));

import { POST } from '../route';

function magnet(p: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId' | 'name' | 'distance'>): MagnetItem {
  return {
    categoryLabel: p.categoryId,
    icon: '•',
    lat: 0,
    lon: 0,
    weight: p.weight ?? 4,
    permanenceType: p.permanenceType ?? 'permanent',
    scopeLevel: p.scopeLevel ?? 'local',
    strengthClass: p.strengthClass ?? 'medium',
    attractionScore: p.attractionScore ?? 3,
    ...p,
  };
}

const baseEnv: NeighborhoodEnvironmentLayer = {
  environmentalFrictionScore: 14,
  concernLevel: 'low',
  concernLabelEn: 'Low concern',
  concernLabelRu: 'Окружение: спокойное',
  reasonsEn: [],
  reasonsRu: [],
  environmentNarrativeEn: '',
  environmentNarrativeRu: '',
  confidence: 'medium',
  breakdown: {
    majorRoads01: 0.2,
    industrial01: 0.05,
    aviation01: 0.04,
    nightlife01: 0.05,
    transitCorridor01: 0.12,
    harshUrbanStack01: 0.18,
  },
};

function komendantskyFixture(): LocationAnalysis {
  const magnets: MagnetItem[] = [
    magnet({ categoryId: 'metro', name: 'Комендантский проспект', distance: 473, weight: 9, strengthClass: 'strong' }),
    magnet({ categoryId: 'metro', name: 'Вход 1', distance: 680, weight: 9, strengthClass: 'medium' }),
    magnet({ categoryId: 'metro', name: 'Вход 2', distance: 686, weight: 9, strengthClass: 'medium' }),
    magnet({ categoryId: 'attraction', name: 'Самолет - стрекоза', distance: 481, attractionScore: 2.1, strengthClass: 'weak' }),
    magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 3, subType: 'office', weight: 4 }),
    magnet({ categoryId: 'business', name: 'Ренессанс страхование', distance: 236, subType: 'office', weight: 4 }),
    magnet({ categoryId: 'business', name: 'Марио', distance: 282, subType: 'office', weight: 4 }),
    magnet({ categoryId: 'business', name: 'Ренессанс Страхование', distance: 412, subType: 'office', weight: 4 }),
    magnet({ categoryId: 'business', name: 'Слетать.ру', distance: 445, subType: 'office', weight: 3 }),
    magnet({ categoryId: 'shopping_major', name: 'Крокус', distance: 794, weight: 4, strengthClass: 'medium' }),
    magnet({ categoryId: 'shopping_major', name: 'Сабина', distance: 854, weight: 4, strengthClass: 'medium' }),
    magnet({ categoryId: 'food', name: 'Локальное кафе', distance: 380 }),
    magnet({ categoryId: 'shopping_local', name: 'Локальный магазин', distance: 410 }),
  ];

  return {
    evergreenIndex: 93,
    scoreBand: 'strong' as ScoreBand,
    locationScore: {
      location_score: 99,
      rating: 'viable',
      breakdown: {
        demand_score: 99,
        supply_score: 60,
        magnet_score: 50,
        seasonality_score: 60,
        audience_fit_score: 62,
        accessibility_score: 50,
      },
      estimated_monthly_income: { short_term: 0, mid_term: 0, hybrid: 0 },
      income_model: { base_adr_rub: 0, base_occupancy_pct: 0 },
      top_positive_factors: [],
      top_negative_factors: [],
      recommended_strategy: 'hybrid',
    },
    magnets,
    magnetCountByCategory: {},
    accessibilityStops: [],
    competitors: [],
    gravityExplanation: {
      dominantMagnets: [],
      strongestZoneLabel: '',
      competitorPressureLevel: 'low',
      demandDistribution: 'split',
      demandType: 'mixed',
      clusterDetected: false,
      clusterSize: 0,
      scoreBreakdown: { attraction: 0, competitorPressure: 0, clusterBonus: 0, trafficBoost: 0 },
    },
    demandType: 'mixed',
    strongestMagnets: [],
    clusterZones: [],
    splitDemand: false,
    competitorPressure: 0,
    footTraffic: {
      modifierTier: 'moderate',
      boostPoints: 0,
      movementDensity: '',
      zoneActivity: '',
      flowStability: '',
      flowCharacter: '',
      transitVsTarget: { transitShare: 0.33, localActiveShare: 0.34, destinationShare: 0.33 },
      stability01: 0.5,
      concentration01: 0.5,
    },
    audienceAnalysis: {
      primaryAudience: 'BUSINESS',
      locationType: 'MIXED',
      audienceFitScore: 62,
      primaryMagnets: [],
      fallbackMode: false,
      audienceSharePct: 70,
      businessClusterDetected: true,
      primaryDriverLabel: '',
      lockedMode: false,
      demandFlowLabel: '',
    },
    neighborhoodEnvironment: baseEnv,
    heatmapPoints: [],
    scoringTrace: {
      coordinates: { lat: 60.014315, lon: 30.253552 },
      rawObjectsCount: 120,
      classifiedMagnets: magnets.map(m => ({
        categoryId: m.categoryId,
        name: m.name,
        distanceM: Math.round(m.distance),
        attractionScore: m.attractionScore,
        strengthClass: m.strengthClass,
      })),
      scoreFeatures: {
        evergreenIndex: 93,
        attractionScaled: 0,
        competitorPressure: 0,
        magnet_score: 50,
        demand_score: 99,
        supply_score: 60,
        accessibility_score: 50,
        audience_fit_score: 62,
        seasonality_score: 60,
      },
      baseScore: 99,
      capsApplied: [],
      finalScore: 99,
      evidence: [],
      publicBullets: [],
      removedPublicBullets: [],
      warnings: [],
    },
    conclusion: '',
  };
}

function fixtureWithMagnets(magnets: MagnetItem[], rawObjectsCount: number): LocationAnalysis {
  const base = komendantskyFixture();
  return {
    ...base,
    magnets,
    magnetCountByCategory: magnets.reduce<Record<string, number>>((acc, m) => {
      acc[m.categoryId] = (acc[m.categoryId] ?? 0) + 1;
      return acc;
    }, {}),
    strongestMagnets: magnets,
    scoringTrace: {
      ...base.scoringTrace!,
      rawObjectsCount,
      classifiedMagnets: magnets.map(m => ({
        categoryId: m.categoryId,
        name: m.name,
        distanceM: Math.round(m.distance),
        attractionScore: m.attractionScore,
        strengthClass: m.strengthClass,
      })),
      warnings: [],
    },
  };
}

describe('POST /api/location-demo-analyze sanity envelope', () => {
  beforeEach(() => {
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    // Non-empty raw snapshot so integrity gate does not zero out the mocked analysis headliner.
    mockFetchOsmData.mockResolvedValue({
      elements: [{ type: 'node', id: 9_001_001, lat: 60.014315, lon: 30.253552, tags: { amenity: 'cafe', name: 'Fixture café' } }],
      hadProviderFailure: false,
      usedFallbackQuery: false,
    });
    mockBuildAnalysis.mockReturnValue(komendantskyFixture());
  });

  it('returns capped RU demo display fields for weak-office cluster', async () => {
    const req = new Request('http://localhost/api/location-demo-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 60.014315, lon: 30.253552, locale: 'ru' }),
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.scoringTrace.finalScore).toBeLessThanOrEqual(70);
    expect(body.displayAudience).not.toBe('BUSINESS');
    expect(body.meta.demoSanity.verdictLabelRu).not.toBe('Сильная локация для командированных');
    expect(body.meta.demoSanity.capReasonsRu).toContain(
      'Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён.',
    );
  });

  it('passes geocodeResult into locationDecision for RU city mismatch (geocode_city_mismatch)', async () => {
    const req = new Request('http://localhost/api/location-demo-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: 60.014315,
        lon: 30.253552,
        locale: 'ru',
        inputAddress: 'Кемерово, 2-я Луговая ул., 27',
        geocodeResult: {
          lat: 60.014315,
          lon: 30.253552,
          locality: 'Сосновка',
          municipality: 'Сосновка',
          adminArea2: 'Новокузнецкий округ',
          adminArea1: 'Кемеровская область',
          displayName: '2-я Луговая ул., 27, Сосновка',
        },
      }),
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    const ld = body.analysis.locationDecision;
    expect(ld).toBeTruthy();
    expect(ld.publicSummary?.cityScale).toBe('unknown');
    expect(ld.warnings.some((w: string) => w.includes('warning: geocode_city_mismatch'))).toBe(true);
    expect(ld.demandKernelV1?.cityScaleInferenceProvenance).toMatch(/geocode_city_mismatch/);
  });

  it('uses fast-demo Overpass options for live map collection', async () => {
    const req = new Request('http://localhost/api/location-demo-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 56.3004529, lon: 44.077986, locale: 'ru' }),
    });

    const res = await POST(req as any);

    expect(res.status).toBe(200);
    expect(mockFetchOsmData).toHaveBeenCalledWith(
      56.3004529,
      44.077986,
      expect.objectContaining({ fastDemo: true, requestTimeoutMs: 5500 }),
    );
  });

  it('fallback success returns a partial usable result, not no-data', async () => {
    const hospital = magnet({
      categoryId: 'hospital',
      name: 'Городская больница',
      distance: 420,
      weight: 7,
      strengthClass: 'strong',
      attractionScore: 8,
    });
    mockFetchOsmData.mockResolvedValueOnce({
      elements: [{ type: 'node', id: 901, lat: 56.3, lon: 44.07, tags: { amenity: 'hospital', name: 'Городская больница' } }],
      hadProviderFailure: true,
      usedFallbackQuery: true,
      overpassDiagnostics: {
        overpassAttemptCount: 2,
        overpassEndpoint: 'https://overpass-api.de/api/interpreter',
        overpassQueryMode: 'light_fallback',
        overpassDurationMs: 812,
        overpassQuerySize: 1200,
        overpassQueryRadiusM: 1000,
        overpassFallbackAttempted: true,
        overpassFallbackSucceeded: true,
        overpassAttempts: [],
      },
    });
    mockBuildAnalysis.mockReturnValueOnce(fixtureWithMagnets([hospital], 1));

    const req = new Request('http://localhost/api/location-demo-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 56.3004529, lon: 44.077986, locale: 'ru' }),
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.analysisUsableForPublicScore).toBe(true);
    expect(body.meta.retryRecommended).toBe(false);
    expect(body.meta.noDataReason).toBeNull();
    expect(body.meta.usedFallbackQuery).toBe(true);
    expect(body.meta.overpassQueryMode).toBe('light_fallback');
    expect(body.analysis.locationDecision.publicSummary.presentationDiagnostics.partialCartographicPreview).toBe(true);
  });

  it('total Overpass failure returns no-data with retryRecommended and no fake score', async () => {
    mockFetchOsmData.mockResolvedValueOnce({
      elements: [],
      hadProviderFailure: true,
      usedFallbackQuery: true,
      overpassDiagnostics: {
        overpassAttemptCount: 4,
        overpassQueryMode: 'light_fallback',
        overpassDurationMs: 1200,
        overpassFailureReason: 'http_504',
        overpassQuerySize: 1000,
        overpassQueryRadiusM: 1000,
        overpassFallbackAttempted: true,
        overpassFallbackSucceeded: false,
        overpassAttempts: [],
      },
    });
    mockBuildAnalysis.mockReturnValueOnce(fixtureWithMagnets([], 0));

    const req = new Request('http://localhost/api/location-demo-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 56.3004529, lon: 44.077986, locale: 'ru' }),
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.analysisUsableForPublicScore).toBe(false);
    expect(body.meta.retryRecommended).toBe(true);
    expect(body.meta.noDataReason).toBe('osm_empty_result');
    expect(body.analysis.locationScore.location_score).toBe(0);
    expect(body.analysis.scoringTrace.finalScore).toBe(0);
    expect(body.meta.overpassFailureReason).toBe('http_504');
  });
});
