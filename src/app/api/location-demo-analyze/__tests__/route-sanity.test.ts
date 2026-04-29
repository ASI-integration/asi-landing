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
  return {
    evergreenIndex: 99,
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
    magnets: [
      magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 250, subType: 'office', weight: 4 }),
      magnet({ categoryId: 'business', name: 'Ренессанс страхование', distance: 310, subType: 'office', weight: 4 }),
      magnet({ categoryId: 'business', name: 'Слетать.ру', distance: 280, subType: 'travel_agency', weight: 3 }),
      magnet({ categoryId: 'business', name: 'Сбербанк', distance: 410, subType: 'bank', weight: 3 }),
      magnet({ categoryId: 'metro', name: 'Комендантский проспект', distance: 850, weight: 9, strengthClass: 'strong' }),
    ],
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
    conclusion: '',
  };
}

describe('POST /api/location-demo-analyze sanity envelope', () => {
  beforeEach(() => {
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockFetchOsmData.mockResolvedValue({ elements: [], hadProviderFailure: false, usedFallbackQuery: false });
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
    expect(body.displayScore).toBeLessThanOrEqual(70);
    expect(body.displayAudience).not.toBe('BUSINESS');
    expect(body.meta.demoSanity.capReasonsRu).toContain(
      'Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён.',
    );
  });
});
